"""Gemeinsamer Lesezugriff auf die Rohdaten für Ausschnitte (Grundstücke), unabhängig von den 1-km-Kacheln.

  raster(name, bounds, res)   → Array (Bänder, Zeilen, Spalten) aus DOP20, DOP20 CIR, DOM20, DGM1 oder Laser-nDSM
  laser(bounds)                → Laserpunkte im Ausschnitt (aus vorab zerlegten 100-m-Zellen, siehe zellen_bauen)

Alle Koordinaten in EPSG:25832, Höhen DHHN2016 (wie die Rohdaten).
"""
from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path

import laspy
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject

from common import build_dir, kachel_dateien, raw_dir

QUELLEN = {
    "dop20": ("raw", "dop20"),
    "cir": ("raw", "dop20cir"),
    "dom20": ("raw", "dom20"),
    "dgm1": ("raw", "dgm1"),
    "laser_ndsm": ("build", "laser_ndsm"),
}
ZELLE = 100  # m


def _dateien(name: str) -> list[Path]:
    wo, ordner = QUELLEN[name]
    base = raw_dir() if wo == "raw" else build_dir()
    return sorted((base / ordner).glob("*.tif"))


def raster(name: str, bounds, res: float = 0.2, resampling=Resampling.bilinear) -> np.ndarray:
    """Ausschnitt `bounds` (x0, y0, x1, y1) auf ein Gitter mit Zellgröße `res` bringen (über Kachelgrenzen hinweg)."""
    x0, y0, x1, y1 = bounds
    w, h = int(round((x1 - x0) / res)), int(round((y1 - y0) / res))
    tr = from_origin(x0, y1, res, res)
    out = None
    for p in _dateien(name):
        with rasterio.open(p) as src:
            b = src.bounds
            if b.right <= x0 or b.left >= x1 or b.top <= y0 or b.bottom >= y1:
                continue
            if out is None:
                out = np.full((src.count, h, w), np.nan, np.float32)
            for i in range(src.count):
                dst = np.full((h, w), np.nan, np.float32)
                reproject(rasterio.band(src, i + 1), dst, src_transform=src.transform, src_crs=src.crs,
                          src_nodata=src.nodata, dst_transform=tr, dst_crs=src.crs, dst_nodata=np.nan,
                          resampling=resampling)
                ok = np.isfinite(dst)
                out[i][ok] = dst[ok]
    if out is None:
        raise ValueError(f"{name}: keine Daten für {bounds}")
    return out


def _zellen_dir() -> Path:
    d = build_dir() / "laser_zellen"
    d.mkdir(exist_ok=True)
    return d


def zellen_bauen() -> None:
    """LAZ-Kacheln des gewählten Gebiets (PASST_GEBIET) einmalig in 100-m-Zellen zerlegen (npz), damit Ausschnitte
    schnell lesbar sind. Die Zellen liegen gemeinsam für alle Gebiete (Name = absolute Zellkoordinaten)."""
    for p in kachel_dateien(raw_dir() / "laser", "laz"):
        xk, yk = (int(v) for v in p.stem.split("_"))
        teile: dict[tuple[int, int], list] = {}
        with laspy.open(p) as f:
            for pts in f.chunk_iterator(4_000_000):
                x, y = np.asarray(pts.x), np.asarray(pts.y)
                cx, cy = (x // ZELLE).astype(int), (y // ZELLE).astype(int)
                key = cx * 100000 + cy
                rec = {
                    "x": x.astype(np.float64), "y": y.astype(np.float64), "z": np.asarray(pts.z).astype(np.float32),
                    "klasse": np.asarray(pts.classification).astype(np.uint8),
                    "echo_nr": np.asarray(pts.return_number).astype(np.uint8),
                    "echos": np.asarray(pts.number_of_returns).astype(np.uint8),
                    "intensitaet": np.asarray(pts.intensity).astype(np.uint16),
                }
                for k in np.unique(key):
                    m = key == k
                    teile.setdefault((int(k // 100000), int(k % 100000)), []).append({a: v[m] for a, v in rec.items()})
        for (cx, cy), lst in teile.items():
            d = {a: np.concatenate([t[a] for t in lst]) for a in lst[0]}
            np.savez(_zellen_dir() / f"{cx}_{cy}.npz", **d)
        print(f"  {p.name}: {len(teile)} Zellen")


@lru_cache(maxsize=512)  # 512 Zellen à 100 m ≈ 5 km²; der Tipp-Dienst hält so seine Kacheln im Speicher
def _zelle(cx: int, cy: int):
    p = _zellen_dir() / f"{cx}_{cy}.npz"
    if not p.exists():
        return None
    return dict(np.load(p))


def laser(bounds) -> dict[str, np.ndarray]:
    """Alle Laserpunkte im Rechteck `bounds` (Felder x, y, z, klasse, echo_nr, echos, intensitaet)."""
    x0, y0, x1, y1 = bounds
    teile = []
    for cx in range(int(x0 // ZELLE), int(x1 // ZELLE) + 1):
        for cy in range(int(y0 // ZELLE), int(y1 // ZELLE) + 1):
            z = _zelle(cx, cy)
            if z is None:
                continue
            m = (z["x"] >= x0) & (z["x"] < x1) & (z["y"] >= y0) & (z["y"] < y1)
            teile.append({a: v[m] for a, v in z.items()})
    if not teile:
        raise ValueError(f"keine Laserpunkte für {bounds} – zuerst `python3 rohdaten.py zellen`")
    return {a: np.concatenate([t[a] for t in teile]) for a in teile[0]}


if __name__ == "__main__":
    if sys.argv[1:] == ["zellen"]:
        zellen_bauen()
