#!/usr/bin/env python3
"""„Ein Tipp erfasst“ messen: simulierter Tipp in die Objektmitte, SAM 2 segmentiert, Vergleich mit der Referenz.

  python3 19_tipp_messen.py dev     Varianten auf dem Entwicklungs-Set (alte Referenz, nur split=dev) – zum Einstellen
  python3 19_tipp_messen.py test_v2 dasselbe gegen die korrigierte Referenz v2 (globaler Versatz, 17_testset_objekte.py)
  python3 19_tipp_messen.py test    EINMAL mit den in tipp.py festgelegten Einstellungen auf dem eingefrorenen
                                    Test-Set nach Objekten (prüft die Prüfsumme) → docs/messungen/tipp_test.json

Erfolg: IoU ≥ 0,5 zum Referenzumriss. Maße: Länge/Breite aus dem minimalen gedrehten Rechteck (runde Pools/Trampoline:
Durchmesser), für Referenz und Tipp gleich gerechnet. Höhe: Laser-Höhe (08_garten.masse) im Tipp-Umriss gegen dieselbe
Rechnung im Referenzumriss – misst nur den Einfluss des Umrisses, keine unabhängige Höhe (die gibt es nicht; vor_ort.csv
ist leer).
Tipp: Schwerpunkt; liegt er außerhalb (Winkel, Ringe), der repräsentative Punkt.
"""
from __future__ import annotations

import importlib
import json
import sys
import time
from pathlib import Path

import numpy as np
from shapely.geometry import shape

tp = importlib.import_module("tipp")
g8 = tp.g8
t17 = importlib.import_module("17_testset_objekte")
ROOT = Path(__file__).resolve().parent.parent
KLASSEN = ("gartenhaus", "pool", "trampolin", "gewaechshaus", "carport_garage")


def _iou(a, b) -> float:
    return a.intersection(b).area / max(a.union(b).area, 1e-9)


def masse_geo(g, klasse: str) -> tuple[float, float]:
    if klasse in ("pool", "trampolin") and g8._kreisfoermigkeit(g) > 0.8:
        d = 2 * np.sqrt(g.area / np.pi)
        return d, d
    rr = g.minimum_rotated_rectangle
    xs, ys = rr.exterior.coords.xy
    a, b = np.hypot(np.diff(xs[:3]), np.diff(ys[:3]))
    return float(max(a, b)), float(min(a, b))


def tipp_punkt(g):
    c = g.centroid
    return c if g.contains(c) else g.representative_point()


def objekte(menge: str) -> list[dict]:
    if menge == "dev":
        gs = {f["properties"]["id"]: f["properties"]["split"] for f in json.load(open(ROOT / "data/reference/grundstuecke.geojson"))["features"]}
        out = []
        for f in json.load(open(ROOT / "data/reference/referenz.geojson"))["features"]:
            p = f["properties"]
            if p["klasse"] in KLASSEN and gs[p["grundstueck"]] == "dev" and p.get("sicher", True):
                out.append({"id": f"{p['grundstueck']}_{p['nr']}", "klasse": p["klasse"], "geom": shape(f["geometry"])})
        return out
    _, ref = t17.referenz("v2" if menge == "test_v2" else "v1")
    return [r for r in ref if r["klasse"] in KLASSEN and r["sicher"]]


def eins(s, r, wahl, ohne, verf=False, form=False, groesse="small") -> dict:
    g = r["geom"]
    pt = tipp_punkt(g)
    seg = tp.segmentieren(s, pt.x, pt.y, wahl=wahl, ohne_umringe=ohne, verfeinern=verf, form=form, klasse=r["klasse"], groesse=groesse)
    z = {"id": r["id"], "klasse": r["klasse"], "flaeche_ref": round(g.area, 1)}
    if seg is None:
        return dict(z, ok=False, iou=0.0)
    p = seg["geom"]
    iou = _iou(p, g)
    lr, br = masse_geo(g, r["klasse"])
    lt, bt = masse_geo(p, r["klasse"])
    h_ref = g8.masse(s, r["klasse"], g, laser_umriss=False).get("hoehe")
    h_tip = g8.masse(s, r["klasse"], p, laser_umriss=False).get("hoehe")
    return dict(z, ok=iou >= 0.5, iou=round(iou, 3), flaeche_tipp=round(p.area, 1), d_laenge=round(lt - lr, 2),
                d_breite=round(bt - br, 2), d_hoehe=round(h_tip - h_ref, 2) if h_ref is not None and h_tip is not None else None)


def auswerten(zeilen: list[dict]) -> list[dict]:
    out = []
    for k in KLASSEN + ("alle",):
        z = [r for r in zeilen if k == "alle" or r["klasse"] == k]
        if not z:
            continue
        ok = [r for r in z if r["ok"]]
        med = lambda key, rr: round(float(np.median([abs(r[key]) for r in rr if r.get(key) is not None])), 2) if any(r.get(key) is not None for r in rr) else None
        out.append({"klasse": k, "n": len(z), "erfolg": len(ok), "erfolgsquote": round(len(ok) / len(z), 2),
                    "iou_median": round(float(np.median([r["iou"] for r in z])), 2),
                    "fehler_laenge_median": med("d_laenge", ok), "fehler_breite_median": med("d_breite", ok),
                    "fehler_hoehe_median": med("d_hoehe", ok),
                    "fehler_laenge_median_alle": med("d_laenge", z), "fehler_breite_median_alle": med("d_breite", z)})
    return out


def main(menge: str) -> None:
    obj = objekte(menge)
    varianten = [(24.0, "klein", True, False, f, g) for g in ("small", "large") for f in (False, True, "laser")] \
        if menge == "dev" else [(tp.FENSTER_M, tp.WAHL, tp.OHNE_HAUSUMRINGE, tp.VERFEINERN, tp.FORM, tp.SAM_GROESSE)]
    erg = {v: [] for v in varianten}
    t0 = time.time()
    for i, r in enumerate(obj):
        pt = tipp_punkt(r["geom"])
        for fen in sorted({v[0] for v in varianten}):
            _, s = tp.ausschnitt_um(pt.x, pt.y, fen)
            for v in varianten:
                if v[0] == fen:
                    erg[v].append(eins(s, r, *v[1:]))
        print(f"{i + 1}/{len(obj)} {r['id']} {r['klasse']} " + " ".join(f"{e[-1]['iou']:.2f}" for e in erg.values()), flush=True)
    bericht = {"menge": menge, "objekte": len(obj), "sekunden": round(time.time() - t0),
               "varianten": [{"fenster_m": v[0], "wahl": v[1], "ohne_hausumringe": v[2], "verfeinern": v[3], "form": v[4], "sam": v[5], "auswertung": auswerten(z), "objekte": z}
                             for v, z in erg.items()]}
    ziel = ROOT / "docs" / "messungen" / f"tipp_{menge}.json"
    ziel.write_text(json.dumps(bericht, indent=1, ensure_ascii=False, default=float), encoding="utf-8")
    for v in bericht["varianten"]:
        print(f"\nFenster ±{v['fenster_m']} m, Wahl {v['wahl']}, verfeinern {v['verfeinern']}, Form {v['form']}, SAM {v['sam']}")
        for a in v["auswertung"]:
            print("  ", a["klasse"], a["n"], "Erfolg", a["erfolgsquote"], "IoU", a["iou_median"], "L/B/H (Erfolg)", a["fehler_laenge_median"], a["fehler_breite_median"], a["fehler_hoehe_median"], "L/B (alle)", a["fehler_laenge_median_alle"], a["fehler_breite_median_alle"])


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "dev")
