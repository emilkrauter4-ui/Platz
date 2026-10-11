# Beispiel-IFC-Dateien (Passt., Hausplan-Import)

Beide Dateien sind **eigene Arbeit** (erzeugt mit `pipeline/26_beispiel_ifc.py`, Schema IFC4) und stehen unter **CC0 1.0** (gemeinfrei, keine Auflagen).
Es sind **keine** Herstellerpläne und keine Pläne realer Gebäude.

| Datei | Form | Maße (Wandachsen) | Geschosse | Dach | Fenster | Räume |
|---|---|---|---|---|---|---|
| `haus_satteldach.ifc` | Rechteck | 10,0 × 8,0 m, Wand 0,30 m | 2 à 2,80 m | Satteldach 35°, First in West–Ost-Richtung, Überstand 0,40 m | 12 (`F{Wand}-G{Geschoss}-{Nr}`) | 8 (Wohnen, Küche, Arbeiten, Bad, Schlafen, Kind, Kind 2, Bad) |
| `haus_l_flachdach.ifc` | L-Form 12 × 10 m mit Ausschnitt 6 × 4 m | Wand 0,30 m | 2 | Flachdach (Platte 0,30 m), Traufe = First 5,9 m | 7 | 4 |
| `villa_hochkomplex.ifc` | 18-eckiger Grundriss, ca. 33 × 14 m, 330 m² | Wand 0,30 m | Keller, EG, OG, Dachgeschoss (3,0 / 3,0 / 2,9 / 2,6 m) | Satteldach 38° (Haupthaus), Pultdach (Westflügel), Pyramidendächer (Turm, Erker), Flachdach mit Terrasse (Garage) | 40 (3 davon im Keller) | 27 (4 davon im Keller) |

Die Villa hat außerdem Turm, sechseckigen Erker, Vorbau mit Säulen und Balkon, zwei Gauben, Schornstein, zwei Treppen, Innenwände und Türen. Sie ist ein Stresstest für den Import (Keller darf nicht als Erdgeschoss gelten).

Sie dienen als Testdaten (`app/test/hausplan.test.ts`) und als Demo-Eingabe in der App („Beispielhaus laden“).
Neu erzeugen: `python pipeline/26_beispiel_ifc.py`.
