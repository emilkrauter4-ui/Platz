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
Demo-Adressen: `docs/demo-adressen.md`. `npm run serve` enthält auch den Proxy für die LfU-Wasserschutzabfrage.

## Daten neu erzeugen

```bash
cd pipeline
pip install -r requirements.txt
python3 00_download.py     # ≈ 1,2 GB nach data/raw
python3 01_buildings.py    # buildings.geojson
python3 02a_laser.py       # Laser-nDSM (zweite Epoche)
python3 02_bestand.py      # bestand.geojson
python3 qa_bestand.py messen   # Trefferquote gegen docs/bestand_referenz.json
# Garten-Erkennung (AUFTRAG_V2 Phase 1): pip install torch --index-url https://download.pytorch.org/whl/cpu
# SAM-2-Checkpoint: data/raw/models/sam2.1_hiera_small.pt (dl.fbaipublicfiles.com/segment_anything_2/092824/)
python3 rohdaten.py zellen        # Laserpunkte in 100-m-Zellen (2,2 GB, einmalig)
python3 08_garten.py trainieren   # Modell auf den 40 Entwicklungs-Grundstücken
python3 09_garten_eval.py dev     # Schwellwerte wählen, Kreuzvalidierung
python3 09_garten_eval.py test    # eingefrorenes Test-Set (prüft die Prüfsumme) → docs/garten_auswertung.md
python3 08_garten.py gebiet       # ganzes Gebiet → garten.geojson (≈ 45 min CPU), danach 04_export_app.py
./03_tiles.sh              # Gelände, 3D Tiles, App-Dateien
python3 05_offline_tiles.py # Luftbild/Flurkarte als Kacheln für die Offline-Demo
python3 06_mesh.py baum && python3 06_mesh.py kacheln   # optional: DOM-Mesh (184 MB, nicht im Repo)
```

Referenzdatensatz und Annotationsregeln: `data/reference/README.md`.
Gebiet und Schwellwerte: `pipeline/config.yaml`. Stand und Messwerte: `docs/status.md`. Lizenzen: `docs/attributions.md`.
Auftrag und Grundsätze: `CLAUDE.md`. Design-Referenz: `design/prototyp.html`.
