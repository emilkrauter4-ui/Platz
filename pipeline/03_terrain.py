#!/usr/bin/env python3
"""DGM1 → Höhenraster für die App (Ellipsoidhöhen, 1 m, in 250-m-Kacheln).

Die App nutzt dasselbe Raster für zwei Dinge:
  - Geländedarstellung in Cesium (CustomHeightmapTerrainProvider, kein ion)
  - Wandhöhe über Gelände im Regelwerk
Kodierung je Kachel: uint16 little endian, Höhe = base + wert / 100 (cm-genau),
(n+1) × (n+1) Stützpunkte inklusive der gemeinsamen Kante zur Nachbarkachel.
"""
from __future__ import annotations

import json
import sys

import numpy as np
import rasterio
from rasterio.merge import merge

from common import app_data_dir, cfg, origin, raw_dir
from geoid import undulation

CHUNK_M = 250


def main() -> int:
    c = cfg()
    x0, y0, x1, y1 = c["gebiet"]["bbox"]
    res = c["terrain"]["aufloesung_m"]
    srcs = [rasterio.open(p) for p in sorted((raw_dir() / "dgm1").glob("*.tif"))]
    for s in srcs:
        if s.crs.to_epsg() != 25832:
            raise SystemExit(f"{s.name}: unerwartetes CRS {s.crs}")
    mosaic, tr = merge(srcs, bounds=(x0, y0, x1, y1), res=res, nodata=-9999)
    H = mosaic[0].astype(np.float64)
    if (H == -9999).any():
        raise SystemExit("DGM1 hat Lücken im Gebiet")
    # Pixelmitten → Stützpunkte. Raster ist nordorientiert, Zeile 0 = Norden.
    ny, nx = H.shape
    es = x0 + (np.arange(nx) + 0.5) * res
    ns = y1 - (np.arange(ny) + 0.5) * res
    E, N = np.meshgrid(es, ns)
    und = undulation(E.ravel(), N.ravel()).reshape(E.shape)
    h_ell = H + und
    print(f"Undulation GCG2016 im Gebiet: {und.min():.3f} … {und.max():.3f} m")

    out = app_data_dir() / "terrain"
    out.mkdir(parents=True, exist_ok=True)
    base = float(np.floor(h_ell.min()) - 1)
    if (h_ell.max() - base) * 100 > 65535:
        raise SystemExit("Höhenspanne zu groß für uint16-Kodierung")
    n = int(CHUNK_M / res)
    # Stützpunkte nach Süd-Nord-Reihenfolge drehen (Zeile 0 = Süden), einfacher für die App
    grid = h_ell[::-1]
    gy, gx = grid.shape
    cols, rows = gx // n, gy // n
    for cy in range(rows):
        for cx in range(cols):
            blk = grid[cy * n: min(cy * n + n + 1, gy), cx * n: min(cx * n + n + 1, gx)]
            # Rand auffüllen, falls die letzte Kachel keine Nachbarkante hat
            blk = np.pad(blk, ((0, n + 1 - blk.shape[0]), (0, n + 1 - blk.shape[1])), mode="edge")
            enc = np.round((blk - base) * 100).astype("<u2")
            (out / f"{cx}_{cy}.bin").write_bytes(enc.tobytes())

    ox, oy = origin()
    meta = {
        "crs": "EPSG:25832",
        "hoehe": "Ellipsoidhöhe ETRS89 (DHHN2016 + GCG2016)",
        "quelle": "DGM1, Bayerische Vermessungsverwaltung (CC BY 4.0); GCG2016, BKG (CC BY 4.0)",
        "origin": [ox, oy],
        # Stützpunkt (0,0) liegt bei bbox-Südwestecke + halbe Auflösung
        "first": [x0 + res / 2 - ox, y0 + res / 2 - oy],
        "res": res,
        "chunk": n,
        "cols": cols,
        "rows": rows,
        "base": base,
        "scale": 0.01,
        "undulation_mittel": round(float(und.mean()), 3),
    }
    (out / "terrain.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print(f"Terrain: {cols}×{rows} Kacheln à {n} m, Höhen {h_ell.min():.2f} … {h_ell.max():.2f} m (Ellipsoid)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
