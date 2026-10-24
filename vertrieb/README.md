# Vertriebspaket: Test mit Herstellern und Händlern

Ziel: herausfinden, ob Anbieter von Gartenhäusern, Carports und Terrassendächern den Grundstücks-Check als Zusatz in ihrem Online-Shop wollen. **Ohne Marke** (Arbeitstitel „Platzcheck“, in `konfig.json` änderbar), mit **einem** kuratierten Beispiel statt dem ganzen Werkzeug.

## Was drin ist

| Teil | Wo | Zweck |
|---|---|---|
| Demo (Händler-Modus) | `app/src/haendler.ts`, Build `npm run build:haendler` | Fiktives Mustergrundstück, 5 Beispielmodelle mit Ampel, „Wo darf es hin?“, Prüfzeilen mit Herkunft. Kein Adressfeld, keine Wärmepumpe, kein Hausplan, keine Wortmarke, keine Fremdanfragen. |
| Video (45 s) | `landing/assets/demo.mp4`, Aufnahme-Skript `video/aufnahme.mjs` | Ablauf in 7 Schritten mit Untertiteln, ohne Ton |
| Landingseite | `landing/index.html` + Impressum/Datenschutz (Entwürfe) | Neutral, mit Video, Demo-Link, Pilot, FAQ |
| One-Pager | `landing/onepager.html` → PDF | Eine A4-Seite zum Anhängen oder Ausdrucken |
| Mails | `mails/` | 3 Erstmail-Fassungen, 2× Nachfassen, LinkedIn, Formular, Telefon, Einwände, Pilot-Angebot, Gesprächsleitfaden |
| Kontakte | `kontakte/` | 27 Start-Ziele (ungeprüft), Tracker für 150, Recherche-Anleitung |
| Versand | `versand_checkliste.md` | Go/No-Go mit Rechtlichem, Technik, Versandregeln, Messung |

## So gehst du vor (Windows PowerShell)

```powershell
cd C:\Users\HP\Platz
git pull
cd app
npm install
npm run build:haendler         # baut die Demo nach app\dist-haendler
cd ..
# 1) vertrieb\konfig.json ausfüllen (Name, Mail, Domain, ...)
node vertrieb\bauen.mjs        # erzeugt vertrieb\ausgabe\seite (Landing + Demo) und vertrieb\ausgabe\mails
```

- **Lokal ansehen:** `cd vertrieb\ausgabe\seite` und `npx serve .` (oder `python -m http.server 8080`), dann `http://localhost:8080/` und `.../demo/`.
- **Online stellen:** Ordner `vertrieb\ausgabe\seite` bei Cloudflare Pages (Direct Upload) oder Netlify (Drag & Drop) hochladen, eigene Domain verbinden. Reines Static-Hosting, kein Server nötig. Größe etwa 55 MB, rund 3.700 Dateien.
- **One-Pager als PDF:** `vertrieb\ausgabe\seite\onepager.html` im Chrome öffnen, Drucken, „Als PDF speichern“, Hintergrundgrafiken an. (Alternativ `node vertrieb\onepager.mjs` mit installiertem Playwright.)
- **Video neu aufnehmen** (nur wenn sich die Demo ändert): `video/aufnahme.mjs`, siehe Kopfkommentar.

## Ehrliche Grenzen der Demo

- Ein Teil der Prüflogik steckt im JavaScript der Seite. Wer will, kann es lesen. Die Demo zeigt aber nur das Prüfergebnis für ein Beispiel; Datenpipeline, Tipp-Erkennung, Hausplan und Starkregen sind darin nicht enthalten. Das Video ist das einzige vollständig geschützte Material.
- Die Demo läuft nur auf dem Mustergrundstück. Für ein echtes Händler-Modell braucht es dessen Maße (`PRODUKTE` in `app/src/haendler.ts`).
- Ladezeit im Mobilfunk **nicht gemessen** (rund 5 bis 6 MB komprimiert, der Cesium-Kern ist der Hauptanteil). Test auf einem echten Handy im Mobilfunknetz fehlt noch.
- Das Mustergrundstück liegt auf einer echten Wiese in Sulzbach-Rosenberg (amtliches Gelände und Luftbild, keine Hausnummer, keine Straße genannt). Grenze und Wohnhaus sind erfunden und als `Demo` gekennzeichnet.
- Regeln gelten für Bayern. Fachprüfung durch Bauamt oder Architekt steht aus.
- Beispielmodelle haben erfundene Namen und Maße.
