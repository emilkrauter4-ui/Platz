# Test-Set nach Objekten (eingefroren 5. Oktober 2026)

Werkzeug: `pipeline/17_testset_objekte.py`. Daten: `data/reference/objekte/` (Blockliste, Annotationen, `objekte.geojson`,
`testset.json` mit Prüfsumme). Das alte Test-Set (20 Grundstücke, `data/reference/split.json`) bleibt unverändert.

## Auswahl – unabhängig von der Erkennung
- Gebiet (4 Kacheln, 2 × 2 km) in 100 × 100-m-Blöcke geteilt; nur Blöcke mit ≥ 3 Wohnhäusern, ohne Überschneidung mit den
  alten 60 Referenz-Grundstücken (+15 m). Ergebnis: **119 Blöcke** (698_5486: 45, 699_5486: 37, 698_5487: 32, 699_5487: 5).
- Alle 119 Blöcke in zufälliger Reihenfolge (Seed 20261004) **vollständig** für die vier Klassen annotiert (DOP20 2023 +
  Laser-nDSM 2025, Lupen mit 1-m-Raster). Die Erkennung wurde dabei nicht angesehen.
- Stichprobe für die Trefferquote je Klasse: Zufallsauswahl in Quotengröße aus den sicheren Objekten (Seed 20261005).

## Quoten: **nicht erreicht** – das Gebiet gibt sie nicht her
| Klasse | Ziel | sicher gefunden | zusätzlich unsicher |
|---|---|---|---|
| Gartenhaus | 50 | **43** | 53 |
| Pool | 30 | **24** | 12 |
| Trampolin | 30 | **14** | 7 |
| Gewächshaus | 20 | **3** | 8 |

Alle Wohnblöcke des 2 × 2-km-Gebiets sind durchgesehen. Mehr gibt es hier nicht (oder es ist aus Luftbild 2023 und
Laser 2025 nicht sicher erkennbar). Für die vollen Quoten braucht es weitere Kacheln (Daten herunterladen) oder eine
Begehung. Gewächshäuser (3) und Trampoline (14) sind für belastbare Zahlen zu wenige.

> **Nachtrag 05.10.2026:** Die Umrisse v1 liegen systematisch ≈ 0,8 m zu weit nördlich und ≈ 0,3 m zu weit westlich
> (Ablesefehler; belegt mit Laser-Dachpunkten und Wasser-Echolücken, siehe `tipp_test.md`). v1 bleibt eingefroren.
> v2 (`objekte_v2.geojson`) ist global verschoben. Vollautomatik gegen v2: Trefferquoten bei IoU ≥ 0,3 unverändert.

## Ergebnis Modell v4 (IoU ≥ 0,3, gleiche Klasse)
| Klasse | Stichprobe | Treffer | Trefferquote | Erkennungen im Gebiet | davon richtig | Präzision |
|---|---|---|---|---|---|---|
| Gartenhaus | 43 | 24 | **0,56** | 279 | 33 | **0,12** |
| Gartenhaus, nur Konfidenz ≥ 0,8 (zählt in der App automatisch) | 43 | 13 | 0,30 | 109 | 17 | 0,16 |
| Pool | 24 | 1 | **0,04** | 10 | 1 | 0,10 |
| Trampolin | 14 | 0 | **0** | 0 | – | – |
| Gewächshaus | 3 | 0 | **0** | 0 | – | – |

Zum Vergleich altes Test-Set: Gartenhaus Trefferquote 1/2, Präzision 1/6 – dieselbe Größenordnung, jetzt mit 43 statt 2 Objekten.

## Wie man das lesen muss (ehrlich)
- **Pools, Trampoline, Gewächshäuser erkennt das Modell praktisch nicht.** Pools: 1 von 24. Das passt zum Training
  (2 Pools im Dev-Set). Die Kandidatensuche findet flache, runde Objekte ohne Laser-Höhe kaum.
- **Gartenhaus-Trefferquote 0,56** ist ein echter Wert. Die **Präzision ist eine Untergrenze**: Stichprobe von 6 „falschen“
  Erkennungen mit Konfidenz ≥ 0,8 (`boegen/fp_stichprobe.jpg`): ≈ 2 sind Garagen/Anbauten außerhalb der Hausumringe
  (falsche Klasse, für die Grenzbebauung aber relevant), ≈ 2 sind echte kleine Gartenhäuser, die **ich bei der
  Annotation übersehen habe**, der Rest ist unklar. Die Annotation ist also nicht vollständig. Das Set bleibt trotzdem
  eingefroren: Nachträgliches Ergänzen nach Ansicht der Erkennung würde es verzerren.
- Annotiert hat Claude (KI) am Bildschirm, nicht vor Ort. Unsichere Objekte zählen nicht für die Trefferquote. Für die
  Präzision zählen auch sie als richtig.
- **Überschneidung mit dem Training:** 13 der 20 Zusatzpunkte aus Meilenstein 5 (`docs/bestand_referenz.json`), mit denen
  v4 trainiert wurde, liegen in Test-Blöcken. Betroffen sind 2 der 43 Gartenhäuser der Stichprobe (1 davon getroffen).
  Ohne sie: 23 von 41 = 0,56, also unverändert. Künftige Versionen (`12_lernschleife.py trainieren`) lassen diese Punkte
  und alle Beiträge in Test-Blöcken weg.
- Ziele aus AUFTRAG_V2 Phase 1 (Präzision/Trefferquote ≥ 0,8) sind **deutlich verfehlt**.

Neu messen: `python3 pipeline/17_testset_objekte.py messen [garten.geojson]` (prüft die Prüfsumme).
