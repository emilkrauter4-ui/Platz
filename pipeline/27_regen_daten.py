#!/usr/bin/env python3
"""Daten für die Starkregen-Simulation (AUFTRAG_V4 C3).

1. Flächenarten (1 m, 250-m-Kacheln wie das Geländeraster): 0 durchlässig, 1 versiegelt, 2 Gewässer.
   - ALKIS Tatsächliche Nutzung (amtlich): Straßenverkehr, Weg, Platz, Bahnverkehr → versiegelt; Stehendes/Fließgewässer → Gewässer;
     Unland/Vegetationslose Fläche, Halde, Tagebau → durchlässig (offener Boden).
   - In Siedlungs- und Gewerbeflächen (Wohnen, gemischt, Industrie, besondere Prägung, Sport) entscheidet der NDVI aus dem DOP20-CIR (Bildflug
     16.09.2023): NDVI > Schwelle (config bestand.ndvi_schwelle) → durchlässig, sonst versiegelt. Alles andere (Acker, Wald, Gehölz …) ist durchlässig.
   Gebäude sind hier nicht enthalten (LoD2 stehen als eigene Hindernisse in der App).
2. Starkregenstatistik KOSTRA-DWD-2020 (DWD, CC BY 4.0): Niederschlagshöhe Hn (mm) und Unsicherheit je Dauer und Wiederkehrintervall
   für die 5-km-Zelle der Gebietsmitte → regen/kostra.json.
Mit PASST_GEBIET=<id> für ein Mess-Gebiet. Ausgabe: <app>/data/[gebiete/<id>/]regen/
"""
from __future__ import annotations

import io
import json
import sys
import zipfile
from pathlib import Path
from urllib.request import urlopen

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin

from common import app_data_dir, cfg, kachel_dateien, origin, raw_dir

CHUNK_M = 250
VERSIEGELT = ("Straßenverkehr", "Weg", "Platz", "Bahnverkehr")
WASSER = ("Stehendes Gewässer", "Fließgewässer")
OFFEN = ("Unland/Vegetationslose Fläche", "Halde", "Tagebau, Grube, Steinbruch")
# Nur in diesen Siedlungs-Nutzungen entscheidet der NDVI (Acker nach der Ernte hat im September niedrigen NDVI und bleibt durchlässig)
NDVI_KLASSEN = ("Wohnbaufläche", "Fläche gemischter Nutzung", "Industrie- und Gewerbefläche", "Fläche besonderer funktionaler Prägung",
                "Sport-, Freizeit- und Erholungsfläche")
KOSTRA_URL = "https://opendata.dwd.de/climate_environment/CDC/grids_germany/return_periods/precipitation/KOSTRA/KOSTRA_DWD_2020/asc/StatRR_KOSTRA-DWD-2020_D{d:05d}_ASC.zip"
DAUERN = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 540, 720, 1080, 1440, 2880, 4320]
WIEDERKEHR = [1, 2, 3, 5, 10, 20, 30, 50, 100]


def ndvi_1m(x0: float, y0: float, x1: float, y1: float) -> np.ndarray:
    """NDVI auf 1-m-Raster (Mittel über 5 × 5 Pixel des DOP20-CIR); Bandfolge NIR, Rot, Grün."""
    nx, ny = int(x1 - x0), int(y1 - y0)
    out = np.zeros((ny, nx), dtype=np.float32)
    for p in kachel_dateien(raw_dir() / "dop20cir", "tif", (x0, y0, x1, y1)):
        with rasterio.open(p) as r:
            sh = (int(r.height / 5), int(r.width / 5))
            nir = r.read(1, out_shape=sh, resampling=Resampling.average).astype(np.float32)
            red = r.read(2, out_shape=sh, resampling=Resampling.average).astype(np.float32)
            v = (nir - red) / np.maximum(nir + red, 1.0)
            kx, ky = int(round(r.bounds.left - x0)), int(round(y1 - r.bounds.top))
            h, w = v.shape
            out[ky: ky + h, kx: kx + w] = v[: ny - ky, : nx - kx]
    return out


def flaechen(c) -> dict:
    x0, y0, x1, y1 = c["gebiet"]["bbox"]
    nx, ny = int(x1 - x0), int(y1 - y0)
    ndvi = ndvi_1m(x0, y0, x1, y1)
    tn = gpd.read_file(raw_dir() / "tn" / "data" / "Nutzung.shp", bbox=(x0 - 10, y0 - 10, x1 + 10, y1 + 10))
    if tn.crs and tn.crs.to_epsg() != 25832:
        tn = tn.to_crs(25832)
    tr = from_origin(x0, y1, 1.0, 1.0)
    klasse = np.zeros((ny, nx), dtype=np.uint8)
    geo = [g for g in tn[tn["nutzart"].isin(NDVI_KLASSEN)].geometry if g is not None and not g.is_empty]
    if geo:
        siedlung = rasterize([(g, 1) for g in geo], out_shape=(ny, nx), transform=tr, fill=0, dtype="uint8").astype(bool)
        klasse[siedlung & (ndvi <= c["bestand"]["ndvi_schwelle"])] = 1
    for namen, code in ((OFFEN, 0), (VERSIEGELT, 1), (WASSER, 2)):  # spätere überschreiben frühere
        geo = [g for g in tn[tn["nutzart"].isin(namen)].geometry if g is not None and not g.is_empty]
        if geo:
            m = rasterize([(g, 1) for g in geo], out_shape=(ny, nx), transform=tr, fill=0, dtype="uint8").astype(bool)
            klasse[m] = code
    out = app_data_dir() / "regen" / "flaechen"
    out.mkdir(parents=True, exist_ok=True)
    arr = klasse[::-1]  # Zeile 0 = Süden
    n = CHUNK_M
    cols, rows = nx // n, ny // n
    for cy in range(rows):
        for cx in range(cols):
            (out / f"{cx}_{cy}.bin").write_bytes(arr[cy * n: cy * n + n, cx * n: cx * n + n].tobytes())
    return {"anteil": {k: round(float((klasse == i).mean()), 3) for i, k in enumerate(("durchlaessig", "versiegelt", "gewaesser"))}, "cols": cols, "rows": rows}


def kostra(c) -> dict:
    from pyproj import Transformer

    x0, y0, x1, y1 = c["gebiet"]["bbox"]
    lon, lat = Transformer.from_crs(25832, 4326, always_xy=True).transform((x0 + x1) / 2, (y0 + y1) / 2)
    X, Y = Transformer.from_crs(4326, 3035, always_xy=True).transform(lon, lat)
    cache = Path(raw_dir() / "kostra")
    cache.mkdir(parents=True, exist_ok=True)
    tab: dict = {}
    for d in DAUERN:
        zp = cache / f"D{d:05d}.zip"
        if not zp.exists():
            zp.write_bytes(urlopen(KOSTRA_URL.format(d=d), timeout=60).read())
        with zipfile.ZipFile(zp) as z:
            for T in WIEDERKEHR:
                vals = {}
                for pre in ("Hn", "UC"):
                    nm = f"{pre}_KOSTRA-DWD-2020_D{d:05d}_T{T:03d}.asc"
                    lines = io.TextIOWrapper(z.open(nm), encoding="ascii").read().splitlines()
                    hdr = {l.split()[0].lower(): float(l.split()[1]) for l in lines[:6]}
                    ix = int((X - hdr["xllcorner"]) // hdr["cellsize"])
                    iy = int((Y - hdr["yllcorner"]) // hdr["cellsize"])
                    row = int(hdr["nrows"]) - 1 - iy
                    v = float(lines[6 + row].split()[ix])
                    if v <= -90:
                        raise SystemExit(f"KOSTRA ohne Wert für {lon:.4f}, {lat:.4f}")
                    vals[pre] = v
                tab.setdefault(str(d), {})[str(T)] = {"hn": vals["Hn"], "uc": vals["UC"]}
    return {
        "quelle": "Deutscher Wetterdienst, KOSTRA-DWD-2020, Rasterwerte der Niederschlagshöhen (Hn) und Unsicherheiten (UC)",
        "lizenz": "CC BY 4.0 (DWD Open Data, https://www.dwd.de/DE/service/rechtliche_hinweise/rechtliche_hinweise_node.html)",
        "aenderung": "Zelle (5 km, ETRS89-LAEA) der Gebietsmitte ausgelesen, Werte unverändert übernommen",
        "mitte": [round(lon, 5), round(lat, 5)],
        "einheit": {"hn": "mm", "uc": "% (Unsicherheit als Anteil von Hn)", "dauer": "Minuten", "wiederkehr": "Jahre"},
        "tabelle": tab,
    }


def main() -> int:
    c = cfg()
    out = app_data_dir() / "regen"
    out.mkdir(parents=True, exist_ok=True)
    f = flaechen(c)
    k = kostra(c)
    ox, oy = origin()
    x0, y0, _, _ = c["gebiet"]["bbox"]
    meta = {"res": 1.0, "chunk": CHUNK_M, "cols": f["cols"], "rows": f["rows"], "first": [x0 - ox, y0 - oy],
            "klassen": {"0": "durchlässig (Grün, offener Boden)", "1": "versiegelt (Verkehr, Weg, Platz; NDVI niedrig)", "2": "Gewässer"},
            "ndvi_nur_in": list(NDVI_KLASSEN), "quelle": "ALKIS Tatsächliche Nutzung, DOP20 CIR (NDVI), Bayerische Vermessungsverwaltung (CC BY 4.0), selbst berechnet",
            "ndvi_schwelle": c["bestand"]["ndvi_schwelle"], "bildflug": "2023-09-16", "anteil": f["anteil"]}
    (out / "flaechen.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    (out / "kostra.json").write_text(json.dumps(k, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("Flächen:", f["anteil"], "· KOSTRA 60 min/100 a:", k["tabelle"]["60"]["100"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
