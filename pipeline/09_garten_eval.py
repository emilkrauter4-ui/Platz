#!/usr/bin/env python3
"""Auswertung der Garten-Erkennung (AUFTRAG_V2, Phase 1.5).

  python3 09_garten_eval.py dev     Kreuzvalidierung auf dem Entwicklungs-Set (darf zum Einstellen benutzt werden)
  python3 09_garten_eval.py test    einmalige Messung auf dem eingefrorenen Test-Set → docs/garten_auswertung.md

Objektebene, je Klasse: Präzision, Trefferquote (Zuordnung eins zu eins, IoU ≥ 0,3), mittlere IoU der Treffer,
Medianfehler von Länge, Breite und Höhe (absolut) und Anteil der Fehler innerhalb der angezeigten Spanne.
Referenzobjekte mit `sicher: false` (nur in einer Epoche sichtbar) zählen weder als verpasst noch als Fehltreffer.
"""
from __future__ import annotations

import importlib
import json
import pickle
import sys
import time
from pathlib import Path
from collections import defaultdict

import numpy as np

from common import build_dir

g8 = importlib.import_module("08_garten")
ref_mod = importlib.import_module("07_referenz")

IOU_MIN = 0.3
DOCS = build_dir().parent.parent / "docs"


def detektionen(kand, proba, klassen, schwellen: dict[str, float]) -> list[dict]:
    """Klassenwahl + Schwellwert + Unterdrückung von Überlappungen (höhere Konfidenz gewinnt)."""
    det = []
    for c, p in zip(kand, proba):
        order = np.argsort(p)[::-1]
        k = klassen[order[0]]
        if k == "nichts":
            continue
        if p[order[0]] < schwellen.get(k, 0.5):
            continue
        det.append({"klasse": k, "konfidenz": float(p[order[0]]), "geom": c["geom"], "kid": c["kid"],
                    "kante": c["merkmale"]["kante"]})
    det.sort(key=lambda d: -d["konfidenz"])
    kept = []
    for d in det:
        if any(d["geom"].intersects(o["geom"]) and
               d["geom"].intersection(o["geom"]).area > 0.5 * min(d["geom"].area, o["geom"].area) for o in kept):
            continue
        kept.append(d)
    return kept


GEBAEUDE = {"gartenhaus", "carport_garage", "gewaechshaus"}


def _sammel(k: str) -> str:
    return "nebengebaeude" if k in GEBAEUDE else k


def auswerten(ids, cache, proba_je_pid, klassen, schwellen, mit_massen=True, sammel=False, konf_min=0.0):
    """sammel=True: Gartenhaus, Carport/Garage und Gewächshaus als eine Klasse „nebengebaeude“ (so zählt die
    Grenzbebauung). konf_min: nur Detektionen ab dieser Konfidenz."""
    gs, ref = g8.referenz()
    if sammel:
        ref = [{**o, "klasse": _sammel(o["klasse"])} for o in ref]
    stat = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0, "iou": [], "iou_laser": [], "dl": [], "db": [], "dh": [], "in_spanne": []})
    details = []
    for pid in ids:
        geb = gs[pid]["geom"]
        kand = cache[pid]
        det = detektionen(kand, proba_je_pid[pid], klassen, schwellen)
        det = [d for d in det if geb.buffer(1.5).contains(d["geom"].representative_point()) and d["konfidenz"] >= konf_min]
        if sammel:
            det = [{**d, "klasse": _sammel(d["klasse"])} for d in det]
        r = [o for o in ref if o["grundstueck"] == pid]
        s = g8.signale(g8._rahmen(geb)) if mit_massen and (det and r) else None
        for k in set([d["klasse"] for d in det] + [o["klasse"] for o in r]):
            dk = [d for d in det if d["klasse"] == k]
            rk = [o for o in r if o["klasse"] == k]
            paare = g8.zuordnen([d["geom"] for d in dk], rk, IOU_MIN)
            mi = {i for i, _, _ in paare}
            mj = {j for _, j, _ in paare}
            st = stat[k]
            for i, j, iou in paare:
                st["tp"] += 1
                st["iou"].append(iou)
                if s is not None:
                    m = g8.masse(s, k, dk[i]["geom"], dk[i]["kante"])
                    mr = g8.masse(s, k, rk[j]["geom"], 40.0, laser_umriss=False)  # nur Länge/Breite der Referenz
                    st["dl"].append(abs(m["laenge"] - mr["laenge"]))
                    st["db"].append(abs(m["breite"] - mr["breite"]))
                    st["in_spanne"].append(abs(m["laenge"] - mr["laenge"]) <= m["spanne_laenge"])
                    st["in_spanne"].append(abs(m["breite"] - mr["breite"]) <= m["spanne_breite"])
                    if "umriss" in m:
                        st["iou_laser"].append(m["umriss"].intersection(rk[j]["geom"]).area / m["umriss"].union(rk[j]["geom"]).area)
                    if rk[j].get("hoehe_geschaetzt_m") is not None and "hoehe" in m:
                        st["dh"].append(abs(m["hoehe"] - rk[j]["hoehe_geschaetzt_m"]))
                        st["in_spanne"].append(abs(m["hoehe"] - rk[j]["hoehe_geschaetzt_m"]) <= m["spanne_hoehe"])
            # Unsichere Referenzen: weder FN noch (bei Überlappung) FP
            unsicher = [o for o in rk if not o.get("sicher", True)]
            for i, d in enumerate(dk):
                if i in mi:
                    continue
                if any(d["geom"].intersects(o["geom"]) for o in unsicher) or \
                        any(d["geom"].intersects(o["geom"]) and not o.get("sicher", True) for o in r):
                    continue
                st["fp"] += 1
                details.append((pid, k, "Fehltreffer", round(d["geom"].area, 1), round(d["konfidenz"], 2)))
            for j, o in enumerate(rk):
                if j in mj or not o.get("sicher", True):
                    continue
                st["fn"] += 1
                details.append((pid, k, "verpasst", round(o["geom"].area, 1), o["nr"]))
    return stat, details


def tabelle(stat) -> list[dict]:
    rows = []
    for k in g8.KLASSEN + ["nebengebaeude"]:
        if k not in stat:
            continue
        st = stat[k]
        tp, fp, fn = st["tp"], st["fp"], st["fn"]
        med = lambda a: round(float(np.median(a)), 2) if a else None
        rows.append({"klasse": k, "ref": tp + fn, "erkannt": tp + fp, "tp": tp,
                     "praezision": round(tp / (tp + fp), 2) if tp + fp else None,
                     "trefferquote": round(tp / (tp + fn), 2) if tp + fn else None,
                     "iou_mittel": round(float(np.mean(st["iou"])), 2) if st["iou"] else None,
                     "median_laenge_m": med(st["dl"]), "median_breite_m": med(st["db"]), "median_hoehe_m": med(st["dh"]),
                     "in_spanne": round(float(np.mean(st["in_spanne"])), 2) if st["in_spanne"] else None})
    return rows


def _md(rows) -> str:
    f = lambda v, pct=False: "–" if v is None else (f"{v * 100:.0f} %" if pct else f"{v:.2f}".replace(".", ","))
    out = ["| Klasse | Ref. | erkannt | Treffer | Präzision | Trefferquote | IoU | Median Länge | Median Breite | Median Höhe | im Bereich ± |",
           "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        out.append(f"| {r['klasse']} | {r['ref']} | {r['erkannt']} | {r['tp']} | {f(r['praezision'], 1)} | {f(r['trefferquote'], 1)} | "
                   f"{f(r['iou_mittel'])} | {f(r['median_laenge_m'])} m | {f(r['median_breite_m'])} m | {f(r['median_hoehe_m'])} m | "
                   f"{f(r['in_spanne'], 1)} |")
    return "\n".join(out)


def dev():
    """Schwellwerte je Klasse auf den Out-of-Fold-Vorhersagen des Dev-Sets wählen (bestes F1), dann berichten."""
    split = g8._split()
    cache = g8.merkmale_cache(ids=split["dev"])
    oof = pickle.loads((build_dir() / "garten_oof.pkl").read_bytes())
    oof["proba"] = {pid: g8.mit_regeln(p, oof["klassen"], cache[pid]) for pid, p in oof["proba"].items()}
    schwellen = {}
    for k in g8.KLASSEN:
        best = (-1, 0.5)
        for t in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8):
            st, _ = auswerten(split["dev"], cache, oof["proba"], oof["klassen"], {**{kk: 1.1 for kk in g8.KLASSEN}, k: t},
                              mit_massen=False)
            tp, fp, fn = st[k]["tp"], st[k]["fp"], st[k]["fn"]
            f1 = 2 * tp / max(2 * tp + fp + fn, 1)
            if f1 > best[0]:
                best = (f1, t)
        schwellen[k] = best[1]
    print("Schwellen (Dev):", schwellen)
    m = pickle.loads(g8.MODELL.read_bytes())
    m["schwellen"] = schwellen
    g8.MODELL.write_bytes(pickle.dumps(m))
    stat, details = auswerten(split["dev"], cache, oof["proba"], oof["klassen"], schwellen)
    rows = tabelle(stat)
    print(_md(rows))
    neben = []
    for kmin in (0.5, 0.6, 0.7, 0.8):
        st2, _ = auswerten(split["dev"], cache, oof["proba"], oof["klassen"], schwellen, mit_massen=False, sammel=True, konf_min=kmin)
        r = [x for x in tabelle(st2) if x["klasse"] == "nebengebaeude"][0]
        neben.append({"konfidenz_min": kmin, **r})
        print(f"  Nebengebäude ab Konfidenz {kmin}: P {r['praezision']} R {r['trefferquote']} ({r['tp']}/{r['erkannt']})")
    (ref_mod.REF / "auswertung_dev.json").write_text(json.dumps(
        {"datum": time.strftime("%Y-%m-%d"), "art": "5-fach-Kreuzvalidierung nach Grundstück (Dev-Set)", "schwellen": schwellen,
         "klassen": rows, "nebengebaeude_nach_konfidenz": neben, "fehler": [list(d) for d in details]}, indent=1, ensure_ascii=False))
    return rows, details


def test_kandidaten() -> tuple[dict, float]:
    """Kandidaten und Merkmale der Test-Grundstücke. Hängen nicht vom Modell ab; zwischengespeichert, solange
    08_garten.py (Kandidaten, Merkmale) unverändert ist – so messen alte und neue Modellversion exakt gleich."""
    import hashlib
    if not ref_mod.test_gueltig():
        raise SystemExit("Test-Set wurde nach dem Einfrieren verändert (Prüfsumme passt nicht) – Auswertung abgebrochen.")
    split = json.loads((ref_mod.REF / "split.json").read_text())
    schluessel = hashlib.sha256((Path(__file__).resolve().parent / "08_garten.py").read_bytes() + json.dumps(split["test"]).encode()).hexdigest()
    cp = build_dir() / "test_kandidaten.pkl"
    if cp.exists():
        c = pickle.loads(cp.read_bytes())
        if c.get("schluessel") == schluessel:
            return c["cache"], c["dauer"]
    gs, _ = g8.referenz()
    cache = {}
    t0 = time.time()
    for pid in split["test"]:
        s, kand = g8.ausschnitt(g8._rahmen(gs[pid]["geom"]), gs[pid]["geom"])
        cache[pid] = [{k: v for k, v in c.items() if k != "maske"} for c in kand]
        print(f"  {pid}: {len(kand)} Kandidaten", flush=True)
    dauer = (time.time() - t0) / len(split["test"])
    cp.write_bytes(pickle.dumps({"schluessel": schluessel, "cache": cache, "dauer": dauer}))
    return cache, dauer


def test_messen(m: dict) -> tuple[list[dict], list, dict, dict, float]:
    """Ein Modell (dict wie garten_modell.pkl) auf dem eingefrorenen Test-Set messen. Schreibt nichts."""
    split = json.loads((ref_mod.REF / "split.json").read_text())
    cache, dauer = test_kandidaten()
    proba = {}
    for pid in split["test"]:
        kand = cache[pid]
        X = np.array([[c["merkmale"][k] for k in m["spalten"]] for c in kand], np.float32)
        proba[pid] = g8.mit_regeln(m["modell"].predict_proba(X), m["klassen"], kand) if len(X) else np.zeros((0, len(m["klassen"])))
    stat, details = auswerten(split["test"], cache, proba, m["klassen"], m["schwellen"])
    rows = tabelle(stat)
    st2, _ = auswerten(split["test"], cache, proba, m["klassen"], m["schwellen"], mit_massen=False, sammel=True)
    rows += [x for x in tabelle(st2) if x["klasse"] == "nebengebaeude"]
    return rows, details, cache, proba, dauer


def test():
    split = json.loads((ref_mod.REF / "split.json").read_text())
    m = pickle.loads(g8.MODELL.read_bytes())
    rows, details, cache, proba, dauer = test_messen(m)
    konf = json.loads((Path(__file__).resolve().parent.parent / "app" / "src" / "rules" / "limits.json").read_text())["bestand"]["konfidenzMin"]["wert"]
    st3, _ = auswerten(split["test"], cache, proba, m["klassen"], m["schwellen"], mit_massen=False, sammel=True, konf_min=konf)
    neben_konf = [{"konfidenz_min": konf, **x} for x in tabelle(st3) if x["klasse"] == "nebengebaeude"]
    print(_md(rows))
    erg = {"datum": time.strftime("%Y-%m-%d"), "modell_version": m.get("version"), "grundstuecke": len(split["test"]),
           "sekunden_je_grundstueck_cpu": round(dauer, 1), "iou_min": IOU_MIN, "klassen": rows,
           "nebengebaeude_nach_konfidenz": neben_konf, "fehler": [list(d) for d in details]}
    (ref_mod.REF / "auswertung_test.json").write_text(json.dumps(erg, indent=1, ensure_ascii=False))
    bericht()
    return rows


def bericht():
    """docs/garten_auswertung.md aus auswertung_dev.json und auswertung_test.json."""
    d = json.loads((ref_mod.REF / "auswertung_dev.json").read_text())
    t = json.loads((ref_mod.REF / "auswertung_test.json").read_text())
    ziel = {"gartenhaus", "pool"}
    def zielzeile(rows):
        out = []
        for r in rows:
            if r["klasse"] in ziel and r["ref"] == 0:
                out.append(f"- **{r['klasse']}**: im Set kein sicheres Referenzobjekt – Ziel **nicht messbar** "
                           f"({r['erkannt']} Erkennungen, alle wären Fehltreffer)")
            elif r["klasse"] in ziel:
                ok = lambda v, g: v is not None and v >= g
                out.append(f"- **{r['klasse']}**: Präzision {r['praezision']}, Trefferquote {r['trefferquote']} "
                           f"(Ziel je ≥ 0,80: {'erreicht' if ok(r['praezision'], .8) and ok(r['trefferquote'], .8) else 'nicht erreicht'}), "
                           f"Median Länge/Breite {r['median_laenge_m']}/{r['median_breite_m']} m (Ziel ≤ 0,30 m), n = {r['ref']}")
        return "\n".join(out)
    md = f"""# Garten-Erkennung: Auswertung (Phase 1.5)

Stand {t['datum']}, Modell v{t['modell_version']}. Erzeugt von `pipeline/09_garten_eval.py`.

**Zuordnung:** eins zu eins je Klasse, Treffer ab IoU ≥ {t['iou_min']}. Referenzobjekte mit `sicher: false`
(nur in einer Epoche sichtbar, Art unklar) zählen weder als verpasst noch – bei Überlappung – als Fehltreffer.
Maßfehler: absolute Abweichung von Länge/Breite (minimales gedrehtes Rechteck) und Höhe gegenüber der Referenz.
„im Bereich ±“: Anteil der Maße, deren Fehler innerhalb der angezeigten Spanne liegt.

## Eingefrorenes Test-Set ({t['grundstuecke']} Grundstücke, einmal gemessen)

{_md(t['klassen'])}

{zielzeile(t['klassen'])}

Grenzbebauung (Nebengebäude ab Konfidenz {t['nebengebaeude_nach_konfidenz'][0]['konfidenz_min']}, so zählt die App automatisch mit):
{t['nebengebaeude_nach_konfidenz'][0]['tp']} von {t['nebengebaeude_nach_konfidenz'][0]['erkannt']} richtig, {t['nebengebaeude_nach_konfidenz'][0]['ref']} Referenzen.

Rechenzeit: {t['sekunden_je_grundstueck_cpu']} s je Grundstück auf 4 CPU-Kernen (mit SAM 2).

## Entwicklungs-Set (Kreuzvalidierung nach Grundstück, zum Einstellen benutzt)

{_md(d['klassen'])}

Nebengebäude (Gartenhaus + Carport/Garage + Gewächshaus) nach Konfidenz:
{chr(10).join(f"- ab {x['konfidenz_min']}: Präzision {x['praezision']}, Trefferquote {x['trefferquote']} ({x['tp']}/{x['erkannt']})" for x in d.get('nebengebaeude_nach_konfidenz', []))}

Schwellwerte je Klasse (auf Dev gewählt): {', '.join(f"{k} {v}" for k, v in d['schwellen'].items())}

## Was die Zahlen bedeuten – und was nicht

- Die Referenz hat Claude (KI-Assistent) auf denselben Daten annotiert, mit denen die Erkennung arbeitet
  (DOP20 2023, Laser 2025). Die Zahlen messen Übereinstimmung mit dieser Annotation, **nicht** die Wahrheit vor Ort.
  Unabhängig prüfen lässt sich das nur mit Maßband-Messungen (`data/reference/vor_ort.csv`, liefert Emil).
- Die Höhen der Referenz sind aus denselben Laserpunkten geschätzt; der Höhenfehler ist deshalb nur ein
  Konsistenzmaß.
- Viele Klassen kommen in 60 zufälligen Grundstücken selten oder gar nicht vor (z. B. Pool, Trampolin, Teich).
  Bei n < 5 sind Präzision und Trefferquote Einzelfälle, keine Raten.
- Bilder 2023 (belaubt) und Laser 2025 (laubfrei) sind zwei Zeitpunkte: Zelte und Pavillons, die nur 2023
  dastanden, und Neubauten nach 2023 sind als `sicher: false` markiert.
"""
    (DOCS / "garten_auswertung.md").write_text(md, encoding="utf-8")
    print("→ docs/garten_auswertung.md")


if __name__ == "__main__":
    {"dev": dev, "test": test, "bericht": bericht}[sys.argv[1]]()
