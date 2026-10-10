#!/usr/bin/env python3
"""Tests für Mess-Gebiete (common.py, tipp_dienst.gebiet_von). Ohne Rohdaten. Aufruf: python3 test_gebiet.py (oder pytest)."""
import os
import tempfile
from pathlib import Path

import common


def _mit_gebiet(g):
    alt = os.environ.get("PASST_GEBIET")
    if g is None:
        os.environ.pop("PASST_GEBIET", None)
    else:
        os.environ["PASST_GEBIET"] = g
    common.cfg.cache_clear()
    return alt


def _zurueck(alt):
    if alt is None:
        os.environ.pop("PASST_GEBIET", None)
    else:
        os.environ["PASST_GEBIET"] = alt
    common.cfg.cache_clear()


def test_demo_gebiet_unveraendert():
    alt = _mit_gebiet(None)
    try:
        assert common.gebiet_id() is None
        assert common.cfg()["gebiet"]["bbox"] == [698000, 5486000, 700000, 5488000]
        assert len(common.cfg()["demos"]) == 3
        assert common.app_data_dir().name == "data" and common.gebiet_build_dir() == common.build_dir()
    finally:
        _zurueck(alt)


def test_scharhof_gebiet():
    alt = _mit_gebiet("scharhof")
    try:
        c = common.cfg()
        assert c["gebiet"]["bbox"] == [715000, 5491000, 716000, 5493000]
        assert c["demos"] == []                      # Mess-Adresse ist keine Demo
        assert c["gebiet"]["gemeinde_name"] == "Hirschau"
        assert c["gebiet"]["lage"]["bereich"] == "aussen"
        assert common.origin() == (715500.0, 5492000.0)
        assert common.app_data_dir().parts[-2:] == ("gebiete", "scharhof")
        assert common.gebiet_build_dir().parts[-3:] == ("build", "gebiete", "scharhof")
        assert common.build_dir().name == "build"    # gemeinsame Ablage bleibt
    finally:
        _zurueck(alt)


def test_unbekanntes_gebiet_bricht_ab():
    alt = _mit_gebiet("gibtsnicht")
    try:
        try:
            common.gebiet_id()
        except SystemExit as e:
            assert "unbekannt" in str(e)
        else:
            raise AssertionError("kein Abbruch")
    finally:
        _zurueck(alt)


def test_kachel_dateien_filtert_nach_gebiet():
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        for n in ("698_5486", "699_5487", "715_5491", "715_5492", "716_5491", "714_5492", "32715_5491"):
            (d / f"{n}.tif").write_bytes(b"x")
        (d / "meta.tif").write_bytes(b"x")  # kein Kachelname → ignoriert
        namen = lambda bb: sorted(p.stem for p in common.kachel_dateien(d, "tif", bb))
        assert namen([715000, 5491000, 716000, 5493000]) == ["32715_5491", "715_5491", "715_5492"]
        assert namen([698000, 5486000, 700000, 5488000]) == ["698_5486", "699_5487"]
        # Gebiet, das genau an die Kachelkante stößt, nimmt die Nachbarkachel nicht mit
        assert namen([714000, 5491000, 715000, 5492000]) == []


def test_dienst_gebietspruefung():
    import tipp_dienst as d
    assert d.gebiet_von(699000, 5487000) is not None
    assert d.gebiet_von(715500, 5492000) == (715000.0, 5491000.0, 716000.0, 5493000.0)
    assert d.gebiet_von(715010, 5492000, rand=30) is None      # zu nah am Rand
    assert d.gebiet_von(707000, 5490000) is None               # zwischen den Gebieten
    assert common.alle_bboxen()[1] == [715000, 5491000, 716000, 5493000]


if __name__ == "__main__":
    for n, fn in list(globals().items()):
        if n.startswith("test_"):
            fn()
            print("ok", n)
