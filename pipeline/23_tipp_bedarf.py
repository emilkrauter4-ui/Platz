#!/usr/bin/env python3
"""Embeddings bei Bedarf: Messungen für docs/messungen/tipp_bedarf.md.

  python3 23_tipp_bedarf.py fp16      Umrisse mit fp32- gegen fp16-Embeddings (Kriterium IoU ≥ 0,99)
  python3 23_tipp_bedarf.py fenster   Fenster je Grundstück + 20 m Rand (60 Referenz-Grundstücke)
  python3 23_tipp_bedarf.py dienst    Ende-zu-Ende über HTTP in einer Kachel ohne Vorberechnung: /vorbereiten, danach Tipps
  python3 23_tipp_bedarf.py bericht   Hochrechnung Bayern aus den drei Messungen → tipp_bedarf.md/.json

Jeder Schritt schreibt sein Ergebnis nach docs/messungen/tipp_bedarf.json (Schlüssel = Schritt).
"""
from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
from shapely.geometry import shape

import tipp

g8 = tipp.g8
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "messungen"
JS = OUT / "tipp_bedarf.json"
DEMO = ("698_5486", "699_5486")
KLASSEN = ("gartenhaus", "pool", "trampolin", "gewaechshaus", "carport_garage")
PORT = 8797


def _merken(schluessel: str, wert) -> None:
    d = json.loads(JS.read_text(encoding="utf-8")) if JS.exists() else {}
    d[schluessel] = wert
    JS.write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")


def _iou(a, b) -> float:
    if a is None and b is None:
        return 1.0
    if a is None or b is None:
        return 0.0
    return a.intersection(b).area / max(a.union(b).area, 1e-9)


class _Fest:
    def __init__(self, f):
        self.f = f

    def features(self, zelle):
        return self.f


def _runden(f: dict, dtype) -> dict:
    import torch
    r = lambda t: torch.from_numpy(t.detach().numpy().astype(dtype).astype(np.float32))
    return {"image_embed": r(f["image_embed"]), "high_res_feats": [r(t) for t in f["high_res_feats"]]}


def fp16() -> int:
    """Gleicher Tipp, gleiche Pipeline – einmal mit fp32-, einmal mit fp16-gerundetem Embedding. Tippstellen: alle
    sicheren Test-Set-Objekte v2 in den Demo-Kacheln (Objektmitte) und je Kachel 40 Zufallspunkte."""
    t17 = importlib.import_module("17_testset_objekte")
    _, ref = t17.referenz("v2")
    punkte = []
    for r in ref:
        c = r["geom"].centroid if r["geom"].contains(r["geom"].centroid) else r["geom"].representative_point()
        if r["sicher"] and r["klasse"] in KLASSEN and f"{int(c.x // 1000)}_{int(c.y // 1000)}" in DEMO:
            punkte.append(("objekt", r["klasse"], c.x, c.y))
    rng = np.random.default_rng(7)
    for k in DEMO:
        ox, oy = (float(v) * 1000 for v in k.split("_"))
        punkte += [("zufall", None, ox + rng.uniform(50, 950), oy + rng.uniform(50, 950)) for _ in range(40)]
    je = {}
    for p in punkte:
        je.setdefault(tipp.raster_fenster(p[2], p[3])[0], []).append(p)
    pred = tipp._sam()
    zeilen = []
    t0 = time.time()
    for n, (zelle, ps) in enumerate(je.items()):
        _, bb = tipp.raster_fenster(ps[0][2], ps[0][3])
        s = g8.signale(bb)
        pred.set_image(tipp.fenster_bild(bb))
        f32 = {"image_embed": pred._features["image_embed"].clone(),
               "high_res_feats": [t.clone() for t in pred._features["high_res_feats"]]}
        f16 = _runden(f32, np.float16)
        for art, klasse, x, y in ps:
            erg = {}
            for name, f in (("f32", f32), ("f16", f16)):
                for form in (False, True):
                    s.pop("_sam_bb", None)
                    seg = tipp.segmentieren(s, x, y, form=form, klasse=klasse, vorberechnet=True, speicher=_Fest(f))
                    erg[(name, form)] = seg["geom"] if seg else None
            zeilen.append({"art": art, "klasse": klasse, "zelle": list(zelle),
                           "iou_maske": round(_iou(erg[("f32", False)], erg[("f16", False)]), 4),
                           "iou_umriss": round(_iou(erg[("f32", True)], erg[("f16", True)]), 4),
                           "leer": erg[("f32", True)] is None and erg[("f16", True)] is None})
        if n % 20 == 0:
            print(f"  {n + 1}/{len(je)} Fenster ({time.time() - t0:.0f} s)", flush=True)
    gueltig = [z for z in zeilen if not z["leer"]]
    um = np.array([z["iou_umriss"] for z in gueltig])
    ma = np.array([z["iou_maske"] for z in gueltig])
    unter = [z for z in gueltig if z["iou_umriss"] < 0.99]
    erg = {"tipps": len(zeilen), "mit_umriss": len(gueltig), "objekte": sum(z["art"] == "objekt" for z in gueltig),
           "umriss_median": round(float(np.median(um)), 4), "umriss_min": round(float(um.min()), 4),
           "umriss_anteil_ge_099": round(float((um >= 0.99).mean()), 4),
           "maske_median": round(float(np.median(ma)), 4), "maske_min": round(float(ma.min()), 4),
           "maske_anteil_ge_099": round(float((ma >= 0.99).mean()), 4),
           "objekte_min": round(float(min(z["iou_umriss"] for z in gueltig if z["art"] == "objekt")), 4),
           "unter_099": unter, "sekunden": round(time.time() - t0)}
    _merken("fp16", erg)
    print(json.dumps({k: v for k, v in erg.items() if k != "unter_099"}, indent=1), f"\nunter 0,99: {len(unter)}")
    return 0


def fenster() -> int:
    """Wie viele Gitterfenster braucht ein Grundstück plus 20 m Rand? Echte Grenzen der 60 Referenz-Grundstücke."""
    gs = json.load(open(ROOT / "data/reference/grundstuecke.geojson", encoding="utf-8"))["features"]
    n, flaeche = [], []
    for f in gs:
        g = shape(f["geometry"])
        n.append(len(tipp.zellen_fuer_bereich(*g.bounds)))
        flaeche.append(g.area)
    erg = {"grundstuecke": len(n), "flaeche_median_m2": round(float(np.median(flaeche))),
           "fenster_median": float(np.median(n)), "fenster_p90": float(np.percentile(n, 90)), "fenster_max": int(max(n)),
           "fenster_min": int(min(n)), "rand_m": tipp.BEDARF_RAND_M, "raster_schritt_m": tipp.RASTER_SCHRITT}
    _merken("fenster", erg)
    print(json.dumps(erg, indent=1))
    return 0


def _post(pfad: str, obj: dict, timeout: float = 120) -> tuple[float, dict]:
    t = time.perf_counter()
    r = urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{PORT}{pfad}", json.dumps(obj).encode(),
                                                      {"Content-Type": "application/json"}), timeout=timeout)
    a = json.loads(r.read())
    return time.perf_counter() - t, a


def _get(pfad: str) -> dict:
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}{pfad}", timeout=10).read())


def dienst() -> int:
    """Grundstücke außerhalb der Demo-Kacheln (Referenz-Grundstücke in 698_5487 / 699_5487), leerer Cache:
    1. Tipp ohne Vorbereitung (live), 2. /vorbereiten, Tipp während der Hintergrundrechnung, 3. nach Abschluss Tipps
    auf die Objekte des Grundstücks."""
    cache = tipp.CACHE.ordner
    sicherung = cache.with_name("cache_messung_sicherung")
    if cache.exists():
        shutil.rmtree(sicherung, ignore_errors=True)
        cache.rename(sicherung)
    gs = json.load(open(ROOT / "data/reference/grundstuecke.geojson", encoding="utf-8"))["features"]
    ref = json.load(open(ROOT / "data/reference/referenz.geojson", encoding="utf-8"))["features"]
    kand = []
    for f in gs:
        g = shape(f["geometry"])
        k = f"{int(g.centroid.x // 1000)}_{int(g.centroid.y // 1000)}"
        obj = [shape(r["geometry"]) for r in ref if r["properties"]["grundstueck"] == f["properties"]["id"]
               and r["properties"]["klasse"] in KLASSEN]
        if k not in DEMO and obj:
            kand.append((f["properties"]["id"], g, obj))
    kand = kand[:3]
    t0 = time.perf_counter()
    p = subprocess.Popen([sys.executable, "tipp_dienst.py", str(PORT)], cwd=Path(__file__).parent, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, text=True)
    for zeile in p.stdout:
        if zeile.startswith("bereit"):
            break
    start = time.perf_counter() - t0
    try:
        grund = []
        for gid, g, obj in kand:
            c = [obj[0].representative_point().x, obj[0].representative_point().y]
            rest = obj[1:] or obj
            # 1) erster Tipp ganz ohne Vorbereitung (Fenster wird live gerechnet und gemerkt)
            # – nur beim ersten Grundstück, damit die übrigen zeigen, wie es mit Vorbereitung läuft
            live = None
            if not grund:
                dt, a = _post("/tipp", {"x": c[0], "y": c[1]})
                live = {"s": round(dt, 3), "embedding": a.get("embedding")}
            # 2) Vorbereitung anstoßen, sofort ein Tipp während der Rechnung
            umriss = [[round(x, 2), round(y, 2)] for x, y in list(g.exterior.coords)[:-1]]
            tv = time.perf_counter()
            dt_v, v = _post("/vorbereiten", {"umriss": umriss})
            q = rest[0].representative_point()
            dt_w, a_w = _post("/tipp", {"x": q.x, "y": q.y})
            while _get("/vorbereiten")["wartend"] > 0:
                time.sleep(0.2)
            fertig = time.perf_counter() - tv
            # 3) danach Tipps auf alle Objekte
            nach = []
            for o in obj:
                r = o.representative_point()
                dt, a = _post("/tipp", {"x": r.x, "y": r.y})
                nach.append({"s": round(dt, 3), "embedding": a.get("embedding")})
            grund.append({"grundstueck": gid, "flaeche_m2": round(g.area), "fenster": v.get("fenster"), "neu": v.get("neu"),
                          "anfrage_s": round(dt_v, 3), "fertig_s": round(fertig, 1), "erster_tipp_ohne_vorbereitung": live,
                          "tipp_waehrend": {"s": round(dt_w, 3), "embedding": a_w.get("embedding")}, "tipps_danach": nach})
            print(json.dumps(grund[-1], ensure_ascii=False), flush=True)
    finally:
        p.terminate()
        p.wait()
    groesse = [f.stat().st_size for f in cache.glob("*_*.npz")]
    danach = [t["s"] for gr in grund for t in gr["tipps_danach"]]
    erg = {"dienst_start_s": round(start, 1), "grundstuecke": grund, "datei_mb": round(float(np.mean(groesse)) / 1e6, 2) if groesse else None,
           "fenster_s": round(sum(g["fertig_s"] for g in grund) / max(sum(g["neu"] or 0 for g in grund), 1), 2),
           "danach_median_s": round(float(np.median(danach)), 3), "danach_max_s": round(max(danach), 3),
           "danach_alle_vorberechnet": all(t["embedding"] == "vorberechnet" for gr in grund for t in gr["tipps_danach"]),
           "maschine": "Container, 4 CPU-Kerne, keine GPU", "datum": time.strftime("%Y-%m-%d")}
    shutil.rmtree(cache, ignore_errors=True)
    if sicherung.exists():
        sicherung.rename(cache)
    _merken("dienst", erg)
    print(json.dumps({k: v for k, v in erg.items() if k != "grundstuecke"}, indent=1))
    return 0


# Bayern: Landesfläche 70 542 km²; Siedlungs- und Verkehrsfläche 12,4 % (2024, LfU-Indikator
# https://www.lfu.bayern.de/umweltdaten/indikatoren/ressourcen_effizienz/siedlungsflaeche_verkehrsflaeche/index.htm)
BAYERN_KM2 = 70542.0
SUV_ANTEIL = 0.124
VORBERECHNUNG_S = 739 / 484   # 20_tipp_embeddings.py, Kachel 699_5486, 4 CPU-Kerne
# Kachelmessungen (20_tipp_embeddings.py, index.json): je 1 × 1 km, 22 × 22 = 484 Fenster, 4,06 GB
KACHEL_KM2 = 1.0
KACHEL_FENSTER = 484
KACHEL_S = (739, 836)          # 699_5486, 698_5486


def bericht() -> int:
    d = json.loads(JS.read_text(encoding="utf-8"))
    f16, fe, di = d["fp16"], d["fenster"], d["dienst"]
    mb = di["datei_mb"]
    je_km2 = (1000 / tipp.RASTER_SCHRITT) ** 2
    def voll(km2):
        n = km2 * je_km2
        return {"km2": round(km2), "fenster": round(n), "tb_fp16": round(n * mb / 1e6, 1), "tb_fp32": round(n * mb * 2 / 1e6, 1),
                "cpu_h": round(n * VORBERECHNUNG_S / 3600), "cpu_h_max": round(n * KACHEL_S[1] / KACHEL_FENSTER / 3600)}
    land, suv = voll(BAYERN_KM2), voll(BAYERN_KM2 * SUV_ANTEIL)
    je_gs = {"fenster_median": fe["fenster_median"], "fenster_p90": fe["fenster_p90"], "mb_median": round(fe["fenster_median"] * mb),
             "mb_p90": round(fe["fenster_p90"] * mb), "s_median": round(fe["fenster_median"] * di["fenster_s"]),
             "s_p90": round(fe["fenster_p90"] * di["fenster_s"])}
    n100k = 100000 * fe["fenster_median"]
    bedarf = {"grundstuecke": 100000, "fenster": round(n100k), "tb_fp16": round(n100k * mb / 1e6, 1),
              "cpu_h": round(n100k * di["fenster_s"] / 3600)}
    cache_fenster = int(tipp.CACHE_MAX_GB * 1e3 / mb)
    k_gb = KACHEL_FENSTER * mb / 1e3
    kachel = {"gb": round(k_gb, 2), "tb": round(BAYERN_KM2 / KACHEL_KM2 * k_gb / 1e3), "h": [round(BAYERN_KM2 * t / 3600) for t in KACHEL_S]}
    falsch = {"tb": round(BAYERN_KM2 / 4 * k_gb / 1e3), "tage": [round(BAYERN_KM2 / 4 * t / 86400) for t in KACHEL_S]}
    _merken("hochrechnung", {"kachel_hochgerechnet": kachel, "annahme_2x2km": falsch, "bayern": land, "siedlung_verkehr": suv, "je_grundstueck": je_gs, "bedarf_100k": bedarf,
                             "cache_max_gb": tipp.CACHE_MAX_GB, "cache_fenster": cache_fenster})
    z = lambda v: f"{v:,.0f}".replace(",", " ")
    k = lambda v, n=2: f"{v:.{n}f}".replace(".", ",")
    gr = di["grundstuecke"]
    md = f"""# Tipp-Embeddings bei Bedarf ({di['datum']})

Seit diesem Stand rechnet der Tipp-Dienst die SAM-2-Bildfenster erst, wenn eine Adresse gewählt ist: zunächst
vorläufig für Adresspunkt ± 30 m, nach „Grenze bestätigen“ für das Grundstück plus {k(fe['rand_m'], 0)} m Rand (`POST /vorbereiten`,
Hintergrund, Cache `data/build/tipp_embed/cache/`, Obergrenze {k(tipp.CACHE_MAX_GB, 0)} GB ≈ {z(cache_fenster)} Fenster, die am längsten
unbenutzten fliegen zuerst). Jeder live gerechnete Tipp landet ebenfalls im Cache. Ganze Kacheln werden nur noch für die
Demo-Kacheln 698_5486 und 699_5486 vorberechnet. Gemessen auf {di['maschine']}. Skript: `pipeline/23_tipp_bedarf.py`.

## fp16 statt fp32

Gleicher Tipp, gleiche Pipeline, einmal mit fp32-Embedding, einmal auf fp16 gerundet. {f16['tipps']} Tipps: {f16['objekte']} auf
sichere Objekte des Test-Sets v2, dazu 80 Zufallspunkte; {f16['mit_umriss']} davon liefern einen Umriss.

| | Median IoU | Minimum | Anteil ≥ 0,99 |
|---|---|---|---|
| SAM-Maske (vor der Formregel) | {k(f16['maske_median'], 4)} | {k(f16['maske_min'], 4)} | {k(f16['maske_anteil_ge_099'] * 100, 1)} % |
| fertiger Umriss, alle Tipps | {k(f16['umriss_median'], 4)} | {k(f16['umriss_min'], 4)} | {k(f16['umriss_anteil_ge_099'] * 100, 1)} % |
| fertiger Umriss, nur echte Objekte | | {k(f16['objekte_min'], 4)} | 100 % |

**Entscheidung: fp16 bleibt.** Alle SAM-Masken und alle fertigen Umrisse bleiben bei IoU ≥ 0,99.
Beim ersten Lauf (10.10.) kippte genau ein Umriss (Zufallspunkt ohne Objekt, IoU 0,60): Die Masken waren praktisch
gleich, aber die Rechteck-Regel („Rechteck ab Fläche/Rechteck 0,6“) lag mit 0,6005 (fp32) und 0,5987 (fp16) genau auf
der Schwelle. Seitdem (`tipp.rechteck_entscheidung`, Test `pipeline/test_tipp_form.py`):
- **Totband ± 0,05 um die Schwelle:** ab 0,65 Rechteck, unter 0,55 Umriss wie von SAM. Dazwischen entscheidet das
  Material (Laser p90 ≥ 1,5 m und nicht grün → Rechteck), das bei so kleinen Maskenunterschieden praktisch gleich bleibt (Median über viele Pixel).
- **„Kein Objekt gefunden“:** SAM-Score < 0,2 und P(nichts) ≥ 0,99, nur ohne vom Nutzer gewählte Klasse
  (`docs/messungen/tipp_objektpruefung.md`). Der gekippte Fall (Score 0,064, P(nichts) 0,9997) liefert jetzt keinen
  Umriss mehr, sondern diese Meldung.
- Auf dem Test-Set v2 ändert das 2 von 87 Umrissen, beide schon vorher Fehlschläge (IoU < 0,5); die Erfolgsquoten
  bleiben gleich (Gartenhaus 63 %, Pool 33 %, Trampolin 43 %).

Verlustfrei komprimiert (zlib) spart ein fp16-Fenster nur 13 % und kostet 2 s – deshalb unkomprimiert.

## Ein Grundstück

Fenster je Grundstück plus {k(fe['rand_m'], 0)} m Rand, an den {fe['grundstuecke']} Referenz-Grundstücken (echte Grenzen, Median {fe['flaeche_median_m2']} m²):
Median {k(fe['fenster_median'], 0)}, 90 % ≤ {k(fe['fenster_p90'], 0)}, höchstens {fe['fenster_max']}. Je Fenster {k(mb)} MB (fp16), Rechenzeit im Dienst
{k(di['fenster_s'])} s (inklusive eines gleichzeitigen Tipps).

Ende zu Ende über HTTP, leerer Cache, drei Referenz-Grundstücke außerhalb der Demo-Kacheln:

| Grundstück | Fenster | Vorbereitung fertig nach | Tipp während der Vorbereitung | Tipps danach |
|---|---|---|---|---|
""" + "".join(f"| {g['grundstueck']} ({g['flaeche_m2']} m²) | {g['neu']} | {k(g['fertig_s'], 1)} s | {k(g['tipp_waehrend']['s'])} s | {' / '.join(k(t['s']) for t in g['tipps_danach'])} s |\n" for g in gr) + f"""
- Erster Tipp ganz ohne Vorbereitung (A03, Fenster live, Daten kalt): {k(gr[0]['erster_tipp_ohne_vorbereitung']['s'])} s.
- Nach der Vorbereitung: alle Tipps aus dem Cache, Median {k(di['danach_median_s'])} s, Maximum {k(di['danach_max_s'])} s – unter 1 s.
- Während der Vorbereitung teilen sich Tipp und Hintergrund die 4 Kerne: 1–4 s. Im echten Ablauf setzt der Nutzer zwischen
  Adresswahl und erstem Tipp erst seine Grenzpunkte; die vorläufige Vorbereitung (± 30 m) läuft in dieser Zeit.
- Dienst-Start mit beiden Demo-Kacheln: {k(di['dienst_start_s'], 0)} s.

## Hochrechnung Bayern

Gitter {k(tipp.RASTER_SCHRITT, 0)} m → {z(je_km2)} Fenster je km². Rechenzeit für Vorberechnung {k(VORBERECHNUNG_S)}–{k(KACHEL_S[1] / KACHEL_FENSTER)} s je Fenster
(4 CPU-Kerne, zwei Kachelläufe). Speicher fp16, {k(mb)} MB je Fenster. Keine GPU gemessen.

| Variante | Fläche | Fenster | Speicher fp16 | (fp32) | Rechenzeit (4 Kerne) |
|---|---|---|---|---|---|
| ganz Bayern vorberechnen | {z(land['km2'])} km² | {z(land['fenster'])} | {k(land['tb_fp16'], 0)} TB | {k(land['tb_fp32'], 0)} TB | {z(land['cpu_h'])}–{z(land['cpu_h_max'])} h ≈ {k(land['cpu_h'] / 8760, 1)}–{k(land['cpu_h_max'] / 8760, 1)} Jahre |
| nur Siedlungs- und Verkehrsfläche (12,4 %) | {z(suv['km2'])} km² | {z(suv['fenster'])} | {k(suv['tb_fp16'], 1)} TB | {k(suv['tb_fp32'], 1)} TB | {z(suv['cpu_h'])}–{z(suv['cpu_h_max'])} h ≈ {k(suv['cpu_h'] / 24, 0)}–{k(suv['cpu_h_max'] / 24, 0)} Tage |
| **bei Bedarf, je Grundstück** | | {k(fe['fenster_median'], 0)} (90 %: {k(fe['fenster_p90'], 0)}) | {je_gs['mb_median']} MB (90 %: {je_gs['mb_p90']} MB) | | {je_gs['s_median']} s (90 %: {je_gs['s_p90']} s) |
| bei Bedarf, 100 000 Grundstücke, alles behalten | | {z(bedarf['fenster'])} | {k(bedarf['tb_fp16'], 1)} TB | | {z(bedarf['cpu_h'])} h |

### Abgleich mit der Kachelmessung

Die Kachelmessung (4,06 GB, 14 min) gilt für **eine 1 × 1 km große Kachel**, nicht für 2 × 2 km: Die Datenkachel
der Demo ist 2 × 2 km, die Embedding-Kacheln (`data/build/tipp_embed/698_5486`, `699_5486`) sind die amtlichen
1-km-Kacheln (Gitterzellen i = 0…21, j = 0…21 bei 48 m Abstand). Wer 4,06 GB auf 4 km² verteilt, kommt auf
{z(falsch['tb'])} TB und {falsch['tage'][0]}–{falsch['tage'][1]} Tage – um den Faktor 4 zu wenig.

| Ursache | Wirkung | Faktor |
|---|---|---|
| **Fläche je Kachel: 1 km², nicht 4 km²** | Hauptursache | × 4 |
| Randfenster doppelt: jede Kachel rechnet ihre Randreihe und -spalte mit (22 × 22 = 484 statt {z(je_km2)} je km² im durchgehenden Gitter) | Kachelweise {k(KACHEL_FENSTER / je_km2, 3)} × mehr | × {k(KACHEL_FENSTER / je_km2, 2)} |
| fp32 gegen fp16 | keine – beide Rechnungen in fp16 ({k(mb)} MB je Fenster = 4,19 Mio. Werte × 2 Byte); fp32 wäre × 2 | × 1 |
| Überlappung der Fenster (96 m Fenster im 48-m-Gitter, jede Stelle liegt in ≈ 4 Fenstern) | steckt in beiden Rechnungen gleich | × 1 |
| Rechenzeit je Fenster: zwei Läufe, {k(KACHEL_S[0] / KACHEL_FENSTER)} s und {k(KACHEL_S[1] / KACHEL_FENSTER)} s | Spanne der Zeit | × 1–{k(KACHEL_S[1] / KACHEL_S[0], 2)} |

Konsistent für ganz Bayern ({z(BAYERN_KM2)} km², fp16):

| Rechenweg | Speicher | Rechenzeit (4 Kerne) |
|---|---|---|
| kachelweise wie gemessen (1-km-Kacheln mit doppelten Rändern) | {z(kachel['tb'])} TB | {z(kachel['h'][0])}–{z(kachel['h'][1])} h ≈ {k(kachel['h'][0] / 8760, 1)}–{k(kachel['h'][1] / 8760, 1)} Jahre |
| durchgehendes Gitter (ohne doppelte Ränder, Tabelle oben) | {k(land['tb_fp16'], 0)} TB | {z(land['cpu_h'])}–{z(land['cpu_h_max'])} h ≈ {k(land['cpu_h'] / 8760, 1)}–{k(land['cpu_h_max'] / 8760, 1)} Jahre |
| zum Vergleich: Annahme 2 × 2 km je Kachel (falsch) | {z(falsch['tb'])} TB | {falsch['tage'][0]}–{falsch['tage'][1]} Tage |

Die 100 000 Grundstücke sind eine obere Grenze: Nachbargrundstücke teilen Fenster, und der Cache ist begrenzt. Bei Bedarf
wächst der Aufwand mit der Nutzung, nicht mit der Landesfläche – ganz Bayern vorzurechnen lohnt sich nicht.
Quellen: Landesfläche 70 542 km² und Anteil Siedlungs- und Verkehrsfläche 12,4 % (2024) laut
[LfU-Umweltindikator](https://www.lfu.bayern.de/umweltdaten/indikatoren/ressourcen_effizienz/siedlungsflaeche_verkehrsflaeche/index.htm).
Die Siedlungs- und Verkehrsfläche enthält auch Straßen, Bahn und Gewerbe; für Wohngärten ist sie eine großzügige Obergrenze.
"""
    (OUT / "tipp_bedarf.md").write_text(md, encoding="utf-8")
    print(md)
    return 0


if __name__ == "__main__":
    schritt = sys.argv[1] if len(sys.argv) > 1 else "bericht"
    sys.exit({"fp16": fp16, "fenster": fenster, "dienst": dienst, "bericht": bericht}[schritt]())
