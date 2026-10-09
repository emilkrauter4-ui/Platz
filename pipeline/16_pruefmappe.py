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
    return "Art. 57 Abs. 1 Nr. 2: folgende Anlagen der technischen Gebäudeausrüstung: … b) sonstige Anlagen der technischen Gebäudeausrüstung"


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
    ("Bestand automatisch mitzählen", "Aus Luftbild und Laser erkannte Nebengebäude zählen ab Konfidenz 0,8 automatisch zur Grenzlänge, darunter muss der Nutzer bestätigen. Ist das als Orientierung vertretbar?"),
    ("Fläche eines Carports", "Passt. nimmt für die 50-m²-Grenze Breite × Tiefe des Carports. Zählt der Dachüberstand mit, oder nur die von Stützen umschlossene Fläche?"),
    ("Wärmepumpe", "Passt. ordnet die Wärmepumpe Art. 57 Abs. 1 Nr. 2 Buchst. b (sonstige TGA) zu. Und: Zählt bei „Höhe bis zu 2 m über der Geländeoberfläche“ (Art. 6 Abs. 1) ein Sockel oder eine Wandkonsole mit?"),
    ("Lärm: Immissionsort und Zuschläge", "Passt. rechnet den Pegel auf Fenstermitte an der Fassade (1,6 m / 4,4 m), ohne Messpunkt 0,5 m vor dem geöffneten Fenster (TA Lärm Anhang A.1.3), ohne Ton- und Impulszuschlag, nur Nachtwert. Gebietsarten: rein/allgemein/Misch. Reicht das als Orientierung, oder wo liegen wir systematisch zu niedrig?"),
    ("Pflanzen hinter Mauern", "Art. 50 Abs. 1: „nicht oder nicht erheblich überragen“. Passt. nimmt die Ausnahme nur an, wenn die Pflanze die Einfriedung nicht überragt; alles darüber ist „offen“. Gibt es eine übliche Grenze (z. B. 0,5 m)?"),
    ("Messpunkt bei Hecken", "Art. 49: „Mitte der zunächst an der Grenze befindlichen Triebe“. Passt. nähert das aus Luftbild/Laser als Heckenrand + halbe Breite an. Vertretbar?"),
    ("Hang (BGH V ZR 230/16)", "Liegt das Nachbargrundstück höher, wird die zulässige Höhe vom höheren Gelände aus gemessen. An welchem Punkt (direkt an der Grenze?) – damit Passt. das rechnen könnte."),
    ("Entwurfsverfasser für Gartenhäuser", "Bei genehmigungspflichtigen Gartenhäusern (über 75 m³) nennt Passt. Architekt oder eingetragene Ingenieure. Reichen hier auch die Personen nach Art. 61 Abs. 3 (z. B. Meister, Techniker)?"),
    ("Örtliche Satzungen", "Hat Sulzbach-Rosenberg eine Abstandsflächensatzung (Art. 6 Abs. 5 Satz 2) oder eine Gestaltungssatzung, die Nebengebäude betrifft? Passt. berücksichtigt keine."),
    ("Dachüberstand", "Art. 6 Abs. 6 Nr. 1 lässt Dachüberstände bei der Bemessung der Abstandsflächen außer Betracht – ohne Grenze im Wortlaut. Ab welchem Überstand zählt er in der Praxis doch mit (z. B. über 0,5 m oder 1,5 m wie bei Vorbauten in Nr. 2)? Zählt bei der Grenzbebauung (9 m je Seite, 15 m gesamt) die Wandlänge oder die Dachlänge? Und darf der Überstand eines Grenzgebäudes über die Grenze ragen? Passt. rechnet mit der Wand und zeigt das Dach getrennt."),
    ("Formulierung der Antworten", "Passt. formuliert „Keine Baugenehmigung nötig“ und „Laut Art. … gilt …“, immer mit dem Hinweis „Orientierung, keine Genehmigung“. Ist das so unbedenklich?"),
]


def e(s: str) -> str:
    return html.escape(s, quote=False)


def seite() -> str:
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
    titel = {"gartenhaus": "Gartenhaus", "carport": "Carport", "abstand": "Abstandsflächen", "grenzbebauung": "Bebauung an der Grenze",
             "bestand": "Bestehende Kleinbauten", "waermepumpe": "Wärmepumpe", "pflanzen": "Hecken und Bäume (Nachbarrecht)",
             "verfahren": "Verfahren und Antrag"}
    karten, akt, nr = [], None, 0
    for rid, sek, r in regeln:
        if sek != akt:
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
<div class="antwort">Antwort:</div></section>""" for i, (t, q) in enumerate(FRAGEN, 1))
    heute = date.today().strftime("%d.%m.%Y")
    return f"""<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Passt. – Prüfmappe Regelwerk</title>
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
  <h1>Passt<span>.</span> – Prüfmappe Regelwerk</h1>
  <p style="font-size:12pt">Bitte prüfen Sie jede Regel, mit der Passt. Hausbesitzern eine erste Orientierung gibt:
  „Darf ich das hier hinstellen?“ (Gartenhaus, Carport, Wärmepumpe, Hecken und Bäume in Sulzbach-Rosenberg).</p>
  <div class="hinweis"><b>Wichtig:</b> Passt. gibt Orientierung, keine Genehmigung. Jede Regel steht in
  <code>limits.json</code> mit <code>geprueft: false</code> und wird erst nach Ihrer Prüfung freigegeben.
  Gesetzestexte wurden am 04.10.2026 aus zwei unabhängigen Wiedergaben übernommen und Wort für Wort verglichen;
  das amtliche Portal gesetze-bayern.de war für automatischen Abruf gesperrt. Bitte lesen Sie die Regel im
  Zweifel am angegebenen amtlichen Text nach.</div>
  <h3>So geht's</h3>
  <ol><li>Je Regel: Gesetzestext, unsere Auslegung, wie Passt. rechnet, ein Beispiel.</li>
  <li>Bitte ankreuzen: <b>korrekt</b>, <b>falsch</b> oder <b>unklar</b>, und bei Bedarf eine Anmerkung.</li>
  <li>Am Ende: {len(FRAGEN)} gezielte Fragen zu Auslegungen, die das Gesetz offenlässt.</li></ol>
 </div>
 <table class="meta">
  <tr><td>Stand</td><td>{heute}</td></tr>
  <tr><td>Regeln</td><td>{len(regeln)} (aus <code>app/src/rules/limits.json</code>, SHA-256 {h}…)</td></tr>
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
