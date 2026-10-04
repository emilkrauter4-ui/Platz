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


def _signale(bb=(0.0, 0.0, 20.0, 20.0), res=0.2):
    """Künstliche Signale für einen 20 × 20 m-Ausschnitt: überall Rasen, in der Mitte ein 3 × 2 m großes Dach (2,4 m)."""
    import numpy as np
    H, W = int((bb[3] - bb[1]) / res), int((bb[2] - bb[0]) / res)
    z = lambda v: np.full((H, W), v, np.float32)
    s = {k: z(0.0) for k in ("dgm", "tuerkis", "las_einzel", "las_ng_anteil", "las_int", "gebaeude_puffer")}
    s.update(ndvi=z(0.5), hell=z(100.0), nir=z(150.0), dom_h=z(0.0), las_h=z(0.0), las_dichte=z(20.0),
             r=z(60.0), g=z(120.0), b=z(50.0), _dist_gebaeude=z(15.0), _bb=list(bb))
    r0, r1, c0, c1 = int((bb[3] - 11) / res), int((bb[3] - 9) / res), int((8.5 - bb[0]) / res), int((11.5 - bb[0]) / res)
    for k, v in (("ndvi", 0.05), ("dom_h", 2.4), ("las_h", 2.4), ("hell", 160.0)):
        s[k][r0:r1, c0:c1] = v
    return s


def test_gezeichnet_ohne_kandidat_wird_lernbeispiel():
    from shapely.geometry import box
    s = _signale()
    c = ls.kandidat_aus_umriss(s, box(8.5, 9, 11.5, 11), "gartenhaus")
    f = c["merkmale"]
    assert c["familie"] == "bau" and f["fam_bau"] == 1.0
    assert abs(f["flaeche"] - 6.0) < 1e-6 and abs(f["laenge"] - 3.0) < 1e-6 and abs(f["breite"] - 2.0) < 1e-6
    assert 2.3 <= f["dom_h_p50"] <= 2.5 and f["ndvi_p50"] < 0.1   # Werte aus dem Inneren des Umrisses
    assert f["sam_score"] == -1
    # gleiche Merkmale wie das Modell sie erwartet
    import pickle
    if ls.g8.MODELL.exists():
        spalten = pickle.loads(ls.g8.MODELL.read_bytes())["spalten"]
        assert set(spalten) <= set(f)


def test_familie_fuer_alle_klassen():
    assert set(ls.FAMILIE_FUER) == set(ls.g8.KLASSEN)
    assert set(ls.FAMILIE_FUER.values()) <= set(ls.g8.FAMILIEN)


def test_import_nimmt_gezeichnete_ohne_kandidat_auf(tmp_path=None):
    """Ende-zu-Ende ohne Rohdaten: Erkennung liefert keinen Kandidaten → 'neu' wird gezeichnetes Lernbeispiel,
    'bestaetigt' ohne Kandidat bleibt draußen, Beitrag neben dem Test-Set wird verworfen."""
    import json
    import pickle
    import tempfile
    from pathlib import Path
    from shapely.geometry import box
    d = Path(tempfile.mkdtemp()) if tmp_path is None else tmp_path
    alt = {n: getattr(ls, n) for n in ("BEISPIELE", "_testflaechen")}
    alt8 = {n: getattr(ls.g8, n) for n in ("ausschnitt", "MODELL")}
    try:
        ls.BEISPIELE = d / "lern.pkl"
        ls.g8.MODELL = d / "modell.pkl"
        ls.g8.MODELL.write_bytes(pickle.dumps({"klassen": ["gartenhaus", "nichts"]}))
        ls._testflaechen = lambda: [box(100, 100, 120, 120)]
        ls.g8.ausschnitt = lambda bb, *a, **k: (_signale(bb), [])
        q = [[8.5, 9], [11.5, 9], [11.5, 11], [8.5, 11]]
        zeilen = [{"id": "a", "aktion": "neu", "klasse": "gartenhaus", "geometrie": q},
                  {"id": "b", "aktion": "bestaetigt", "klasse": "gartenhaus", "geometrie": q},
                  {"id": "c", "aktion": "nachgezogen", "klasse": "gartenhaus", "geometrie": [[p[0] + 100, p[1] + 100] for p in q]}]
        j = d / "lernen.jsonl"
        j.write_text("".join(json.dumps(z) + "\n" for z in zeilen), encoding="utf-8")
        ls.importieren(j)
        b = pickle.loads(ls.BEISPIELE.read_bytes())
        assert b["a"]["quelle"] == "gezeichnet" and b["a"]["ziel"] == "gartenhaus"
        assert b["b"] is None
        assert "c" not in b
    finally:
        for n, v in alt.items():
            setattr(ls, n, v)
        for n, v in alt8.items():
            setattr(ls.g8, n, v)


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
