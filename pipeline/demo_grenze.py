#!/usr/bin/env python3
"""Grenze für eine Demo-Adresse aus der Parzellarkarte ableiten (nur für vorbereitete Demos, Label `Demo`).

Die ALKIS-Flurstücke sind nicht frei. Die Parzellarkarte (CC BY 4.0, Bearbeitung erlaubt) zeigt die Grenzen
aber als Linien. Für einen Punkt im Grundstück wird die Fläche bis zu den Linien gefüllt, vektorisiert und
vereinfacht – dasselbe, was ein Nutzer beim Nachtippen tut, nur genauer. Für echte Nutzer bleibt es beim
Selbst-Setzen (`nutzerbestätigt`).

  python3 demo_grenze.py E N [radius_m]   → lokale Koordinaten (x, y) der Grenzpunkte als JSON
"""
from __future__ import annotations

import io
import json
import sys
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image
from rasterio import features
from rasterio.transform import from_bounds
from scipy import ndimage
from shapely.geometry import shape

from common import origin

WMS = "https://geoservices.bayern.de/od/wms/alkis/v1/parzellarkarte"
PX = 0.1  # 10 cm


def grenze(E: float, N: float, R: float = 45.0, tol: float = 0.4):
    W = int(2 * R / PX)
    bb = (E - R, N - R, E + R, N + R)
    q = urllib.parse.urlencode({"SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetMap", "LAYERS": "by_alkis_parzellarkarte_umr_schwarz",
                                "STYLES": "", "SRS": "EPSG:25832", "BBOX": ",".join(map(str, bb)), "WIDTH": W, "HEIGHT": W,
                                "FORMAT": "image/png", "TRANSPARENT": "true"})
    img = np.array(Image.open(io.BytesIO(urllib.request.urlopen(f"{WMS}?{q}", timeout=120).read())).convert("RGBA"))
    line = img[..., 3] > 8  # dünne, geglättete Schräglinien haben geringe Deckkraft
    line = ndimage.binary_dilation(line, iterations=2)
    free, n = ndimage.label(~line)
    seed = free[W // 2, W // 2]
    if seed == 0:
        raise SystemExit("Startpunkt liegt auf einer Linie – Punkt leicht verschieben")
    parcel = free == seed
    if parcel[0, :].any() or parcel[-1, :].any() or parcel[:, 0].any() or parcel[:, -1].any():
        raise SystemExit("Fläche läuft aus dem Ausschnitt – größeren Radius wählen")
    # Gebäude im Grundstück sind in der Karte eigene, von Linien umschlossene Flächen: dazunehmen,
    # wenn sie an das Grundstück grenzen und ganz in dessen konvexer Hülle liegen
    from shapely.geometry import MultiPoint
    ys, xs = np.nonzero(parcel)
    hull = MultiPoint(np.c_[xs[::50], ys[::50]]).convex_hull
    near = ndimage.binary_dilation(parcel, iterations=6)
    for lab in np.unique(free[near & ~parcel]):
        if lab in (0, seed):
            continue
        comp = free == lab
        if comp.sum() < parcel.sum():
            cy, cx = np.nonzero(comp)
            if all(hull.buffer(5).contains(MultiPoint(np.c_[cx[::40], cy[::40]]).convex_hull) for _ in [0]):
                parcel |= comp
    region = ndimage.binary_closing(ndimage.binary_dilation(parcel, iterations=2), iterations=4)
    tr = from_bounds(*bb, W, W)
    poly = max((shape(g) for g, v in features.shapes(region.astype(np.uint8), mask=region, transform=tr) if v), key=lambda p: p.area)
    poly = poly.simplify(tol)
    ox, oy = origin()
    pts = [[round(x - ox, 2), round(y - oy, 2)] for x, y in list(poly.exterior.coords)[:-1]]
    return pts, round(poly.area, 1)


if __name__ == "__main__":
    E, N = float(sys.argv[1]), float(sys.argv[2])
    pts, a = grenze(E, N, float(sys.argv[3]) if len(sys.argv) > 3 else 45.0)
    print(json.dumps({"flaeche_m2": a, "grenze": pts}))
