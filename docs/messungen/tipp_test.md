# „Ein Tipp erfasst“ – Messung auf dem eingefrorenen Test-Set (5. Oktober 2026)

Verfahren: `pipeline/tipp.py`. Simulierter Tipp in die Objektmitte (Schwerpunkt, sonst repräsentativer Punkt),
SAM 2.1 small mit Punkt-Prompt auf DOP20 (Ausschnitt 48 × 48 m), kleinste Maske mit ≥ 85 % der besten Bewertung,
Hausumringe abgezogen, Form regularisiert (Rechteck, bei runden Pools/Trampolinen Kreis). Höhe aus Laser 2025.
Messung: `pipeline/19_tipp_messen.py`. Nur sichere Objekte (87).

**Einstellungen nur auf dem Entwicklungs-Set gewählt** (18 Objekte der alten Referenz, 15 Varianten:
`tipp_dev_runde1.json`, `tipp_dev_runde3.json`). Erfolg dort 44–58 % in allen Varianten. Festgelegt und committet
(ab18058) **vor** der Test-Messung.

## Ziel: ≥ 90 % Erfolg bei Gartenhaus und Pool, Maßfehler im Median ≤ 0,30 m – **nicht erreicht**

### Gegen die eingefrorene Referenz v1
| Klasse | n | Erfolg (IoU ≥ 0,5) | IoU Median | Fehler Länge | Fehler Breite | Fehler Höhe* |
|---|---|---|---|---|---|---|
| gartenhaus | 43 | **30 %** | 0,41 | 0,80 m | 0,40 m | 0,04 m |
| pool | 24 | **25 %** | 0,35 | 0,70 m | 0,60 m | 0,13 m |
| trampolin | 14 | **14 %** | 0,34 | 0,40 m | 0,20 m | 0,01 m |
| gewaechshaus | 3 | **33 %** | 0,37 | 0,18 m | 0,09 m | 0,00 m |
| carport_garage | 3 | **67 %** | 0,57 | 0,73 m | 0,50 m | 0,14 m |
| alle | 87 | **28 %** | 0,39 | 0,75 m | 0,40 m | 0,04 m |

### Gegen die korrigierte Referenz v2 (siehe unten)
| Klasse | n | Erfolg (IoU ≥ 0,5) | IoU Median | Fehler Länge | Fehler Breite | Fehler Höhe* |
|---|---|---|---|---|---|---|
| gartenhaus | 43 | **63 %** | 0,52 | 0,90 m | 0,56 m | 0,02 m |
| pool | 24 | **33 %** | 0,44 | 0,65 m | 0,40 m | 0,11 m |
| trampolin | 14 | **43 %** | 0,46 | 0,30 m | 0,20 m | 0,04 m |
| gewaechshaus | 3 | **33 %** | 0,38 | 0,18 m | 0,09 m | 0,01 m |
| carport_garage | 3 | **100 %** | 0,57 | 0,90 m | 0,31 m | 0,12 m |
| alle | 87 | **52 %** | 0,51 | 0,73 m | 0,40 m | 0,03 m |

Maßfehler: Median der Beträge, nur über erfolgreiche Tipps (Werte über alle Tipps in den JSON-Dateien).
\* Höhe: Laser-Höhe im Tipp-Umriss gegen dieselbe Rechnung im Referenzumriss. Das zeigt nur den Einfluss des Umrisses auf die Höhe. Eine
unabhängige Höhenreferenz gibt es nicht (`vor_ort.csv` ist leer). Die Laser-Höhe selbst hat ihre eigene Spanne (Phase 1).

## Wichtiger Befund: Meine Referenz ist ungenauer als das Ziel
- Die Überlagerungen zeigen den Tipp-Umriss auf dem Objekt und meine Referenz daneben. Zwei Prüfungen unabhängig vom
  Tipp-Verfahren:
  - **Pools mit Wasser-Echolücke im Laser** (wahre Lage): Tipp-Umriss 0,2–0,7 m daneben, meine Referenz 0,7–2,4 m.
  - **35 Gartenhäuser, Dach-Laserpunkte** (wahre Lage): Meine Referenz liegt im Median **0,84 m zu weit nördlich und 0,27 m zu weit
    westlich**. 89 % liegen zu weit nördlich.
- Ursache: Ablesefehler an meinen Annotationsbögen. Die Zahlen standen neben statt auf der Rasterlinie. Im Werkzeug
  korrigiert (`17_testset_objekte.py`, Beschriftung jetzt auf der Linie).
- **v1 bleibt unverändert eingefroren.** v2 = v1 um einen einzigen globalen Versatz (+0,3 m Ost, −0,8 m Nord)
  verschoben. Der Versatz ist **nur aus dem Laser** geschätzt und hat eigene Prüfsumme (`objekte_v2.geojson`, `testset_v2.json`).
- Auch nach der Korrektur weicht meine Referenz im Median noch **0,60 m** von den Dach-Laserpunkten ab (75 %: 1,27 m).
  **Mit dieser Referenz lässt sich ein Ziel von 0,30 m weder bestätigen noch widerlegen.** IoU ≥ 0,5 ist bei 2–4 m
  großen Objekten schon bei 0,5 m Lagefehler kaum zu erreichen.
- Vollautomatik gegen v2: Trefferquote bei IoU ≥ 0,3 unverändert (Gartenhaus 24/43). Bei IoU ≥ 0,5 verdoppelt sie sich von 6 auf 12.

## Was das Tipp-Verfahren tatsächlich falsch macht (aus den Überlagerungen)
- Runde Pools werden teils als Rechteck regularisiert, wenn die Maske nicht rund genug ist (Kreisförmigkeit < 0,75).
- SAM erfasst bei Pools mit hellem Rand oder Abdeckung manchmal nur das Innere oder nur den Rand.
- Gartenhäuser mit zweifarbigem oder verschattetem Dach: nur eine Dachhälfte.
- Gebäudeneigung im Luftbild: Das Dach ist im DOP gegenüber dem Laser um einige Dezimeter versetzt. Das betrifft die Lage, die Maße kaum.

## Was es braucht, um das Ziel zu prüfen
1. Eine Referenz mit Lagefehler deutlich unter 0,3 m: Maßband vor Ort (`vor_ort.csv`, Emil) oder eine Annotation durch
   eine zweite Person mit dem korrigierten Werkzeug, Kanten an Laser und Luftbild.
2. Dann neu messen. In der App bleibt der Umriss ohnehin nachziehbar, der Tipp ist ein Vorschlag.
