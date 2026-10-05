#!/usr/bin/env python3
"""Test-Set nach Objekten (AUFTRAG_V2, Nachtrag 4. Oktober 2026).

Das alte Test-Set (20 Grundstücke) bleibt unverändert. Das neue wird nach Objekten ausgewählt:
50 Gartenhäuser, 30 Pools, 30 Trampoline, 20 Gewächshäuser, aus allen vier 1-km-Kacheln des Gebiets.

Unabhängig von der Erkennung:
  1. Das Gebiet wird in 100 × 100-m-Blöcke geteilt. Nur Blöcke mit mindestens 3 Wohnhäusern (ALKIS 31001_1xxx), ohne
     Überschneidung mit den alten Referenz-Grundstücken (+15 m). Reihenfolge zufällig (fester Seed).
  2. Blöcke werden in dieser Reihenfolge **vollständig** für die vier Klassen annotiert (DOP20 2023 + Laser-nDSM 2025,
     dieselben Regeln wie data/reference/README.md), bis alle Quoten erreicht sind oder das Gebiet erschöpft ist.
     Die Erkennung wird dabei nicht angesehen.
  3. Einfrieren: je Klasse eine Zufallsstichprobe in Quotengröße (Seed) → Trefferquote. Alle annotierten Blöcke
     → Präzision (Erkennungen der Klasse im Blockinneren gegen alle annotierten Objekte). Prüfsumme in testset.json.

  python3 17_testset_objekte.py bloecke              Blockliste → data/reference/objekte/bloecke.json
  python3 17_testset_objekte.py bogen B007           Annotationsbogen (DOP20 | nDSM) nach data/reference/objekte/boegen
  python3 17_testset_objekte.py lupen B007 x,y x,y   Lupen (12 × 12 m) um Punkte in Blockkoordinaten
  python3 17_testset_objekte.py stand                Zählung je Klasse über die annotierten Blöcke
  python3 17_testset_objekte.py bauen                annotationen/*.json → objekte.geojson
  python3 17_testset_objekte.py einfrieren           Stichprobe ziehen, Prüfsumme → testset.json
  python3 17_testset_objekte.py messen [geojson] [v2]  Erkennung (Standard data/build/garten.geojson) gegen das Set
  python3 17_testset_objekte.py v2                   korrigierte Fassung (globaler Versatz, siehe V2_VERSATZ)

Blockkoordinaten: Meter ab der linken unteren Ecke des Blocks (x Ost, y Nord); der Bogen zeigt 5 m Rand (−5 … 105).
Annotation: {"block": "B007", "fertig": true, "objekte": [{"klasse": "pool", "rechteck": [cx, cy, laenge, breite, grad]},
            {"klasse": "trampolin", "kreis": [cx, cy, r]}, {"klasse": "gartenhaus", "poly": [[x, y], ...]}, ...]}
Gezählt wird ein Objekt für den Block, in dem sein Mittelpunkt liegt.
"""
from __future__ import annotations

import hashlib
import importlib
import json
import random
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
from PIL import Image, ImageDraw
from shapely import affinity
from shapely.geometry import Point, Polygon, box, mapping, shape
from shapely.strtree import STRtree

from common import build_dir
from rohdaten import raster

r7 = importlib.import_module("07_referenz")

OBJ = r7.REF / "objekte"
ANN = OBJ / "annotationen"
QUOTEN = {"gartenhaus": 50, "pool": 30, "trampolin": 30, "gewaechshaus": 20}
SEED = 20261004
BLOCK = 100.0
RAND = 5.0
GEBIET = (698000.0, 5486000.0, 700000.0, 5488000.0)
IOU_MIN = 0.3


# ------------------------------------------------------------------ Blöcke

def bloecke() -> int:
    b = r7._umringe()
    wohn = b[b.funktion.fillna("").str.startswith("31001_1")]
    tree = STRtree(wohn.geometry.centroid.values)
    alt = [g.buffer(15) for g in gpd.read_file(r7.REF / "grundstuecke.geojson").to_crs(25832).geometry]
    liste = []
    for x in np.arange(GEBIET[0], GEBIET[2], BLOCK):
        for y in np.arange(GEBIET[1], GEBIET[3], BLOCK):
            q = box(x, y, x + BLOCK, y + BLOCK)
            n = len(tree.query(q, predicate="contains"))
            if n < 3 or any(a.intersects(q) for a in alt):
                continue
            liste.append({"x0": float(x), "y0": float(y), "wohnhaeuser": n, "kachel": f"{int(x // 1000)}_{int(y // 1000)}"})
    random.Random(SEED).shuffle(liste)
    for i, e in enumerate(liste):
        e["id"] = f"B{i:03d}"
    OBJ.mkdir(parents=True, exist_ok=True)
    (OBJ / "bloecke.json").write_text(json.dumps({"seed": SEED, "block_m": BLOCK, "bloecke": liste}, indent=1), encoding="utf-8")
    kacheln = {}
    for e in liste:
        kacheln[e["kachel"]] = kacheln.get(e["kachel"], 0) + 1
    print(f"{len(liste)} Blöcke (≥ 3 Wohnhäuser, ohne alte Referenz), je Kachel {kacheln}")
    return 0


def _block(bid: str) -> dict:
    return next(e for e in json.loads((OBJ / "bloecke.json").read_text(encoding="utf-8"))["bloecke"] if e["id"] == bid)


def _gitter(im: Image.Image, bb, s: float, schritt: float, x00: float, y00: float, beschr=True, kern=None):
    d = ImageDraw.Draw(im, "RGBA")
    for geb in r7._umringe().cx[bb[0]:bb[2], bb[1]:bb[3]].geometry:
        for poly in getattr(geb, "geoms", [geb]):
            d.line([((x - bb[0]) * s, (bb[3] - y) * s) for x, y in poly.exterior.coords], fill=(255, 255, 255, 200), width=1)
    f = r7._font(12)
    for v in np.arange(np.ceil(bb[0] / schritt) * schritt, bb[2] + 0.01, schritt):
        X = (v - bb[0]) * s
        stark = abs((v - x00) % (schritt * 2)) < 1e-6
        d.line([(X, 0), (X, im.height)], fill=(255, 255, 255, 140 if stark else 60))
        if beschr and stark:
            d.text((X, 2), f"{v - x00:.0f}", fill=(255, 255, 0), font=f, stroke_width=2, stroke_fill=(0, 0, 0), anchor="mt")
    for v in np.arange(np.ceil(bb[1] / schritt) * schritt, bb[3] + 0.01, schritt):
        Y = (bb[3] - v) * s
        stark = abs((v - y00) % (schritt * 2)) < 1e-6
        d.line([(0, Y), (im.width, Y)], fill=(255, 255, 255, 140 if stark else 60))
        if beschr and stark:
            d.text((2, Y), f"{v - y00:.0f}", fill=(255, 255, 0), font=f, stroke_width=2, stroke_fill=(0, 0, 0), anchor="lm")
    if kern:
        d.rectangle([(kern[0] - bb[0]) * s, (bb[3] - kern[3]) * s, (kern[2] - bb[0]) * s, (bb[3] - kern[1]) * s], outline=(0, 255, 255, 255), width=2)
    return d


def _ndsm_farbe(bb, res):
    import rasterio
    nd = raster("laser_ndsm", bb, res, resampling=rasterio.enums.Resampling.nearest)
    hc = r7._farbe_hoehe(nd[0], vmax=6.0)
    veg = np.nan_to_num(nd[1], nan=1) < 0.5
    hc[veg & (np.nan_to_num(nd[0]) > 0.5)] *= np.array([0.35, 0.6, 1.6])
    return hc


def bogen(bid: str) -> str:
    """DOP20 und Laser-nDSM (0–6 m, blau = Mehrfachecho/Vegetation) nebeneinander, Raster 10 m, Blockrand türkis."""
    e = _block(bid)
    x0, y0 = e["x0"], e["y0"]
    bb = (x0 - RAND, y0 - RAND, x0 + BLOCK + RAND, y0 + BLOCK + RAND)
    s = 7.0  # px/m
    teile = []
    for a in (raster("dop20", bb, 0.2)[:3].transpose(1, 2, 0), _ndsm_farbe(bb, 0.2)):
        im = r7._bild(a).resize((int((bb[2] - bb[0]) * s), int((bb[3] - bb[1]) * s)), Image.LANCZOS)
        _gitter(im, bb, s, 5.0, x0, y0, kern=(x0, y0, x0 + BLOCK, y0 + BLOCK))
        teile.append(im)
    W = teile[0].width * 2 + 8
    sheet = Image.new("RGB", (W, teile[0].height + 22), (20, 20, 20))
    sheet.paste(teile[0], (0, 22))
    sheet.paste(teile[1], (teile[0].width + 8, 22))
    ImageDraw.Draw(sheet).text((6, 3), f"{bid} ({x0:.0f}, {y0:.0f}) Kachel {e['kachel']} | DOP20 2023 | nDSM 2025 0–6 m, blau = Vegetation | Raster 5 m, Zahlen alle 10 m | weiß = Hausumring",
                               fill=(255, 255, 255), font=r7._font(13))
    out = OBJ / "boegen" / f"{bid}.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=88)
    return str(out)


def lupen(bid: str, punkte: list[tuple[float, float]], r: float = 6.0, extra: list | None = None) -> str:
    """Je Punkt: DOP20 und nDSM (12 × 12 m, 22 px/m), Raster 1 m, Beschriftung in Blockkoordinaten. Bis 6 Punkte."""
    e = _block(bid)
    x0, y0 = e["x0"], e["y0"]
    s = 22.0
    kacheln = []
    for cx, cy in punkte[:6]:
        bb = (x0 + cx - r, y0 + cy - r, x0 + cx + r, y0 + cy + r)
        paar = []
        for a in (raster("dop20", bb, 0.2)[:3].transpose(1, 2, 0), _ndsm_farbe(bb, 0.2)):
            im = r7._bild(a).resize((int(2 * r * s), int(2 * r * s)), Image.LANCZOS)
            d = _gitter(im, bb, s, 1.0, x0, y0)
            for poly in extra or []:
                d.line([((x - bb[0]) * s, (bb[3] - y) * s) for x, y in poly.exterior.coords], fill=(255, 0, 255, 255), width=2)
            paar.append(im)
        k = Image.new("RGB", (paar[0].width * 2 + 4, paar[0].height + 18), (20, 20, 20))
        k.paste(paar[0], (0, 18))
        k.paste(paar[1], (paar[0].width + 4, 18))
        ImageDraw.Draw(k).text((4, 2), f"um ({cx:.0f}, {cy:.0f})", fill=(255, 255, 255), font=r7._font(12))
        kacheln.append(k)
    sp = 2 if len(kacheln) > 1 else 1
    zeilen = (len(kacheln) + sp - 1) // sp
    w, h = kacheln[0].size
    sheet = Image.new("RGB", (sp * w + (sp - 1) * 10, zeilen * h + (zeilen - 1) * 10), (60, 60, 60))
    for i, k in enumerate(kacheln):
        sheet.paste(k, ((i % sp) * (w + 10), (i // sp) * (h + 10)))
    out = OBJ / "boegen" / f"{bid}_lupen.jpg"
    sheet.save(out, quality=88)
    return str(out)


# ------------------------------------------------------------------ Annotationen

def geom_aus(o: dict, x0: float, y0: float) -> Polygon:
    if "kreis" in o:
        cx, cy, r = o["kreis"]
        return Point(x0 + cx, y0 + cy).buffer(r, quad_segs=16)
    if "rechteck" in o:
        cx, cy, l, b, w = o["rechteck"]
        return affinity.rotate(box(x0 + cx - l / 2, y0 + cy - b / 2, x0 + cx + l / 2, y0 + cy + b / 2), w, origin=(x0 + cx, y0 + cy))
    return Polygon([(x0 + x, y0 + y) for x, y in o["poly"]])


def _annotationen() -> list[dict]:
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(ANN.glob("B*.json"))]


def stand() -> dict:
    z = {k: 0 for k in QUOTEN}
    fertig = 0
    for a in _annotationen():
        if not a.get("fertig"):
            continue
        fertig += 1
        e = _block(a["block"])
        kern = box(e["x0"], e["y0"], e["x0"] + BLOCK, e["y0"] + BLOCK)
        for o in a["objekte"]:
            if o["klasse"] in z and o.get("sicher", True) and kern.contains(geom_aus(o, e["x0"], e["y0"]).centroid):
                z[o["klasse"]] += 1
    print(f"{fertig} Blöcke fertig: " + ", ".join(f"{k} {v}/{QUOTEN[k]}" for k, v in z.items()))
    return z


def bauen() -> int:
    feats = []
    for a in _annotationen():
        if not a.get("fertig"):
            continue
        e = _block(a["block"])
        kern = box(e["x0"], e["y0"], e["x0"] + BLOCK, e["y0"] + BLOCK)
        for i, o in enumerate(a["objekte"]):
            g = geom_aus(o, e["x0"], e["y0"])
            if not kern.contains(g.centroid):
                continue  # gehört zum Nachbarblock
            feats.append({"type": "Feature", "geometry": mapping(g), "properties": {
                "id": f"{a['block']}_{i:02d}", "block": a["block"], "kachel": e["kachel"], "klasse": o["klasse"],
                "sicher": o.get("sicher", True), "notiz": o.get("notiz", ""), "flaeche": round(g.area, 1)}})
    (OBJ / "objekte.geojson").write_text(json.dumps({"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "EPSG:25832"}},
                                                      "features": feats}, ensure_ascii=False), encoding="utf-8")
    print(f"{len(feats)} Objekte → {OBJ / 'objekte.geojson'}")
    return 0


def _hash(daten: bytes) -> str:
    return hashlib.sha256(daten).hexdigest()


def einfrieren() -> int:
    bauen()
    roh = (OBJ / "objekte.geojson").read_bytes()
    feats = json.loads(roh)["features"]
    fertig = [a["block"] for a in _annotationen() if a.get("fertig")]
    rnd = random.Random(SEED + 1)
    stichprobe, fehlt = {}, {}
    for k, n in QUOTEN.items():
        ids = sorted(f["properties"]["id"] for f in feats if f["properties"]["klasse"] == k and f["properties"]["sicher"])
        stichprobe[k] = sorted(rnd.sample(ids, min(n, len(ids))))
        if len(ids) < n:
            fehlt[k] = n - len(ids)
    ts = {"erstellt": __import__("time").strftime("%Y-%m-%d"), "quoten": QUOTEN, "bloecke": fertig,
          "stichprobe": stichprobe, "quote_nicht_erreicht": fehlt, "sha256_objekte": _hash(roh),
          "regel": "Trefferquote auf der Stichprobe (IoU ≥ 0,3, gleiche Klasse); Präzision über alle Erkennungen der Klasse, "
                   "deren Mittelpunkt im Inneren eines annotierten Blocks liegt, gegen alle annotierten Objekte (auch unsichere)."}
    (OBJ / "testset.json").write_text(json.dumps(ts, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"eingefroren: {len(fertig)} Blöcke, Stichprobe {({k: len(v) for k, v in stichprobe.items()})}, fehlt {fehlt}")
    return 0


# Korrektur 05.10.2026: Die Annotationen v1 liegen systematisch versetzt (Ablesefehler an den Bögen: Zahlen standen
# neben statt auf der Linie). Versatz nur aus dem Laser geschätzt (35 Gartenhäuser: Dach-Laserpunkte minus Referenz,
# Median dx +0,27 m, dy −0,84 m; 3 Pools mit Echolücke bestätigen die Richtung). Kein Bezug auf die zu messenden Verfahren.
V2_VERSATZ = (0.3, -0.8)


def v2_erzeugen() -> int:
    """objekte_v2.geojson = v1 um V2_VERSATZ verschoben; v1 bleibt unverändert und eingefroren."""
    if not gueltig():
        raise SystemExit("v1 verändert – Abbruch")
    d = json.loads((OBJ / "objekte.geojson").read_text(encoding="utf-8"))
    for f in d["features"]:
        f["geometry"] = mapping(affinity.translate(shape(f["geometry"]), *V2_VERSATZ))
    roh = json.dumps(d, ensure_ascii=False).encode("utf-8")
    (OBJ / "objekte_v2.geojson").write_bytes(roh)
    ts = json.loads((OBJ / "testset.json").read_text(encoding="utf-8"))
    (OBJ / "testset_v2.json").write_text(json.dumps({
        "erstellt": __import__("time").strftime("%Y-%m-%d"), "basis": "testset.json (v1, unverändert)",
        "sha256_v1": ts["sha256_objekte"], "versatz_m": V2_VERSATZ, "sha256_objekte": _hash(roh),
        "stichprobe": ts["stichprobe"], "bloecke": ts["bloecke"],
        "begruendung": "Systematischer Ablesefehler der Annotation v1; Versatz nur aus Laser 2025 geschätzt "
                       "(35 Gartenhäuser, Median dx +0,27 dy −0,84 m; 3 Pools mit Echolücke gleichsinnig)."}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"v2: {len(d['features'])} Objekte um {V2_VERSATZ} verschoben → objekte_v2.geojson")
    return 0


def gueltig() -> bool:
    ts = json.loads((OBJ / "testset.json").read_text(encoding="utf-8"))
    return ts["sha256_objekte"] == _hash((OBJ / "objekte.geojson").read_bytes())


# ------------------------------------------------------------------ Messen

def _iou(a: Polygon, b: Polygon) -> float:
    i = a.intersection(b).area
    return i / max(a.union(b).area, 1e-9)


def referenz(version: str = "v1") -> tuple[dict, list[dict]]:
    if version == "v2":
        ts = json.loads((OBJ / "testset_v2.json").read_text(encoding="utf-8"))
        roh = (OBJ / "objekte_v2.geojson").read_bytes()
    else:
        ts = json.loads((OBJ / "testset.json").read_text(encoding="utf-8"))
        roh = (OBJ / "objekte.geojson").read_bytes()
    if _hash(roh) != ts["sha256_objekte"]:
        raise SystemExit(f"Test-Set {version} passt nicht zur Prüfsumme – verändert")
    return ts, [dict(f["properties"], geom=shape(f["geometry"])) for f in json.loads(roh)["features"]]


def messen(pfad: Path | None = None, version: str = "v1") -> list[dict]:
    ts, ref = referenz(version)
    pfad = pfad or build_dir() / "garten.geojson"
    det_all = json.loads(pfad.read_text(encoding="utf-8"))
    kerne = []
    for bid in ts["bloecke"]:
        e = _block(bid)
        kerne.append(box(e["x0"], e["y0"], e["x0"] + BLOCK, e["y0"] + BLOCK))
    det = []
    for f in det_all["features"]:
        g = shape(f["geometry"])
        if any(k.contains(g.centroid) for k in kerne):
            det.append(dict(f["properties"], geom=g))
    zeilen = []
    for k in QUOTEN:
        stich = [r for r in ref if r["id"] in set(ts["stichprobe"][k])]
        dk = [d for d in det if d["klasse"] == k]
        treffer = sum(1 for r in stich if any(_iou(r["geom"], d["geom"]) >= IOU_MIN for d in dk))
        nah = sum(1 for r in stich if any(d["geom"].intersects(r["geom"]) for d in dk))
        alle_k = [r for r in ref if r["klasse"] == k]
        richtig = sum(1 for d in dk if any(_iou(r["geom"], d["geom"]) >= IOU_MIN for r in alle_k))
        # falsche Klasse: Erkennung trifft ein annotiertes Objekt anderer Zielklasse
        verwechselt = sum(1 for d in dk if not any(_iou(r["geom"], d["geom"]) >= IOU_MIN for r in alle_k)
                          and any(_iou(r["geom"], d["geom"]) >= IOU_MIN for r in ref if r["klasse"] != k))
        rq = treffer / len(stich) if stich else None
        pr = richtig / len(dk) if dk else None
        f1 = 2 * rq * pr / (rq + pr) if rq and pr else (0.0 if rq is not None and pr is not None else None)
        zeilen.append({"klasse": k, "stichprobe": len(stich), "treffer": treffer, "trefferquote": rq,
                       "beruehrt": nah, "erkennungen": len(dk), "richtig": richtig, "praezision": pr,
                       "verwechselt": verwechselt, "f1": f1, "ref_in_bloecken": len(alle_k)})
    modell = sorted({d.get("modell_version") for d in det if d.get("modell_version") is not None})
    erg = {"datei": str(pfad.name), "referenz": version, "modell": modell, "bloecke": len(kerne), "iou_min": IOU_MIN, "zeilen": zeilen}
    (r7.REF / ("auswertung_test_objekte.json" if version == "v1" else "auswertung_test_objekte_v2.json")).write_text(json.dumps(erg, indent=1, ensure_ascii=False), encoding="utf-8")
    p = lambda v: "–" if v is None else f"{v:.2f}"
    print(f"Modell {modell}, {len(kerne)} Blöcke, IoU ≥ {IOU_MIN}")
    print("| Klasse | Stichprobe | Treffer | Trefferquote | berührt | Erkennungen | richtig | Präzision | F1 |")
    print("|---|---|---|---|---|---|---|---|---|")
    for z in zeilen:
        print(f"| {z['klasse']} | {z['stichprobe']} | {z['treffer']} | {p(z['trefferquote'])} | {z['beruehrt']} | {z['erkennungen']} | {z['richtig']} | {p(z['praezision'])} | {p(z['f1'])} |")
    return zeilen


if __name__ == "__main__":
    a = sys.argv[1:] or ["stand"]
    if a[0] == "bloecke":
        sys.exit(bloecke())
    if a[0] == "bogen":
        for b in a[1:]:
            print(bogen(b))
    elif a[0] == "lupen":
        print(lupen(a[1], [tuple(map(float, p.split(","))) for p in a[2:]]))
    elif a[0] == "stand":
        stand()
    elif a[0] == "bauen":
        bauen()
    elif a[0] == "einfrieren":
        einfrieren()
    elif a[0] == "messen":
        v = "v2" if "v2" in a else "v1"
        rest = [x for x in a[1:] if x != "v2"]
        messen(Path(rest[0]) if rest else None, v)
    elif a[0] == "v2":
        v2_erzeugen()
    else:
        print(__doc__)
