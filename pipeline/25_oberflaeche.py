#!/usr/bin/env python3
"""Oberflächenraster für die Sonne in den Räumen (AUFTRAG_V4 C2): Höhe von Bäumen und anderen Objekten über dem Gelände, 1 m,
in 250-m-Kacheln wie das Geländeraster.

Zwei Jahreszeiten, weil Laub die Sonne im Sommer nimmt und im Winter nicht:
  winter/  Laserdaten (nDSM aus 02a_laser.py), Befliegung 08.03.2025, laubfrei. Äste und Stämme sind teils sichtbar, Zweige oft nicht:
           die Schattenwirkung kahler Bäume wird eher unterschätzt.
  sommer/  DOM20 minus DGM1, Bildflug 16.09.2023, belaubt.
Gebäude (LoD2/Hausumringe, Puffer 1 m) werden herausgemaskiert: Sie stehen als eigene Körper (amtlich) in der Rechnung.
Unter 1,5 m Höhe wird null gesetzt (Büsche, Autos, Rauschen der Bildkorrelation).
Kodierung: uint8, Höhe = Wert × 0,25 m (bis 63,75 m), Zeile 0 = Süden (wie das Geländeraster).
Mit PASST_GEBIET=<id> für ein Mess-Gebiet.
"""
from __future__ import annotations

import json
import sys

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.merge import merge
from rasterio.transform import from_origin

from common import app_data_dir, build_dir, cfg, gebiet_build_dir, kachel_dateien, origin, raw_dir

CHUNK_M = 250
RES = 1.0
MIN_HOEHE = 1.5
STUFE = 0.25
PUFFER_M = 1.0


def pool_max(a: np.ndarray, k: int) -> np.ndarray:
    """Blockweises Maximum über k×k Zellen (NaN zählt als 0)."""
    a = np.nan_to_num(a, nan=0.0)
    ny, nx = a.shape
    a = a[: ny // k * k, : nx // k * k]
    return a.reshape(ny // k, k, nx // k, k).max(axis=(1, 3))


def main() -> int:
    c = cfg()
    x0, y0, x1, y1 = c["gebiet"]["bbox"]
    nx, ny = int(x1 - x0), int(y1 - y0)

    # Gelände (DGM1, 1 m)
    dgm = [rasterio.open(p) for p in kachel_dateien(raw_dir() / "dgm1", "tif")]
    H, _ = merge(dgm, bounds=(x0, y0, x1, y1), res=RES, nodata=-9999)
    dgm_h = H[0].astype(np.float32)
    dgm_h[dgm_h == -9999] = np.nan

    # Sommer: DOM20 (0,2 m) → 1 m (Maximum je Block) minus Gelände
    dom = [rasterio.open(p) for p in kachel_dateien(raw_dir() / "dom20", "tif")]
    D, _ = merge(dom, bounds=(x0, y0, x1, y1), res=0.2, nodata=-9999)
    d = D[0].astype(np.float32)
    d[d == -9999] = np.nan
    sommer = pool_max(d - np.repeat(np.repeat(np.nan_to_num(dgm_h, nan=0.0), 5, 0), 5, 1)[: d.shape[0], : d.shape[1]], 5)
    # Fehlendes DOM (NaN → 0 durch pool) bleibt 0

    # Winter: Laser-nDSM (0,5 m) → 1 m
    winter = np.zeros((ny, nx), dtype=np.float32)
    for p in kachel_dateien(build_dir() / "laser_ndsm", "tif", (x0, y0, x1, y1)):
        with rasterio.open(p) as r:
            a = pool_max(r.read(1), 2)
            kx, ky = int(r.bounds.left - x0), int(y1 - r.bounds.top)
            h, w = a.shape
            winter[ky: ky + h, kx: kx + w] = np.maximum(winter[ky: ky + h, kx: kx + w], a[: ny - ky, : nx - kx])

    # Gebäude maskieren
    gb = gpd.read_file(gebiet_build_dir() / "buildings.geojson").set_crs(25832, allow_override=True)
    tr = from_origin(x0, y1, RES, RES)
    maske = rasterize([(g.buffer(PUFFER_M), 1) for g in gb.geometry if g is not None and not g.is_empty], out_shape=(ny, nx), transform=tr, fill=0, dtype="uint8").astype(bool)

    def kodiere(h: np.ndarray) -> np.ndarray:
        h = np.where(maske | (h < MIN_HOEHE), 0.0, h)
        return np.clip(np.round(h / STUFE), 0, 255).astype(np.uint8)[::-1]  # Zeile 0 = Süden

    out = app_data_dir() / "oberflaeche"
    n = int(CHUNK_M / RES)
    cols, rows = nx // n, ny // n
    stat = {}
    for name, arr in (("winter", kodiere(winter)), ("sommer", kodiere(sommer))):
        (out / name).mkdir(parents=True, exist_ok=True)
        for cy in range(rows):
            for cx in range(cols):
                blk = arr[cy * n: cy * n + n, cx * n: cx * n + n]
                (out / name / f"{cx}_{cy}.bin").write_bytes(blk.tobytes())
        stat[name] = {"anteil_objekt": round(float((arr > 0).mean()), 4), "max_m": float(arr.max() * STUFE)}

    ox, oy = origin()
    meta = {
        "crs": "EPSG:25832",
        "res": RES,
        "chunk": n,
        "cols": cols,
        "rows": rows,
        "stufe": STUFE,
        "minHoehe": MIN_HOEHE,
        "first": [x0 - ox, y0 - oy],  # Südwestecke des Rasters in lokalen Metern (Zellenecke)
        "winter": {"quelle": "Laserdaten, nDSM (Befliegung 08.03.2025, laubfrei)", "befliegung": "2025-03-08"},
        "sommer": {"quelle": "DOM20 minus DGM1 (Bildflug 16.09.2023, belaubt)", "befliegung": "2023-09-16"},
        "lizenz": "Bayerische Vermessungsverwaltung, CC BY 4.0, selbst berechnet",
        "gebaeude_maske_m": PUFFER_M,
        "statistik": stat,
    }
    (out / "oberflaeche.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print(f"Oberfläche: {cols}×{rows} Kacheln, Winter {stat['winter']}, Sommer {stat['sommer']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
