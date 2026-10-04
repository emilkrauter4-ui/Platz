# „Wo darf es hin?“ – Rechenzeit (Phase 2.1)

Gemessen am 4. Oktober 2026 im gebauten App-Stand (`npm run build && npm run serve`), Chromium 141 headless im
Cloud-Container (4 vCPU, SwiftShader), Gartenhaus 3 × 3 m, Raster 0,25 m, Web Worker. Erster Lauf je Grundstück
enthält das Aufwärmen der JavaScript-Engine. „gesamt“ = Anfrage bis Ergebnis im UI-Thread.

| Grundstück | Fläche | Prüfungen | 1. Lauf | Folgeläufe (gesamt) |
|---|---|---|---|---|
| Fröschau 41 (Demo „grenze“) | 906 m² | 34 788 | 295 ms | 181–231 ms |
| Am Schützenheim 3 (Demo „hang“) | 703 m² | 22 692 | 359 ms | 235–338 ms |
| Test-Grundstück `demoSite()` (Vitest, Node) | ≈ 600 m² | 7 118 | – | 89 ms |

- **Ziel < 300 ms auf einem iPhone: nicht nachgewiesen.** Im Container liegen Folgeläufe bei 180–340 ms. Ein
  iPhone ließ sich hier nicht messen; die CPU-Drosselung von Chromium (Emulation.setCPUThrottlingRate) wirkt nicht
  auf Web Worker, die Werte mit „×4“ waren deshalb gleich und sind nicht verwertbar. Die App zeigt die Zeit klein
  unter der Legende an („(212 ms)“), damit sie auf dem Gerät abgelesen werden kann.
- Genauigkeit: In `test/zonen.test.ts` wird jede der 9184 Zellen des Test-Grundstücks einzeln mit `evaluate()`
  nachgeprüft – 0 Abweichungen (grün ⇔ „Passt so“); jede gelbe Zelle passt mit der angegebenen Drehung.
- Was die Zeit kostet: rote Zellen probieren alle Ausrichtungen (aktuelle, parallel zu jeder Grenze, 45°-Schritte).
  Nächste Hebel, falls das iPhone zu langsam ist: gröberes Startraster (2 m), Abbruch bei sicherem Rot,
  Speicherbereinigung (viele kleine Arrays je Prüfung).
