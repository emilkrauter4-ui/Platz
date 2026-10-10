/**
 * Planungsrecht als Wegweiser, nicht als Urteil (AUFTRAG_V3 B3). Passt. prüft hier nichts und vergibt keine Ampel.
 * Was die Gemeinde entscheidet: Bebauungsplan (§ 30 BauGB), Einfügen in die Umgebung (§ 34 BauGB), Außenbereich (§ 35 BauGB),
 * Abweichungen zugunsten von Wohnungsbau („Bau-Turbo“, § 246e BauGB), Teilung des Grundstücks. Wortlaut: docs/recht/BauGB_34_246e.txt.
 * Reine Funktionen.
 */
import L from './limits.json';
import { area, centroid, pointInPolygon, polygonDistance, polygonSegment } from './geometry';
import type { Building, Provenance, Site, Vec2 } from './types';

const G = L.grossesVorhaben;
export const UMFELD_RADIUS_M: number = G.umfeldRadiusM.wert;

/** Ein Plan aus dem Landesportal (nur Verweis, Inhalt wird nicht ausgelesen). */
export interface BPlanTreffer {
  name: string;
  nummer?: string;
  gemeinde?: string;
  inkraft?: string;
  /** Planzeichnung (Scan) */
  planUrl?: string;
  /** Text der Festsetzungen */
  textUrl?: string;
  art: 'rechtskraft' | 'im_verfahren' | 'fplan';
}

export interface Spanne {
  min: number;
  median: number;
  max: number;
}

export interface UmfeldStatistik {
  radiusM: number;
  /** Hauptgebäude im Umkreis (Grundfläche ≥ 40 m², Traufe ≥ 3 m) */
  n: number;
  traufe: Spanne | null;
  first: Spanne | null;
  grundflaeche: Spanne | null;
  /** Hauptgebäude in zweiter Reihe (ein anderes Gebäude liegt zwischen ihnen und der Straße); null = ohne Straßendaten nicht bestimmbar */
  zweiteReihe: number | null;
  /** Wie viele davon mit LoD2-Höhen */
  mitHoehe: number;
}

const spanne = (xs: number[]): Spanne | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return { min: s[0], median: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2, max: s[s.length - 1] };
};

/** Hauptgebäude der Umgebung: Grundfläche ab 40 m² und (falls bekannt) Traufe ab 3 m – Garagen und Schuppen zählen nicht. */
export function istHauptgebaeude(b: Building): boolean {
  return area(b.footprint) >= 40 && (b.trauf == null || b.trauf >= 3);
}

/**
 * Orientierung für § 34 Abs. 1 BauGB: Zahlen aus LoD2 und Hausumringen im Umkreis um das Vorhaben. Das Vorhaben selbst und
 * das eigene Grundstück zählen nicht mit (`ausser`: Gebäude-IDs, z. B. das aufgestockte Haus).
 */
export function umfeldStatistik(site: Site, mitte: Vec2, strassen: Vec2[][] = [], radius = UMFELD_RADIUS_M): UmfeldStatistik {
  const plot = site.plot.boundary;
  const hg = site.buildings.filter((b) => !pointInPolygon(centroid(b.footprint), plot) && istHauptgebaeude(b) && polygonDistance([mitte], b.footprint) <= radius);
  const mit = hg.filter((b) => b.trauf != null);
  let zweite: number | null = null;
  const nahe = strassen.filter((s) => polygonDistance([mitte], s) < radius + 100);
  if (nahe.length) {
    zweite = 0;
    for (const b of hg) {
      const c = centroid(b.footprint);
      // nächster Straßenpunkt: Eckpunkt der nächsten Straßenfläche
      let best: { d: number; q: Vec2 } | null = null;
      for (const s of nahe) {
        for (let i = 0; i < s.length; i++) {
          const q = s[i];
          const d = Math.hypot(q[0] - c[0], q[1] - c[1]);
          if (!best || d < best.d) best = { d, q };
        }
      }
      if (!best || best.d < 25) continue;
      // liegt ein anderes Hauptgebäude zwischen Straße und diesem Gebäude?
      const verdeckt = hg.some((o) => o !== b && polygonSegment(o.footprint, best!.q, c).d < 0.01 && polygonDistance([c], o.footprint) > 1);
      if (verdeckt) zweite++;
    }
  }
  return {
    radiusM: radius,
    n: hg.length,
    traufe: spanne(mit.map((b) => b.trauf!)),
    first: spanne(mit.filter((b) => b.first != null).map((b) => b.first!)),
    grundflaeche: spanne(hg.map((b) => area(b.footprint))),
    zweiteReihe: zweite,
    mitHoehe: mit.length,
  };
}

export interface Hinweis {
  id: 'bplan' | 'paragraf34' | 'bauturbo' | 'aussenbereich' | 'teilung';
  titel: string;
  text: string;
  quelle: string;
  /** Herkunft: 'amtlich' (Landesportal), 'Orientierung', 'offen', 'Annahme' … */
  kind: Provenance | 'rule';
  /** Verweise (Plan, Text) */
  links?: { text: string; url: string }[];
  /** Zahlen für § 34 */
  umfeld?: UmfeldStatistik;
}

export interface GemeindeAbschnitt {
  titel: string;
  einleitung: string;
  hinweise: Hinweis[];
  /** der Weg: erst fragen */
  weg: { titel: string; text: string };
}

export function spannenText(s: Spanne | null, einheit: string, d = 1): string {
  if (!s) return 'unbekannt';
  const f = (v: number) => v.toFixed(d).replace('.', ',');
  return `${f(s.min)} bis ${f(s.max)} ${einheit}, mittlere ${f(s.median)} ${einheit}`;
}

export function gemeindeAbschnitt(
  site: Site,
  art: 'wohnhaus' | 'anbau' | 'aufstockung',
  umfeld: UmfeldStatistik | null,
  plaene: BPlanTreffer[] | null | undefined,
  gemeindeName: string | null,
): GemeindeAbschnitt {
  const hinweise: Hinweis[] = [];
  const rechtskraft = (plaene ?? []).filter((p) => p.art === 'rechtskraft');
  const imVerfahren = (plaene ?? []).filter((p) => p.art === 'im_verfahren');
  const aussen = site.bereich.value === 'aussen';

  // --- Bebauungsplan
  if (plaene === undefined) {
    hinweise.push({ id: 'bplan', titel: 'Bebauungsplan', text: 'Wird beim Landesportal abgefragt …', quelle: G.bebauungsplan.quelle, kind: 'offen' });
  } else if (plaene === null) {
    hinweise.push({ id: 'bplan', titel: 'Bebauungsplan', text: 'Das Landesportal war nicht erreichbar. Ob ein Bebauungsplan gilt, ist offen – frag die Gemeinde. Im Geltungsbereich eines Bebauungsplans ist ein Vorhaben nur zulässig, wenn es den Festsetzungen nicht widerspricht (§ 30 BauGB).', quelle: G.bebauungsplan.quelle, kind: 'offen' });
  } else if (rechtskraft.length) {
    hinweise.push({
      id: 'bplan',
      titel: 'Bebauungsplan',
      text: `Das Landesportal zeigt für das Grundstück ${rechtskraft.length === 1 ? 'diesen Bebauungsplan' : 'diese Bebauungspläne'}: ${rechtskraft.map((p) => `„${p.name}“${p.nummer ? ` (Nr. ${p.nummer})` : ''}${p.inkraft ? `, in Kraft seit ${p.inkraft}` : ''}`).join('; ')}. Er bestimmt, ob und wie hier gebaut werden darf (§ 30 BauGB). Passt. liest die Festsetzungen nicht aus und prüft sie nicht – lies den Plan oder frag die Gemeinde. Ein zweites Wohnhaus, ein Anbau oder eine Aufstockung kann ihm widersprechen, auch wenn die Abstandsflächen passen.`,
      quelle: G.bebauungsplan.quelle,
      kind: 'amtlich',
      links: rechtskraft.flatMap((p) => [
        ...(p.planUrl ? [{ text: `Plan „${p.name}“`, url: p.planUrl }] : []),
        ...(p.textUrl ? [{ text: `Text „${p.name}“`, url: p.textUrl }] : []),
      ]),
    });
  } else {
    hinweise.push({
      id: 'bplan',
      titel: 'Bebauungsplan',
      text: `Das Landesportal zeigt hier keinen rechtskräftigen Bebauungsplan${imVerfahren.length ? `, aber einen im Verfahren: ${imVerfahren.map((p) => `„${p.name}“`).join(', ')}` : ''}. Das Portal ist nicht flächendeckend; ob doch ein Plan gilt, weiß ${gemeindeName ? `die Stadt ${gemeindeName}` : 'die Gemeinde'}.`,
      quelle: G.bebauungsplan.quelle,
      kind: 'amtlich',
      links: imVerfahren.flatMap((p) => (p.planUrl ? [{ text: `Plan im Verfahren „${p.name}“`, url: p.planUrl }] : [])),
    });
  }

  // --- § 34 Orientierung (nur ohne Bebauungsplan, im Innenbereich)
  if (!rechtskraft.length && !aussen) {
    const u = umfeld;
    const zahlen = u && u.n
      ? `Im Umkreis von ${u.radiusM} m um das Vorhaben stehen ${u.n} Hauptgebäude (ohne dein Grundstück). Traufhöhen: ${spannenText(u.traufe, 'm')}. Firsthöhen: ${spannenText(u.first, 'm')}. Grundflächen: ${spannenText(u.grundflaeche, 'm²', 0)}.${u.zweiteReihe == null ? ' Gebäude in zweiter Reihe: ohne Straßendaten nicht bestimmbar.' : ` Davon in zweiter Reihe: ${u.zweiteReihe}.`}`
      : 'Im Umkreis sind keine Hauptgebäude in den Daten.';
    hinweise.push({
      id: 'paragraf34',
      titel: 'Einfügen in die Umgebung (§ 34 BauGB)',
      text: `Ohne Bebauungsplan ist ein Vorhaben im bebauten Ortsteil zulässig, wenn es sich „nach Art und Maß der baulichen Nutzung, der Bauweise und der Grundstücksfläche, die überbaut werden soll, in die Eigenart der näheren Umgebung einfügt und die Erschließung gesichert ist“. ${zahlen} Das ist Orientierung aus amtlichen Gebäudedaten, keine Aussage, ob sich das Vorhaben einfügt – das beurteilt die Gemeinde. Es gibt dafür keine Ampel.`,
      quelle: G.paragraf34.quelle,
      kind: 'Orientierung',
      umfeld: u ?? undefined,
    });
  }

  // --- Außenbereich
  if (aussen) {
    hinweise.push({
      id: 'aussenbereich',
      titel: 'Außenbereich',
      text: 'Du hast die Lage „Außenbereich“ gewählt oder sie wurde angenommen. Dort ist ein Vorhaben „nur zulässig“, wenn öffentliche Belange nicht entgegenstehen, die Erschließung gesichert ist und es zu den privilegierten Vorhaben gehört (§ 35 Abs. 1 BauGB); sonstige Vorhaben können nur im Einzelfall zugelassen werden, wenn sie öffentliche Belange nicht beeinträchtigen (Abs. 2). Ein zweites Wohnhaus gehört in der Regel nicht zu den privilegierten Vorhaben. Dort gelten andere, deutlich strengere Regeln als im Ort.',
      quelle: G.aussenbereich.quelle,
      kind: 'Annahme',
    });
  }

  // --- Bau-Turbo
  hinweise.push({
    id: 'bauturbo',
    titel: 'Bau-Turbo',
    text: 'Das Baugesetzbuch lässt seit 2025 zugunsten von Wohnungsbau Abweichungen zu: Mit Zustimmung der Gemeinde kann bis zum 31. Dezember 2030 von Vorschriften des Baugesetzbuchs abgewichen werden, wenn das Vorhaben dem Wohnungsbau dient und die Abweichung unter Würdigung nachbarlicher Interessen mit den öffentlichen Belangen vereinbar ist (§ 246e; ähnlich § 34 Abs. 3b für Wohngebäude im bebauten Ortsteil). Deine Gemeinde kann davon Gebrauch machen, das liegt in ihrem Ermessen. Passt. kann nicht sagen, ob sie es tut.',
    quelle: G.bauTurbo.quelle,
    kind: 'rule',
  });

  // --- Teilung
  if (art === 'wohnhaus') {
    hinweise.push({
      id: 'teilung',
      titel: 'Grundstück teilen?',
      text: 'Nur zur Information: Wird das Grundstück geteilt, damit das zweite Haus ein eigenes Grundstück bekommt, braucht jedes Teilgrundstück den Anschluss an eine befahrbare öffentliche Verkehrsfläche in angemessener Breite (BayBO Art. 4 Abs. 1 Nr. 2), und die Abstandsflächen müssen auf dem jeweiligen Grundstück liegen (Art. 6 Abs. 2). Passt. prüft das nicht; Bauamt und Vermessungsamt klären die Teilung.',
      quelle: G.grundstuecksteilung.quelle,
      kind: 'rule',
    });
  }

  return {
    titel: 'Was die Gemeinde entscheidet',
    einleitung: 'Ob du das bauen darfst, entscheidet am Ende die Gemeinde bzw. die Bauaufsichtsbehörde, nicht Passt. Die Ampel oben zeigt nur, was sich messen lässt.',
    hinweise,
    weg: {
      titel: 'Bauvoranfrage empfohlen',
      text: `Bevor du planen und zahlen lässt: Stell eine Bauvoranfrage (Vorbescheid, BayBO Art. 71) bei ${gemeindeName ? `der Stadt ${gemeindeName} bzw. ` : ''}der Bauaufsichtsbehörde. „Vor Einreichung des Bauantrags ist auf Antrag des Bauherrn zu einzelnen Fragen des Bauvorhabens ein Vorbescheid zu erteilen.“ Passt. erstellt dafür eine Lageplan-Skizze, die Kubatur (${art === 'aufstockung' ? 'Höhen' : 'Grundfläche, Höhen, Rauminhalt'}) und eine Fragenliste an die Gemeinde.`,
    },
  };
}

/** Fragen an die Gemeinde für die Bauvoranfrage (Vorbescheid), abhängig vom Befund. */
export function fragenAnGemeinde(
  art: 'wohnhaus' | 'anbau' | 'aufstockung',
  site: Site,
  plaene: BPlanTreffer[] | null | undefined,
  umfeld: UmfeldStatistik | null,
  afAusserhalb: boolean,
): string[] {
  const q: string[] = [];
  const bplan = (plaene ?? []).some((p) => p.art === 'rechtskraft');
  const name = { wohnhaus: 'ein zweites Wohnhaus', anbau: 'ein Anbau', aufstockung: 'eine Aufstockung' }[art];
  if (site.bereich.value === 'aussen') q.push(`Liegt das Grundstück im Außenbereich (§ 35 BauGB)? Wenn ja: Ist ${name} dort überhaupt zulassungsfähig?`);
  else q.push(bplan ? `Ist ${name} nach den Festsetzungen des Bebauungsplans zulässig (Art und Maß der Nutzung, überbaubare Fläche, Geschosse, Dachform)?` : `Liegt das Grundstück im bebauten Ortsteil (§ 34 BauGB), und fügt sich ${name} nach Art und Maß der Nutzung, Bauweise und überbauter Grundfläche in die nähere Umgebung ein?`);
  if (art === 'wohnhaus') q.push('Ist eine Bebauung in zweiter Reihe an dieser Stelle planungsrechtlich möglich?');
  if (umfeld?.n && !bplan && site.bereich.value !== 'aussen') q.push('Welche Gebäude zählen zur „näheren Umgebung“ (Passt. hat Hauptgebäude im Umkreis von 100 m als Orientierung gezählt)?');
  q.push(afAusserhalb ? 'Wäre die Abweichung von den Abstandsflächen (Art. 63 BayBO) möglich, oder genügt die Zustimmung des Nachbarn (Art. 6 Abs. 2 Satz 3)?' : 'Gelten für das Grundstück Satzungen zu Abstandsflächen oder Stellplätzen, die von der BayBO abweichen?');
  q.push('Ist die Erschließung (Zufahrt, Wasser, Abwasser) gesichert, und welche Breite der Zufahrt verlangt die Feuerwehr (Art. 4, 5 BayBO)?');
  q.push('Kann die Gemeinde von den Möglichkeiten des „Bau-Turbo“ (§ 246e BauGB bzw. § 34 Abs. 3b BauGB) Gebrauch machen?');
  if (art === 'wohnhaus') q.push('Welche Stellplätze sind für das zweite Wohnhaus nachzuweisen (Stellplatzsatzung)?');
  return q;
}
