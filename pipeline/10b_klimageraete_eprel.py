#!/usr/bin/env python3
"""Klimagerät-Geräteliste aus EPREL (AUFTRAG_V3 Phase A2) → app/public/data/klimageraete.json.  NICHT GETESTET.

Voraussetzung: ein EPREL-API-Schlüssel (Antrag über die EPREL-Website, https://eprel.ec.europa.eu; ohne Schlüssel antwortet die
Schnittstelle mit 403, geprüft am 10.10.2026). Dieses Skript wurde ohne Schlüssel geschrieben: Die Feldnamen der Antwort sind
NICHT geprüft. Es sucht das Feld der Außen-Schallleistung deshalb über den Namen (enthält „sound“, „power“ und „outdoor“) und bricht
mit einer Liste der gefundenen Felder ab, wenn es keines findet – dann den Namen unten (FELD_*) eintragen.

Bedingungen (EPREL Public API Terms and Conditions, gültig ab 03.06.2024, siehe docs/attributions.md): Quelle nennen, lokale Kopien
aktuell halten, Daten nicht verkaufen, nicht irreführend umformen. Die Werte sind Herstellerangaben (Datenblatt/Energielabel),
keine unabhängig geprüften Werte; in der App deshalb nicht mit dem Label „zertifiziert“ anzeigen.

  EPREL_API_KEY=… python3 10b_klimageraete_eprel.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request

from common import app_data_dir

BASIS = "https://eprel.ec.europa.eu/api/products/airconditioners"
FELD_HERSTELLER = ("supplierOrTrademark", "organisation", "manufacturer")   # Namen ungeprüft
FELD_MODELL = ("modelIdentifier", "model")                                  # Namen ungeprüft


def seite(n: int, key: str) -> dict:
    req = urllib.request.Request(f"{BASIS}?_page={n}&_limit=100", headers={"x-api-key": key, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def erstes(d: dict, namen: tuple[str, ...]):
    for k in namen:
        if d.get(k):
            return d[k]
    return None


def lw_feld(d: dict) -> str | None:
    for k in d:
        if re.search(r"sound", k, re.I) and re.search(r"power", k, re.I) and re.search(r"out", k, re.I):
            return k
    return None


def main() -> int:
    key = os.environ.get("EPREL_API_KEY")
    if not key:
        print("EPREL_API_KEY fehlt. Schlüssel über die EPREL-Website beantragen (ohne Schlüssel: HTTP 403).", file=sys.stderr)
        return 1
    erste = seite(1, key)
    treffer = erste.get("hits") or erste.get("data") or []
    if not treffer:
        print("Keine Treffer; Antwort:", json.dumps(erste)[:500], file=sys.stderr)
        return 2
    feld = lw_feld(treffer[0])
    if not feld:
        print("Kein Feld für die Außen-Schallleistung gefunden. Felder des ersten Treffers:", sorted(treffer[0]), file=sys.stderr)
        return 2
    gesamt = int(erste.get("size") or erste.get("total") or len(treffer))
    out, n = [], 1
    while True:
        for h in treffer:
            lw = h.get(feld)
            hersteller, modell = erstes(h, FELD_HERSTELLER), erstes(h, FELD_MODELL)
            try:
                lw = float(lw)
            except (TypeError, ValueError):
                continue
            if hersteller and modell and 35 <= lw <= 90:
                out.append([str(hersteller), str(modell), lw, str(h.get("lastVersion", {}).get("publishedOnDate", ""))[:10] if isinstance(h.get("lastVersion"), dict) else "", None])
        if n * 100 >= gesamt:
            break
        n += 1
        treffer = seite(n, key).get("hits", [])
        if not treffer:
            break
    out.sort(key=lambda r: (r[0].lower(), r[1].lower()))
    meta = {
        "quelle": "EPREL (EU-Produktdatenbank für Energielabel), Europäische Kommission",
        "hinweis": f"Schallleistung außen laut Hersteller (Feld {feld}), nicht unabhängig geprüft. Bedingungen: EPREL Public API Terms and Conditions.",
        "spalten": ["hersteller", "modell", "lw_dba", "datum", "heizleistung_kw"],
    }
    p = app_data_dir() / "klimageraete.json"
    p.write_text(json.dumps({**meta, "geraete": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out)} Geräte → {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
