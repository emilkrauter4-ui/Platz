# Gibt es ein neueres DOP20/DOM20 als September 2023? (geprüft 9. Oktober 2026)

**Nein.** Für die Kachel 698_5486 (und die drei Nachbarkacheln des Gebiets) ist der Bildflug 123028 vom
**16.09.2023** weiterhin der aktuelle. Eine Neumessung mit gleicher Epoche wie der Laser (08.03.2025) ist deshalb nicht
möglich.

| Prüfung | Ergebnis |
|---|---|
| OpenData-Download DOP20 `32698_5486.tif` (HTTP-Kopf) | 72 400 382 Byte, zuletzt geändert 10.06.2024 – byte-gleich mit unserer Datei |
| OpenData-Download DOM20 `32698_5486_20_DOM.tif` | 46 752 950 Byte, zuletzt geändert 17.09.2024 – byte-gleich |
| Metadaten in der Datei (TIFF-Tags) | `BILDFLUG_DATUM 16.09.2023`, Bildflug 123028/1 |
| WMS `by_dop20_info` (GetFeatureInfo an 3 Punkten) | Bildflug 123028, Aufnahme 16.09.2023 |
| Newsletter LDBV 02/2026 | Bayernbefliegung 2025 für Nordbayern veröffentlicht. **Einige Regionen konnten witterungsbedingt nicht beflogen werden und folgen 2026.** Auf der Karte ist der Bereich östlich von Nürnberg (Oberpfalz, Raum Amberg/Sulzbach-Rosenberg) rot markiert. |

Folgerung: Die Kachel gehört zu den 2025 nicht beflogenen Gebieten. Eine Befliegung 2026 ist ausgeschrieben
(TED-Bekanntmachung zur Bayernbefliegung 2026), ein Liefertermin ist nicht bekannt. **Wieder prüfen**, sobald der
WMS `by_dop20_info` ein Datum aus 2026 meldet:

```
curl "https://geoservices.bayern.de/od/wms/dop/v1/dop20?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=by_dop20_info&QUERY_LAYERS=by_dop20_info&STYLES=&CRS=EPSG:25832&BBOX=698450,5486450,698550,5486550&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=text/plain"
```

Dann: DOP20, CIR und DOM20 neu laden, Embeddings neu rechnen (`20_tipp_embeddings.py`), Tipp- und Maßband-Auswertung
wiederholen. Ein Laser-Datensatz aus derselben Epoche wäre dann auch zu prüfen. Laser und Luftbild bleiben bis dahin
um 18 Monate versetzt (Pools, Aufstellpools, Bewuchs).

Quellen: [LDBV-Newsletter 02/2026](https://geodaten.bayern.de/odd/m/3/pdf/newsletter_archiv/2026_02.pdf),
[DOP-WMS](https://geoservices.bayern.de/od/wms/dop/v1/dop20?SERVICE=WMS&REQUEST=GetCapabilities).
