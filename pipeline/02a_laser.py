#!/usr/bin/env python3
"""Laserpunkte (LAZ) → normalisiertes Oberflächenmodell der zweiten Epoche (0,5 m).

Bayerische Laserdaten: ETRS89/UTM32, Höhen DHHN2016 (Kontrolle: Bodenpunkte minus DGM1, Median ≈ 0),
Klassen 2 = Boden, 6 = Gebäude, 20 = sonstige Punkte über Boden, 7 = Rauschen.
Ausgabe je 1-km-Kachel: data/build/laser_ndsm/{x}_{y}.tif (float32)
  Band 1: Höhe über DGM1 (höchster Nicht-Boden-Punkt; Zellen nur mit Boden = 0, ohne Punkte = NaN)
  Band 2: Anteil der Nicht-Boden-Punkte mit genau einem Echo pro Puls. Dächer reflektieren einmal,
          Vegetation (laubfrei, März 2025) liefert Mehrfachechos → trennt Schuppen von Sträuchern.
"""
from __future__ import annotations

import datetime
import json
import sys

import laspy
import numpy as np
import rasterio
from rasterio.transform import from_origin

from common import build_dir, raw_dir

RES = 0.5
SIZE = int(1000 / RES)
NOT_SURFACE = {2, 7, 18}  # Boden, Rauschen, hohes Rauschen


def rasterize(path, x0, y0):
    top = np.full((SIZE, SIZE), -np.inf, np.float32)
    ground_hit = np.zeros((SIZE, SIZE), bool)
    n_ng = np.zeros((SIZE, SIZE), np.int32)
    n_single = np.zeros((SIZE, SIZE), np.int32)
    times = []
    with laspy.open(path) as f:
        for pts in f.chunk_iterator(4_000_000):
            x, y, z = np.asarray(pts.x), np.asarray(pts.y), np.asarray(pts.z).astype(np.float32)
            c = np.asarray(pts.classification)
            col = ((x - x0) / RES).astype(np.int64)
            row = ((y0 + 1000 - y) / RES).astype(np.int64)
            ok = (col >= 0) & (col < SIZE) & (row >= 0) & (row < SIZE)
            surf = ok & ~np.isin(c, list(NOT_SURFACE))
            np.maximum.at(top, (row[surf], col[surf]), z[surf])
            np.add.at(n_ng, (row[surf], col[surf]), 1)
            single = surf & (np.asarray(pts.number_of_returns) == 1)
            np.add.at(n_single, (row[single], col[single]), 1)
            g = ok & (c == 2)
            ground_hit[row[g], col[g]] = True
            times.append(float(np.median(np.asarray(pts.gps_time))))
    ratio = np.where(n_ng > 0, n_single / np.maximum(n_ng, 1), np.nan).astype(np.float32)
    return top, ground_hit, ratio, float(np.median(times))


def main() -> int:
    out = build_dir() / "laser_ndsm"
    out.mkdir(exist_ok=True)
    meta = {}
    for p in sorted((raw_dir() / "laser").glob("*.laz")):
        xk, yk = (int(v) for v in p.stem.split("_"))
        x0, y0 = xk * 1000, yk * 1000
        dst = out / f"{xk}_{yk}.tif"
        print(f"Kachel {p.name}")
        top, ground_hit, ratio, t = rasterize(p, x0, y0)
        with rasterio.open(raw_dir() / "dgm1" / f"{xk}_{yk}.tif") as d:
            # DGM1 (1 m) auf 0,5 m: jede Zelle bekommt den Wert der 1-m-Zelle (für ein Band 1,8–4,5 m genau genug)
            dgm = np.repeat(np.repeat(d.read(1), 2, axis=0), 2, axis=1).astype(np.float32)
        nd = top - dgm
        nd[~np.isfinite(top)] = np.where(ground_hit, 0.0, np.nan)[~np.isfinite(top)]
        with rasterio.open(dst, "w", driver="GTiff", width=SIZE, height=SIZE, count=2, dtype="float32", crs="EPSG:25832",
                           transform=from_origin(x0, y0 + 1000, RES, RES), nodata=np.nan, compress="deflate", tiled=True) as o:
            o.write(nd, 1)
            o.write(ratio, 2)
        date = (datetime.datetime(1980, 1, 6) + datetime.timedelta(seconds=t + 1e9)).date().isoformat()
        meta[p.stem] = {"befliegung": date, "abdeckung": round(float(np.isfinite(nd).mean()), 3)}
        print(f"  Befliegung {date}, Abdeckung {meta[p.stem]['abdeckung']:.1%}")
    (out / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
