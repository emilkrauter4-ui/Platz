# Garten-Erkennung: Auswertung (Phase 1.5)

Stand 2026-10-04, Modell v4. Erzeugt von `pipeline/09_garten_eval.py`.

**Zuordnung:** eins zu eins je Klasse, Treffer ab IoU ≥ 0.3. Referenzobjekte mit `sicher: false`
(nur in einer Epoche sichtbar, Art unklar) zählen weder als verpasst noch – bei Überlappung – als Fehltreffer.
Maßfehler: absolute Abweichung von Länge/Breite (minimales gedrehtes Rechteck) und Höhe gegenüber der Referenz.
„im Bereich ±“: Anteil der Maße, deren Fehler innerhalb der angezeigten Spanne liegt.

## Eingefrorenes Test-Set (20 Grundstücke, einmal gemessen)

| Klasse | Ref. | erkannt | Treffer | Präzision | Trefferquote | IoU | Median Länge | Median Breite | Median Höhe | im Bereich ± |
|---|---|---|---|---|---|---|---|---|---|---|
| gartenhaus | 2 | 6 | 1 | 17 % | 50 % | 0,34 | 6,56 m | 1,15 m | 0,13 m | 0 % |
| carport_garage | 1 | 0 | 0 | – | 0 % | – | – m | – m | – m | – |
| pool | 0 | 0 | 0 | – | – | – | – m | – m | – m | – |
| terrasse | 6 | 1 | 1 | 100 % | 17 % | 0,62 | 13,84 m | 4,28 m | – m | 0 % |
| hecke | 3 | 1 | 0 | 0 % | 0 % | – | – m | – m | – m | – |
| baum | 20 | 13 | 6 | 46 % | 30 % | 0,56 | 1,35 m | 0,72 m | 1,05 m | 22 % |
| strauch | 6 | 3 | 0 | 0 % | 0 % | – | – m | – m | – m | – |
| zaun_mauer | 0 | 0 | 0 | – | – | – | – m | – m | – m | – |
| nebengebaeude | 3 | 6 | 2 | 33 % | 67 % | 0,43 | – m | – m | – m | – |

- **gartenhaus**: Präzision 0.17, Trefferquote 0.5 (Ziel je ≥ 0,80: nicht erreicht), Median Länge/Breite 6.56/1.15 m (Ziel ≤ 0,30 m), n = 2
- **pool**: im Set kein sicheres Referenzobjekt – Ziel **nicht messbar** (0 Erkennungen, alle wären Fehltreffer)

Grenzbebauung (Nebengebäude ab Konfidenz 0.8, so zählt die App automatisch mit):
1 von 2 richtig, 3 Referenzen.

Rechenzeit: 1.7 s je Grundstück auf 4 CPU-Kernen (mit SAM 2).

## Entwicklungs-Set (Kreuzvalidierung nach Grundstück, zum Einstellen benutzt)

| Klasse | Ref. | erkannt | Treffer | Präzision | Trefferquote | IoU | Median Länge | Median Breite | Median Höhe | im Bereich ± |
|---|---|---|---|---|---|---|---|---|---|---|
| gartenhaus | 13 | 11 | 7 | 64 % | 54 % | 0,60 | 0,39 m | 0,33 m | 0,07 m | 52 % |
| gewaechshaus | 2 | 0 | 0 | – | 0 % | – | – m | – m | – m | – |
| carport_garage | 2 | 0 | 0 | – | 0 % | – | – m | – m | – m | – |
| pool | 2 | 1 | 1 | 100 % | 50 % | 0,30 | 1,90 m | 2,50 m | – m | 0 % |
| terrasse | 4 | 2 | 0 | 0 % | 0 % | – | – m | – m | – m | – |
| hecke | 18 | 0 | 0 | – | 0 % | – | – m | – m | – m | – |
| baum | 29 | 25 | 11 | 44 % | 38 % | 0,56 | 2,45 m | 0,86 m | 1,69 m | 6 % |
| strauch | 10 | 5 | 0 | 0 % | 0 % | – | – m | – m | – m | – |
| zaun_mauer | 0 | 0 | 0 | – | – | – | – m | – m | – m | – |

Nebengebäude (Gartenhaus + Carport/Garage + Gewächshaus) nach Konfidenz:
- ab 0.5: Präzision 0.69, Trefferquote 0.47 (9/13)
- ab 0.6: Präzision 0.69, Trefferquote 0.47 (9/13)
- ab 0.7: Präzision 0.67, Trefferquote 0.42 (8/12)
- ab 0.8: Präzision 1.0, Trefferquote 0.12 (2/2)

Schwellwerte je Klasse (auf Dev gewählt): gartenhaus 0.3, gewaechshaus 0.3, carport_garage 0.3, pool 0.3, teich 0.3, terrasse 0.3, trampolin 0.3, spielturm 0.3, hecke 0.3, baum 0.3, strauch 0.3, waermepumpe 0.3, zaun_mauer 0.3

## Was die Zahlen bedeuten – und was nicht

- Die Referenz hat Claude (KI-Assistent) auf denselben Daten annotiert, mit denen die Erkennung arbeitet
  (DOP20 2023, Laser 2025). Die Zahlen messen Übereinstimmung mit dieser Annotation, **nicht** die Wahrheit vor Ort.
  Unabhängig prüfen lässt sich das nur mit Maßband-Messungen (`data/reference/vor_ort.csv`, liefert Emil).
- Die Höhen der Referenz sind aus denselben Laserpunkten geschätzt; der Höhenfehler ist deshalb nur ein
  Konsistenzmaß.
- Viele Klassen kommen in 60 zufälligen Grundstücken selten oder gar nicht vor (z. B. Pool, Trampolin, Teich).
  Bei n < 5 sind Präzision und Trefferquote Einzelfälle, keine Raten.
- Bilder 2023 (belaubt) und Laser 2025 (laubfrei) sind zwei Zeitpunkte: Zelte und Pavillons, die nur 2023
  dastanden, und Neubauten nach 2023 sind als `sicher: false` markiert.
