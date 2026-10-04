# Stammposition aus Laserdaten – Versuch und Ergebnis (Phase 3.1)

Stand 04.10.2026. Art. 49 AGBGB misst den Grenzabstand ab der Stammmitte am Boden. Ziel war, den Stamm aus der
Laserbefliegung März 2025 (unbelaubt, ~22 Punkte/m²) zu schätzen.

## Versuch 1: Dichtemaximum im Stammband (0,3–2,5 m über DGM1)
4295 Bäume und Sträucher. Selbstkontrolle (Stamm getrennt aus 0,3–1,4 m und 1,4–2,5 m geschätzt):
Median **5,3 m** Abweichung, 90 % ≤ 11,5 m. Abstand zur Kronenmitte Median 4,5 m. **Unbrauchbar.**

## Versuch 2: senkrechte Punktsäulen (0,25-m-Raster, belegte 0,5-m-Höhenbänder)
150 zufällige Bäume: Selbstkontrolle Median **5,3 m**, auch bei hohem Füllgrad (≥ 85 %) 5,6 m. **Unbrauchbar.**

## Ursache (Sichtprüfung von 6 Bäumen auf DOP20 und Laser-Grundriss)
- Unter den Kronen liegen kaum Punkte zwischen 0,3 und 2,5 m. Was dort liegt, sind Zäune, Sträucher, Autos und
  Gartenmöbel, nicht der Stamm. Ein Stamm von 20–40 cm wird bei dieser Dichte von oben kaum getroffen.
- Viele erkannte „Bäume“ sind Baumgruppen (Ersatzradius Median 5,5 m, also rund 95 m² Krone).

## Entscheidung
- Passt. rechnet **ohne Laser-Stamm**: Messpunkt = Kronenmitte, Spanne = halber Ersatzradius der Krone, mindestens
  0,75 m (Label `erkannt`, Text „Kronenmitte, Stamm nicht erkennbar“). In Grenznähe wird der Vergleich dadurch oft
  „nicht eindeutig“. Das ist ehrlich.
- Der Nutzer kann den Stamm **antippen** (Spanne 0,2 m, Label `nutzerbestätigt`).
- Später möglich: terrestrische Aufnahme (Handy-LiDAR, Foto vom Garten) oder dichtere Laserdaten.
