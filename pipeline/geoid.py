"""Normalhöhe (DHHN2016) → Ellipsoidhöhe (ETRS89/GRS80) über das BKG-Quasigeoid GCG2016.

Das PROJ-Grid de_bkg_gcg2016.tif (CC BY 4.0, © BKG) wird nach data/raw/proj geladen.
Fällt das Grid aus, bricht die Pipeline ab, statt still eine Konstante zu verwenden:
ohne Umrechnung schweben oder versinken alle Objekte in Cesium.
"""
from __future__ import annotations

import urllib.request
from functools import lru_cache

import numpy as np
import pyproj

from common import cfg, raw_dir

CDN = "https://cdn.proj.org/"


@lru_cache
def _grid_dir() -> str:
    d = raw_dir() / "proj"
    d.mkdir(parents=True, exist_ok=True)
    name = cfg()["hoehen"]["geoid_grid"]
    if not (d / name).exists():
        print(f"  lade Geoid-Grid {name}")
        urllib.request.urlretrieve(CDN + name, d / name)
    pyproj.datadir.append_data_dir(str(d))
    return str(d)


@lru_cache
def to_geographic3d() -> pyproj.Transformer:
    """UTM32 + DHHN2016 → ETRS89 geographisch 3D (lon, lat, Ellipsoidhöhe)."""
    _grid_dir()
    t = pyproj.Transformer.from_crs("EPSG:25832+7837", "EPSG:4937", always_xy=True)
    # Probe: das Grid muss wirklich benutzt werden (Undulation in Bayern ~45–48 m)
    _, _, h = t.transform(699000.0, 5487000.0, 0.0)
    if not 40 < h < 55:
        raise SystemExit(f"Geoid-Grid wird nicht verwendet (N = {h:.2f} m). PROJ-Konfiguration prüfen.")
    return t


@lru_cache
def to_ecef() -> pyproj.Transformer:
    """ETRS89 geographisch 3D → geozentrisch (Cesium nutzt WGS84; ETRS89 ≈ WGS84 im Rahmen der Darstellung)."""
    return pyproj.Transformer.from_crs("EPSG:4937", "EPSG:4978", always_xy=True)


def undulation(e: np.ndarray, n: np.ndarray) -> np.ndarray:
    _, _, h = to_geographic3d().transform(e, n, np.zeros_like(e, dtype=float))
    return np.asarray(h)


def utm_nh_to_ecef(e, n, H):
    lon, lat, h = to_geographic3d().transform(e, n, H)
    return to_ecef().transform(lon, lat, h)
