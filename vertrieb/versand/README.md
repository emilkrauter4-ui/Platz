# Serienversand (Anfrage um Einschätzung)

Schickt die Anfrage einzeln personalisiert aus **deinem** Postfach. Standardmäßig passiert nichts Echtes (Trockenlauf).

## Vor dem ersten Versand (alles muss stimmen)

1. Rechtscheck gemacht (`../versand_checkliste.md`, Abschnitt 1). Das Skript ersetzt ihn nicht.
2. `../konfig.json` vollständig ausgefüllt (Skript bricht sonst ab). Optional `WETTBEWERB` ergänzen, z. B. `" (z. B. dem XY-Gründerpreis)"`, **nur wenn du wirklich teilnimmst**; sonst leer lassen.
3. Absender: bevorzugt eine Adresse auf **eigener Domain** (SPF/DKIM/DMARC gesetzt). Mit einer privaten Gmail-Adresse geht es technisch auch, aber die Spam-Quote ist höher und Google kann das Konto bei Massenversand sperren.
4. SMTP-Zugang (Passwort nie in eine Datei schreiben, nur in die Sitzung):

```powershell
$env:SMTP_HOST = "smtp.gmail.com"      # oder der Server deines Anbieters
$env:SMTP_PORT = "465"
$env:SMTP_USER = "deine@adresse.de"
$env:SMTP_PASS = "App-Passwort"       # bei Gmail: Konto > Sicherheit > 2-Schritt-Bestätigung > App-Passwörter
```

5. Empfänger: `empfaenger.beispiel.csv` nach `empfaenger.csv` kopieren und je Zeile ausfüllen:

| Spalte | Inhalt |
|---|---|
| id, firma | wie im Tracker |
| gruss | „Guten Tag Frau Meier,“ oder allgemein „Guten Tag,“ |
| email | **nur** Adressen, die öffentlich auf der Website/im Impressum stehen |
| quelle | Wo du die Adresse her hast, z. B. „dem Impressum auf www.firma.de“ (Pflicht) |
| fassung | A (Shop/Hersteller) oder B (Fachhändler) |
| freigabe | `ja`, **erst wenn du Adresse und Quelle selbst geprüft hast** |
| gesendet, erinnert, antwort, abgemeldet | trägt das Skript bzw. du ein |

Diese Datei enthält personenbezogene Daten: nicht ins Git, nicht weitergeben (ist in `.gitignore`).

## Ablauf (PowerShell, im Ordner `vertrieb\versand`)

```powershell
python versand.py --test deine@privat.de --senden   # eine Testmail an dich selbst: Aussehen, Umlaute, Spam-Ordner prüfen
python versand.py                                    # Trockenlauf: zeigt Anzahl, übersprungene Zeilen und die erste Mail
python versand.py --senden --max 10                  # die ersten Tage: 10 Mails
python versand.py --senden                           # danach höchstens 25 pro Tag
python versand.py --stufe erinnerung --senden        # frühestens 7 Tage nach der Anfrage, nur ohne Antwort
```

Pause zwischen den Mails zufällig 90 bis 240 Sekunden (`--pause 90-240`); 25 Mails dauern also gut eine Stunde. Das Fenster offen lassen.

## Nach dem Versand, täglich

- Antworten lesen und **sofort** beantworten. In `empfaenger.csv` Spalte `antwort` mit Datum füllen (dann bekommt die Person keine Erinnerung).
- „Bitte nicht mehr“: Adresse in `abmeldungen.txt` (eine Zeile) und in `empfaenger.csv` Spalte `abgemeldet`. Adresse nach Ablauf der Frist löschen.
- Rückläufer (Adresse existiert nicht): `abgemeldet` mit „unzustellbar“ eintragen.
- `versand_log.csv` zeigt jeden Versuch mit Fehlern.

## Was das Skript nicht kann

- Antworten erkennen: du pflegst die Spalte `antwort` selbst.
- Adressen finden oder prüfen.
- Rechtliches klären.
- Bei 3 Fehlern in Folge bricht es ab (z. B. falsches Passwort, gesperrtes Konto).
