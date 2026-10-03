# Stand der Meilensteine

Stand: 3. Oktober 2026. Gebiet: 2×2-km-Kachel 698_5486 (ETRS89/UTM 32N 698000–700000 / 5486000–5488000),
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
- DOM-Mesh (SLPK) noch nicht eingebunden. Beide Wege (I3SDataProvider, tile-converter) sind offen.

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

## Meilenstein 4 – Bestand: **erreicht, Qualität mäßig**

- `02_bestand.py` nach CLAUDE.md, plus zwei Filter aus dem Sichtcheck: Ebenheit des Dachs (RMS zur Ausgleichsebene
  ≤ 0,15 m) und freier Stand (Ring 1,0–1,6 m um das Objekt mindestens zur Hälfte Boden). Gebäudepuffer 1,0 m statt 0,5 m,
  weil Dachüberstände im DOM bis ~1 m über die Hausumringe ragen.
- Ergebnis: 78 Objekte im Gebiet (ohne die Zusatzfilter waren es 3319, fast nur Fehltreffer).
- **Trefferquote im Sichtcheck: 18 von 40 Stichproben echte Kleinbauten (≈ 45 %).** Fehltreffer: Autos und Transporter,
  Container, einzelne Hecken. Siehe `docs/bestand_stichprobe_1.jpg` und `_2.jpg`. Die Vollständigkeit (Recall) ist
  nicht gemessen; viele Garagen und Schuppen stehen ohnehin in den Hausumringen.
- In der App erscheinen erkannte Kleinbauten als eigene Objekte (Label `erkannt`), zählen bei 9 m/15 m mit und lassen sich
  mit „Stimmt" (`nutzerbestätigt`) oder „Gibt es nicht" verwerfen.
- Verbesserungsidee: Straßenflächen aus dem Basis-DLM (frei) maskieren, um geparkte Autos auszuschließen.

## Meilenstein 5 – Demo-fertig: **offen**

- Drei echte Adressen mit echten Eigentümern oder Bauamt durchspielen: steht aus. Die Tests liefen mit einer nach
  Luftbild und Parzellarkarte nachgezeichneten Grenze.
- Prüfbericht, Quellenangaben, Haftungshinweis: vorhanden.
- Ladezeit: JS-Bundle 1,2 MB gzip (Cesium), Gelände lädt nur benötigte 250-m-Kacheln (je ~125 kB), Gebäude nur sichtbare
  Kacheln. **Unter 4 s im Mobilfunknetz ist nicht gemessen** und mit dem vollen Cesium-Bundle fraglich.
- Fachliche Prüfung der Grenzwerte (Bauamt/Architekt) steht aus; bis dahin weist der Prüfbericht darauf hin.

## Bekannte Lücken

- LfU-Wasserschutzgebiete: GetFeatureInfo sendet keinen CORS-Header → im Browser „nicht abfragbar".
- Denkmäler: nur Link zum Denkmal-Atlas.
- Bebauungsplan: für Sulzbach-Rosenberg keine Umringe im Landesportal, nur Link zur Stadt.
- Mittlere Wandhöhe bei Satteldach-Giebeln wird noch nicht berücksichtigt (Gartenhaus als Flachdach-Kubus).
- Kein Undo für verschobene Objekte, kein Speichern.
