#!/usr/bin/env python3
"""SAM-2-Bild-Embeddings für „Ein Tipp erfasst“ vorab berechnen, damit pro Tipp nur noch der Prompt-Decoder läuft.

Fenster RASTER_W × RASTER_W (96 m, 480 × 480 DOP20-Pixel) auf einem Gitter im Abstand RASTER_SCHRITT (48 m) ab der
Kachelecke (tipp.raster_fenster). Ein Tipp liegt höchstens 24 m von der Fenstermitte. Gewählt auf dem Dev-Set
(19_tipp_messen.py dev_raster: gleich gut wie das zentrierte 48-m-Fenster).

Gespeichert als float16-Memmaps (wie SAM sie intern rechnet, nur auf 16 bit gerundet):
  data/build/tipp_embed/<kachel>/embed.f16   [N, 256, 64, 64]
                                 hr0.f16     [N, 32, 256, 256]
                                 hr1.f16     [N, 64, 128, 128]
                                 index.json  Gitter, Formen, Prüfsumme des Checkpoints, Datum
N = 22 × 22 = 484 Fenster für eine 1-km-Kachel (≈ 4,1 GB). Rechenzeit ≈ 1,5 s je Fenster auf 4 CPU-Kernen.

  python3 20_tipp_embeddings.py [kachel]          Standard 698_5486
  python3 20_tipp_embeddings.py pruefen [kachel]  Stichprobe: vorberechnet gegen live – Masken müssen gleich sein
"""
from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np

import tipp

g8 = tipp.g8
FORMEN = {"embed": (256, 64, 64), "hr0": (32, 256, 256), "hr1": (64, 128, 128)}


def ziel(kachel: str) -> Path:
    return g8.build_dir() / "tipp_embed" / kachel


def gitter(kachel: str) -> list[tuple[int, int]]:
    ox, oy = (float(v) * 1000 for v in kachel.split("_"))
    i0 = int(round((ox - tipp.RASTER_URSPRUNG[0]) / tipp.RASTER_SCHRITT))
    j0 = int(round((oy - tipp.RASTER_URSPRUNG[1]) / tipp.RASTER_SCHRITT))
    n = int(np.ceil(1000 / tipp.RASTER_SCHRITT)) + 1
    return [(i0 + a, j0 + b) for a in range(n) for b in range(n)]


def rgb_fenster(bb) -> np.ndarray:
    """Exakt das Bild, das tipp.segmentieren() aus g8.signale(bb) bauen würde."""
    rgb = tipp.raster("dop20", bb, g8.RES)[:3]
    return np.clip(np.nan_to_num(np.moveaxis(rgb, 0, -1)), 0, 255).astype(np.uint8)


def berechnen(kachel: str) -> int:
    import torch
    out = ziel(kachel)
    out.mkdir(parents=True, exist_ok=True)
    zellen = gitter(kachel)
    n = len(zellen)
    mm = {k: np.lib.format.open_memmap(out / f"{k}.npy", mode="w+", dtype=np.float16, shape=(n, *f)) for k, f in FORMEN.items()}
    pred = g8._sam()
    ck = g8.build_dir().parent / "raw" / "models" / "sam2.1_hiera_small.pt"
    t0 = time.time()
    for k, (i, j) in enumerate(zellen):
        _, bb = tipp.raster_fenster(*_mitte(i, j))
        pred.set_image(rgb_fenster(bb))
        f = pred._features
        with torch.no_grad():
            mm["embed"][k] = f["image_embed"][0].numpy().astype(np.float16)
            mm["hr0"][k] = f["high_res_feats"][0][0].numpy().astype(np.float16)
            mm["hr1"][k] = f["high_res_feats"][1][0].numpy().astype(np.float16)
        if k % 25 == 0:
            print(f"  {k + 1}/{n} Fenster ({time.time() - t0:.0f} s)", flush=True)
    for a in mm.values():
        a.flush()
    idx = {"kachel": kachel, "zellen": [list(z) for z in zellen], "ursprung": tipp.RASTER_URSPRUNG, "w": tipp.RASTER_W,
           "schritt": tipp.RASTER_SCHRITT, "px": int(round(tipp.RASTER_W / g8.RES)), "formen": FORMEN, "dtype": "float16",
           "checkpoint": ck.name, "checkpoint_sha256": hashlib.sha256(ck.read_bytes()).hexdigest()[:16],
           "erstellt": time.strftime("%Y-%m-%d %H:%M"), "sekunden": round(time.time() - t0)}
    (out / "index.json").write_text(json.dumps(idx, indent=1), encoding="utf-8")
    groesse = sum((out / f"{k}.npy").stat().st_size for k in FORMEN) / 1e9
    print(f"fertig: {n} Fenster in {time.time() - t0:.0f} s, {groesse:.2f} GB → {out}")
    return 0


def _mitte(i: int, j: int) -> tuple[float, float]:
    return tipp.RASTER_URSPRUNG[0] + i * tipp.RASTER_SCHRITT, tipp.RASTER_URSPRUNG[1] + j * tipp.RASTER_SCHRITT


def pruefen(kachel: str, n: int = 20) -> int:
    """Gleiche Tipps einmal mit live gerechnetem und einmal mit vorberechnetem Embedding: IoU der Masken."""
    sp = tipp.EmbeddingSpeicher.laden(kachel)
    rng = np.random.default_rng(1)
    ox, oy = (float(v) * 1000 for v in kachel.split("_"))
    ious = []
    for _ in range(n):
        x, y = ox + rng.uniform(50, 950), oy + rng.uniform(50, 950)
        _, bb = tipp.raster_fenster(x, y)
        s = g8.signale(bb)
        live = tipp.segmentieren(s, x, y, form=False, vorberechnet=False)
        s.pop("_sam_bb", None)
        vor = tipp.segmentieren(s, x, y, form=False, vorberechnet=True, speicher=sp)
        if live is None and vor is None:
            continue
        if live is None or vor is None:
            ious.append(0.0)
            continue
        ious.append(live["geom"].intersection(vor["geom"]).area / max(live["geom"].union(vor["geom"]).area, 1e-9))
    print(f"{len(ious)} Tipps: IoU live ↔ vorberechnet Median {np.median(ious):.3f}, Minimum {min(ious):.3f}")
    return 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "pruefen":
        sys.exit(pruefen(a[1] if len(a) > 1 else "698_5486"))
    sys.exit(berechnen(a[0] if a else "698_5486"))
