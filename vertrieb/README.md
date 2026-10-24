# Vertriebspaket: Test mit Herstellern und Händlern

Ziel: **Meinungen einholen** von Anbietern von Gartenhäusern und Carports: Kommt das Problem vor, wäre eine Antwort im Shop hilfreich? Kein Verkauf, kein Pilot-Angebot (für Gründer-Pitches). **Ohne Marke** (Arbeitstitel „Platzcheck“, in `konfig.json` änderbar), mit **einem** kuratierten Beispiel statt dem ganzen Werkzeug.

## Was drin ist

| Teil | Wo | Zweck |
|---|---|---|
| Demo (Händler-Modus) | `app/src/haendler.ts`, Build `npm run build:haendler` | Fiktives Mustergrundstück, 5 Beispielmodelle mit Ampel, „Wo darf es hin?“, Prüfzeilen mit Herkunft. Kein Adressfeld, keine Wärmepumpe, kein Hausplan, keine Wortmarke, keine Fremdanfragen. |
| Video (45 s) | `landing/assets/demo.mp4`, Aufnahme-Skript `video/aufnahme.mjs` | Ablauf in 7 Schritten mit Untertiteln, ohne Ton |
| Landingseite | `landing/index.html` + Impressum/Datenschutz (Entwürfe) | Neutral, mit Video, Demo-Link, Pilot, FAQ |
| One-Pager | `landing/onepager.html` → PDF | Eine A4-Seite zum Anhängen oder Ausdrucken |
| Mails | `mails/` | Anfrage um Einschätzung (2 Fassungen), eine Erinnerung, andere Kanäle, Interview-Leitfaden mit Auswertung; zurückgestellt: Verkaufstexte in `mails/spaeter_verkauf/` |
| Kontakte | `kontakte/` | 27 Start-Ziele (ungeprüft), Tracker für 150, Recherche-Anleitung |
| Versand | `versand_checkliste.md` | Go/No-Go mit Rechtlichem, Technik, Versandregeln, Messung |
| Serienversand | `versand/` | Skript für personalisierte Einzelmails aus deinem Postfach (Trockenlauf als Standard, Freigabe je Empfänger, Tageslimit, Protokoll) |

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
- **Online stellen (kostenlos, ohne eigene Domain):** Der Ordner `vertrieb\ausgabe\seite` (rund 830 Dateien, 40 MB) ist eine reine statische Seite. Zwei einfache Wege:
  1. **Cloudflare Pages:** Konto anlegen (kostenlos), dann *Workers & Pages* > *Create* > *Pages* > *Upload assets*. Projektname **vorher** festlegen, z. B. `platzcheck-demo` (neutral, ohne „Passt“). Ordner `seite` hineinziehen, *Deploy*. Adresse: `https://platzcheck-demo.pages.dev/`, die Demo liegt unter `/demo/`.
  2. **Netlify:** `app.netlify.com/drop`, Ordner `seite` hineinziehen (Konto nötig, damit die Seite bleibt). Adresse: `https://<zufallsname>.netlify.app/`, Namen unter *Site settings* änderbar.
  Reihenfolge: Projektnamen festlegen, daraus `LANDING_URL` und `DEMO_URL` in `konfig.json` eintragen, `node vertrieb\bauen.mjs`, dann hochladen. Danach Demo und Video auf dem Handy testen.
  Nicht GitHub Pages nutzen: Es würde das Repository öffentlich machen und damit das ganze Werkzeug.
- **One-Pager als PDF:** `vertrieb\ausgabe\seite\onepager.html` im Chrome öffnen, Drucken, „Als PDF speichern“, Hintergrundgrafiken an. (Alternativ `node vertrieb\onepager.mjs` mit installiertem Playwright.)
- **Video neu aufnehmen** (nur wenn sich die Demo ändert): `video/aufnahme.mjs`, siehe Kopfkommentar.

## Ehrliche Grenzen der Demo

- Ein Teil der Prüflogik steckt im JavaScript der Seite. Wer will, kann es lesen. Die Demo zeigt aber nur das Prüfergebnis für ein Beispiel; Datenpipeline, Tipp-Erkennung, Hausplan und Starkregen sind darin nicht enthalten. Das Video ist das einzige vollständig geschützte Material.
- Die Demo läuft nur auf dem Mustergrundstück. Für ein echtes Händler-Modell braucht es dessen Maße (`PRODUKTE` in `app/src/haendler.ts`).
- Ladezeit im Mobilfunk **nicht gemessen** (rund 5 bis 6 MB komprimiert, der Cesium-Kern ist der Hauptanteil). Test auf einem echten Handy im Mobilfunknetz fehlt noch.
- Das Mustergrundstück liegt auf einer echten Wiese in Sulzbach-Rosenberg (amtliches Gelände und Luftbild, keine Hausnummer, keine Straße genannt). Grenze und Wohnhaus sind erfunden und als `Demo` gekennzeichnet.
- Regeln gelten für Bayern. Fachprüfung durch Bauamt oder Architekt steht aus.
- Beispielmodelle haben erfundene Namen und Maße.
