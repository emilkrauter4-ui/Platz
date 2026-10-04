/**
 * Vom Nein zum Antrag (AUFTRAG_V2 Phase 4.1): Welches Verfahren folgt aus den Befunden, welche Unterlagen braucht es,
 * und wer muss sie erstellen? Wortlaut: docs/recht/BayBO_Verfahren_BauVorlV.txt. Nur Information – entscheiden tut
 * die Bauaufsichtsbehörde. Reine Funktionen.
 */
import L from './limits.json';
import { rauminhalt } from './abstand';
import { fmt } from './evaluate';
import type { Befund, Placed, Provenance, Result, Site } from './types';

const V = L.verfahren;

export type Verfahren =
  /** erst die Lage korrigieren (außerhalb, Kollision) */
  | 'lage'
  /** verfahrensfrei, alles eingehalten */
  | 'frei'
  /** verfahrensfrei, aber Abstandsflächen/Grenzbebauung nicht eingehalten → Abweichung (Art. 63 Abs. 2 Satz 2) */
  | 'frei_abweichung'
  /** genehmigungspflichtig (ggf. Freistellung im Bebauungsplan, Art. 58) */
  | 'genehmigung';

export interface Punkt {
  text: string;
  quelle: string;
  kind: 'rule' | Provenance;
}

export interface ChecklistenEintrag {
  id: string;
  titel: string;
  quelle: string;
  /** Was Passt. dazu beitragen kann */
  passt: 'skizze' | 'daten' | 'nein';
  hinweis: string;
  noetig: 'ja' | 'wenn' | 'nein';
}

export interface VerfahrensErgebnis {
  verfahren: Verfahren;
  titel: string;
  gruende: Punkt[];
  schritte: Punkt[];
  entwurfsverfasser: { noetig: boolean; wer: string; quelle: string; offen?: string } | null;
  checkliste: ChecklistenEintrag[];
}

const GRUND: Record<Befund, { text: string; quelle: string }> = {
  ausserhalb: { text: 'Das Objekt steht nicht ganz auf dem Grundstück.', quelle: 'Passt.-Prüfung' },
  kollision: { text: 'Das Objekt überschneidet sich mit einem Gebäude oder Objekt.', quelle: 'Passt.-Prüfung' },
  aussenbereich: { text: 'Im Außenbereich sind auch kleine Nebengebäude nicht verfahrensfrei.', quelle: 'BayBO Art. 57 Abs. 1 Nr. 1' },
  aufenthaltsraum: { text: 'Mit Aufenthaltsraum, Toilette oder Feuerstätte ist ein Gartenhaus nicht verfahrensfrei.', quelle: 'BayBO Art. 57 Abs. 1 Nr. 1 Buchst. a' },
  groesse: { text: 'Größer als die Grenze für verfahrensfreie Vorhaben.', quelle: 'BayBO Art. 57 Abs. 1 Nr. 1' },
  af_nachbar: { text: 'Die Abstandsfläche reicht auf das Nachbargrundstück.', quelle: 'BayBO Art. 6 Abs. 2' },
  af_haus: { text: 'Die Abstandsflächen überdecken sich mit denen deines Hauses.', quelle: 'BayBO Art. 6 Abs. 3' },
  grenze_wandhoehe: { text: 'An der Grenze ist die mittlere Wandhöhe über 3 m.', quelle: 'BayBO Art. 6 Abs. 7' },
  grenze_seite: { text: 'An einer Grundstücksseite stehen mehr als 9 m an der Grenze.', quelle: 'BayBO Art. 6 Abs. 7' },
  grenze_gesamt: { text: 'An allen Grenzen zusammen stehen mehr als 15 m.', quelle: 'BayBO Art. 6 Abs. 7' },
};

const LAGE: Befund[] = ['ausserhalb', 'kollision'];
const PFLICHT: Befund[] = ['aussenbereich', 'aufenthaltsraum', 'groesse'];
const ABSTAND: Befund[] = ['af_nachbar', 'af_haus', 'grenze_wandhoehe', 'grenze_seite', 'grenze_gesamt'];

export function verfahrenFuer(site: Site, k: 'gartenhaus' | 'carport', o: Placed, res: Result): VerfahrensErgebnis {
  const b = res.befunde ?? [];
  const gruende: Punkt[] = b.map((x) => ({ ...GRUND[x], kind: 'rule' as const }));
  const abw = b.filter((x) => ABSTAND.includes(x));
  const verfahren: Verfahren = b.some((x) => LAGE.includes(x)) ? 'lage' : b.some((x) => PFLICHT.includes(x)) ? 'genehmigung' : abw.length ? 'frei_abweichung' : 'frei';
  const schritte: Punkt[] = [];
  let titel: string;
  const bplan = site.bplan.status;

  if (verfahren === 'lage') {
    titel = 'Erst die Lage klären.';
    schritte.push({ text: 'Verschieb das Objekt so, dass es ganz auf dem Grundstück steht und nichts überschneidet. Dann prüft Passt. neu.', quelle: 'Passt.-Prüfung', kind: 'rule' });
  } else if (verfahren === 'frei') {
    titel = 'Kein Antrag nötig.';
    schritte.push({ text: V.pflichtenAuchVerfahrensfrei.text, quelle: V.pflichtenAuchVerfahrensfrei.quelle, kind: 'rule' });
  } else if (verfahren === 'frei_abweichung') {
    titel = 'Ohne Genehmigung – aber mit Abweichungsantrag.';
    schritte.push({ text: 'Das Vorhaben ist verfahrensfrei, hält aber die Abstandsflächen nicht ein. Auch verfahrensfreie Vorhaben müssen sie einhalten.', quelle: V.pflichtenAuchVerfahrensfrei.quelle, kind: 'rule' });
    schritte.push({ text: 'Weg 1: Abweichung gesondert schriftlich bei der Bauaufsichtsbehörde beantragen und begründen.', quelle: V.abweichung.quelle, kind: 'rule' });
    if (abw.includes('af_nachbar')) schritte.push({ text: 'Weg 2: Reicht die Abstandsfläche auf das Nachbargrundstück, darf sie dort liegen, wenn der Nachbar schriftlich zustimmt (Übernahme der Abstandsfläche).', quelle: 'BayBO Art. 6 Abs. 2 Satz 3', kind: 'rule' });
    schritte.push({ text: 'Weg 3: Ändern – kleiner, niedriger oder weiter weg. „Wo darf es hin?“ zeigt passende Stellen.', quelle: 'Passt.', kind: 'rule' });
  } else {
    titel = 'Hier braucht es einen Bauantrag.';
    if (bplan === 'vorhanden') schritte.push({ text: V.genehmigungsfreistellung.text, quelle: V.genehmigungsfreistellung.quelle, kind: 'rule' });
    else schritte.push({ text: `Liegt das Grundstück in einem Bebauungsplan, kann statt der Genehmigung die Genehmigungsfreistellung gelten (${V.genehmigungsfreistellung.quelle}). Ob es einen gibt, ist noch offen.`, quelle: V.genehmigungsfreistellung.quelle, kind: 'offen' });
    schritte.push({ text: V.vereinfachtesVerfahren.text, quelle: V.vereinfachtesVerfahren.quelle, kind: 'rule' });
    schritte.push({ text: V.bauantrag.text, quelle: V.bauantrag.quelle, kind: 'rule' });
    if (abw.length) schritte.push({ text: 'Die Abstandsflächen sind nicht eingehalten: Den Abweichungsantrag mit dem Bauantrag stellen.', quelle: V.abweichung.quelle, kind: 'rule' });
    schritte.push({ text: `${V.nachbarbeteiligung.text} Der Nachbar-Link von Passt. ersetzt diese Unterschrift nicht.`, quelle: V.nachbarbeteiligung.quelle, kind: 'rule' });
    schritte.push({ text: 'Zuständig ist die untere Bauaufsichtsbehörde (Stadt oder Landratsamt) – vorher anrufen und fragen, ob sie den Digitalen Bauantrag anbietet.', quelle: 'Passt.-Hinweis', kind: 'offen' });
  }

  // Entwurfsverfasser (Art. 61): nur für nicht verfahrensfreie Errichtung von Gebäuden
  let entwurfsverfasser: VerfahrensErgebnis['entwurfsverfasser'] = null;
  if (verfahren === 'genehmigung') {
    if (k === 'carport' && o.w * o.d <= V.kleingarageBisM2.wert + 1e-9) {
      entwurfsverfasser = {
        noetig: true,
        wer: `Architekt/in oder eingetragene/r Ingenieur/in; weil der Carport mit ${fmt(o.w * o.d, 1)} m² als Kleingarage gilt, auch Ingenieur/in (Architektur, Hochbau, Bauingenieurwesen), staatlich geprüfte/r Techniker/in Bautechnik oder Maurer-/Zimmerermeister/in.`,
        quelle: 'BayBO Art. 61 Abs. 1 bis 3, GaStellV § 1 Abs. 1 Satz 3, Abs. 7',
      };
    } else {
      entwurfsverfasser = {
        noetig: true,
        wer: 'Architekt/in oder in die Liste der Bayerischen Ingenieurekammer-Bau eingetragene/r Ingenieur/in.',
        quelle: 'BayBO Art. 61 Abs. 1 und 2',
        offen: k === 'gartenhaus' ? 'Ob ein Gartenhaus unter die erweiterten Gruppen nach Art. 61 Abs. 3 fällt, sagt der Wortlaut nicht ausdrücklich – bei der Bauaufsichtsbehörde nachfragen.' : undefined,
      };
    }
  }

  const checkliste: ChecklistenEintrag[] = verfahren === 'genehmigung' ? [
    { id: 'katasterauszug', titel: 'Auszug aus dem Katasterwerk (Flurkarte, mind. 50 m Umkreis)', quelle: 'BauVorlV § 3 Nr. 1, § 7 Abs. 1 und 2', passt: 'nein', noetig: 'ja', hinweis: 'Beglaubigt oder über das automatisierte Abrufverfahren – beim Amt für Digitalisierung, Breitband und Vermessung. Passt. hat keine amtlichen Flurstücke.' },
    { id: 'lageplan', titel: 'Lageplan auf Grundlage des Katasterauszugs (nicht kleiner als 1:1000)', quelle: 'BauVorlV § 3 Nr. 1, § 7 Abs. 2 und 3', passt: 'skizze', noetig: 'ja', hinweis: 'Passt. liefert eine Skizze mit Außenmaßen, Abständen zu den Grenzen, Abstandsflächen und den Höhen der Nachbarhäuser aus LoD2. Keine amtliche Lageplanunterlage.' },
    { id: 'bauzeichnungen', titel: 'Bauzeichnungen 1:100: Grundriss, Schnitt, Ansichten', quelle: 'BauVorlV § 3 Nr. 2, § 8', passt: 'skizze', noetig: 'ja', hinweis: 'Passt. zeichnet Grundriss, Ansichten und Schnitt aus deinen Maßen, mit Wandhöhe nach Art. 6 Abs. 4 und Dachneigung. Baustoffe, Farben, Gründung und Fenster ergänzt der Entwurfsverfasser.' },
    { id: 'baubeschreibung', titel: 'Baubeschreibung mit Gebäudeklasse, Höhe und Baukosten', quelle: 'BauVorlV § 3 Nr. 3, § 9', passt: 'daten', noetig: 'ja', hinweis: `Passt. trägt Nutzung, Maße${k === 'gartenhaus' ? `, Brutto-Rauminhalt ${fmt(rauminhalt(o), 1)} m³` : `, Fläche ${fmt(o.w * o.d, 1)} m²`} ein. Gebäudeklasse: freistehend bis 7 m Höhe → voraussichtlich Gebäudeklasse 1 (Art. 2 Abs. 3), vom Entwurfsverfasser zu bestätigen. Baukosten trägst du ein.` },
    { id: 'bplan', titel: 'Berechnung des Maßes der baulichen Nutzung', quelle: 'BauVorlV § 3 Nr. 7', passt: 'nein', noetig: 'wenn', hinweis: 'Nur im Geltungsbereich eines Bebauungsplans mit entsprechenden Festsetzungen.' },
    { id: 'af_uebernahme', titel: 'Erklärung über die Übernahme einer Abstandsfläche', quelle: 'BauVorlV § 3 Nr. 8, BayBO Art. 6 Abs. 2 Satz 3', passt: 'nein', noetig: abw.includes('af_nachbar') ? 'ja' : 'wenn', hinweis: 'Nur wenn die Abstandsfläche auf das Nachbargrundstück reicht und der Nachbar zustimmt.' },
    { id: 'abweichung', titel: 'Abweichungsantrag mit Begründung', quelle: 'BauVorlV § 3 Nr. 9, BayBO Art. 63 Abs. 2', passt: 'daten', noetig: abw.length ? 'ja' : 'wenn', hinweis: abw.length ? `Passt. listet, wovon abgewichen wird (${abw.map((x) => GRUND[x].quelle).join(', ')}). Die Begründung schreibst du oder der Entwurfsverfasser.` : 'Nur wenn von Anforderungen abgewichen werden soll.' },
    { id: 'standsicherheit', titel: 'Nachweis der Standsicherheit', quelle: 'BauVorlV § 3 Nr. 4', passt: 'nein', noetig: 'nein', hinweis: 'Vorzulegen nur bei Sonderbauten; ein Gartenhaus oder Carport ist in der Regel kein Sonderbau.' },
    { id: 'nachbar', titel: 'Unterschriften der Nachbarn auf Lageplan und Bauzeichnungen', quelle: 'BayBO Art. 66 Abs. 1', passt: 'nein', noetig: 'ja', hinweis: 'Schriftlich. Im Bauantrag ist anzugeben, ob zugestimmt wurde.' },
    { id: 'form', titel: 'Bauantragsformular, unterschrieben von Bauherr und Entwurfsverfasser', quelle: 'BayBO Art. 64 Abs. 4, BauVorlV § 1 Abs. 3', passt: 'nein', noetig: 'ja', hinweis: 'Amtliche Vordrucke des Staatsministeriums verwenden, oder den Digitalen Bauantrag. Auf Papier dreifach, zweifach wenn die Gemeinde selbst Bauaufsichtsbehörde ist (BauVorlV § 2).' },
  ] : verfahren === 'frei_abweichung' ? [
    { id: 'abweichung', titel: 'Abweichungsantrag, schriftlich und begründet', quelle: 'BayBO Art. 63 Abs. 2 Satz 2', passt: 'daten', noetig: 'ja', hinweis: `Passt. listet, wovon abgewichen wird (${abw.map((x) => GRUND[x].quelle).join(', ')}), und liefert eine Lageplan-Skizze. Welche Unterlagen die Behörde dazu will, vorher erfragen.` },
    { id: 'lageplan', titel: 'Lageplan-Skizze mit Abständen und Abstandsflächen', quelle: 'Passt.', passt: 'skizze', noetig: 'wenn', hinweis: 'Keine amtliche Lageplanunterlage.' },
    ...(abw.includes('af_nachbar') ? [{ id: 'af_uebernahme', titel: 'Schriftliche Zustimmung des Nachbarn zur Übernahme der Abstandsfläche', quelle: 'BayBO Art. 6 Abs. 2 Satz 3', passt: 'nein' as const, noetig: 'wenn' as const, hinweis: 'Alternative zum Abweichungsantrag.' }] : []),
  ] : [];

  return { verfahren, titel, gruende, schritte, entwurfsverfasser, checkliste };
}

export const ANTRAG_LINKS = V.links.wert;
