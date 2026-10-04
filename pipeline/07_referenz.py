#!/usr/bin/env python3
"""Referenzdatensatz für die Garten-Erkennung (AUFTRAG_V2, Phase 1.1).

  python3 07_referenz.py auswahl          60 Grundstücke wählen (Altstadt / Siedlung / Hang), Grenzen aus der Parzellarkarte
  python3 07_referenz.py bogen ID [...]   Annotationsbogen (DOP20, CIR, Laser, Raster in Metern) nach data/reference/boegen
  python3 07_referenz.py bauen [ID ...]   Annotationen (data/reference/annotationen/ID.json) → Umrisse → referenz.geojson
  python3 07_referenz.py kontrolle ID     Kontrollbild der fertigen Umrisse
  python3 07_referenz.py einfrieren       Test-Set einfrieren (Prüfsumme in split.json)

Grundstücke: Kachel 698_5486 im Sinn des MVP-Gebiets (LoD2-Kachel, 2 × 2 km).
Grenzen: wie demo_grenze.py aus der Parzellarkarte (CC BY 4.0), nur als Rahmen für die Annotation, nicht amtlich.
"""
from __future__ import annotations

import hashlib
from functools import lru_cache
import json
import random
import sys
import time

import geopandas as gpd
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Point, Polygon, mapping, shape
from shapely.strtree import STRtree

from common import build_dir, origin
from rohdaten import laser, raster

REF = build_dir().parent / "reference"
SEED = 20261003
ZONEN = ("Altstadt", "Siedlung", "Hang")
JE_ZONE = 20
TEST_JE_ZONE = {"Altstadt": 6, "Siedlung": 7, "Hang": 7}  # 20 Test, 40 Entwicklung (AUFTRAG_V2 1.1)
DICHTE_ALTSTADT = 0.35
DICHTE_ALTSTADT_RAND = 0.30  # dritter Durchgang, nur zum Auffüllen der Altstadt (Kernrand)   # Gebäudeanteil im 60-m-Kreis (oberste ~7 % der Wohnhäuser im Gebiet)
GEFAELLE_HANG = 0.08     # Geländeneigung über dem Grundstück (Ausgleichsebene aus DGM1)

KLASSEN = ["gartenhaus", "gewaechshaus", "carport_garage", "pool", "teich", "terrasse", "trampolin",
           "spielturm", "hecke", "baum", "strauch", "waermepumpe", "zaun_mauer"]


def _hausliste():
    b = gpd.read_file(build_dir() / "buildings.geojson").to_crs(25832)
    tree = STRtree(b.geometry.values)
    f = b.funktion.fillna("")
    erst = f.str.startswith("31001_1") & b.area.between(60, 300)
    # zweiter Durchgang nur Altstadt: auch Wohn- und Geschäftshäuser (31001_2xxx), 40–800 m²
    zweit = ~erst & (f.str.startswith("31001_1") | f.str.startswith("31001_2")) & b.area.between(40, 800)
    w = b[erst | zweit].copy()
    w["durchgang"] = np.where(erst[erst | zweit], 1, 2)
    dichte = []
    for g in w.geometry.values:
        c = g.centroid.buffer(60)
        dichte.append(sum(b.geometry.values[i].intersection(c).area for i in tree.query(c)) / c.area)
    w["dichte"] = dichte
    return b, w


def _gefaelle(poly: Polygon) -> float:
    x0, y0, x1, y1 = poly.bounds
    z = raster("dgm1", (x0, y0, x1, y1), 1.0)[0]
    yy, xx = np.mgrid[0:z.shape[0], 0:z.shape[1]]
    ok = np.isfinite(z)
    A = np.c_[xx[ok], yy[ok], np.ones(ok.sum())]
    (a, b, _), *_ = np.linalg.lstsq(A, z[ok], rcond=None)
    return float(np.hypot(a, b))


def _grenze_cache(grenze, E, N):
    """Parzellarkarten-Abfrage mit Wiederholung und Datei-Cache (der Dienst bricht gelegentlich ab)."""
    cp = build_dir() / "referenz_grenzen_cache.json"
    cache = json.loads(cp.read_text()) if cp.exists() else {}
    key = f"{E:.2f},{N:.2f}"
    if key not in cache:
        for versuch in range(4):
            try:
                pts, fl = grenze(E, N, 45.0)
                cache[key] = [pts, fl]
                break
            except SystemExit as e:
                cache[key] = str(e)
                break
            except Exception as e:  # Netzfehler
                print(f"    Netzfehler ({e.__class__.__name__}), Versuch {versuch + 1}", flush=True)
                time.sleep(2 ** (versuch + 1))
        else:
            raise SystemExit("Parzellarkarte nicht erreichbar")
        cp.write_text(json.dumps(cache))
        time.sleep(0.3)
    if isinstance(cache[key], str):
        raise SystemExit(cache[key])
    return cache[key]


def auswahl() -> int:
    from demo_grenze import grenze
    REF.mkdir(parents=True, exist_ok=True)
    b, w = _hausliste()
    tree = STRtree(b.geometry.values)
    ox, oy = origin()
    rnd = random.Random(SEED)
    order = list(w.index[w.durchgang == 1])
    rnd.shuffle(order)
    zweit = list(w.index[(w.durchgang == 2) & (w.dichte >= DICHTE_ALTSTADT)])
    rnd.shuffle(zweit)
    order += zweit
    # dritter Durchgang (nur falls die Altstadt noch nicht voll ist): Altstadtrand, Dichte 30–35 %
    dritt = list(w.index[(w.dichte >= DICHTE_ALTSTADT_RAND) & (w.dichte < DICHTE_ALTSTADT)])
    rnd.shuffle(dritt)
    order += [("rand", i) for i in dritt]
    gewaehlt: dict[str, list] = {z: [] for z in ZONEN}
    mittelpunkte: list[Point] = []
    for i in order:
        if all(len(v) >= JE_ZONE for v in gewaehlt.values()):
            break
        rand = isinstance(i, tuple)
        i = i[1] if rand else i
        haus = w.geometry[i]
        c = haus.centroid
        dichte_zone = "Altstadt" if (rand or w.dichte[i] >= DICHTE_ALTSTADT) else None
        if any(c.distance(m) < (40 if (rand or w.durchgang[i] == 2) else 70) for m in mittelpunkte):
            continue
        if dichte_zone and len(gewaehlt["Altstadt"]) >= JE_ZONE:
            continue
        if not dichte_zone and len(gewaehlt["Hang"]) >= JE_ZONE and len(gewaehlt["Siedlung"]) >= JE_ZONE:
            continue
        min_m2 = 100 if dichte_zone else 200  # Altstadt: Hinterhöfe sind kleiner
        # Startpunkt im Garten: 3 m vor der Hauswand, acht Richtungen probieren
        poly = None
        starts = [haus.buffer(d).exterior.interpolate(t, normalized=True)
                  for d in ((3,) if (w.durchgang[i] == 1 and not rand) else (3, 6)) for t in np.linspace(0, 1, 8, endpoint=False)]
        for p in starts:
            if poly is not None:
                break
            if any(b.geometry.values[k].contains(p) for k in tree.query(p)):
                continue
            try:
                pts, fl = _grenze_cache(grenze, p.x, p.y)
            except SystemExit:
                continue
            cand = Polygon([(x + ox, y + oy) for x, y in pts])
            if cand.is_valid and min_m2 <= fl <= 2500 and cand.buffer(0.5).contains(haus.representative_point()):
                poly = cand
        if poly is None:
            continue
        if any(poly.intersection(o["geometry"]).area > 0.1 * poly.area for v in gewaehlt.values() for o in v):
            continue  # dasselbe Grundstück über ein anderes Haus
        x0, y0, x1, y1 = poly.bounds
        if not (698000 + 5 < x0 and x1 < 700000 - 5 and 5486000 + 5 < y0 and y1 < 5488000 - 5):
            continue
        zone = dichte_zone or ("Hang" if _gefaelle(poly) >= GEFAELLE_HANG else "Siedlung")
        if len(gewaehlt[zone]) >= JE_ZONE:
            continue
        gewaehlt[zone].append({"haus_id": w.id[i], "dichte": round(float(w.dichte[i]), 3), "rand": rand,
                               "gefaelle": round(_gefaelle(poly), 3), "geometry": poly})
        mittelpunkte.append(c)
        print(f"  {zone:9s} {len(gewaehlt[zone]):2d}  {w.id[i]}  {poly.area:6.0f} m²", flush=True)
    feats = []
    for z in ZONEN:
        for k, g in enumerate(gewaehlt[z]):
            pid = f"{z[0]}{k + 1:02d}"
            feats.append({"type": "Feature", "geometry": mapping(g["geometry"]),
                          "properties": {"id": pid, "zone": z, "split": None,
                                         "haus_id": g["haus_id"], "dichte": g["dichte"], "gefaelle": g["gefaelle"],
                                         "altstadtrand": g.get("rand", False),
                                         "flaeche_m2": round(g["geometry"].area, 1),
                                         "grenze_quelle": "Parzellarkarte (vektorisiert), nicht amtlich"}})
    _teilen(feats)
    fc = {"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "EPSG:25832"}}, "features": feats}
    (REF / "grundstuecke.geojson").write_text(json.dumps(fc, ensure_ascii=False, indent=1))
    print({z: len(v) for z, v in gewaehlt.items()})
    return 0


def _teilen(feats) -> None:
    """Split je Zone mit eigenem Seed: 1/3 test, Rest dev. Unabhängig von der Anzahl in anderen Zonen."""
    for zi, z in enumerate(ZONEN):
        ids = sorted(f["properties"]["id"] for f in feats if f["properties"]["zone"] == z)
        test = set(random.Random(SEED + 100 + zi).sample(ids, k=TEST_JE_ZONE[z]))
        for f in feats:
            if f["properties"]["zone"] == z:
                f["properties"]["split"] = "test" if f["properties"]["id"] in test else "dev"


def teilen() -> int:
    p = REF / "grundstuecke.geojson"
    fc = json.loads(p.read_text())
    _teilen(fc["features"])
    p.write_text(json.dumps(fc, ensure_ascii=False, indent=1))
    from collections import Counter
    print(Counter((f["properties"]["zone"], f["properties"]["split"]) for f in fc["features"]))
    return 0


def grundstuecke() -> dict[str, dict]:
    fc = json.loads((REF / "grundstuecke.geojson").read_text())
    return {f["properties"]["id"]: {**f["properties"], "geom": shape(f["geometry"])} for f in fc["features"]}


# ---------------------------------------------------------------- Bögen

def _font(size=14):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default()


def _rahmen(g: Polygon, rand=6.0):
    x0, y0, x1, y1 = g.bounds
    x0, y0 = np.floor((x0 - rand) / 5) * 5, np.floor((y0 - rand) / 5) * 5
    x1, y1 = np.ceil((x1 + rand) / 5) * 5, np.ceil((y1 + rand) / 5) * 5
    return x0, y0, x1, y1


def _bild(rgb: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(np.nan_to_num(rgb), 0, 255).astype(np.uint8))


def _farbe_hoehe(h: np.ndarray, vmax=8.0) -> np.ndarray:
    """nDSM → Farbe: 0 m dunkel, 2 m gelb, ≥ vmax weiß; NaN grau."""
    import matplotlib
    cm = matplotlib.colormaps["inferno"]
    t = np.clip(np.nan_to_num(h, nan=0) / vmax, 0, 1)
    out = (cm(t)[..., :3] * 255).astype(np.float32)
    out[~np.isfinite(h)] = 90
    return out


@lru_cache
def _umringe():
    return gpd.read_file(build_dir() / "buildings.geojson").set_crs(25832, allow_override=True)


def _gitter(img: Image.Image, bb, scale: float, g: Polygon, extra=None, beschriftung=True):
    d = ImageDraw.Draw(img, "RGBA")
    # amtliche Grundrisse (Hausumringe/LoD2) gestrichelt weiß: werden nicht annotiert
    for geb in _umringe().cx[bb[0]:bb[2], bb[1]:bb[3]].geometry:
        for poly in getattr(geb, "geoms", [geb]):
            pts = [((x - bb[0]) * scale, (bb[3] - y) * scale) for x, y in poly.exterior.coords]
            for k in range(len(pts) - 1):
                (ax, ay), (bx, by_) = pts[k], pts[k + 1]
                n = max(int(np.hypot(bx - ax, by_ - ay) / 8), 1)
                for j in range(0, n, 2):
                    d.line([(ax + (bx - ax) * j / n, ay + (by_ - ay) * j / n),
                            (ax + (bx - ax) * (j + 1) / n, ay + (by_ - ay) * (j + 1) / n)], fill=(255, 255, 255, 230), width=2)
    x0, y0, x1, y1 = bb
    f = _font(12)
    for x in np.arange(x0, x1 + 0.01, 5):
        X = (x - x0) * scale
        d.line([(X, 0), (X, img.height)], fill=(255, 255, 255, 70 if x % 10 else 140), width=1)
        if beschriftung and x % 10 == 0:
            d.text((X + 2, 2), f"{int(x - x0)}", fill=(255, 255, 0, 255), font=f, stroke_width=2, stroke_fill=(0, 0, 0))
    for y in np.arange(y0, y1 + 0.01, 5):
        Y = (y1 - y) * scale
        d.line([(0, Y), (img.width, Y)], fill=(255, 255, 255, 70 if y % 10 else 140), width=1)
        if beschriftung and y % 10 == 0:
            d.text((2, Y + 2), f"{int(y - y0)}", fill=(255, 255, 0, 255), font=f, stroke_width=2, stroke_fill=(0, 0, 0))
    pts = [((x - x0) * scale, (y1 - y) * scale) for x, y in g.exterior.coords]
    d.line(pts, fill=(0, 255, 255, 255), width=2)
    for poly, farbe, text in extra or []:
        p = [((x - x0) * scale, (y1 - y) * scale) for x, y in poly.exterior.coords]
        d.line(p, fill=farbe, width=2)
        if text:
            c = poly.representative_point()
            d.text(((c.x - x0) * scale, (y1 - c.y) * scale), text, fill=(255, 255, 255), font=_font(13),
                   stroke_width=2, stroke_fill=(0, 0, 0), anchor="mm")
    return img


def bogen(pid: str, extra=None, name=None) -> str:
    """Drei Ansichten nebeneinander: DOP20 RGB, CIR (NIR-Rot-Grün), Laser-nDSM mit Einzelecho-Anteil.
    Raster alle 5 m, Beschriftung in Metern vom linken unteren Rand (lokale Bogenkoordinaten)."""
    gs = grundstuecke()[pid]
    g = gs["geom"]
    bb = _rahmen(g)
    res = 0.2
    rgb = raster("dop20", bb, res).transpose(1, 2, 0)
    nd = raster("laser_ndsm", bb, res, resampling=__import__("rasterio").enums.Resampling.nearest)
    hc = _farbe_hoehe(nd[0])
    # Mehrfachechos (Vegetation) blau abdunkeln
    veg = np.nan_to_num(nd[1], nan=1) < 0.5
    hc[veg & (np.nan_to_num(nd[0]) > 0.5)] *= np.array([0.35, 0.6, 1.6])
    scale = 3.0  # px pro 0,2-m-Pixel → 15 px/m
    imgs = []
    for a in (rgb, hc):
        im = _bild(a).resize((int(a.shape[1] * scale), int(a.shape[0] * scale)), Image.LANCZOS)
        imgs.append(_gitter(im, bb, scale / res, g, extra))
    W = sum(i.width for i in imgs) + 20
    H = imgs[0].height + 26
    sheet = Image.new("RGB", (W, H), (20, 20, 20))
    x = 0
    for im in imgs:
        sheet.paste(im, (x, 26))
        x += im.width + 10
    ImageDraw.Draw(sheet).text((6, 4), f"{pid} {gs['zone']}  Ursprung ({bb[0]:.0f}, {bb[1]:.0f})  Raster 5 m   "
                                        f"DOP20 2023 | Laser-nDSM 2025 0–8 m (blau = Mehrfachecho) | weiß gestrichelt = Hausumring", fill=(255, 255, 255), font=_font(15))
    out = REF / "boegen" / f"{name or pid}.jpg"
    out.parent.mkdir(exist_ok=True)
    sheet.save(out, quality=85)
    return str(out)


def lupe(pid: str, cx: float, cy: float, r: float = 7.0, extra_polys=None) -> str:
    """Vergrößerung um (cx, cy) in Bogenkoordinaten: links DOP20 (40 px/m), rechts Laserpunkte über Grund
    (Farbe = Höhe über DGM1, Kreuz = Mehrfachecho). Raster 1 m, Beschriftung in Bogenkoordinaten.
    Für genaue Eckpunkte von Kleinbauten und Pools (Lesegenauigkeit etwa 0,1–0,2 m)."""
    gs = grundstuecke()[pid]
    bb0 = _rahmen(gs["geom"])
    x0, y0 = bb0[0] + cx - r, bb0[1] + cy - r
    bb = (x0, y0, x0 + 2 * r, y0 + 2 * r)
    s = 40 if r > 5.5 else 30  # px/m
    rgb = raster("dop20", bb, 0.2).transpose(1, 2, 0)
    a = _bild(rgb).resize((int(2 * r * s), int(2 * r * s)), Image.LANCZOS)
    pts = laser(bb)
    dgm = raster("dgm1", (bb[0] - 2, bb[1] - 2, bb[2] + 2, bb[3] + 2), 1.0)[0]
    ci = np.clip(((pts["x"] - bb[0] + 2)).astype(int), 0, dgm.shape[1] - 1)
    ri = np.clip(((bb[3] + 2 - pts["y"])).astype(int), 0, dgm.shape[0] - 1)
    h = pts["z"] - dgm[ri, ci]
    b = Image.new("RGB", a.size, (25, 25, 25))
    import matplotlib
    cm = matplotlib.colormaps["turbo"]
    db = ImageDraw.Draw(b)
    for x, y, hh, k, n in zip(pts["x"], pts["y"], h, pts["klasse"], pts["echos"]):
        X, Y = (x - bb[0]) * s, (bb[3] - y) * s
        c = tuple(int(v * 255) for v in cm(min(max(hh, 0) / 6, 1))[:3]) if k != 2 else (70, 70, 70)
        if n > 1 and k != 2:
            db.line([(X - 3, Y - 3), (X + 3, Y + 3)], fill=c)
            db.line([(X - 3, Y + 3), (X + 3, Y - 3)], fill=c)
        else:
            db.ellipse([X - 2, Y - 2, X + 2, Y + 2], fill=c)
    f = _font(12)
    for im in (a, b):
        d = ImageDraw.Draw(im, "RGBA")
        for v in np.arange(np.ceil(bb[0]), bb[2] + 0.01, 1):
            X = (v - bb[0]) * s
            d.line([(X, 0), (X, im.height)], fill=(255, 255, 255, 60 if (v - bb0[0]) % 5 else 150))
            d.text((X + 2, 2), f"{v - bb0[0]:.0f}", fill=(255, 255, 0), font=f, stroke_width=2, stroke_fill=(0, 0, 0))
        for v in np.arange(np.ceil(bb[1]), bb[3] + 0.01, 1):
            Y = (bb[3] - v) * s
            d.line([(0, Y), (im.width, Y)], fill=(255, 255, 255, 60 if (v - bb0[1]) % 5 else 150))
            d.text((2, Y + 2), f"{v - bb0[1]:.0f}", fill=(255, 255, 0), font=f, stroke_width=2, stroke_fill=(0, 0, 0))
        for poly in extra_polys or []:
            p = [((x - bb[0]) * s, (bb[3] - y) * s) for x, y in poly.exterior.coords]
            d.line(p, fill=(255, 0, 255, 255), width=2)
    sheet = Image.new("RGB", (a.width * 2 + 10, a.height + 24), (20, 20, 20))
    sheet.paste(a, (0, 24))
    sheet.paste(b, (a.width + 10, 24))
    ImageDraw.Draw(sheet).text((6, 3), f"{pid} Lupe um ({cx:.1f}, {cy:.1f})  Laser: Farbe 0–6 m (turbo), Kreuz = Mehrfachecho, grau = Boden",
                               fill=(255, 255, 255), font=_font(14))
    out = REF / "boegen" / f"{pid}_lupe_{cx:.0f}_{cy:.0f}.jpg"
    out.parent.mkdir(exist_ok=True)
    sheet.save(out, quality=88)
    return str(out)


def lupen(pid: str) -> str:
    """Sammelbogen: Lupen (10 × 10 m, 30 px/m) um alle erhöhten harten Stellen (Laser 1–6 m, Einzelecho) und
    wasser-/türkisfarbenen Stellen im Grundstück außerhalb der Hausumringe. Links DOP, rechts Laserpunkte."""
    from scipy import ndimage
    gs = grundstuecke()[pid]
    g = gs["geom"]
    bb0 = _rahmen(g)
    res = 0.2
    nd = raster("laser_ndsm", bb0, res, resampling=__import__("rasterio").enums.Resampling.nearest)
    rgb = raster("dop20", bb0, res)
    from rasterio import features as rf
    from rasterio.transform import from_origin
    tr = from_origin(bb0[0], bb0[3], res, res)
    H, W = nd.shape[1:]
    innen = rf.rasterize([(g.buffer(1.0), 1)], out_shape=(H, W), transform=tr).astype(bool)
    geb = rf.rasterize([(x, 1) for x in _umringe().cx[bb0[0]:bb0[2], bb0[1]:bb0[3]].geometry.buffer(1.2)] or [(Point(0, 0), 0)],
                       out_shape=(H, W), transform=tr).astype(bool)
    hart = (np.nan_to_num(nd[0]) > 1.0) & (np.nan_to_num(nd[0]) < 6.5) & (np.nan_to_num(nd[1]) >= 0.5)
    tuerkis = (rgb[2] - rgb[0] > 25) & (rgb[1] - rgb[0] > 10)
    m = ndimage.binary_opening((hart | tuerkis) & innen & ~geb, np.ones((3, 3)))
    lab, n = ndimage.label(m)
    zentren = []
    for sl in ndimage.find_objects(lab):
        if (sl[0].stop - sl[0].start) * (sl[1].stop - sl[1].start) * res * res < 2.0:
            continue
        cy = bb0[3] - (sl[0].start + sl[0].stop) / 2 * res - bb0[1]
        cx = (sl[1].start + sl[1].stop) / 2 * res
        if all(np.hypot(cx - a, cy - b) > 4 for a, b in zentren):
            zentren.append((round(cx, 1), round(cy, 1)))
    if not zentren:
        return ""
    bilder = [Image.open(lupe(pid, cx, cy, 5.0)) for cx, cy in zentren[:8]]
    w, h = bilder[0].size
    sp = 2
    sheet = Image.new("RGB", (w * sp + 10, h * ((len(bilder) + sp - 1) // sp)), (20, 20, 20))
    for k, im in enumerate(bilder):
        sheet.paste(im, ((k % sp) * (w + 10), (k // sp) * h))
    out = REF / "boegen" / f"{pid}_lupen.jpg"
    sheet.save(out, quality=85)
    for p in (REF / "boegen").glob(f"{pid}_lupe_*.jpg"):
        p.unlink()
    return str(out)


# ---------------------------------------------------------------- Annotation → Umrisse

def _sam():
    import torch
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    torch.set_num_threads(4)
    ck = build_dir().parent / "raw" / "models" / "sam2.1_hiera_small.pt"
    return SAM2ImagePredictor(build_sam2("configs/sam2.1/sam2.1_hiera_s.yaml", str(ck), device="cpu"))


def _maske_zu_poly(m: np.ndarray, bb, res) -> Polygon | None:
    from rasterio import features
    from rasterio.transform import from_origin
    tr = from_origin(bb[0], bb[3], res, res)
    polys = [shape(s) for s, v in features.shapes(m.astype(np.uint8), mask=m, transform=tr) if v]
    if not polys:
        return None
    return max(polys, key=lambda p: p.area).buffer(0)


def _ref_hoehe(g) -> float | None:
    """Referenzhöhe aus Laserpunkten: 99. Perzentil der Nicht-Boden-Punkte im Umriss minus Median der Bodenpunkte
    im Ring 0,5–3 m. Anderer Schätzer als die Erkennung (95. Perzentil), aber dieselben Daten."""
    import shapely
    x0, y0, x1, y1 = g.buffer(3).bounds
    p = laser((x0, y0, x1, y1))
    pts = shapely.points(p["x"], p["y"])
    inn = shapely.contains(g, pts) & ~np.isin(p["klasse"], [2, 7, 18])
    ring = shapely.contains(g.buffer(3), pts) & ~shapely.contains(g.buffer(0.5), pts) & (p["klasse"] == 2)
    if inn.sum() < 5 or ring.sum() < 5:
        return None
    return round(float(np.percentile(p["z"][inn], 99) - np.median(p["z"][ring])), 2)


def bauen(ids: list[str] | None = None) -> int:
    """Annotationen in Umrisse umsetzen.

    Jede Annotation hat `klasse`, `hoehe` (geschätzt, m) und eine Geometrieangabe in Bogenkoordinaten (m ab
    linker unterer Ecke des Bogens):
      - "poly": [[x, y], ...]  von Hand gesetzte Eckpunkte (maßgeblich)
      - "rechteck": [cx, cy, laenge, breite, winkel_grad]
      - "kreis": [cx, cy, durchmesser]
      - "box": [x0, y0, x1, y1] → Umriss mit SAM 2 aus der Box (nur für unregelmäßige Formen: Hecke, Baum, Teich)
    """
    from shapely import affinity
    alle = grundstuecke()
    ids = ids or sorted(p.stem for p in (REF / "annotationen").glob("*.json"))
    pred = None
    feats = []
    for pid in ids:
        ann = json.loads((REF / "annotationen" / f"{pid}.json").read_text())
        g = alle[pid]["geom"]
        bb = _rahmen(g)
        for k, a in enumerate(ann["objekte"]):
            assert a["klasse"] in KLASSEN, a
            if "poly" in a:
                geom, methode = Polygon([(bb[0] + x, bb[1] + y) for x, y in a["poly"]]), "Eckpunkte von Hand"
            elif "rechteck" in a:
                cx, cy, l, b_, w = a["rechteck"]
                r = Polygon([(-l / 2, -b_ / 2), (l / 2, -b_ / 2), (l / 2, b_ / 2), (-l / 2, b_ / 2)])
                geom = affinity.translate(affinity.rotate(r, w, origin=(0, 0)), bb[0] + cx, bb[1] + cy)
                methode = "Rechteck von Hand"
            elif "kreis" in a:
                cx, cy, dm = a["kreis"]
                geom, methode = Point(bb[0] + cx, bb[1] + cy).buffer(dm / 2, 32), "Kreis von Hand"
            else:
                if pred is None:
                    pred = _sam()
                res = 0.2
                rgb = raster("dop20", bb, res).transpose(1, 2, 0)
                pred.set_image(np.clip(np.nan_to_num(rgb), 0, 255).astype(np.uint8))
                X0, Y0, X1, Y1 = a["box"]
                H = rgb.shape[0]
                box = np.array([X0 / res, H - Y1 / res, X1 / res, H - Y0 / res])
                m, s, _ = pred.predict(box=box, multimask_output=False)
                geom = _maske_zu_poly(m[0] > 0, bb, res)
                methode = f"SAM 2 aus Box, von Hand geprüft (Score {float(s[0]):.2f})"
                if geom is None:
                    print(f"  {pid}#{k}: SAM ohne Ergebnis")
                    continue
                geom = geom.simplify(0.1)
            h, hq = a.get("hoehe"), "von Hand geschätzt"
            if h is None and a["klasse"] not in ("terrasse", "pool", "teich"):
                h, hq = _ref_hoehe(geom), "Laser 2025, 99. Perzentil über Bodenpunkten (automatisch, nur Konsistenz)"
            feats.append({"type": "Feature", "geometry": mapping(geom),
                          "properties": {"grundstueck": pid, "nr": k, "klasse": a["klasse"],
                                         "hoehe_geschaetzt_m": h, "hoehe_quelle": hq if h is not None else None,
                                         "umriss_methode": methode,
                                         "sicher": a.get("sicher", True), "notiz": a.get("notiz", ""),
                                         "split": alle[pid]["split"], "zone": alle[pid]["zone"]}})
    alt = []
    p = REF / "referenz.geojson"
    if p.exists():
        alt = [f for f in json.loads(p.read_text())["features"] if f["properties"]["grundstueck"] not in ids]
    fc = {"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "EPSG:25832"}},
          "features": sorted(alt + feats, key=lambda f: (f["properties"]["grundstueck"], f["properties"]["nr"]))}
    p.write_text(json.dumps(fc, ensure_ascii=False, indent=1))
    print(f"  {len(feats)} Objekte aus {len(ids)} Grundstücken, gesamt {len(fc['features'])}")
    return 0


def kontrolle(pid: str) -> str:
    fc = json.loads((REF / "referenz.geojson").read_text())
    farben = {"gartenhaus": (255, 60, 60, 255), "carport_garage": (255, 140, 0, 255), "gewaechshaus": (255, 255, 255, 255),
              "pool": (0, 200, 255, 255), "teich": (0, 90, 255, 255), "terrasse": (200, 200, 200, 255),
              "trampolin": (255, 0, 255, 255), "spielturm": (255, 0, 160, 255), "hecke": (0, 255, 0, 255),
              "baum": (120, 255, 120, 255), "strauch": (180, 255, 0, 255), "waermepumpe": (255, 255, 0, 255),
              "zaun_mauer": (160, 120, 80, 255)}
    extra = [(shape(f["geometry"]), farben[f["properties"]["klasse"]], f"{f['properties']['nr']}")
             for f in fc["features"] if f["properties"]["grundstueck"] == pid]
    return bogen(pid, extra, name=f"{pid}_kontrolle")


def _test_hash() -> str:
    fc = json.loads((REF / "referenz.geojson").read_text())
    test = [f for f in fc["features"] if f["properties"]["split"] == "test"]
    gs = [f for f in json.loads((REF / "grundstuecke.geojson").read_text())["features"] if f["properties"]["split"] == "test"]
    return hashlib.sha256(json.dumps([gs, test], sort_keys=True).encode()).hexdigest()


def einfrieren() -> int:
    alle = grundstuecke()
    split = {"eingefroren": time.strftime("%Y-%m-%d"), "sha256_test": _test_hash(),
             "dev": sorted(k for k, v in alle.items() if v["split"] == "dev"),
             "test": sorted(k for k, v in alle.items() if v["split"] == "test"),
             "regel": "Test-Set nie zum Einstellen von Parametern oder zum Training benutzen. "
                      "09_garten_eval.py bricht ab, wenn die Prüfsumme nicht passt."}
    (REF / "split.json").write_text(json.dumps(split, indent=1, ensure_ascii=False))
    print(split["sha256_test"])
    return 0


def test_gueltig() -> bool:
    split = json.loads((REF / "split.json").read_text())
    return split["sha256_test"] == _test_hash()


if __name__ == "__main__":
    cmd, *args = sys.argv[1:]
    if cmd == "auswahl":
        sys.exit(auswahl())
    if cmd == "bogen":
        for a in args:
            print(bogen(a))
    if cmd == "lupen":
        for a in args:
            print(lupen(a))
    if cmd == "lupe":
        pid, cx, cy, *rr = args
        print(lupe(pid, float(cx), float(cy), *(float(v) for v in rr)))
    if cmd == "bauen":
        sys.exit(bauen(args or None))
    if cmd == "kontrolle":
        for a in args:
            print(kontrolle(a))
    if cmd == "teilen":
        sys.exit(teilen())
    if cmd == "einfrieren":
        sys.exit(einfrieren())
