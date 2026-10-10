#!/usr/bin/env python3
"""Tests: Rechteck-Regel mit Totband und „Kein Objekt gefunden“. Der Fall, der bei fp16 ↔ fp32 gekippt ist
(23_tipp_bedarf.py fp16, Zufallspunkt 698054,74 / 5486789,11: Fläche/Rechteck 0,6005 mit fp32, 0,5987 mit fp16,
SAM-Score 0,064, P(nichts) 0,9997), ist als fester Fall drin. Der Teil mit Rohdaten wird übersprungen, wenn sie fehlen.
Aufruf: python3 test_tipp_form.py (oder pytest)."""
import numpy as np

import tipp

GEKIPPT = (698054.738774109, 5486789.105576544)


def test_totband_gekippter_fall_gleich():
    for bau in (False, True):
        assert tipp.rechteck_entscheidung(0.6005, bau) == tipp.rechteck_entscheidung(0.5987, bau)
    assert tipp.rechteck_entscheidung(0.66, False) is True
    assert tipp.rechteck_entscheidung(0.54, True) is False
    assert tipp.rechteck_entscheidung(0.60, True) is True and tipp.rechteck_entscheidung(0.60, False) is False


def test_kein_objekt_regel():
    assert tipp.kein_objekt(0.064, 0.9997, None)
    assert not tipp.kein_objekt(0.064, 0.9997, "terrasse")  # Nutzer sagt, was es ist → Umriss liefern
    assert not tipp.kein_objekt(0.25, 0.9997, None)
    assert not tipp.kein_objekt(0.064, 0.95, None)


def _rohdaten_da() -> bool:
    try:
        return any((tipp.g8.build_dir().parent / "raw" / "dop20").glob("*.tif"))
    except Exception:  # noqa: BLE001
        return False


def test_gekippter_fall_mit_rohdaten():
    if not _rohdaten_da():
        print("übersprungen: keine Rohdaten")
        return
    import torch
    x, y = GEKIPPT
    _, bb = tipp.raster_fenster(x, y)
    s = tipp.g8.signale(bb)
    pred = tipp._sam()
    pred.set_image(tipp.fenster_bild(bb))
    f32 = {"image_embed": pred._features["image_embed"].clone(), "high_res_feats": [t.clone() for t in pred._features["high_res_feats"]]}
    r = lambda t: torch.from_numpy(t.numpy().astype(np.float16).astype(np.float32))
    f16 = {"image_embed": r(f32["image_embed"]), "high_res_feats": [r(t) for t in f32["high_res_feats"]]}
    umrisse = []
    for f in (f32, f16):
        s.pop("_sam_bb", None)
        seg = tipp.segmentieren(s, x, y, form=True, vorberechnet=True, speicher=tipp._Fest(f))
        umrisse.append(seg["geom"])
    a, b = umrisse
    assert a.intersection(b).area / a.union(b).area >= 0.99  # mit Totband nicht mehr gekippt
    s.pop("_sam_bb", None)
    erg = tipp.erfassen(x, y, s=s)
    assert erg["ok"] is False and erg.get("kein_objekt") is True


if __name__ == "__main__":
    for n, fn in list(globals().items()):
        if n.startswith("test_"):
            fn()
            print("ok", n)
