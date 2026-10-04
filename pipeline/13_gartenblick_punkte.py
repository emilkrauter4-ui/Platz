#!/usr/bin/env python3
"""Gartenblick (AUFTRAG_V2 Phase 5.2): Start-Punktwolke für Gaussian Splatting aus den Laserpunkten (März 2025),
eingefärbt mit dem Luftbild DOP20 (2023). Gleiches lokales System wie gartenblick_render.mjs:
x = UTM-Ost, y = UTM-Nord, z = Ellipsoidhöhe (Normalhöhe DHHN2016 + Quasigeoid GCG2016), Ursprung aus meta.json.

Ausgabe: points3D.txt im COLMAP-Textformat (POINT3D_ID X Y Z R G B ERROR), wie Skyfall-GS es für Satellitendaten liest.

Aufruf: python3 13_gartenblick_punkte.py data/build/gartenblick/grenze [radius_m] [max_punkte]
Danach: python3 13_gartenblick_punkte.py pruefen data/build/gartenblick/grenze
        (Projektion der Punkte in die gerenderten Bilder → Lagefehler Mesh ↔ Laser in Pixeln)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from common import build_dir
from geoid import undulation
from rohdaten import laser, raster


def _ursprung_utm(meta: dict) -> tuple[float, float, float]:
    site = json.loads((Path(__file__).resolve().parent.parent / "app" / "public" / "data" / "site.json").read_text(encoding="utf-8"))
    ox, oy = site["origin"]
    x, y, h = meta["ursprung_lokal"]
    return ox + x, oy + y, h


def punkte(ordner: Path, radius: float = 60.0, max_punkte: int = 400_000) -> int:
    meta = json.loads((ordner / "meta.json").read_text(encoding="utf-8"))
    E0, N0, H0 = _ursprung_utm(meta)
    bb = (np.floor(E0 - radius), np.floor(N0 - radius), np.ceil(E0 + radius), np.ceil(N0 + radius))
    L = laser(bb)
    d = np.hypot(L["x"] - E0, L["y"] - N0)
    m = d <= radius
    x, y, z = L["x"][m], L["y"][m], L["z"].astype(np.float64)[m]
    # nur letzte bzw. einzige Echos und Bodenpunkte dichter als Vegetation braucht es nicht – alles behalten, ausdünnen
    rng = np.random.default_rng(20261004)
    if len(x) > max_punkte:
        k = rng.choice(len(x), max_punkte, replace=False)
        x, y, z = x[k], y[k], z[k]
    h = z + undulation(x, y)  # Normalhöhe → Ellipsoidhöhe
    dop = raster("dop20", bb, 0.2)[:3]
    i = np.clip(((bb[3] - y) / 0.2).astype(int), 0, dop.shape[1] - 1)
    j = np.clip(((x - bb[0]) / 0.2).astype(int), 0, dop.shape[2] - 1)
    rgb = np.nan_to_num(dop[:, i, j].T, nan=128).clip(0, 255).astype(np.uint8)
    X = np.stack([x - E0, y - N0, h - H0], axis=1)
    with open(ordner / "points3D.txt", "w", encoding="utf-8") as f:
        f.write("# 3D point list: POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[]\n")
        f.write(f"# Laser 2025 + DOP20 2023, Bayerische Vermessungsverwaltung (CC BY 4.0); lokal um {E0:.2f} {N0:.2f} {H0:.2f}\n")
        for n, (p, c) in enumerate(zip(X, rgb)):
            f.write(f"{n + 1} {p[0]:.3f} {p[1]:.3f} {p[2]:.3f} {c[0]} {c[1]} {c[2]} 0\n")
    print(f"{len(X)} Punkte → {ordner / 'points3D.txt'} (Radius {radius} m, Höhe {X[:, 2].min():.1f} … {X[:, 2].max():.1f} m)")
    return 0


def pruefen(ordner: Path, n_bilder: int = 12) -> int:
    """Lageprüfung: Laser-Bodenpunkte in Gartenhöhe-/Schrägbilder projizieren und mit dem gerenderten Mesh-Tiefenbild
    vergleichen geht ohne Tiefenbild nicht – stattdessen: Kanten der Gebäude-Laserpunkte (Klasse 6) gegen Bildkanten.
    Einfach und robust: Anteil projizierter Gebäudepunkte, die im Bild auf nicht-Himmel-Pixeln landen, und mittlerer
    Abstand zur nächsten Bildkante (Sobel) in Pixeln."""
    from PIL import Image
    from scipy import ndimage
    meta = json.loads((ordner / "meta.json").read_text(encoding="utf-8"))
    E0, N0, H0 = _ursprung_utm(meta)
    bb = (E0 - 60, N0 - 60, E0 + 60, N0 + 60)
    L = laser(bb)
    m = L["klasse"] == 6
    x, y = L["x"][m], L["y"][m]
    h = L["z"][m].astype(np.float64) + undulation(x, y)
    P = np.stack([x - E0, y - N0, h - H0, np.ones_like(x)], axis=1)
    tr = json.loads((ordner / "transforms_train.json").read_text(encoding="utf-8"))["frames"]
    auswahl = [f for f in tr if f["art"].startswith("ring")][:: max(1, len(tr) // n_bilder)][:n_bilder]
    abst = []
    for f in auswahl:
        c2w = np.array(f["transform_matrix"])
        w2c = np.linalg.inv(c2w)
        Q = (w2c @ P.T).T
        vorne = Q[:, 2] > 1
        u = f["fl_x"] * Q[vorne, 0] / Q[vorne, 2] + f["cx"]
        v = f["fl_y"] * Q[vorne, 1] / Q[vorne, 2] + f["cy"]
        img = np.asarray(Image.open(ordner / f["file_path"]).convert("L"), np.float32)
        kante = np.hypot(ndimage.sobel(img, 0), ndimage.sobel(img, 1)) > 60
        dist = ndimage.distance_transform_edt(~kante)
        im = (u >= 0) & (u < img.shape[1] - 1) & (v >= 0) & (v < img.shape[0] - 1)
        if im.sum() < 50:
            continue
        # nur Punkte nahe an einer Gebäudekante im Laser (Dachrand): Höhenabfall zum Nachbarn
        abst.append(float(np.median(dist[v[im].astype(int), u[im].astype(int)])))
    erg = {"bilder": len(abst), "median_abstand_zur_bildkante_px": round(float(np.median(abst)), 2) if abst else None}
    (ordner / "pruefung.json").write_text(json.dumps(erg, indent=1), encoding="utf-8")
    print(erg)
    return 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "pruefen":
        sys.exit(pruefen(Path(a[1])))
    o = Path(a[0]) if a else build_dir() / "gartenblick" / "grenze"
    sys.exit(punkte(o, float(a[1]) if len(a) > 1 else 60.0, int(a[2]) if len(a) > 2 else 400_000))
