# Stand der Meilensteine

Stand: 4. Oktober 2026 (AUFTRAG_V2 Phase 1). Gebiet: 2×2-km-Kachel 698_5486 (ETRS89/UTM 32N 698000–700000 / 5486000–5488000),
Sulzbach-Rosenberg Altstadt und Wohngebiete östlich davon.

## Meilenstein 1 – Daten stehen: **erreicht**

Funktioniert:
- `pipeline/00_download.py` lädt LoD2, DGM1, DOM20, DOP20 RGB, DOP20 CIR und Hausumringe (≈ 1,2 GB, nicht im Git).
- `01_buildings.py`: 5810 LoD2-Gebäude, 5859 Hausumringe; 5782 verknüpft (IoU > 0,5), Grundriss aus Hausumringen hat Vorrang.
  77 Hausumringe ohne LoD2 (Neubauten) werden als Hindernis übernommen.
- `03_terrain.py`: DGM1 → Ellipsoidhöhen über das echte GCG2016-Grid (PROJ), 64 Kacheln à 250 m, cm-genau.
- `03_tiles_buildings.py`: eigene 3D-Tiles-1.1-Erzeugung (GLB), 57 Kacheln, 147 000 Dreiecke, 10,7 MB.
- In Cesium liegen Gelände, Luftbild (WMS) und Gebäude übereinander. Kontrolle: LoD2-Bodenhöhe minus DGM1 am Umring,
  Median **0,05 m** (P5 −0,39 m, P95 +0,48 m) über 5808 Gebäude. Keine schwebenden oder versunkenen Gebäude.

Abweichungen von CLAUDE.md:
- **Geoid-Undulation liegt hier bei 46,43–46,46 m**, nicht bei 47–49 m wie in CLAUDE.md vermutet (Kontrolle: München ≈ 45,6 m).
  Die Pipeline nutzt das Grid und bricht ab, falls es nicht greift; es gibt keinen stillen Konstantwert.
- LoD2 → 3D Tiles ohne Py3DTilers/3DCityDB, mit ~200 Zeilen Python (Format ist einfach, keine Datenbank nötig).
- Luftbild und Parzellarkarte kommen direkt aus den amtlichen WMS (CORS freigegeben), statt lokal gekachelt.
- DOM-Mesh: eigene Umwandlung, weil beide vorgeschlagenen Wege am Koordinatensystem scheitern (siehe unten).

### DOM-Mesh (Los 123028_1, Befliegung 2023)

- Die SLPK-Datei ist 49 GB groß (390 km²). `pipeline/slpk_remote.py` liest per HTTP-Range nur das Inhaltsverzeichnis
  (228 936 Einträge, 32 MB) und die 567 Knoten, die das Gebiet schneiden (Ebene 9–14).
- **Beide vorgeschlagenen Wege funktionieren mit diesem Datensatz nicht:**
  - Cesium `I3SDataProvider` bricht ab: `I3SLayer.load` → „Unsupported spatial reference: 25832“ (nur wkid 4326).
  - loaders.gl / `tile-converter` 4.3.3 rechnet OBB und Vertex-Positionen fest als Länge/Breite um
    (`Ellipsoid.WGS84.cartographicToCartesian` in `parse-i3s.js` und `parse-i3s-tile-content.js`).
- Stabiler Weg: **eigene Umwandlung** `pipeline/06_mesh.py` – unkomprimierte I3S-Geometrie (Positionen relativ zur
  OBB-Mitte, UTM + DHHN2016) über GCG2016 nach ECEF, Draco-kodiert, JPEG-Textur unverändert, 3D Tiles 1.1 mit
  REPLACE-Verfeinerung (geometricError aus der I3S-Schwelle `maxScreenThresholdSQ`). 567 Kacheln, 8,4 Mio. Dreiecke.
- In der App: Kamera-Knopf „Foto-3D“ blendet das Mesh statt LoD2 ein; Grenzlinien und Bänder legen sich dann aufs Mesh.
  Lage stimmt mit Gelände und LoD2 überein (Screenshot-Kontrolle).
- **Nicht im Git und nicht in der Offline-Demo: 184 MB** (Texturen ≈ 190 kB je Knoten, Geometrie ≈ 170 kB, weil
  DracoPy Texturkoordinaten nicht quantisiert). Erzeugen: `python3 06_mesh.py baum && python3 06_mesh.py kacheln`
  (≈ 10 min). Ohne Mesh meldet der Knopf „nicht enthalten“. Verkleinerung möglich (Original-Draco aus dem SLPK mit
  affiner Knotenmatrix, Texturen der feinsten Ebene auf 512 px) – noch nicht umgesetzt.

## Meilenstein 2 – Grundstück: **erreicht (technisch), mit echten Adressen noch zu testen**

- Adresssuche über Nominatim (nur auf Absenden, ≥ 1,1 s Abstand, auf das Datengebiet begrenzt) oder Tipp auf die Karte.
- Parzellarkarte als gelbe Hilfslinie, Grenzpunkte per Tipp; Einrasten an Hausecken (16 px Toleranz) und Hauskanten.
- Plausibilität: keine Selbstüberschneidung, 40–8000 m².
- Seiten werden nach Himmelsrichtung benannt; leichte Knicke (< 25°) zählen als eine Seite.
- Ergebnis trägt `nutzerbestätigt`, im Prüfbericht ausdrücklich erwähnt.

## Meilenstein 3 – Prüfen: **erreicht**

- Gartenhaus, Carport, Wärmepumpe ziehen (Finger/Maus), Pfeiltasten, Drehung frei per Regler, Live-Ampel, Maßkette.
- Regelwerk `app/src/rules/`: reine Funktionen, alle Grenzwerte mit Quelle in `limits.json` (`geprueft: false`).
- 38 Vitest-Tests, darunter ein **Paritätstest gegen den Prototyp** (2000 Zufallsplatzierungen, gleiche Ampel und
  gleicher Satz) sowie Grenzfälle 3,00 m, 9,00 m, 15 m, schräge Grenze, Hanglage, 0,4 H.
- Gewollte Abweichungen vom Prototyp: Wärmepumpe in der Hausecke Q = 8 (laut CLAUDE.md), Objekte genau auf der Grenze
  zählen als auf dem Grundstück (Toleranz 0,005 m²).
- Wandhöhe wird über dem DGM1 gemessen (Fußboden am höchsten Geländepunkt, Annahme). Im Testgrundstück wird aus 2,50 m
  Wandhöhe so 2,62 m an der Grenzwand.
- Nachbarfenster: ohne Eingabe Fassadenmitte auf 1,6 m (`Annahme`); Tipp auf die Nachbarfassade setzt ein Fenster (`nutzerbestätigt`).

## Meilenstein 4 – Bestand: **erreicht, Qualität jetzt gemessen**

Messgrundlage (`docs/bestand_referenz.json`, `pipeline/qa_bestand.py`):
- **Trefferquote**: 20 bekannte Kleinbauten ohne Hausumring, von Hand am DOP20 gefunden (36 Zufallsausschnitte um
  Wohnhäuser, jeder Punkt mit Fadenkreuz kontrolliert). Treffer = erkanntes Objekt < 1 m vom Punkt.
  Ehrliche Einschränkung: 2 der 20 haben im DOM20 und im Laser keine Höhe (vermutlich Fehlurteile meinerseits, R1/R18),
  ein Gewächshaus ist zu niedrig und aus Glas (R15). Höchstens 15–17 sind mit Höhendaten überhaupt auffindbar.
- **Präzision**: 40 zufällige Treffer je Variante, von Hand am DOP20 beurteilt; Unklares zählt als „nein“.

| Variante | erkannte Objekte | Trefferquote (20 bekannte) | Präzision (40 Stichproben) |
|---|---|---|---|
| v1 (erster Stand: Ebenheit + Freistand) | 78 | **0 / 20** | 18 / 40 (45 %) |
| nur DOM20 + Verkehrsmaske | 2755 | 8 / 20 | nicht gemessen (fast nur Vegetation) |
| DOM20 + Laser-Höhe | 2184 | 8 / 20 | – |
| DOM20 + Laser (Höhe + Einzelecho) | 1228 | 8 / 20 | – |
| v3s: Laser schon pixelweise vor der Fleckbildung | 1387 | 10 / 20 | 11 / 40 (28 %) |
| **v4l (gewählt)**: v3s + Anbau-Filter | **890** | **9 / 20 (45 %)** | **22 / 40 (55 %)** |

Was v4l macht (`pipeline/02_bestand.py`, Schwellen in `config.yaml`):
1. nDSM aus DOM20 − DGM1 (wie CLAUDE.md), Höhenband 1,8–4,5 m, NDVI ≤ 0,25, Gebäude maskiert (Puffer 1,0 m).
2. **Verkehrsflächen aus ALKIS Tatsächliche Nutzung** maskiert (Straßenverkehr, Weg, Platz, Bahnverkehr, Parkplatz;
   362 Flächen im Gebiet, CC BY 4.0).
3. **Zweite Epoche aus Laserdaten** (`02a_laser.py`, LAZ, Befliegung 8. März 2025, laubfrei): Ein Pixel zählt nur, wenn auch
   der Laser dort 1,5–5 m Höhe zeigt **und** ≥ 50 % Einzelechos (Dach) statt Mehrfachechos (Strauch, Baum).
   Laserklasse 6 „Gebäude“ hilft nicht – Schuppen sind dort als Klasse 20 erfasst.
4. Fläche 3–80 m², Rechteckigkeit ≥ 0,7; Anbau-Filter: Flecken, deren Rand zu > 25 % am Gebäudepuffer liegt, werden
   verworfen (Dachüberstände, Gauben, Anbauten).
5. Umriss um 0,5 m verkleinert (DOM20-Kantenglättung; sonst zählte der Pavillon Fröschau 41 mit 5,5 statt ~3,5 m).

Erkenntnisse:
- Die v1-Filter aus dem ersten Durchlauf waren falsch kalibriert: Satteldächer sind keine Ebene, Schuppen stehen oft an
  Hecken. v1 sah präzise aus, fand aber keinen einzigen bekannten Kleinbau.
- Die Laser-Bestätigung mit Einzelecho-Anteil verdoppelt die Präzision, ohne Treffer zu kosten.
- Beide Epochen zu verlangen heißt: Bauten, die zwischen Sept. 2023 und März 2025 entstanden oder verschwunden sind,
  fehlen (R8 liegt im Laser nicht mehr im Höhenband).
- Restliche Fehltreffer: Autos in privaten Einfahrten (TN kennt nur öffentliche Verkehrsflächen), Trampoline,
  Schatten unter Bäumen, Dachteile bei Hausumringen ohne Überstand.
- In der App bleiben erkannte Objekte `erkannt` mit „Stimmt“/„Gibt es nicht“ – bei 55 % Präzision ist das nötig.

## Meilenstein 5 – Demo-fertig: **weitgehend erreicht**

- **Ladezeit** (`docs/ladezeit.md`): Startfrage nach 0,2–0,4 s, bedienbar nach 1,6 s (Fast 4G) bzw. 6,5 s (Slow 4G),
  Wiederbesuch 0,7 s. Unter 4 s auf Slow 4G beim ersten Besuch nicht erreicht (Cesium-Kern ≈ 960 kB).
- **Offline-Demo** der Kachel 698_5486: 41 MB, per Service Worker, getestet ohne Netz.
- **Drei Demo-Adressen** (`docs/demo-adressen.md`, mit Screenshots): Fröschau 41 (Gartenhaus an der Grenze, erkannter
  Pavillon zählt mit), Am Schützenheim 3 (Hanglage: 2,85 m werden 3,01 m), Carl-Orff-Straße 1 (Wärmepumpe an der
  Doppelhaushälfte, 41 dB(A)). Beim Durchspielen gefunden und behoben: angenommenes Fenster auf der Brandwand.
- **Denkmal** (`geoservices.bayern.de/od/wms/gdi/v1/denkmal`, CC BY-ND 4.0, „© BLfD“): offener Dienst gefunden; Abfrage per
  GetFeatureInfo am Schwerpunkt und an den Ecken des Grundstücks, unverändert als Warnhinweis gezeigt
  (Altstadt: Ensemble „Altstadt Sulzbach“ E-3-71-151-1, Bodendenkmal D-3-6436-0022).
- **Wasserschutzgebiete** (LfU): Lizenz laut Geoportal-Metadaten CC BY 4.0 → Abfrage über eigenen Proxy
  (`app/scripts/serve.mjs`, `/proxy/lfu-wsg`, nur GetFeatureInfo auf `twsg`). Der Dienst liefert ungültiges JSON
  (überzähliges Komma) – wird tolerant gelesen (Test). Im Gebiet liegt kein Schutzgebiet; Positivtest außerhalb:
  „Sulzbach-Rosenberg, festgesetzt am 13.05.2002“.
- Offen: echte Eigentümer bzw. Bauamt einbinden, Einverständnis für die Demo-Adressen, fachliche Prüfung der Grenzwerte.

## AUFTRAG_V2 Phase 1 – Referenzdaten und Garten-Erkennung: **gebaut, Ziele auf dem Test-Set nicht erreicht**

Stand 4. Oktober 2026. Ausführliche Zahlen: `docs/garten_auswertung.md`.

**1.1 Referenzdatensatz** (`data/reference/`, `pipeline/07_referenz.py`)
- 60 Grundstücke, je 20 Altstadt / Siedlung / Hang, Zufallsauswahl mit festem Seed, Grenzen aus der Parzellarkarte.
  Altstadt: im Kern (≥ 35 % bebaut) gab es nur 14 brauchbare Grundstücke; 6 kommen vom Altstadtrand (30–35 %).
- 207 annotierte Objekte (Umriss, Klasse, Höhe, `sicher` ja/nein, Notiz). 40 Entwicklung / 20 Test,
  Test-Set am 04.10.2026 eingefroren (SHA-256 in `split.json`, die Auswertung bricht bei Änderung ab).
- `vor_ort.csv` angelegt (Kopfzeile), wartet auf Maßband-Messungen.
- **Einschränkung:** annotiert hat Claude auf DOP20 2023 und Laser 2025 – dieselben Daten wie die Erkennung.
  Referenzhöhen sind aus dem Laser abgeleitet (nur Konsistenz). Unabhängig sind erst Emils Messungen.
- Zufall trifft die seltenen Klassen hart: im Test-Set liegen **2 sichere Gartenhäuser, 1 Garage, 0 Pools**.

**1.3/1.4 Erkennung** (`pipeline/08_garten.py`, Laserzellen `rohdaten.py`)
- Signale: DOP20 RGB/CIR (NDVI, Türkis, NIR), DOM20 − DGM1, Laserpunkte (Höhe, Echos, Intensität, Dichte), Masken
  aus Hausumringen und ALKIS-Verkehrsflächen.
- Kandidaten je Familie: Bauten nur aus dem Laser (das DOM verschmierte Kanten und Schatten), Vegetation mit
  Kronentrennung (Wasserscheide), schmale Streifen (Hecken), Wasser (Türkis oder NIR-dunkel mit wenig Laserechos),
  flache befestigte Flächen, Kreise (Trampoline).
- Umrisse mit **SAM 2.1 small** (Apache 2.0) aus Box + Punkt, nur übernommen bei IoU ≥ 0,3 zum Kandidaten. CPU: ~1 s
  je 80-m-Ausschnitt.
- Klassifikation: Gradient Boosting (scikit-learn) auf 60 Merkmalen, plus 17 Positivbeispiele aus der
  M5-Referenz (außerhalb der Test-Grundstücke), plus feste Regeln für Pool (helles Türkis und NIR-dunkel) und
  eindeutige Kleinbauten, plus Plausibilität (Nebengebäude ≥ 1,5 m hoch im Laser, ≥ 1,5 m breit).
- Maße: Bauten über das Rechteck um die Dach-Laserpunkte; Höhe 95. Perzentil über Bodenpunkten; Dachebenen per RANSAC →
  Traufe, First, geometrisch gemittelte Wandhöhe. Jede Angabe mit Spanne (Punktabstand bzw. Kantenschärfe).
  Beim Gebietslauf gefunden und behoben: RANSAC nahm Bodenpunkte im Umriss als Dachebene (Traufe 0,17 m, Wandhöhe
  eines 2,9-m-Schuppens 1,5 m – gefährlich niedrig). Jetzt nur Punkte ab 1 m, Flachdach = Wand bis Dachkante.
  Außerdem zählen für die Höhe von Bauten nur noch Einzelechos (überhängende Äste machten den Pavillon in
  Fröschau 41 3,31 statt 2,48 m hoch). Beide Korrekturen kamen **nach** der Test-Messung; die Höhenspalte im
  Test-Ergebnis bezieht sich auf den alten Stand. Das Test-Set wurde dafür nicht erneut benutzt.
- Gebiet (2 × 2 km): 5412 Objekte (3923 Bäume, 814 Gartenhäuser, 117 Carports/Garagen, 372 Sträucher, 100
  Terrassen, 43 Pools, 43 Hecken), ≈ 45 min auf 4 CPU-Kernen. `bestand.json` 1,2 MB (327 kB gzip), lädt erst nach
  der Startansicht – die Startzeit ändert sich nicht.

**1.5 Messung**

| | Dev (Kreuzvalidierung, 40 Grundstücke) | Test (eingefroren, 20 Grundstücke) |
|---|---|---|
| Gartenhaus Präzision / Trefferquote | 64 % / 54 % (n = 13) | **17 % / 50 %** (n = 2) |
| Gartenhaus Median Länge / Breite | 0,39 / 0,33 m | 6,56 / 1,15 m (1 Treffer: Pergola mit Hecke verschmolzen) |
| Pool | 1 von 2 gefunden, 0 Fehltreffer | **nicht messbar** (0 Pools im Test-Set) |
| Nebengebäude gesamt | P 69 % / R 47 % | P 33 % / R 67 % (n = 3) |
| Baum | P 44 % / R 38 % | P 46 % / R 30 % |
| Hecke, Strauch, Terrasse | praktisch nicht erkannt | praktisch nicht erkannt |

Ziele (≥ 80 % je, Median ≤ 0,30 m) **nicht erreicht**. Gründe, ehrlich: zu wenige Beispiele für die seltenen Klassen
(10–13 Gartenhäuser zum Lernen, 2 Pools), Hecken verschmelzen mit Bäumen, zwei Zeitpunkte (2023/2025), und ein
Test-Set mit 3 Nebengebäuden sagt statistisch fast nichts. Was hilft: mehr Grundstücke gezielt mit Objekten
(geschichtete statt rein zufällige Auswahl), Maßband-Messungen, Nutzerbestätigungen (Phase 4.2).

**1.6 App**
- `bestand.json` v2: alle erkannten Klassen mit Länge, Breite, Höhe, mittlerer Wandhöhe, je mit Spanne, Label `erkannt`
  und Konfidenz.
- Abschnitt **„Steht hier schon etwas?“** je Grenze vorbefüllt (Objekte ≤ 1 m von der Grenze), übrige im Garten
  aufklappbar. Je Objekt: „Stimmt“, „Umriss nachziehen“, „Gibt es nicht“; je Grenze „Doch, hier steht etwas“ zum
  Einzeichnen. Nachziehen mit Fingergriffen, Einrasten an erkannter Kante, Gebäuden und Grenze → `nutzerbestätigt`.
- Grenzbebauung (9 m / 15 m) zählt nur Nebengebäude (Gartenhaus, Gewächshaus, Garage/Carport): bestätigte immer,
  erkannte ab Konfidenz 0,8 (`limits.json`, Produktentscheidung: ab 0,7 waren auf Dev ein Drittel falsch).
  Pool, Hecke, Terrasse zählen nicht. Der Prüfbericht nennt die mitgezählten und die unsicheren Objekte.
- Im Browser durchgespielt (Playwright): Fröschau 41 zeigt jetzt „Zu viel an der Südwestgrenze“ (Pavillon laut
  Laser 5,4 × 4,7 m statt grob 4,7 m an der Grenze, steht in der Ecke und zählt an zwei Grenzen); „Gibt es nicht“ →
  „Passt so“. Hang- und Wärmepumpen-Demo unverändert. `docs/demo-adressen.md` angepasst.
- Neue Tests: Zählregel (Konfidenz knapp unter/genau an der Schwelle, bestätigt, Pool/Hecke), Zuordnung zur Grenze
  (genau 1,00 m), Rechteck-Maße, Nachziehen. 53 Tests grün.

**Annahmen:** Grenzen der Referenz-Grundstücke aus der Parzellarkarte (nicht amtlich); Konfidenzschwelle 0,8 und
„≤ 1 m = an der Grenze“ sind Produktentscheidungen, keine Rechtsregeln; geometrisch gemittelte Wandhöhe ist noch
nicht die Wandhöhe nach Art. 6 BayBO (folgt in Phase 2.2).

## AUFTRAG_V2 Phase 2 – Prüfen auf neuem Niveau: **gebaut; iPhone-Zeit nicht nachgewiesen**

Stand 4. Oktober 2026.

**2.2 Abstandsflächen nach BayBO Art. 6** (`app/src/rules/abstand.ts`)
- Wortlaut von Art. 6 in `docs/recht/BayBO_Art6.txt`: gesetze-bayern.de sperrt automatischen Abruf per CAPTCHA, deshalb
  aus lxgesetze.de und lexmea.de geholt und Wort für Wort verglichen (identisch bis auf einen Darstellungsfehler).
  **Abgleich mit gesetze-bayern.de von Hand offen.**
- Je Wand: Wandhöhe über DGM1 an beiden Enden (am Hang Trapez), H mit Dachanteil (bis 70° ein Drittel, darüber voll,
  Abs. 4), Tiefe 0,4 H, mindestens 3 m (Abs. 5), Fläche als Polygon am Boden.
- Prüfungen: auf dem eigenen Grundstück (Abs. 2), keine Überdeckung mit den Abstandsflächen des eigenen Hauses aus LoD2
  (Abs. 3, Ausnahme Wände > 75°), Objekt nicht in der Abstandsfläche des Hauses und umgekehrt (Abs. 1).
- Privileg Abs. 7: Gartenhaus ohne Aufenthaltsraum/Feuerstätte und Garage mit mittlerer Wandhöhe bis 3 m brauchen
  keine eigene Abstandsfläche (grau); Dach > 45° zu einem Drittel, > 70° voll; Giebel bis 45° unberücksichtigt.
- Neu in der App: Dachneigung (Satteldach, First entlang der Breite), Rauminhalt mit Dachraum (Art. 57),
  Satteldach und Giebel in 3D, Abstandsflächen am Boden (rot = Verstoß, grün = auf dem Grundstück, grau = nicht nötig)
  und die des Hauses blass.
- `offen` markiert: Giebelfläche wie das Dach angerechnet (Auslegung), Giebel bei Dach > 45° nach Abs. 7,
  öffentliche Verkehrsflächen bis zur Mitte (Abs. 2 Satz 2) nicht geprüft. Haus-H aus LoD2 mit Annahme Dach ≤ 70°.
  Alle neuen Regeln in `limits.json` mit `geprueft: false`.

**2.1 „Wo darf es hin?“** (`app/src/rules/zonen.ts`, Web Worker, lazy geladen, 24 kB)
- 25-cm-Raster, zweistufig (1 m, fein nur an Farbwechseln), Ausrichtungen: aktuelle, parallel zu jeder Grenze,
  45°-Schritte. Grün = passt so, gelb = passt gedreht, rot = geht nicht. Beste Stelle mit „Hierhin setzen“.
- Dieselbe Prüfung wie `evaluate()`: Test prüft alle 9184 Zellen einzeln nach – **0 Abweichungen**.
- Zeit (`docs/messungen/zonen.md`): im Container 180–340 ms je Neuberechnung (Fröschau 41: 181–231 ms,
  Hang: 235–338 ms). **< 300 ms auf dem iPhone nicht nachgewiesen** – kein Gerät hier; Chromium-Drosselung wirkt
  nicht auf Worker. Die App zeigt die Zeit klein an, damit sie auf dem iPhone ablesbar ist.

**2.3 Wärmepumpe** (`app/src/rules/evaluate.ts`, `pipeline/10_waermepumpen.py`)
- Geräte: 2651 Außengeräte aus Heat Pump KEYMARK über hplib (MIT), Suche nach Hersteller/Typ, Label `zertifiziert`,
  Quelle sichtbar. **Einschränkungen:** Daten 2016–2021, technische Typbezeichnungen, Schallleistung im
  Nennbetrieb (nicht Nachtbetrieb); Rechte an der KEYMARK-Liste nicht geklärt (siehe attributions.md).
- Schallmodell: Richtwirkung automatisch aus allen LoD2-Wänden bis 3 m (LAI; vorher 0,6 m), Abschirmung aus der
  Sichtlinie gegen LoD2 (0 / 5 / 15 dB wie LAI/BWP, keine Beugungsrechnung), ganze Nachbarfassade im 1-m-Raster auf
  1,6 m und 4,4 m abgetastet, lautester Punkt zählt. Art. 6 Abs. 1 Satz 3 Nr. 4: bis 2 m Höhe keine Abstandsfläche.
- Vergleich mit dem BWP-Schallrechner (`docs/messungen/schall_bwp.md`): 10 Fälle, Abweichung ≤ 0,1 dB(A), gleiches
  Urteil – bei gleichen Eingaben. Nicht umgesetzt: Tageswerte mit Ruhezeitenzuschlag, Tonhaltigkeit (`offen`).
- Demo Carl-Orff-Straße 1 jetzt 48 dB(A) statt 41 (Ecke bis 3 m, ganze Fassade).

**Tests:** 73 grün (neu: `abstand.test.ts`, `zonen.test.ts`, `schall.test.ts`; Paritätstest nimmt die neuen Regeln
gezielt aus und prüft sie getrennt).

## AUFTRAG_V2 Phase 3 – Nachbarn und Garten

Stand 4. Oktober 2026.

### 3.1 Hecken und Bäume (AGBGB Art. 47–52): **gebaut; Stamm aus Laser nicht machbar**
- **Nachtrag 4. Oktober 2026 (Emils Vorgabe):** Art. 52 Abs. 1 Satz 3 in der aktuellen Fassung (Schluss des Jahres der
  Entstehung und Kenntnis bzw. grob fahrlässiger Unkenntnis), von Emil am amtlichen Text bestätigt. In der App nur
  Info-Text, keine Berechnung, mit BGH V ZR 230/16 (Entstehung bei erstmaligem Überschreiten von 2 m, bei Zweifel ab
  Eindeutigkeit, nach Rückschnitt neu) und Abs. 2 (Ersatzpflanzen). Zusätzlich Hinweis `offen`, wenn das
  Nachbargrundstück höher liegt (BGH-Leitsatz: Höhe ab dem höheren Gelände) – nicht eingerechnet.
- Wortlaut in `docs/recht/AGBGB_Art47-52.txt`: gesetze-bayern.de per CAPTCHA gesperrt. Verglichen wurden
  gesetze.legal (aktuelle Fassung) und das amtliche **GVBl 25/1982** (PDF von verkuendung-bayern.de). Art. 47–51 und
  Art. 52 Abs. 1 Sätze 1–2 und Abs. 2 stimmen überein. **Abweichung:** Art. 52 Abs. 1 Satz 3 (Fristbeginn) wurde
  nach 1982 geändert, die neue Fassung steht nur in einer Quelle → `offen`. Passt. rechnet die Frist deshalb nicht
  aus, sondern fragt nach dem Alter und zitiert die Regel.
- Neu in `limits.json` (Abschnitt `pflanzen`, alle `geprueft: false`): 0,50 m / 2 m, Höhengrenze 2 m („über 2 m“:
  genau 2,00 m zählt noch als niedrig), Wald 0,50 m, Art. 48/50 Abs. 2, Messpunkt Art. 49, Ausnahmen Art. 50 Abs. 1,
  Verjährung 5 Jahre, Ersatzpflanzung.
- **Planung** (Hauptfunktion, Reiter „Hecke, Baum“): Hecke als Pflanzreihe, Baum oder Strauch ziehen, Höhe einstellen.
  Antwort in einem Satz („Passt, solange die Hecke höchstens 2,0 m hoch bleibt.“), Maßkette zur Grenze und die
  Zonen am Boden: rot = unter 0,50 m, gelb = bis 2 m hoch, grün = keine Höhengrenze aus Art. 47.
- Angaben je Grenzseite: Nachbargrundstück, öffentliche Straße oder Wald, dazu Mauer oder dichter Zaun mit Höhe.
  Ohne Angabe gilt die strengere Lesart (`Annahme`/`offen`). „Nicht erheblich überragen“ ist nicht beziffert, deshalb
  zählt nur „überragt nicht“, und die Zeile ist `offen`.
- **Bestand an der Grenze** (eigene und Nachbarpflanzen bis 3 m): sachlich mit Maß, Spanne und dem Wert aus Art. 47.
  Ergebnis nur „liegt darüber / darunter / nicht eindeutig“, ohne Ampel und ohne Wörter wie „Anspruch“ oder
  „Verstoß“ (Test prüft das). Die Frage nach dem Alter führt zum Text zu Art. 52 einschließlich Ersatzpflanzung.
- **Stammposition:** Der Versuch, den Stamm aus den Laserdaten zu schätzen, ist gescheitert
  (`docs/messungen/staemme.md`): zwei Verfahren, Selbstkontrolle Median 5,3 m. Unter den Kronen liegen kaum Punkte
  zwischen 0,3 und 2,5 m, und viele „Bäume“ sind Baumgruppen. Passt. misst deshalb ab der Kronenmitte mit großer
  Spanne (halber Ersatzradius, mindestens 0,75 m). Mit „Stamm antippen“ kann der Nutzer den Stamm setzen
  (Spanne 0,2 m, `nutzerbestätigt`). Für Hecken gilt die Spanne vom Heckenrand bis zur halben Breite.
- Prüfbericht: eigener Abschnitt „Hecke (Nachbarrecht)“ mit allen Zeilen und den Bestandspflanzen. Dazu der Hinweis
  „Zivilrecht, das Bauamt prüft das nicht“.
- Tests: 19 neu (`pflanzen.test.ts`): Grenzfälle genau 0,50 m und genau 2,00 m (Höhe und Abstand), schräge Hecke,
  schräge Grundstücksgrenze, Straße, Mauer, Wald, Spanne um 2 m Höhe, neutrale Texte. Insgesamt 92 grün.

### 3.2 Nachbar-Link: **gebaut**
- **Speicher wie entschieden:** Das Vorhaben steht komprimiert im URL-Fragment (`#n=…`, deflate-raw + base64url,
  rund 260 Zeichen). Das Fragment geht nie an einen Server. Gespeichert wird nur die Antwort (Zeitpunkt,
  „passt“/„frage“, Projekt-Hash) in SQLite (`node:sqlite`, keine Abhängigkeit) im bestehenden Node-Server
  (`app/scripts/nachbar-api.mjs`, eingebunden in `serve.mjs` und den Vite-Dev-Server). Dazu kommen nur die
  Link-Kennung und eine zufällige Antwort-Kennung, damit der Nachbar löschen kann. Keine IP, kein Name.
  Antworten werden nach 400 Tagen automatisch gelöscht. Datenbank: `app/.daten/nachbar.sqlite` (nicht im Git,
  Pfad über `PASST_DB`). **Braucht Node ≥ 22.5**; sonst antwortet die API mit 503, Anschauen geht trotzdem.
- **Speicher-Schnittstelle** `app/src/speicher/` (`NachbarSpeicher`). Heute gibt es eine HTTP-Implementierung; für
  einen Server in Deutschland wechselt nur die Implementierung oder die Basis-URL.
- **Ohne Konto:** Link-Kennung = SHA-256 eines Zufallsschlüssels, den nur der Ersteller hat (localStorage). Mit dem
  Schlüssel kann er Antworten abrufen, den Link zurückziehen und alles löschen. Der Server speichert keine Links.
- **Ersteller:** „Nachbarn fragen“ öffnet einen Dialog: Objekte wählen, Gültigkeit 7, 30 oder 90 Tage, Link kopieren
  oder teilen. Darunter die Liste der eigenen Links mit Antworten („anderer Stand“, wenn sich das Vorhaben seitdem
  geändert hat), Zurückziehen und Löschen.
- **Nachbar:** Nur-Lese-Szene mit den geteilten Objekten. Blickpunkt: Fenster antippen (Fassade, Höhe aus dem Tipp)
  oder Stelle im Garten (1,6 m); ohne Eingabe das nächste angenommene Fenster (`Annahme`). „Von hier ansehen“ zeigt
  die Szene auf Augenhöhe. Schatten mit Tag und Uhrzeit (deutsche Zeit), mit oder ohne Vorhaben. Dazu Aussage für den
  Blickpunkt (Sonne / Schatten des Vorhabens / Schatten eines Hauses) und Sonnenstunden des Tages mit und ohne
  Vorhaben. Knöpfe „Passt für mich“ und „Ich habe eine Frage“, Antwort löschbar. Der Hinweis „ersetzt keine Unterschrift
  auf amtlichen Formularen“ steht im Dialog und beim Nachbarn, dazu Ablaufdatum und Widerrufbarkeit.
- **Sonnenstand** (`rules/sonne.ts`): NOAA/Meeus-Näherung, gegen NREL-SPA (pvlib) an 5 Zeitpunkten < 0,2° genau.
  Meridiankonvergenz (UTM 32, ~2°) berücksichtigt. **Schatten vereinfacht (`Annahme`):** ebenes Gelände, Häuser
  aus LoD2 als Block bis zur halben Dachhöhe, Bäume ohne Schatten, unter 5° Sonnenhöhe kein Schatten.
- Geprüft im Browser: Link erstellen → beim Nachbarn öffnen → Schatten → Antwort → Abruf beim Ersteller →
  Widerruf → Link zeigt „zurückgezogen“. Keine Konsolenfehler.
- Tests: `sonne.test.ts` (13), `nachbar.test.ts` (7: Kodierung, Hash, Kennung, Ablauf, API mit SQLite im Speicher,
  inklusive „speichert keine weiteren Felder“). Insgesamt 112 grün.
- Nebenbei behoben: Der Ladehinweis „Lädt amtliche Daten …“ blieb sichtbar (CSS überschrieb `hidden`).

### 3.3 AR: **gebaut, auf Emils iPhone NICHT funktionsfähig – zurückgestellt**
- Eigener Erzeuger ohne Bibliothek (`app/scripts/ar-modell.mjs`): glTF 2.0 binär und USDZ (USDA-Text,
  unkomprimiertes ZIP, Daten 64-Byte-ausgerichtet). Meter, Y oben, Boden bei 0. Formen wie in der 3D-Szene:
  Gartenhaus mit Flach- oder Satteldach, Carport mit Pfosten und Dach, Wärmepumpe, Hecke, Baum, Strauch.
- **Maßstab 1:1:** iOS mit `#allowsContentScaling=0`, Android Scene Viewer mit `resizable=false`.
- Quick Look und Scene Viewer brauchen eine echte Adresse. Der Node-Server erzeugt das Modell deshalb
  **zustandslos aus den Maßen in der URL** (`/api/ar/modell.glb|usdz?art=…&w=…`), ohne zu speichern. Am Rechner
  entstehen die Dateien direkt im Browser als Download (geht auch offline).
- Knopf „In AR ansehen (1:1)“ bei Gartenhaus, Carport, Wärmepumpe und im Reiter „Hecke, Baum“. Das Modul lädt erst
  beim Tippen (1,6 kB + 7,9 kB).
- Geprüft: glTF-Validator (Khronos) 0 Fehler, 0 Warnungen für alle 7 Formen. USDZ öffnet mit Pixars USD-Bibliothek
  (`usd-core`), Maße stimmen auf den Millimeter (z. B. Gartenhaus 35°: 3,000 × 3,175 × 2,500 m). Der ARKit-Prüfer
  (`usdchecker --arkit`) ist in `usd-core` nicht enthalten.
- **Auf Emils iPhone startet AR nicht** (Web-Weg über die App und Download der USDZ). Ursache unbekannt, zurückgestellt (4. Oktober 2026).
- **Nicht nachgewiesen:** Android. Scene Viewer lädt das Modell über eine
  öffentliche https-Adresse, im lokalen Netz (Laptop-Demo) geht AR deshalb nur auf dem iPhone. Das Modell zeigt
  Größe und Form, nicht den Ort: Man stellt es in der AR-Ansicht selbst auf.
- Tests: `ar.test.ts` (6). Insgesamt **118 grün**.

### Ladezeit nach Phase 3
Bundle nach Phase 3: 983 kB übertragen (vorher ~974 kB). Fast 4G: bedienbar nach 1,7–1,9 s (vorher 1,6 s,
Messrauschen im Container ±0,2 s). Die Pflanzen- und Nachbar-Oberfläche liegt im Hauptbundle (+9 kB gzip), AR und Zonen
laden erst bei Bedarf. Wenn das stört, lassen sich Nachbaransicht und Teilen-Dialog in ein eigenes Modul auslagern.

## AUFTRAG_V2 Phase 4 – Abschluss der Kette

### 4.1 Vom Nein zum Antrag: **gebaut**
- **Wortlaut** in `docs/recht/BayBO_Verfahren_BauVorlV.txt`: BayBO Art. 2 Abs. 3, 55, 58, 59, 61, 63, 64, 66
  (gesetze.legal, lxgesetze.de und lexmea.de Wort für Wort identisch), BauVorlV §§ 1–3, 7–9 und GaStellV § 1
  (gesetze.legal und lexmea.de identisch). Neue Einträge in `limits.json` (Abschnitt `verfahren`, `geprueft: false`).
  Offizielle Links (Digitaler Bauantrag, Bauantragsformulare des Staatsministeriums) am 04.10.2026 abgerufen.
- **Befunde statt erstem Fehler:** `evaluate()` meldet jetzt alle Befunde eines Gebäudes (`befunde`). Daraus folgt
  in `rules/verfahren.ts` eines von vier Ergebnissen:
  - **Lage klären:** außerhalb des Grundstücks oder Kollision. Hier gibt es keinen Export.
  - **Kein Antrag:** Der Hinweis „Abstandsflächen gelten trotzdem“ (Art. 55 Abs. 2) bleibt stehen.
  - **Verfahrensfrei mit Abweichungsantrag:** Art. 63 Abs. 2 Satz 2. Reicht die Abstandsfläche aufs
    Nachbargrundstück, kommt die Übernahme durch den Nachbarn nach Art. 6 Abs. 2 Satz 3 als Weg 2 dazu.
  - **Bauantrag:** mit Hinweis auf die Genehmigungsfreistellung im Bebauungsplan (Art. 58, `offen`), das vereinfachte
    Verfahren (Art. 59), die Nachbarunterschrift (Art. 66; der Nachbar-Link ersetzt sie nicht) und die Zuständigkeit
    (`offen`).
- **Entwurfsverfasser** (Art. 61): Architekt/in oder eingetragene/r Ingenieur/in. Carports bis 100 m² sind
  Kleingaragen (GaStellV § 1 Abs. 1 Satz 3, Abs. 7); dafür kommen auch die Gruppen aus Art. 61 Abs. 3 in Frage.
  Ob ein Gartenhaus unter Abs. 3 fällt, ist im Wortlaut offen und so gekennzeichnet.
- **Checkliste nach BauVorlV § 3:** Katasterauszug (selbst besorgen), Lageplan (Skizze von Passt.),
  Bauzeichnungen 1:100 (Skizze), Baubeschreibung (Angaben, Gebäudeklasse voraussichtlich 1, zu bestätigen),
  Maß der baulichen Nutzung, Abstandsflächenübernahme, Abweichungsantrag, Standsicherheit (nur Sonderbau),
  Nachbarunterschriften, Formular und Anzahl.
- **Zeichnungen** (`app/src/antrag/paket.ts`, lazy, 15 kB):
  - **Lageplan-Skizze:** Maßstab automatisch 1:200 bis 1:1000, Nordpfeil (Gitter-Nord), Maßstabsleiste, Grenze,
    Gebäude mit Trauf- und Firsthöhe aus LoD2, Bestand, Abstandsflächen, Abstände je Grenzseite. Der Stempel
    „SKIZZE – keine amtliche Lageplanunterlage (BauVorlV § 7)“ steht auf jedem Plan.
  - **Grundriss, Schnitt, vier Ansichten** in 1:100, mit Gelände aus DGM1 und Wandhöhe H nach Art. 6 Abs. 4.
  - Alle SVGs in Millimetern, also beim Druck in Originalgröße maßstäblich.
- **Export:** druckbares HTML ohne externe Dateien (im Browser als PDF drucken, Beispiel
  `docs/demo/antrag-paket-beispiel.pdf`, 6 Seiten) und JSON mit dem Schema `passt.antragspaket/1` für Anbieter.
  Das JSON enthält Lage und Grenze in EPSG:25832, Maße, Befunde, Prüfzeilen, Verfahren, Checkliste und Zeichnungen.
- Knopf in der App: „Was jetzt? Antrag vorbereiten“, wenn das Ergebnis rot ist, sonst „Antrag-Paket“.
- Tests: `antrag.test.ts` (12). Insgesamt **131 grün**.
- **Nicht enthalten:** amtlicher Katasterauszug und Flurstücksnummern (ALKIS kostenpflichtig, siehe Grundsätze),
  Höhen über NHN im Plan (nur relativ), Baukosten, Baustoffe.

- Von Emil am eigenen Laptop ausprobiert (4. Oktober 2026): funktioniert.

### 4.2 Lernschleife: **gebaut; nur simuliert getestet (noch keine echten Beiträge); Probelauf bestanden, Version zurückgenommen**
- **Einwilligung in der App** (Abschnitt „Steht hier schon etwas?“), standardmäßig aus und widerrufbar. Nur mit
  Haken sendet Passt. bei „Stimmt“, „Gibt es nicht“, „Umriss nachziehen“ und „Objekt einzeichnen“:
  Umriss (EPSG:25832, 0,1 m), Objektart, 1-km-Kachel, Aktion und Modellversion. Nicht gesendet werden Adresse,
  Grenze und Name; der Server speichert weder IP noch Zeitpunkt. „Was genau?“ erklärt das und sagt offen, dass sich
  ein Umriss über die Koordinaten einem Grundstück zuordnen lässt. „Meine Beiträge löschen“ löscht über die
  Kennungen, die nur im eigenen Browser liegen. Im Browser geprüft: ohne Haken 0 Anfragen, mit Haken genau diese
  Felder, Löschen leert die Datei.
- **Speicher** hinter derselben Schnittstelle wie der Nachbar-Link (`app/src/speicher/`, `LernSpeicher`): JSONL in
  `app/.daten/lernen.jsonl` (`app/scripts/lern-api.mjs`). Der Server prüft und bereinigt jeden Eintrag: Klasse und
  Aktion aus fester Liste, Koordinaten in Bayern, Kachel passend zur Geometrie, unbekannte Felder werden verworfen.
- **Nachtrainieren** (`pipeline/12_lernschleife.py alles`, für einen regelmäßigen Lauf z. B. per cron):
  - Import: Beiträge in oder bis 15 m neben Test-Grundstücken werden verworfen (das Test-Set bleibt unberührt).
    Gelöschte Beiträge verschwinden auch aus den Lernbeispielen.
  - Versionen: `data/build/modelle/garten_v<N>.pkl`, Protokoll in `data/reference/modelle.json` (im Git).
  - **Freigaberegel:** Alte und neue Version werden auf dem eingefrorenen Test-Set mit demselben Code gemessen.
    Freigegeben wird nur, wenn F1 in keiner Klasse mit Referenzobjekten und bei „Nebengebäude“ sinkt. Sonst bleibt
    die alte Version, und die neue wird als `abgelehnt` vermerkt. Tests: `pipeline/test_lernschleife.py`.
- **Probelauf** (13 simulierte Beiträge aus der Dev-Referenz): 7 nutzbar, 5 ohne passenden Kandidaten der Erkennung,
  1 mit unbekannter Klasse (Zaun/Mauer). Version 5 hat die Regel bestanden (Baum F1 0,36 → 0,39, sonst gleich).
  Sie ist **zurückgenommen**, weil die App-Daten von v4 stammen und die ganze Kachel nicht neu erkannt wurde. Aktiv
  bleibt v4, die simulierten Lernbeispiele sind gelöscht.
- Ehrlich: 5 von 13 Beiträgen fanden keinen Kandidaten. Was die Erkennung gar nicht als Kandidat findet, kann
  Nachtrainieren der Klassifikation nicht verbessern; dafür müsste die Kandidatensuche selbst lernen.
- **Neu (4. Oktober): gezeichnete Objekte ohne Kandidaten werden Lernbeispiele.** Bei „Objekt einzeichnen“ und
  „Umriss nachziehen“ ohne Kandidaten mit IoU ≥ 0,3 berechnet der Import die Merkmale direkt aus dem gezeichneten
  Umriss (`kandidat_aus_umriss`, gleiche Merkmale wie bei der Erkennung, Familie aus der Objektart, Quelle
  `gezeichnet`). „Stimmt“ ohne Kandidaten bleibt draußen (dort gibt es keinen eigenen Umriss). Ältere Importe, die
  solche Beiträge als unbrauchbar gemerkt hatten, werden nachgeholt. Das Modellprotokoll zählt `lern_gezeichnet`.
  - Probe auf echten Daten: ein Gartenhaus der Dev-Referenz, als Umriss gezeichnet → Merkmale berechenbar, das
    aktive Modell v4 nennt es zu 97 % „nichts“. Gezeichnete Umrisse sehen für das Modell anders aus als
    Kandidaten der Erkennung – genau dafür sind die Beispiele nützlich. Gleichzeitig ein Risiko: Das Modell lernt
    auf gezeichneten Umrissen, sieht beim Erkennen aber Kandidaten-Umrisse. Die Freigaberegel auf dem Test-Set
    fängt eine Verschlechterung ab.
  - Grenze bleibt: Die Trefferquote für Objekte, die die Kandidatensuche nie vorschlägt, steigt dadurch nicht.
- Tests: `lernen.test.ts` (3). Pipeline: `test_lernschleife.py` 7 (Freigaberegel 4, gezeichnete Objekte 3:
  Merkmale aus dem Umriss, Familie für jede Klasse, Import Ende-zu-Ende ohne Rohdaten).

## Korrektur 4. Oktober 2026: BayBO Art. 57 Abs. 1 Nr. 1 Buchst. a nach aktuellem Wortlaut

Beim Zusammenstellen der Prüfmappe fiel auf: Der aktuelle Wortlaut (lxgesetze.de, Stand 23.4.2026, und lexmea.de
identisch; `docs/recht/BayBO_Art57.txt`) lautet „Gebäude mit einem Brutto-Rauminhalt bis zu 75 m³, außer im
Außenbereich, sowie Gebäude ohne Aufenthaltsräume, Toiletten oder Feuerstätten […] im Außenbereich bis 20 m³“.
Die Bedingung „ohne Aufenthaltsraum/Feuerstätte“ gilt danach nur im Außenbereich. CLAUDE.md und Passt. gingen vom
älteren Wortlaut aus.

- **Geändert:** Gartenhaus mit Aufenthaltsraum oder Feuerstätte im Innenbereich ist nicht mehr „braucht Genehmigung“,
  sondern gelb („verfahrensfrei – Feuerstätte, Abgasanlage, Brandschutz nicht geprüft“). Es verliert aber das
  Privileg nach Art. 6 Abs. 7: eigene Abstandsflächen, nicht an die Grenze (neuer Befund `grenze_aufenthaltsraum`,
  rot). Außenbereich bleibt rot („Passt. kann das nicht freigeben“), der Text nennt jetzt die 20-m³-Regel.
- limits.json: `gartenhaus.maxBruttoRauminhaltM3` (Text), neu `aussenbereichMaxM3` (20) und
  `aufenthaltsraumNurArt6`; Wärmepumpe genauer als Art. 57 Abs. 1 Nr. 2 Buchst. b. Alles `geprueft: false`.
- Tests angepasst (Gartenhaus mit Ofen jetzt gelb und „frei“) und ergänzt (Aufenthaltsraum an der Grenze,
  Außenbereich). **138 grün.**
- **Offen:** amtlichen Text auf gesetze-bayern.de von Hand prüfen; CLAUDE.md beschreibt noch die alte Regel.

## Prüfmappe für Fachpersonen (4. Oktober 2026)

`docs/pruefmappe/pruefmappe.pdf` (34 Seiten A4), erzeugt aus `app/src/rules/limits.json` mit
`python3 pipeline/16_pruefmappe.py && node pipeline/pruefmappe_pdf.mjs`. Je Regel (57): Quelle, Gesetzestext-Auszug
aus `docs/recht/` (automatisch, nicht abgetippt), Link zum amtlichen Text, unsere Auslegung, wie Passt. rechnet,
Beispielfall, Felder korrekt / falsch / unklar / Anmerkung. Danach 17 gezielte Fragen (Giebel Abs. 4 und Abs. 7,
Dachneigung LoD2, Brutto-Rauminhalt, Art. 57 aktueller Wortlaut, Außenbereich, „an der Grenze“, Bestand,
Carport-Fläche, Wärmepumpe, Lärm-Immissionsort, „nicht erheblich überragen“, Hecken-Messpunkt, Hang,
Entwurfsverfasser, örtliche Satzungen, Formulierung). Das Skript bricht ab, wenn eine Regel in limits.json keinen
Eintrag in der Mappe hat. Neu als Wortlaut: `docs/recht/BayBO_Art57.txt`, `docs/recht/TA_Laerm_6_1.txt`.
Beim Erstellen korrigiert: die 15-m-Regel steht in Art. 6 Abs. 7 **Satz 2** (vorher als Satz 1 Nr. 1 zitiert).
Ehrlich: Die Beispiele sind von Hand gerechnet, nicht aus der App erzeugt; vier Regeln sind nur dokumentiert und in
der App nicht umgesetzt (`pflanzen.landwirtschaftM`, `abstand.faktorHGewerbe`, Ersatz-/Verjährungs-Infos nur Text).

## Test-Set nach Objekten (5. Oktober 2026)

`docs/messungen/testset_objekte.md`. 119 Blöcke (100 × 100 m, alle 4 Kacheln) unabhängig von der Erkennung vollständig
annotiert und eingefroren (Prüfsumme in `data/reference/objekte/testset.json`). Altes Set unverändert.
**Quoten nicht erreicht**: Gartenhaus 43/50, Pool 24/30, Trampolin 14/30, Gewächshaus 3/20 – mehr gibt das Gebiet nicht her.
Modell v4: Gartenhaus Trefferquote 0,56, Präzision 0,12 (Untergrenze: Annotation unvollständig, Garagen als Gartenhaus);
Pool 1/24; Trampolin und Gewächshaus 0. Die Erkennung taugt für Pools, Trampoline und Gewächshäuser nicht.

## Nachtrag 5. Oktober 2026: „Ein Tipp erfasst“, Vollautomatik nur noch Hinweis

- **Art. 57** am amtlichen Text bestätigt (Emil). CLAUDE.md korrigiert. Gelb-Text: „Verfahrensfrei. Brandschutz und
  Feuerstätte prüft die App nicht.“
- **Fehleranalyse Pools** (`docs/messungen/pools_fehleranalyse.md`): 12 von 24 ohne passenden Kandidaten, 11 vom
  Klassifikator verworfen (2 Pools im Training). Laser März 2025 passt nicht zum Luftbild September 2023: nur 3 von 24
  zeigen die Wasser-Echolücke. Die Pool-Regel (NIR ≤ 50) erfüllen nur 4 von 24. Vollautomatik wird nicht weiter optimiert.
- **„Ein Tipp erfasst“** (`pipeline/tipp.py`, Dienst `pipeline/tipp_dienst.py`, App „Steht hier schon etwas?“ →
  „Ein Tipp erfasst“): Tipp ins Luftbild → SAM 2.1 (Punkt-Prompt) → Umriss, Höhe aus Laser, Maße mit Spanne,
  Klassenvorschlag. Label „erfasst per Tipp“. Der Nutzer wählt die Art, kann die Wandhöhe ändern und die Kanten nachziehen.
  Im Browser durchgespielt (Fröschau 41): Gartenhaus 5,90 × 4,74 m (±0,38), Wand 2,08 m (±0,19), zählt danach bei
  der Grenzbebauung mit. Erste Anfrage ≈ 18 s (Modell lädt), danach ≈ 5–10 s auf CPU.
- **Messung** (`docs/messungen/tipp_test.md`): **Ziel nicht erreicht.** Gegen die eingefrorene Referenz v1: Erfolg
  (IoU ≥ 0,5) Gartenhaus 30 %, Pool 25 %. Gegen die korrigierte Referenz v2: Gartenhaus 63 %, Pool 33 %, Trampolin
  43 %. Maßfehler bei erfolgreichen Tipps im Median: Gartenhaus Länge 0,90 m, Breite 0,56 m; Pool 0,65/0,40 m.
  Wichtig: Meine Referenz ist ungenauer als das Ziel. v1 ist systematisch ≈ 0,9 m versetzt, nach der Korrektur weicht
  sie noch im Median 0,6 m vom Laser ab. Für eine belastbare Aussage zu 90 % / 0,30 m braucht es Maßband-Werte
  (`vor_ort.csv`) oder eine unabhängige Annotation.
- **Vollautomatik nur noch Hinweis:** Erkannte Objekte heißen „Hier scheint noch etwas zu stehen“, sind blass dargestellt,
  zählen nie zur Grenzbebauung und lösen keine Kollision aus. Vorher zählten sie ab Konfidenz 0,8 automatisch.
  Sie zählen erst nach „Stimmt“, nach Nachziehen oder wenn sie per Tipp erfasst sind. limits.json:
  `bestand.automatikNurHinweis` ersetzt `bestand.konfidenzMin`.
- Tests: App 144 grün (neu: Tipp-Objekt, Proxy, Hinweis statt Kollision), Pipeline 7.
- **Gartenblick** bleibt pausiert.

## AUFTRAG_V2 Phase 5 – „Gartenblick“ (experimentell)

Stand 4. Oktober 2026.

### 5.1 Lizenz: **Skyfall-GS ist so nicht kommerziell nutzbar** (`docs/gartenblick/lizenzen.md`)
- Eigener Code: Apache 2.0, aber mit Teilen aus Inrias gaussian-splatting. Der Rasterizer (Inria/MPII) ist nur für
  Forschung und Evaluation erlaubt.
- Das fest eingestellte Bildmodell **FLUX.1 [dev]** ist nicht kommerziell; ausdrücklich verboten ist auch jede Nutzung
  „mit Wirkung auf Endnutzer“. Das betrifft auch eine Kunden-Demo.
- Freie Bausteine: **gsplat** (Apache 2.0) statt Inria, **FLUX.1 [schnell]** (Apache 2.0) statt [dev], MoGe/FlowEdit (MIT).
- Empfehlung: zuerst Weg A, also gsplat **ohne** Bildmodell nur aus unseren amtlichen Mesh-Ansichten. Er ist kommerziell
  nutzbar und erfindet keine Details.

### 5.2 Eigene Daten statt Satellitenbilder: **fertig für das erste Grundstück, die anderen rendern**
- `pipeline/gartenblick_render.mjs`: 89 Ansichten des DOM-Meshes über die eigene Cesium-Szene (Ringe, Draufsichten,
  Augenhöhe 1,6 m außerhalb von Gebäuden), exakte Kameraposen aus Cesium, Skyfall-Format plus COLMAP
  (`15_gartenblick_colmap.py`, Rücktest Abweichung < 10⁻⁵).
- `13_gartenblick_punkte.py`: Startpunktwolke aus dem Laser (Normalhöhe → Ellipsoidhöhe über GCG2016), eingefärbt mit
  DOP20. Lage gegen das Mesh geprüft: Laserpunkte über 4 m liegen in der Draufsicht auf Dächern und Kronen.
- Ehrlich: Das DOM-Mesh ist 2,5D mit rund 20 cm Textur. Aus Augenhöhe sind die Eingabebilder unscharf, und unter
  Baumkronen liegt der Augenpunkt teils unter der Mesh-Oberfläche. Nahaufnahmen sind pixelig.
- Rendern im Container: rund 18 s je Ansicht (Software-Grafik), also etwa 27 Minuten je Grundstück.

### 5.3 Rechenleistung: **Anleitung fertig** (`docs/gartenblick/anleitung_gpu.md`)
- Weg A (gsplat): GPU ab 16 GB, rund 20–40 Minuten je Grundstück. Weg B (Skyfall-GS): 48 GB, laut Paper rund 6¾ Stunden
  auf einer RTX A6000, braucht die FLUX-Lizenz.

### 5.4 In der App: **gebaut und mit Prüf-Splats getestet; echtes Training fehlt (GPU)**
- CesiumJS (engine 26.4) kann Gaussian Splats darstellen (experimentell): 3D Tiles mit `KHR_gaussian_splatting` und
  `KHR_gaussian_splatting_compression_spz_2`. Ein eigener Viewer ist nicht nötig.
- `14_gartenblick_tiles.py`: PLY → SPZ (selbst geschrieben) → glTF → Tileset mit Transform ENU → ECEF, inklusive
  Meridiankonvergenz (2,1°) und UTM-Maßstab. Geprüft mit Cesiums eigenem Decoder (`app/spz-pruefen.html`):
  Position < 0,2 mm, Farbe < 0,004, Skala < 0,03 (log), Deckkraft < 0,002, Rotation exakt.
- Gefundener Fehler: COLOR_0 muss als uint8 angemeldet sein, sonst bricht Cesiums WebAssembly-Modul ab.
- In der App: Auge-Knopf „Gartenblick“, sichtbar nur, wenn für das Grundstück ein Eintrag in
  `data/gartenblick/index.json` existiert. Solange er an ist, steht oben dauerhaft **„KI-Visualisierung, nicht
  gemessen“** mit der Herkunft. Das geplante Objekt bleibt in der Szene, und der Nachbar-Link hat denselben Knopf.
  Das Regelwerk kennt den Gartenblick nicht und prüft weiter nur mit amtlichen Daten.
- Getestet mit synthetischen Splats aus 60 000 Laserpunkten: Sie sitzen georeferenziert auf Dächern und Grundstück
  (`docs/demo/gartenblick-pruefsplats.jpg`). Diese Prüfdaten sind **nicht** ausgeliefert.
- Geometrie gegen Laser: `14_gartenblick_tiles.py geometrie` (Abstand Splat ↔ Laser in beide Richtungen). Im Test
  mit 5 cm Rauschen ergab sich ein Median von 7,4 cm. Für echte Trainingsergebnisse steht die Messung noch aus.

## Offene Punkte für Emil

- 5–10 Objekte mit dem Maßband messen (mit Einverständnis der Eigentümer) und in `data/reference/vor_ort.csv` eintragen.
- Cloud-GPU mieten (Phase 5 „Gartenblick“): Weg A mit gsplat, GPU ab 16 GB, Anleitung `docs/gartenblick/anleitung_gpu.md`.
  Ergebnis-PLY zurückgeben, dann baue ich die Tiles und messe die Geometrie gegen den Laser.
- Lizenz-Entscheidung Gartenblick: Weg A (frei) oder kommerzielle FLUX-Lizenz (bfl.ai) für Weg B.
- Fachliche Prüfung von `limits.json` durch Bauamt oder Architekt; die Regeln zu Hecken und Bäumen (AGBGB, Phase 3)
  am besten zusätzlich durch einen Anwalt.
- Einverständnis der Eigentümer für die Demo-Adressen.
- Antrag-Paket von Bauamt oder Architekt durchsehen lassen (Checkliste, Verfahrenslogik, Hinweise zu Art. 61).
- Art. 6 BayBO, die Verfahrensvorschriften (Phase 4) und AGBGB Art. 47–52 einmal von Hand auf gesetze-bayern.de gegen `docs/recht/` prüfen (CAPTCHA),
  besonders Art. 52 Abs. 1 Satz 3 (Fristbeginn).
- Bei 2–3 Bäumen an der Grenze den Stamm vor Ort einmessen, um die Spanne der Kronenmitte zu prüfen.
- „Wo darf es hin?“ auf dem eigenen iPhone ausprobieren und die angezeigte Zeit notieren (Ziel < 300 ms).
- KEYMARK-Daten: **Nutzung angefragt, nur Demo** (Stand 4. Oktober 2026) – Antwort abwarten.
- **AR zurückgestellt (Emil, 4. Oktober 2026):** klappt auf dem iPhone noch nicht, später weiter.
- AR auf dem eigenen iPhone und einem Android-Gerät ausprobieren. Android braucht die App unter einer https-Adresse.
  iPhone im gleichen WLAN: `npm run serve` zeigt die Adresse an (`http://192.168.…:4173`), in Safari öffnen.
  Nachbar-Link geht auch über http im WLAN (SHA-256-Ersatz, wenn `crypto.subtle` fehlt).
- Lernschleife: Datenschutz von einer Fachperson prüfen lassen (Umrisse mit Koordinaten können personenbezogen sein).
- Nachbar-Link: Datenschutzerklärung für den Betrieb (Antworten in SQLite, 400 Tage) von einer Fachperson prüfen lassen;
  auf dem Laptop Node-Version prüfen (`node --version`, mindestens 22.5).
- ~~Vor Phase 3: Speicher-Entscheidung~~ – entschieden am 4. Oktober 2026 (siehe unten).

## Speicher-Entscheidung (Emil, 4. Oktober 2026)

Lokal zuerst, aber hinter einer **Speicher-Schnittstelle**, damit später nur die Implementierung wechselt
(Ziel: Server in Deutschland).
- **Nachbar-Link:** Projektstand komprimiert im URL-Fragment (`#…`), das Vorhaben wird **nicht** auf dem Server
  gespeichert. Nur die Antwort des Nachbarn (Zeitpunkt, Antwort, Projekt-Hash) per API in SQLite im bestehenden
  Node-Server (`app/scripts/serve.mjs`, wo der LfU-Proxy läuft). Widerruf und Löschen per API.
- **Lernschleife:** gleiche Schnittstelle, lokal als JSONL-Datei, nur mit Einwilligung, nur Geometrie, Klasse, Kachel.

## Bekannte Lücken

- LfU-Proxy läuft nur mit `scripts/serve.mjs` bzw. dem Vite-Dev-Server; reines statisches Hosting braucht eine
  Proxy-Regel (oder die Schutzgebiete vorab in der Pipeline laden – CC BY 4.0 erlaubt das).
- Denkmal-/Wasserschutzabfrage: fällt ein Abfragepunkt aus, zählen die übrigen; erst wenn alle ausfallen: „nicht abfragbar“.
- DOM-Mesh nicht im Repo (184 MB), siehe oben.
- Bebauungsplan: für Sulzbach-Rosenberg keine Umringe im Landesportal, nur Link zur Stadt.
- Pultdach und andere Dachformen fehlen (nur Flach- und Satteldach).
- Abstandsflächen von Nachbargebäuden werden nicht geprüft (nur die des eigenen Hauses).
- Kein Undo für verschobene Objekte, kein Speichern.
