# Vertriebspaket: Meinungsumfrage mit Video

Ziel: **Meinungen einholen** von Anbietern von Gartenhäusern und Carports (kommt das Problem vor, wäre eine Antwort im Shop hilfreich?), für Gründer-Pitches. Kein Verkauf, kein Angebot. Gezeigt wird **nur ein 45-Sekunden-Video**, keine Demo zum Ausprobieren. Das Werkzeug bleibt bei dir.

## Was du brauchst

| Teil | Wo |
|---|---|
| Video | `video/demo.mp4` (Aufnahme-Skript `video/aufnahme.mjs`) |
| Mail-Texte | `mails/01_feedback_anfrage.md` (Fassung A/B), `02_erinnerung.md`, `03_andere_kanaele.md`, `04_interview_leitfaden.md` |
| Kontakte | `kontakte/` (27 ungeprüfte Start-Ziele, Tracker, Recherche-Anleitung) |
| Versandskript | `versand/` (optional, siehe dort) |
| Checkliste | `versand_checkliste.md` |
| Später, nur falls Interesse entsteht | `mails/spaeter_verkauf/`, `landing/` (Landingseite, One-Pager), `bauen.mjs`, Händler-Demo (`npm run build:haendler`) |

## Ablauf

1. **Video hochladen:** YouTube-Konto, *Video hochladen*, Sichtbarkeit **„Nicht gelistet“**, Titel neutral („Prototyp: Passt das Gartenhaus aufs Grundstück?“). Kommentare ausschalten, wenn du keine Moderation willst. Link kopieren. Alternative: Vimeo (Link-Zugriff).
2. **`konfig.json` ausfüllen:** Name, Firma bzw. „Einzelunternehmen“, Anschrift, Telefon, Mailadresse, `VIDEO_URL`, `WETTBEWERB` (nur wenn zutreffend).
3. **Empfänger sammeln** (`kontakte/recherche_anleitung.md`), zuerst 10 bis 20.
4. **Rechtscheck** (`versand_checkliste.md`).
5. **Versand:** entweder von Hand aus `mails/01_feedback_anfrage.md`, mit Entwürfen in Gmail (über Claude) oder mit dem Skript `versand/` (`versand/README.md`).
6. **Antworten** auswerten (`mails/04_interview_leitfaden.md`).

Vom Video aus gesehen entfallen: eigene Seite, Impressum, Datenschutzerklärung der Seite, Hosting. Die Mail selbst braucht weiterhin Absenderangaben und den Hinweis zur Herkunft der Adresse.

## Das Video neu aufnehmen (nur wenn sich die App ändert)

```powershell
cd app
node scripts/haendler-build.mjs --debug          # Aufnahme-Build
node scripts/serve.mjs 4181 dist-haendler-debug  # in einem zweiten Fenster
cd ..
node vertrieb/video/aufnahme.mjs vertrieb/video/ausgabe
```
Voraussetzungen: Playwright, ffmpeg. Das Video entsteht Bild für Bild und sieht immer gleich aus.

## Ehrliche Grenzen

- Das Video zeigt ein **fiktives Grundstück und Wohnhaus** (Label „Demo“) auf einer echten Wiese mit amtlichem Gelände und Luftbild. Modelle und Maße sind erfunden.
- Regeln gelten für Bayern. Eine Fachprüfung durch Bauamt oder Architekt steht aus.
- Das Video verspricht keine Wirkung („weniger Rückfragen“); es zeigt eine Idee und fragt nach der Einschätzung.
