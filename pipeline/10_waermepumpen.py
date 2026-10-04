#!/usr/bin/env python3
"""Wärmepumpen-Geräteliste für die App (AUFTRAG_V2 Phase 2.3) → app/public/data/waermepumpen.json.

Quelle: hplib (FZJ IEK-3, MIT-Lizenz, https://github.com/FZJ-IEK3-VSA/hplib), Datei hplib_database_all.csv, die aus den
öffentlichen Heat-Pump-KEYMARK-Datenblättern (keymark.eu, © KEYMARK, keine offene Lizenz angegeben) erzeugt wird.
Spalte „SPL outdoor [dBA]“ ist laut hplib-Parser der „Sound power level outdoor“ aus dem Datenblatt, also die
Schallleistung nach EN 12102 im Nennbetrieb – nicht der Nachtbetrieb.

Nur Außengeräte mit Luft als Quelle (Type beginnt mit „Outdoor Air“), Schallleistung 35–80 dB(A), je Hersteller+Modell
ein Eintrag (jüngstes Datum). Ausgabe kompakt: [Hersteller, Modell, Lw, Datum, Heizleistung kW].

  python3 10_waermepumpen.py      # lädt hplib als Wheel nach data/raw/hplib (pip download), falls nicht vorhanden
"""
from __future__ import annotations

import csv
import io
import json
import subprocess
import sys
import zipfile

from common import app_data_dir, raw_dir

VERSION = "1.9"


def wheel():
    d = raw_dir() / "hplib"
    d.mkdir(exist_ok=True)
    w = sorted(d.glob(f"hplib-{VERSION}-*.whl"))
    if not w:
        subprocess.run([sys.executable, "-m", "pip", "download", f"hplib=={VERSION}", "--no-deps", "-q", "-d", str(d)], check=True)
        w = sorted(d.glob(f"hplib-{VERSION}-*.whl"))
    return w[0]


def main() -> int:
    z = zipfile.ZipFile(wheel())
    rows = list(csv.DictReader(io.StringIO(z.read("hplib/hplib_database_all.csv").decode("utf-8", "ignore"))))
    beste: dict[tuple[str, str], dict] = {}
    for r in rows:
        if not r["Type"].startswith("Outdoor Air"):
            continue
        try:
            lw = float(r["SPL outdoor [dBA]"])
        except ValueError:
            continue
        if not 35 <= lw <= 80:
            continue
        key = (r["Manufacturer"].strip(), r["Model"].strip())
        if key not in beste or r["Date"] > beste[key]["Date"]:
            beste[key] = {**r, "lw": lw}
    out = []
    for (h, m), r in sorted(beste.items(), key=lambda x: (x[0][0].lower(), x[0][1].lower())):
        try:
            kw = round(float(r["P_th_h_ref [W]"]) / 1000, 1)
        except ValueError:
            kw = None
        out.append([h, m, r["lw"], r["Date"], kw])
    meta = {
        "quelle": "Heat Pump KEYMARK (keymark.eu) über hplib " + VERSION + " (FZJ IEK-3, MIT)",
        "hinweis": "Schallleistung außen nach EN 12102 im Nennbetrieb. Nicht der Nachtbetrieb. Rechte an den KEYMARK-Daten "
                   "nicht abschließend geklärt (siehe docs/attributions.md).",
        "spalten": ["hersteller", "modell", "lw_dba", "datum", "heizleistung_kw"],
    }
    p = app_data_dir() / "waermepumpen.json"
    p.write_text(json.dumps({**meta, "geraete": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out)} Geräte von {len({h for h, *_ in out})} Herstellern → {p} ({p.stat().st_size // 1024} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
