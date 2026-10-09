#!/usr/bin/env python3
"""Tipp-Erfassung gegen Maßband-Werte (data/reference/vor_ort.csv) – Wand und Dach getrennt.

Für jede vollständige Zeile (Pflichtfelder gefüllt, Einverständnis „ja“): Tipp an Rechtswert/Hochwert simulieren
(tipp.erfassen mit der Klasse aus der CSV), dann vergleichen:
  Wand  – geschätzter Wandumriss (Label „geschätzt“) gegen gemessene Wandlängen
  Dach  – Tipp-Umriss (Luftbild) gegen Wandlängen + Überstände
  Überstand je Himmelsrichtung, Traufhöhe, Firsthöhe
Ausgabe: docs/messungen/vor_ort_auswertung.md und .json. Anleitung: docs/vor_ort_anleitung.md

  cd pipeline && python3 21_vor_ort_auswerten.py [csv]
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "data" / "reference" / "vor_ort.csv"
RICHTUNGEN = ("nord", "ost", "sued", "west")
NORMALE = {"nord": (0, 1), "ost": (1, 0), "sued": (0, -1), "west": (-1, 0)}
PFLICHT = ["objekt_id", "klasse", "rechtswert", "hochwert"] + [f"wand_{r}_m" for r in RICHTUNGEN]
ZIEL_M = 0.30


def zahl(v: str | None) -> float | None:
    try:
        return float(str(v).replace(",", ".")) if v not in (None, "") else None
    except ValueError:
        return None


def zeile_gueltig(z: dict) -> str | None:
    """None = auswertbar, sonst Grund."""
    if (z.get("einverstaendnis_eigentuemer") or "").strip().lower() != "ja":
        return "kein Einverständnis"
    fehlt = [k for k in PFLICHT if (z.get(k) or "").strip() == ""]
    if fehlt:
        return "fehlt: " + ", ".join(fehlt)
    if any(zahl(z[k]) is None for k in PFLICHT[2:]):
        return "keine Zahl in Pflichtfeld"
    return None


def soll(z: dict) -> dict:
    """Gemessene Ausdehnung Ost–West / Nord–Süd für Wand und (falls Überstände da) Dach."""
    w = {r: zahl(z[f"wand_{r}_m"]) for r in RICHTUNGEN}
    u = {r: zahl(z.get(f"ueberstand_{r}_m")) for r in RICHTUNGEN}
    out = {"wand_ow": (w["nord"] + w["sued"]) / 2, "wand_ns": (w["ost"] + w["west"]) / 2, "ueberstand": u,
           "traufe": zahl(z.get("traufhoehe_m")), "first": zahl(z.get("firsthoehe_m"))}
    out["dach_ow"] = out["wand_ow"] + u["ost"] + u["west"] if u["ost"] is not None and u["west"] is not None else None
    out["dach_ns"] = out["wand_ns"] + u["nord"] + u["sued"] if u["nord"] is not None and u["sued"] is not None else None
    return out


def ausdehnung(umriss: list[list[float]]) -> tuple[float, float]:
    """Ausdehnung eines (gedrehten) Rechtecks in Ost–West- und Nord–Süd-Richtung: die Seite, deren Richtung näher an
    Ost–West liegt, zählt als Ost–West-Länge."""
    from shapely.geometry import Polygon
    rr = Polygon(umriss).minimum_rotated_rectangle
    p = np.array(rr.exterior.coords)[:3]
    a, b = p[1] - p[0], p[2] - p[1]
    la, lb = float(np.hypot(*a)), float(np.hypot(*b))
    return (la, lb) if abs(a[0]) >= abs(a[1]) else (lb, la)


def ueberstand_je_richtung(dach: list[list[float]], ueb: list[float]) -> dict[str, float]:
    """Überstände aus tipp.wand_schaetzen (Reihenfolge der Seiten des Dach-Rechtecks) den Himmelsrichtungen zuordnen."""
    from shapely.geometry import Polygon
    import tipp
    seiten = tipp._seiten(Polygon(dach).minimum_rotated_rectangle)
    out = {}
    for r, n in NORMALE.items():
        k = int(np.argmax([np.dot(nn, n) for _, _, nn in seiten]))
        out[r] = ueb[k]
    return out


def vergleichen(z: dict, a: dict) -> dict:
    s = soll(z)
    e = {"objekt_id": z["objekt_id"], "klasse": z["klasse"], "ok": a.get("ok", False)}
    if not a.get("ok"):
        e["grund"] = a.get("grund")
        return e
    w_ow, w_ns = ausdehnung(a["wand"]["umriss"])
    d_ow, d_ns = ausdehnung(a["umriss"])
    e["wand_fehler"] = [round(w_ow - s["wand_ow"], 2), round(w_ns - s["wand_ns"], 2)]
    if s["dach_ow"] is not None:
        e.setdefault("dach_fehler", []).append(round(d_ow - s["dach_ow"], 2))
    if s["dach_ns"] is not None:
        e.setdefault("dach_fehler", []).append(round(d_ns - s["dach_ns"], 2))
    ue = ueberstand_je_richtung(a["umriss"], a["wand"]["ueberstand"])
    qu = ueberstand_je_richtung(a["umriss"], a["wand"]["quelle"])
    e["ueberstand"] = {r: {"gemessen": s["ueberstand"][r], "geschaetzt": ue[r], "quelle": qu[r],
                           "fehler": round(ue[r] - s["ueberstand"][r], 2) if s["ueberstand"][r] is not None else None}
                       for r in RICHTUNGEN}
    m = a.get("masse", {})
    if s["traufe"] is not None and m.get("traufhoehe") is not None:
        e["traufe_fehler"] = round(m["traufhoehe"] - s["traufe"], 2)
    if s["first"] is not None and (m.get("firsthoehe") or m.get("hoehe")) is not None:
        e["first_fehler"] = round((m.get("firsthoehe") or m.get("hoehe")) - s["first"], 2)
    e["embedding"] = a.get("embedding")
    return e


def zusammenfassen(ergebnisse: list[dict]) -> dict:
    ok = [e for e in ergebnisse if e.get("ok")]
    med = lambda v: round(float(np.median(np.abs(v))), 2) if len(v) else None
    wand = [x for e in ok for x in e["wand_fehler"]]
    dach = [x for e in ok for x in e.get("dach_fehler", [])]
    ueb_l = [u["fehler"] for e in ok for u in e["ueberstand"].values() if u["fehler"] is not None and u["quelle"] != "Annahme"]
    ueb_a = [u["fehler"] for e in ok for u in e["ueberstand"].values() if u["fehler"] is not None and u["quelle"] == "Annahme"]
    tr = [e["traufe_fehler"] for e in ok if "traufe_fehler" in e]
    fi = [e["first_fehler"] for e in ok if "first_fehler" in e]
    return {"objekte": len(ergebnisse), "tipp_ok": len(ok), "wand_median": med(wand), "dach_median": med(dach),
            "ueberstand_laser_median": med(ueb_l), "ueberstand_annahme_median": med(ueb_a),
            "traufe_median": med(tr), "first_median": med(fi), "n_wand": len(wand), "n_dach": len(dach),
            "ziel_m": ZIEL_M,
            "ziel_wand": None if not wand else med(wand) <= ZIEL_M, "ziel_dach": None if not dach else med(dach) <= ZIEL_M}


def main(pfad: Path = CSV) -> int:
    zeilen = list(csv.DictReader(open(pfad, encoding="utf-8")))
    gueltig, ausgelassen = [], []
    for z in zeilen:
        g = zeile_gueltig(z)
        (ausgelassen.append({"objekt_id": z.get("objekt_id"), "grund": g}) if g else gueltig.append(z))
    if not gueltig:
        print(f"Keine auswertbaren Zeilen in {pfad} ({len(zeilen)} Zeilen, {len(ausgelassen)} ausgelassen).")
        return 0
    import tipp
    ergebnisse = [vergleichen(z, tipp.erfassen(zahl(z["rechtswert"]), zahl(z["hochwert"]), z["klasse"])) for z in gueltig]
    zs = zusammenfassen(ergebnisse)
    out = ROOT / "docs" / "messungen"
    (out / "vor_ort_auswertung.json").write_text(json.dumps({"zusammenfassung": zs, "objekte": ergebnisse, "ausgelassen": ausgelassen},
                                                             indent=1, ensure_ascii=False), encoding="utf-8")
    f = lambda v: "–" if v is None else f"{v:.2f} m".replace(".", ",")
    md = [f"# Tipp-Erfassung gegen Maßband ({len(ergebnisse)} Objekte)", "",
          f"Tipp gelungen: {zs['tipp_ok']} von {zs['objekte']}. Ziel: Medianfehler ≤ {f(ZIEL_M)}.", "",
          "| Größe | Medianfehler | n |", "|---|---|---|",
          f"| Wand (geschätzt) Ost–West/Nord–Süd | {f(zs['wand_median'])} | {zs['n_wand']} |",
          f"| Dach (Luftbild) | {f(zs['dach_median'])} | {zs['n_dach']} |",
          f"| Überstand, aus Laser | {f(zs['ueberstand_laser_median'])} | |",
          f"| Überstand, Annahme 0,3 m | {f(zs['ueberstand_annahme_median'])} | |",
          f"| Traufhöhe | {f(zs['traufe_median'])} | |", f"| Firsthöhe | {f(zs['first_median'])} | |", ""]
    if ausgelassen:
        md += ["Ausgelassen: " + "; ".join(f"{a['objekt_id']} ({a['grund']})" for a in ausgelassen), ""]
    (out / "vor_ort_auswertung.md").write_text("\n".join(md), encoding="utf-8")
    print("\n".join(md))
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else CSV))
