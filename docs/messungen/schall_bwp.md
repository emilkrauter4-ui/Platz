# Wärmepumpe: Vergleich mit dem BWP-Schallrechner (Phase 2.3)

Am 4. Oktober 2026 zehn Fälle an den Schallrechner des Bundesverbands Wärmepumpe geschickt
(https://www.waermepumpe.de/werkzeuge/schallrechner/, „Benutzereingabe“, Luft-Wasser, Außenaufstellung, 1 Gerät,
ohne Schallreduzierung, ohne Tonhaltigkeit; eine Abfrage je 1,2 s). Verglichen mit der Rechnung in Passt.
(`soundPressure` minus Abschirmung, `app/src/rules/evaluate.ts`) bei **denselben Eingaben**. Rohdaten: `schall_bwp.json`.

| # | Lw dB(A) | Aufstellung | Abstand m | Gebiet | Abschirmung | BWP nachts | Passt. | Δ | Urteil BWP / Passt. |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 58 | wand | 6 | allgemein | Sicht | 37,4 | 37,5 | +0,1 | Unterschreitung / Unterschreitung |
| 2 | 55 | frei | 5 | allgemein | Sicht | 33,0 | 33,0 | +0,0 | Unterschreitung / Unterschreitung |
| 3 | 62 | ecke | 10 | rein | Sicht | 40,0 | 40,0 | +0,0 | Überschreitung / Überschreitung |
| 4 | 50 | wand | 3 | allgemein | Sicht | 35,5 | 35,5 | -0,0 | Unterschreitung / Unterschreitung |
| 5 | 65 | frei | 15 | misch | Sicht | 33,5 | 33,5 | -0,0 | Unterschreitung / Unterschreitung |
| 6 | 60 | wand | 8 | allgemein | keine Sicht | 31,9 | 32,0 | +0,1 | Unterschreitung / Unterschreitung |
| 7 | 60 | wand | 4 | allgemein | abgewandt | 28,0 | 28,0 | -0,0 | Unterschreitung / Unterschreitung |
| 8 | 52 | ecke | 4 | rein | Sicht | 38,0 | 38,0 | -0,0 | Überschreitung / Überschreitung |
| 9 | 68 | wand | 20 | misch | keine Sicht | 32,0 | 32,0 | +0,0 | Unterschreitung / Unterschreitung |
| 10 | 57 | frei | 2 | allgemein | Sicht | 43,0 | 43,0 | -0,0 | Überschreitung / Überschreitung |

**Ergebnis:** gleiche Formel, Abweichung höchstens 0,1 dB(A) (Rundung), in allen 10 Fällen dasselbe Urteil.

**Was der Vergleich nicht zeigt:** Beim BWP-Rechner wählt der Nutzer Abstand, Aufstellung (frei/Wand/Ecke) und
Abschirmung selbst. Passt. bestimmt sie aus der Geometrie: Abstand 3D zum lautesten Punkt der Nachbarfassade
(1-m-Raster, Erdgeschoss 1,6 m, Obergeschoss 4,4 m), Wände aus LoD2 bis 3 m, Sichtlinie gegen LoD2-Grundrisse. Die
Unterschiede in der Praxis liegen dort, nicht in der Formel. Nicht umgesetzt: Tageswerte mit Ruhezeitenzuschlag
(der BWP-Rechner rechnet sie mit +6 dB), Tonhaltigkeit, mehrere Geräte, Schallschutzmaßnahmen.
