# Referenzdatensatz Garten-Erkennung

Grundlage für Phase 1 (AUFTRAG_V2): 60 Grundstücke im MVP-Gebiet (LoD2-Kachel 698_5486, 2 × 2 km), je 20 aus
Altstadt, Siedlung und Hang. Erzeugt und gepflegt mit `pipeline/07_referenz.py`.

| Datei | Inhalt |
|---|---|
| `grundstuecke.geojson` | 60 Grundstücke (EPSG:25832) mit Zone, Split (dev/test), Fläche. Grenzen aus der Parzellarkarte vektorisiert, **nicht amtlich** |
| `annotationen/ID.json` | Annotation je Grundstück (Eingabe, in Bogenkoordinaten) |
| `referenz.geojson` | daraus erzeugte Referenzumrisse mit Klasse, geschätzter Höhe und Umriss-Methode |
| `split.json` | Liste dev/test und Prüfsumme des eingefrorenen Test-Sets |
| `vor_ort.csv` | echte Messungen mit Maßband (liefert Emil nach) |
| `boegen/` | Annotations- und Kontrollbögen (nicht im Git, jederzeit neu erzeugbar) |

## Auswahl
- Wohnhäuser (ALKIS-Gebäudefunktion 31001_1xxx, 60–300 m²) zufällig gezogen (Seed 20261003), mindestens 70 m Abstand.
- Grenze per Füllung der Parzellarkarte ab einem Punkt 3 m vor der Hauswand (wie `demo_grenze.py`), 200–2500 m² (Altstadt ab 100 m²: Hinterhöfe).
- Zone: **Altstadt**, wenn im 60-m-Kreis um das Haus ≥ 35 % bebaut sind (im Gebiet gab es so nur 14 brauchbare Grundstücke; die restlichen 6 kommen aus einem dritten Durchgang mit 30–35 %, Feld `altstadtrand`); sonst **Hang**, wenn die Ausgleichsebene des
  DGM1 über dem Grundstück ≥ 8 % geneigt ist; sonst **Siedlung**.
- Split: 40 Entwicklung, 20 Test (Altstadt 6, Siedlung 7, Hang 7), zufällig je Zone mit eigenem Seed (20261103 + Zonennummer). Test-Set ist nach dem Einfrieren tabu für das Einstellen
  von Parametern und für das Training; `09_garten_eval.py` prüft die Prüfsumme.

## Annotationsregeln
- **Wer:** Annotiert hat Claude (KI-Assistent) am Bildschirm, Objekt für Objekt auf Bögen mit 5-m-Raster und
  Lupen mit 1-m-Raster (DOP20 und Laserpunkte). Das ist **keine unabhängige Wahrheit**: dieselben Daten
  (DOP20 2023, Laser 2025) stecken auch in der Erkennung. Unabhängig sind nur die Maßband-Werte in `vor_ort.csv`.
- **Stand:** maßgeblich ist das Luftbild vom **16.09.2023**. Laser (08.03.2025, laubfrei) hilft bei Kanten und Höhen.
  Objekte, die nur in einer Epoche existieren, bekommen `"sicher": false` und eine Notiz; sie zählen in der
  Auswertung nicht als Fehler, wenn sie fehlen oder gefunden werden.
- **Umriss:** Dachkante bzw. äußere Kante in der Draufsicht (inkl. Dachüberstand – sichtbar ist nur das Dach).
  Gebäude, die in den Hausumringen stehen, werden nicht annotiert (sie sind `amtlich`).
- **Geometrie:** Kleinbauten, Pools, Trampoline als Rechteck/Kreis/Eckpunkte von Hand (Lupe, Lesegenauigkeit
  ~0,1–0,2 m). Unregelmäßiges (Hecke, Baum, Strauch, Teich, Terrasse) als Eckpunkte grob (~0,5 m) oder per
  SAM 2 aus einer Box mit Sichtkontrolle; die Methode steht je Objekt in `umriss_methode`.
- **Höhe:** geschätzt aus den Laserpunkten der Lupe (höchste zusammenhängende Dachpunkte über Boden), auf 0,1 m.
- **Grenzfälle:** Objekte, die die Grundstücksgrenze schneiden, werden ganz annotiert. Baumkronen vom Nachbarn,
  die hineinragen, nur wenn der Stamm (Laser) im Grundstück steht oder höchstens 1 m außerhalb.
- **Klassen:** gartenhaus (inkl. Laube, Pavillon mit Dach), gewaechshaus, carport_garage (nur wenn nicht in den
  Hausumringen), pool, teich, terrasse (inkl. befestigter Hof/Zufahrt im Garten), trampolin, spielturm, hecke,
  baum, strauch; optional waermepumpe, zaun_mauer (nur auffällige Mauern ≥ 1,2 m).

## Zweites Test-Set: nach Objekten (`objekte/`, eingefroren 5. Oktober 2026)
119 Blöcke à 100 × 100 m, vollständig für Gartenhaus, Pool, Trampolin und Gewächshaus annotiert (dieselben Regeln wie oben,
Angaben in Blockkoordinaten). `objekte/testset.json` enthält Stichprobe und Prüfsumme. Erzeugt mit
`pipeline/17_testset_objekte.py`, Auswertung in `docs/messungen/testset_objekte.md`. Tabu für Training und Parameter.
