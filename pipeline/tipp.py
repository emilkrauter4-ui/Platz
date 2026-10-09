#!/usr/bin/env python3
"""„Ein Tipp erfasst“: Der Nutzer tippt auf ein Objekt im Luftbild (DOP20), SAM 2.1 segmentiert den Umriss aus diesem
einen Punkt. Höhe aus den Laserpunkten, Maße mit Spanne (08_garten.masse), Klassenvorschlag vom Klassifikator.
Ergebnis-Label: „erfasst per Tipp“. Der Umriss bleibt in der App nachziehbar.

Unterschied zur Vollautomatik: Es gibt keine Kandidatensuche und keine Farbschwellen. Der Mensch sagt, *wo* etwas steht
(und meist auch *was*), SAM 2 liefert nur die Kante.

  python3 tipp.py X Y [klasse]      X, Y in EPSG:25832 → JSON auf stdout
"""
from __future__ import annotations

import importlib
import json
import pickle
import sys
import time

import numpy as np
from rasterio import features
from rasterio.transform import from_origin
from scipy import ndimage
from shapely.geometry import Point, Polygon, shape

from rohdaten import raster

g8 = importlib.import_module("08_garten")
RES = g8.RES

# Einstellungen – nur auf dem Entwicklungs-Set gewählt (19_tipp_messen.py dev), nie auf einem Test-Set
FENSTER_M = 24.0          # halbe Kantenlänge des Bildausschnitts um den Tipp (48 × 48 m)
FLAECHE_MIN, FLAECHE_MAX = 1.0, 150.0
OHNE_HAUSUMRINGE = True   # Hausumringe aus der Maske nehmen (Nebengebäude stehen per Definition nicht darin)
WAHL = "klein"            # "score": beste SAM-Bewertung; "klein": kleinste Maske mit ≥ 85 % der besten Bewertung
GLAETTEN_M = 0.1
VERFEINERN = False        # zweiter SAM-Durchgang mit Box um die erste Maske
FORM = True               # Form: False | True (Rechteck/Kreis) | "laser" (Bauten: Rechteck um die Dach-Laserpunkte)
SAM_GROESSE = "small"     # "small" (184 MB) | "large" (898 MB)

_PRED: dict = {}


def _sam(groesse: str = None):
    groesse = groesse or SAM_GROESSE
    if groesse == "small":
        return g8._sam()
    if groesse not in _PRED:
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        torch.set_num_threads(4)
        ck = g8.build_dir().parent / "raw" / "models" / "sam2.1_hiera_large.pt"
        _PRED[groesse] = SAM2ImagePredictor(build_sam2("configs/sam2.1/sam2.1_hiera_l.yaml", str(ck), device="cpu"))
    return _PRED[groesse]

KLASSEN_TIPP = ["gartenhaus", "carport_garage", "gewaechshaus", "pool", "trampolin", "spielturm", "terrasse", "teich",
                "hecke", "baum", "strauch", "waermepumpe"]


def ausschnitt_um(x: float, y: float, r: float = FENSTER_M):
    bb = (np.floor(x - r), np.floor(y - r), np.ceil(x + r), np.ceil(y + r))
    return bb, g8.signale(bb)


# Vorberechnete Bild-Embeddings: Fenster der Kantenlänge RASTER_W auf einem festen Gitter (Abstand RASTER_SCHRITT ab
# der Kachelecke). Ein Tipp nimmt das Fenster mit dem nächsten Mittelpunkt – er liegt höchstens SCHRITT/2 von der Mitte.
RASTER_URSPRUNG = (698000.0, 5486000.0)
RASTER_W = 96.0
RASTER_SCHRITT = 48.0


def raster_fenster(x: float, y: float, w: float = None, schritt: float = None) -> tuple[tuple[int, int], tuple]:
    w = w or RASTER_W
    schritt = schritt or RASTER_SCHRITT
    i = int(round((x - RASTER_URSPRUNG[0]) / schritt))
    j = int(round((y - RASTER_URSPRUNG[1]) / schritt))
    cx, cy = RASTER_URSPRUNG[0] + i * schritt, RASTER_URSPRUNG[1] + j * schritt
    return (i, j), (cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2)


def _maske_zu_poly(m: np.ndarray, bb, px: tuple[int, int]) -> Polygon | None:
    lab, _ = ndimage.label(m)
    k = lab[px]
    if k == 0:  # Tipp liegt knapp neben der Maske: nächste Komponente
        d, (ri, ci) = ndimage.distance_transform_edt(lab == 0, return_indices=True)
        if d[px] * RES > 1.0:
            return None
        k = lab[ri[px], ci[px]]
    comp = ndimage.binary_fill_holes(lab == k)
    tr = from_origin(bb[0], bb[3], RES, RES)
    polys = [shape(g).buffer(0) for g, v in features.shapes(comp.astype(np.uint8), mask=comp, transform=tr) if v]
    if not polys:
        return None
    p = max(polys, key=lambda q: q.area)
    return p.simplify(GLAETTEN_M) if GLAETTEN_M else p


def _form(p: Polygon, klasse: str | None) -> Polygon:
    """Form regularisieren: Bauten → gedrehtes Rechteck, runde Pools/Trampoline → Kreis gleicher Fläche."""
    if klasse in ("pool", "trampolin") and g8._kreisfoermigkeit(p) > 0.75:
        c = p.centroid
        return c.buffer(float(np.sqrt(p.area / np.pi)), quad_segs=16)
    if klasse in (None, "gartenhaus", "carport_garage", "gewaechshaus", "spielturm", "pool", "waermepumpe"):
        rr = p.minimum_rotated_rectangle
        if p.area / max(rr.area, 1e-6) >= 0.6:
            return rr
    return p


class EmbeddingSpeicher:
    """Vorberechnete SAM-2-Embeddings einer Kachel (20_tipp_embeddings.py) als Memmaps."""
    _offen: dict = {}

    def __init__(self, ordner):
        self.idx = json.loads((ordner / "index.json").read_text(encoding="utf-8"))
        self.pos = {tuple(z): k for k, z in enumerate(self.idx["zellen"])}
        self.mm = {k: np.load(ordner / f"{k}.npy", mmap_mode="r") for k in ("embed", "hr0", "hr1")}

    @classmethod
    def laden(cls, kachel: str):
        if kachel not in cls._offen:
            ordner = g8.build_dir() / "tipp_embed" / kachel
            cls._offen[kachel] = cls(ordner) if (ordner / "index.json").exists() else None
        return cls._offen[kachel]

    @classmethod
    def fuer(cls, x: float, y: float):
        return cls.laden(f"{int(x // 1000)}_{int(y // 1000)}")

    def features(self, zelle: tuple[int, int]):
        import torch
        k = self.pos.get(tuple(zelle))
        if k is None:
            return None
        t = lambda a: torch.from_numpy(np.asarray(a[k], dtype=np.float32))[None]
        return {"image_embed": t(self.mm["embed"]), "high_res_feats": [t(self.mm["hr0"]), t(self.mm["hr1"])]}


def segmentieren(s: dict, x: float, y: float, wahl: str = WAHL, ohne_umringe: bool = OHNE_HAUSUMRINGE,
                 verfeinern: bool = VERFEINERN, form=FORM, klasse: str | None = None, groesse: str = None,
                 vorberechnet: bool = False, speicher: "EmbeddingSpeicher | None" = None) -> dict | None:
    bb = tuple(s["_bb"])
    groesse = groesse or SAM_GROESSE
    pred = _sam(groesse)
    if vorberechnet:
        if s.get("_sam_bb") != (bb, "vor"):
            sp = speicher or EmbeddingSpeicher.fuer(x, y)
            zelle, bb_r = raster_fenster(x, y)
            f = sp.features(zelle) if sp is not None and tuple(bb_r) == bb else None
            if f is None or groesse != "small":
                raise ValueError("kein vorberechnetes Embedding für dieses Fenster")
            pred._features, pred._orig_hw, pred._is_image_set, pred._is_batch = f, [s["dgm"].shape], True, False
            s["_sam_bb"] = (bb, "vor")
    elif s.get("_sam_bb") != (bb, groesse):
        rgb = np.clip(np.nan_to_num(np.stack([s["r"], s["g"], s["b"]], -1)), 0, 255).astype(np.uint8)
        pred.set_image(rgb)
        s["_sam_bb"] = (bb, groesse)
    col, row = (x - bb[0]) / RES, (bb[3] - y) / RES
    px = (int(row), int(col))

    def kandidaten(masks, scores):
        out = []
        for m, sc in zip(masks, scores):
            m = m > 0
            if ohne_umringe and not s["gebaeude"][px]:
                m = m & ~s["gebaeude"]
            if not (FLAECHE_MIN <= m.sum() * RES * RES <= FLAECHE_MAX):
                continue
            p = _maske_zu_poly(m, bb, px)
            if p is not None and FLAECHE_MIN <= p.area <= FLAECHE_MAX:
                out.append((float(sc), p, m))
        return out

    masks, scores, _ = pred.predict(point_coords=np.array([[col, row]]), point_labels=np.array([1]), multimask_output=True)
    kand = kandidaten(masks, scores)
    if not kand:
        return None
    best = max(t[0] for t in kand)
    if wahl == "score":
        sc, p, m = max(kand, key=lambda t: t[0])
    elif wahl == "gross":
        sc, p, m = max((t for t in kand if t[0] >= 0.7 * best), key=lambda t: t[1].area)
    else:
        sc, p, m = min((t for t in kand if t[0] >= 0.85 * best), key=lambda t: t[1].area)
    if verfeinern:
        # zweiter Durchgang: Box um die erste Maske (+0,6 m) und derselbe Punkt
        x0, y0, x1, y1 = p.buffer(0.6).bounds
        box = np.array([(x0 - bb[0]) / RES, (bb[3] - y1) / RES, (x1 - bb[0]) / RES, (bb[3] - y0) / RES])
        m2, s2, _ = pred.predict(point_coords=np.array([[col, row]]), point_labels=np.array([1]), box=box, multimask_output=False)
        k2 = kandidaten(m2, s2)
        if k2:
            sc, p, m = k2[0]
    if form == "laser" and klasse in g8.BAUKLASSEN:
        lr = g8.laser_rechteck(s, p)
        p = lr[0] if lr is not None else _form(p, klasse)
    elif form:
        p = _form(p, klasse)
    return {"geom": p, "sam_score": sc}


# Dach vs. Wand: Der Tipp-Umriss aus dem Luftbild ist der Dachumriss. Die Wand liegt um den Dachüberstand weiter innen.
UEBERSTAND_ANNAHME_M = 0.3   # limits.json bestand.dachueberstandAnnahmeM (Annahme, vom Nutzer änderbar)
WANDPUNKTE_MIN = 4           # Laser-Wandpunkte je Seite, ab denen der Überstand gemessen statt angenommen wird
WAND_KLASSEN = ("gartenhaus", "carport_garage", "gewaechshaus", "spielturm")


def _seiten(rechteck: Polygon) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Seiten eines Rechtecks: (Anfang, Ende, Normale nach außen)."""
    c = np.array(rechteck.centroid.coords[0])
    ps = np.array(rechteck.exterior.coords)[:4]
    out = []
    for k in range(4):
        a, b = ps[k], ps[(k + 1) % 4]
        d = (b - a) / max(np.linalg.norm(b - a), 1e-9)
        n = np.array([d[1], -d[0]])
        if np.dot(n, (a + b) / 2 - c) < 0:
            n = -n
        out.append((a, b, n))
    return out


def wand_schaetzen(s: dict, dach: Polygon, klasse: str, annahme: float = UEBERSTAND_ANNAHME_M) -> dict:
    """Wandumriss aus dem Dachumriss. Je Seite: Überstand = Abstand der Laser-Dachkante (Rechteck um die
    Dach-Einzelechos, wahre Lage) zu den Laserpunkten an der Wand (über Boden, unter der Traufe, bis 1,2 m innerhalb
    der Dachkante). Mit weniger als WANDPUNKTE_MIN Punkten: Annahme. Label immer „geschätzt“."""
    if klasse not in WAND_KLASSEN:
        return {"umriss": dach, "ueberstand": [0.0] * 4, "quelle": ["kein Gebäude"] * 4}
    rr = dach.minimum_rotated_rectangle
    seiten_dach = _seiten(rr)
    gemessen = [None] * 4
    lr = g8.laser_rechteck(s, dach)
    L = s["_laser"]
    if lr is not None:
        lrr = lr[0]
        x0, y0, x1, y1 = lrr.buffer(0.5).bounds
        sel = (L["x"] >= x0) & (L["x"] <= x1) & (L["y"] >= y0) & (L["y"] <= y1) & ~np.isin(L["klasse"], [2, 3, 4, 5, 7, 18])
        P = np.c_[L["x"][sel], L["y"][sel]]
        bb = s["_bb"]
        r = np.clip(((bb[3] - P[:, 1]) / RES).astype(int), 0, s["dgm"].shape[0] - 1)
        c = np.clip(((P[:, 0] - bb[0]) / RES).astype(int), 0, s["dgm"].shape[1] - 1)
        h = L["z"][sel] - s["dgm"][r, c]
        dach_h = h[h >= 0.8]
        traufe = float(np.percentile(dach_h, 10)) if len(dach_h) >= 15 else None
        for k, (a, b, n) in enumerate(_seiten(lrr)):
            if traufe is None:
                break
            d = (b - a) / max(np.linalg.norm(b - a), 1e-9)
            t = (P - a) @ d
            innen = -((P - a) @ n)  # Abstand nach innen von der Laser-Dachkante
            m = (t > 0.3) & (t < np.linalg.norm(b - a) - 0.3) & (innen > 0.02) & (innen < 1.2) & (h > 0.4) & (h < traufe - 0.25)
            if m.sum() >= WANDPUNKTE_MIN:
                u = float(np.median(innen[m]))
                # Seite des Luftbild-Rechtecks mit der ähnlichsten Normalen
                kk = int(np.argmax([np.dot(n, nd) for _, _, nd in seiten_dach]))
                gemessen[kk] = (round(u, 2), int(m.sum()))
    ueb, quelle = [], []
    for k in range(4):
        if gemessen[k] is not None:
            ueb.append(gemessen[k][0])
            quelle.append(f"Laser ({gemessen[k][1]} Wandpunkte)")
        else:
            ueb.append(annahme)
            quelle.append("Annahme")
    # Wand = Dach-Rechteck, jede Seite um ihren Überstand nach innen verschoben
    from shapely.geometry import LineString
    linien = []
    for (a, b, n), u in zip(seiten_dach, ueb):
        linien.append((a - n * u, b - n * u))

    def schnitt(p1, p2, p3, p4):
        d1, d2 = p2 - p1, p4 - p3
        den = d1[0] * d2[1] - d1[1] * d2[0]
        if abs(den) < 1e-9:
            return p2
        t = ((p3[0] - p1[0]) * d2[1] - (p3[1] - p1[1]) * d2[0]) / den
        return p1 + t * d1
    ecken = [schnitt(*linien[k - 1], *linien[k]) for k in range(4)]
    wand = Polygon(ecken)
    if not wand.is_valid or wand.area < 0.3 * rr.area:
        wand = rr.buffer(-annahme, join_style=2)
        ueb, quelle = [annahme] * 4, ["Annahme"] * 4
    return {"umriss": wand, "ueberstand": ueb, "quelle": quelle}


_KLASSIFIKATOR: dict = {}


def _modell() -> dict:
    if "m" not in _KLASSIFIKATOR:
        _KLASSIFIKATOR["m"] = pickle.loads(g8.MODELL.read_bytes())
    return _KLASSIFIKATOR["m"]


def klasse_vorschlagen(s: dict, g: Polygon) -> list[tuple[str, float]]:
    """Klassifikator v4 auf den Merkmalen des getippten Umrisses. Familie aus einfachen Signalen."""
    H, W = s["dgm"].shape
    maske, fenster = g8._maske_aus_geom(g, tuple(s["_bb"]), (H, W))
    voll = np.zeros((H, W), bool)
    voll[fenster[0]:fenster[0] + maske.shape[0], fenster[1]:fenster[1] + maske.shape[1]] = maske[:H - fenster[0], :W - fenster[1]]
    lh = float(np.percentile(s["las_h"][voll], 90)) if voll.any() else 0
    tu = float(np.median(s["tuerkis"][voll])) if voll.any() else 0
    ndvi = float(np.median(s["ndvi"][voll])) if voll.any() else 0
    fam = "wasser" if tu > 0.3 and lh < 1.6 else "bau" if lh >= 1.5 and ndvi < 0.25 else \
        "vegetation" if ndvi >= 0.25 else "rund" if g8._kreisfoermigkeit(g) > 0.8 else "flach"
    c = {"familie": fam, "geom": g, "maske": maske, "fenster": fenster}
    c["merkmale"] = g8.merkmale(s, c)
    m = _modell()
    X = np.array([[c["merkmale"][k] for k in m["spalten"]]], np.float32)
    p = g8.mit_regeln(m["modell"].predict_proba(X), m["klassen"], [c])[0]
    out = sorted(((k, float(v)) for k, v in zip(m["klassen"], p) if k != "nichts"), key=lambda t: -t[1])
    return out[:3]


def erfassen(x: float, y: float, klasse: str | None = None, s: dict | None = None) -> dict:
    """Ein Tipp. Mit vorberechnetem Embedding (Kachel in data/build/tipp_embed) nur Prompt-Decoder; sonst wird das
    Fenster live kodiert (≈ 1,5 s mehr). Fenster immer das Gitterfenster (raster_fenster)."""
    t0 = time.time()
    zelle, bb = raster_fenster(x, y)
    if s is None:
        s = g8.signale(bb)
    sp = EmbeddingSpeicher.fuer(x, y)
    vor = sp is not None and sp.features(zelle) is not None
    seg = segmentieren(s, x, y, klasse=klasse, vorberechnet=vor, speicher=sp)
    t_seg = time.time() - t0
    if seg is None:
        return {"ok": False, "grund": "Kein Umriss gefunden. Bitte genauer tippen oder Umriss zeichnen.", "sekunden": round(time.time() - t0, 1)}
    g = seg["geom"]
    vorschlag = klasse_vorschlagen(s, g)
    k = klasse or (vorschlag[0][0] if vorschlag else "gartenhaus")
    ms = g8.masse(s, k, g, laser_umriss=False)
    w = wand_schaetzen(s, g, k)
    wl, wb = _rechteck_masse(w["umriss"])
    return {
        "ok": True, "label": "erfasst per Tipp", "klasse": k, "klasse_quelle": "Nutzer" if klasse else "Vorschlag",
        "vorschlag": [{"klasse": a, "p": round(b, 2)} for a, b in vorschlag],
        "umriss": [[round(px, 2), round(py, 2)] for px, py in list(g.exterior.coords)[:-1]],
        "umriss_art": "Dach (Luftbild)",
        "wand": {"umriss": [[round(px, 2), round(py, 2)] for px, py in list(w["umriss"].exterior.coords)[:-1]],
                 "label": "geschätzt", "ueberstand": w["ueberstand"], "quelle": w["quelle"],
                 "laenge": round(wl, 2), "breite": round(wb, 2)},
        "flaeche": round(g.area, 1), "sam_score": round(seg["sam_score"], 3),
        "masse": {kk: (round(v, 2) if isinstance(v, float) else v) for kk, v in ms.items() if kk not in ("umriss",)},
        "quelle": "Umriss: SAM 2.1 aus DOP20 2023 (Tipp); Höhe: Laser 2025; Bayerische Vermessungsverwaltung (CC BY 4.0)",
        "sekunden": round(time.time() - t0, 2), "sekunden_segmentierung": round(t_seg, 2),
        "embedding": "vorberechnet" if vor else "live",
    }


def _rechteck_masse(p: Polygon) -> tuple[float, float]:
    rr = p.minimum_rotated_rectangle
    xs, ys = rr.exterior.coords.xy
    a, b = np.hypot(np.diff(xs[:3]), np.diff(ys[:3]))
    return float(max(a, b)), float(min(a, b))


def aufwaermen() -> float:
    """Alles laden, was ein Tipp braucht (Module, SAM, Klassifikator, Gebäude, Verkehrsflächen), damit schon der
    erste Tipp schnell ist. Für den Dienst beim Start."""
    t0 = time.time()
    g8._sam()
    _modell()
    x, y = RASTER_URSPRUNG[0] + 500, RASTER_URSPRUNG[1] + 500
    erfassen(x, y)
    return time.time() - t0


if __name__ == "__main__":
    a = sys.argv[1:]
    print(json.dumps(erfassen(float(a[0]), float(a[1]), a[2] if len(a) > 2 else None), ensure_ascii=False, default=float))
