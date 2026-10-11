# Starkregen: Vergleich mit der Hinweiskarte des Landesamts für Umwelt

Die Simulation (`rules/regen.ts`) wurde für vier Orte neben die **Hinweiskarte Oberflächenabfluss und Sturzflut** des LfU gelegt (WMS, Ebenen „potentielle Fließwege bei Starkregen“ und „Geländesenken und potentielle Aufstaubereiche“, Lizenz CC BY 4.0, Datenquelle: Bayerisches Landesamt für Umwelt). Die LfU-Karte ist **rein topografisch** (bayernweit einheitlicher Ansatz, TU München) und hat laut ihrer Beschreibung Hinweischarakter; sie nimmt **kein bestimmtes Regenereignis** an. Verglichen wird deshalb nur, ob dieselben Stellen auffallen – nicht die Höhe des Wassers.

Aufruf: `cd app && PASST_VERGLEICH=1 npx vitest run test/regen_vergleich.test.ts`, dann `python pipeline/29_regen_vergleich.py`. Bilder: `docs/screenshots/C3-vergleich-*.png`.

Szenario der Simulation: 100-jährliches Ereignis, 60 min (KOSTRA-DWD-2020, 46,6 mm), Blockregen, 30 min Nachlauf, 2-m-Zellen, Umkreis 120 m, Annahmen aus `limits.json → starkregen`.

## Kennzahlen

| Ort | LfU-Fließwege (Zellen) | LfU-Senken | Simulation nass (≥ 2 cm) | LfU-Fließweg trifft nasse Zelle (≤ 2 m) | nasse Zellen ≤ 6 m an LfU-Fließweg | davon ≥ 5 cm | eigene Fließwege ≤ 6 m an LfU | LfU-Fließwege ≤ 6 m an eigenen | LfU-Senken an eigenen Senken (≤ 4 m) | eigene Senken an LfU-Senken (≤ 4 m) |
|---|---|---|---|---|---|---|---|---|---|---|
| Carl-Orff-Straße 1, Sulzbach-Rosenberg | 1262 | 21 | 1279 | 72 % | 38 % | 34 % | 30 % | 71 % | 0 % | 0 % |
| Fröschau 41, Sulzbach-Rosenberg | 1720 | 145 | 1660 | 65 % | 26 % | 19 % | 38 % | 72 % | 32 % | 17 % |
| Scharhof 1, Hirschau | 1456 | 3541 | 2148 | 69 % | 28 % | 24 % | 44 % | 82 % | 17 % | 32 % |
| Am Schützenheim 3, Sulzbach-Rosenberg | 864 | 0 | 952 | 77 % | 39 % | 27 % | 28 % | 84 % | – | 0 % |

(Zellen zu 4 m²; „eigene Fließwege“ = Zuflussfläche ≥ 400 m² aus dem Gelände allein; „eigene Senken“ = Senkentiefe ≥ 5 cm.)

## Befund

- **Hauptfließwege stimmen überein.** 71–84 % der LfU-Fließwegzellen liegen höchstens 6 m neben den Fließwegen, die Passt. allein aus dem Gelände rechnet (Zuflussfläche ≥ 400 m²). Umgekehrt zeigt Passt. mehr Linien: nur 28–44 % der eigenen Fließwegzellen liegen ≤ 6 m an einem LfU-Fließweg (die Schwelle 400 m² ist eine Wahl von Passt., der LfU zeigt nur größere Einzugsgebiete in drei Stufen).
- **Die Simulation bildet die LfU-Fließwege ab, ist aber flächiger.** 65–77 % der LfU-Fließwegzellen haben in der Simulation (≤ 2 m daneben) mindestens 1 cm Wasser. Nur 26–39 % der nassen Zellen (≥ 2 cm) liegen ≤ 6 m an einem LfU-Fließweg: In der Simulation regnet es auf jede Fläche, versiegelte Straßen und Höfe führen dünn Wasser ab; die LfU-Karte zeigt nur Konzentrationsbahnen.
- **Senken stimmen schlecht überein** (LfU-Senken an eigenen Senken: 0–32 %; eigene an LfU-Senken: 0–32 %). Mögliche Gründe (vermutet, nicht geprüft): Passt. nimmt Gebäude als Hindernisse und rechnet auf 2-m-Zellen; dadurch können Senken an Gebäuderändern und in Hofecken entstehen, die der LfU nicht zeigt. Welche Geländedaten, Auflösung und Mindestgrößen der LfU für Senken nutzt, steht in der Dienstbeschreibung nicht. **Senken-Aussagen von Passt. sind deshalb nur ein Hinweis**; die Simulation selbst zeigt, wo Wasser tatsächlich zusammenläuft (nasse Zellen).

## Mögliche Gründe für Abweichungen

- **Grundlage:** Der LfU nutzt laut Dienstbeschreibung einen bayernweit einheitlichen, rein topografischen Ansatz (TU München); die verwendeten Geländedaten und Mindestgrößen sind hier nicht bekannt. Passt. rechnet auf dem DGM1 (1 m) in 2-m-Zellen, Gebäude aus LoD2 als Hindernisse.
- **Regenereignis:** Der LfU zeigt „potentielle“ Fließwege ohne bestimmten Regen, Passt. ein 100-jährliches 60-Minuten-Ereignis (Blockregen) mit Versickerung und Anfangsverlust.
- **Kanal:** Passt. berücksichtigt das Kanalnetz nicht; der LfU-Ansatz ist rein topografisch, also vermutlich ebenfalls ohne Kanal. In Wirklichkeit nimmt der Kanal einen Teil des Wassers auf.
- **Bauwerke und Durchlässe:** Mauern, Bordsteine, Durchlässe und Brücken kennt Passt. nicht (1-m-Gelände). Der LfU weist laut Dienstbeschreibung Bereiche oberhalb von Durchlässen und kleinen Brücken an Gewässern 3. Ordnung als mögliche Aufstaubereiche aus.
- **Rand:** Passt. rechnet im Umkreis von 120 m; Wasser von weiter oben fehlt, am Rand fließt es ab.

## Folgerung

Die Simulation zeigt dieselben Hauptwege wie die amtliche Hinweiskarte und gibt zusätzlich Zeit und Tiefe an. Sie ersetzt keine Starkregen-Gefahrenkarte; sie ist eine Orientierung (Label `Simulation`). Wo die Simulation Wasser an einer angetippten Stelle zeigt, die LfU-Karte aber keinen Fließweg, ist das ein Hinweis auf Flächenabfluss oder eine Geländeform, die vor Ort geprüft werden muss.

