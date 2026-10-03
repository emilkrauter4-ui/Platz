#!/usr/bin/env python3
"""Qualitätsmessung für 02_bestand: Präzision und Trefferquote.

  python3 qa_bestand.py kandidaten      # breite Kandidaten (nur Höhenband, Fläche, Form) → data/build/qa_kandidaten.geojson
  python3 qa_bestand.py bogen DATEI.geojson PREFIX [n] [seed]   # Kontaktbögen zum Sichten auf dem DOP20
  python3 qa_bestand.py messen          # Präzision/Trefferquote gegen docs/bestand_referenz.json

Referenz (docs/bestand_referenz.json), von Hand am DOP20 gesichtet:
  "positiv": bekannte Kleinbauten (Schuppen, Gartenhäuser, Carports) ohne Hausumring → Trefferquote
  "praezision": Stichprobe aus der Ausgabe von 02_bestand mit Urteil ja/nein → Präzision
"""
from __future__ import annotations

import importlib.util
import json
import random
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio import features
from rasterio.windows import from_bounds
from scipy import ndimage
from shapely.geometry import Point, mapping, shape

from common import build_dir, cfg, raw_dir

HERE = Path(__file__).resolve().parent
REF = HERE.parent / "docs" / "bestand_referenz.json"


def _bestand_module():
    spec = importlib.util.spec_from_file_location("bestand", HERE / "02_bestand.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


VARIANTEN = {
    # v1 wie im ersten Durchlauf: Ebenheit + Freistand, ohne Laser und ohne Verkehrsmaske
    "v1": {"dach_rauigkeit_max_m": 0.15, "umfeld_boden_anteil_min": 0.5, "laser_bestaetigung_min": None, "verkehr_maskieren": False,
           "gebaeude_puffer_m": 1.0, "rechteckigkeit_min": 0.7, "laser_pixelweise": False},
    # nur DOM20 + Verkehrsmaske, ohne die strengen Filter
    "dom": {"dach_rauigkeit_max_m": None, "umfeld_boden_anteil_min": None, "laser_bestaetigung_min": None, "verkehr_maskieren": True, "laser_pixelweise": False},
    # DOM20 UND Laser-Höhe (ohne Echo-Kriterium), Verkehrsmaske, ohne Ebenheit/Freistand
    "v2h": {"dach_rauigkeit_max_m": None, "umfeld_boden_anteil_min": None, "laser_bestaetigung_min": 0.4, "verkehr_maskieren": True,
            "laser_einzelecho_min": None, "laser_pixelweise": False},
    # v2: DOM20 UND Laser (Höhe + Einzelecho), Verkehrsmaske
    "v2": {"dach_rauigkeit_max_m": None, "umfeld_boden_anteil_min": None, "laser_bestaetigung_min": 0.4, "verkehr_maskieren": True,
           "laser_einzelecho_min": 0.5, "laser_pixelweise": False},
    # v2 mit lockererer Form und kleinerem Gebäudepuffer
    # v3: Laser pixelweise vor der Fleckbildung, lockerere Form
    "v3": {"dach_rauigkeit_max_m": None, "umfeld_boden_anteil_min": None, "laser_bestaetigung_min": 0.4, "verkehr_maskieren": True,
           "laser_einzelecho_min": 0.5, "laser_pixelweise": True, "rechteckigkeit_min": 0.6, "gebaeude_puffer_m": 0.5},
    "v3s": {"dach_rauigkeit_max_m": None, "umfeld_boden_anteil_min": None, "laser_bestaetigung_min": 0.4, "verkehr_maskieren": True,
           "laser_einzelecho_min": 0.5, "laser_pixelweise": True, "rechteckigkeit_min": 0.7, "gebaeude_puffer_m": 1.0},
    # v4: wie v3s, plus Anbau-Filter und strengeres Echo-Kriterium
    "v4": {"dach_rauigkeit_max_m": None, "umfeld_boden_anteil_min": None, "laser_bestaetigung_min": 0.5, "verkehr_maskieren": True,
           "laser_einzelecho_min": 0.6, "laser_pixelweise": True, "rechteckigkeit_min": 0.7, "gebaeude_puffer_m": 1.0,
           "anbau_kontakt_max": 0.25},
    "v4l": {"dach_rauigkeit_max_m": None, "umfeld_boden_anteil_min": None, "laser_bestaetigung_min": 0.5, "verkehr_maskieren": True,
           "laser_einzelecho_min": 0.5, "laser_pixelweise": True, "rechteckigkeit_min": 0.7, "gebaeude_puffer_m": 1.0,
           "anbau_kontakt_max": 0.25},
    "v2b": {"dach_rauigkeit_max_m": None, "umfeld_boden_anteil_min": None, "laser_bestaetigung_min": 0.4, "verkehr_maskieren": True,
            "laser_einzelecho_min": 0.5, "laser_pixelweise": False, "rechteckigkeit_min": 0.6, "gebaeude_puffer_m": 0.5},
}


def varianten(namen) -> None:
    """Varianten von 02_bestand gegen die Referenz rechnen (Ausgabe bestand_<name>.geojson)."""
    b = _bestand_module()
    base = dict(cfg()["bestand"])
    rows = []
    for n in namen:
        cfg()["bestand"].clear()
        cfg()["bestand"].update(base, **VARIANTEN[n])
        b.main(f"bestand_{n}.geojson")
        rows.append((n, messen(f"bestand_{n}.geojson")))
    cfg()["bestand"].clear()
    cfg()["bestand"].update(base)
    for n, r in rows:
        print(f"{n:5} erkannt {r['erkannt_gesamt']:5}  Trefferquote {r['treffer']}/{r['referenz']}")


def kandidaten() -> None:
    """Breiter Kandidatensatz: Höhenband 1,5–5 m, Gebäude maskiert, Fläche 3–80 m², Rechteckigkeit > 0,6."""
    b = _bestand_module()
    c = cfg()["bestand"]
    buildings = gpd.read_file(build_dir() / "buildings.geojson").set_crs(25832, allow_override=True)
    masks = buildings.geometry.buffer(0.5)
    out = []
    for dom_path in sorted((raw_dir() / "dom20").glob("*.tif")):
        with rasterio.open(dom_path) as dom:
            dsm = dom.read(1).astype(np.float32)
            dsm[dsm == dom.nodata] = np.nan
            dgm = b.load_resampled(raw_dir() / "dgm1" / dom_path.name, dom)
            nd = dsm - dgm
            bm = features.rasterize(((g, 1) for g in masks.cx[dom.bounds.left:dom.bounds.right, dom.bounds.bottom:dom.bounds.top]),
                                    out_shape=nd.shape, transform=dom.transform, fill=0, dtype=np.uint8).astype(bool)
            cand = (nd >= 1.5) & (nd <= 5.0) & ~bm & np.isfinite(nd)
            cand = ndimage.binary_opening(cand, structure=np.ones((5, 5)))
            lab, _ = ndimage.label(cand)
            for geom, _v in features.shapes(lab.astype(np.int32), mask=lab > 0, transform=dom.transform):
                p = shape(geom)
                if 3 <= p.area <= 80 and b.rectangularity(p) > 0.6:
                    out.append({"type": "Feature", "geometry": mapping(p.simplify(0.2)), "properties": {"id": f"K{len(out)}", "flaeche": round(p.area, 1)}})
    (build_dir() / "qa_kandidaten.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": out}), encoding="utf-8")
    print(f"Breite Kandidaten: {len(out)}")


def bogen(path: str, prefix: str, n: int = 20, seed: int = 1) -> None:
    """Kontaktbogen 5 × 4: Luftbild 24 m × 24 m um jeden Kandidaten, Umriss rot, ID oben links."""
    fc = json.loads(Path(path).read_text(encoding="utf-8"))["features"]
    random.seed(seed)
    sel = random.sample(fc, min(n, len(fc)))
    srcs = {p.stem: rasterio.open(p) for p in (raw_dir() / "dop20").glob("*.tif")}
    tiles = []
    for f in sel:
        g = shape(f["geometry"])
        cx, cy = g.centroid.x, g.centroid.y
        d = srcs[f"{int(cx // 1000)}_{int(cy // 1000)}"]
        bb = (cx - 12, cy - 12, cx + 12, cy + 12)
        a = d.read(window=from_bounds(*bb, d.transform), boundless=True).transpose(1, 2, 0)
        im = Image.fromarray(a.astype(np.uint8)).resize((240, 240))
        dr = ImageDraw.Draw(im)
        s = 240 / 24
        pts = [((x - bb[0]) * s, (bb[3] - y) * s) for x, y in g.exterior.coords]
        dr.line(pts + [pts[0]], fill=(255, 0, 0), width=2)
        dr.rectangle((0, 0, 120, 14), fill=(0, 0, 0))
        dr.text((3, 2), f["properties"]["id"], fill=(255, 255, 0))
        tiles.append(im)
    sheet = Image.new("RGB", (240 * 5, 240 * ((len(tiles) + 4) // 5)))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 5) * 240, (i // 5) * 240))
    sheet.save(f"{prefix}.jpg", quality=85)
    print(f"{prefix}.jpg: " + " ".join(f["properties"]["id"] for f in sel))


def messen(datei: str = "bestand.geojson") -> dict:
    ref = json.loads(REF.read_text(encoding="utf-8"))
    best = gpd.read_file(build_dir() / datei).set_crs(25832, allow_override=True)
    # Trefferquote: Referenzpunkt liegt in (oder < 1 m an) einem erkannten Objekt
    hits = []
    for r in ref["positiv"]:
        p = Point(r["xy"])
        hits.append(bool((best.geometry.distance(p) < 1.0).any()))
    recall = sum(hits) / len(hits)
    # Präzision: nur gültig für die Ausgabe, aus der die Stichprobe gezogen wurde
    res = {"trefferquote": round(recall, 3), "treffer": sum(hits), "referenz": len(hits),
           "verfehlt": [r["id"] for r, h in zip(ref["positiv"], hits) if not h], "erkannt_gesamt": len(best)}
    print(json.dumps(res, ensure_ascii=False))
    return res


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "messen"
    if cmd == "kandidaten":
        kandidaten()
    elif cmd == "bogen":
        bogen(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 20, int(sys.argv[5]) if len(sys.argv) > 5 else 1)
    elif cmd == "varianten":
        varianten(sys.argv[2:] or list(VARIANTEN))
    else:
        messen(*(sys.argv[2:3]))
