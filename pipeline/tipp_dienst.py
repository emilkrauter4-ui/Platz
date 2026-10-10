#!/usr/bin/env python3
"""Tipp-Dienst für „Ein Tipp erfasst“: kleiner HTTP-Dienst nur auf localhost, hält SAM 2 und den Klassifikator im
Speicher. Beim Start lädt er alles und macht einen Probe-Tipp (≈ 1 min), danach braucht jeder Tipp – auch der erste
echte – mit vorberechneten Embeddings (20_tipp_embeddings.py) nur den Prompt-Decoder: < 1 s. Ohne Embeddings für die
Kachel ≈ 2 s. Der Node-Server (app/scripts/serve.mjs) und der Vite-Dev-Server leiten /api/tipp hierher weiter.

  cd pipeline && python3 tipp_dienst.py [port]       Standard 8765

Braucht: data/raw (DOP20, CIR, DGM1, DOM20, Laser der Kachel), data/raw/models/sam2.1_hiera_small.pt,
data/build/garten_modell.pkl, data/build/buildings.geojson. Gespeichert werden nur Bild-Embeddings (Cache, keine
Koordinaten des Nutzers, nur Gitterfenster).
POST /tipp {"x": E, "y": N, "klasse": optional}  (EPSG:25832) → Antwort von tipp.erfassen()
POST /vorbereiten {"umriss": [[E, N], …]}  Grundstück (oder vorläufig Adresspunkt ± 30 m): Fenster für Bereich + 20 m
     Rand im Hintergrund rechnen und cachen. Antwort sofort: {"fenster", "neu", "wartend"}.
GET  /vorbereiten  → {"wartend", "fertig"}
"""
from __future__ import annotations

import json
import queue
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import tipp

LOCK = threading.Lock()
GEBIET = (698000.0, 5486000.0, 700000.0, 5488000.0)  # Datenkachel 2 × 2 km

# Hintergrund: Embeddings bei Bedarf. Eine Warteschlange, ein Arbeiter mit eigener SAM-Instanz. Läuft gerade ein Tipp,
# wartet der Arbeiter vor dem nächsten Fenster, damit der Tipp die CPU möglichst für sich hat.
AUFTRAEGE: "queue.Queue[tuple[int, int]]" = queue.Queue()
GEPLANT: set = set()
TIPP_AKTIV = threading.Event()
FERTIG = [0]


def arbeiter() -> None:
    while True:
        zelle = AUFTRAEGE.get()
        while TIPP_AKTIV.is_set():
            time.sleep(0.05)
        try:
            if not tipp.vorhanden(zelle):
                tipp.fenster_berechnen(zelle)
                FERTIG[0] += 1
        except Exception as e:  # noqa: BLE001
            print(f"Fenster {zelle}: {e}", flush=True)
        finally:
            GEPLANT.discard(zelle)
            AUFTRAEGE.task_done()


def vorbereiten(umriss: list) -> dict:
    xs, ys = [float(p[0]) for p in umriss], [float(p[1]) for p in umriss]
    bb = (max(min(xs), GEBIET[0]), max(min(ys), GEBIET[1]), min(max(xs), GEBIET[2]), min(max(ys), GEBIET[3]))
    if bb[0] > bb[2] or bb[1] > bb[3]:
        return {"ok": False, "grund": "Außerhalb der aufbereiteten Daten."}
    zellen = tipp.zellen_fuer_bereich(*bb)
    neu = [z for z in zellen if z not in GEPLANT and not tipp.vorhanden(z)]
    # nächstgelegene zuerst: von der Mitte des Bereichs nach außen
    cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
    neu.sort(key=lambda z: (tipp.RASTER_URSPRUNG[0] + z[0] * tipp.RASTER_SCHRITT - cx) ** 2
             + (tipp.RASTER_URSPRUNG[1] + z[1] * tipp.RASTER_SCHRITT - cy) ** 2)
    for z in neu:
        GEPLANT.add(z)
        AUFTRAEGE.put(z)
    return {"ok": True, "fenster": len(zellen), "neu": len(neu), "wartend": len(GEPLANT)}


class Handler(BaseHTTPRequestHandler):
    def _antwort(self, code: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False, default=float).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # Lebenszeichen und Stand der Vorbereitung
        if self.path.rstrip("/").endswith("/vorbereiten"):
            return self._antwort(200, {"ok": True, "wartend": len(GEPLANT), "fertig": FERTIG[0]})
        self._antwort(200, {"ok": True, "dienst": "passt-tipp", "bereit": True})

    def _vorbereiten(self):
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n > 20000:
                raise ValueError("zu groß")
            u = json.loads(self.rfile.read(n))["umriss"]
            if not (1 <= len(u) <= 200) or not all(len(p) == 2 for p in u):
                raise ValueError("Umriss: 1 bis 200 Punkte")
            xs, ys = [float(p[0]) for p in u], [float(p[1]) for p in u]
            if max(xs) - min(xs) > tipp.BEREICH_MAX_M or max(ys) - min(ys) > tipp.BEREICH_MAX_M:
                raise ValueError(f"Bereich größer als {tipp.BEREICH_MAX_M:.0f} m")
        except Exception as e:  # noqa: BLE001
            return self._antwort(400, {"ok": False, "grund": f"Anfrage ungültig: {e}"})
        return self._antwort(200, vorbereiten(u))

    def do_POST(self):
        if self.path.rstrip("/").endswith("/vorbereiten"):
            return self._vorbereiten()
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
            TIPP_AKTIV.set()
            try:
                return self._antwort(200, tipp.erfassen(x, y, k))
            except Exception as e:  # noqa: BLE001
                return self._antwort(500, {"ok": False, "grund": f"Fehler im Tipp-Dienst: {e}"})
            finally:
                TIPP_AKTIV.clear()

    def log_message(self, fmt, *args):  # keine Koordinaten ins Log
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print("Tipp-Dienst lädt SAM 2, Klassifikator, Gebäude und Embeddings …", flush=True)
    t = tipp.aufwaermen()
    threading.Thread(target=arbeiter, daemon=True).start()
    print(f"bereit nach {t:.0f} s – http://127.0.0.1:{port}/tipp", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
