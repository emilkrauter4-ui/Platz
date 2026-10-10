#!/usr/bin/env python3
"""Garten-Erkennung mit Maßen (AUFTRAG_V2, Phase 1.3/1.4).

Ablauf je Ausschnitt (Grundstück oder 250-m-Block):
  1. Signale auf 20 cm: DOP20 RGB/CIR (NDVI, Wasser), DOM20 − DGM1, Laser (Höhe, Echos, Intensität, Punktdichte),
     Masken aus Hausumringen/LoD2 und ALKIS Tatsächliche Nutzung.
  2. Kandidaten aus Regeln je Familie: erhöhte harte Flächen (Bauten), Vegetation, Wasser, flache befestigte Flächen,
     runde Objekte (Trampolin).
  3. Umrisse mit SAM 2 (Box- und Punkt-Prompt aus dem Kandidaten) auf DOP20 schärfen, wo die Familie das braucht.
  4. Merkmale je Kandidat → Gradient Boosting (trainiert auf dem Entwicklungs-Set) → Klasse und Konfidenz.
  5. Maße: minimales gedrehtes Rechteck oder Kreis, Höhe aus Laser-Perzentil über Boden, Dachebenen per RANSAC
     (Traufe, First, mittlere Wandhöhe), Spanne je Maß.

  python3 08_garten.py merkmale            Kandidaten + Merkmale für alle Referenz-Grundstücke (Cache)
  python3 08_garten.py trainieren          Modell auf dem Entwicklungs-Set (Kreuzvalidierung nach Grundstück)
  python3 08_garten.py gebiet              Erkennung für das ganze Gebiet → data/build/garten.geojson
"""
from __future__ import annotations

import json
import pickle
import sys
from functools import lru_cache

import geopandas as gpd
import numpy as np
import pandas as pd
from rasterio import features
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from scipy import ndimage
from shapely.geometry import Point, Polygon, mapping, shape
from shapely.ops import unary_union

from common import build_dir, cfg, gebiet_build_dir
from rohdaten import laser, raster

RES = 0.2
REF = build_dir().parent / "reference"
MODELL = build_dir() / "garten_modell.pkl"
KLASSEN = ["gartenhaus", "gewaechshaus", "carport_garage", "pool", "teich", "terrasse", "trampolin",
           "spielturm", "hecke", "baum", "strauch", "waermepumpe", "zaun_mauer"]
FAMILIEN = ["bau", "vegetation", "streifen", "wasser", "flach", "rund"]


# ---------------------------------------------------------------- 1. Signale

@lru_cache
def _gebaeude():
    # Demo-Gebiet und alle Mess-Gebiete (data/build/gebiete/<id>/buildings.geojson): der Tipp-Dienst arbeitet übergreifend
    teile = [build_dir() / "buildings.geojson"] + sorted((build_dir() / "gebiete").glob("*/buildings.geojson"))
    frames = [gpd.read_file(p).set_crs(25832, allow_override=True) for p in teile if p.exists()]
    return gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=25832)


def _rasterize(geoms, bb, shape_):
    geoms = [g for g in geoms if not g.is_empty]
    if not geoms:
        return np.zeros(shape_, bool)
    return features.rasterize(((g, 1) for g in geoms), out_shape=shape_, transform=from_origin(bb[0], bb[3], RES, RES),
                              fill=0, dtype=np.uint8).astype(bool)


def signale(bb) -> dict[str, np.ndarray]:
    """Alle Signale auf dem 20-cm-Gitter des Ausschnitts bb = (x0, y0, x1, y1)."""
    s: dict[str, np.ndarray] = {}
    rgb = raster("dop20", bb, RES)
    cir = raster("cir", bb, RES)  # 1 = NIR, 2 = Rot, 3 = Grün
    s["r"], s["g"], s["b"] = rgb
    s["nir"] = cir[0]
    s["ndvi"] = (cir[0] - cir[1]) / np.maximum(cir[0] + cir[1], 1)
    hell = rgb.mean(0)
    s["hell"] = hell
    # Wasser: im NIR fast schwarz; Pools zusätzlich türkis (Blau und Grün deutlich über Rot)
    s["tuerkis"] = ((rgb[2] - rgb[0]) + 0.5 * (rgb[1] - rgb[0])) / np.maximum(hell, 1)
    s["nir_rel"] = cir[0] / np.maximum(hell, 1)
    dgm = raster("dgm1", bb, RES)[0]
    s["dgm"] = dgm
    s["dom_h"] = raster("dom20", bb, RES)[0] - dgm
    # Laser: Punkte direkt auf 0,2 m (Zelle) und geglättet auf 0,6 m (3×3), da ~20 Punkte/m²
    p = laser(bb)
    H, W = dgm.shape
    col = ((p["x"] - bb[0]) / RES).astype(int)
    row = ((bb[3] - p["y"]) / RES).astype(int)
    ok = (col >= 0) & (col < W) & (row >= 0) & (row < H)
    col, row = col[ok], row[ok]
    z = p["z"][ok] - dgm[row, col]
    kl, echos, inten = p["klasse"][ok], p["echos"][ok], p["intensitaet"][ok].astype(np.float32)
    ng = ~np.isin(kl, [2, 7, 18])
    top = np.full((H, W), -np.inf, np.float32)
    np.maximum.at(top, (row[ng], col[ng]), z[ng])
    n_all = np.zeros((H, W), np.float32)
    np.add.at(n_all, (row, col), 1)
    n_ng = np.zeros((H, W), np.float32)
    np.add.at(n_ng, (row[ng], col[ng]), 1)
    n_single = np.zeros((H, W), np.float32)
    np.add.at(n_single, (row[ng & (echos == 1)], col[ng & (echos == 1)]), 1)
    isum = np.zeros((H, W), np.float32)
    np.add.at(isum, (row, col), inten)
    k = np.ones((3, 3), np.float32)
    conv = lambda a: ndimage.convolve(a, k, mode="nearest")
    top3 = ndimage.maximum_filter(np.where(np.isfinite(top), top, -np.inf), size=3)
    s["las_h"] = np.where(np.isfinite(top3), top3, 0.0).astype(np.float32)
    s["las_h"][(conv(n_all) > 0) & ~np.isfinite(top3)] = 0.0
    s["las_dichte"] = conv(n_all) / (9 * RES * RES)                     # Punkte/m²
    s["las_ng_anteil"] = conv(n_ng) / np.maximum(conv(n_all), 1)       # Anteil über Boden
    s["las_einzel"] = np.where(conv(n_ng) > 0, conv(n_single) / np.maximum(conv(n_ng), 1), np.nan)
    s["las_int"] = conv(isum) / np.maximum(conv(n_all), 1)
    # Masken
    geb = _gebaeude().cx[bb[0]:bb[2], bb[1]:bb[3]]
    s["gebaeude"] = _rasterize(list(geb.geometry), bb, (H, W))
    s["gebaeude_puffer"] = _rasterize(list(geb.geometry.buffer(0.6)), bb, (H, W))
    s["verkehr"] = _verkehr(bb, (H, W))
    s["_dist_gebaeude"] = (ndimage.distance_transform_edt(~s["gebaeude"]) * RES).astype(np.float32) \
        if s["gebaeude"].any() else np.full((H, W), 50.0, np.float32)
    s["_laser"] = {"x": p["x"], "y": p["y"], "z": p["z"], "klasse": p["klasse"], "echos": p["echos"]}
    s["_bb"] = np.array(bb)
    return s


def _verkehr(bb, shape_):
    import importlib
    best = importlib.import_module("02_bestand")
    c = cfg()["bestand"]
    tn = best._tn_verkehr(tuple(c["verkehr_klassen"]))
    sub = tn.cx[bb[0]:bb[2], bb[1]:bb[3]]
    return _rasterize(list(sub.geometry), bb, shape_)


# ---------------------------------------------------------------- 2. Kandidaten

# Masken werden nur im umschließenden Fenster gespeichert: c["maske"] (bool) ab c["fenster"] = (Zeile, Spalte).
# Auf einem 250-m-Block mit Hunderten Kandidaten wären volle Masken zu groß.

def _aus_labels(lab: np.ndarray, bb, min_m2: float, familie: str, max_m2: float = 1e9) -> list[dict]:
    out = []
    for v, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is None:
            continue
        sub = lab[sl] == v
        if not (min_m2 <= sub.sum() * RES * RES * 1.3 and sub.sum() * RES * RES <= max_m2 * 1.3):
            continue
        tr = from_origin(bb[0] + sl[1].start * RES, bb[3] - sl[0].start * RES, RES, RES)
        polys = [shape(g).buffer(0) for g, val in features.shapes(sub.astype(np.uint8), mask=sub, transform=tr) if val]
        if not polys:
            continue
        poly = unary_union(polys)
        if poly.geom_type != "Polygon":
            poly = max(poly.geoms, key=lambda p: p.area)
        if min_m2 <= poly.area <= max_m2:
            out.append({"familie": familie, "geom": poly, "maske": sub, "fenster": (sl[0].start, sl[1].start)})
    return out


def _komponenten(mask: np.ndarray, bb, min_m2: float, familie: str, max_m2: float = 1e9) -> list[dict]:
    lab, _ = ndimage.label(mask)
    return _aus_labels(lab, bb, min_m2, familie, max_m2)


def _maske_aus_geom(g, bb, shape_) -> tuple[np.ndarray, tuple[int, int]]:
    x0, y0, x1, y1 = g.bounds
    r0, c0 = max(int((bb[3] - y1) / RES) - 1, 0), max(int((x0 - bb[0]) / RES) - 1, 0)
    r1, c1 = min(int((bb[3] - y0) / RES) + 2, shape_[0]), min(int((x1 - bb[0]) / RES) + 2, shape_[1])
    sub = features.rasterize([(g, 1)], out_shape=(max(r1 - r0, 1), max(c1 - c0, 1)),
                             transform=from_origin(bb[0] + c0 * RES, bb[3] - r0 * RES, RES, RES), fill=0, dtype=np.uint8).astype(bool)
    return sub, (r0, c0)


def _voll(c: dict, shape_) -> np.ndarray:
    m = np.zeros(shape_, bool)
    r0, c0 = c["fenster"]
    h, w = c["maske"].shape
    m[r0:r0 + h, c0:c0 + w] = c["maske"]
    return m


def kandidaten(s: dict, gebiet: Polygon | None = None) -> list[dict]:
    """Kandidaten je Familie. Die Regeln sind bewusst großzügig: aussortieren macht der Klassifikator."""
    bb = tuple(s["_bb"])
    H, W = s["dgm"].shape
    # Grenzhecken stehen oft genau auf oder knapp hinter der (nachgezeichneten) Grenze: 3 m Rand
    innen = np.ones((H, W), bool) if gebiet is None else _rasterize([gebiet.buffer(3.0)], bb, (H, W))
    frei = innen & ~s["gebaeude"]
    lh = s["las_h"]
    dh = np.nan_to_num(s["dom_h"])
    einzel = np.nan_to_num(s["las_einzel"], nan=0)
    ndvi = s["ndvi"]
    out = []
    # Bauten: Laser (2025) ODER DOM (2023) im Höhenband und hart (Einzelecho bzw. kein Grün)
    # Bauten aus dem Laser (scharfe Kanten). Das DOM (Bildkorrelation) glättet ~1 m und verschmilzt Schatten und
    # Hauskanten mit Kleinbauten – es geht nur als Merkmal ein.
    bau = (lh >= 1.2) & (lh <= 6.5) & (einzel >= 0.5) & frei & ~s["gebaeude_puffer"] & ~s["verkehr"]
    bau = ndimage.binary_opening(bau, np.ones((5, 5)))
    bau = ndimage.binary_fill_holes(bau)
    out += _komponenten(bau, bb, 1.5, "bau", 150)
    # Vegetation: Grün im Bild (2023) oder Mehrfachechos im laubfreien Laser (2025), über 0,4 m
    # (dichte, geschnittene Hecken geben im Laser Einzelechos: grün im Bild + Höhe in einer der Epochen reicht)
    veg = (((ndvi > 0.25) & (np.maximum(dh, lh) > 0.5)) | ((lh > 0.5) & (einzel < 0.5) & (s["las_ng_anteil"] > 0.2))) & frei
    veg = ndimage.binary_opening(veg, np.ones((3, 3)))
    hoch = np.maximum(lh, dh)
    # Bäume: Kronen über 4 m mit Wasserscheide an lokalen Maxima trennen
    import skimage.segmentation as seg
    from skimage.feature import peak_local_max
    hv = ndimage.gaussian_filter(np.where(veg, hoch, 0), 3)
    baum = veg & (hv > 3.5)
    if baum.any():
        pk = peak_local_max(hv, min_distance=12, threshold_abs=4.0, labels=baum.astype(int))
        mk = np.zeros((H, W), np.int32)
        for i, (r, c) in enumerate(pk, 1):
            mk[r, c] = i
        lab = seg.watershed(-hv, mk, mask=baum)
        out += _aus_labels(lab, bb, 4.0, "vegetation")
    out += _komponenten(veg & ~baum, bb, 1.0, "vegetation")
    # Hecken: schmale Vegetationsstreifen (< 2,4 m breit) als eigene Kandidaten, sonst verschmelzen sie mit Bäumen
    # (auch gebogen: Länge über das Skelett, mittlere Breite = Fläche / Länge)
    from skimage.morphology import disk, skeletonize
    breit = ndimage.binary_opening(veg, structure=disk(8))
    schmal = ndimage.binary_opening(veg & ~breit, np.ones((3, 3)))
    for c in _komponenten(schmal, bb, 2.0, "vegetation"):
        l = skeletonize(c["maske"]).sum() * RES
        w = c["geom"].area / max(l, 0.1)
        if l >= 3.0 and l / max(w, 0.1) >= 3.0:
            c["familie"] = "streifen"
            out.append(c)
    # Wasser: türkis (Pool) oder im NIR dunkel bei geringem Grün, flach, keine Laser-Höhe über 1,6 m
    # Wasser: türkis (Pool) oder im NIR dunkel UND kaum Laserechos (Wasser schluckt den Laser, Schatten nicht)
    dichte_ref = float(np.nanmedian(s["las_dichte"][frei])) if frei.any() else 20.0
    wenig_echo = s["las_dichte"] < 0.4 * dichte_ref
    wasser = (((s["tuerkis"] > 0.35) & (s["hell"] > 60)) | ((s["nir"] < 55) & (ndvi < 0.05) & wenig_echo)) \
        & (lh < 1.6) & frei & ~s["verkehr"]
    wasser = ndimage.binary_opening(wasser, np.ones((3, 3)))
    out += _komponenten(ndimage.binary_fill_holes(wasser), bb, 2.0, "wasser", 120)
    # Flach befestigt: kein Grün, flach, kein Wasser
    flach = (ndvi < 0.12) & (np.maximum(dh, lh) < 0.5) & frei & ~wasser & ~s["verkehr"]
    flach = ndimage.binary_opening(flach, np.ones((5, 5)))
    out += _komponenten(flach, bb, 4.0, "flach", 400)
    # Rund: Trampoline (dunkle Matte, Kreis 2,4–4,6 m)
    import cv2
    grau = np.clip(np.nan_to_num(s["hell"]), 0, 255).astype(np.uint8)
    kreise = cv2.HoughCircles(cv2.GaussianBlur(grau, (5, 5), 1.5), cv2.HOUGH_GRADIENT, dp=1, minDist=15,
                              param1=60, param2=22, minRadius=6, maxRadius=12)
    if kreise is not None:
        for cx, cy, r in kreise[0]:
            rr, cc = int(cy), int(cx)
            if not (0 <= rr < H and 0 <= cc < W) or not frei[rr, cc]:
                continue
            if s["hell"][max(rr - 3, 0):rr + 4, max(cc - 3, 0):cc + 4].mean() > 90:
                continue
            g = Point(bb[0] + (cx + 0.5) * RES, bb[3] - (cy + 0.5) * RES).buffer(r * RES, 24)
            sub, fe = _maske_aus_geom(g, bb, (H, W))
            out.append({"familie": "rund", "geom": g, "maske": sub, "fenster": fe})
    for k, c in enumerate(out):
        c["kid"] = k
    return out


# ---------------------------------------------------------------- 3. Umrisse mit SAM 2

_PRED = None


def _sam():
    global _PRED
    if _PRED is None:
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        torch.set_num_threads(4)
        ck = build_dir().parent / "raw" / "models" / "sam2.1_hiera_small.pt"
        _PRED = SAM2ImagePredictor(build_sam2("configs/sam2.1/sam2.1_hiera_s.yaml", str(ck), device="cpu"))
    return _PRED


SAM_FAMILIEN = {"bau", "wasser", "rund", "flach"}


def sam_umrisse(s: dict, kand: list[dict]) -> None:
    """Für Bauten, Wasser, Rundes und Flaches: SAM-2-Maske aus Box (+ positivem Punkt im Kandidaten).
    Übernommen wird sie nur, wenn sie zum Kandidaten passt (IoU ≥ 0,3); sonst bleibt der Regel-Umriss."""
    bb = tuple(s["_bb"])
    todo = [c for c in kand if c["familie"] in SAM_FAMILIEN]
    if not todo:
        return
    pred = _sam()
    rgb = np.stack([s["r"], s["g"], s["b"]], -1)
    pred.set_image(np.clip(np.nan_to_num(rgb), 0, 255).astype(np.uint8))
    shape_ = s["dgm"].shape
    for c in todo:
        voll = _voll(c, shape_)
        rr, cc = np.nonzero(voll)
        if len(rr) == 0:
            continue
        pad = 3
        box = np.array([cc.min() - pad, rr.min() - pad, cc.max() + pad, rr.max() + pad])
        ip = c["geom"].representative_point()
        pt = np.array([[(ip.x - bb[0]) / RES, (bb[3] - ip.y) / RES]])
        m, sc, _ = pred.predict(box=box, point_coords=pt, point_labels=np.array([1]), multimask_output=False)
        m = m[0] > 0
        inter = (m & voll).sum()
        iou = inter / max((m | voll).sum(), 1)
        c["sam_score"], c["sam_iou"] = float(sc[0]), float(iou)
        if iou >= 0.3:
            tr = from_origin(bb[0], bb[3], RES, RES)
            polys = [shape(g).buffer(0) for g, v in features.shapes(m.astype(np.uint8), mask=m, transform=tr) if v]
            if polys:
                c["geom_regel"] = c["geom"]
                c["geom"] = max(polys, key=lambda p: p.area)
                c["maske"], c["fenster"] = _maske_aus_geom(c["geom"], bb, m.shape)


# ---------------------------------------------------------------- 4. Merkmale

def _kreisfoermigkeit(p: Polygon) -> float:
    return 4 * np.pi * p.area / max(p.length ** 2, 1e-9)


def merkmale(s: dict, c: dict) -> dict[str, float]:
    """Merkmale im Fenster um den Kandidaten (Rand 8 Pixel für Umfeld und Kanten)."""
    g = c["geom"]
    H, W = s["dgm"].shape
    r0, c0 = c["fenster"]
    h, w = c["maske"].shape
    P = 8
    R0, C0, R1, C1 = max(r0 - P, 0), max(c0 - P, 0), min(r0 + h + P, H), min(c0 + w + P, W)
    m = np.zeros((R1 - R0, C1 - C0), bool)
    m[r0 - R0:r0 - R0 + h, c0 - C0:c0 - C0 + w] = c["maske"][:R1 - r0, :C1 - c0]
    if not m.any():
        sub, (a, b) = _maske_aus_geom(g.buffer(0.1), tuple(s["_bb"]), (H, W))
        m = np.zeros((R1 - R0, C1 - C0), bool)
        ra, cb = max(a - R0, 0), max(b - C0, 0)
        m[ra:ra + sub.shape[0], cb:cb + sub.shape[1]] = sub[:m.shape[0] - ra, :m.shape[1] - cb]
    s = {k: (v[R0:R1, C0:C1] if isinstance(v, np.ndarray) and v.shape == (H, W) else v) for k, v in s.items()}
    rr = g.minimum_rotated_rectangle
    xs, ys = rr.exterior.coords.xy
    seiten = sorted(np.hypot(np.diff(xs[:3]), np.diff(ys[:3])))
    ring = ndimage.binary_dilation(m, iterations=5) & ~ndimage.binary_dilation(m, iterations=1)
    f = {
        "flaeche": g.area, "laenge": seiten[1], "breite": seiten[0], "streckung": seiten[1] / max(seiten[0], 0.1),
        "rechteckigkeit": g.area / max(rr.area, 1e-6), "kreis": _kreisfoermigkeit(g),
        "konvex": g.area / max(g.convex_hull.area, 1e-6),
        "sam_score": c.get("sam_score", -1), "sam_iou": c.get("sam_iou", -1),
    }
    for k in FAMILIEN:
        f[f"fam_{k}"] = float(c["familie"] == k)
    def st(name, arr, q=(10, 50, 90)):
        v = arr[m]
        v = v[np.isfinite(v)]
        for qq in q:
            f[f"{name}_p{qq}"] = float(np.percentile(v, qq)) if len(v) else -1.0
    st("ndvi", s["ndvi"])
    st("hell", s["hell"])
    st("tuerkis", s["tuerkis"], (50, 90))
    st("nir", s["nir"], (10, 50))
    st("dom_h", s["dom_h"])
    st("las_h", s["las_h"], (50, 90, 99))
    st("las_einzel", s["las_einzel"], (50,))
    st("las_dichte", s["las_dichte"], (10, 50))
    st("las_ng", s["las_ng_anteil"], (50,))
    st("las_int", s["las_int"], (50,))
    for ch in ("r", "g", "b"):
        f[f"{ch}_mittel"] = float(np.nanmean(s[ch][m]))
    f["textur"] = float(np.nanstd(s["hell"][m]))
    # Umfeld
    f["ring_ndvi"] = float(np.nanmean(s["ndvi"][ring])) if ring.any() else 0
    f["ring_h"] = float(np.nanmedian(np.maximum(np.nan_to_num(s["dom_h"][ring]), s["las_h"][ring]))) if ring.any() else 0
    f["kontakt_gebaeude"] = float(s["gebaeude_puffer"][ring].mean()) if ring.any() else 0
    # Abstand zum nächsten Gebäude (m)
    f["abstand_gebaeude"] = float(s["_dist_gebaeude"][m].min())
    # Kantenschärfe: Gradient der Helligkeit am Rand (für die Unsicherheit)
    gy, gx = np.gradient(np.nan_to_num(s["hell"]))
    rand = m & ~ndimage.binary_erosion(m)
    f["kante"] = float(np.hypot(gx, gy)[rand].mean()) if rand.any() else 0
    return f


# ---------------------------------------------------------------- 5. Maße

def _ransac_ebenen(P: np.ndarray, max_ebenen=4, tol=0.08, min_pts=12, iters=300, rng=None):
    """Dachebenen per RANSAC: Liste (Normalenvektor, d, Inlier-Index)."""
    rng = rng or np.random.default_rng(0)
    rest = np.arange(len(P))
    ebenen = []
    while len(rest) >= min_pts and len(ebenen) < max_ebenen:
        best = None
        Q = P[rest]
        for _ in range(iters):
            i = rng.choice(len(Q), 3, replace=False)
            n = np.cross(Q[i[1]] - Q[i[0]], Q[i[2]] - Q[i[0]])
            nn = np.linalg.norm(n)
            if nn < 1e-6:
                continue
            n /= nn
            if abs(n[2]) < 0.5:  # steiler als 60°: keine Dachfläche (Äste, Wände)
                continue
            d = -n @ Q[i[0]]
            inl = np.nonzero(np.abs(Q @ n + d) < tol)[0]
            if best is None or len(inl) > len(best[2]):
                best = (n, d, inl)
        if best is None or len(best[2]) < min_pts:
            break
        # Ausgleich über alle Inlier
        q = Q[best[2]]
        A = np.c_[q[:, 0], q[:, 1], np.ones(len(q))]
        coef, *_ = np.linalg.lstsq(A, q[:, 2], rcond=None)
        n = np.array([-coef[0], -coef[1], 1.0])
        n /= np.linalg.norm(n)
        d = -n @ np.array([0, 0, coef[2]])
        inl = np.nonzero(np.abs(Q @ n + d) < tol)[0]
        ebenen.append((n, d, rest[inl]))
        rest = np.delete(rest, inl)
    return ebenen


def laser_rechteck(s: dict, g: Polygon, min_h: float = 0.8):
    """Rechteck um die Dach-Laserpunkte eines Baus: Nicht-Boden-Punkte mit Einzelecho, ≥ min_h über Boden, in g + 0,5 m,
    nur die zusammenhängende Gruppe am Kandidaten. Rückgabe (Rechteck, Punktabstand) oder None."""
    import shapely
    L = s["_laser"]
    x0, y0, x1, y1 = g.buffer(0.6).bounds
    sel = (L["x"] >= x0) & (L["x"] <= x1) & (L["y"] >= y0) & (L["y"] <= y1) & ~np.isin(L["klasse"], [2, 7, 18]) & (L["echos"] == 1)
    if sel.sum() < 15:
        return None
    xs, ys, zs = L["x"][sel], L["y"][sel], L["z"][sel]
    bb = s["_bb"]
    r = np.clip(((bb[3] - ys) / RES).astype(int), 0, s["dgm"].shape[0] - 1)
    c = np.clip(((xs - bb[0]) / RES).astype(int), 0, s["dgm"].shape[1] - 1)
    hoch = (zs - s["dgm"][r, c]) >= min_h
    inn = shapely.contains(g.buffer(0.5), shapely.points(xs, ys))
    P = np.c_[xs, ys][hoch & inn]
    if len(P) < 15:
        return None
    hull = shapely.MultiPoint(P).convex_hull
    if hull.area < 0.5 * g.area or hull.area > 1.6 * g.area:
        return None  # Punkte passen nicht zum Umriss (Baum darüber, Nachbardach)
    dichte = len(P) / max(hull.area, 0.1)
    # Die Hülle liegt im Mittel einen halben Punktabstand innerhalb der echten Kante
    halb = 0.5 / np.sqrt(dichte)
    return hull.minimum_rotated_rectangle.buffer(halb, join_style=2), 1 / np.sqrt(dichte)


BAUKLASSEN = ("gartenhaus", "carport_garage", "gewaechshaus", "spielturm")


def masse(s: dict, klasse: str, g: Polygon, kante: float = 20.0, laser_umriss: bool = True) -> dict:
    """Maße mit Spanne. Länge/Breite aus dem minimalen gedrehten Rechteck (bzw. Durchmesser bei runden Objekten);
    bei Bauten aus dem Rechteck um die Dach-Laserpunkte (schärfer als die Bildkante). Höhe aus Laserpunkten
    (95. Perzentil über Boden), bei Gartenhaus/Carport zusätzlich Dachebenen."""
    out: dict = {}
    if laser_umriss and klasse in BAUKLASSEN:
        lr = laser_rechteck(s, g)
        if lr is not None:
            g, abstand = lr
            out["umriss"] = g
            out["umriss_quelle"] = "Laser 2025 (Dachpunkte)"
            kante = 200 * (0.35 - min(max(abstand / 2, 0.05), 0.35))  # Spanne aus Punktabstand statt Bildkante
    rund = klasse in ("pool", "trampolin") and _kreisfoermigkeit(g) > 0.8
    # Lagespanne: halbe Pixelgröße DOP + Kantenunschärfe (weiche Kanten → größer), je Kante, für Länge √2
    unschaerfe = float(np.clip(0.35 - kante / 200, 0.05, 0.35))
    sigma_kante = float(np.hypot(RES / 2, unschaerfe))
    if rund:
        out["form"] = "kreis"
        out["durchmesser"] = 2 * np.sqrt(g.area / np.pi)
        out["laenge"] = out["breite"] = out["durchmesser"]
    else:
        rr = g.minimum_rotated_rectangle
        xs, ys = rr.exterior.coords.xy
        a, b = np.hypot(np.diff(xs[:3]), np.diff(ys[:3]))
        out["form"] = "rechteck"
        out["laenge"], out["breite"] = float(max(a, b)), float(min(a, b))
        i = 0 if a >= b else 1
        out["ausrichtung_grad"] = float(np.degrees(np.arctan2(ys[i + 1] - ys[i], xs[i + 1] - xs[i])) % 180)
    out["spanne_laenge"] = out["spanne_breite"] = round(np.sqrt(2) * sigma_kante, 2)
    # Höhe aus Laserpunkten
    L = s["_laser"]
    innen = g.buffer(-0.25) if g.buffer(-0.25).area > 0.5 else g
    x0, y0, x1, y1 = g.buffer(3).bounds
    sel = (L["x"] >= x0) & (L["x"] <= x1) & (L["y"] >= y0) & (L["y"] <= y1)
    import shapely
    xs_, ys_, zs, kl = L["x"][sel], L["y"][sel], L["z"][sel], L["klasse"][sel]
    if klasse in BAUKLASSEN:
        # Bauten: nur Einzelechos (Dach). Mehrfachechos sind Äste über dem Dach und machen den Bau zu hoch.
        dach = L["echos"][sel] == 1
        boden_ok = kl == 2
        keep = dach | boden_ok
        xs_, ys_, zs, kl = xs_[keep], ys_[keep], zs[keep], kl[keep]
    pts = shapely.points(xs_, ys_)
    in_g = shapely.contains(innen, pts)
    ring = shapely.contains(g.buffer(3), pts) & ~shapely.contains(g.buffer(0.5), pts)
    boden = zs[ring & (kl == 2)]
    if len(boden) >= 5:
        z0 = float(np.median(boden))
        sigma_boden = float(min(np.std(boden), 0.5)) / np.sqrt(min(len(boden), 25)) + 0.05
    else:
        bb = tuple(s["_bb"])
        c = g.centroid
        z0 = float(s["dgm"][int((bb[3] - c.y) / RES), int((c.x - bb[0]) / RES)])
        sigma_boden = 0.15
    ober = zs[in_g & ~np.isin(kl, [2, 7, 18])]
    out["laser_punkte"] = int(len(ober))
    if len(ober) >= 5:
        h = float(np.percentile(ober, 95)) - z0
        streu = float(np.percentile(ober, 97.5) - np.percentile(ober, 92.5))
        out["hoehe"] = h
        out["spanne_hoehe"] = round(float(np.sqrt(sigma_boden ** 2 + 0.05 ** 2 + (streu / 2) ** 2 + (1 / np.sqrt(len(ober))) ** 2 * 0.1)), 2)
        out["hoehe_quelle"] = "Laser 2025, 95. Perzentil über Bodenpunkten"
    else:
        dh = s["dom_h"][_rasterize([innen], tuple(s["_bb"]), s["dgm"].shape)]
        dh = dh[np.isfinite(dh)]
        if len(dh):
            out["hoehe"] = float(np.percentile(dh, 90))
            out["spanne_hoehe"] = 0.5
            out["hoehe_quelle"] = "DOM20 2023 (Bildkorrelation), 90. Perzentil – keine Laserpunkte"
    if klasse in ("gartenhaus", "carport_garage", "gewaechshaus") and len(ober) >= 20:
        P = np.c_[xs_[in_g & ~np.isin(kl, [2, 7, 18])], ys_[in_g & ~np.isin(kl, [2, 7, 18])], ober - z0]
        P[:, 0] -= P[:, 0].mean()
        P[:, 1] -= P[:, 1].mean()
        # Nur Punkte ab 1 m über Boden (Dach). Sonst findet RANSAC Bodenpunkte im Umriss als „Ebene“ und die Traufe
        # landet bei 0,2 m – die Wandhöhe wäre gefährlich zu niedrig.
        P = P[P[:, 2] >= 1.0]
        eb = _ransac_ebenen(P) if len(P) >= 20 else []
        # Ebenen mit wenig Punkten (Äste, Antennen) verwerfen
        eb = [e for e in eb if len(e[2]) >= max(12, 0.1 * len(P))]
        if eb:
            hs_min = [float(np.percentile(P[i, 2], 5)) for _, _, i in eb]
            hs_max = [float(np.percentile(P[i, 2], 95)) for _, _, i in eb]
            neig = [float(np.degrees(np.arccos(abs(n[2])))) for n, _, _ in eb]
            anteil = sum(len(i) for _, _, i in eb) / len(P)
            traufe, first = min(hs_min), max(hs_max)
            # Sicher nach oben: liegt die Gesamthöhe knapp über der höchsten Ebene (First-Ziegel, Kante), sie nehmen
            if "hoehe" in out and first < out["hoehe"] <= first + 0.5:
                first = out["hoehe"]
            out["dach"] = {"ebenen": len(eb), "neigung_grad": [round(v, 1) for v in neig], "anteil_punkte": round(anteil, 2)}
            out["traufhoehe"] = traufe
            out["firsthoehe"] = first
            # Geometrisch gemittelte Wandhöhe: Traufwände = Traufhöhe, Giebelwände = Traufe + halbe Giebelhöhe.
            # Mittel über den Umfang (Länge der Seiten als Gewicht). Die rechtliche Bewertung (Art. 6 BayBO) folgt in Phase 2.
            if max(neig) <= 8:
                out["wandhoehe_mittel"] = first  # Flachdach: Wand reicht bis zur Dachkante (sicher nach oben)
                out["traufhoehe"] = first
            elif len(eb) >= 2:
                Lg, Bg = out["laenge"], out["breite"]
                out["wandhoehe_mittel"] = (2 * Lg * traufe + 2 * Bg * (traufe + (first - traufe) / 2)) / (2 * Lg + 2 * Bg)
            else:
                out["wandhoehe_mittel"] = (traufe + first) / 2  # Pultdach: Mittel aus hoher und tiefer Wand
            out["spanne_wand"] = round(float(np.hypot(out.get("spanne_hoehe", 0.2), 0.1)), 2)
    return out


# ---------------------------------------------------------------- Ablauf je Ausschnitt

def ausschnitt(bb, gebiet: Polygon | None = None, sam: bool = True):
    s = signale(bb)
    kand = kandidaten(s, gebiet)
    if sam:
        sam_umrisse(s, kand)
    for c in kand:
        c["merkmale"] = merkmale(s, c)
    return s, kand


def _rahmen(g: Polygon, rand=6.0):
    x0, y0, x1, y1 = g.bounds
    return (np.floor((x0 - rand) / 5) * 5, np.floor((y0 - rand) / 5) * 5,
            np.ceil((x1 + rand) / 5) * 5, np.ceil((y1 + rand) / 5) * 5)


def referenz():
    gs = {f["properties"]["id"]: {**f["properties"], "geom": shape(f["geometry"])}
          for f in json.loads((REF / "grundstuecke.geojson").read_text())["features"]}
    ref = [{**f["properties"], "geom": shape(f["geometry"])}
           for f in json.loads((REF / "referenz.geojson").read_text())["features"]]
    return gs, ref


def zuordnen(kand_geoms: list[Polygon], ref: list[dict], iou_min=0.3):
    """Greedy-Zuordnung nach IoU (eins zu eins). Rückgabe: Liste (i_kand, i_ref, iou)."""
    paare = []
    for i, g in enumerate(kand_geoms):
        for j, r in enumerate(ref):
            if not g.intersects(r["geom"]):
                continue
            inter = g.intersection(r["geom"]).area
            iou = inter / g.union(r["geom"]).area
            if iou >= iou_min:
                paare.append((iou, i, j))
    paare.sort(reverse=True)
    used_i, used_j, out = set(), set(), []
    for iou, i, j in paare:
        if i in used_i or j in used_j:
            continue
        used_i.add(i)
        used_j.add(j)
        out.append((i, j, iou))
    return out


def merkmale_cache(split: str | None = None, ids: list[str] | None = None):
    """Kandidaten und Merkmale für Referenz-Grundstücke berechnen (~10 s je Grundstück mit SAM). Nur Dev cachen:
    das Test-Set rechnet 09_garten_eval.py test frisch."""
    gs, ref = referenz()
    cache = build_dir() / "garten_kandidaten.pkl"
    alt = pickle.loads(cache.read_bytes()) if cache.exists() else {}
    for pid, g in sorted(gs.items()):
        if pid in alt or (split and g["split"] != split) or (ids and pid not in ids):
            continue
        s, kand = ausschnitt(_rahmen(g["geom"]), g["geom"])
        alt[pid] = [{k: v for k, v in c.items() if k != "maske"} for c in kand]
        print(f"  {pid}: {len(kand)} Kandidaten", flush=True)
        cache.write_bytes(pickle.dumps(alt))
    return alt


def lern_tabelle(cache, ids):
    """Für jeden Kandidaten: Merkmale und Ziel (Klasse des zugeordneten Referenzobjekts oder 'nichts')."""
    gs, ref = referenz()
    X, y, meta = [], [], []
    for pid in ids:
        kand = cache[pid]
        r = [o for o in ref if o["grundstueck"] == pid]
        # Zuordnung großzügiger als in der Auswertung: Kandidat überdeckt Referenz zu ≥ 50 % seiner Fläche
        ziel = ["nichts"] * len(kand)
        for i, c in enumerate(kand):
            best, bw = None, 0.0
            for o in r:
                if c["geom"].intersects(o["geom"]):
                    inter = c["geom"].intersection(o["geom"]).area
                    w = min(inter / c["geom"].area, inter / o["geom"].area * 2)
                    if w > bw:
                        best, bw = o, w
            if best is not None and bw >= 0.5:
                ziel[i] = best["klasse"]
        for c, t in zip(kand, ziel):
            X.append(c["merkmale"])
            y.append(t)
            meta.append((pid, c["kid"]))
    cols = sorted(X[0])
    return np.array([[x[k] for k in cols] for x in X], np.float32), np.array(y), meta, cols


def _split() -> dict:
    """Eingefrorener Split, solange noch nicht eingefroren: Dev aus grundstuecke.geojson (ohne Altstadt, deren
    Auswahl noch läuft)."""
    p = REF / "split.json"
    if p.exists():
        return json.loads(p.read_text())
    gs, _ = referenz()
    return {"dev": sorted(k for k, v in gs.items() if v["split"] == "dev" and v["zone"] != "Altstadt")}


ZUSATZ_KLASSE = {"gewächshaus": "gewaechshaus", "carport": "carport_garage", "garage": "carport_garage"}


def zusatz_beispiele() -> tuple[list[dict], list[str]]:
    """Zusätzliche Positiv-Beispiele aus docs/bestand_referenz.json (Meilenstein 5: 20 von Hand gesichtete Kleinbauten,
    Punkte ±1 m, ohne Umriss). Je Punkt der Bau-Kandidat, der ihn enthält. Nur Positive – die Umgebung ist nicht
    vollständig annotiert. Punkte in oder bis 15 m neben Test-Grundstücken werden ausgelassen."""
    cache_p = build_dir() / "garten_zusatz.pkl"
    if cache_p.exists():
        return pickle.loads(cache_p.read_bytes())
    ref = json.loads((build_dir().parent.parent / "docs" / "bestand_referenz.json").read_text())
    gs, _ = referenz()
    test = [g["geom"].buffer(15) for g in gs.values() if g["split"] == "test"]
    kand, ziel = [], []
    for r in ref["positiv"]:
        pt = Point(*r["xy"])
        if any(t.contains(pt) for t in test):
            continue
        art = r["art"].lower()
        k = next((v for key, v in ZUSATZ_KLASSE.items() if key in art), "gartenhaus")
        bb = (pt.x - 25, pt.y - 25, pt.x + 25, pt.y + 25)
        _, ks = ausschnitt(bb)
        treffer = [c for c in ks if c["familie"] == "bau" and c["geom"].buffer(1.0).contains(pt)]
        if treffer:
            c = max(treffer, key=lambda c: c["geom"].area)
            kand.append({k2: v for k2, v in c.items() if k2 != "maske"})
            ziel.append(k)
        print(f"  Zusatz {r['id']}: {k}, {'Kandidat gefunden' if treffer else 'kein Bau-Kandidat'}", flush=True)
    cache_p.write_bytes(pickle.dumps((kand, ziel)))
    return kand, ziel


def regel_scores(f: dict) -> dict[str, float]:
    """Feste Regeln für Klassen mit zu wenigen Lernbeispielen (Pool: 2 im Dev-Set) und für eindeutige Kleinbauten.
    Schwellen auf dem Dev-Set eingestellt. Ergebnis wird mit dem Modell per Maximum kombiniert."""
    out = {}
    if (f["fam_bau"] and 4 <= f["flaeche"] <= 30 and f["rechteckigkeit"] >= 0.75 and 1.8 <= f["las_h_p90"] <= 4.5
            and f["las_einzel_p50"] >= 0.75 and f["ndvi_p50"] < 0.2 and f["kontakt_gebaeude"] <= 0.2):
        out["gartenhaus"] = 0.72
    # Pool: helles Türkis UND im Nahinfrarot dunkel. Bläuliche Schatten sind türkis, aber dunkel; Dächer sind im NIR hell.
    # Abgedeckte oder dunkle Pools fallen so heraus (bewusst: lieber verpasst als Schatten als Pool).
    if f["fam_wasser"] and f["tuerkis_p50"] >= 0.15 and f["hell_p50"] >= 110 and f["nir_p50"] <= 50 and \
            4 <= f["flaeche"] <= 80 and (f["rechteckigkeit"] >= 0.7 or f["kreis"] >= 0.8):
        out["pool"] = 0.75
    return out


def mit_regeln(proba: np.ndarray, klassen: list[str], kand: list[dict]) -> np.ndarray:
    """Modellwahrscheinlichkeiten um Regel-Scores ergänzen (Maximum) und neu normieren."""
    p = proba.copy()
    geb = [klassen.index(k) for k in ("gartenhaus", "carport_garage", "gewaechshaus") if k in klassen]
    for i, c in enumerate(kand):
        f = c["merkmale"]
        # Plausibilität: ein Nebengebäude hat im Laser ≥ 1,5 m Höhe, ist ≥ 1,5 m breit und ≥ 3 m² groß
        if f["las_h_p90"] < 1.5 or f["breite"] < 1.5 or f["flaeche"] < 3:
            p[i, geb] = 0.0
            p[i] /= max(p[i].sum(), 1e-9)
        for k, v in regel_scores(c["merkmale"]).items():
            if k in klassen:
                j = klassen.index(k)
                if v > p[i, j]:
                    p[i, j] = v
                    rest = [x for x in range(len(klassen)) if x != j]
                    p[i, rest] *= (1 - v) / max(p[i, rest].sum(), 1e-9)
    return p


def trainieren():
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.model_selection import GroupKFold, cross_val_predict
    split = _split()
    cache = merkmale_cache(ids=split["dev"])
    X, y, meta, cols = lern_tabelle(cache, split["dev"])
    zk, zz = zusatz_beispiele()
    if zk:
        X = np.vstack([X, np.array([[c["merkmale"][k] for k in cols] for c in zk], np.float32)])
        y = np.concatenate([y, np.array(zz)])
        meta = meta + [(f"zusatz{i}", c["kid"]) for i, c in enumerate(zk)]
    groups = [m[0] for m in meta]
    clf = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, max_leaf_nodes=15, l2_regularization=1.0,
                                         class_weight="balanced", random_state=0)
    proba = cross_val_predict(clf, X, y, groups=groups, cv=GroupKFold(5), method="predict_proba")
    clf.fit(X, y)
    alt = pickle.loads(MODELL.read_bytes()) if MODELL.exists() else {}
    pickle.dump({"modell": clf, "spalten": cols, "klassen": list(clf.classes_), "schwellen": alt.get("schwellen", {}),
                 "version": alt.get("version", 0) + 1, "dev": split["dev"]}, open(MODELL, "wb"))
    # Vorhersagen außerhalb der Falte je Grundstück: für Schwellwerte und Auswertung auf dem Dev-Set
    je_pid: dict[str, list] = {}
    for (pid, _), p in zip(meta, proba):
        if not pid.startswith("zusatz"):
            je_pid.setdefault(pid, []).append(p)
    (build_dir() / "garten_oof.pkl").write_bytes(pickle.dumps(
        {"proba": {k: np.array(v) for k, v in je_pid.items()}, "klassen": list(clf.classes_), "schwellen": alt.get("schwellen", {})}))
    pred = np.array(clf.classes_)[proba.argmax(1)]
    from collections import Counter
    print("Kandidaten je Ziel:", Counter(y).most_common())
    print("Kreuzvalidierung (Dev, nach Grundstück), Kandidatenebene:")
    for k in sorted(set(y) | set(pred)):
        tp = int(((pred == k) & (y == k)).sum())
        print(f"  {k:15s} P {tp / max((pred == k).sum(), 1):.2f}  R {tp / max((y == k).sum(), 1):.2f}  n={int((y == k).sum())}")
    return clf


def nachmessen() -> int:
    """Maße der Bauten in garten.geojson neu bestimmen (nach Änderungen an masse()), ohne die Erkennung zu wiederholen."""
    p = build_dir() / "garten.geojson"
    fc = json.loads(p.read_text())
    n = 0
    for f in fc["features"]:
        pr = f["properties"]
        if pr["klasse"] not in BAUKLASSEN:
            continue
        g = shape(f["geometry"])
        x0, y0, x1, y1 = g.buffer(8).bounds
        bb = (np.floor(x0), np.floor(y0), np.ceil(x1), np.ceil(y1))
        L = laser(bb)
        s = {"_laser": {k: L[k] for k in ("x", "y", "z", "klasse", "echos")}, "_bb": np.array(bb),
             "dgm": raster("dgm1", bb, RES)[0]}
        s["dom_h"] = raster("dom20", bb, RES)[0] - s["dgm"]
        ms = masse(s, pr["klasse"], g, 200 * (0.35 - 0.1), laser_umriss=False)
        for k in ("traufhoehe", "firsthoehe", "wandhoehe_mittel", "spanne_wand", "dach"):
            pr.pop(k, None)
        pr.update({k: (round(float(v), 2) if isinstance(v, (float, np.floating)) else v) for k, v in ms.items()
                   if k not in ("laenge", "breite", "spanne_laenge", "spanne_breite", "ausrichtung_grad", "form")})
        n += 1
    p.write_text(json.dumps(fc), encoding="utf-8")
    print(f"  {n} Bauten neu vermessen")
    return 0


BLOCK = 250.0
RAND = 15.0
KLASSEN_BAU = {"gartenhaus", "gewaechshaus", "carport_garage", "spielturm"}


def gebiet(bbox=None) -> int:
    """Erkennung für das ganze Gebiet in 250-m-Blöcken (15 m Überlappung) → data/build/garten.geojson.
    Ein Objekt gehört zu dem Block, in dem sein Innenpunkt liegt."""
    import importlib
    ev = importlib.import_module("09_garten_eval")
    m = pickle.loads(MODELL.read_bytes())
    x0, y0, x1, y1 = bbox or cfg()["gebiet"]["bbox"]
    feats = []
    zw = build_dir() / "garten_bloecke"
    zw.mkdir(exist_ok=True)
    t0 = __import__("time").time()
    for bx in np.arange(x0, x1, BLOCK):
        for by in np.arange(y0, y1, BLOCK):
            fertig = zw / f"{bx:.0f}_{by:.0f}.json"
            if fertig.exists():
                feats += json.loads(fertig.read_text())
                continue
            bb = (bx - RAND, by - RAND, bx + BLOCK + RAND, by + BLOCK + RAND)
            s, kand = ausschnitt(bb)
            if not kand:
                continue
            X = np.array([[c["merkmale"][k] for k in m["spalten"]] for c in kand], np.float32)
            proba = mit_regeln(m["modell"].predict_proba(X), m["klassen"], kand)
            det = ev.detektionen(kand, proba, m["klassen"], m["schwellen"])
            n = 0
            for d in det:
                ip = d["geom"].representative_point()
                if not (bx <= ip.x < bx + BLOCK and by <= ip.y < by + BLOCK):
                    continue
                g = d["geom"].simplify(0.1)
                ms = masse(s, d["klasse"], g, d["kante"])
                if "umriss" in ms:  # Bauten: Rechteck um die Dach-Laserpunkte ist der genauere Umriss
                    g = ms.pop("umriss")
                feats.append({"type": "Feature", "geometry": mapping(g), "properties": {
                    "klasse": d["klasse"], "konfidenz": round(d["konfidenz"], 2), "label": "erkannt",
                    **{k: (round(float(v), 2) if isinstance(v, (float, np.floating)) else v) for k, v in ms.items()},
                    "modell_version": m.get("version")}})
                n += 1
            (zw / f"{bx:.0f}_{by:.0f}.json").write_text(json.dumps(feats[-n:] if n else []), encoding="utf-8")
            print(f"  Block {bx:.0f}/{by:.0f}: {len(kand)} Kandidaten, {n} Objekte "
                  f"({__import__('time').time() - t0:.0f} s)", flush=True)
    for i, f in enumerate(feats):
        f["properties"]["id"] = f"G{i}"
    fc = {"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25832"}},
          "features": feats}
    (gebiet_build_dir() / "garten.geojson").write_text(json.dumps(fc), encoding="utf-8")
    from collections import Counter
    print(Counter(f["properties"]["klasse"] for f in feats))
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "merkmale":
        a = sys.argv[2:]
        merkmale_cache(a[0] if a and a[0] in ("dev", "test") else None, [x for x in a if x not in ("dev", "test")] or None)
    elif cmd == "trainieren":
        trainieren()
    elif cmd == "nachmessen":
        nachmessen()
    elif cmd == "gebiet":
        gebiet([float(v) for v in sys.argv[2:6]] if len(sys.argv) > 5 else None)
