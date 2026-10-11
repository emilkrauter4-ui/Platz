# Beispiel-IFC-Dateien (Passt., Hausplan-Import)

Beide Dateien sind **eigene Arbeit** (erzeugt mit `pipeline/26_beispiel_ifc.py`, Schema IFC4) und stehen unter **CC0 1.0** (gemeinfrei, keine Auflagen).
Es sind **keine** Herstellerpläne und keine Pläne realer Gebäude.

| Datei | Form | Maße (Wandachsen) | Geschosse | Dach | Fenster | Räume |
|---|---|---|---|---|---|---|
| `haus_satteldach.ifc` | Rechteck | 10,0 × 8,0 m, Wand 0,30 m | 2 à 2,80 m | Satteldach 35°, First in West–Ost-Richtung, Überstand 0,40 m | 12 (`F{Wand}-G{Geschoss}-{Nr}`) | 8 (Wohnen, Küche, Arbeiten, Bad, Schlafen, Kind, Kind 2, Bad) |
| `haus_l_flachdach.ifc` | L-Form 12 × 10 m mit Ausschnitt 6 × 4 m | Wand 0,30 m | 2 | Flachdach (Platte 0,30 m), Traufe = First 5,9 m | 7 | 4 |

Sie dienen als Testdaten (`app/test/hausplan.test.ts`) und als Demo-Eingabe in der App („Beispielhaus laden“).
Neu erzeugen: `python pipeline/26_beispiel_ifc.py`.
