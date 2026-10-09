#!/usr/bin/env python3
"""Tests der Maßband-Auswertung (ohne Rohdaten). Aufruf: python3 test_vor_ort.py (oder mit pytest)."""
import importlib

v = importlib.import_module("21_vor_ort_auswerten")

ZEILE = {"objekt_id": "T1", "klasse": "gartenhaus", "rechtswert": "698500.0", "hochwert": "5486500.0",
         "wand_nord_m": "4.00", "wand_ost_m": "3,00", "wand_sued_m": "4.02", "wand_west_m": "2.98",
         "ueberstand_nord_m": "0.30", "ueberstand_ost_m": "0.25", "ueberstand_sued_m": "0.30", "ueberstand_west_m": "0.25",
         "traufhoehe_m": "2.20", "firsthoehe_m": "2.90", "einverstaendnis_eigentuemer": "ja"}


def test_pflichtfelder_und_einverstaendnis():
    assert v.zeile_gueltig(ZEILE) is None
    assert v.zeile_gueltig({**ZEILE, "einverstaendnis_eigentuemer": ""}) == "kein Einverständnis"
    assert "wand_ost_m" in v.zeile_gueltig({**ZEILE, "wand_ost_m": ""})


def test_soll_wand_und_dach():
    s = v.soll(ZEILE)
    assert abs(s["wand_ow"] - 4.01) < 1e-9 and abs(s["wand_ns"] - 2.99) < 1e-9
    assert abs(s["dach_ow"] - 4.51) < 1e-9 and abs(s["dach_ns"] - 3.59) < 1e-9


def test_ausdehnung_gedreht():
    # Rechteck 4 (Ost–West) × 3 (Nord–Süd), um 10° gedreht
    import numpy as np
    from shapely import affinity
    from shapely.geometry import box
    p = affinity.rotate(box(0, 0, 4, 3), 10)
    ow, ns = v.ausdehnung([list(c) for c in list(p.exterior.coords)[:-1]])
    assert abs(ow - 4) < 1e-6 and abs(ns - 3) < 1e-6


def test_vergleich_perfekter_tipp():
    from shapely.geometry import box
    dach = box(0, 0, 4.51, 3.59)
    wand = box(0.25, 0.30, 4.26, 3.29)
    a = {"ok": True, "umriss": [list(c) for c in list(dach.exterior.coords)[:-1]],
         "wand": {"umriss": [list(c) for c in list(wand.exterior.coords)[:-1]], "ueberstand": [0.3, 0.25, 0.3, 0.25],
                  "quelle": ["Annahme"] * 4},
         "masse": {"traufhoehe": 2.25, "firsthoehe": 2.9}}
    e = v.vergleichen(ZEILE, a)
    assert max(abs(x) for x in e["wand_fehler"]) < 0.02
    assert max(abs(x) for x in e["dach_fehler"]) < 0.02
    assert e["traufe_fehler"] == 0.05
    z = v.zusammenfassen([e])
    assert z["ziel_wand"] and z["ziel_dach"]


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
