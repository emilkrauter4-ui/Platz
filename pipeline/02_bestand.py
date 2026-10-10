#!/usr/bin/env python3
"""Bestehende Kleinbauten (Gartenhäuser, Carports, Garagen) aus nDSM erkennen → bestand.geojson.

Viele Nebengebäude fehlen in LoD2, zählen aber bei der 9-m- und 15-m-Regel mit.
Ablauf je 1-km-Kachel (Schwellwerte in config.yaml):
  1. DGM1 auf 20 cm resamplen (bilinear), nDSM = DOM20 − DGM1
  2. Gebäude aus 01_buildings maskieren (Puffer 0,5 m)
  3. Vegetation entfernen: NDVI aus DOP20 CIR
  4. Höhenband behalten, morphologisches Öffnen, polygonisieren
  5. Fläche, Rechteckigkeit, Ebenheit des Dachs und freier Stand filtern
Ausgabe mit Höhe, Fläche, Konfidenz und Label `erkannt`.
"""
from __future__ import annotations

import json
import sys

import geopandas as gpd
import pandas as pd
import numpy as np
import rasterio
from rasterio import features
from rasterio.enums import Resampling
from rasterio.warp import reproject
from scipy import ndimage
from shapely.geometry import mapping, shape

from common import alle_bboxen, build_dir, cfg, gebiet_build_dir, kachel_dateien, raw_dir


def load_resampled(path, like, resampling=Resampling.bilinear) -> np.ndarray:
    """Raster `path` auf das Gitter von `like` bilinear resamplen."""
    with rasterio.open(path) as src:
        dst = np.full((like.height, like.width), np.nan, dtype=np.float32)
        reproject(
            source=rasterio.band(src, 1), destination=dst,
            src_transform=src.transform, src_crs=src.crs, src_nodata=src.nodata,
            dst_transform=like.transform, dst_crs=like.crs, dst_nodata=np.nan,
            resampling=resampling,
        )
    return dst


def ndvi(path, like) -> np.ndarray:
    """NDVI aus DOP20 CIR. Bandfolge des CIR-Dienstes: 1 = NIR, 2 = Rot, 3 = Grün (verifiziert per Stichprobe)."""
    with rasterio.open(path) as src:
        nir = np.empty((like.height, like.width), np.float32)
        red = np.empty_like(nir)
        for b, dst in ((1, nir), (2, red)):
            reproject(rasterio.band(src, b), dst, src_transform=src.transform, src_crs=src.crs,
                      dst_transform=like.transform, dst_crs=like.crs, resampling=Resampling.nearest)
    return (nir - red) / np.maximum(nir + red, 1)


def plane_rms(mask: np.ndarray, z: np.ndarray) -> float:
    """RMS-Abweichung der nDSM-Pixel von einer Ausgleichsebene. Dächer sind eben, Baumkronen nicht."""
    rows, cols = np.nonzero(mask)
    zz = z[rows, cols]
    ok = np.isfinite(zz)
    if ok.sum() < 6:
        return np.inf
    A = np.c_[rows[ok], cols[ok], np.ones(ok.sum())].astype(float)
    coef, *_ = np.linalg.lstsq(A, zz[ok], rcond=None)
    return float(np.sqrt(np.mean((A @ coef - zz[ok]) ** 2)))


def surrounding_ground(mask: np.ndarray, z: np.ndarray, c: dict) -> float:
    """Anteil Bodenpixel (nDSM < umfeld_boden_hoehe_m) im Ring um das Objekt.

    Kleinbauten stehen frei auf dem Gelände. Fehltreffer an Dachkanten (Glättung im DOM)
    und in Baumkronen sind dagegen von hohen Pixeln umgeben.
    """
    rows, cols = np.nonzero(mask)
    pad = c["umfeld_ring_aussen_px"] + 2
    r0, r1 = max(rows.min() - pad, 0), rows.max() + pad + 1
    c0, c1 = max(cols.min() - pad, 0), cols.max() + pad + 1
    m = mask[r0:r1, c0:c1]
    ring = ndimage.binary_dilation(m, iterations=c["umfeld_ring_aussen_px"]) & ~ndimage.binary_dilation(m, iterations=c["umfeld_ring_innen_px"])
    zz = z[r0:r1, c0:c1][ring]
    zz = zz[np.isfinite(zz)]
    return float(np.mean(zz < c["umfeld_boden_hoehe_m"])) if len(zz) else 0.0


def rectangularity(poly) -> float:
    mrr = poly.minimum_rotated_rectangle
    return poly.area / mrr.area if mrr.area else 0.0


def verkehr_maske(dom, c) -> np.ndarray:
    """Verkehrsflächen aus ALKIS Tatsächliche Nutzung (Straße, Weg, Platz, Bahn …): dort stehen Autos, keine Schuppen."""
    if not c.get("verkehr_maskieren"):
        return np.zeros((dom.height, dom.width), bool)
    tn = _tn_verkehr(tuple(c["verkehr_klassen"]))
    b = dom.bounds
    sub = tn.cx[b.left:b.right, b.bottom:b.top]
    if not len(sub):
        return np.zeros((dom.height, dom.width), bool)
    return features.rasterize(((g, 1) for g in sub.geometry), out_shape=(dom.height, dom.width), transform=dom.transform,
                              fill=0, dtype=np.uint8).astype(bool)


_TN = {}


def _tn_verkehr(klassen):
    if klassen not in _TN:
        files = sorted((raw_dir() / "tn" / "data").rglob("*.gpkg")) + sorted((raw_dir() / "tn" / "data").rglob("*.shp"))
        frames = []
        for x0, y0, x1, y1 in alle_bboxen():  # alle Gebiete: der Tipp-Dienst arbeitet gebietsübergreifend
            for f in files:
                g = gpd.read_file(f, bbox=(x0, y0, x1, y1))
                if g.crs and g.crs.to_epsg() != 25832:
                    g = g.to_crs(25832)
                frames.append(g)
        tn = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=25832)
        # Verkehrsflächen nach Nutzungsart, dazu Parkplätze (Bezeichnung innerhalb anderer Nutzungsarten)
        _TN[klassen] = tn[tn["nutzart"].isin(klassen) | (tn["bez"] == "Parkplatz")]
        print(f"  Verkehrsflächen (TN) im Gebiet: {len(_TN[klassen])}")
    return _TN[klassen]


def laser_band(dom, c) -> tuple[np.ndarray, np.ndarray]:
    """Laser-nDSM (zweite Epoche, 02a_laser.py) auf das 20-cm-Gitter: (im Höhenband, Daten vorhanden)."""
    p = build_dir() / "laser_ndsm" / f"{int(dom.bounds.left // 1000)}_{int(dom.bounds.bottom // 1000)}.tif"
    if not p.exists():
        return np.zeros((dom.height, dom.width), bool), np.zeros((dom.height, dom.width), bool)
    nd = load_resampled(p, dom, Resampling.nearest)
    lo, hi = c["laser_band_m"]
    band = (nd >= lo) & (nd <= hi)
    if c.get("laser_einzelecho_min") is not None:
        # Dach: überwiegend ein Echo pro Puls; laubfreie Vegetation: Mehrfachechos
        with rasterio.open(p) as src:
            ratio = np.full((dom.height, dom.width), np.nan, np.float32)
            reproject(rasterio.band(src, 2), ratio, src_transform=src.transform, src_crs=src.crs,
                      dst_transform=dom.transform, dst_crs=dom.crs, resampling=Resampling.nearest)
        band &= np.nan_to_num(ratio, nan=0.0) >= c["laser_einzelecho_min"]
    if c["laser_toleranz_px"]:
        band = ndimage.binary_dilation(band, iterations=c["laser_toleranz_px"])
    return band, np.isfinite(nd)


def main(ausgabe: str = "bestand.geojson") -> int:
    c = cfg()["bestand"]
    raw, out = raw_dir(), gebiet_build_dir()
    buildings = gpd.read_file(out / "buildings.geojson").set_crs(25832, allow_override=True)
    masks = buildings.geometry.buffer(c["gebaeude_puffer_m"])
    stats = {"kandidaten": 0, "flaeche_form": 0, "laser": 0, "rauigkeit": 0, "umfeld": 0}  # „rauigkeit“ zählt nach Anbau-Filter

    results = []
    for dom_path in kachel_dateien(raw / "dom20", "tif"):
        name = dom_path.name
        print(f"Kachel {name}")
        with rasterio.open(dom_path) as dom:
            dsm = dom.read(1).astype(np.float32)
            dsm[dsm == dom.nodata] = np.nan
            dgm = load_resampled(raw / "dgm1" / name, dom)
            v = ndvi(raw / "dop20cir" / name, dom)
            ndsm = dsm - dgm

            bmask = features.rasterize(((g, 1) for g in masks.cx[dom.bounds.left:dom.bounds.right, dom.bounds.bottom:dom.bounds.top]),
                                       out_shape=dsm.shape, transform=dom.transform, fill=0, dtype=np.uint8).astype(bool)
            vmask = verkehr_maske(dom, c)
            lband, lvalid = laser_band(dom, c)
            cand = (ndsm >= c["hoehe_min_m"]) & (ndsm <= c["hoehe_max_m"]) & (v <= c["ndvi_schwelle"]) & ~bmask & ~vmask
            cand &= np.isfinite(ndsm)
            if c.get("laser_pixelweise"):
                # Beide Epochen schon pro Pixel verlangen: Hecken und Sträucher fallen heraus, bevor sie
                # mit einem Schuppen zu einem großen, unförmigen Fleck verschmelzen
                cand &= lband
            k = c["oeffnen_px"]
            cand = ndimage.binary_opening(cand, structure=np.ones((2 * k + 1, 2 * k + 1)))
            cand = ndimage.binary_fill_holes(cand)

            lab, n = ndimage.label(cand)
            stats["kandidaten"] += n
            px = abs(dom.transform.a * dom.transform.e)
            for geom, val in features.shapes(lab.astype(np.int32), mask=lab > 0, transform=dom.transform):
                poly = shape(geom)
                if not (c["flaeche_min_m2"] <= poly.area <= c["flaeche_max_m2"]):
                    continue
                r = rectangularity(poly)
                if r < c["rechteckigkeit_min"]:
                    continue
                stats["flaeche_form"] += 1
                inside = lab == int(val)
                # Zweite Epoche: Objekt muss auch im Laser-nDSM im Höhenband stehen (DOM20 UND Laser)
                lshare = float(lband[inside].mean()) if lvalid[inside].any() else 0.0
                if c["laser_bestaetigung_min"] is not None and lshare < c["laser_bestaetigung_min"]:
                    continue
                stats["laser"] += 1
                # Anbau-Filter: Flecken, die großteils am Gebäudepuffer kleben, sind meist Dachüberstände,
                # Gauben oder Anbauten des Wohnhauses (Umring kleiner als Dach), keine freistehenden Kleinbauten
                if c.get("anbau_kontakt_max") is not None:
                    ring = ndimage.binary_dilation(inside, iterations=2) & ~inside
                    kontakt = float(bmask[ring].mean()) if ring.any() else 0.0
                    if kontakt > c["anbau_kontakt_max"]:
                        continue
                hs = ndsm[inside]
                rough = plane_rms(inside, ndsm)
                if c["dach_rauigkeit_max_m"] is not None and rough > c["dach_rauigkeit_max_m"]:
                    continue
                stats["rauigkeit"] += 1
                ground_share = surrounding_ground(inside, ndsm, c)
                if c["umfeld_boden_anteil_min"] is not None and ground_share < c["umfeld_boden_anteil_min"]:
                    continue
                stats["umfeld"] += 1
                h = float(np.nanmedian(hs))
                veg = float(np.mean(v[inside] > c["ndvi_schwelle"] * 0.8))
                # Konfidenz: von beiden Epochen bestätigt, rechteckig, kaum Grün
                conf = 0.5 * lshare + 0.3 * (r - 0.5) / 0.5 + 0.2 * (1 - veg)
                # Das DOM20 (Bildkorrelation) glättet Kanten um ~1 m: Umriss um die halbe Glättung verkleinern,
                # sonst zählen erkannte Bauten an der Grenze zu lang (9-m-/15-m-Regel)
                shrunk = poly.buffer(-c.get("umriss_schrumpfen_m", 0.0), join_style=2) if c.get("umriss_schrumpfen_m") else poly
                if shrunk.is_empty or shrunk.geom_type != "Polygon":
                    shrunk = poly
                simple = shrunk.simplify(px, preserve_topology=True)
                results.append({
                    "type": "Feature",
                    "geometry": mapping(simple),
                    "properties": {
                        "label": "erkannt",
                        "hoehe": round(h, 2),
                        "flaeche": round(simple.area, 1),
                        "rechteckigkeit": round(r, 3),
                        "laser_anteil": round(lshare, 2),
                        "rauigkeit": round(rough, 3),
                        "umfeld_boden": round(ground_share, 2),
                        "konfidenz": round(float(np.clip(conf, 0, 1)), 2),
                        "kachel": name,
                    },
                })
    for i, f in enumerate(results):
        f["properties"]["id"] = f"BESTAND_{i}"
    fc = {"type": "FeatureCollection", "name": "bestand", "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25832"}}, "features": results}
    (out / ausgabe).write_text(json.dumps(fc), encoding="utf-8")
    print("Filterstufen:", stats)
    print(f"Erkannte Kleinbauten: {len(results)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
