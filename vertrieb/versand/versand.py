#!/usr/bin/env python3
"""
Serienversand der Anfrage um eine Einschätzung (siehe ../mails/01_feedback_anfrage.md), einzeln personalisiert.

Sicherheitsvorkehrungen:
  - Ohne --senden passiert NICHTS Echtes: Der Lauf zeigt nur, was versendet würde (Trockenlauf).
  - Es gehen nur Zeilen raus, bei denen Spalte "freigabe" = ja steht (du hast Adresse und Quelle selbst geprüft).
  - Jede Adresse höchstens einmal je Stufe; Adressen aus abmeldungen.txt und Zeilen mit "antwort"/"abgemeldet" werden übersprungen.
  - Höchstens --max Mails pro Lauf (Standard 25), zufällige Pause zwischen den Mails (Standard 90-240 s).
  - Bricht nach 3 Fehlern in Folge ab. Jeder Versand wird in versand_log.csv protokolliert und in empfaenger.csv eingetragen.
  - Reintext, kein Tracking-Pixel, ein Empfänger je Mail.

Zugang über Umgebungsvariablen (Passwort nie in eine Datei schreiben):
  SMTP_HOST (z. B. smtp.gmail.com), SMTP_PORT (465), SMTP_USER, SMTP_PASS (bei Gmail: App-Passwort), ABSENDER_MAIL (optional)
Aufruf:
  python versand.py                      Trockenlauf Stufe 1 (Anfrage)
  python versand.py --senden             echter Versand Stufe 1
  python versand.py --stufe erinnerung   Trockenlauf Erinnerung (nur wenn >= 7 Tage seit der Anfrage, keine Antwort)
  python versand.py --test mich@example.de --senden   schickt EINE Testmail an dich selbst (Vorlage A, erste Zeile der CSV)
"""
import argparse, csv, os, random, re, smtplib, ssl, sys, time
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path

HIER = Path(__file__).resolve().parent
KONFIG = Path(os.environ.get("KONFIG_PFAD", HIER.parent / "konfig.json"))
CSV_PFAD = Path(os.environ.get("CSV_PFAD", HIER / "empfaenger.csv"))
LOG = Path(os.environ.get("LOG_PFAD", HIER / "versand_log.csv"))


def lies_konfig():
    import json
    k = json.loads(KONFIG.read_text(encoding="utf-8"))
    k.pop("_hinweis", None)
    k.setdefault("WETTBEWERB", "")
    pflicht = ["ABSENDER_NAME", "ABSENDER_MAIL", "ABSENDER_TEL", "VIDEO_URL"]
    offen = [n for n in pflicht if n not in k or "{{" in str(k[n])]
    if offen:
        sys.exit("konfig.json ist nicht ausgefüllt: " + ", ".join(offen))
    return k


def lade_vorlage(name):
    t = (HIER / "vorlagen" / f"{name}.txt").read_text(encoding="utf-8")
    kopf, _, rumpf = t.partition("\n\n")
    return kopf.replace("Betreff:", "", 1).strip(), rumpf.strip() + "\n"


def fuelle(text, werte):
    def r(m):
        k = m.group(1)
        if k not in werte or werte[k] in (None, ""):
            if k == "WETTBEWERB":
                return ""
            raise KeyError(k)
        return werte[k]
    return re.sub(r"\{([A-Z_]+)\}", r, text)


def lies_csv():
    if not CSV_PFAD.exists():
        sys.exit(f"{CSV_PFAD.name} fehlt. Kopiere empfaenger.beispiel.csv nach empfaenger.csv und trage deine Empfänger ein.")
    with open(CSV_PFAD, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f, delimiter=";"))


def schreibe_csv(zeilen):
    with open(CSV_PFAD, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(zeilen[0].keys()), delimiter=";")
        w.writeheader()
        w.writerows(zeilen)


def abmeldungen():
    p = Path(os.environ.get("ABM_PFAD", HIER / "abmeldungen.txt"))
    if not p.exists():
        return set()
    return {z.strip().lower() for z in p.read_text(encoding="utf-8").splitlines() if z.strip() and not z.startswith("#")}


def gueltig(adr):
    return re.fullmatch(r"[^@\s;,]+@[^@\s;,]+\.[A-Za-z]{2,}", adr or "") is not None


def baue(konfig, zeile, vorlage, betreff_original=None):
    betreff, rumpf = lade_vorlage(vorlage)
    werte = {**konfig, "FIRMA": zeile["firma"], "GRUSS": zeile["gruss"], "QUELLE": zeile["quelle"],
             "BETREFF_ORIGINAL": betreff_original or ""}
    msg = EmailMessage()
    msg["Subject"] = fuelle(betreff, werte)
    absender = os.environ.get("ABSENDER_MAIL") or konfig["ABSENDER_MAIL"]
    msg["From"] = f'{konfig["ABSENDER_NAME"]} <{absender}>'
    msg["To"] = zeile["email"]
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=absender.split("@")[-1])
    msg["Reply-To"] = absender
    msg.set_content(fuelle(rumpf, werte))
    return msg


def smtp_verbinden():
    host, user, pw = os.environ.get("SMTP_HOST"), os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASS")
    if not (host and user and pw):
        sys.exit("SMTP_HOST, SMTP_USER und SMTP_PASS müssen als Umgebungsvariablen gesetzt sein.")
    port = int(os.environ.get("SMTP_PORT", "465"))
    if os.environ.get("SMTP_SSL", "1") == "0":  # nur für Tests mit lokalem Server
        s = smtplib.SMTP(host, port, timeout=30)
    else:
        s = smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=30)
    s.login(user, pw)
    return s


def logge(zeile, stufe, betreff, ok, fehler=""):
    neu = not LOG.exists()
    with open(LOG, "a", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        if neu:
            w.writerow(["zeit", "id", "email", "stufe", "betreff", "ok", "fehler"])
        w.writerow([datetime.now().isoformat(timespec="seconds"), zeile["id"], zeile["email"], stufe, betreff, ok, fehler])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--senden", action="store_true", help="wirklich senden (ohne: Trockenlauf)")
    ap.add_argument("--stufe", choices=["anfrage", "erinnerung"], default="anfrage")
    ap.add_argument("--max", type=int, default=25)
    ap.add_argument("--pause", default="90-240", help="Sekunden zwischen Mails, z. B. 90-240")
    ap.add_argument("--test", metavar="ADRESSE", help="eine Testmail an diese Adresse (Vorlage A, erste Zeile)")
    a = ap.parse_args()
    konfig = lies_konfig()
    zeilen = lies_csv()
    lo, hi = (int(x) for x in a.pause.split("-"))

    if a.test:
        z = {**zeilen[0], "email": a.test}
        msg = baue(konfig, z, "anfrage_A")
        print(f"TEST an {a.test}\nBetreff: {msg['Subject']}\n\n{msg.get_content()}")
        if a.senden:
            with smtp_verbinden() as s:
                s.send_message(msg)
            print("Testmail gesendet.")
        return

    gesperrt = abmeldungen()
    kandidaten, uebersprungen = [], []
    for z in zeilen:
        grund = None
        if z["freigabe"].strip().lower() != "ja":
            grund = "keine Freigabe"
        elif not gueltig(z["email"]):
            grund = "Adresse ungültig"
        elif z["email"].strip().lower() in gesperrt or z["abgemeldet"].strip() or z["antwort"].strip():
            grund = "abgemeldet oder hat geantwortet"
        elif not z["quelle"].strip():
            grund = "Quelle der Adresse fehlt (Pflicht für die Datenschutz-Information)"
        elif a.stufe == "anfrage" and z["gesendet"].strip():
            grund = "Anfrage schon gesendet"
        elif a.stufe == "erinnerung":
            if not z["gesendet"].strip():
                grund = "noch keine Anfrage gesendet"
            elif z["erinnert"].strip():
                grund = "Erinnerung schon gesendet"
            elif date.fromisoformat(z["gesendet"]) > date.today() - timedelta(days=7):
                grund = "weniger als 7 Tage seit der Anfrage"
        if grund:
            uebersprungen.append((z["id"], z["firma"], grund))
        else:
            kandidaten.append(z)
    kandidaten = kandidaten[: a.max]

    print(f"{len(kandidaten)} zu senden, {len(uebersprungen)} übersprungen")
    for i, f, g in uebersprungen:
        print(f"  übersprungen {i} {f}: {g}")
    if not kandidaten:
        return
    vorlage = lambda z: ("anfrage_" + z["fassung"].strip().upper()) if a.stufe == "anfrage" else "erinnerung"

    if not a.senden:
        print("\nTROCKENLAUF – es wird nichts gesendet. Erste Mail zur Ansicht:\n" + "-" * 60)
        z = kandidaten[0]
        betreff_o = lade_vorlage("anfrage_" + z["fassung"].strip().upper())[0]
        m = baue(konfig, z, vorlage(z), fuelle(betreff_o, {**konfig, "FIRMA": z["firma"]}))
        print(f"An: {m['To']}\nBetreff: {m['Subject']}\n\n{m.get_content()}")
        print("-" * 60 + "\nZum echten Versand denselben Befehl mit --senden wiederholen.")
        return

    fehler_folge = 0
    with smtp_verbinden() as s:
        for n, z in enumerate(kandidaten):
            betreff_o = lade_vorlage("anfrage_" + z["fassung"].strip().upper())[0]
            msg = baue(konfig, z, vorlage(z), fuelle(betreff_o, {**konfig, "FIRMA": z["firma"]}))
            try:
                s.send_message(msg)
                fehler_folge = 0
                z["gesendet" if a.stufe == "anfrage" else "erinnert"] = date.today().isoformat()
                logge(z, a.stufe, msg["Subject"], True)
                print(f"gesendet {z['id']} {z['email']}")
            except Exception as e:  # noqa: BLE001
                fehler_folge += 1
                logge(z, a.stufe, msg["Subject"], False, str(e))
                print(f"FEHLER {z['id']}: {e}")
                if fehler_folge >= 3:
                    print("3 Fehler in Folge, Abbruch.")
                    break
            schreibe_csv(zeilen)
            if n < len(kandidaten) - 1:
                time.sleep(random.randint(lo, hi))
    print("Fertig. Antworten und Abmeldungen trägst du in empfaenger.csv / abmeldungen.txt ein.")


if __name__ == "__main__":
    main()
