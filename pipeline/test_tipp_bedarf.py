#!/usr/bin/env python3
"""Tests für Embeddings bei Bedarf (ohne Rohdaten und ohne SAM). Aufruf: python3 test_tipp_bedarf.py (oder pytest)."""
import tempfile
from pathlib import Path

import numpy as np

import tipp


def test_zellen_fuer_bereich_deckt_jeden_tipp():
    xmin, ymin, xmax, ymax = 698500.0, 5487200.0, 698530.0, 5487240.0
    z = set(tipp.zellen_fuer_bereich(xmin, ymin, xmax, ymax))
    rng = np.random.default_rng(0)
    for _ in range(500):  # jeder Tipp im Grundstück plus 20 m Rand findet sein Fenster in der Liste
        x, y = rng.uniform(xmin - 20, xmax + 20), rng.uniform(ymin - 20, ymax + 20)
        assert tipp.raster_fenster(x, y)[0] in z
    assert len(z) <= 9


def test_cache_fp16_und_obergrenze():
    import torch
    with tempfile.TemporaryDirectory() as d:
        c = tipp.EmbeddingCache(Path(d))
        f = {"image_embed": torch.rand(1, 256, 64, 64), "high_res_feats": [torch.rand(1, 32, 256, 256), torch.rand(1, 64, 128, 128)]}
        c.speichern((1, 2), f)
        g = c.features((1, 2))
        assert g["image_embed"].dtype == torch.float32 and g["image_embed"].shape == (1, 256, 64, 64)
        assert float((g["image_embed"] - f["image_embed"]).abs().max()) < 1e-3  # fp16-Rundung
        c.speichern((1, 3), f)
        assert c.aufraeumen(max_gb=0.01) == 1  # älteste zuerst
        assert not c.hat((1, 2)) or not c.hat((1, 3))
        assert c.features((9, 9)) is None


if __name__ == "__main__":
    for n, fn in list(globals().items()):
        if n.startswith("test_"):
            fn()
            print("ok", n)
