# Passt. – MVP-Auftrag für Claude Code

## Worum es geht

„Passt." beantwortet für Hausbesitzer eine Frage: **Darf ich das hier hinstellen?**
Der Nutzer platziert ein Gartenhaus, einen Carport oder eine Wärmepumpe auf seinem echten Grundstück in 3D und bekommt sofort eine Antwort in einem Satz, mit Ampel und gemessenem Abstand.

Geschäftsmodell: B2B2C. Später binden Anbieter (Carports, Gartenhäuser, Terrassendächer, Wärmepumpen) das Tool in ihren Verkauf ein. Für das MVP zählt nur: **eine überzeugende Demo mit echten, amtlichen Daten** für einen Ausschnitt von Sulzbach-Rosenberg.

Design-Referenz: `design/prototyp.html` (klickbarer Prototyp mit Demo-Geometrie). Designsprache, Texte, Prüflogik und Interaktion von dort übernehmen. Die Prüflogik dort ist bereits getestet und soll als Ausgangspunkt für `app/src/rules/` dienen.

## Grundsätze (nicht verhandelbar)

1. **Nur amtliche oder selbst berechnete Daten.** Keine Google 3D Tiles, keine gescrapten Daten.
2. **Jede Angabe trägt ein Herkunfts-Label:** `amtlich`, `berechnet`, `erkannt`, `nutzerbestätigt`, `Annahme`, `offen`, `Demo`. Das ist ein Kernfeature, kein Detail.
3. **Entscheidungen trifft ein festes Regelwerk.** Ein LLM darf höchstens erklären, nie entscheiden.
4. **Orientierung, keine Genehmigung.** Dieser Hinweis steht sichtbar unter jedem Ergebnis.
5. **Lizenzen einhalten.** Quellenangabe immer sichtbar. Dienste unter CC BY-ND nur unverändert anzeigen oder abfragen, nicht umwandeln.

## Repo-Struktur

```
passt/
  CLAUDE.md
  design/prototyp.html
  data/raw/            # Downloads, nicht ins Git
  data/build/          # erzeugte Kacheln, GeoJSON, Raster
  pipeline/            # Python: Aufbereitung
    config.yaml        # Gebiet, Pfade, Schwellwerte
    01_buildings.py
    02_bestand.py
    03_tiles.sh
  app/                 # Vite + TypeScript + CesiumJS
    src/rules/         # reine Funktionen, mit Vitest getestet
    src/scene/         # Cesium-Szene, Platzieren, Ziehen
    src/ui/            # Bottom-Sheet, Ampel, Prüfbericht
  docs/attributions.md
```

## Daten (alle kostenlos, Bayerische Vermessungsverwaltung)

Quelle: https://geodaten.bayern.de/opengeodata/ – per Polygon-Auswahl oder pro Gemeinde herunterladen. Für den Start reicht **eine 2×2-km-Kachel** rund um eine Wohnstraße in Sulzbach-Rosenberg.

| Datensatz | Format | Wofür |
|---|---|---|
| 3D-Gebäudemodelle LoD2 | CityGML | Nachbarhäuser in 3D, Gebäudehöhen |
| Hausumringe | Vektor | exakte Grundrisse für Abstände und Kollisionen |
| DGM1 (Gelände, 1 m) | GeoTIFF | Wandhöhe am Hang, Bodenhöhe der Objekte |
| DOM20 (Oberfläche, 20 cm) | GeoTIFF | Erkennung bestehender Kleinbauten |
| DOP20 RGB und CIR | GeoTIFF | Luftbild als Boden, CIR für Vegetationsfilter |
| Laserdaten | LAZ | optional: Verfeinerung der Erkennung |
| DOM-Mesh | SLPK (I3S) | fotorealistische Optik |

Zusätzlich als Kartendienst (nur anzeigen oder per GetFeatureInfo abfragen):
- ALKIS-Parzellarkarte (Grenzen als Bild): Hilfslinie für die Grenzbestätigung
- Bauleitpläne Bayern (Landesportal): Liegt das Grundstück in einem Bebauungsplan? Name und Link anzeigen
- Denkmäler (BLfD) und Wasserschutzgebiete (LfU): nur Warnhinweise

Vor der Nutzung **für jeden Datensatz die Lizenz prüfen** (CC BY 4.0 oder CC BY-ND 4.0) und in `docs/attributions.md` festhalten. Pflicht-Quellenangabe: „Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de".

**Nicht kostenlos:** ALKIS-Flurstücke mit Grenzpunkten und Hauskoordinaten. Für das MVP deshalb: Der Nutzer bestätigt seine Grenze (siehe unten). Eine spätere ALKIS-Einbindung über einen klar getrennten Import vorsehen.

## Technische Fallstricke

- **Koordinaten:** Bayerische Daten liegen in ETRS89 / UTM Zone 32N (EPSG:25832). Aus den Metadaten jedes Datensatzes verifizieren, nicht annehmen.
- **Höhen:** Amtliche Höhen sind Normalhöhen (DHHN2016), Cesium rechnet mit Ellipsoidhöhen. Umrechnung über das Geoidmodell GCG2016 des BKG (prüfen, welches Grid per PROJ verfügbar ist). Der Unterschied liegt in Bayern bei rund 47–49 m. Ohne Umrechnung schweben die Objekte.
- **Cesium ohne ion:** keinen ion-Token verwenden, alle Kacheln selbst hosten. Standard-Widgets von Cesium ausblenden, eigene Oberfläche nach Prototyp.
- **DOM-Mesh:** entweder mit dem `tile-converter` von loaders.gl von I3S nach 3D Tiles umwandeln oder über Cesiums `I3SDataProvider` laden. Beide Wege testen, den stabileren nehmen.
- **LoD2 nach 3D Tiles:** Py3DTilers oder 3DCityDB (PostGIS) mit 3D-Tiles-Export. `citygml-to-3dtiles` nicht verwenden (veraltet, nur 3D Tiles 1.0).

## Pipeline (Python: GDAL, rasterio, geopandas, shapely, PDAL optional)

### 01_buildings.py
- LoD2-CityGML einlesen, pro Gebäude: Grundriss, Traufhöhe, Firsthöhe, Gebäude-ID.
- Mit Hausumringen abgleichen (Grundriss aus den Hausumringen hat Vorrang).
- Ausgabe: `buildings.geojson` (Label `amtlich`) und 3D Tiles für die Anzeige.

### 02_bestand.py – bestehende Kleinbauten erkennen
Wichtig für die 9-m- und 15-m-Regel an der Grenze. Viele Gartenhäuser und Carports fehlen in LoD2.
1. DGM1 auf 20 cm resamplen (bilinear), nDSM = DOM20 − DGM1.
2. Gebäude aus Schritt 01 maskieren (Puffer 0,5 m).
3. Vegetation entfernen: NDVI aus DOP20-CIR, NDVI > 0,25 (Schwellwert in `config.yaml`).
4. Höhenband 1,8 m bis 4,5 m behalten, morphologisches Öffnen, polygonisieren.
5. Filter: Fläche 3–80 m², Rechteckigkeit (Fläche / minimales gedrehtes Rechteck) > 0,7.
6. Ausgabe: `bestand.geojson` mit Höhe, Fläche und Konfidenz, Label `erkannt`.
7. Qualitätscheck: auf dem DOP20 für 20 Grundstücke manuell prüfen, Trefferquote in `docs/` notieren.

### 03_tiles.sh
- 3D Tiles (Gebäude), DOM-Mesh, DOP20 als Bildkacheln in `data/build/` erzeugen.

## Regelwerk (`app/src/rules/`, reines TypeScript)

Aus dem Prototyp übernehmen und erweitern. Alle Grenzwerte in einer JSON-Datei, jeder mit Quellenangabe. **Vor jeder öffentlichen Demo von einer Fachperson (Bauamt oder Architekt) prüfen lassen.**

- Gartenhaus ohne Genehmigung bis 75 m³ Brutto-Rauminhalt, ohne Aufenthaltsraum, ohne Feuerstätte, nicht im Außenbereich (BayBO Art. 57).
- Garage oder Carport ohne Genehmigung bis 50 m² (BayBO Art. 57).
- Abstandsfläche 0,4 H, mindestens 3 m (BayBO Art. 6). Hinweis anzeigen, dass Gemeindesatzungen abweichen können.
- An der Grenze erlaubt: mittlere Wandhöhe bis 3 m, je Grundstücksseite höchstens 9 m, insgesamt höchstens 15 m (BayBO Art. 6). **Bestehende Bauten aus `bestand.geojson` mitzählen.**
- Wandhöhe immer über dem Gelände aus DGM1 messen, nicht über einem Nullniveau.
- Wärmepumpe: am Ein- oder Zweifamilienhaus ohne Genehmigung. Lärm: `Lp = Lw + 10·log10(Q) − 11 − 20·log10(r)`, Q = 2 (frei), 4 (an der Wand), 8 (Ecke). Richtwerte nachts nach TA Lärm: reines Wohngebiet 35, allgemeines Wohngebiet 40, Mischgebiet 45 dB(A). Gebietsart ist eine Annahme, die der Nutzer ändern kann.

Tests mit Vitest: alle Fälle aus dem Prototyp plus Grenzfälle (genau 3,00 m, genau 9,00 m, schräge Grundstücksgrenze, Hanglage).

## Grenze bestätigen (MVP-Lösung für fehlende Flurstücke)

1. Nutzer sucht seine Adresse (OSM Nominatim, Nutzungsrichtlinie einhalten: höchstens 1 Anfrage pro Sekunde, Quellenangabe) oder tippt auf die Karte.
2. Parzellarkarte und Luftbild werden eingeblendet.
3. Nutzer setzt die Grenzpunkte seines Grundstücks per Finger, mit Einrasten an Gebäudekanten.
4. Ergebnis wird mit `nutzerbestätigt` gekennzeichnet, im Prüfbericht ausdrücklich erwähnt.

## Nachbarfenster (für den Lärm-Check)

Es gibt keinen Datensatz mit Fenstern. Nutzer tippt auf die Fassade des Nachbarhauses. Ohne Eingabe: Fassadenmitte auf 1,6 m Höhe, Label `Annahme`.

## Oberfläche

Wie im Prototyp: Wortmarke „Passt.", Schrift Instrument Sans, Bottom-Sheet auf dem Handy, Seitenleiste ab 900 px, eine Antwort in einem Satz, Ampelpunkt, Herkunfts-Labels, Plan-Ansicht und 3D-Ansicht, Prüfbericht als Dialog. Hell- und Dunkelmodus. Ziel: läuft flüssig auf einem iPhone der letzten drei Generationen.

## Meilensteine

1. **Daten stehen:** Eine 2×2-km-Kachel ist aufbereitet, Gebäude, Luftbild und Mesh erscheinen korrekt übereinander in Cesium. Keine schwebenden oder versunkenen Gebäude.
2. **Grundstück:** Adresssuche, Grenze bestätigen, Grundstück wird hervorgehoben.
3. **Prüfen:** Gartenhaus, Carport und Wärmepumpe lassen sich ziehen, das Regelwerk antwortet live, Abstandsmaß wird angezeigt.
4. **Bestand:** Erkannte Kleinbauten erscheinen als eigene Objekte und zählen bei der Grenzbebauung mit.
5. **Demo-fertig:** drei echte Adressen in Sulzbach-Rosenberg durchgespielt, Prüfbericht, Quellenangaben, Haftungshinweis, Ladezeit unter 4 Sekunden im Mobilfunknetz.

Nach jedem Meilenstein: kurz zusammenfassen, was funktioniert, was nicht, und welche Annahmen getroffen wurden.
