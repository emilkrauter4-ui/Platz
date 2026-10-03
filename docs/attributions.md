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
| DOP20 RGB (GeoTIFF) | Bayerische Vermessungsverwaltung | CC BY 4.0 | Qualitätscheck Bestand (`docs/bestand_stichprobe_*.jpg`) | Ausschnitte |
| DOP20 CIR (über poly2metalink) | Bayerische Vermessungsverwaltung | CC BY 4.0 | NDVI-Vegetationsfilter | nur ausgewertet |
| DOP20 WMS `by_dop20c` | Bayerische Vermessungsverwaltung | CC BY 4.0 (AccessConstraints) | Luftbild in der App, unverändert angezeigt | nein |
| Parzellarkarte WMS `by_alkis_parzellarkarte_umr_gelb` | Bayerische Vermessungsverwaltung | CC BY 4.0 (AccessConstraints) | Hilfslinie beim Grenze-Setzen, unverändert angezeigt | nein |
| Quasigeoid GCG2016 (`de_bkg_gcg2016.tif`, PROJ-CDN) | © Bundesamt für Kartographie und Geodäsie (BKG) | CC BY 4.0 | Normalhöhe → Ellipsoidhöhe | nein |
| Trinkwasserschutzgebiete WMS `twsg` | Bayerisches Landesamt für Umwelt | **noch zu klären** (AccessConstraints leer) | nur GetFeatureInfo-Abfrage für einen Warnhinweis | nein |
| Bauleitplanungsportal (`data/gemeinden.json`) | Landesportal Bayern (LDBV) | Nutzungsbedingungen des Portals | nur Link zur Stadt-Seite | nein |
| Adresssuche Nominatim | © OpenStreetMap-Mitwirkende | ODbL | Geokodierung, max. 1 Anfrage/s, nur auf Absenden | nein |
| Schrift Instrument Sans | Google Fonts | SIL OFL 1.1 | Oberfläche | nein |
| CesiumJS | Cesium GS | Apache 2.0 | 3D-Szene, **ohne** ion-Token und ion-Dienste | nein |

## Nicht verwendet

- Google Photorealistic 3D Tiles und andere nicht-amtliche 3D-Daten (Grundsatz 1).
- ALKIS-Flurstücke mit Grenzpunkten (kostenpflichtig). Die Grenze setzt der Nutzer selbst (`nutzerbestätigt`).
- DOM-Mesh (SLPK/I3S): noch nicht eingebunden, siehe `docs/status.md`.
- Denkmäler (BLfD): kein öffentlich erreichbarer WMS-Endpunkt gefunden; die App verlinkt den Denkmal-Atlas (Label `offen`).

## Offene Punkte

- LfU-Wasserschutzgebiete: Lizenz schriftlich bestätigen lassen. Der Dienst sendet bei GetFeatureInfo
  keinen CORS-Header, die Abfrage scheitert im Browser deshalb derzeit (Anzeige: „nicht abfragbar", `offen`).
  Lösung: kleiner Proxy oder Abfrage in der Pipeline.
