#!/usr/bin/env python3
"""Lernschleife der Garten-Erkennung (AUFTRAG_V2 Phase 4.2).

Beiträge aus der App (nur mit Einwilligung; nur Geometrie, Klasse, Kachel) liegen als JSONL im Node-Server
(`app/.daten/lernen.jsonl`). Daraus wird regelmäßig nachtrainiert – mit versionierten Modellen und fester Freigaberegel:

  Eine neue Version wird nur freigegeben, wenn sie auf dem eingefrorenen Test-Set (data/reference/split.json) in
  keiner Klasse schlechter ist als die freigegebene: F1 je Klasse mit Referenzobjekten und F1 der Sammelklasse
  „Nebengebäude“ dürfen nicht sinken. Sonst bleibt die alte Version und die neue wird als „abgelehnt“ vermerkt.

Befehle:
  python3 12_lernschleife.py import [jsonl]     Beiträge prüfen und Lernbeispiele bilden → data/build/lern_beispiele.pkl
  python3 12_lernschleife.py trainieren         Kandidat trainieren → data/build/modelle/garten_v<N>.pkl
  python3 12_lernschleife.py pruefen            Kandidat vs. freigegebene Version auf dem Test-Set, Freigabe oder nicht
  python3 12_lernschleife.py alles [jsonl]      alle drei Schritte (für einen regelmäßigen Lauf, z. B. wöchentlich per cron)
  python3 12_lernschleife.py simulieren [n]     Mechanik-Test: n Beiträge aus der Dev-Referenz als JSONL erzeugen

Schutz des Test-Sets: Beiträge in oder bis 15 m neben Test-Grundstücken werden verworfen und nie zum Training
benutzt. Protokoll: data/reference/modelle.json (versioniert, im Git).
"""
from __future__ import annotations

import importlib
import json
import pickle
import random
import shutil
import sys
import time
from pathlib import Path

import numpy as np
from shapely.geometry import Polygon, shape

from common import build_dir

g8 = importlib.import_module("08_garten")
g9 = importlib.import_module("09_garten_eval")
ref_mod = importlib.import_module("07_referenz")

APP = Path(__file__).resolve().parent.parent / "app"
JSONL = APP / ".daten" / "lernen.jsonl"
BEISPIELE = build_dir() / "lern_beispiele.pkl"
MODELLE = build_dir() / "modelle"
REGISTER = ref_mod.REF / "modelle.json"
AKTIONEN = {"bestaetigt", "verworfen", "nachgezogen", "neu"}
IOU_MIN = 0.3
TEST_PUFFER = 15.0
# Familie, die ein von Hand gezeichneter Umriss ohne Kandidaten bekommt (sonst kommt sie aus dem Kandidatengenerator)
FAMILIE_FUER = {"gartenhaus": "bau", "gewaechshaus": "bau", "carport_garage": "bau", "spielturm": "bau",
                "waermepumpe": "bau", "pool": "wasser", "teich": "wasser", "terrasse": "flach", "trampolin": "rund",
                "hecke": "streifen", "zaun_mauer": "streifen", "baum": "vegetation", "strauch": "vegetation"}


def kandidat_aus_umriss(s: dict, g: Polygon, klasse: str) -> dict:
    """Vom Nutzer gezeichneter Umriss → Kandidat mit denselben Merkmalen wie einer aus der Erkennung, damit er als
    Lernbeispiel taugt. Familie aus der Klasse, kein SAM (sam_score/sam_iou = −1 wie bei Kandidaten ohne SAM)."""
    H, W = s["dgm"].shape
    maske, fenster = g8._maske_aus_geom(g, tuple(s["_bb"]), (H, W))
    c = {"familie": FAMILIE_FUER.get(klasse, "bau"), "geom": g, "maske": maske, "fenster": fenster}
    c["merkmale"] = g8.merkmale(s, c)
    return c


def _register() -> dict:
    if REGISTER.exists():
        return json.loads(REGISTER.read_text(encoding="utf-8"))
    # Ausgangspunkt: die in Phase 1 gemessene Version
    m = pickle.loads(g8.MODELL.read_bytes())
    t = json.loads((ref_mod.REF / "auswertung_test.json").read_text(encoding="utf-8"))
    return {"_hinweis": "Freigaberegel: F1 je Klasse (mit Referenzobjekten) und F1 „Nebengebäude“ auf dem eingefrorenen Test-Set "
                        "dürfen gegenüber der freigegebenen Version nicht sinken.",
            "freigegeben": m["version"],
            "versionen": [{"version": m["version"], "datum": t["datum"], "status": "freigegeben", "lern_beispiele": 0,
                           "metriken": _kurz(t["klassen"]), "gruende": ["Ausgangsversion aus Phase 1"]}]}


def _kurz(rows: list[dict]) -> list[dict]:
    return [{k: r[k] for k in ("klasse", "ref", "erkannt", "tp", "praezision", "trefferquote")} for r in rows]


def _f1(r: dict) -> float:
    p, q = r.get("praezision") or 0.0, r.get("trefferquote") or 0.0
    return 0.0 if p + q == 0 else 2 * p * q / (p + q)


def freigabe(alt: list[dict], neu: list[dict]) -> tuple[bool, list[str]]:
    """Freigaberegel. alt/neu: Zeilen wie in auswertung_test.json (klasse, ref, praezision, trefferquote)."""
    n = {r["klasse"]: r for r in neu}
    gruende, ok = [], True
    for a in alt:
        if not a.get("ref"):
            continue
        b = n.get(a["klasse"])
        fa, fb = _f1(a), _f1(b) if b else 0.0
        if fb + 1e-9 < fa:
            ok = False
            gruende.append(f"{a['klasse']}: F1 {fa:.2f} → {fb:.2f} (schlechter)")
        else:
            gruende.append(f"{a['klasse']}: F1 {fa:.2f} → {fb:.2f}")
    return ok, gruende


def _testflaechen():
    gs, _ = g8.referenz()
    return [g["geom"].buffer(TEST_PUFFER) for g in gs.values() if g["split"] == "test"]


def eintraege_lesen(pfad: Path) -> list[dict]:
    out = []
    for z in pfad.read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(z)
        except json.JSONDecodeError:
            continue
        if e.get("aktion") in AKTIONEN and isinstance(e.get("geometrie"), list) and len(e["geometrie"]) >= 3:
            out.append(e)
    return out


def importieren(pfad: Path = JSONL) -> int:
    """Beitrag → Lernbeispiel: Kandidat der Erkennung mit IoU ≥ 0,3 zum Umriss suchen, Ziel = Klasse
    (verworfen → 'nichts'). Nur Klassen, die das Modell kennt.

    Gezeichnete Objekte (aktion 'neu' oder 'nachgezogen') ohne passenden Kandidaten werden trotzdem aufgenommen:
    Merkmale direkt aus dem gezeichneten Umriss (kandidat_aus_umriss), Quelle 'gezeichnet'. Ehrliche Grenze: das
    bringt dem Klassifikator Beispiele, findet aber Objekte nicht, die der Kandidatengenerator gar nicht erst
    vorschlägt – dafür müsste der Generator selbst lernen."""
    if not pfad.exists():
        print(f"keine Beiträge ({pfad})")
        return 0
    m = pickle.loads(g8.MODELL.read_bytes())
    klassen = set(m["klassen"])
    test = _testflaechen()
    alt = pickle.loads(BEISPIELE.read_bytes()) if BEISPIELE.exists() else {}
    zaehl = {"neu": 0, "gezeichnet": 0, "schon_da": 0, "test_nah": 0, "klasse_unbekannt": 0, "kein_kandidat": 0}
    for e in eintraege_lesen(pfad):
        gezeichnet = e["aktion"] in ("neu", "nachgezogen")
        # alte Importe haben gezeichnete Objekte ohne Kandidaten als None gemerkt – die jetzt nachholen
        if e["id"] in alt and not (alt[e["id"]] is None and gezeichnet):
            zaehl["schon_da"] += 1
            continue
        g = Polygon(e["geometrie"]).buffer(0)
        if any(t.intersects(g) for t in test):
            zaehl["test_nah"] += 1
            continue
        ziel = "nichts" if e["aktion"] == "verworfen" else e["klasse"]
        if ziel not in klassen:
            zaehl["klasse_unbekannt"] += 1
            continue
        x0, y0, x1, y1 = g.buffer(20).bounds
        bb = (np.floor(x0), np.floor(y0), np.ceil(x1), np.ceil(y1))
        s, kand = g8.ausschnitt(bb)
        paare = g8.zuordnen([c["geom"] for c in kand], [{"geom": g}], IOU_MIN)
        if not paare and not gezeichnet:
            zaehl["kein_kandidat"] += 1
            alt[e["id"]] = None  # merken, damit es nicht jedes Mal neu gerechnet wird
            continue
        if paare:
            c, quelle, info = kand[paare[0][0]], "kandidat", f"IoU {paare[0][2]:.2f}"
            zaehl["neu"] += 1
        else:
            c, quelle, info = kandidat_aus_umriss(s, g, ziel), "gezeichnet", "ohne Kandidat, aus Umriss"
            zaehl["gezeichnet"] += 1
        alt[e["id"]] = {"merkmale": c["merkmale"], "ziel": ziel, "aktion": e["aktion"], "kachel": e.get("kachel"),
                        "quelle": quelle}
        print(f"  {e['id'][:8]} {e['aktion']:11s} {ziel:15s} {info}", flush=True)
    # gelöschte Beiträge auch aus den Lernbeispielen entfernen
    ids = {e["id"] for e in eintraege_lesen(pfad)}
    weg = [k for k in alt if k not in ids]
    for k in weg:
        del alt[k]
    BEISPIELE.write_bytes(pickle.dumps(alt))
    print(f"Import: {zaehl}, entfernt (gelöscht): {len(weg)}, nutzbar insgesamt: {sum(1 for v in alt.values() if v)}")
    return 0


def trainieren() -> Path:
    from sklearn.ensemble import HistGradientBoostingClassifier
    split = g8._split()
    cache = g8.merkmale_cache(ids=split["dev"])
    X, y, meta, cols = g8.lern_tabelle(cache, split["dev"])
    zk, zz = g8.zusatz_beispiele()
    lern = [v for v in (pickle.loads(BEISPIELE.read_bytes()) if BEISPIELE.exists() else {}).values() if v]
    zusatz = [(c["merkmale"], k) for c, k in zip(zk, zz)] + [(v["merkmale"], v["ziel"]) for v in lern]
    if zusatz:
        X = np.vstack([X, np.array([[f[k] for k in cols] for f, _ in zusatz], np.float32)])
        y = np.concatenate([y, np.array([k for _, k in zusatz])])
    clf = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, max_leaf_nodes=15, l2_regularization=1.0,
                                         class_weight="balanced", random_state=0)
    clf.fit(X, y)
    reg = _register()
    version = max(v["version"] for v in reg["versionen"]) + 1
    alt = pickle.loads(g8.MODELL.read_bytes())
    MODELLE.mkdir(parents=True, exist_ok=True)
    ziel = MODELLE / f"garten_v{version}.pkl"
    pickle.dump({"modell": clf, "spalten": cols, "klassen": list(clf.classes_), "schwellen": alt["schwellen"],
                 "version": version, "dev": split["dev"], "lern_beispiele": len(lern),
                 "lern_gezeichnet": sum(1 for v in lern if v.get("quelle") == "gezeichnet")}, open(ziel, "wb"))
    n_gez = sum(1 for v in lern if v.get("quelle") == "gezeichnet")
    print(f"Kandidat v{version}: {len(y)} Beispiele, davon {len(lern)} aus der Lernschleife ({n_gez} gezeichnet ohne Kandidat) → {ziel}")
    return ziel


def pruefen() -> bool:
    reg = _register()
    kandidaten = sorted(MODELLE.glob("garten_v*.pkl"), key=lambda p: int(p.stem.split("_v")[1]))
    bekannt = {v["version"] for v in reg["versionen"]}
    offen = [p for p in kandidaten if int(p.stem.split("_v")[1]) not in bekannt]
    if not offen:
        print("kein neuer Kandidat")
        return False
    neu_p = offen[-1]
    neu = pickle.loads(neu_p.read_bytes())
    alt = pickle.loads(g8.MODELL.read_bytes())
    print(f"Test-Set: freigegeben v{alt['version']} gegen Kandidat v{neu['version']}")
    rows_alt, *_ = g9.test_messen(alt)
    rows_neu, *_ = g9.test_messen(neu)
    ok, gruende = freigabe(rows_alt, rows_neu)
    eintrag = {"version": neu["version"], "datum": time.strftime("%Y-%m-%d"), "status": "freigegeben" if ok else "abgelehnt",
               "lern_beispiele": neu.get("lern_beispiele", 0), "metriken": _kurz(rows_neu), "gruende": gruende,
               "verglichen_mit": alt["version"]}
    reg["versionen"].append(eintrag)
    if ok:
        sicherung = MODELLE / f"garten_v{alt['version']}.pkl"
        if not sicherung.exists():
            shutil.copy(g8.MODELL, sicherung)
        shutil.copy(neu_p, g8.MODELL)
        reg["freigegeben"] = neu["version"]
        print(f"FREIGEGEBEN: v{neu['version']}. Danach App-Daten neu erzeugen: 08_garten.py gebiet, 04_export_app.py")
    else:
        print(f"ABGELEHNT: v{neu['version']} bleibt liegen, freigegeben bleibt v{alt['version']}")
    for g in gruende:
        print("  ", g)
    REGISTER.write_text(json.dumps(reg, indent=1, ensure_ascii=False), encoding="utf-8")
    return ok


def simulieren(n: int = 20, pfad: Path = JSONL) -> int:
    """Mechanik-Test ohne echte Nutzer: n Beiträge aus der Dev-Referenz (bestätigt mit Referenz-Umriss) und
    verworfene Detektionen aus garten.geojson, die in Dev-Grundstücken keinem Referenzobjekt entsprechen.
    Kein Qualitätsgewinn zu erwarten – die Dev-Referenz steckt schon im Training."""
    import uuid
    gs, ref = g8.referenz()
    dev = {pid for pid, g in gs.items() if g["split"] == "dev"}
    rnd = random.Random(20261004)
    pos = [o for o in ref if o["grundstueck"] in dev]
    rnd.shuffle(pos)
    zeilen = []
    for o in pos[: n // 2]:
        pts = [[round(x, 1), round(y, 1)] for x, y in list(o["geom"].exterior.coords)[:-1]][:64]
        zeilen.append({"id": str(uuid.uuid4()), "aktion": "bestaetigt", "klasse": o["klasse"], "geometrie": pts,
                       "kachel": f"{int(pts[0][0] // 1000)}_{int(pts[0][1] // 1000)}", "modell": None})
    det = json.loads((build_dir() / "garten.geojson").read_text(encoding="utf-8"))["features"]
    devflaechen = [gs[p]["geom"] for p in dev]
    falsch = []
    for f in det:
        g = shape(f["geometry"])
        if f["properties"]["klasse"] in ("baum", "strauch") or not any(d.contains(g.centroid) for d in devflaechen):
            continue
        if not any(o["geom"].intersects(g) for o in ref):
            falsch.append((f, g))
    rnd.shuffle(falsch)
    for f, g in falsch[: n - len(zeilen)]:
        pts = [[round(x, 1), round(y, 1)] for x, y in list(g.exterior.coords)[:-1]][:64]
        zeilen.append({"id": str(uuid.uuid4()), "aktion": "verworfen", "klasse": f["properties"]["klasse"], "geometrie": pts,
                       "kachel": f"{int(pts[0][0] // 1000)}_{int(pts[0][1] // 1000)}", "modell": f["properties"].get("modell_version")})
    pfad.parent.mkdir(parents=True, exist_ok=True)
    pfad.write_text("".join(json.dumps(z) + "\n" for z in zeilen), encoding="utf-8")
    print(f"{len(zeilen)} simulierte Beiträge → {pfad}")
    return 0


if __name__ == "__main__":
    a = sys.argv[1:] or ["alles"]
    pfad = Path(a[1]) if len(a) > 1 and a[0] in ("import", "alles") else JSONL
    if a[0] == "import":
        sys.exit(importieren(pfad))
    if a[0] == "trainieren":
        trainieren()
    elif a[0] == "pruefen":
        pruefen()
    elif a[0] == "alles":
        importieren(pfad)
        trainieren()
        pruefen()
    elif a[0] == "simulieren":
        sys.exit(simulieren(int(a[1]) if len(a) > 1 else 20, Path(a[2]) if len(a) > 2 else JSONL))
    else:
        print(__doc__)
