#!/usr/bin/env python3
"""„Ein Tipp erfasst“ messen: simulierter Tipp in die Objektmitte, SAM 2 segmentiert, Vergleich mit der Referenz.

  python3 19_tipp_messen.py dev     Varianten auf dem Entwicklungs-Set (alte Referenz, nur split=dev) – zum Einstellen
  python3 19_tipp_messen.py test_v2 dasselbe gegen die korrigierte Referenz v2 (globaler Versatz, 17_testset_objekte.py)
  python3 19_tipp_messen.py objektpruefung   Regel „Kein Objekt gefunden“: Tipps auf alle annotierten Objekte und auf
                                    leere Stellen (≥ 1,5 m von Objekten und Gebäuden) der Referenz-Grundstücke, dev und
                                    test getrennt → docs/messungen/tipp_objektpruefung.json/.md
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
    if menge in ("dev", "dev_raster"):
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
        if menge == "dev" else [(24.0, "klein", True, False, True, "small"), (("raster", 48.0, 24.0), "klein", True, False, True, "small"),
                                (("raster", 96.0, 48.0), "klein", True, False, True, "small"), (("raster", 96.0, 32.0), "klein", True, False, True, "small")] \
        if menge == "dev_raster" else [(tp.FENSTER_M, tp.WAHL, tp.OHNE_HAUSUMRINGE, tp.VERFEINERN, tp.FORM, tp.SAM_GROESSE)]
    erg = {v: [] for v in varianten}
    t0 = time.time()
    for i, r in enumerate(obj):
        pt = tipp_punkt(r["geom"])
        for fen in sorted({v[0] for v in varianten}, key=str):
            if isinstance(fen, tuple):
                _, bb = tp.raster_fenster(pt.x, pt.y, fen[1], fen[2])
                s = g8.signale(bb)
            else:
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


def objektpruefung() -> None:
    from shapely.geometry import Point
    from shapely.ops import unary_union
    gs = json.load(open(ROOT / "data/reference/grundstuecke.geojson", encoding="utf-8"))["features"]
    ref = json.load(open(ROOT / "data/reference/referenz.geojson", encoding="utf-8"))["features"]
    geb = [shape(b["geometry"]) for b in json.load(open(g8.build_dir() / "buildings.geojson", encoding="utf-8"))["features"]]
    rng = np.random.default_rng(11)
    taps = []
    for f in gs:
        g, gid, split = shape(f["geometry"]), f["properties"]["id"], f["properties"]["split"]
        obj = [(r["properties"]["klasse"], shape(r["geometry"])) for r in ref if r["properties"]["grundstueck"] == gid]
        for k, o in obj:
            taps.append((split, "objekt", k, tipp_punkt(o)))
        sperr = unary_union([o for _, o in obj] + [h for h in geb if h.intersects(g)]).buffer(1.5)
        n = 0
        for _ in range(200):
            p = Point(rng.uniform(*g.bounds[0::2]), rng.uniform(*g.bounds[1::2]))
            if g.buffer(-1).contains(p) and not sperr.contains(p):
                taps.append((split, "leer", None, p))
                n += 1
                if n == 3:
                    break
    zeilen = []
    t0 = time.time()
    for i, (split, art, k, p) in enumerate(taps):
        _, bb = tp.raster_fenster(p.x, p.y)
        s = g8.signale(bb)
        seg = tp.segmentieren(s, p.x, p.y, form=False)
        z = {"split": split, "art": art, "klasse": k, "umriss": seg is not None}
        if seg is not None:
            w = tp.wahrscheinlichkeiten(s, seg["geom"])
            z.update(score=round(seg["sam_score"], 3), nichts=round(w.get("nichts", 0.0), 4),
                     abgelehnt=tp.kein_objekt(seg["sam_score"], w.get("nichts", 0.0), None))
        zeilen.append(z)
        if i % 25 == 0:
            print(f"{i + 1}/{len(taps)} ({time.time() - t0:.0f} s)", flush=True)
    erg = {}
    for split in ("dev", "test"):
        z = [r for r in zeilen if r["split"] == split and r["umriss"]]
        gruppe = lambda r: "leere Stelle" if r["art"] == "leer" else ("Bau/Pool/Trampolin" if r["klasse"] in KLASSEN else "Vegetation/Terrasse/Zaun")
        erg[split] = {g: {"n": sum(gruppe(r) == g for r in z), "abgelehnt": sum(gruppe(r) == g and r["abgelehnt"] for r in z)}
                      for g in ("leere Stelle", "Bau/Pool/Trampolin", "Vegetation/Terrasse/Zaun")}
    out = ROOT / "docs" / "messungen"
    (out / "tipp_objektpruefung.json").write_text(json.dumps({"regel": {"score_unter": tp.KEIN_OBJEKT_SCORE, "nichts_ab": tp.KEIN_OBJEKT_NICHTS},
                                                             "ergebnis": erg, "tipps": zeilen}, indent=1, ensure_ascii=False), encoding="utf-8")
    pz = lambda e: f"{e['abgelehnt']} von {e['n']} ({100 * e['abgelehnt'] / max(e['n'], 1):.0f} %)".replace(".", ",")
    md = [f"# „Kein Objekt gefunden“ ({time.strftime('%Y-%m-%d')})", "",
          f"Regel (tipp.kein_objekt): SAM-Score < {tp.KEIN_OBJEKT_SCORE} und P(nichts) ≥ {tp.KEIN_OBJEKT_NICHTS}, nur ohne vom Nutzer",
          "gewählte Klasse (in der App immer: die Art wird erst nach dem Tipp gewählt). Gewählt auf dev, test nur gemessen.",
          "Tipps auf alle annotierten Objekte der 60 Referenz-Grundstücke (Objektmitte) und je Grundstück 3 leere Stellen",
          "(≥ 1,5 m von jedem annotierten Objekt und jedem Gebäude). Gezählt sind Tipps, bei denen SAM überhaupt einen Umriss liefert.", "",
          "| | dev: abgelehnt | test: abgelehnt |", "|---|---|---|"]
    for g in ("leere Stelle", "Bau/Pool/Trampolin", "Vegetation/Terrasse/Zaun"):
        md.append(f"| {g} | {pz(erg['dev'][g])} | {pz(erg['test'][g])} |")
    md += ["", "Ehrlich: Die Regel ist vorsichtig. Sie lehnt fast keine echten Bauten ab, erkennt aber nur einen kleinen Teil",
           "der leeren Stellen. SAM findet fast immer irgendeine zusammenhängende Fläche (Pflaster, Beet, Teil eines Nachbarobjekts),",
           "und der Klassifikator sagt auch bei vielen echten Gartenhäusern „nichts“ (er ist auf Kandidaten der Vollautomatik",
           "trainiert, nicht auf Tipps). Wer auf eine leere Stelle tippt, bekommt deshalb meist trotzdem einen Umriss – mit",
           "Label „erfasst per Tipp“ und der Frage „Stimmt der Umriss?“.", ""]
    (out / "tipp_objektpruefung.md").write_text("\n".join(md), encoding="utf-8")
    print("\n".join(md))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "objektpruefung":
        objektpruefung()
    else:
        main(sys.argv[1] if len(sys.argv) > 1 else "dev")
