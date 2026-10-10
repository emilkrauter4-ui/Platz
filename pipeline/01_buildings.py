#!/usr/bin/env python3
"""LoD2-CityGML + Hausumringe → buildings.geojson (Label `amtlich`).

Pro Gebäude: Grundriss, Bodenhöhe, Traufhöhe, Firsthöhe, Gebäude-ID.
Der Grundriss aus den Hausumringen hat Vorrang vor der LoD2-GroundSurface.
Zusätzlich werden die 3D-Flächen (Dach, Wand) für 03_tiles in surfaces.pkl abgelegt.

Höhen: Normalhöhen DHHN2016 (aus dem srsName der Datei verifiziert).
"""
from __future__ import annotations

import json
import pickle
import sys

import geopandas as gpd
import numpy as np
from lxml import etree
from shapely.geometry import Polygon, box, mapping
from shapely.validation import make_valid

from common import cfg, gebiet_build_dir, raw_dir

NS = {
    "core": "http://www.opengis.net/citygml/1.0",
    "bldg": "http://www.opengis.net/citygml/building/1.0",
    "gml": "http://www.opengis.net/gml",
    "gen": "http://www.opengis.net/citygml/generics/1.0",
}
B = "{%s}" % NS["bldg"]
EXPECTED_SRS = "urn:adv:crs:ETRS89_UTM32*DE_DHHN2016_NH"

SURFACES = {"RoofSurface": "roof", "WallSurface": "wall", "GroundSurface": "ground"}


def rings(surface) -> list[np.ndarray]:
    out = []
    for pl in surface.iterfind(".//gml:exterior//gml:posList", NS):
        v = np.array(pl.text.split(), dtype=float).reshape(-1, 3)
        if len(v) >= 4:
            out.append(v[:-1] if np.allclose(v[0], v[-1]) else v)
    return out


def check_srs(path) -> None:
    for _, el in etree.iterparse(str(path), tag="{%s}Envelope" % NS["gml"]):
        srs = el.get("srsName")
        if srs != EXPECTED_SRS:
            raise SystemExit(f"Unerwartetes Bezugssystem in {path.name}: {srs}")
        return


def parse_lod2(path):
    check_srs(path)
    for _, el in etree.iterparse(str(path), tag=B + "Building"):
        gid = el.get("{%s}id" % NS["gml"])
        attrs = {a.get("name"): a.findtext("gen:value", namespaces=NS) for a in el.iterfind("gen:stringAttribute", NS)}
        surf = {"roof": [], "wall": [], "ground": []}
        for name, key in SURFACES.items():
            for s in el.iter(B + name):
                surf[key] += rings(s)
        yield {
            "id": gid,
            "function": el.findtext("bldg:function", namespaces=NS),
            "roofType": el.findtext("bldg:roofType", namespaces=NS),
            "measuredHeight": float(el.findtext("bldg:measuredHeight", default="nan", namespaces=NS)),
            "hoeheGrund": float(attrs.get("HoeheGrund") or "nan"),
            "hoeheDach": float(attrs.get("HoeheDach") or "nan"),
            "surfaces": surf,
        }
        el.clear()
        while el.getprevious() is not None:
            del el.getparent()[0]


def lod2_dateien(bbox):
    """LoD2-Kacheln (2 km, Name = Südwestecke in km), die das Gebiet berühren – Rohdaten liegen gemeinsam."""
    x0, y0, x1, y1 = bbox
    out = []
    for p in sorted((raw_dir() / "lod2").glob("*.gml")):
        kx, ky = (int(v) * 1000 for v in p.stem.split("_"))
        if kx < x1 and kx + 2000 > x0 and ky < y1 and ky + 2000 > y0:
            out.append(p)
    return out


def main() -> int:
    c = cfg()
    bbox = c["gebiet"]["bbox"]
    area = box(*bbox)
    raw = raw_dir()

    hu = gpd.read_file(raw / "hausumringe" / "shp" / "hausumringe.shp", bbox=tuple(bbox))
    if str(hu.crs).upper() != "EPSG:25832":
        raise SystemExit(f"Hausumringe in unerwartetem CRS: {hu.crs}")
    hu["geometry"] = hu.geometry.apply(make_valid)
    hu = hu[hu.geometry.intersects(area)].reset_index(drop=True)
    sindex = hu.sindex
    print(f"Hausumringe im Gebiet: {len(hu)}")

    feats, surfaces, used = [], {}, set()
    for f in lod2_dateien(bbox):
        for b in parse_lod2(f):
            ground = b["surfaces"]["ground"]
            if not ground:
                continue
            gpoly = make_valid(Polygon(ground[0][:, :2]))
            if not gpoly.intersects(area):
                continue
            # Hausumring mit größter Überdeckung suchen
            best, best_iou = None, 0.0
            for i in sindex.query(gpoly, predicate="intersects"):
                h = hu.geometry.iloc[i]
                inter = h.intersection(gpoly).area
                iou = inter / (h.union(gpoly).area or 1)
                if iou > best_iou:
                    best, best_iou = i, iou
            if best is not None and best_iou > 0.5:
                footprint, quelle = hu.geometry.iloc[best], "Hausumringe"
                used.add(best)
            else:
                footprint, quelle = gpoly, "LoD2 GroundSurface"
            roof = np.vstack(b["surfaces"]["roof"]) if b["surfaces"]["roof"] else None
            trauf = float(roof[:, 2].min()) if roof is not None else b["hoeheDach"]
            first = float(roof[:, 2].max()) if roof is not None else b["hoeheDach"]
            g = b["hoeheGrund"]
            feats.append({
                "type": "Feature",
                "geometry": mapping(footprint),
                "properties": {
                    "id": b["id"],
                    "label": "amtlich",
                    "quelle_grundriss": quelle,
                    "iou_hausumring": round(best_iou, 3),
                    "funktion": b["function"],
                    "dachform": b["roofType"],
                    "hoehe_grund": round(g, 2),
                    "traufhoehe": round(trauf, 2),
                    "firsthoehe": round(first, 2),
                    "traufhoehe_rel": round(trauf - g, 2),
                    "firsthoehe_rel": round(first - g, 2),
                    "hoehensystem": "DHHN2016",
                },
            })
            surfaces[b["id"]] = {k: v for k, v in b["surfaces"].items() if k != "ground"}

    # Hausumringe ohne LoD2-Gebäude (z. B. Neubauten) trotzdem als Hindernis aufnehmen
    for i, geom in enumerate(hu.geometry):
        if i in used:
            continue
        feats.append({
            "type": "Feature",
            "geometry": mapping(geom),
            "properties": {"id": f"HU_{i}", "label": "amtlich", "quelle_grundriss": "Hausumringe", "lod2": False},
        })

    out = gebiet_build_dir()
    fc = {"type": "FeatureCollection", "name": "buildings", "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25832"}}, "features": feats}
    (out / "buildings.geojson").write_text(json.dumps(fc), encoding="utf-8")
    with open(out / "surfaces.pkl", "wb") as fh:
        pickle.dump(surfaces, fh)
    n_hu = sum(1 for f in feats if f["properties"]["quelle_grundriss"] == "Hausumringe")
    print(f"Gebäude: {len(feats)} (Grundriss aus Hausumringen: {n_hu}), 3D-Flächen für {len(surfaces)} Gebäude")
    return 0


if __name__ == "__main__":
    sys.exit(main())
