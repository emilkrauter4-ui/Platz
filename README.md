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

Die aufbereiteten Daten liegen in `app/public/data` (Gelände, 3D Tiles, Grundrisse, Bestand).

## Daten neu erzeugen

```bash
cd pipeline
pip install -r requirements.txt
python3 00_download.py     # ≈ 1,2 GB nach data/raw
python3 01_buildings.py    # buildings.geojson
python3 02_bestand.py      # bestand.geojson
./03_tiles.sh              # Gelände, 3D Tiles, App-Dateien
```

Gebiet und Schwellwerte: `pipeline/config.yaml`. Stand und Messwerte: `docs/status.md`. Lizenzen: `docs/attributions.md`.
Auftrag und Grundsätze: `CLAUDE.md`. Design-Referenz: `design/prototyp.html`.
