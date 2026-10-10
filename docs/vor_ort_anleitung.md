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

## Mess-Adresse Scharhof 1, 92242 Hirschau (zweites Gebiet)

Daten, Befliegung und Lage: `docs/messungen/scharhof_daten.md`. **Vorher klären:** Scharhof 1 ist das Betriebsgelände der
Gebrüder Dorfner (Kaolinwerk, Tagebau), kein Wohn-Einzelhof. Gemessen werden sollen Kleinbauten (Schuppen, Carport,
Garage, Gewächshaus, Pool), keine Werkshallen. Das **Einverständnis** muss der Betrieb geben (`einverstaendnis_eigentuemer = ja`).

1. **App öffnen:** `…/?mess` zeigt unter der Adresssuche „Mess-Adressen“ (nicht unter den Demo-Adressen, nicht mit `?pitch`).
   Direkt: `…/?gebiet=scharhof`. Dort „Scharhof 1, 92242 Hirschau“ wählen oder aufs Grundstück tippen. Die Lage steht auf
   „Außenbereich (Annahme)“; im Prüfbericht ist das vermerkt.
2. **Objekt-ID:** `SH-01`, `SH-02`, … (Spalte `objekt_id`). `testset_id` bleibt leer. In `notiz` beginnen mit `Scharhof 1:`
   und kurz sagen, was es ist (z. B. „Scharhof 1: Materialschuppen hinter Halle 3“).
3. **Position (`rechtswert`, `hochwert`):** Mitte des Objekts in EPSG:25832, ±1 m. Aus dem BayernAtlas (Rechtsklick →
   Koordinaten, Koordinatensystem ETRS89/UTM 32) oder aus der Handy-Position umgerechnet:
   ```
   python3 -c "from pyproj import Transformer as T; print(T.from_crs(4326,25832,always_xy=True).transform(LÄNGE, BREITE))"
   ```
   (Handy-GPS ist nur auf 3–5 m genau – für den Tipp besser im BayernAtlas auf das Objekt klicken.)
   Das Objekt muss im Gebiet liegen und **mindestens 30 m vom Rand** entfernt: Rechtswert 715030–715970,
   Hochwert 5491030–5492970. Außerhalb weist der Tipp-Dienst den Tipp ab.
4. **Messen und eintragen** wie oben (Wandlängen je Seite, Überstände, Trauf-/Firsthöhe, optional Grenzstein, Fotos in
   `data/reference/vor_ort_fotos/`). Im Werk ist oft **kein Grenzstein** erreichbar; die Spalte dann leer lassen.
5. **Auswerten:** unverändert `cd pipeline && python3 21_vor_ort_auswerten.py`. Das Skript rechnet den Tipp selbst
   (`tipp.erfassen`) und braucht dafür keinen laufenden Tipp-Dienst; fehlende Bildfenster rechnet es bei Bedarf und legt
   sie im Cache ab (je Fenster rund 1,5 s auf 4 Kernen). Es trennt Demo-Gebiet und Scharhof nicht: Beide Gebiete stehen
   in derselben `vor_ort.csv`, die `SH-`-Zeilen sind am Präfix zu erkennen.
6. **Epoche beachten:** Luftbild 16.09.2023, Laser 08.03.2025, Stand LoD2 teils 2022. Ist ein Objekt jünger als September 2023
   (neu gebaut oder versetzt), steht es nicht im Luftbild – dann `notiz`: „nach 09/2023 gebaut/versetzt“, und die Zeile
   bei der Auswertung getrennt betrachten. Das Werk ändert sich häufig.
