# Antwortzeit „Ein Tipp erfasst“ (2026-10-09)

Gemessen per HTTP gegen den Tipp-Dienst, wie die App ihn ruft (Container, 4 CPU-Kerne, keine GPU). Tipps auf die sicheren Objekte des
Test-Sets in der Kachel 698_5486 (Embeddings vorberechnet mit `20_tipp_embeddings.py`).

| | Zeit |
|---|---|
| Dienst-Start bis „bereit“ (lädt SAM 2, Klassifikator, Gebäude; Probe-Tipp) | 12,40 s |
| **erster Tipp nach dem Start** | **0,67 s** (vorberechnet) |
| weitere Tipps (26): Median / 95 % / Maximum | 0,68 s / 0,78 s / 0,84 s |
| davon unter 1 s | 26 von 26 |
| zum Vergleich ohne Embeddings (Kachel 699_5486, 10 Tipps): Median / Maximum | 2,33 s / 2,73 s |

## Wie
- `pipeline/20_tipp_embeddings.py 698_5486`: SAM-2.1-small-Bild-Embeddings für 484 Fenster (96 × 96 m, Gitter 48 m)
  vorab, float16-Memmaps, **4,06 GB**, **14 min** auf 4 CPU-Kernen. Pro Tipp läuft nur noch der Prompt-Decoder
  (≈ 0,04 s). Gleichheit geprüft (`… pruefen`): Masken live ↔ vorberechnet IoU Median 1,000, Minimum 0,998
  (nur float16-Rundung).
- Fenster-Gitter statt um den Tipp zentriertes Fenster: auf dem Dev-Set gleich gut (Erfolg 56 % ↔ 56 %, IoU 0,52 ↔
  0,51; `tipp_dev_raster.json`). Ein dichteres 48-m-Gitter hätte ≈ 15 GB gebraucht.
- Der Dienst lädt beim Start SAM 2, Klassifikator, Gebäude, alle Laserzellen und Rasterdateien der Kacheln mit
  Embeddings und macht einen Probe-Tipp. Damit ist schon der erste echte Tipp schnell.
- Erste Messung ohne Vorladen der Laserzellen: 24 von 26 unter 1 s, Ausreißer bis 2,3 s (Lesen von der Platte).
  Danach: 26 von 26.

## Grenzen
- Gemessen im Container mit warmem Datei-Cache. Nach einem Neustart des Rechners dauert der Dienst-Start länger
  (Import und SAM laden ≈ 40 s, gemessen am 09.10.), die Tipps selbst nicht.
- Nur Kacheln mit Embeddings sind schnell. Fröschau 41 liegt in **699_5486**, die wird ebenfalls vorberechnet.
  Für jede weitere 1 × 1 km-Kachel kommen ≈ 4 GB und ≈ 12–14 min dazu (nicht je 2 × 2 km; Abgleich in tipp_bedarf.md).
- Rechenzeit Server-seitig gemessen. Dazu kommt in der App die Netzlaufzeit (im WLAN vernachlässigbar, im Mobilfunk ≈ 0,1–0,3 s).

**Nachtrag 09.10.2026 – Kachel 699_5486 (Fröschau 41):** Embeddings ebenfalls vorberechnet (484 Fenster, 739 s, 4,06 GB;
Prüfung live ↔ vorberechnet: 14 Tipps, IoU Median 1,000, Minimum 0,988). Mit beiden Kacheln dauert der Dienst-Start
24 s (mehr Laserzellen vorgeladen). Tipp auf das Gartenhaus Fröschau 41 (UTM 699357 / 5486729): erster Tipp 1,0 s
(knapp an der Grenze), danach 0,72 s und 0,71 s, jeweils „vorberechnet“.
