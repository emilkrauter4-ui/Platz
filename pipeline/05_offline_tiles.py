#!/usr/bin/env python3
"""Bildkacheln für die Offline-Demo (Kachel 698_5486): Luftbild DOP20 und Parzellarkarte.

Kachelschema = Cesium GeographicTilingScheme (EPSG:4326, Ebene 0 = 2 × 1 Kacheln, y von Norden),
256 × 256 Pixel, Pfad {layer}/{z}/{x}/{y}.{jpg|png}.

- DOP20: aus den heruntergeladenen GeoTIFFs (CC BY 4.0, Umprojektion ist erlaubt), JPEG.
- Parzellarkarte: einmalig über den amtlichen WMS (CC BY 4.0) in Blöcken abgerufen und zerteilt, PNG.
Online nutzt die App weiter die WMS-Dienste direkt; diese Kacheln braucht nur der Offline-Modus.
"""
from __future__ import annotations

import io
import json
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.merge import merge
from rasterio.transform import from_bounds
from rasterio.warp import reproject

from common import app_data_dir, cfg, gebiet_id, raw_dir
from geoid import to_geographic3d

TILE = 256
DOP_LEVELS = range(12, 19)   # 0,19 m/px in Ebene 18 ≈ Auflösung DOP20
PARZ_LEVELS = range(13, 19)  # Cesium erlaubt höchstens 4 Kacheln auf der niedrigsten Ebene
PARZ_WMS = "https://geoservices.bayern.de/od/wms/alkis/v1/parzellarkarte"
PARZ_LAYER = "by_alkis_parzellarkarte_umr_gelb"


def tile_deg(z: int) -> float:
    return 180.0 / (1 << z)


def tiles_for(rect, z):
    w, s, e, n = rect
    d = tile_deg(z)
    x0, x1 = int((w + 180) // d), int((e + 180) // d)
    y0, y1 = int((90 - n) // d), int((90 - s) // d)
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def tile_bounds(x, y, z):
    d = tile_deg(z)
    w = -180 + x * d
    n = 90 - y * d
    return w, n - d, w + d, n


def area_rect():
    x0, y0, x1, y1 = cfg()["gebiet"]["bbox"]
    t = to_geographic3d()
    lons, lats, _ = t.transform([x0, x1, x0, x1], [y0, y0, y1, y1], [0, 0, 0, 0])
    return min(lons), min(lats), max(lons), max(lats)


def dop_tiles(out, rect):
    srcs = [rasterio.open(p) for p in sorted((raw_dir() / "dop20").glob("*.tif"))]
    mosaic, tr = merge(srcs)
    crs = srcs[0].crs
    n = 0
    for z in DOP_LEVELS:
        for x, y in tiles_for(rect, z):
            w, s, e, nn = tile_bounds(x, y, z)
            dst = np.zeros((3, TILE, TILE), np.uint8)
            reproject(mosaic, dst, src_transform=tr, src_crs=crs, dst_transform=from_bounds(w, s, e, nn, TILE, TILE),
                      dst_crs="EPSG:4326", resampling=Resampling.bilinear if z >= 17 else Resampling.average, src_nodata=0, dst_nodata=0)
            p = out / "dop" / str(z) / str(x)
            p.mkdir(parents=True, exist_ok=True)
            Image.fromarray(dst.transpose(1, 2, 0)).save(p / f"{y}.jpg", quality=78, optimize=True)
            n += 1
        print(f"  DOP Ebene {z}: fertig ({n} Kacheln bisher)")
    return n


def parz_tiles(out, rect):
    n = 0
    for z in PARZ_LEVELS:
        ts = tiles_for(rect, z)
        xs = sorted({x for x, _ in ts})
        ys = sorted({y for _, y in ts})
        B = 8  # Block aus 8 × 8 Kacheln = 2048 px
        for bx in range(xs[0], xs[-1] + 1, B):
            for by in range(ys[0], ys[-1] + 1, B):
                bx1, by1 = min(bx + B - 1, xs[-1]), min(by + B - 1, ys[-1])
                w, _, _, nn = tile_bounds(bx, by, z)
                _, s, e, _ = tile_bounds(bx1, by1, z)
                W, H = (bx1 - bx + 1) * TILE, (by1 - by + 1) * TILE
                q = urllib.parse.urlencode({
                    "SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetMap", "LAYERS": PARZ_LAYER, "STYLES": "",
                    "SRS": "EPSG:4326", "BBOX": f"{w},{s},{e},{nn}", "WIDTH": W, "HEIGHT": H,
                    "FORMAT": "image/png", "TRANSPARENT": "true",
                })
                with urllib.request.urlopen(f"{PARZ_WMS}?{q}", timeout=120) as r:
                    img = Image.open(io.BytesIO(r.read())).convert("RGBA")
                for x in range(bx, bx1 + 1):
                    for y in range(by, by1 + 1):
                        ox, oy = (x - bx) * TILE, (y - by) * TILE
                        p = out / "parzellar" / str(z) / str(x)
                        p.mkdir(parents=True, exist_ok=True)
                        img.crop((ox, oy, ox + TILE, oy + TILE)).save(p / f"{y}.png", optimize=True)
                        n += 1
                time.sleep(0.3)  # Dienst schonen
        print(f"  Parzellarkarte Ebene {z}: fertig ({n} Kacheln bisher)")
    return n


def main() -> int:
    if gebiet_id():
        raise SystemExit("Offline-Kacheln gibt es nur für das Demo-Gebiet (Mess-Adressen sind nur online nutzbar).")
    out = app_data_dir()
    rect = area_rect()
    print("Gebiet (Grad):", [round(v, 5) for v in rect])
    n_dop = dop_tiles(out, rect)
    n_parz = parz_tiles(out, rect)
    meta = {
        "rect": [round(v, 6) for v in rect],
        "dop": {"minLevel": DOP_LEVELS.start, "maxLevel": DOP_LEVELS.stop - 1, "ext": "jpg", "kacheln": n_dop},
        "parzellar": {"minLevel": PARZ_LEVELS.start, "maxLevel": PARZ_LEVELS.stop - 1, "ext": "png", "kacheln": n_parz},
        "quelle": "Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (CC BY 4.0)",
    }
    (out / "offline.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Offline-Kacheln: {n_dop} Luftbild, {n_parz} Flurkarte")
    return 0


if __name__ == "__main__":
    sys.exit(main())
