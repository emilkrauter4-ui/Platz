# Mess-Adresse Scharhof 1, 92242 Hirschau – Daten, Befliegung, Lage (10. Oktober 2026)

Gebiet `scharhof` in `pipeline/config.yaml`. Aufruf einzelner Schritte mit `PASST_GEBIET=scharhof python3 <schritt>.py`.
Die App öffnet es mit `?gebiet=scharhof`. **Keine Demo-Adresse**, in der App nur mit `?mess` sichtbar, nie mit `?pitch`.

## Wichtig vorab: Was „Scharhof 1“ ist

Die Adresse ist kein Wohn-Einzelhof, sondern das **Betriebsgelände der Gebrüder Dorfner** (Kaolinwerk):

- OpenStreetMap: `landuse=industrial`, `name=Gebrüder Dorfner`, `addr:street=Scharhof`, `addr:housenumber=1` (way 51816594,
  rund 700 × 900 m, UTM 715227–715920 / 5491161–5492055). Die Straße „Scharhof“ ist eine private Zufahrt im Werk.
- Amtliche Tatsächliche Nutzung (ALKIS, `tn_09371`): Der Schwerpunkt der Fläche liegt in **„Tagebau, Grube, Steinbruch“**;
  im Umkreis von 300 m sind 66 % Tagebau und 31 % Industrie- und Gewerbefläche, im Umkreis von 600 m kommen 7 % Landwirtschaft
  und 8 % Wald dazu. Die **nächste Wohnbaufläche ist rund 650 m entfernt**.
- Gebäude: 241 im Gebiet (224 mit LoD2), fast alles Werkshallen, Silos und Bürogebäude (Traufhöhen bis 40 m).
  Nominatim kennt „Scharhof 1“ nur als Straße, nicht als Hausnummer; der Punkt liegt dort in der Werkszufahrt.

Wenn gemeint war: ein Wohnhaus mit Gartenhaus oder Carport, ist diese Adresse vermutlich nicht die richtige. Die Daten
stehen, bis das geklärt ist.

## 1. Kacheln

„Grundstück“ ist hier nicht bekannt (keine amtlichen Flurstücke). Als Näherung dient die OSM-Betriebsfläche plus 50 m:
x 715177–715970, y 5491111–5492105.

| Datensatz | Kacheln | Gebiet in `config.yaml` |
|---|---|---|
| DOP20 RGB und CIR, DOM20, DGM1, Laser (1 km) | `715_5491`, `715_5492` | bbox 715000–716000 / 5491000–5493000 (1 × 2 km) |
| LoD2 (2 km, Name = Südwestecke) | `714_5490`, `714_5492` | |
| Hausumringe, ALKIS Tatsächliche Nutzung | schon vorhanden (Oberpfalz, Landkreis Amberg-Sulzbach) | |

Nordteil: Die Kachel `715_5492` wird nur für den schmalen Streifen y > 5492000 des Werks (bis 5492105) gebraucht.

## 2. Aufbereitung und Prüfungen (wie Meilenstein 1)

Reproduzierbar mit `PASST_GEBIET=scharhof python3 24_gebiet_pruefen.py` → `docs/messungen/gebiet_pruefung_scharhof.json`
(zum Vergleich `…_demo.json`).

| Prüfung | Scharhof | Demo-Gebiet (Vergleich) |
|---|---|---|
| Bezugssystem aller Raster | EPSG:25832 (alle 8 Rasterdateien: DOP20, CIR, DOM20, DGM1 je 2 Kacheln) | gleich |
| Laser-Koordinaten passen zur Kachel | ja (der LAZ-Header nennt kein CRS) | |
| **Geoid-Grid GCG2016 greift** | ja: Undulation 46,543 … 46,563 m, 1,35 m unter dem Näherungswert 47,9 m | 46,43 … 46,46 m |
| Gelände in der App (Ellipsoid) | 4 × 8 Kacheln, 372 … 493 m | |
| **LoD2-Bodenhöhe minus tiefster DGM1-Wert am Umring** | Median **+0,08 m**, P5 −0,16 m, P95 +0,39 m (n = 224) | +0,08 / −0,30 / +0,61 m (n = 5810) |
| Gebäude, deren Bodenhöhe > 0,5 m außerhalb der DGM1-Spanne am Umring liegt | **3 von 224** (1,3 %), alle *unter* dem Gelände, **keines schwebt** | 195 von 5810 (3,4 %) |
| Gleiche Prüfung gegen die Höhenkacheln der App (inkl. Undulation) | identisch (Median +0,08 m) | identisch |
| Tiefster LoD2-Wandpunkt gegen LoD2-Bodenhöhe | Median 0,00 m, höchstens ±0,01 m | |

Die drei Gebäude unter dem Gelände (`DEBY_LOD2_6044248`, 186 m², −1,62 m; `DEBY_LOD2_71783676`, −0,66 m;
`DEBY_LOD2_6022650`, −0,88 m) liegen im Werk. Die Ursache ist nicht geklärt; naheliegend ist eine Geländeänderung
(Auffüllung, Aushub) zwischen LoD2-Stand und DGM1 (siehe Alter unten), nicht ein Fehler der Höhenumrechnung, denn die
Kette Gelände ↔ Geoid ↔ App stimmt für alle anderen Gebäude auf den Zentimeter.

Zur Prüfung: Die erste Fassung verglich mit dem **Mittel** der DGM1-Werte am Umring. Das ergibt für große Hallen am Hang
bis −2,7 m und sieht wie „versunken“ aus. LoD2-`HoeheGrund` ist der **tiefste** Geländepunkt am Gebäude (im Demo-Gebiet
Median +0,08 m über dem DGM1-Minimum). Verglichen wird deshalb mit dem Minimum; die Kriterien stehen im Kopf des Skripts.

Weitere Ergebnisse: 241 Gebäude (239 Grundrisse aus Hausumringen, 17 Hausumringe ohne LoD2), 3D-Kacheln 16 Stück /
5 747 Dreiecke (0,2 MB).

**Vollautomatik im Werk (nur Hinweis, nie Prüfgrundlage):** `02_bestand.py` meldet 183 Kandidaten, die Garten-Erkennung
(`08_garten.py gebiet`, Modell v4, 23 min) 2 487 Treffer: 2 269 Baum, 95 Gartenhaus, 51 Pool, 29 Carport/Garage, 27 Strauch,
15 Terrasse, 1 Hecke. Das Modell ist auf Wohngärten trainiert und **auf diesem Gelände nicht geprüft**; die Zahlen sind
vermutlich überwiegend Fehlalarme (z. B. Wasserbecken als „Pool“, Halden und Gehölz als „Baum“). In der App erscheinen
sie nur als „Hier scheint noch etwas zu stehen“ und zählen nirgends mit, solange der Nutzer sie nicht bestätigt.

## 3. Befliegungsdatum und Stand

| Datensatz | Stand für die Kacheln | Quelle |
|---|---|---|
| **DOP20 RGB** | **16.09.2023**, Bildflug 123028/1 | Datei-Tags `BILDFLUG_DATUM`, WMS `by_dop20_info` an 3 Punkten |
| DOM20 | 16.09.2023, Bildflug 123028/1 | Datei-Tags (Bildkorrelation aus demselben Flug) |
| DOP20 CIR | in der Datei kein Datum; gleicher Bildflug **angenommen** | Dateien tragen keine Tags |
| Laser | **08.03.2025** (Median der GPS-Zeit, beide Kacheln), Datei erzeugt 21.10.2025; 35,1 und 34,4 Punkte/m² | LAZ-Header, `02a_laser.py` |
| DGM1 | Datei erzeugt 01.02.2025 | TIFF-Tag |
| LoD2 | `714_5490`: **09.04.2022**; `714_5492`: 21.01.2025 (Demo-Gebiet: 22.04.2022) | `creationDate` in der GML |
| Hausumringe | Stand 01.10.2026 (Oberpfalz-Datei) | ZIP-Eintrag |

**Das Luftbild ist nicht neuer als September 2023.** Es ist derselbe Bildflug wie im Demo-Gebiet; Laser (08.03.2025)
und Luftbild liegen 18 Monate auseinander, wie dort. Eine neuere Epoche gibt es hier nicht (siehe
`dop_aktualitaet.md`; für diese Kacheln meldet der WMS `by_dop20_info` ebenfalls 16.09.2023). Folgen für das Werk: Stand 2023 ist für ein
Betriebsgelände mit Tagebau besonders unsicher – Halden, Becken, Container und Hallen können sich in 3 Jahren
geändert haben. Objekte, die nach September 2023 gebaut oder versetzt wurden, fehlen im Luftbild.

## 4. Lage: Innenbereich oder Außenbereich?

**Annahme: Außenbereich**, Label `Annahme`, vom Nutzer im Formular änderbar (Feld „Lage“).

- Gründe: Betriebsgelände und Tagebau außerhalb des zusammenhängend bebauten Ortes Hirschau; keine Wohnbaufläche im
  Umkreis von 650 m (ALKIS). Ob für das Werk ein Bebauungsplan gilt (dann wäre es nicht Außenbereich im Sinn des
  § 35 BauGB), ist **offen**; `bauleitplanung_url` ist leer, weil dafür kein Link ermittelt wurde.
- Das ist **keine rechtliche Einstufung** (Innen-/Außenbereich entscheidet die Gemeinde bzw. das Bauamt), sondern eine Annahme
  aus amtlichen Nutzungsdaten.
- Wirkung in der App (`site.json → lage`, `main.ts`): Startwert „Außenbereich“, die Ampel bleibt für Gartenhaus und
  Carport **rot** („Im Außenbereich kann Passt. das nicht freigeben“). Die Größenzeile nennt jetzt die Grenze des
  Außenbereichs: **20 m³ statt 75 m³** (ohne Aufenthaltsraum, Toilette, Feuerstätte), Garagen und Carports sind dort
  **nicht freigestellt** (BayBO Art. 57 Abs. 1 Nr. 1, `limits.json`). Der Prüfbericht vermerkt unter „Was wir
  angenommen haben“ die Lage-Annahme mit Begründung und diese beiden Unterschiede.
- Vorher (Fehler, behoben): Die Zeile „Ohne Baugenehmigung bis 75 m³“ erschien auch im Außenbereich.

## 5. Tipp-Dienst: Embeddings bei Bedarf

Keine Vorberechnung der Kacheln. Wählt der Nutzer die Mess-Adresse (und nach „Grenze bestätigen“), schickt die App den
Umriss an `/api/tipp/vorbereiten`; der Dienst rechnet im Hintergrund nur die Fenster für Grundstück plus 20 m Rand.
Test über HTTP (Gebäude bei lokal −92 / −184 m, 44-m-Rechteck): 9 Fenster in 67,6 s (parallel lief die Garten-Erkennung),
danach Tipps in 0,5–1,0 s aus dem Cache; Tipps außerhalb aller Gebiete werden mit „Außerhalb der aufbereiteten Daten“
abgelehnt. Das war ein Test der Antwortzeit; **die Genauigkeit der Tipp-Erfassung am Scharhof ist nicht gemessen** (zwei der
drei Tipps lieferten einen Umriss: „Carport/Garage“ 16,8 m und „Hecke“ 11,7 m, einer „kein Umriss“; nichts davon ist gegen
Maße geprüft). Cache: `data/build/tipp_embed/cache/` (8,4 MB je Fenster, höchstens 20 GB).

## 6. Nicht enthalten

Foto-3D-Mesh und Offline-Kacheln gibt es nur für das Demo-Gebiet; die Mess-Adresse läuft nur online
(`05_offline_tiles.py` bricht für Mess-Gebiete ab). Luftbild und Flurkarte kommen online aus den amtlichen WMS.
