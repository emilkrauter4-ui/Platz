# Scharhof 1 benutzen und Maßband-Werte eintragen

Hintergrund (Betriebsgelände, Daten, Lage): `docs/messungen/scharhof_daten.md`. Alle Befehle vom Repo-Wurzelordner `Platz/`.

## A. Einmalig nach dem Update

```bash
git pull origin claude/new-session-w1yxlk
cd app && npm install                      # falls neue Pakete nötig sind
cd ../pipeline && pip install -r requirements.txt
```
Die Daten für den Scharhof (`app/public/data/gebiete/scharhof`) liegen im Git. Die Rohdaten (Luftbild, Laser, ca. 1,2 GB) und
die Modelle liegen **nicht** im Git, sie braucht nur der Tipp-Dienst und die Auswertung (Abschnitt D). Neu laden:
```bash
cd pipeline
PASST_GEBIET=scharhof python3 00_download.py        # lädt nur die Scharhof-Kacheln
PASST_GEBIET=scharhof python3 rohdaten.py zellen    # Laser in 100-m-Zellen
```

## B. App starten und den Scharhof öffnen

| Was | Befehl | Adresse |
|---|---|---|
| Entwicklung | `cd app && npm run dev` | http://localhost:5173/?mess |
| Wie im Feld (Handy im WLAN) | `cd app && npm run build && npm run serve` | http://<Rechner-IP>:4173/?mess |
| direkt in den Scharhof | | `…/?gebiet=scharhof` |

1. `…/?mess` öffnen: Unter der Adresssuche erscheint **„Mess-Adressen“**. Ohne `?mess` oder mit `?pitch` ist sie unsichtbar.
2. Auf „Scharhof, Hirschau (Mess-Adresse)“ tippen. Die Seite lädt neu im Mess-Gebiet (Adresse enthält `?gebiet=scharhof`).
3. Auf den Knopf **„Scharhof 1, 92242 Hirschau“** tippen, die Karte springt hin. Oder direkt aufs Gelände tippen.
4. **Grenzpunkte** des Bereichs setzen, in dem das Kleingebäude steht, dann „Grenze bestätigen“.
5. „Lage“ steht auf **Außenbereich (Annahme)**. Das Ergebnis ist deshalb rot („Im Außenbereich kann Passt. das nicht
   freigeben“). Das ist gewollt. Du kannst „Lage“ ändern (dann `nutzerbestätigt`).
6. Unter „Steht hier schon etwas?“ → **„Ein Tipp erfasst“**: aufs Gebäude im Luftbild tippen. Art und Kanten prüfen, übernehmen.

Für Schritt 6 muss der Tipp-Dienst laufen (Abschnitt C). Ohne ihn kommt „Der Tipp-Dienst läuft nicht“; einzeichnen geht trotzdem.

## C. Tipp-Dienst (zweites Terminal)

```bash
cd pipeline
python3 tipp_dienst.py          # Start dauert ca. 30 s bis „bereit“, Port 8765
```
Er rechnet die Bildfenster für das gewählte Grundstück plus 20 m Rand im Hintergrund (ca. 1 Minute); danach dauert ein Tipp
unter 1 s. Beim ersten Tipp vorher kann es länger dauern.

## D. Deine 3 gemessenen Gebäude eintragen und auswerten

Du brauchst pro Gebäude **eine Zeile in `data/reference/vor_ort.csv`** (Excel/LibreOffice oder Texteditor, Komma getrennt,
Dezimalpunkt, z. B. `3.42`). Die Datei hat schon die Kopfzeile.

| Spalte | Was eintragen |
|---|---|
| `objekt_id` | `SH-01`, `SH-02`, `SH-03` |
| `klasse` | `gartenhaus`, `carport_garage`, `gewaechshaus`, `pool` … |
| `rechtswert`, `hochwert` | Mitte des Gebäudes in EPSG:25832, ±1 m (siehe unten) |
| `wand_nord_m` … `wand_west_m` | Länge der Außenwand, die nach Norden/Osten/Süden/Westen zeigt (**Pflicht**, alle vier) |
| `ueberstand_*_m` | Dachüberstand je Seite (wenn gemessen) |
| `traufhoehe_m`, `firsthoehe_m` | Höhe über Gelände (wenn gemessen; Flachdach: First = Traufe) |
| `fotos`, `gemessen_am`, `messmittel` | Dateinamen mit `;`, Datum `JJJJ-MM-TT`, z. B. `Maßband 10 m` |
| `einverstaendnis_eigentuemer` | **`ja`** – ohne `ja` wird die Zeile nicht ausgewertet |
| `notiz` | `Scharhof 1: <was es ist>`; wenn nach 09/2023 gebaut/versetzt, das dazuschreiben |

`testset_id`, `abstand_grenzstein_m`, `grenzstein_wand` leer lassen, falls nicht vorhanden.

**Koordinaten bekommen:** im BayernAtlas (bayernatlas.de) aufs Gebäude rechtsklicken → Koordinaten, Format
„UTM 32 / ETRS89“; oder aus Länge/Breite umrechnen:
```bash
python3 -c "from pyproj import Transformer as T; print(T.from_crs(4326,25832,always_xy=True).transform(LÄNGE, BREITE))"
```
Das Gebäude muss mindestens 30 m vom Rand des Gebiets liegen (Rechtswert 715030–715970, Hochwert 5491030–5492970).

Beispielzeile (erfunden, nur zur Form):
```
SH-01,gartenhaus,715412.0,5491820.0,,4.02,3.10,4.00,3.12,0.30,0.30,0.30,0.30,2.20,2.90,,,sh01_nord.jpg;sh01_ost.jpg,2026-10-10,Maßband 10 m,ja,Scharhof 1: Materialschuppen
```

Auswerten (Tipp-Dienst muss dafür **nicht** laufen):
```bash
cd pipeline
python3 21_vor_ort_auswerten.py
```
Ergebnis: `docs/messungen/vor_ort_auswertung.md` und `.json` – Medianfehler für **Wand** und **Dach** getrennt, Überstand je
Seite, Höhen. Ziel: Medianfehler ≤ 0,30 m. Mit nur 3 Objekten ist das ein erster Eindruck, keine belastbare Statistik.
Fotos bleiben lokal (`data/reference/vor_ort_fotos/`, nicht im Git).

## E. Alle Befehle auf einen Blick

```bash
cd app && npm run dev                                  # App (Entwicklung)
cd app && npm run build && npm run serve               # App (Feld, Handy)
cd pipeline && python3 tipp_dienst.py                  # Tipp-Dienst
cd pipeline && python3 21_vor_ort_auswerten.py         # Maßband-Werte auswerten
cd pipeline && PASST_GEBIET=scharhof python3 24_gebiet_pruefen.py   # Daten des Scharhofs prüfen
cd pipeline && python3 test_gebiet.py                  # Python-Test Gebiete
```
