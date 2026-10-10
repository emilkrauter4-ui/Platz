"""Gemeinsame Helfer für die Pipeline-Schritte."""
from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent


@lru_cache
def _roh_cfg() -> dict:
    with open(HERE / "config.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def gebiet_id() -> str | None:
    """Kennung des gewählten Mess-Gebiets (Umgebungsvariable PASST_GEBIET) oder None für das Demo-Gebiet."""
    g = (os.environ.get("PASST_GEBIET") or "").strip()
    if g and g not in _roh_cfg().get("gebiete", {}):
        raise SystemExit(f"PASST_GEBIET={g!r}: unbekannt (config.yaml → gebiete: {', '.join(_roh_cfg().get('gebiete', {}))})")
    return g or None


@lru_cache
def cfg() -> dict:
    """Konfiguration. Mit PASST_GEBIET=<id> ersetzt das Mess-Gebiet den Block `gebiet` (und die Demo-Adressen entfallen)."""
    c = dict(_roh_cfg())
    g = gebiet_id()
    if g:
        c["gebiet"] = {**c["gebiet"], **{k: v for k, v in c["gebiete"][g].items()}}
        c["demos"] = []
        c["gebiet_id"] = g
    return c


def alle_bboxen() -> list[list[float]]:
    """Begrenzungen aller Gebiete (Demo-Gebiet und Mess-Gebiete): für Dienste, die gebietsübergreifend arbeiten."""
    r = _roh_cfg()
    return [r["gebiet"]["bbox"]] + [g["bbox"] for g in r.get("gebiete", {}).values()]


def kachel_dateien(ordner: Path, suffix: str, bbox=None) -> list[Path]:
    """Dateien `<xkm>_<ykm>.<suffix>` in `ordner`, deren 1-km-Kachel das Gebiet berührt (Rohdaten liegen gemeinsam).
    `bbox`: (x0, y0, x1, y1) oder None = Gebiet der Konfiguration. Zwei-km-Kacheln (LoD2, Name = Südwestecke) werden
    über `schritt_km` nicht unterschieden – der Aufrufer filtert dort selbst."""
    x0, y0, x1, y1 = bbox or cfg()["gebiet"]["bbox"]
    out = []
    for p in sorted(ordner.glob(f"*.{suffix}")):
        m = re.fullmatch(r"(?:32)?(\d{3})_(\d{4})(?:_20_DOM)?", p.stem)
        if not m:
            continue
        kx, ky = int(m.group(1)) * 1000, int(m.group(2)) * 1000
        if kx < x1 and kx + 1000 > x0 and ky < y1 and ky + 1000 > y0:
            out.append(p)
    return out


def _path(key: str) -> Path:
    p = (HERE / cfg()["pfade"][key]).resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def raw_dir() -> Path:
    return _path("raw")


def build_dir() -> Path:
    """Gemeinsame Zwischenprodukte (Modelle, Laserzellen, Embeddings, Daten des Demo-Gebiets)."""
    return _path("build")


def gebiet_build_dir() -> Path:
    """Zwischenprodukte des gewählten Gebiets: im Demo-Gebiet wie build_dir(), sonst data/build/gebiete/<id>."""
    g = gebiet_id()
    if not g:
        return build_dir()
    d = build_dir() / "gebiete" / g
    d.mkdir(parents=True, exist_ok=True)
    return d


def app_data_dir() -> Path:
    """Daten für die App: Demo-Gebiet app/public/data, Mess-Gebiet app/public/data/gebiete/<id>."""
    g = gebiet_id()
    d = _path("app_public")
    if not g:
        return d
    d = d / "gebiete" / g
    d.mkdir(parents=True, exist_ok=True)
    return d


def origin() -> tuple[float, float]:
    """Lokaler Ursprung (Mitte der bbox) für die metrischen App-Koordinaten."""
    x0, y0, x1, y1 = cfg()["gebiet"]["bbox"]
    return (x0 + x1) / 2, (y0 + y1) / 2
