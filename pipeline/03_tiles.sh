#!/usr/bin/env bash
# Erzeugt alle Anzeige-Daten der App aus data/build:
#   - Gelände (DGM1 → Ellipsoidhöhen, Kacheln für CustomHeightmapTerrainProvider)
#   - 3D Tiles der LoD2-Gebäude
#   - kompakte Grundriss-/Bestandsdateien
# Luftbild (DOP20) und Parzellarkarte werden direkt aus den amtlichen WMS-Diensten
# geladen (CORS freigegeben, CC BY 4.0) und nicht lokal gekachelt.
set -euo pipefail
cd "$(dirname "$0")"
python3 03_terrain.py
python3 03_tiles_buildings.py
python3 04_export_app.py
