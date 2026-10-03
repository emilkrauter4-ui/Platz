# Passt.

**Darf ich das hier hinstellen?** Gartenhaus, Carport oder Wärmepumpe auf dem eigenen Grundstück in 3D platzieren und
sofort eine Antwort bekommen – mit Ampel, gemessenem Abstand und Herkunft jeder Angabe. Grundlage sind ausschließlich
amtliche Daten der Bayerischen Vermessungsverwaltung (MVP: 2×2 km in Sulzbach-Rosenberg).

Orientierung, keine Genehmigung. Verbindlich entscheidet das Bauamt.

## Schnellstart (App mit den mitgelieferten Daten)

```bash
cd app
npm install
npm test          # Regelwerk (Vitest)
npm run dev       # http://localhost:5173
```

Die aufbereiteten Daten liegen in `app/public/data` (Gelände, 3D Tiles, Grundrisse, Bestand, Offline-Kacheln).

Für die Demo (schneller, mit Service Worker und Offline-Modus):

```bash
npm run build
npm run serve     # http://localhost:4173
```

Offline-Demo: in der App „Amtliche Daten" → „Offline-Demo vorbereiten" (≈ 41 MB). Details: `docs/ladezeit.md`.

## Daten neu erzeugen

```bash
cd pipeline
pip install -r requirements.txt
python3 00_download.py     # ≈ 1,2 GB nach data/raw
python3 01_buildings.py    # buildings.geojson
python3 02_bestand.py      # bestand.geojson
./03_tiles.sh              # Gelände, 3D Tiles, App-Dateien
python3 05_offline_tiles.py # Luftbild/Flurkarte als Kacheln für die Offline-Demo
```

Gebiet und Schwellwerte: `pipeline/config.yaml`. Stand und Messwerte: `docs/status.md`. Lizenzen: `docs/attributions.md`.
Auftrag und Grundsätze: `CLAUDE.md`. Design-Referenz: `design/prototyp.html`.
