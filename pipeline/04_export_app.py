#!/usr/bin/env python3
"""Kompakte JSON-Dateien für die App: Grundrisse und Bestand in lokalen Metern (x = Ost, y = Nord).

Lokale Koordinaten = UTM 32N minus Gebietsmitte (siehe common.origin), auf Zentimeter gerundet.
"""
from __future__ import annotations

import json
import sys

from shapely.geometry import shape
from shapely.geometry.polygon import orient

from common import app_data_dir, build_dir, cfg, origin


def ring(geom, ox, oy):
    g = shape(geom)
    if g.geom_type == "MultiPolygon":
        g = max(g.geoms, key=lambda p: p.area)
    if g.geom_type != "Polygon" or g.is_empty:
        return None
    g = orient(g, 1.0)  # gegen den Uhrzeigersinn
    coords = list(g.exterior.coords)[:-1]
    return [[round(x - ox, 2), round(y - oy, 2)] for x, y in coords]


def main() -> int:
    ox, oy = origin()
    out = app_data_dir()
    b = json.loads((build_dir() / "buildings.geojson").read_text(encoding="utf-8"))
    rows = []
    for f in b["features"]:
        r = ring(f["geometry"], ox, oy)
        if not r:
            continue
        p = f["properties"]
        rows.append({
            "id": p["id"],
            "fp": r,
            "trauf": p.get("traufhoehe_rel"),
            "first": p.get("firsthoehe_rel"),
            "q": p["quelle_grundriss"],
        })
    (out / "buildings.json").write_text(json.dumps({"origin": [ox, oy], "label": "amtlich", "buildings": rows}, separators=(",", ":")), encoding="utf-8")

    best = []
    bp = build_dir() / "bestand.geojson"
    if bp.exists():
        for f in json.loads(bp.read_text(encoding="utf-8"))["features"]:
            r = ring(f["geometry"], ox, oy)
            if r:
                p = f["properties"]
                best.append({"id": p["id"], "fp": r, "h": p["hoehe"], "a": p["flaeche"], "c": p["konfidenz"]})
    (out / "bestand.json").write_text(json.dumps({"origin": [ox, oy], "label": "erkannt", "bestand": best}, separators=(",", ":")), encoding="utf-8")

    x0, y0, x1, y1 = cfg()["gebiet"]["bbox"]
    site = {
        "name": cfg()["gebiet"]["name"],
        "crs": "EPSG:25832",
        "origin": [ox, oy],
        "bbox": [x0 - ox, y0 - oy, x1 - ox, y1 - oy],
        "gemeinde": {
            "name": cfg()["gebiet"]["gemeinde_name"],
            "ags": cfg()["gebiet"]["gemeinde_ags"],
            "bauleitplanung_url": cfg()["gebiet"].get("bauleitplanung_url"),
            "quelle": "Bauleitplanungsportal Bayern (geoportal.bayern.de/bauleitplanungsportal)",
        },
        "demos": cfg().get("demos", []),
    }
    (out / "site.json").write_text(json.dumps(site, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"App-Daten: {len(rows)} Gebäude, {len(best)} Bestand")
    return 0


if __name__ == "__main__":
    sys.exit(main())
