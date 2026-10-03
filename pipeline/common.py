"""Gemeinsame Helfer für die Pipeline-Schritte."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent


@lru_cache
def cfg() -> dict:
    with open(HERE / "config.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _path(key: str) -> Path:
    p = (HERE / cfg()["pfade"][key]).resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def raw_dir() -> Path:
    return _path("raw")


def build_dir() -> Path:
    return _path("build")


def app_data_dir() -> Path:
    return _path("app_public")


def origin() -> tuple[float, float]:
    """Lokaler Ursprung (Mitte der bbox) für die metrischen App-Koordinaten."""
    x0, y0, x1, y1 = cfg()["gebiet"]["bbox"]
    return (x0 + x1) / 2, (y0 + y1) / 2
