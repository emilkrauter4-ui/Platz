#!/usr/bin/env python3
"""Prüfmappe für Fachpersonen (Bauamt, Architekt, Jurist): jede Regel aus app/src/rules/limits.json mit Gesetzestext
(Auszug aus docs/recht/), Link zum amtlichen Text, unserer Auslegung, einem Beispielfall und Feldern
„korrekt / falsch / Anmerkung“. Danach gezielte Fragen zu offenen Auslegungen.

Ausgabe: docs/pruefmappe/pruefmappe.html (und mit pruefmappe_pdf.mjs → pruefmappe.pdf)
Aufruf:  python3 pipeline/16_pruefmappe.py && node pipeline/pruefmappe_pdf.mjs
"""
from __future__ import annotations

import hashlib
import html
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIMITS = ROOT / "app" / "src" / "rules" / "limits.json"
RECHT = ROOT / "docs" / "recht"
AUS = ROOT / "docs" / "pruefmappe"

GB = "https://www.gesetze-bayern.de/Content/Document/"
LINKS = {
    "BayBO-6": GB + "BayBO-6", "BayBO-55": GB + "BayBO-55", "BayBO-57": GB + "BayBO-57", "BayBO-58": GB + "BayBO-58",
    "BayBO-59": GB + "BayBO-59", "BayBO-61": GB + "BayBO-61", "BayBO-63": GB + "BayBO-63", "BayBO-64": GB + "BayBO-64",
    "BayBO-66": GB + "BayBO-66",
    **{f"AGBGB-{n}": GB + f"BayAGBGB-{n}" for n in range(47, 53)},
    "BauVorlV-2": GB + "BayBauVorlV2008-2", "BauVorlV-3": GB + "BayBauVorlV2008-3", "BauVorlV-7": GB + "BayBauVorlV2008-7",
    "GaStellV-1": GB + "BayGaStellV-1",
    "TA-Laerm": "https://www.verwaltungsvorschriften-im-internet.de/bsvwvbund_26081998_IG19980826.htm",
    "LAI": "https://www.lai-immissionsschutz.de/Veroeffentlichungen-67.html",
    "BGH": "https://juris.bundesgerichtshof.de/cgi-bin/rechtsprechung/list.py?Gericht=bgh&Art=en (Az. V ZR 230/16)",
    "KEYMARK": "https://www.heatpumpkeymark.com",
    "STMB": "https://www.stmb.bayern.de/buw/baurechtundtechnik/digitaler_bauantrag/index.php",
    "BayBO-4": GB + "BayBO-4", "BayBO-5": GB + "BayBO-5", "BayBO-71": GB + "BayBO-71",
    "BauGB-30": "https://www.gesetze-im-internet.de/bbaug/__30.html", "BauGB-34": "https://www.gesetze-im-internet.de/bbaug/__34.html",
    "BauGB-35": "https://www.gesetze-im-internet.de/bbaug/__35.html", "BauGB-246e": "https://www.gesetze-im-internet.de/bbaug/__246e.html",
    "Feuerwehr": "https://www.bauministerium.bayern.de/assets/stmi/buw/baurechtundtechnik/27_richtlinie-flaechen-feuerwehr.pdf",
}


# ------------------------------------------------------------------ Gesetzestexte aus docs/recht

def _lesen(name: str) -> list[str]:
    return [z.rstrip() for z in (RECHT / name).read_text(encoding="utf-8").splitlines() if not z.startswith("#")]


def art6(absatz: str, nur: tuple[int, ...] | None = None) -> str:
    """BayBO Art. 6, ein Absatz; Satznummern stehen in eigenen Zeilen. nur = Satznummern (sonst alle)."""
    z = _lesen("BayBO_Art6.txt")
    i = z.index(f"({absatz})")
    j = next((k for k in range(i + 1, len(z)) if re.fullmatch(r"\(\d+a?\)", z[k].strip())), len(z))
    saetze, akt = {}, 1  # ohne vorangestellte Nummer ist es Satz 1
    for t in z[i + 1:j]:
        t = t.strip()
        if re.fullmatch(r"\d+", t):
            akt = int(t)
            continue
        saetze.setdefault(akt, []).append(t)
    mehrere = len(saetze) > 1
    teile = [f"<sup>{n}</sup>{' '.join(v)}" if mehrere else " ".join(v) for n, v in saetze.items() if not nur or n in nur]
    return f"Art. 6 Abs. {absatz}: " + " ".join(teile)


def agbgb(art: int, absatz: int | None = None) -> str:
    z = _lesen("AGBGB_Art47-52.txt")
    i = next(k for k, t in enumerate(z) if t.startswith(f"Art. {art} "))
    j = next((k for k in range(i + 1, len(z)) if re.match(r"Art\. \d+ ", z[k])), len(z))
    block = " ".join(t.strip() for t in z[i:j] if t.strip() and not t.strip().startswith("[") and not t.strip().startswith("(Abs."))
    if absatz:
        m = re.search(rf"\({absatz}\)(.*?)(?=\(\d\)|$)", block)
        block = f"{z[i].strip()} – ({absatz}){m.group(1)}" if m else block
    return re.sub(r"(?<=[ .])(\d)(?=[A-ZÄÖÜ])", r"<sup>\1</sup>", block)


def verf(kopf: str) -> str:
    z = (RECHT / "BayBO_Verfahren_BauVorlV.txt").read_text(encoding="utf-8").split("\n## ")
    teil = next(t for t in z if t.startswith(kopf))
    titel, *rest = teil.split("\n")
    return f"{titel}: " + " ".join(r.strip() for r in rest if r.strip())


def art57(teil: str) -> str:
    z = [t.strip() for t in _lesen("BayBO_Art57.txt") if t.strip()]
    s = " ".join(z)
    if teil == "a":
        return "Art. 57 Abs. 1 Nr. 1 Buchst. a: " + re.search(r"a\) (.*?), b\)", s).group(1)
    if teil == "b":
        return "Art. 57 Abs. 1 Nr. 1 Buchst. b: " + re.search(r"b\) (Garagen.*?Außenbereich),", s).group(1)
    if teil == "10a":
        return "Art. 57 Abs. 1 Nr. 10 Buchst. a: folgende Anlagen in Gärten und zur Freizeitgestaltung: a) Schwimmbecken einschließlich dazugehöriger temporärer luftgetragener Überdachungen, außer im Außenbereich"
    return "Art. 57 Abs. 1 Nr. 2: folgende Anlagen der technischen Gebäudeausrüstung: … b) sonstige Anlagen der technischen Gebäudeausrüstung"


def _ein_absatz(name: str) -> str:
    return " ".join(t.strip() for t in _lesen(name) if t.strip())


def baybo_art(nr: int, von: str | None = None, bis: str | None = None) -> str:
    """BayBO Art. 4/5/71 aus docs/recht/BayBO_Art4_5_71.txt: ganzer Artikel oder Ausschnitt zwischen zwei Textmarken."""
    s = _ein_absatz("BayBO_Art4_5_71.txt")
    i = s.index(f"Art. {nr} ")
    j = s.find(f"Art. {nr + 1} ", i + 1) if nr < 71 else len(s)
    t = s[i:len(s) if j < 0 else j].strip()
    if von:
        a = t.index(von)
        b = t.index(bis, a) if bis else len(t)
        t = f"Art. {nr} " + t[a:b].strip()
    return html.escape(t, quote=False)


def baugb(par: int | str, von: str | None = None, bis: str | None = None) -> str:
    """BauGB-Auszug aus docs/recht/BauGB_34_246e.txt: der Paragraf (alle Zeilen bis zum nächsten „§ “ am Zeilenanfang)."""
    z = [t.strip() for t in _lesen("BauGB_34_246e.txt") if t.strip()]
    i = next(k for k, t in enumerate(z) if t.startswith(f"§ {par} "))
    j = next((k for k in range(i + 1, len(z)) if z[k].startswith("§ ")), len(z))
    t = " ".join(z[i:j])
    if von:
        a = t.index(von)
        b = t.index(bis, a) if bis else len(t)
        t = f"§ {par} BauGB " + t[a:b].strip()
    return html.escape(t.strip(), quote=False)


def feuerwehr(nr: int) -> str:
    z = [t.strip() for t in _lesen("Feuerwehr_Flaechen_Richtlinie.txt") if t.strip()]
    t = next(x for x in z if x.startswith(f"{nr} "))
    return "Richtlinie über Flächen für die Feuerwehr (Muster, Fassung 02/2007) Nr. " + html.escape(t, quote=False)


def ta_laerm() -> str:
    z = [t.strip() for t in _lesen("TA_Laerm_6_1.txt") if t.strip()]
    return "TA Lärm Nr. " + " ".join(z)


# ------------------------------------------------------------------ je Regel: Text, Link, Umsetzung, Beispiel

KEIN = "Kein Gesetzestext – Festlegung oder Annahme von Passt."

R: dict[str, dict] = {
    "gartenhaus.maxBruttoRauminhaltM3": dict(
        text=lambda: art57("a"), link="BayBO-57",
        umsetzung="Gartenhaus im Innenbereich bis 75,0 m³ (einschließlich) → verfahrensfrei. Rauminhalt = Breite × Tiefe × Wandhöhe + Dachraum (Satteldach als halbes Prisma). Bis 04.10.2026 rechnete Passt. nach älterem Wortlaut: mit Aufenthaltsraum → Genehmigung.",
        beispiel="Gartenhaus 4 × 3 m, Wandhöhe 2,3 m, Satteldach 25° (First entlang 4 m): Dachhöhe 1,5 × tan 25° = 0,70 m → 27,6 + 4,2 = 31,8 m³ → verfahrensfrei. 5 × 6 m, 2,5 m Wandhöhe, Flachdach: 75,0 m³ → gerade noch verfahrensfrei; 76 m³ → rot."),
    "gartenhaus.aussenbereichMaxM3": dict(
        text=lambda: art57("a"), link="BayBO-57",
        umsetzung="Außenbereich (Nutzerangabe oder Annahme) → immer rot „Passt. kann das nicht freigeben“, mit Hinweis auf die 20-m³-Regel. Die Zulässigkeit nach § 35 BauGB prüft Passt. nicht.",
        beispiel="Geräteschuppen 2 × 2 × 2 m (8 m³) im Außenbereich, ohne Aufenthaltsraum: laut Wortlaut verfahrensfrei – Passt. zeigt trotzdem rot und verweist ans Bauamt."),
    "gartenhaus.aufenthaltsraumNurArt6": dict(
        text=lambda: art57("a") + "<br>" + art6("7", (1,)), link="BayBO-57",
        umsetzung="Innenbereich, Aufenthaltsraum oder Feuerstätte: nicht mehr „Genehmigung nötig“, sondern gelb (Feuerstätte, Abgasanlage, Brandschutz nicht geprüft). Kein Privileg nach Art. 6 Abs. 7: eigene Abstandsflächen, nicht an der Grenze (rot).",
        beispiel="Gartenhaus 3 × 3 m mit Holzofen, 6 m von allen Grenzen: gelb, „verfahrensfrei“. Dasselbe 0,3 m an der Grenze: rot „Mit Aufenthaltsraum oder Feuerstätte nicht so nah an die Grenze“."),
    "gartenhaus.dachraumImRauminhalt": dict(
        text=lambda: art57("a"), link="BayBO-57",
        umsetzung="Der Dachraum zählt zum Brutto-Rauminhalt (Satteldach als halbes Prisma). Gemessen ab Oberkante Fußboden, Außenmaße; Bodenplatte und Dachüberstand bleiben unberücksichtigt.",
        beispiel="4 × 4 m, Wand 2,4 m, Satteldach 40°: Dachhöhe 2 × tan 40° = 1,68 m → 38,4 + 13,4 = 51,8 m³."),
    "carport.maxFlaecheM2": dict(
        text=lambda: art57("b"), link="BayBO-57",
        umsetzung="Carport bis 50,0 m² Grundfläche (Breite × Tiefe des Objekts) → verfahrensfrei, außer im Außenbereich.",
        beispiel="Doppelcarport 6 × 8 m = 48 m² → verfahrensfrei; 6 × 9 m = 54 m² → rot, Bauantrag (Kleingarage)."),
    "abstand.faktorH": dict(
        text=lambda: art6("5", (1,)), link="BayBO-6",
        umsetzung="Tiefe = max(0,4 · H, 3 m) je Wand. Gemeindliche Satzungen werden nicht berücksichtigt (Hinweis in der App).",
        beispiel="Wand H = 10 m → 4,0 m. Wand H = 6 m → 2,4 m → es gilt das Minimum 3 m."),
    "abstand.minM": dict(
        text=lambda: art6("5", (1,)), link="BayBO-6",
        umsetzung="Mindesttiefe 3,00 m; genau 3,00 m Abstand gilt als eingehalten.",
        beispiel="Gartenhaus mit 3,2 m Wandhöhe, Wand genau 3,00 m von der Grenze → eingehalten."),
    "abstand.dachVollAbGrad": dict(
        text=lambda: art6("4"), link="BayBO-6",
        umsetzung="H = Wandhöhe + Dachhöhe/3 bis einschließlich 70°, darüber + volle Dachhöhe.",
        beispiel="Traufe 6 m, Dachhöhe 4,5 m, 45°: H = 7,5 m → T = 3,0 m. Gleiche Dachhöhe bei 75°: H = 10,5 m → T = 4,2 m."),
    "abstand.giebelAlsDach": dict(
        text=lambda: art6("4"), link="BayBO-6",
        umsetzung="Giebelwand: Giebeldreieck wie Dach zu einem Drittel (bis 70°). Im Ergebnis als „offen“ markiert. Siehe Frage 1.",
        beispiel="Gartenhaus 4 m breit, Wand 2,2 m, Satteldach 30°: Giebelhöhe 2 × tan 30° = 1,15 m → H = 2,2 + 0,38 = 2,58 m → T = 3 m (Minimum)."),
    "abstand.ueberdeckungWinkelGrad": dict(
        text=lambda: art6("3"), link="BayBO-6",
        umsetzung="Abstandsflächen von Gartenhaus/Carport (wenn nicht privilegiert) und Wohnhaus (aus LoD2) dürfen sich nicht überdecken; ausgenommen Wände mit Winkel > 75°.",
        beispiel="Gartenhaus 3,5 m Wandhöhe, 2 m vor der Hauswand und parallel dazu → Überdeckung → rot. Gleiches Gartenhaus über Eck (90°) → zulässig."),
    "abstand.eigenesGrundstueck": dict(
        text=lambda: art6("2"), link="BayBO-6",
        umsetzung="Abstandsfläche muss auf dem eigenen Grundstück liegen. Öffentliche Flächen bis zur Mitte: nicht geprüft (Hinweis „offen“). Zustimmung des Nachbarn: Hinweis im Ergebnis.",
        beispiel="Gartenhaus mit 3,5 m mittlerer Wandhöhe, 2 m von der Grenze: T = 3 m → 1 m reicht aufs Nachbargrundstück → rot."),
    "abstand.faktorHGewerbe": dict(
        text=lambda: art6("5", (1,)), link="BayBO-6",
        umsetzung="Nicht verwendet: Passt. bietet nur Wohn- und Mischgebiete an.",
        beispiel="–"),
    "abstand.waermepumpeOhneAbstandsflaecheBisM": dict(
        text=lambda: art6("1", (2, 3)), link="BayBO-6",
        umsetzung="Wärmepumpe bis 2,00 m Höhe: keine Abstandsfläche. Darüber: Hinweis „Abstandsfläche nötig – nicht geprüft“ (offen).",
        beispiel="Außengerät 1,3 m hoch, 0,5 m von der Grenze → keine Abstandsfläche nötig (Lärm wird getrennt geprüft)."),
    "grenzbebauung.maxMittlereWandhoeheM": dict(
        text=lambda: art6("7", (1,)), link="BayBO-6",
        umsetzung="Mittlere Wandhöhe über Gelände aus DGM1 (nicht über Nullniveau), bis einschließlich 3,00 m.",
        beispiel="Gartenhaus Flachdach, an der Grenze, Gelände fällt 0,4 m: Wand 2,8 m bergseitig, 3,2 m talseitig → Mittel 3,0 m → erlaubt. Mittel 3,1 m → rot."),
    "grenzbebauung.maxLaengeJeSeiteM": dict(
        text=lambda: art6("7", (1,)), link="BayBO-6",
        umsetzung="Summe der Längen an einer Grundstücksseite (neue Objekte + Bestand), bis einschließlich 9,00 m. Als „an der Grenze“ zählt, was näher steht als seine erforderliche Abstandsflächentiefe.",
        beispiel="Bestehende Garage 6 m an der Ostgrenze + neues Gartenhaus 3 m → 9,0 m → erlaubt. Gartenhaus 4 m → 10 m → rot."),
    "grenzbebauung.maxLaengeGesamtM": dict(
        text=lambda: art6("7", (2,)), link="BayBO-6",
        umsetzung="Summe an allen Grenzen bis einschließlich 15,00 m.",
        beispiel="9 m an der Ostgrenze + 7 m an der hinteren Grenze = 16 m → rot."),
    "grenzbebauung.dachDrittelAbGrad": dict(
        text=lambda: art6("7", (1,)), link="BayBO-6",
        umsetzung="Bei der mittleren Wandhöhe: Dach bis 45° nicht, über 45° zu einem Drittel, über 70° voll. Giebelflächen bei Dächern über 45° als „offen“ markiert (Frage 2).",
        beispiel="Wand 2,4 m, Dach 50°, Dachhöhe 1,5 m → 2,4 + 0,5 = 2,9 m → erlaubt (Giebel offen)."),
    "grenzbebauung.ohneEigeneAbstandsflaeche": dict(
        text=lambda: art6("7", (1,)), link="BayBO-6",
        umsetzung="Privilegierte Nebengebäude (ohne Aufenthaltsraum/Feuerstätte, mittlere Wandhöhe ≤ 3 m) brauchen keine eigene Abstandsfläche und dürfen in Abstandsflächen des Hauses stehen.",
        beispiel="Gartenhaus 2,5 m Wandhöhe, 1,5 m vor der Hauswand → erlaubt (grau dargestellte Abstandsfläche)."),
    "bestand.gebaeudeKlassen": dict(
        text=lambda: art6("7", (1, 2)), link="BayBO-6",
        umsetzung="Bei der Grenzlänge zählen erkannte oder eingezeichnete Gartenhäuser, Gewächshäuser, Garagen/Carports. Pool, Terrasse, Spielturm, Trampolin, Pflanzen zählen nicht.",
        beispiel="Erkannter Carport 6 m an der Westgrenze + neues Gartenhaus 4 m dort → 10 m → rot. Ein 8 m langer Pool an derselben Grenze zählt nicht."),
    "bestand.automatikNurHinweis": dict(
        text=lambda: KEIN, link=None,
        umsetzung="Automatisch erkannte Objekte erscheinen nur als Hinweis „Hier scheint noch etwas zu stehen“ (blass, Label „Hinweis, nicht geprüft“). Sie zählen nicht zur 9-m-/15-m-Länge und lösen keine Kollision aus. Es zählen nur bestätigte, eingezeichnete oder per Tipp erfasste Objekte.",
        beispiel="Automatik meldet ein Gartenhaus 4 m an der Ostgrenze (Konfidenz 95 %) → zählt nicht. Nutzer tippt darauf, prüft Art und Kanten → zählt."),
    "bestand.dachueberstandAnnahmeM": dict(
        text=lambda: art6("6"), link="BayBO-6",
        umsetzung="Per Tipp erfasster Bestand: Luftbild-Umriss = Dach. Wand = Dach minus Überstand je Seite (aus Laser-Wandpunkten unter der Traufe, sonst 0,30 m angenommen, vom Nutzer änderbar). Grenzbebauung (9 m/15 m) und Kollision rechnen mit dem Wandumriss, Label „geschätzt“; der Dachumriss wird gestrichelt mit angezeigt.",
        beispiel="Gartenhaus, Dach im Luftbild 4,50 × 3,60 m, Überstand angenommen 0,30 m → Wand 3,90 × 3,00 m. An der Ostgrenze zählen 3,90 m (nicht 4,50 m) zur 9-m-Länge."),
    "bestand.grenzNaheM": dict(
        text=lambda: KEIN, link=None,
        umsetzung="Bestandsobjekte bis 1,0 m von der Grenze werden in der Liste „Steht hier schon etwas?“ dieser Grenze zugeordnet.",
        beispiel="Gewächshaus 0,8 m von der hinteren Grenze → in der Liste der hinteren Grenze."),
    "waermepumpe.verfahrensfrei": dict(
        text=lambda: art57("2"), link="BayBO-57",
        umsetzung="Wärmepumpe immer verfahrensfrei (Annahme: am Ein- oder Zweifamilienhaus). Geprüft werden Lärm und, über 2 m Höhe, der Hinweis auf Abstandsflächen.",
        beispiel="Luft-Wasser-Wärmepumpe am Einfamilienhaus → kein Bauantrag; Ergebnis hängt am Lärm."),
    "waermepumpe.richtwerteNachtDbA": dict(
        text=ta_laerm, link="TA-Laerm",
        umsetzung="Nachtwerte: reines WA 35, allgemeines WA 40, Mischgebiet 45 dB(A). Gebietsart ist eine Annahme (Standard: allgemeines Wohngebiet), vom Nutzer änderbar. Urbanes Gebiet, Dorfgebiet nicht wählbar (Dorf = Mischgebiet-Wert).",
        beispiel="Am Nachbarfenster 38 dB(A), allgemeines Wohngebiet (40) → gelb (weniger als 3 dB Reserve); 36 dB(A) → grün."),
    "waermepumpe.richtwirkungQ": dict(
        text=lambda: KEIN + " Quelle: LAI-Leitfaden Luftwärmepumpen (Richtwirkungsmaß).", link="LAI",
        umsetzung="Q = 2 frei, 4 an einer Wand (bis 3 m), 8 in der Ecke (zwei Wände bis 3 m).",
        beispiel="Gerät 1 m vor der Hauswand, keine zweite Wand näher als 3 m → Q = 4 (+6 dB gegenüber Q = 1)."),
    "waermepumpe.formel": dict(
        text=lambda: KEIN + " Quelle: LAI-Leitfaden Luftwärmepumpen (vereinfachte Ausbreitung).", link="LAI",
        umsetzung="Lp = Lw + 10·log10(Q) − 11 − 20·log10(r); r als 3D-Abstand Gerät (0,5 m) → Fenster (1,6 m bzw. 4,4 m); Abschirmung abgezogen.",
        beispiel="Lw = 55 dB(A), Q = 4, r = 8 m: 55 + 6,0 − 11 − 18,1 = 32,0 dB(A). Q = 8, r = 5 m: 55 + 9,0 − 11 − 14,0 = 39,1 dB(A)."),
    "waermepumpe.knappMargeDb": dict(
        text=lambda: KEIN, link=None,
        umsetzung="Gelb, wenn der berechnete Pegel weniger als 3 dB unter dem Richtwert liegt.",
        beispiel="39,1 dB(A) bei Richtwert 40 → gelb."),
    "waermepumpe.wandabstandM": dict(
        text=lambda: KEIN + " Quelle: LAI-Leitfaden / Stufen des BWP-Schallrechners.", link="LAI",
        umsetzung="Wände (alle Gebäude aus LoD2) bis 3 m Abstand gelten als reflektierend.",
        beispiel="Gerät 2,5 m vor der Hauswand → „an der Wand“, Q = 4."),
    "waermepumpe.quellhoeheM": dict(
        text=lambda: KEIN, link=None, umsetzung="Schallquelle 0,5 m über Gelände.", beispiel="Gerät auf Bodenkonsole: Quelle 0,5 m."),
    "waermepumpe.fensterhoeheAnnahmeM": dict(
        text=lambda: KEIN + " Vorgabe aus der Projektbeschreibung.", link=None,
        umsetzung="Ohne Eingabe des Nutzers: Fenster auf 1,6 m Höhe, Label „Annahme“; Nutzer kann auf die Fassade tippen.",
        beispiel="Nachbarhaus ohne angetipptes Fenster → Fassadenpunkte auf 1,6 m."),
    "waermepumpe.abschirmungDb": dict(
        text=lambda: KEIN + " Quelle: LAI-Leitfaden, Stufen des BWP-Schallrechners.", link="LAI",
        umsetzung="Sichtlinie Gerät–Fenster gegen LoD2-Grundrisse: frei 0 dB, durch ein anderes Gebäude verdeckt 5 dB, Gerät auf der abgewandten Seite des eigenen Hauses 15 dB. Keine Beugungsberechnung.",
        beispiel="Gerät auf der Gartenseite, Nachbarfenster auf der Straßenseite hinter dem eigenen Haus → −15 dB."),
    "waermepumpe.fassadenRasterM": dict(
        text=lambda: KEIN, link=None, umsetzung="Angenommene Fenster alle 1 m entlang der zugewandten Fassade; maßgeblich ist der lauteste Punkt.",
        beispiel="12 m lange Nachbarfassade → 13 Prüfpunkte, der nächstgelegene entscheidet."),
    "waermepumpe.fensterhoeheOGAnnahmeM": dict(
        text=lambda: KEIN, link=None, umsetzung="Bei Traufhöhe über 4,5 m (LoD2) zusätzlich Fenster im Obergeschoss auf 4,4 m.",
        beispiel="Nachbarhaus mit 6 m Traufe → Punkte auf 1,6 m und 4,4 m."),
    "waermepumpe.keymarkNennbetrieb": dict(
        text=lambda: KEIN + " Daten: Heat Pump KEYMARK (EN 12102-1) über hplib.", link="KEYMARK",
        umsetzung="Mit einem KEYMARK-Gerät rechnet Passt. mit der Schallleistung im Nennbetrieb (nicht Nachtmodus), Label „zertifiziert“. Status der Datennutzung: angefragt, nur Demo.",
        beispiel="Gerät mit Lw 58 dB(A) laut KEYMARK, Hersteller nennt 52 dB(A) im Nachtmodus → Passt. rechnet mit 58."),
    "aussengeraete.klimaVerfahrensfrei": dict(
        text=lambda: art57("2"), link="BayBO-57",
        umsetzung="Außeneinheit eines Klimageräts: verfahrensfrei als „sonstige Anlage der technischen Gebäudeausrüstung“. Der Wortlaut nennt Klimageräte nicht; Passt. zeigt die Zeile mit dem Zusatz „Auslegung, das Bauamt bestätigt sie“ (offen).",
        beispiel="Split-Außeneinheit 0,8 × 0,35 × 0,6 m an der Hauswand → keine Baugenehmigung, Ergebnis hängt am Lärm."),
    "aussengeraete.klimaAbstandsflaecheBisM": dict(
        text=lambda: art6("1", (2, 3)), link="BayBO-6",
        umsetzung="Klimagerät bis 2,00 m Höhe: keine Abstandsfläche, als Annahme gewendet (Art. 6 Abs. 1 Satz 3 Nr. 4 nennt „Wärmepumpen“). Darüber: Hinweis „Abstandsfläche nötig – nicht geprüft“ (offen).",
        beispiel="Außeneinheit 0,6 m hoch, 0,5 m von der Grenze → keine Abstandsfläche (Annahme), Lärm wird getrennt geprüft."),
    "aussengeraete.poolVerfahrensfrei": dict(
        text=lambda: art57("2") + "<br>" + art57("10a"), link="BayBO-57",
        umsetzung="Pool-Wärmepumpe wie sonstige Anlage der technischen Gebäudeausrüstung (Auslegung, offen). Das Schwimmbecken selbst prüft Passt. nicht; im Außenbereich weist die Zeile darauf hin, dass es dort nicht freigestellt ist.",
        beispiel="Pool-Wärmepumpe 0,5 × 0,9 × 0,7 m neben einem Becken im Innenbereich → keine Baugenehmigung für das Gerät, Lärm wird geprüft."),
    "aussengeraete.poolAbstandsflaecheBisM": dict(
        text=lambda: art6("1", (2, 3)), link="BayBO-6",
        umsetzung="Pool-Wärmepumpe bis 2,00 m Höhe: keine Abstandsfläche (Art. 6 Abs. 1 Satz 3 Nr. 4 „Wärmepumpen“). Ob die Vorschrift auf Pool-Wärmepumpen zielt, steht nicht im Wortlaut – Zeile als offen markiert.",
        beispiel="Gerät 0,7 m hoch an der Grundstücksgrenze → keine Abstandsfläche; Lärm entscheidet."),
    "aussengeraete.richtwerteTagDbA": dict(
        text=ta_laerm, link="TA-Laerm",
        umsetzung="Nur die Pool-Wärmepumpe kann auf „nur tagsüber“ gestellt werden: dann Tagwerte reines WA 50, allgemeines WA 55, Mischgebiet 60 dB(A). Sonst und bei allen anderen Außengeräten gilt der Nachtwert. Tags 06–22 Uhr, nachts 22–06 Uhr (Nr. 6.4). Zuschlag für Ruhezeiten (Nr. 6.5) nicht berücksichtigt.",
        beispiel="Pool-Wärmepumpe 66 dB(A), 5 m vor dem Nachbarfenster: nachts rot, tagsüber (Richtwert 55) je nach Pegel gelb oder grün."),
    "aussengeraete.standardLwDbA": dict(
        text=lambda: KEIN + " Platzhalter ohne Beleg: Klimagerät 60, Pool-Wärmepumpe 55 dB(A).", link=None,
        umsetzung="Gilt nur, bis der Nutzer die Schallleistung aus dem Datenblatt eingibt; Zeile mit Label „Annahme“.",
        beispiel="Klimagerät ohne Eingabe: 60 dB(A) angenommen, Zeile „Wert aus dem Datenblatt eingeben“."),
    "aussengeraete.standardMasseM": dict(
        text=lambda: KEIN, link=None, umsetzung="Übliche Maße der Außeneinheit, nur für Kollision und Darstellung.", beispiel="–"),
    "aussengeraete.klimaSommerNachtHinweis": dict(
        text=lambda: KEIN, link=None,
        umsetzung="Hinweiszeile beim Klimagerät: läuft vor allem im Sommer und oft nachts, Fenster häufiger offen; Passt. rechnet nachts.",
        beispiel="–"),
    "aussengeraete.geraetedatenbank": dict(
        text=lambda: KEIN + " Bedingungen: EPREL Public API Terms and Conditions (gültig ab 03.06.2024).", link=None,
        umsetzung="Für Klimageräte und Pool-Wärmepumpen gibt es keine Gerätedatenbank: EPREL braucht einen API-Schlüssel, KEYMARK enthält nur Wasser-Wärmepumpen. Die Gerätesuche liest klimageraete.json und poolwaermepumpen.json, sobald sie existieren.",
        beispiel="Suche nach „Daikin“ findet nur Luft-Wasser-Wärmepumpen aus KEYMARK."),
    "pflanzen.abstandKleinM": dict(
        text=lambda: agbgb(47, 1), link="AGBGB-47", umsetzung="Pflanzen bis 2,00 m Höhe: mindestens 0,50 m Abstand.",
        beispiel="Hecke 1,8 m hoch, Triebe 0,6 m von der Grenze → eingehalten."),
    "pflanzen.hoeheGrenzeM": dict(
        text=lambda: agbgb(47, 1), link="AGBGB-47", umsetzung="Genau 2,00 m gilt noch als „bis 2 m“.",
        beispiel="Hecke genau 2,00 m hoch, 0,5 m von der Grenze → eingehalten; 2,10 m → 2 m Abstand nötig."),
    "pflanzen.abstandHochM": dict(
        text=lambda: agbgb(47, 1), link="AGBGB-47", umsetzung="Pflanzen über 2 m: mindestens 2 m; App zeigt auch die zulässige Höhe am Standort.",
        beispiel="Baum 6 m hoch, Stamm 1,2 m von der Grenze → rot; zulässig wären dort 2 m Höhe."),
    "pflanzen.waldM": dict(
        text=lambda: agbgb(47, 2), link="AGBGB-47", umsetzung="Seite als Wald angegeben → nur 0,5 m.",
        beispiel="Nachbar ist Wald, Baum 10 m hoch, 1 m von der Grenze → eingehalten."),
    "pflanzen.landwirtschaftM": dict(
        text=lambda: agbgb(48) + "<br>" + agbgb(50, 2), link="AGBGB-48",
        umsetzung="Nicht umgesetzt: Passt. fragt nicht nach landwirtschaftlich genutzten Nachbargrundstücken (Wohngebiet). Nur dokumentiert.",
        beispiel="–"),
    "pflanzen.messung": dict(
        text=lambda: agbgb(49), link="AGBGB-49",
        umsetzung="Bäume: Stamm (vom Nutzer angetippt, sonst Kronenmitte aus Laser/DOM als Annahme). Hecken: Mitte der grenznächsten Triebe, angenähert als Rand der Hecke + halbe Breite.",
        beispiel="Baum, Kronenmitte 2,3 m von der Grenze, Stamm nicht angetippt → „Annahme“, Unsicherheit ±0,75 m."),
    "pflanzen.ausnahmeEinfriedung": dict(
        text=lambda: agbgb(50, 1), link="AGBGB-50",
        umsetzung="Nutzer gibt Höhe einer Mauer/dichten Einfriedung an; Pflanzen, die diese nicht überragen, sind ausgenommen. „Nicht erheblich überragen“ = offen (Frage 12).",
        beispiel="Mauer 1,8 m, Hecke 1,8 m, 0,2 m von der Grenze → Ausnahme. Hecke 2,0 m → offen."),
    "pflanzen.ausnahmeStrasse": dict(
        text=lambda: agbgb(50, 1), link="AGBGB-50", umsetzung="Seite als öffentliche Straße markiert → Art. 47 gilt dort nicht.",
        beispiel="Hecke an der Straßenseite → keine Abstandsprüfung."),
    "pflanzen.verjaehrungJahre": dict(
        text=lambda: agbgb(52, 1), link="AGBGB-52", umsetzung="Nur Info-Text, keine Berechnung der Frist.",
        beispiel="Nutzer gibt an „steht seit mehr als 5 Jahren so“ → Info-Text zu Art. 52 und BGH, keine Aussage „verjährt“."),
    "pflanzen.ersatzpflanzung": dict(
        text=lambda: agbgb(52, 2), link="AGBGB-52", umsetzung="Teil des Info-Texts.",
        beispiel="Alte Thuja-Hecke wird durch neue ersetzt → für die neue gilt der Abstand wieder."),
    "pflanzen.nachbarNaheM": dict(
        text=lambda: KEIN, link=None, umsetzung="Nachbarpflanzen bis 3 m von der Grenze werden aufgelistet.",
        beispiel="Nachbarbaum, Kronenmitte 2,6 m von der Grenze → in der Liste."),
    "pflanzen.rechtsprechungVerjaehrung": dict(
        text=lambda: "BGH, Urteil vom 1. Juni 2017 – V ZR 230/16, Rn. 9–11 (sinngemäß, nicht wörtlich).", link="BGH",
        umsetzung="Teil des Info-Texts zur Verjährung.",
        beispiel="Hecke wächst 2019 erstmals über 2 m → Anspruch entsteht 2019; Frist beginnt erst mit Kenntnis bzw. grob fahrlässiger Unkenntnis."),
    "pflanzen.hoeheAmHang": dict(
        text=lambda: "BGH, Urteil vom 1. Juni 2017 – V ZR 230/16, Leitsatz (sinngemäß).", link="BGH",
        umsetzung="Liegt das Nachbargelände (DGM1, 1 m jenseits der Grenze) mehr als 0,2 m höher: Hinweis „offen“, keine Umrechnung.",
        beispiel="Nachbargelände 0,8 m höher, Hecke 2,5 m, 1 m von der Grenze → rot und Hinweis, dass vom höheren Gelände gemessen wird."),
    "verfahren.pflichtenAuchVerfahrensfrei": dict(
        text=lambda: verf("BayBO Art. 55"), link="BayBO-55", umsetzung="Text im Verfahrensteil: auch verfahrensfreie Vorhaben müssen Abstandsflächen einhalten.",
        beispiel="Verfahrensfreies Gartenhaus mit 3,5 m Wandhöhe an der Grenze → Abweichung nötig."),
    "verfahren.genehmigungsfreistellung": dict(
        text=lambda: verf("BayBO Art. 58"), link="BayBO-58", umsetzung="Liegt das Grundstück in einem Bebauungsplan, nennt Passt. die Freistellung als möglichen Weg (keine Prüfung der Festsetzungen).",
        beispiel="Carport 54 m² im B-Plan-Gebiet → Hinweis auf Genehmigungsfreistellung."),
    "verfahren.vereinfachtesVerfahren": dict(
        text=lambda: verf("BayBO Art. 59"), link="BayBO-59", umsetzung="Standardweg bei Genehmigungspflicht.",
        beispiel="Gartenhaus 90 m³ außerhalb eines B-Plans → vereinfachtes Verfahren."),
    "verfahren.bauvorlageberechtigung": dict(
        text=lambda: verf("BayBO Art. 61"), link="BayBO-61", umsetzung="Bei Bauantrag: Entwurfsverfasser nötig; für Carports als Kleingarage Hinweis auf Abs. 3 Nr. 4. Für Gartenhäuser: Frage 15.",
        beispiel="Carport 54 m² → Architekt/Ingenieur oder Techniker/Meister nach Abs. 3."),
    "verfahren.kleingarageBisM2": dict(
        text=lambda: verf("GaStellV"), link="GaStellV-1", umsetzung="Carport bis 100 m² = Kleingarage (offene Garage).",
        beispiel="Carport 54 m² → Kleingarage."),
    "verfahren.abweichung": dict(
        text=lambda: verf("BayBO Art. 63"), link="BayBO-63", umsetzung="Bei verfahrensfreien Vorhaben mit Abstandsflächen-Befund: „Abweichung beantragen“ (gesondert, schriftlich, begründet).",
        beispiel="Gartenhaus 3,5 m hoch direkt an der Grenze → Weg „verfahrensfrei mit Abweichung“."),
    "grossesVorhaben.geschosshoeheAnnahmeM": dict(
        text=lambda: KEIN, link=None, umsetzung="Wandhöhe des Neubaus = Geschosse × Geschosshöhe (Standard 2,80 m), vom Nutzer einstellbar; Basis für H nach Art. 6 Abs. 4.",
        beispiel="2 Geschosse × 2,80 m = Wandhöhe 5,60 m; mit Satteldach 35° und 8 m Tiefe: H = 5,60 + 1/3 · 2,80 = 6,53 m → Abstandsfläche 3,00 m (Mindestmaß)."),
    "grossesVorhaben.bruestungshoeheAnnahmeM": dict(
        text=lambda: KEIN, link=None, umsetzung="Oberkante der Brüstung des obersten Anleiterfensters = (Geschosse − 1) × Geschosshöhe + 1,0 m; Dachgeschossfenster nicht berücksichtigt. Entscheidet, ob Zugang (≤ 8 m) oder Zufahrt (> 8 m) gefordert wird.",
        beispiel="3 Geschosse: 2 × 2,80 + 1,0 = 6,6 m → Zugang genügt; 4 Geschosse: 3 × 2,80 + 1,0 = 9,4 m → Zufahrt nötig."),
    "grossesVorhaben.art5Abs1": dict(
        text=lambda: baybo_art(5, "(1) 1", "(2)"), link="BayBO-5",
        umsetzung="Wortlaut von Art. 5 Abs. 1 (Sätze 1 bis 4) wie in den Zeilen „So haben wir geprüft“ zitiert. Umgesetzt: Satz 1 (GERADLINIGER Zugang), Satz 2 (Zufahrt über 8 m Brüstung); als Hinweis (offen): Satz 3 (Aufstellflächen), Satz 4 (über 50 m von der Verkehrsfläche). Der Text stammt von lxgesetze.de, nicht vom amtlichen Portal.",
        beispiel="Hinterliegerhaus 25 m hinter dem Vorderhaus: Passt. sucht eine gerade Strecke von der Straße zum Haus."),
    "grossesVorhaben.zugangGeradlinig": dict(
        text=lambda: baybo_art(5, "(1) 1", "2 Zu Gebäuden") + "<br>" + feuerwehr(14), link="BayBO-5",
        umsetzung="Gerader Korridor: Strecken von Punkten der Verkehrsfläche zu Punkten am Haus (alle 25 cm), Breite = kleinster Abstand zum Hindernis entlang der Linie ×2; die breiteste gerade Strecke zählt. Ein gewundener Weg genügt nicht (rot), auch wenn er breit genug wäre. Für die Zufahrt (Brüstung über 8 m) wird der breiteste Weg gesucht, Geradlinigkeit dort nicht geprüft (offen).",
        beispiel="Zwei versetzte Garagenriegel: Umweg 3 m breit vorhanden, aber keine gerade Strecke → Zugang rot; gerader Gang 1,3 m zwischen Garage und Zaun → grün."),
    "grossesVorhaben.zufahrtHoeheM": dict(
        text=lambda: feuerwehr(2), link="Feuerwehr",
        umsetzung="Lichte Höhe 3,50 m (senkrecht zur Fahrbahn): Passt. hat keine Daten zu Durchfahrten, Ästen oder Leitungen, misst sie nicht und führt sie in jedem Ergebnis mit Zufahrt als „offen“.",
        beispiel="Zufahrt unter einem Carport mit 2,5 m Durchfahrtshöhe: Passt. erkennt das nicht."),
    "grossesVorhaben.feuerwehrBruestungGrenzeM": dict(
        text=lambda: baybo_art(5, "(1) 1", "3 Ist für"), link="BayBO-5", umsetzung="Brüstung über 8 m → Zufahrt (3 m) statt Zugang (1,25 m); Ergebnis nur für die Breite des freien Korridors auf dem eigenen Grundstück. Aufstellflächen für Hubrettungsfahrzeuge (Satz 3) prüft Passt. nicht (offen, steht in den Zeilen).",
        beispiel="Aufstockung auf 3 Geschosse bei 2,80 m Geschosshöhe: Brüstung 6,6 m → 1,25 m Zugang; 4. Geschoss → 9,4 m → 3 m Zufahrt, bei 2,6 m schmalster Stelle rot."),
    "grossesVorhaben.feuerwehrEntfernungM": dict(
        text=lambda: baybo_art(5, "4 Bei Gebäuden", "(2)"), link="BayBO-5", umsetzung="Weitester Gebäudepunkt über 50 m Luftlinie von der öffentlichen Verkehrsfläche: Zufahrt „wenn aus Gründen des Feuerwehreinsatzes erforderlich“ – das entscheidet die Feuerwehr; Passt. zeigt gelb, wenn die schmalste Stelle unter 3 m liegt (offen).",
        beispiel="Haus im Hinterland, 62 m von der Straße, Weg 2,2 m breit: Zugang erfüllt, aber gelb mit Hinweis auf Satz 4."),
    "grossesVorhaben.zugangBreiteM": dict(
        text=lambda: feuerwehr(14), link="Feuerwehr", umsetzung="Breite der breitesten GERADEN Strecke zum Haus (Rasterberechnung, schmalste Stelle) gegen 1,25 m. Gilt für den Zugang bei Brüstung bis 8 m. Die Richtlinie ist in Bayern als Technische Baubestimmung (BayTB) eingeführt (Angabe des Auftraggebers); der Wortlaut der bayerischen Fassung liegt nicht vor.",
        beispiel="Gasse zwischen Garage und Grenze 1,0 m breit: rot; 1,3 m: grün."),
    "grossesVorhaben.zufahrtBreiteM": dict(
        text=lambda: feuerwehr(2), link="Feuerwehr", umsetzung="Zufahrt bei Brüstung über 8 m: schmalste Stelle des Korridors mindestens 3 m. Höhe (3,50 m), Kurven, Tragfähigkeit prüft Passt. nicht.",
        beispiel="Einfahrt zwischen zwei Häusern 2,9 m: rot; 3,0 m: grün."),
    "grossesVorhaben.zufahrtBreiteBegrenztM": dict(
        text=lambda: feuerwehr(2), link="Feuerwehr", umsetzung="Über 12 m beidseitig durch Bauteile begrenzt: 3,50 m. Passt. erkennt nur die Strecke unter 3,50 m Breite zwischen Gebäuden (eine Seite genügt) und zeigt gelb mit „offen“.",
        beispiel="Durchgang zwischen Haus und Garage, 14 m lang, 3,2 m breit: gelb."),
    "grossesVorhaben.zufahrtBegrenztLaengeM": dict(
        text=lambda: feuerwehr(2), link="Feuerwehr", umsetzung="Siehe oben: Strecke, ab der 3,50 m gelten.", beispiel="–"),
    "grossesVorhaben.zweiterRettungswegFeuerwehr": dict(
        text=lambda: baybo_art(5, "(1) 1", "2 Zu Gebäuden"), link="BayBO-5", umsetzung="Annahme: Der zweite Rettungsweg führt über Rettungsgeräte der Feuerwehr; Passt. prüft deshalb für jedes Vorhaben den Zugang. Das Rettungswegkonzept kennt Passt. nicht.",
        beispiel="Zweites Wohnhaus im Garten, 25 m hinter dem Vorderhaus: Zugang von der Straße mindestens 1,25 m."),
    "grossesVorhaben.erschliessung": dict(
        text=lambda: baybo_art(4), link="BayBO-4", umsetzung="Passt. prüft nur die Breite des freien Korridors auf dem eigenen Grundstück. „Angemessene Breite“ des Grundstücks an der Straße, Wohnwege (Abs. 2) und Außenbereichszufahrt (Abs. 3) sind offen.",
        beispiel="Hinterliegergrundstück an einem 2,5 m breiten Weg: Passt. zeigt 2,5 m, das Bauamt sagt, ob das „angemessen“ ist."),
    "grossesVorhaben.verfahrenWohnhaus": dict(
        text=lambda: art57("a") + "<br>" + baybo_art(71), link="BayBO-71", umsetzung="Wohnhaus, Anbau und Aufstockung gelten als genehmigungspflichtig (Rauminhalt über 75 m³ bzw. Wohngebäude); empfohlener erster Schritt ist die Bauvoranfrage (Vorbescheid, Art. 71). Das Antrag-Paket liefert Lageplan-Skizze, Kubatur und Fragen an die Gemeinde statt der Unterlagen für einen Bauantrag.",
        beispiel="Zweites Wohnhaus 10 × 8 m, 2 Geschosse (560 m³): Baugenehmigung; Passt. erstellt die Voranfrage mit 6–8 Fragen."),
    "grossesVorhaben.umfeldRadiusM": dict(
        text=lambda: KEIN, link=None, umsetzung="Umkreis um das Vorhaben, in dem Passt. Hauptgebäude (Grundfläche ≥ 40 m², Traufe ≥ 3 m) zählt: Traufhöhen, Firsthöhen, Grundflächen, Zahl in zweiter Reihe. Daten: LoD2 und Hausumringe, Label „Orientierung“, keine Ampel.",
        beispiel="Umkreis 100 m: 14 Hauptgebäude, Traufe 5,5–7,0 m, Grundflächen 70–140 m², 3 in zweiter Reihe."),
    "grossesVorhaben.paragraf34": dict(
        text=lambda: baugb(34, "(1)", "(2)"), link="BauGB-34", umsetzung="Nur Zahlen aus der Umgebung als Orientierung; ob sich das Vorhaben „einfügt“, beurteilt die Gemeinde. Keine Ampel, keine Aussage. Der Abschnitt erscheint nur ohne Bebauungsplan und im Innenbereich.",
        beispiel="Neubau mit 8,4 m Firsthöhe, Umgebung bis 10 m: Passt. zeigt beide Zahlen, urteilt nicht."),
    "grossesVorhaben.bauTurbo": dict(
        text=lambda: baugb("246e", "(1)", "Hat eine Abweichung") + "<br>" + baugb(34, "(3b)"), link="BauGB-246e", umsetzung="Nur Hinweis: „Deine Gemeinde kann davon Gebrauch machen, das liegt in ihrem Ermessen.“ Passt. prüft keine Voraussetzung (Zustimmung der Gemeinde, Umweltprüfung im Außenbereich u. a.).",
        beispiel="Zweites Wohnhaus passt nicht in die Umgebung: Hinweis auf § 246e / § 34 Abs. 3b, Frage in der Bauvoranfrage."),
    "grossesVorhaben.aussenbereich": dict(
        text=lambda: baugb(35, "(1)", "(Nr. 1") + " … (2) Sonstige Vorhaben können im Einzelfall zugelassen werden, wenn ihre Ausführung oder Benutzung öffentliche Belange nicht beeinträchtigt und die Erschließung gesichert ist.", link="BauGB-35", umsetzung="Lage „Außenbereich“ (Nutzerangabe oder Annahme) → eigener, deutlicher Hinweis, dass dort deutlich strengere Regeln gelten; ein zweites Wohnhaus ist in der Regel nicht privilegiert (Nr. 1–8 nicht im Wortlaut übernommen). Keine Prüfung.",
        beispiel="Wohnhaus auf dem Betriebsgelände (Scharhof): Hinweis „Außenbereich“ statt § 34-Zahlen."),
    "grossesVorhaben.bebauungsplan": dict(
        text=lambda: baugb(30, "(1)", "(2)"), link="BauGB-30", umsetzung="Abfrage des Landesportals (Bauleitplanung Bayern, WMS) an Schwerpunkt und Grenzecken: Plan vorhanden → Hinweis und Links auf Plan und Text; Inhalt wird nicht ausgelesen. Das Portal ist nicht flächendeckend; „keiner im Portal“ heißt nicht „keiner“. Lizenz des Dienstes offen.",
        beispiel="Grundstück im Plan „Pantzerhöhe“: Hinweis mit Link auf Rasterbild und Festsetzungen."),
    "grossesVorhaben.grundstuecksteilung": dict(
        text=lambda: baybo_art(4, "(1)", "(2)") + "<br>" + art6("2", (1,)), link="BayBO-4", umsetzung="Nur Information beim zweiten Wohnhaus, keine Prüfung.",
        beispiel="Zweites Haus soll eigenes Grundstück bekommen: Hinweis auf Zufahrt in angemessener Breite und Abstandsflächen auf jedem Teilgrundstück."),
    "grossesVorhaben.schattenStichtage": dict(
        text=lambda: KEIN, link=None, umsetzung="Zusätzliche Verschattung als Stunden an zwei Stichtagen (21. März, 21. Dezember), Sonnenhöhe ≥ 5°, Sonnenstand NOAA/Meeus, ebenes Gelände. Eine gesetzliche Grenze gibt es nicht; die Zahl ist für das Gespräch mit den Nachbarn.",
        beispiel="Aufstockung 2,8 m: Nachbarfenster 12 m nördlich verliert am 21. Dezember 1 h 20 min Sonne."),
    "grossesVorhaben.schattenGartenRingeM": dict(
        text=lambda: KEIN, link=None, umsetzung="Gartenpunkte in 2, 5 und 8 m Abstand hinter der Grenze, alle 2 m, 1 m über Boden, nicht in Gebäuden. Die Nachbargrundstücke sind nicht bekannt – Annahme.",
        beispiel="Grenze 30 m lang: etwa 45 Gartenpunkte."),
    "verfahren.bauantrag": dict(
        text=lambda: verf("BayBO Art. 64"), link="BayBO-64", umsetzung="Checkliste: schriftlich, alle Bauvorlagen, Unterschriften Bauherr und Entwurfsverfasser.",
        beispiel="–"),
    "verfahren.nachbarbeteiligung": dict(
        text=lambda: verf("BayBO Art. 66"), link="BayBO-66", umsetzung="Checkliste: Nachbarunterschrift; Hinweis, dass der Passt.-Nachbar-Link sie nicht ersetzt.",
        beispiel="–"),
    "verfahren.bauvorlagen": dict(
        text=lambda: verf("BauVorlV § 3") + "<br>" + verf("BauVorlV § 7"), link="BauVorlV-3",
        umsetzung="Antrag-Paket: Lageplan-Skizze (gestempelt „keine amtliche Lageplanunterlage“), Grundriss, Ansichten, Schnitt 1:100. Katasterauszug muss der Nutzer selbst besorgen.",
        beispiel="–"),
    "verfahren.anzahl": dict(
        text=lambda: verf("BauVorlV § 2"), link="BauVorlV-2", umsetzung="Hinweis in der Checkliste (bei Papier).", beispiel="–"),
    "verfahren.links": dict(
        text=lambda: KEIN + " Links zum Digitalen Bauantrag und zu den Formularen des Staatsministeriums.", link="STMB",
        umsetzung="Links im Antrag-Dialog.", beispiel="–"),
}

FRAGEN = [
    ("Giebel bei Art. 6 Abs. 4", "Art. 6 Abs. 4 regelt Dächer, Giebelflächen nennt nur Abs. 5a (Großstädte). Passt. rechnet das Giebeldreieck einer Giebelwand wie das Dach zu einem Drittel zur Wandhöhe H. Ist das für Sulzbach-Rosenberg richtig – oder zählt der Giebel voll, oder gar nicht?"),
    ("Giebel bei Art. 6 Abs. 7 über 45°", "„Giebelflächen bleiben bei einer Dachneigung bis zu 45 Grad unberücksichtigt.“ Wie wird bei Dächern über 45° die Giebelfläche in die mittlere Wandhöhe eingerechnet (voll, zu einem Drittel, als Flächenmittel)?"),
    ("Dachneigung der Häuser aus LoD2", "Für die Abstandsflächen des Wohnhauses nimmt Passt. bis 70° Dachneigung an (Dach zu einem Drittel), weil LoD2 die Neigung nur näherungsweise liefert. Vertretbar?"),
    ("Brutto-Rauminhalt", "Passt. rechnet Außenmaße × Wandhöhe ab Oberkante Fußboden + Dachraum (Satteldach als halbes Prisma), ohne Bodenplatte und Dachüberstand. Wie messen Bauämter den Brutto-Rauminhalt für Art. 57 (DIN 277: ab Unterseite Bodenplatte)?"),
    ("Art. 57 Abs. 1 Nr. 1 a – aktueller Wortlaut", "Nach dem aktuellen Wortlaut gilt „ohne Aufenthaltsräume, Toiletten oder Feuerstätten“ nur für Gebäude im Außenbereich (bis 20 m³). Passt. behandelt ein Gartenhaus mit Aufenthaltsraum oder Ofen im Innenbereich deshalb als verfahrensfrei (gelb), aber ohne Privileg nach Art. 6 Abs. 7. Richtig? Gibt es weitere Anforderungen, die wir nennen sollten (Feuerstätte, Abgasanlage, Bezirkskaminkehrer)?"),
    ("Außenbereich", "Passt. gibt im Außenbereich nichts frei und verweist ans Bauamt, auch bei Gebäuden unter 20 m³. Ist dieser Hinweis ausreichend und korrekt formuliert?"),
    ("Was zählt „an der Grenze“?", "Art. 6 Abs. 7 gilt „auch wenn sie nicht an der Grundstücksgrenze errichtet werden“. Passt. zählt ein Nebengebäude zur 9-m- und 15-m-Länge, wenn es näher an der Grenze steht als seine erforderliche Abstandsflächentiefe (meist 3 m). Ist das die richtige Abgrenzung?"),
    ("Bestand: nur Bestätigtes zählt", "Aus Luftbild und Laser automatisch erkannte Nebengebäude sind nur ein Hinweis und zählen nie bei der Grenzbebauung (9 m / 15 m); erst was der Nutzer per Tipp erfasst, bestätigt oder einzeichnet, zählt mit Maßen und Spanne. Ist das als Orientierung vertretbar, oder soll ein erkannter Bau ab einer Mindestgröße immer als Warnung erscheinen?"),
    ("Fläche eines Carports", "Passt. nimmt für die 50-m²-Grenze Breite × Tiefe des Carports. Zählt der Dachüberstand mit, oder nur die von Stützen umschlossene Fläche?"),
    ("Wärmepumpe", "Passt. ordnet die Wärmepumpe Art. 57 Abs. 1 Nr. 2 Buchst. b (sonstige TGA) zu. Und: Zählt bei „Höhe bis zu 2 m über der Geländeoberfläche“ (Art. 6 Abs. 1) ein Sockel oder eine Wandkonsole mit?"),
    ("Klimagerät: Art. 57", "Passt. ordnet die Außeneinheit eines Klimageräts (Split) Art. 57 Abs. 1 Nr. 2 Buchst. b (sonstige Anlagen der technischen Gebäudeausrüstung) zu, weil der Wortlaut Klimageräte nicht nennt. Ist das richtig, und gilt es auch bei Geräten über 2 m Höhe oder mit Einhausung?"),
    ("Klimagerät und Pool-Wärmepumpe: Art. 6 Abs. 1 Satz 3 Nr. 4", "Dort sind „Wärmepumpen und zugehörige Einhausungen mit einer Höhe bis zu 2 m“ von der Abstandsfläche ausgenommen. Zählen reversible Split-Klimageräte und Wärmepumpen zur Beheizung eines Schwimmbeckens dazu? Passt. wendet die 2 m bei beiden an (Klimagerät als Annahme, Pool als offen)."),
    ("Pool-Wärmepumpe und Schwimmbecken", "Art. 57 Abs. 1 Nr. 10 Buchst. a stellt Schwimmbecken frei, „außer im Außenbereich“. Passt. prüft das Becken nicht, nennt im Außenbereich nur den Hinweis. Genügt das, und gibt es für das Gerät eigene Anforderungen (z. B. Schalldämmung, Aufstellort)?"),
    ("Tages- und Nachtwerte bei Außengeräten", "Passt. rechnet alle Außengeräte nachts (Nr. 6.1, strengerer Wert) und lässt nur die Pool-Wärmepumpe auf „nur tagsüber“ stellen. Klimageräte laufen oft nachts, Pool-Wärmepumpen oft nur tagsüber. Ist das als Orientierung vertretbar? Gilt für ein Klimagerät im Ruhezeitenfenster (Nr. 6.5, 6 dB Zuschlag) eine andere Praxis?"),
    ("Lärm: Immissionsort und Zuschläge", "Passt. rechnet den Pegel auf Fenstermitte an der Fassade (1,6 m / 4,4 m), ohne Messpunkt 0,5 m vor dem geöffneten Fenster (TA Lärm Anhang A.1.3), ohne Ton- und Impulszuschlag, nur Nachtwert. Gebietsarten: rein/allgemein/Misch. Reicht das als Orientierung, oder wo liegen wir systematisch zu niedrig?"),
    ("Pflanzen hinter Mauern", "Art. 50 Abs. 1: „nicht oder nicht erheblich überragen“. Passt. nimmt die Ausnahme nur an, wenn die Pflanze die Einfriedung nicht überragt; alles darüber ist „offen“. Gibt es eine übliche Grenze (z. B. 0,5 m)?"),
    ("Messpunkt bei Hecken", "Art. 49: „Mitte der zunächst an der Grenze befindlichen Triebe“. Passt. nähert das aus Luftbild/Laser als Heckenrand + halbe Breite an. Vertretbar?"),
    ("Hang (BGH V ZR 230/16)", "Liegt das Nachbargrundstück höher, wird die zulässige Höhe vom höheren Gelände aus gemessen. An welchem Punkt (direkt an der Grenze?) – damit Passt. das rechnen könnte."),
    ("Entwurfsverfasser für Gartenhäuser", "Bei genehmigungspflichtigen Gartenhäusern (über 75 m³) nennt Passt. Architekt oder eingetragene Ingenieure. Reichen hier auch die Personen nach Art. 61 Abs. 3 (z. B. Meister, Techniker)?"),
    ("Örtliche Satzungen", "Hat Sulzbach-Rosenberg eine Abstandsflächensatzung (Art. 6 Abs. 5 Satz 2) oder eine Gestaltungssatzung, die Nebengebäude betrifft? Passt. berücksichtigt keine."),
    ("Dachüberstand", "Art. 6 Abs. 6 Nr. 1 lässt Dachüberstände bei der Bemessung der Abstandsflächen außer Betracht – ohne Grenze im Wortlaut. Ab welchem Überstand zählt er in der Praxis doch mit (z. B. über 0,5 m oder 1,5 m wie bei Vorbauten in Nr. 2)? Zählt bei der Grenzbebauung (9 m je Seite, 15 m gesamt) die Wandlänge oder die Dachlänge? Und darf der Überstand eines Grenzgebäudes über die Grenze ragen? Passt. rechnet mit der Wand und zeigt das Dach getrennt."),
    ("Großes Vorhaben: Pultdach", "Art. 6 Abs. 4 Satz 3 rechnet die Höhe von Dächern zu einem Drittel zur Wandhöhe. Beim Pultdach rechnet Passt. 1/3 der Dachhöhe an allen Wänden an, auch an der hohen Wand, an der die Dachhaut endet (sicher nach oben). Richtig, oder zählt die hohe Wand nur bis zum oberen Abschluss?"),
    ("Großes Vorhaben: Dach der bestehenden Häuser", "Für Aufstockung und Abstandsflächen des Hauses kennt Passt. nur Trauf- und Firsthöhe (LoD2) und rechnet mit Dachneigung bis 70° (1/3). Eine Aufstockung verschiebt die Traufe um Geschosse × Geschosshöhe (Annahme 2,80 m). Vertretbar?"),
    ("Überdeckung der Abstandsflächen (Art. 6 Abs. 3)", "Passt. lässt Überdeckungen nur bei Wänden über 75° zueinander zu (Nr. 1). Die Ausnahme „fremder Sicht entzogener Gartenhof“ bei Gebäudeklassen 1 und 2 (Nr. 2) erkennt Passt. nicht, ebenso wenig die Gebäude „in den Abstandsflächen zulässig“ außer Kleinbauten bis 3 m. Reicht das als Orientierung?"),
    ("Anbau: Abstandsfläche der angebauten Wand", "Beim Anbau lässt Passt. die Abstandsfläche der angebauten Hauswand auf der Länge des Anbaus weg und rechnet Reststücke weiter. Anbau und Haus gelten als ein Gebäude. Passt das – auch bei abweichender Höhe des Anbaus?"),
    ("Abstandsflächen auf öffentlichen Verkehrsflächen", "Art. 6 Abs. 2 Satz 2: „nur bis zu deren Mitte“. Passt. kennt die Mitte der Straße nicht und zeigt Abstandsflächen auf Straßen (ALKIS Tatsächliche Nutzung) gelb mit „offen“. Gibt es eine praktikable Regel (halbe Breite der Fläche)?"),
    ("Zugang geradlinig, Zufahrt: Maße", "Passt. prüft für Brüstungen bis 8 m einen GERADLINIGEN Zugang von der öffentlichen Verkehrsfläche zum Haus (Art. 5 Abs. 1 Satz 1), mindestens 1,25 m breit (Richtlinie über Flächen für die Feuerwehr Nr. 14, BayTB); ein breiter, aber gewundener Weg wird rot. Darüber verlangt Passt. eine Zufahrt mit 3 m lichter Breite (Nr. 2); die lichte Höhe von 3,50 m misst Passt. nicht (offen). Aufstellflächen (Satz 3, Nr. 8) werden nicht geprüft. Stimmen Auslegung und Maße der bayerischen Fassung? Muss auch die Zufahrt gerade sein?"),
    ("Zufahrt: Brüstungshöhe und 50-m-Regel", "Passt. nimmt für das oberste Anleiterfenster (Geschosse − 1) × Geschosshöhe + 1,0 m an und prüft den Zugang immer (Annahme: zweiter Rettungsweg über die Feuerwehr). Bei mehr als 50 m Entfernung zur Straße (Art. 5 Abs. 1 Satz 4) zeigt Passt. gelb, wenn weniger als 3 m frei sind. Vertretbar?"),
    ("Erschließung: angemessene Breite", "Art. 4 Abs. 1 Nr. 2 nennt keine Mindestbreite. Passt. zeigt die Breite des freien Korridors auf dem eigenen Grundstück und bewertet nur gegen die Feuerwehr-Maße. Gibt es eine übliche Mindestbreite für die Zufahrt eines Hinterliegerhauses (Wohnweg nach Art. 4 Abs. 2)?"),
    ("Straßen aus ALKIS Tatsächliche Nutzung", "Für die Zufahrt gelten Flächen der Nutzungsarten Straßenverkehr, Weg und Platz als öffentliche Verkehrsfläche; ein Spielraum von 1,5 m gleicht Abweichungen zur selbst gesetzten Grenze aus. Eine Zufahrt über Nachbargrundstücke (Baulast) rechnet Passt. nicht. Genügt das?"),
    ("§ 34 BauGB: Umgebung als Zahlen", "Passt. zeigt für das Einfügen nur Zahlen aus LoD2 und Hausumringen im Umkreis von 100 m (Traufhöhen, Firsthöhen, Grundflächen, Zahl der Gebäude in zweiter Reihe), ohne Urteil. Ist die Abgrenzung der „näheren Umgebung“ mit 100 m als Orientierung vertretbar, und ist die Zählung der zweiten Reihe (anderes Hauptgebäude zwischen Straße und Haus) sinnvoll?"),
    ("Bau-Turbo (§ 246e, § 34 Abs. 3b BauGB)", "Passt. nennt den Bau-Turbo nur als Hinweis („Deine Gemeinde kann davon Gebrauch machen, das liegt in ihrem Ermessen“). Ist die Formulierung zutreffend und vollständig genug, insbesondere zu Zustimmung der Gemeinde, Befristung bis 31.12.2030 und Außenbereich (Abs. 3)?"),
    ("Bebauungsplan-Abfrage", "Passt. fragt den WMS des Landesportals (Bauleitplanung Bayern) ab und zeigt Plan und Textlink, ohne den Inhalt zu lesen. Ist das ein zulässiger und ausreichender Hinweis? Lizenz und Nutzungsbedingungen des Dienstes sind noch nicht geklärt."),
    ("Bauvoranfrage statt Bauantrag", "Passt. empfiehlt vor dem Bauantrag eine Bauvoranfrage (Vorbescheid, Art. 71) mit Lageplan-Skizze, Kubatur und Fragenliste. Welche Unterlagen verlangt die Bauaufsichtsbehörde dafür üblicherweise (BauVorlV), und fehlt in der Fragenliste etwas Wichtiges?"),
    ("Schatten auf Nachbarn", "Passt. nennt zusätzliche Sonnenstunden an zwei Stichtagen (21. März, 21. Dezember) für Nachbarfenster und Gartenpunkte, ohne Bewertung. Gibt es in Bayern eine übliche Messgröße oder Rechtsprechung (z. B. DIN 5034, Besonnungsdauer), die Passt. verwenden sollte?"),
    ("Formulierung der Antworten", "Passt. formuliert „Keine Baugenehmigung nötig“ und „Laut Art. … gilt …“, immer mit dem Hinweis „Orientierung, keine Genehmigung“. Ist das so unbedenklich?"),
]


# Kurzfassung: nur Regeln und Fragen, die in den drei Demo-Abläufen (Gartenhaus an der Grenze, Hanglage, Wärmepumpe nah am
# Nachbarn) vorkommen – geprüft an den Zeilen „So haben wir geprüft“ aller drei Demos (Gartenhaus, Carport, Wärmepumpe) –,
# höchstens 20, nach Wichtigkeit für die Demo geordnet. Das Gartenhaus der Demos hat ein Flachdach: Dachregeln fehlen deshalb.
KURZ_REGELN = [
    "gartenhaus.maxBruttoRauminhaltM3", "grenzbebauung.maxMittlereWandhoeheM", "grenzbebauung.maxLaengeJeSeiteM",
    "grenzbebauung.maxLaengeGesamtM", "grenzbebauung.ohneEigeneAbstandsflaeche", "abstand.minM", "abstand.faktorH",
    "gartenhaus.aufenthaltsraumNurArt6", "carport.maxFlaecheM2", "bestand.automatikNurHinweis", "waermepumpe.verfahrensfrei",
    "abstand.waermepumpeOhneAbstandsflaecheBisM", "waermepumpe.richtwerteNachtDbA", "waermepumpe.formel", "waermepumpe.richtwirkungQ",
    "waermepumpe.abschirmungDb", "waermepumpe.knappMargeDb", "waermepumpe.fensterhoeheAnnahmeM", "verfahren.abweichung",
    "waermepumpe.wandabstandM",
]
KURZ_FRAGEN = ["Brutto-Rauminhalt", "Art. 57 Abs. 1 Nr. 1 a – aktueller Wortlaut", "Was zählt „an der Grenze“?", "Bestand: nur Bestätigtes zählt",
               "Fläche eines Carports", "Wärmepumpe", "Lärm: Immissionsort und Zuschläge", "Hang (BGH V ZR 230/16)", "Örtliche Satzungen",
               "Formulierung der Antworten"]


def e(s: str) -> str:
    return html.escape(s, quote=False)


def seite(kurz: bool = False) -> str:
    L = json.loads(LIMITS.read_text(encoding="utf-8"))
    h = hashlib.sha256(LIMITS.read_bytes()).hexdigest()[:12]
    regeln = []
    for sek, v in L.items():
        if not isinstance(v, dict):
            continue
        for k, r in v.items():
            if isinstance(r, dict) and "wert" in r:
                regeln.append((f"{sek}.{k}", sek, r))
    fehlt = [rid for rid, *_ in regeln if rid not in R]
    if fehlt:
        raise SystemExit(f"Regeln ohne Eintrag in der Prüfmappe: {fehlt}")
    fragen_liste = FRAGEN
    if kurz:
        ids = [r[0] for r in regeln]
        unbekannt = [k for k in KURZ_REGELN if k not in ids]
        assert not unbekannt and len(KURZ_REGELN) <= 20, unbekannt
        regeln = sorted((r for r in regeln if r[0] in KURZ_REGELN), key=lambda r: KURZ_REGELN.index(r[0]))
        titel_fragen = {t for t, _ in FRAGEN}
        assert all(t in titel_fragen for t in KURZ_FRAGEN), [t for t in KURZ_FRAGEN if t not in titel_fragen]
        fragen_liste = [f for t in KURZ_FRAGEN for f in FRAGEN if f[0] == t]
    titel = {"gartenhaus": "Gartenhaus", "carport": "Carport", "abstand": "Abstandsflächen", "grenzbebauung": "Bebauung an der Grenze",
             "bestand": "Bestehende Kleinbauten", "waermepumpe": "Wärmepumpe", "aussengeraete": "Außengeräte (Klimagerät, Pool-Wärmepumpe)", "grossesVorhaben": "Großes Vorhaben (zweites Wohnhaus, Anbau, Aufstockung)", "pflanzen": "Hecken und Bäume (Nachbarrecht)",
             "verfahren": "Verfahren und Antrag"}
    karten, akt, nr = [], None, 0
    for rid, sek, r in regeln:
        if sek != akt and not kurz:
            akt = sek
            karten.append(f'<h2 class="sek">{e(titel.get(sek, sek))}</h2>')
        nr += 1
        x = R[rid]
        wert = r["wert"]
        wert_s = json.dumps(wert, ensure_ascii=False) if not isinstance(wert, (int, float, str, bool)) else str(wert).replace("True", "ja").replace("False", "nein")
        if isinstance(wert, bool):
            wert_s = "ja" if wert else "nein"
        if rid == "verfahren.links":
            wert_s = "Links (siehe App)"
        link = LINKS.get(x["link"]) if x["link"] else None
        art = "Regel aus Gesetz/Norm" if x["link"] and x["link"] not in ("LAI", "KEYMARK", "STMB") else "Festlegung/Annahme Passt." if not x["link"] else "Fachliche Quelle"
        karten.append(f"""
<section class="regel">
  <div class="kopf"><span class="nr">{nr}</span><code>{e(rid)}</code><span class="wert">Wert: <b>{e(wert_s)}</b></span><span class="art">{art}</span></div>
  <dl>
    <dt>Quelle</dt><dd>{e(r.get('quelle', ''))}</dd>
    <dt>Gesetzestext</dt><dd class="gesetz">{x['text']()}</dd>
    {f'<dt>Amtlicher Text</dt><dd class="link">{e(link)}</dd>' if link else ''}
    <dt>Unsere Auslegung</dt><dd>{e(r.get('text', '') or '–')}</dd>
    <dt>So rechnet Passt.</dt><dd>{e(x['umsetzung'])}</dd>
    <dt>Beispiel</dt><dd>{e(x['beispiel'])}</dd>
  </dl>
  <div class="pruef"><span class="box"></span> korrekt <span class="box"></span> falsch <span class="box"></span> unklar
    <div class="anm">Anmerkung:</div></div>
</section>""")
    fragen = "".join(f"""
<section class="frage"><div class="kopf"><span class="nr">F{i}</span><b>{e(t)}</b></div><p>{e(q)}</p>
<div class="antwort">Antwort:</div></section>""" for i, (t, q) in enumerate(fragen_liste, 1))
    heute = date.today().strftime("%d.%m.%Y")
    return f"""<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Passt. – Prüfmappe Regelwerk{" (Kurzfassung)" if kurz else ""}</title>
<style>
@page {{ size: A4; margin: 16mm 14mm 18mm; }}
body {{ font: 9.6pt/1.4 "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; }}
h1 {{ font-size: 22pt; margin: 0 0 4mm; }} h1 span {{ color: #2e7d4f; }}
h2.sek {{ font-size: 13pt; margin: 6mm 0 2mm; border-bottom: 1.5px solid #1a1a1a; padding-bottom: 1mm; break-after: avoid; }}
.titel {{ height: 245mm; display: flex; flex-direction: column; justify-content: space-between; break-after: page; }}
.titel p {{ max-width: 150mm; }}
.meta td {{ padding: 1mm 4mm 1mm 0; vertical-align: top; }}
.regel, .frage {{ border: 1px solid #bbb; border-radius: 2mm; padding: 2.5mm 3mm; margin: 0 0 3mm; break-inside: avoid; }}
.kopf {{ display: flex; gap: 3mm; align-items: baseline; flex-wrap: wrap; margin-bottom: 1.5mm; }}
.nr {{ background: #1a1a1a; color: #fff; border-radius: 1mm; padding: 0 1.5mm; font-weight: 700; font-size: 8.5pt; }}
code {{ font-size: 9pt; font-weight: 700; }}
.wert {{ margin-left: auto; }} .art {{ font-size: 8pt; color: #555; border: 1px solid #999; border-radius: 1mm; padding: 0 1.2mm; }}
dl {{ display: grid; grid-template-columns: 30mm 1fr; gap: 0.8mm 3mm; margin: 0; }}
dt {{ color: #555; font-size: 8.5pt; }} dd {{ margin: 0; }}
dd.gesetz {{ font-family: Georgia, serif; font-size: 9pt; background: #f4f4f1; padding: 1mm 1.5mm; }}
dd.link {{ font-size: 8pt; word-break: break-all; color: #1d4f91; }}
sup {{ font-size: 6.5pt; }}
.pruef {{ margin-top: 2mm; font-size: 9pt; }}
.box {{ display: inline-block; width: 3.2mm; height: 3.2mm; border: 1px solid #1a1a1a; vertical-align: -0.6mm; margin: 0 1mm 0 3mm; }}
.box:first-child {{ margin-left: 0; }}
.anm, .antwort {{ margin-top: 1.5mm; height: 11mm; border-bottom: 1px dotted #888; color: #555; font-size: 8.5pt; }}
.antwort {{ height: 18mm; }}
.hinweis {{ background: #fff6dd; border: 1px solid #e0c060; padding: 2mm 3mm; border-radius: 2mm; }}
.umbruch {{ break-before: page; }}
</style></head><body>
<div class="titel">
 <div>
  <h1>Passt<span>.</span> – Prüfmappe Regelwerk{" – Kurzfassung für die Demo" if kurz else ""}</h1>
  {"<p><b>Kurzfassung:</b> nur die " + str(len(regeln)) + " Regeln und " + str(len(fragen_liste)) + " Fragen, die in den drei Demo-Abläufen vorkommen (Gartenhaus an der Grenze, Hanglage, Wärmepumpe nah am Nachbarn), nach Wichtigkeit für die Demo geordnet. Die vollständige Prüfmappe (alle Regeln und Fragen, auch Außengeräte, Hecken, großes Vorhaben) ist <code>pruefmappe.html</code>.</p>" if kurz else ""}
  <p style="font-size:12pt">Bitte prüfen Sie jede Regel, mit der Passt. Hausbesitzern eine erste Orientierung gibt:
  „Darf ich das hier hinstellen?“ (Gartenhaus, Carport, Außengeräte wie Wärmepumpe, Klimagerät und Pool-Wärmepumpe, Hecken und Bäume, dazu das „große Vorhaben“: zweites Wohnhaus, Anbau, Aufstockung – in Sulzbach-Rosenberg).</p>
  <div class="hinweis"><b>Wichtig:</b> Passt. gibt Orientierung, keine Genehmigung. Jede Regel steht in
  <code>limits.json</code> mit <code>geprueft: false</code> und wird erst nach Ihrer Prüfung freigegeben.
  Gesetzestexte wurden am 04.10.2026 aus zwei unabhängigen Wiedergaben übernommen und Wort für Wort verglichen;
  das amtliche Portal gesetze-bayern.de war für automatischen Abruf gesperrt. Bitte lesen Sie die Regel im
  Zweifel am angegebenen amtlichen Text nach.</div>
  <h3>So geht's</h3>
  <ol><li>Je Regel: Gesetzestext, unsere Auslegung, wie Passt. rechnet, ein Beispiel.</li>
  <li>Bitte ankreuzen: <b>korrekt</b>, <b>falsch</b> oder <b>unklar</b>, und bei Bedarf eine Anmerkung.</li>
  <li>Am Ende: {len(fragen_liste)} gezielte Fragen zu Auslegungen, die das Gesetz offenlässt.</li></ol>
 </div>
 <table class="meta">
  <tr><td>Stand</td><td>{heute}</td></tr>
  <tr><td>Regeln</td><td>{len(regeln)}{' von ' + str(len(R)) + ' (Kurzfassung)' if kurz else ''} (aus <code>app/src/rules/limits.json</code>, SHA-256 {h}…)</td></tr>
  <tr><td>Geprüft von</td><td>______________________________ (Name, Funktion)</td></tr>
  <tr><td>Datum, Unterschrift</td><td>______________________________</td></tr>
  <tr><td>Rückfragen</td><td>Emil (Passt.) – ______________________________</td></tr>
 </table>
</div>
{''.join(karten)}
<h2 class="sek umbruch">Gezielte Fragen</h2>
<p>Hier ist das Gesetz nicht eindeutig oder Passt. musste vereinfachen. Ihre Antwort fließt direkt in das Regelwerk ein.</p>
{fragen}
</body></html>"""


def main() -> int:
    AUS.mkdir(parents=True, exist_ok=True)
    (AUS / "pruefmappe.html").write_text(seite(), encoding="utf-8")
    print(f"→ {AUS / 'pruefmappe.html'} ({len(R)} Regeln, {len(FRAGEN)} Fragen)")
    (AUS / "pruefmappe_kurz.html").write_text(seite(kurz=True), encoding="utf-8")
    print(f"→ {AUS / 'pruefmappe_kurz.html'} ({len(KURZ_REGELN)} Regeln, {len(KURZ_FRAGEN)} Fragen)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
