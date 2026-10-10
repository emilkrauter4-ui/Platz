#!/usr/bin/env python3
"""Prüfungen „Daten stehen“ (Meilenstein 1) für ein Gebiet – reproduzierbar.

  PASST_GEBIET=scharhof python3 24_gebiet_pruefen.py      Mess-Gebiet
  python3 24_gebiet_pruefen.py                             Demo-Gebiet (Vergleichswerte)

Prüft:
  1. Rohdaten: je Art und Kachel Bezugssystem EPSG:25832, Auflösung, Lage der Kachel, Befliegungsdatum (Datei-Tags)
  2. Geoid: GCG2016 greift (Undulation ändert sich über das Gebiet, liegt zwischen 40 und 55 m, weicht vom konstanten
     Näherungswert aus config.yaml ab)
  3. Keine schwebenden oder versunkenen Gebäude: LoD2-Bodenhöhe (DHHN2016, = tiefster Geländepunkt am Gebäude) minus
     tiefster DGM1-Wert am Umring (alle 1 m abgetastet); zusätzlich gegen das Ringmittel und den höchsten Wert
     Bestanden: Median |Abweichung| < 0,3 m, P5 > −1 m, P95 < 1 m, höchstens 5 % der Gebäude mit Bodenhöhe mehr als 0,5 m
     außerhalb der DGM1-Spanne am Umring. (Demo-Gebiet zum Vergleich: Median +0,08, P5 −0,30, P95 +0,61 m, 3,4 % außerhalb.)
  4. Dieselbe Prüfung über die Höhenkacheln, die die App wirklich lädt (terrain/*.bin + Undulation): Ellipsoidhöhe des
     Geländes an der Gebäudemitte gegen LoD2-Bodenhöhe + Undulation
  5. 3D-Kacheln: tiefster Wandpunkt der LoD2-Flächen gegen LoD2-Bodenhöhe (gleicher Höhenbezug)
Ausgabe: docs/messungen/gebiet_pruefung_<id>.json (id = „demo“ ohne PASST_GEBIET)
"""
from __future__ import annotations

import json
import pickle
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from shapely.geometry import shape

from common import app_data_dir, cfg, gebiet_build_dir, gebiet_id, kachel_dateien, origin, raw_dir
from geoid import undulation

ROOT = Path(__file__).resolve().parent.parent
ARTEN = {"dop20": "tif", "dop20cir": "tif", "dom20": "tif", "dgm1": "tif", "laser": "laz"}


def stat(v) -> dict:
    v = np.asarray(v, float)
    v = v[np.isfinite(v)]
    return {"n": int(v.size), "median": round(float(np.median(v)), 2), "p5": round(float(np.percentile(v, 5)), 2),
            "p95": round(float(np.percentile(v, 95)), 2), "min": round(float(v.min()), 2), "max": round(float(v.max()), 2),
            "ueber_1m": int((np.abs(v) > 1.0).sum())}


def rohdaten() -> list[dict]:
    zeilen = []
    for art, suf in ARTEN.items():
        for p in kachel_dateien(raw_dir() / art, suf):
            z = {"art": art, "kachel": p.stem, "mb": round(p.stat().st_size / 1e6, 1)}
            if suf == "tif":
                with rasterio.open(p) as s:
                    z.update(crs=f"EPSG:{s.crs.to_epsg()}", aufloesung_m=round(s.res[0], 3), px=[s.width, s.height],
                             links=round(s.bounds.left), unten=round(s.bounds.bottom),
                             flug=s.tags().get("BILDFLUG_DATUM"), flugnummer=s.tags().get("BILDFLUG_NUMMER"),
                             erzeugt=(s.tags().get("TIFFTAG_DATETIME") or "")[:10].replace(":", "-") or None)
            else:
                import laspy
                with laspy.open(p) as f:
                    h = f.header
                    crs = h.parse_crs()
                    kx, ky = (int(v) * 1000 for v in p.stem.split("_"))
                    passt = bool(h.mins[0] >= kx - 1 and h.maxs[0] <= kx + 1001 and h.mins[1] >= ky - 1 and h.maxs[1] <= ky + 1001)
                    z.update(crs=f"EPSG:{crs.to_epsg()}" if crs is not None and crs.to_epsg() else "nicht im Header",
                             koordinaten_passen_zur_kachel=passt, punkte=int(h.point_count),
                             erzeugt=h.creation_date.isoformat() if h.creation_date else None,
                             punkte_pro_m2=round(h.point_count / 1e6, 1))
            zeilen.append(z)
    return zeilen


def geoid() -> dict:
    x0, y0, x1, y1 = cfg()["gebiet"]["bbox"]
    E, N = np.meshgrid(np.linspace(x0, x1, 25), np.linspace(y0, y1, 25))
    u = undulation(E.ravel(), N.ravel())
    fb = cfg()["hoehen"]["undulation_fallback_m"]
    ok = bool(40 < u.min() and u.max() < 55 and u.max() > u.min() and abs(float(u.mean()) - fb) > 0.2)
    return {"min": round(float(u.min()), 3), "max": round(float(u.max()), 3), "mittel": round(float(u.mean()), 3),
            "konstanter_naeherungswert": fb, "abweichung_zum_naeherungswert_m": round(float(u.mean()) - fb, 2), "greift": ok}


def gebaeude_hoehen() -> tuple[dict, dict, list, dict, dict]:
    b = gpd.read_file(gebiet_build_dir() / "buildings.geojson")
    b = b[b["hoehe_grund"].notna()].copy() if "hoehe_grund" in b else b.iloc[0:0]
    srcs = [rasterio.open(p) for p in kachel_dateien(raw_dir() / "dgm1", "tif")]

    def dgm(x, y):
        for s in srcs:
            bd = s.bounds
            if bd.left <= x < bd.right and bd.bottom <= y < bd.top:
                r, c = s.index(x, y)
                v = s.read(1, window=((r, r + 1), (c, c + 1)))[0, 0]
                return float(v) if v != s.nodata else np.nan
        return np.nan

    diff, diff_mittel, ausser, app, wand = [], [], [], [], []
    ox, oy = origin()
    t = json.loads((app_data_dir() / "terrain" / "terrain.json").read_text())
    n, cols, rows, res = t["chunk"], t["cols"], t["rows"], t["res"]
    tiles = {}

    def terrain(xl, yl):
        gx, gy = int(round((xl - t["first"][0]) / res)), int(round((yl - t["first"][1]) / res))
        if gx < 0 or gy < 0 or gx >= cols * n or gy >= rows * n:  # Stützpunkt außerhalb des Gebiets (Umring ragt über den Rand)
            return np.nan
        cx, cy = min(gx // n, cols - 1), min(gy // n, rows - 1)
        if (cx, cy) not in tiles:
            tiles[(cx, cy)] = np.frombuffer((app_data_dir() / "terrain" / f"{cx}_{cy}.bin").read_bytes(), "<u2").reshape(n + 1, n + 1)
        return t["base"] + float(tiles[(cx, cy)][gy - cy * n, gx - cx * n]) * t["scale"]

    surf = pickle.load(open(gebiet_build_dir() / "surfaces.pkl", "rb"))
    for _, r in b.iterrows():
        g = r.geometry
        if g.geom_type != "Polygon":
            continue
        ring = g.exterior
        pts = np.array([ring.interpolate(d).coords[0] for d in np.arange(0, ring.length, 1.0)])
        d = np.array([dgm(x, y) for x, y in pts])
        d = d[np.isfinite(d)]
        if not d.size:
            continue
        gh = float(r["hoehe_grund"])
        diff.append(gh - float(d.min()))
        diff_mittel.append(gh - float(d.mean()))
        if gh < d.min() - 0.5 or gh > d.max() + 0.5:
            ausser.append({"id": r["id"], "flaeche_m2": round(g.area), "boden_minus_dgm_min": round(gh - float(d.min()), 2),
                           "boden_minus_dgm_max": round(gh - float(d.max()), 2)})
        # Ellipsoidhöhe Gelände am Umring, wie die App sie aus den Höhenkacheln liest (tiefster Stützpunkt)
        te = np.array([terrain(x - ox, y - oy) for x, y in pts])
        ok = np.isfinite(te)
        if ok.any():
            uu = undulation(pts[ok, 0], pts[ok, 1])
            app.append(gh - float((te[ok] - uu).min()))
        s = surf.get(r["id"])
        if s and s["wall"]:
            wand.append(min(float(w[:, 2].min()) for w in s["wall"]) - gh)
    return stat(diff), stat(diff_mittel), ausser, stat(app) if app else {}, stat(wand) if wand else {}


def main() -> int:
    gid = gebiet_id() or "demo"
    erg = {"gebiet": gid, "bbox": cfg()["gebiet"]["bbox"], "origin": list(origin())}
    erg["rohdaten"] = rohdaten()
    erg["geoid"] = geoid()
    b = gpd.read_file(gebiet_build_dir() / "buildings.geojson")
    erg["gebaeude"] = {"gesamt": int(len(b)), "mit_lod2": int(b["hoehe_grund"].notna().sum()) if "hoehe_grund" in b else 0,
                       "grundriss_hausumringe": int((b["quelle_grundriss"] == "Hausumringe").sum())}
    d_dgm, d_mittel, ausser, d_app, d_wand = gebaeude_hoehen()
    erg["lod2_boden_minus_dgm1_tiefster_m"] = d_dgm
    erg["lod2_boden_minus_dgm1_ringmittel_m"] = d_mittel
    erg["ausserhalb_dgm1_spanne_plus_minus_0_5m"] = {"anzahl": len(ausser), "von": d_dgm["n"], "gebaeude": ausser}
    erg["lod2_boden_minus_app_gelaende_tiefster_m"] = d_app
    erg["lod2_wand_unten_minus_boden_m"] = d_wand
    ok = (erg["geoid"]["greift"] and d_dgm["n"] > 0 and abs(d_dgm["median"]) < 0.3 and d_dgm["p5"] > -1.0 and d_dgm["p95"] < 1.0 and len(ausser) <= 0.05 * d_dgm["n"]
          and (not d_app or abs(d_app["median"]) < 0.3))
    erg["bestanden"] = bool(ok)
    out = ROOT / "docs" / "messungen" / f"gebiet_pruefung_{gid}.json"
    out.write_text(json.dumps(erg, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in erg.items() if k not in ("rohdaten", "bbox", "origin")}, indent=1, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
