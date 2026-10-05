#!/usr/bin/env python3
"""Fehleranalyse Pools auf dem Test-Set nach Objekten (05.10.2026): Signale im Umriss, Kandidat, Klassifikation.
Aufruf: cd pipeline && python3 18_pool_fehleranalyse.py  → docs/messungen/pools_fehleranalyse.json"""
import json, importlib, pickle, sys
import numpy as np
from shapely.geometry import shape
sys.path.insert(0, '.')
g8 = importlib.import_module("08_garten"); t = importlib.import_module("17_testset_objekte")
ref = [dict(f["properties"], geom=shape(f["geometry"])) for f in json.load(open(t.OBJ / "objekte.geojson"))["features"]]
pools = [r for r in ref if r["klasse"] == "pool"]
m = pickle.loads(g8.MODELL.read_bytes())
zeilen = []
for r in pools:
    g = r["geom"]; c = g.centroid
    bb = (np.floor(c.x - 20), np.floor(c.y - 20), np.ceil(c.x + 20), np.ceil(c.y + 20))
    s, kand = g8.ausschnitt(bb)
    sub, (a, b) = g8._maske_aus_geom(g, bb, s["dgm"].shape)
    M = np.zeros(s["dgm"].shape, bool); M[a:a+sub.shape[0], b:b+sub.shape[1]] = sub[:M.shape[0]-a, :M.shape[1]-b]
    ring = g8.ndimage.binary_dilation(M, iterations=10) & ~g8.ndimage.binary_dilation(M, iterations=3)
    v = lambda k, q=50, mm=M: float(np.nanpercentile(s[k][mm], q))
    dichte_in, dichte_ring = v("las_dichte"), v("las_dichte", mm=ring)
    best = max(kand, key=lambda k: t._iou(k["geom"], g), default=None)
    iou = t._iou(best["geom"], g) if best else 0
    kl, pr = None, None
    if best is not None and iou >= 0.3:
        X = np.array([[best["merkmale"][k] for k in m["spalten"]]], np.float32)
        p = m["modell"].predict_proba(X)[0]; i = int(np.argmax(p)); kl, pr = m["klassen"][i], round(float(p[i]), 2)
        ppool = round(float(p[m["klassen"].index("pool")]), 2) if "pool" in m["klassen"] else None
    else:
        ppool = None
    zeilen.append(dict(id=r["id"], sicher=r["sicher"], flaeche=round(g.area, 1), tuerkis=round(v("tuerkis"), 2), hell=round(v("hell")),
                       nir=round(v("nir")), ndvi=round(v("ndvi"), 2), las_h90=round(v("las_h", 90), 2),
                       echo_rel=round(dichte_in / max(dichte_ring, 0.1), 2), hell_ring=round(v("hell", mm=ring)),
                       kand_iou=round(iou, 2), kand_fam=best["familie"] if best else None, klasse=str(kl) if kl else None, p=pr, p_pool=ppool, notiz=r["notiz"]))
    print(zeilen[-1], flush=True)
json.dump(zeilen, open("../docs/messungen/pools_fehleranalyse.json", "w"), ensure_ascii=False, indent=1)
