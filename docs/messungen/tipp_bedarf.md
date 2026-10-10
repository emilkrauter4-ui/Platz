# Tipp-Embeddings bei Bedarf (2026-10-10)

Seit diesem Stand rechnet der Tipp-Dienst die SAM-2-Bildfenster erst, wenn eine Adresse gewählt ist: zunächst
vorläufig für Adresspunkt ± 30 m, nach „Grenze bestätigen“ für das Grundstück plus 20 m Rand (`POST /vorbereiten`,
Hintergrund, Cache `data/build/tipp_embed/cache/`, Obergrenze 20 GB ≈ 2 383 Fenster, die am längsten
unbenutzten fliegen zuerst). Jeder live gerechnete Tipp landet ebenfalls im Cache. Ganze Kacheln werden nur noch für die
Demo-Kacheln 698_5486 und 699_5486 vorberechnet. Gemessen auf Container, 4 CPU-Kerne, keine GPU. Skript: `pipeline/23_tipp_bedarf.py`.

## fp16 statt fp32

Gleicher Tipp, gleiche Pipeline, einmal mit fp32-Embedding, einmal auf fp16 gerundet. 135 Tipps: 55 auf
sichere Objekte des Test-Sets v2, dazu 80 Zufallspunkte; 118 davon liefern einen Umriss.

| | Median IoU | Minimum | Anteil ≥ 0,99 |
|---|---|---|---|
| SAM-Maske (vor der Formregel) | 1,0000 | 0,9927 | 100,0 % |
| fertiger Umriss, alle Tipps | 1,0000 | 0,5987 | 99,2 % |
| fertiger Umriss, nur echte Objekte | | 0,9995 | 100 % |

**Entscheidung: fp16 bleibt.** Alle SAM-Masken bleiben bei IoU ≥ 0,99, alle 55 echten Objekte bei ≥ 0,9995. Die
einzige Ausnahme ist ein Zufallspunkt ohne Objekt: Die Masken sind praktisch gleich (0,996), aber die Formregel
(„Rechteck, wenn Fläche/Rechteck ≥ 0,6“) kippt an ihrer Schwelle. An einer Schwelle reicht jeder noch so kleine
Unterschied in der Maske für einen Sprung; bei echten Objekten trat das nicht auf. fp32 würde den Speicher verdoppeln.
Verlustfrei komprimiert (zlib) spart ein fp16-Fenster nur 13 % und kostet 2 s – deshalb unkomprimiert.

## Ein Grundstück

Fenster je Grundstück plus 20 m Rand, an den 60 Referenz-Grundstücken (echte Grenzen, Median 766 m²):
Median 6, 90 % ≤ 9, höchstens 12. Je Fenster 8,39 MB (fp16), Rechenzeit im Dienst
2,01 s (inklusive eines gleichzeitigen Tipps).

Ende zu Ende über HTTP, leerer Cache, drei Referenz-Grundstücke außerhalb der Demo-Kacheln:

| Grundstück | Fenster | Vorbereitung fertig nach | Tipp während der Vorbereitung | Tipps danach |
|---|---|---|---|---|
| A03 (371 m²) | 5 | 10,2 s | 1,01 s | 0,80 s |
| A10 (403 m²) | 6 | 11,6 s | 2,63 s | 0,90 s |
| A15 (1355 m²) | 12 | 24,4 s | 4,18 s | 0,82 / 0,81 / 0,90 s |

- Erster Tipp ganz ohne Vorbereitung (A03, Fenster live, Daten kalt): 6,75 s.
- Nach der Vorbereitung: alle Tipps aus dem Cache, Median 0,82 s, Maximum 0,90 s – unter 1 s.
- Während der Vorbereitung teilen sich Tipp und Hintergrund die 4 Kerne: 1–4 s. Im echten Ablauf setzt der Nutzer zwischen
  Adresswahl und erstem Tipp erst seine Grenzpunkte; die vorläufige Vorbereitung (± 30 m) läuft in dieser Zeit.
- Dienst-Start mit beiden Demo-Kacheln: 30 s.

## Hochrechnung Bayern

Gitter 48 m → 434 Fenster je km². Rechenzeit für Vorberechnung 1,53 s je Fenster (4 CPU-Kerne,
gemessen an Kachel 699_5486). Keine GPU gemessen.

| Variante | Fläche | Fenster | Speicher fp16 | (fp32) | Rechenzeit (4 Kerne) |
|---|---|---|---|---|---|
| ganz Bayern vorberechnen | 70 542 km² | 30 617 187 | 257 TB | 514 TB | 12 986 h ≈ 1,5 Jahre |
| nur Siedlungs- und Verkehrsfläche (12,4 %) | 8 747 km² | 3 796 531 | 31,9 TB | 63,7 TB | 1 610 h ≈ 67 Tage |
| **bei Bedarf, je Grundstück** | | 6 (90 %: 9) | 50 MB (90 %: 76 MB) | | 12 s (90 %: 18 s) |
| bei Bedarf, 100 000 Grundstücke, alles behalten | | 600 000 | 5,0 TB | | 335 h |

Die 100 000 Grundstücke sind eine obere Grenze: Nachbargrundstücke teilen Fenster, und der Cache ist begrenzt. Bei Bedarf
wächst der Aufwand mit der Nutzung, nicht mit der Landesfläche – ganz Bayern vorzurechnen lohnt sich nicht.
Quellen: Landesfläche 70 542 km² und Anteil Siedlungs- und Verkehrsfläche 12,4 % (2024) laut
[LfU-Umweltindikator](https://www.lfu.bayern.de/umweltdaten/indikatoren/ressourcen_effizienz/siedlungsflaeche_verkehrsflaeche/index.htm).
Die Siedlungs- und Verkehrsfläche enthält auch Straßen, Bahn und Gewerbe; für Wohngärten ist sie eine großzügige Obergrenze.
