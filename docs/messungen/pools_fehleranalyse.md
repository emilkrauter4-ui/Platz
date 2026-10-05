# Fehleranalyse: Warum 23 von 24 Pools übersehen wurden (5. Oktober 2026)

Grundlage: die 24 sicheren Pools des eingefrorenen Test-Sets nach Objekten, Modell v4. Für jeden Pool: Signale im
annotierten Umriss (Median), bester Kandidat der Erkennung (IoU), Klasse und Pool-Wahrscheinlichkeit des Klassifikators.
Skript `pipeline/18_pool_fehleranalyse.py`, Rohdaten `pools_fehleranalyse.json` (alle 36 Pools inkl. unsicherer).
Zeitaufwand: ≈ 30 min. Danach wird die Vollautomatik nicht weiter optimiert.

## Wo die Kette reißt
| Stufe | Pools | Anteil |
|---|---|---|
| Kandidatensuche findet keinen passenden Umriss (IoU < 0,3) | **12** | 50 % |
| Kandidat da, Klassifikator sagt „nichts“ (7), „Gartenhaus“ (3), „Terrasse“ (1) | **11** | 46 % |
| richtig als Pool erkannt | 1 | 4 % |

**Der Klassifikator ist die Hauptursache**, nicht nur die Kandidatensuche. Selbst gute Kandidaten (IoU 0,5–0,66,
eindeutig türkis) bekommen eine Pool-Wahrscheinlichkeit von 0–5 %. Er hat mit **2 Pools** im Entwicklungs-Set gelernt
und kennt die Klasse praktisch nicht. (Die Zahlen in der Tabelle sind das Modell allein; in der Erkennung kommt die
feste Pool-Regel `regel_scores` dazu.) Die Regel verlangt helles Türkis **und** NIR ≤ 50 im Median, um Schatten
auszuschließen. NIR ≤ 50 erfüllen nur **4 von 24** Pools. Alle Farbbedingungen erfüllen 2 (B015, B026). B015 hat keinen
passenden Kandidaten, übrig bleibt genau der eine erkannte Pool (B026). Helle Folien, Ränder und Abdeckungen reflektieren im Nahinfrarot.

## Ursachen im Einzelnen
1. **Befliegungszeitpunkt (Hauptgrund für die Kandidatensuche).** Luftbild: 16.09.2023 (Pools offen, mit Wasser).
   Laser: 08.03.2025 (Winter). Nur **3 von 24** Pools zeigen 2025 die für Wasser typische Echolücke. Bei **15 von 24** misst der
   Laser über 0,8 m Höhe im Umriss: die Wand des Aufstellpools, eine Winterabdeckung oder ein Baum darüber. Ein Teil der
   Aufstellpools war 2025 vermutlich abgebaut. Die Kandidatenregel verlangt „Laser-Höhe < 1,6 m“ und wertet „wenig Echo“
   als Wassersignal. Beides stammt aus einem Datensatz, in dem der Pool so nicht mehr existiert.
2. **Farbe: nicht türkis genug (11 von 24).** Hellblaue Folie, helle Ränder, Abdeckungen und leere Becken liegen unter der
   Türkis-Schwelle (0,35). Der Index bevorzugt kräftiges Blau-Grün, hellblaue Aufstellpools fallen durch. Auch meine
   Umrisse mit Rand senken den Median.
3. **Schatten (4 von 24).** Pools im Schatten von Haus oder Bäumen (Helligkeit < 70) kommen weder über „türkis und hell“
   noch über „NIR dunkel und wenig Echo“ in die Wasser-Maske.
4. **Klein (14 von 24 unter 12 m²).** Ein Aufstellpool mit 3 m Durchmesser hat ≈ 180 Pixel bei 20 cm. Nach dem
   morphologischen Öffnen und Füllen bleiben oft Teilflächen, die IoU 0,1–0,3 erreichen. Deshalb gibt es viele Treffer
   knapp unter der Schwelle (8 Pools mit IoU 0,13–0,28).
5. **Abgedeckt/leer (mehrere, überschneidend mit 2).** Graue oder weiße Abdeckungen sehen wie Terrasse oder Dach aus.

## Folgerung
Mehr Trainingsdaten würden den Klassifikator verbessern, aber die Zeitlücke zwischen Luftbild und Laser bleibt. Die
Vollautomatik bleibt deshalb nur ein Hinweis. Für Pools ist der Weg „Ein Tipp erfasst“ (Nutzer tippt, SAM 2 segmentiert
im Luftbild) der passende: Die Segmentierung braucht weder Türkis-Schwelle noch Laser-Wasserlücke.
