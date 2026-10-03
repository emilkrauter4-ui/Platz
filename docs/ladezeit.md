# Ladezeit

Gemessen am 3. Oktober 2026 mit `docs/messungen/*.jsonl` (Rohdaten). Headless Chromium, iPhone-Format (390 × 844, DPR 2),
Netz per DevTools-Protokoll gedrosselt, App aus `app/dist` über `app/scripts/serve.mjs` (Brotli, wie ein normales Hosting).

| Profil | Durchsatz / Latenz |
|---|---|
| Slow 4G (Lighthouse-Mobilstandard) | 1,6 Mbit/s runter, 0,75 Mbit/s hoch, 150 ms |
| Fast 4G (Chrome DevTools) | 9 Mbit/s runter, 1,5 Mbit/s hoch, 60 ms |

Messpunkte:
- **Startfrage**: „Wo steht dein Haus?" ist lesbar.
- **Suche bereit**: Karte steht, Adresssuche und Tippen funktionieren.
- **Szene fertig**: Gelände, Luftbild und alle sichtbaren 3D-Gebäude der Startansicht sind geladen.

## Ergebnis

| | Startfrage | Suche bereit | Szene fertig | Übertragen |
|---|---|---|---|---|
| **Vorher**, Slow 4G, kalt | 26,9 s | 26,9 s | 84 s | 8,3 MB |
| **Nachher**, Slow 4G, kalt | **0,4 s** | **6,5 s** | 47 s | 2,6 MB |
| **Vorher**, Fast 4G, kalt | 11,3 s | 11,3 s | 53 s | 8,3 MB |
| **Nachher**, Fast 4G, kalt | **0,2 s** | **1,6 s** | 36 s | 2,6 MB |
| Nachher, Slow 4G, Wiederbesuch (Service Worker) | 0,4 s | **0,7 s** | 36 s | Luftbild |
| Nachher, Fast 4G, Wiederbesuch | 0,4 s | **0,6 s** | 32 s | Luftbild |
| Offline-Demo, kein Netz | – | **0,5 s** | 11 s | 0 |

**Ziel „unter 4 s im Mobilfunknetz":**
- erreicht für *bedienbar* auf Fast 4G (1,6 s) und bei jedem Wiederbesuch (0,6–0,7 s);
- **nicht erreicht** für *bedienbar* auf Slow 4G beim ersten Besuch (6,5 s): Allein das Cesium-Bundle (958 kB Brotli)
  braucht bei 1,6 Mbit/s ≈ 5 s;
- **nicht messbar** für *Szene fertig*: Ohne Drosselung dauert sie hier ebenfalls 38 s. Der Container rendert ohne GPU
  (SwiftShader), Cesium fordert neue Kacheln erst beim Rendern an. Rein netzseitig sind für die Startansicht
  2,6 MB nötig: ≈ 13 s auf Slow 4G, ≈ 2,5 s auf Fast 4G. **Auf einem echten iPhone nachmessen** (Safari →
  Web-Inspektor, oder Chrome DevTools mit Gerät über USB).

## Was geändert wurde

| Maßnahme | Wirkung |
|---|---|
| Gelände: 8-m-Übersicht (`overview.bin`, 125 kB) für weite Ansichten, 1-m-Kacheln erst ab 3 m Stützpunktabstand | 4,6 MB → 0,17 MB |
| Einstieg `boot.ts` (1,5 kB) zeigt die Startfrage sofort, Cesium lädt danach als eigener Chunk | Startfrage 26,9 s → 0,4 s |
| Schrift selbst gehostet statt Google Fonts (blockierte das erste Bild, braucht Offline ohnehin) | erstes Bild ohne Fremd-Server |
| `@cesium/engine` + `CesiumWidget` statt Paket `cesium` + `Viewer` (keine Widgets) | Bundle 1039 → 958 kB |
| Eigene UTM-Umrechnung statt proj4 (Test: < 1 mm Abweichung in ganz Bayern) | −105 kB unkomprimiert |
| 3D Tiles mit KHR_mesh_quantization (int16-Positionen, int8-Normalen) | 10,7 → 5,4 MB gesamt, 1,36 → 0,64 MB beim Start |
| 3D Tiles, Grundrisse und Bestand laden im Hintergrund, Grundrisse erst nach der Startansicht | UI wartet nicht darauf |
| Sonne und Mond aus | zwei Anfragen weniger |
| Service Worker: App-Hülle wird gecacht, eigene Dateien cache-first | Wiederbesuch bedienbar in 0,7 s |

Warum das Bundle nicht kleiner wird: Der Rest ist der Kern von Cesium, den 3D Tiles brauchen (glTF-Loader, `Model`,
Kamera, Globus, Shader; `@cesium/core` allein ≈ 460 kB unkomprimiert). Weiter ginge es nur mit einem eigenen,
schmalen Renderer statt Cesium (z. B. three.js wie im Prototyp) – das ist eine Architekturentscheidung, kein Feinschliff.

## Offline-Demo

- Info-Dialog („Amtliche Daten") → „Offline-Demo vorbereiten": lädt 3450 Dateien (41 MB) in den Browser-Cache,
  mit Fortschrittsanzeige; Abbrüche lassen sich fortsetzen. Danach steht im Kopf „Offline-Demo".
- Ohne Netz kommen Luftbild und Flurkarte aus `app/public/data/dop` und `…/parzellar`
  (`pipeline/05_offline_tiles.py`: DOP20 aus den GeoTIFFs umprojiziert, Parzellarkarte einmalig per WMS abgerufen,
  beides CC BY 4.0). Online nutzt die App weiter die WMS-Dienste.
- Ohne Netz gibt es keine Adresssuche (Nominatim) und keine Wasserschutz-Abfrage; stattdessen Demo-Adressen.
- Getestet: vorbereiten, Netz aus (`context.setOffline`), neu laden → Start in 0,5 s, Grenze setzen und Prüfen funktionieren.
- Erzwingen zum Testen: `?offline` an die Adresse hängen.
