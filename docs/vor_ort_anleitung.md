# Maßband-Protokoll für „Ein Tipp erfasst“ (`data/reference/vor_ort.csv`)

Zweck: unabhängige Referenz, um die Tipp-Erfassung gegen echte Maße zu prüfen – **Wand und Dach getrennt**.
Auswertung: `cd pipeline && python3 21_vor_ort_auswerten.py` (läuft automatisch über alle vollständigen Zeilen).

## Vorher
- **Einverständnis** der Eigentümerin oder des Eigentümers (Spalte `einverstaendnis_eigentuemer` = `ja`). Ohne `ja`
  wertet das Skript die Zeile nicht aus.
- Position des Objekts notieren: **Rechtswert/Hochwert (EPSG:25832) der Objektmitte**, auf ±1 m genügt (aus dem
  BayernAtlas: Rechtsklick → Koordinaten, oder in Passt. auf das Objekt tippen). Damit simuliert das Skript den Tipp.
- Falls das Objekt im Test-Set liegt: dessen ID in `testset_id` (z. B. `B017_00`), sonst leer.

## Messen (Maßband, möglichst 2 Personen; Werte in Metern mit Punkt, z. B. `3.42`)
| Spalte | Was | Wie |
|---|---|---|
| `wand_nord_m` … `wand_west_m` | Länge der Außenwand, die nach Norden/Osten/Süden/Westen zeigt | auf Sockelhöhe von Ecke zu Ecke, außen; bei Schräglage der Wände die Seite der Himmelsrichtung zuordnen, die am besten passt |
| `ueberstand_nord_m` … `ueberstand_west_m` | Dachüberstand je Seite | waagrecht von der Wand bis zur äußersten Dachkante (Rinne zählt mit); Lot oder Wasserwaage helfen |
| `traufhoehe_m` | Höhe der Traufe über Gelände | vom Boden direkt an der Wand bis Unterkante Dachrand; bei Hang Mittel aus zwei Ecken, in `notiz` vermerken |
| `firsthoehe_m` | höchster Punkt des Dachs über Gelände | bei Flachdach gleich Traufhöhe; sonst schätzen ist nicht erlaubt – leer lassen, wenn nicht messbar |
| `abstand_grenzstein_m` | optional: kürzester Abstand Wand ↔ Grenzstein | nur wenn der Grenzstein sicher gefunden ist; `grenzstein_wand` = welche Wand (`nord`/`ost`/…) |
| `fotos` | Dateinamen, mit `;` getrennt | Fotos in `data/reference/vor_ort_fotos/` (nicht im Git): je Seite eins, dazu eins mit Maßband am Überstand |
| `gemessen_am` | Datum `JJJJ-MM-TT` | |
| `messmittel` | z. B. `Maßband 10 m`, `Laser-Entfernungsmesser` | |

Pflicht für die Auswertung: `objekt_id`, `klasse`, `rechtswert`, `hochwert`, alle vier Wandlängen und
`einverstaendnis_eigentuemer = ja`. Überstände, Höhen und Grenzstein werten nur, wenn ausgefüllt.

## Was die Auswertung rechnet
- **Wand**: gemessene Ausdehnung Ost–West = Mittel aus Nord- und Südwand, Nord–Süd = Mittel aus Ost- und Westwand.
  Verglichen mit dem geschätzten Wandumriss des Tipps (Label „geschätzt“).
- **Dach**: Wand + Überstände beider Seiten. Verglichen mit dem Tipp-Umriss aus dem Luftbild.
- **Überstand je Seite**: gemessen gegen geschätzt (Laser-Wandpunkte oder Annahme 0,3 m – die Quelle steht dabei).
- **Höhen**: Traufe und First gegen die Laser-Dachebenen.
- Ziel: Medianfehler ≤ 0,30 m, getrennt für Wand und Dach.
