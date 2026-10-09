#!/usr/bin/env python3
"""Antwortzeit von „Ein Tipp erfasst“ messen – so wie die App sie erlebt (HTTP an den Tipp-Dienst).

Startet tipp_dienst.py, wartet auf „bereit“, dann:
  - erster Tipp nach dem Start (Ziel < 1 s),
  - Tipps auf alle sicheren Test-Set-Objekte in der Kachel 698_5486 (vorberechnete Embeddings),
  - zum Vergleich Tipps in der Nachbarkachel 699_5486 (ohne Embeddings, Fenster wird live kodiert).
Ausgabe: docs/messungen/tipp_latenz.json/.md

  cd pipeline && python3 22_tipp_latenz.py
"""
from __future__ import annotations

import importlib
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
PORT = 8799


def tipp(x: float, y: float, klasse: str | None = None) -> tuple[float, dict]:
    body = json.dumps({"x": x, "y": y, **({"klasse": klasse} if klasse else {})}).encode()
    t = time.perf_counter()
    r = urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{PORT}/tipp", body, {"Content-Type": "application/json"}), timeout=120)
    a = json.loads(r.read())
    return time.perf_counter() - t, a


def main() -> int:
    t17 = importlib.import_module("17_testset_objekte")
    _, ref = t17.referenz("v2")
    ziele = [r for r in ref if r["sicher"] and r["klasse"] in ("gartenhaus", "pool", "trampolin", "gewaechshaus", "carport_garage")]
    kachel = lambda r: f"{int(r['geom'].centroid.x // 1000)}_{int(r['geom'].centroid.y // 1000)}"
    mit = [r for r in ziele if kachel(r) == "698_5486"]
    ohne = [r for r in ziele if kachel(r) == "699_5486"][:10]
    t0 = time.perf_counter()
    p = subprocess.Popen([sys.executable, "tipp_dienst.py", str(PORT)], cwd=Path(__file__).parent, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, text=True)
    for zeile in p.stdout:
        if zeile.startswith("bereit"):
            break
    start = time.perf_counter() - t0
    try:
        erster_r = mit[0]
        c = erster_r["geom"].centroid
        t_erst, a_erst = tipp(c.x, c.y)
        zeiten, server, emb = [], [], []
        for r in mit[1:]:
            c = r["geom"].centroid
            dt, a = tipp(c.x, c.y)
            zeiten.append(dt)
            server.append(a.get("sekunden"))
            emb.append(a.get("embedding"))
        live = []
        for r in ohne:
            c = r["geom"].centroid
            dt, a = tipp(c.x, c.y)
            live.append(dt)
    finally:
        p.terminate()
    q = lambda v, k: round(float(np.percentile(v, k)), 3)
    erg = {"dienst_start_s": round(start, 1), "erster_tipp_s": round(t_erst, 3), "erster_embedding": a_erst.get("embedding"),
           "mit_embeddings": {"n": len(zeiten), "median_s": q(zeiten, 50), "p95_s": q(zeiten, 95), "max_s": round(max(zeiten), 3),
                              "unter_1s": sum(z < 1 for z in zeiten), "alle_vorberechnet": all(e == "vorberechnet" for e in emb)},
           "ohne_embeddings": {"n": len(live), "median_s": q(live, 50), "max_s": round(max(live), 3)} if live else None,
           "maschine": "Container, 4 CPU-Kerne, keine GPU", "datum": time.strftime("%Y-%m-%d")}
    out = ROOT / "docs" / "messungen"
    (out / "tipp_latenz.json").write_text(json.dumps(erg, indent=1), encoding="utf-8")
    f = lambda v: f"{v:.2f} s".replace(".", ",")
    m = erg["mit_embeddings"]
    md = f"""# Antwortzeit „Ein Tipp erfasst“ ({erg['datum']})

Gemessen per HTTP gegen den Tipp-Dienst, wie die App ihn ruft ({erg['maschine']}). Tipps auf die sicheren Objekte des
Test-Sets in der Kachel 698_5486 (Embeddings vorberechnet mit `20_tipp_embeddings.py`).

| | Zeit |
|---|---|
| Dienst-Start bis „bereit“ (lädt SAM 2, Klassifikator, Gebäude; Probe-Tipp) | {f(erg['dienst_start_s'])} |
| **erster Tipp nach dem Start** | **{f(erg['erster_tipp_s'])}** ({erg['erster_embedding']}) |
| weitere Tipps ({m['n']}): Median / 95 % / Maximum | {f(m['median_s'])} / {f(m['p95_s'])} / {f(m['max_s'])} |
| davon unter 1 s | {m['unter_1s']} von {m['n']} |
"""
    if live:
        md += f"| zum Vergleich ohne Embeddings (Kachel 699_5486, {erg['ohne_embeddings']['n']} Tipps): Median / Maximum | {f(erg['ohne_embeddings']['median_s'])} / {f(erg['ohne_embeddings']['max_s'])} |\n"
    (out / "tipp_latenz.md").write_text(md, encoding="utf-8")
    print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
