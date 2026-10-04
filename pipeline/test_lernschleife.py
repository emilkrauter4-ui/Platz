#!/usr/bin/env python3
"""Tests der Freigaberegel (Phase 4.2). Aufruf: python3 test_lernschleife.py (oder mit pytest)."""
import importlib

ls = importlib.import_module("12_lernschleife")


def zeile(k, ref, p, r):
    return {"klasse": k, "ref": ref, "praezision": p, "trefferquote": r}


def test_gleich_gut_wird_freigegeben():
    alt = [zeile("gartenhaus", 2, 0.17, 0.5), zeile("pool", 0, None, None)]
    ok, _ = ls.freigabe(alt, [zeile("gartenhaus", 2, 0.17, 0.5)])
    assert ok


def test_schlechter_in_einer_klasse_wird_abgelehnt():
    alt = [zeile("gartenhaus", 2, 0.17, 0.5), zeile("nebengebaeude", 3, 0.33, 0.67)]
    neu = [zeile("gartenhaus", 2, 0.5, 0.5), zeile("nebengebaeude", 3, 0.25, 0.67)]
    ok, gruende = ls.freigabe(alt, neu)
    assert not ok
    assert any("nebengebaeude" in g and "schlechter" in g for g in gruende)


def test_klassen_ohne_referenz_zaehlen_nicht():
    alt = [zeile("pool", 0, None, None), zeile("gartenhaus", 2, 0.2, 0.5)]
    neu = [zeile("pool", 0, 0.0, None), zeile("gartenhaus", 2, 0.25, 0.5)]
    assert ls.freigabe(alt, neu)[0]


def test_fehlende_klasse_im_neuen_modell_ist_schlechter():
    alt = [zeile("carport_garage", 1, 1.0, 1.0)]
    assert not ls.freigabe(alt, [])[0]


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
