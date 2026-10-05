#!/usr/bin/env python3
"""Tipp-Dienst für „Ein Tipp erfasst“: kleiner HTTP-Dienst nur auf localhost, hält SAM 2 und den Klassifikator im
Speicher (erste Anfrage ≈ 10 s, danach ≈ 4–8 s auf CPU). Der Node-Server (app/scripts/serve.mjs) und der Vite-Dev-Server
leiten /api/tipp hierher weiter.

  cd pipeline && python3 tipp_dienst.py [port]       Standard 8765

Braucht: data/raw (DOP20, CIR, DGM1, DOM20, Laser der Kachel), data/raw/models/sam2.1_hiera_small.pt,
data/build/garten_modell.pkl, data/build/buildings.geojson. Gespeichert wird nichts.
POST /tipp {"x": E, "y": N, "klasse": optional}  (EPSG:25832) → Antwort von tipp.erfassen()
"""
from __future__ import annotations

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import tipp

LOCK = threading.Lock()
GEBIET = (698000.0, 5486000.0, 700000.0, 5488000.0)  # Datenkachel 2 × 2 km


class Handler(BaseHTTPRequestHandler):
    def _antwort(self, code: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False, default=float).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # Lebenszeichen
        self._antwort(200, {"ok": True, "dienst": "passt-tipp"})

    def do_POST(self):
        if not self.path.rstrip("/").endswith("/tipp"):
            return self._antwort(404, {"ok": False, "grund": "unbekannt"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n > 2000:
                raise ValueError("zu groß")
            q = json.loads(self.rfile.read(n))
            x, y = float(q["x"]), float(q["y"])
            k = q.get("klasse")
            if k is not None and k not in tipp.KLASSEN_TIPP:
                raise ValueError("Klasse unbekannt")
        except Exception as e:  # noqa: BLE001
            return self._antwort(400, {"ok": False, "grund": f"Anfrage ungültig: {e}"})
        if not (GEBIET[0] + 30 <= x <= GEBIET[2] - 30 and GEBIET[1] + 30 <= y <= GEBIET[3] - 30):
            return self._antwort(200, {"ok": False, "grund": "Außerhalb der aufbereiteten Daten. Bitte Umriss zeichnen."})
        with LOCK:  # SAM ist nicht threadsicher
            try:
                return self._antwort(200, tipp.erfassen(x, y, k))
            except Exception as e:  # noqa: BLE001
                return self._antwort(500, {"ok": False, "grund": f"Fehler im Tipp-Dienst: {e}"})

    def log_message(self, fmt, *args):  # keine Koordinaten ins Log
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"Tipp-Dienst auf http://127.0.0.1:{port}/tipp (SAM 2 lädt bei der ersten Anfrage)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
