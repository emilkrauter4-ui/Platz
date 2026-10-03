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
import numpy as np
import rasterio
from rasterio import features
from rasterio.enums import Resampling
from rasterio.warp import reproject
from scipy import ndimage
from shapely.geometry import mapping, shape

from common import build_dir, cfg, raw_dir


def load_resampled(path, like) -> np.ndarray:
    """Raster `path` auf das Gitter von `like` bilinear resamplen."""
    with rasterio.open(path) as src:
        dst = np.full((like.height, like.width), np.nan, dtype=np.float32)
        reproject(
            source=rasterio.band(src, 1), destination=dst,
            src_transform=src.transform, src_crs=src.crs, src_nodata=src.nodata,
            dst_transform=like.transform, dst_crs=like.crs, dst_nodata=np.nan,
            resampling=Resampling.bilinear,
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


def main() -> int:
    c = cfg()["bestand"]
    raw, out = raw_dir(), build_dir()
    buildings = gpd.read_file(out / "buildings.geojson").set_crs(25832, allow_override=True)
    masks = buildings.geometry.buffer(c["gebaeude_puffer_m"])

    results = []
    for dom_path in sorted((raw / "dom20").glob("*.tif")):
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
            cand = (ndsm >= c["hoehe_min_m"]) & (ndsm <= c["hoehe_max_m"]) & (v <= c["ndvi_schwelle"]) & ~bmask
            cand &= np.isfinite(ndsm)
            k = c["oeffnen_px"]
            cand = ndimage.binary_opening(cand, structure=np.ones((2 * k + 1, 2 * k + 1)))
            cand = ndimage.binary_fill_holes(cand)

            lab, n = ndimage.label(cand)
            px = abs(dom.transform.a * dom.transform.e)
            for geom, val in features.shapes(lab.astype(np.int32), mask=lab > 0, transform=dom.transform):
                poly = shape(geom)
                if not (c["flaeche_min_m2"] <= poly.area <= c["flaeche_max_m2"]):
                    continue
                r = rectangularity(poly)
                if r < c["rechteckigkeit_min"]:
                    continue
                inside = lab == int(val)
                hs = ndsm[inside]
                rough = plane_rms(inside, ndsm)
                if rough > c["dach_rauigkeit_max_m"]:
                    continue
                ground_share = surrounding_ground(inside, ndsm, c)
                if ground_share < c["umfeld_boden_anteil_min"]:
                    continue
                h = float(np.nanmedian(hs))
                veg = float(np.mean(v[inside] > c["ndvi_schwelle"] * 0.8))
                # Konfidenz: rechteckig, ebenes Dach, kaum Grün in der Umgebung der Schwelle
                conf = (0.4 * (r - c["rechteckigkeit_min"]) / (1 - c["rechteckigkeit_min"])
                        + 0.3 * max(0.0, 1 - rough / c["dach_rauigkeit_max_m"]) + 0.2 * ground_share + 0.1 * (1 - veg))
                simple = poly.simplify(px, preserve_topology=True)
                results.append({
                    "type": "Feature",
                    "geometry": mapping(simple),
                    "properties": {
                        "label": "erkannt",
                        "hoehe": round(h, 2),
                        "flaeche": round(poly.area, 1),
                        "rechteckigkeit": round(r, 3),
                        "rauigkeit": round(rough, 3),
                        "umfeld_boden": round(ground_share, 2),
                        "konfidenz": round(float(np.clip(conf, 0, 1)), 2),
                        "kachel": name,
                    },
                })
    for i, f in enumerate(results):
        f["properties"]["id"] = f"BESTAND_{i}"
    fc = {"type": "FeatureCollection", "name": "bestand", "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25832"}}, "features": results}
    (out / "bestand.geojson").write_text(json.dumps(fc), encoding="utf-8")
    print(f"Erkannte Kleinbauten: {len(results)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
