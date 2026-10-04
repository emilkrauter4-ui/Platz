# Quellen und Lizenzen

Pflicht-Quellenangabe (sichtbar in der App, im Prüfbericht und im Info-Dialog):
**„Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de"**

Lizenzen geprüft am 3. Oktober 2026 im Katalog `geodaten.bayern.de/opengeodata/json/opengeodata_datensaetze.json`
(Feld `produkt_lizenz`) bzw. in den GetCapabilities der Dienste (`AccessConstraints`).

| Datensatz | Herkunft | Lizenz | Nutzung in Passt. | Bearbeitet? |
|---|---|---|---|---|
| 3D-Gebäudemodelle LoD2 (CityGML), Kachel 698_5486 | Bayerische Vermessungsverwaltung | CC BY 4.0 | Grundrisse, Trauf-/Firsthöhe, 3D Tiles | ja: trianguliert, nach ECEF umgerechnet (erlaubt) |
| Hausumringe (Regierungsbezirk Oberpfalz) | Bayerische Vermessungsverwaltung | CC BY 4.0 | Grundrisse für Abstände und Kollisionen | ja: zugeschnitten, mit LoD2 verknüpft |
| DGM1 (GeoTIFF) | Bayerische Vermessungsverwaltung | CC BY 4.0 | Gelände, Wandhöhe über Gelände, Bestandserkennung | ja: Ellipsoidhöhen, 250-m-Kacheln |
| DOM20 (GeoTIFF) | Bayerische Vermessungsverwaltung | CC BY 4.0 | Erkennung bestehender Kleinbauten | nur ausgewertet |
| DOP20 RGB (GeoTIFF) | Bayerische Vermessungsverwaltung | CC BY 4.0 | Qualitätscheck Bestand (Kontaktbögen aus `pipeline/qa_bestand.py`), Offline-Kacheln, Screenshots in `docs/demo` | Ausschnitte, umprojiziert |
| DOP20 CIR (über poly2metalink) | Bayerische Vermessungsverwaltung | CC BY 4.0 | NDVI-Vegetationsfilter | nur ausgewertet |
| DOP20 WMS `by_dop20c` | Bayerische Vermessungsverwaltung | CC BY 4.0 (AccessConstraints) | Luftbild in der App, unverändert angezeigt | nein |
| Parzellarkarte WMS `by_alkis_parzellarkarte_umr_gelb` | Bayerische Vermessungsverwaltung | CC BY 4.0 (AccessConstraints) | Hilfslinie beim Grenze-Setzen, unverändert angezeigt | nein |
| Quasigeoid GCG2016 (`de_bkg_gcg2016.tif`, PROJ-CDN) | © Bundesamt für Kartographie und Geodäsie (BKG) | CC BY 4.0 | Normalhöhe → Ellipsoidhöhe | nein |
| Laserpunkte (LAZ), 4 × 1 km, Befliegung März 2025 | Bayerische Vermessungsverwaltung | CC BY 4.0 | zweite Epoche für die Bestandserkennung | ja: zu nDSM gerastert |
| ALKIS Tatsächliche Nutzung (Landkreis Amberg-Sulzbach) | Bayerische Vermessungsverwaltung | CC BY 4.0 | Verkehrsflächen ausmaskieren | nur ausgewertet |
| DOM-Mesh SLPK, Los 123028_1 | Bayerische Vermessungsverwaltung | CC BY 4.0 | Foto-3D-Ansicht (optional, nicht im Repo) | ja: Ausschnitt nach 3D Tiles umgewandelt, Texturen unverändert |
| Trinkwasserschutzgebiete WMS `twsg` | Bayerisches Landesamt für Umwelt | **CC BY 4.0** (Geoportal-Metadaten 7d264700-d887-11e0-b7aa-0000779eba3a); Quellenangabe „Datenquelle: Bayerisches Landesamt für Umwelt, www.lfu.bayern.de“ | GetFeatureInfo über eigenen Proxy, Warnhinweis | nein |
| Denkmal-Daten WMS (`od/wms/gdi/v1/denkmal`) | Bayerisches Landesamt für Denkmalpflege | **CC BY-ND 4.0**, Namensnennung „© BLfD“ (Metadaten 224e744a-ee17-426d-969c-e3f29244cf17) | nur GetFeatureInfo; Bezeichnung und Aktennummer unverändert angezeigt, keine gekürzten Texte | nein |
| Bauleitplanungsportal (`data/gemeinden.json`) | Landesportal Bayern (LDBV) | Nutzungsbedingungen des Portals | nur Link zur Stadt-Seite | nein |
| Adresssuche Nominatim | © OpenStreetMap-Mitwirkende | ODbL | Geokodierung, max. 1 Anfrage/s, nur auf Absenden | nein |
| Schrift Instrument Sans | The Instrument Sans Project Authors | SIL OFL 1.1 (`app/src/fonts/OFL.txt`) | Oberfläche, selbst gehostet | nein |
| CesiumJS | Cesium GS | Apache 2.0 | 3D-Szene, **ohne** ion-Token und ion-Dienste | nein |

## Modelle und Bibliotheken der Pipeline (AUFTRAG_V2)

Geprüft am 3. Oktober 2026 in den LICENSE-Dateien der Repositories bzw. auf PyPI. Keine davon ist nicht-kommerziell.

| Werkzeug | Lizenz | Wofür | Hinweis |
|---|---|---|---|
| SAM 2.1 (Meta, `facebookresearch/sam2`), Checkpoint `sam2.1_hiera_small.pt` | **Apache 2.0** (Code und Checkpoints laut README/LICENSE) | Umrisse aus Box-/Punkt-Prompts auf DOP20 (Phase 1.4), Annotationshilfe | läuft nur in der Pipeline (CPU), nicht in der App; Checkpoint liegt in `data/raw/models`, nicht im Git |
| PyTorch (CPU) | BSD-3-Clause | Laufzeit für SAM 2 | |
| scikit-learn | BSD-3-Clause | Gradient Boosting (Klassifikation) | |
| scikit-image | BSD-3-Clause | Wasserscheide für Baumkronen | |
| OpenCV (`opencv-python-headless`) | Apache 2.0 | Kreiserkennung (Trampoline) | |
| laspy (+ lazrs) | BSD-2-Clause / MIT | Laserpunkte lesen | |

## Wärmepumpen-Gerätedaten und Schallrechner (Phase 2.3)

| Quelle | Lizenz / Bedingungen | Nutzung in Passt. | Hinweis |
|---|---|---|---|
| hplib 1.9 (FZJ IEK-3, github.com/FZJ-IEK3-VSA/hplib) | **MIT** (LICENSE geprüft am 04.10.2026) | Datei `hplib_database_all.csv` → `app/public/data/waermepumpen.json` (2651 Außengeräte, Schallleistung außen, Datum, Heizleistung) via `pipeline/10_waermepumpen.py` | Daten von 2016–2021, technische Typbezeichnungen |
| Heat Pump KEYMARK, Datenblätter (keymark.eu) | **keine offene Lizenz angegeben**, Seite nennt „© KEYMARK 2025“ | Ursprung der Werte in hplib; Anzeige „Heat Pump KEYMARK / EN 12102“, Label `zertifiziert` | **Offen:** Einzelne Messwerte sind Fakten; für die Übernahme einer ganzen Liste kann das Datenbankherstellerrecht (§ 87b UrhG) greifen. Vor kommerzieller Nutzung mit KEYMARK/EHPA klären oder Werte nur auf Abruf je Gerät zeigen. |
| BWP-Schallrechner (waermepumpe.de/werkzeuge/schallrechner) | Website des Bundesverbands Wärmepumpe | nur Vergleich: 10 Abfragen am 04.10.2026 (`docs/messungen/schall_bwp.md`); Stufen der Richtwirkung/Abschirmung als Quellenangabe in `limits.json` | keine Daten übernommen |

## Gesetzestexte

| Text | Quelle | Hinweis |
|---|---|---|
| BayBO Art. 6 (`docs/recht/BayBO_Art6.txt`) | Amtliche Werke sind gemeinfrei (§ 5 UrhG); Wortlaut über lxgesetze.de und lexmea.de abgerufen und verglichen | gesetze-bayern.de per CAPTCHA gesperrt; Abgleich von Hand offen |
| AGBGB Art. 47–52 (`docs/recht/AGBGB_Art47-52.txt`) | gemeinfrei (§ 5 UrhG); gesetze.legal (aktuelle Fassung) und Bayerisches GVBl Nr. 25/1982 (verkuendung-bayern.de, amtlich) verglichen | Art. 52 Abs. 1 Satz 3 nur in einer Quelle in aktueller Fassung (offen) |

## Nicht verwendet

- Google Photorealistic 3D Tiles und andere nicht-amtliche 3D-Daten (Grundsatz 1).
- ALKIS-Flurstücke mit Grenzpunkten (kostenpflichtig). Die Grenze setzt der Nutzer selbst (`nutzerbestätigt`).

## Offene Punkte

- Demo-Adressen sind echte Wohnadressen: vor einer öffentlichen Demo Einverständnis einholen.
- Parzellarkarte für Demo-Grenzen vektorisiert (`pipeline/demo_grenze.py`): CC BY 4.0 erlaubt Bearbeitung; in der App als `Demo` gekennzeichnet.
