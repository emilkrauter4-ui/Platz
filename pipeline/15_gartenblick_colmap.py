#!/usr/bin/env python3
"""Gartenblick (Phase 5.3): Datensatz aus gartenblick_render.mjs zusätzlich im COLMAP-Textformat ablegen, damit
gsplat (Apache 2.0, examples/simple_trainer.py) ihn direkt lesen kann – ohne Structure-from-Motion, die Posen sind
exakt bekannt.

  <ordner>/sparse/0/cameras.txt   PINHOLE, eine Kamera je Bildgröße
  <ordner>/sparse/0/images.txt    Weltpunkt → Kamera (w2c) als Quaternion qw qx qy qz und Translation
  <ordner>/sparse/0/points3D.txt  Laserpunkte (aus points3D.txt, ohne Spuren)

Aufruf: python3 15_gartenblick_colmap.py data/build/gartenblick/grenze
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np


def rot_zu_quat(R: np.ndarray) -> np.ndarray:
    """Rotationsmatrix → Quaternion (w, x, y, z), numerisch stabil."""
    t = np.trace(R)
    if t > 0:
        s = np.sqrt(t + 1.0) * 2
        q = [0.25 * s, (R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s]
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = np.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        q = [(R[2, 1] - R[1, 2]) / s, 0.25 * s, (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s]
    elif R[1, 1] > R[2, 2]:
        s = np.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        q = [(R[0, 2] - R[2, 0]) / s, (R[0, 1] + R[1, 0]) / s, 0.25 * s, (R[1, 2] + R[2, 1]) / s]
    else:
        s = np.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
        q = [(R[1, 0] - R[0, 1]) / s, (R[0, 2] + R[2, 0]) / s, (R[1, 2] + R[2, 1]) / s, 0.25 * s]
    q = np.array(q)
    return q / np.linalg.norm(q) * (1 if q[0] >= 0 else -1)


def umwandeln(ordner: Path) -> int:
    frames = []
    for name in ("transforms_train.json", "transforms_test.json"):
        frames += json.loads((ordner / name).read_text(encoding="utf-8"))["frames"]
    ziel = ordner / "sparse" / "0"
    ziel.mkdir(parents=True, exist_ok=True)
    kameras: dict[tuple, int] = {}
    zeilen_k, zeilen_b = [], []
    for i, f in enumerate(frames):
        key = (f["w"], f["h"], round(f["fl_x"], 4), round(f["fl_y"], 4), f["cx"], f["cy"])
        if key not in kameras:
            kameras[key] = len(kameras) + 1
            zeilen_k.append(f"{kameras[key]} PINHOLE {f['w']} {f['h']} {f['fl_x']:.6f} {f['fl_y']:.6f} {f['cx']:.3f} {f['cy']:.3f}")
        w2c = np.linalg.inv(np.array(f["transform_matrix"]))
        q = rot_zu_quat(w2c[:3, :3])
        t = w2c[:3, 3]
        name = Path(f["file_path"]).name
        zeilen_b.append(f"{i + 1} {q[0]:.9f} {q[1]:.9f} {q[2]:.9f} {q[3]:.9f} {t[0]:.6f} {t[1]:.6f} {t[2]:.6f} {kameras[key]} {name}")
        zeilen_b.append("")  # keine 2D-Punkte
    (ziel / "cameras.txt").write_text("# CAMERA_ID MODEL WIDTH HEIGHT PARAMS[]\n" + "\n".join(zeilen_k) + "\n", encoding="utf-8")
    (ziel / "images.txt").write_text("# IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME\n# POINTS2D[] leer\n" + "\n".join(zeilen_b) + "\n", encoding="utf-8")
    shutil.copy(ordner / "points3D.txt", ziel / "points3D.txt")
    print(f"COLMAP: {len(frames)} Bilder, {len(kameras)} Kamera(s) → {ziel}")
    return 0


if __name__ == "__main__":
    sys.exit(umwandeln(Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/build/gartenblick/grenze")))
