/**
 * Grenzabstand von Pflanzen nach dem bayerischen AGBGB, Art. 47–52 (Wortlaut: docs/recht/AGBGB_Art47-52.txt).
 *
 * Hauptfunktion ist die eigene Planung: „Wo darf ich eine Hecke pflanzen und wie hoch darf sie werden?“
 *  - Art. 47 Abs. 1: mindestens 0,50 m; Pflanzen über 2 m Höhe mindestens 2 m.
 *  - Art. 47 Abs. 2: zugunsten eines Waldgrundstücks nur 0,50 m.
 *  - Art. 48 (4 m zu Ackerland) gilt laut Art. 50 Abs. 2 nicht für Bäume im Hausgarten → Annahme Hausgarten.
 *  - Art. 49: gemessen ab Stammmitte am Boden, bei Hecken/Sträuchern ab Mitte der grenznächsten Triebe.
 *  - Art. 50 Abs. 1: nicht hinter Mauer/dichter Einfriedung, die die Pflanze nicht (erheblich) überragt; nicht längs
 *    öffentlicher Straßen und Plätze. Beides fragt Passt. je Grenzseite ab.
 *  - Art. 52: Beseitigungsanspruch verjährt in fünf Jahren; Ersatzpflanzungen müssen den Abstand wieder einhalten.
 *
 * Nachbarpflanzen werden neutral beschrieben (Maß, Spanne, Regel), ohne Ampel und ohne Wertung.
 * Reine Funktionen, keine Abhängigkeit zu Cesium oder DOM. Zivilrecht – nicht Sache des Bauamts.
 */
import L from './limits.json';
import { fmt } from './evaluate';
import { area, centroid, edges, pointInPolygon, pointSegment, segmentSegment } from './geometry';
import { FREI, GELB, GRUEN, ROT, type RasterGeometrie } from './zonen';
import type { Provenance, Row, Site, Status, Vec2, WithProvenance } from './types';

const P = L.pflanzen;
export const KLEIN_M = P.abstandKleinM.wert;
export const HOCH_M = P.abstandHochM.wert;
export const HOEHE_GRENZE_M = P.hoeheGrenzeM.wert;
const WALD_M = P.waldM.wert;
const NAHE_M = P.nachbarNaheM.wert;
const KRONE_MIN_SPANNE = 0.75;
const ART47 = 'AGBGB Art. 47';

export type PflanzenArt = 'hecke' | 'baum' | 'strauch';

/** Geplante Pflanze. Hecke: Pflanzreihe der Länge `laenge` durch `center` mit Richtung `angle`; sonst ein Stamm. */
export interface Pflanze {
  art: PflanzenArt;
  center: Vec2;
  /** nur Hecke: Länge der Pflanzreihe */
  laenge: number;
  angle: number;
  /** geplante (Endwuchs-)Höhe */
  hoehe: number;
}

/** Angaben je Grenzseite (Index wie Plot.sides). Fehlt eine Angabe, gilt die strengere Lesart und sie bleibt offen. */
export interface SeitenAngabe {
  /** Grenze zu öffentlicher Straße oder öffentlichem Platz (Art. 50 Abs. 1 Satz 2) */
  strasse?: WithProvenance<boolean>;
  /** Nachbar ist ein Waldgrundstück (Art. 47 Abs. 2) */
  wald?: WithProvenance<boolean>;
  /** Höhe einer Mauer oder dichten Einfriedung an dieser Grenze (Art. 50 Abs. 1 Satz 1); 0 = keine */
  einfriedung?: WithProvenance<number>;
}

/** Pflanzreihe bzw. Stamm als Strecke (Stamm: a = b). */
export function pflanzLinie(p: Pick<Pflanze, 'art' | 'center' | 'laenge' | 'angle'>): [Vec2, Vec2] {
  if (p.art !== 'hecke' || p.laenge <= 0) return [p.center, p.center];
  const dx = (Math.cos(p.angle) * p.laenge) / 2;
  const dy = (Math.sin(p.angle) * p.laenge) / 2;
  return [[p.center[0] - dx, p.center[1] - dy], [p.center[0] + dx, p.center[1] + dy]];
}

/** Abstand nach Art. 47 für eine Pflanzenhöhe (über 2 m → 2 m, sonst 0,50 m; Wald: immer 0,50 m). */
export function noetigerAbstand(hoehe: number, wald = false): number {
  if (wald) return WALD_M;
  return hoehe > HOEHE_GRENZE_M + 1e-9 ? HOCH_M : KLEIN_M;
}

/**
 * Wie hoch darf eine Pflanze bei diesem Abstand werden? 0 = hier gar nicht (unter 0,50 m), 2 = bis 2 m,
 * Infinity = Art. 47 begrenzt die Höhe nicht.
 */
export function maxHoehe(abstand: number, wald = false): number {
  if (abstand + 1e-9 < KLEIN_M) return 0;
  if (wald) return Infinity;
  return abstand + 1e-9 < HOCH_M ? HOEHE_GRENZE_M : Infinity;
}

/** Ausnahme nach Art. 50 Abs. 1 für diese Seite und Höhe? 'strasse' | 'einfriedung' | null */
function ausnahme(s: SeitenAngabe | undefined, hoehe: number): 'strasse' | 'einfriedung' | null {
  if (s?.strasse?.value) return 'strasse';
  const e = s?.einfriedung?.value ?? 0;
  if (e > 0 && hoehe <= e + 1e-9) return 'einfriedung';
  return null;
}

export interface SeitenErgebnis {
  seite: number;
  abstand: number;
  noetig: number;
  /** nächster Punkt auf der Pflanzreihe und auf der Grenze */
  p: Vec2;
  q: Vec2;
  ausnahme: 'strasse' | 'einfriedung' | null;
  status: Status;
}

export interface PflanzenErgebnis {
  status: Status;
  head: string;
  sub: string;
  rows: Row[];
  seiten: SeitenErgebnis[];
  /** zulässige Höhe an dieser Stelle (Infinity = keine Grenze aus Art. 47) */
  maxHoehe: number;
  dim: { p: Vec2; q: Vec2; label: string } | null;
}

const KNAPP_M = 0.1;
const ARTNAME: Record<PflanzenArt, { n: string; die: string }> = {
  hecke: { n: 'Hecke', die: 'die Hecke' },
  baum: { n: 'Baum', die: 'der Baum' },
  strauch: { n: 'Strauch', die: 'der Strauch' },
};

const segSide = (site: Site, i: number) => site.plot.segmentSide?.[i] ?? i;
const sideName = (site: Site, s: number) => site.plot.sides[s]?.grenze ?? 'an der Grenze';

/** Nächste Abstände der Pflanze zu jeder Grenzseite (je Seite das Minimum über ihre Segmente). */
function abstaendeJeSeite(site: Site, a: Vec2, b: Vec2): Map<number, { d: number; p: Vec2; q: Vec2 }> {
  const out = new Map<number, { d: number; p: Vec2; q: Vec2 }>();
  edges(site.plot.boundary).forEach(([c, d], i) => {
    const r = a[0] === b[0] && a[1] === b[1] ? { ...pointSegment(a, c, d), p: a } : segmentSegment(a, b, c, d);
    const s = segSide(site, i);
    const cur = out.get(s);
    if (!cur || r.d < cur.d) out.set(s, { d: r.d, p: r.p, q: r.q });
  });
  return out;
}

export function pruefePflanze(site: Site, p: Pflanze, angaben: SeitenAngabe[] = []): PflanzenErgebnis {
  const [a, b] = pflanzLinie(p);
  const art = ARTNAME[p.art];
  const rows: Row[] = [];
  const innen = pointInPolygon(a, site.plot.boundary) && pointInPolygon(b, site.plot.boundary);
  const seiten: SeitenErgebnis[] = [];
  let maxH = Infinity;
  for (const [s, r] of abstaendeJeSeite(site, a, b)) {
    const ang = angaben[s];
    const wald = !!ang?.wald?.value;
    const aus = ausnahme(ang, p.hoehe);
    const noetig = aus ? 0 : noetigerAbstand(p.hoehe, wald);
    const d = innen ? r.d : 0;
    const status: Status = aus ? 'ok' : d + 1e-9 < noetig ? 'bad' : d - noetig < KNAPP_M ? 'warn' : 'ok';
    if (!aus) maxH = Math.min(maxH, maxHoehe(d, wald));
    else if (aus === 'einfriedung') maxH = Math.min(maxH, Math.max(maxHoehe(d, wald), ang!.einfriedung!.value));
    seiten.push({ seite: s, abstand: d, noetig, p: r.p, q: r.q, ausnahme: aus, status });
  }
  seiten.sort((x, y) => x.abstand - x.noetig - (y.abstand - y.noetig));
  const mass = seiten.find((x) => !x.ausnahme) ?? seiten[0];
  const schlecht = seiten.filter((x) => x.status === 'bad');
  const status: Status = !innen ? 'bad' : schlecht.length ? 'bad' : seiten.some((x) => x.status === 'warn') ? 'warn' : 'ok';
  const hText = (h: number) => (h === Infinity ? 'beliebig hoch' : h === 0 ? 'gar nicht' : `bis ${fmt(h, 1)} m hoch`);

  let head: string;
  let sub: string;
  if (!innen) {
    head = 'Liegt nicht auf deinem Grundstück.';
    sub = `Zieh ${art.die} auf dein Grundstück.`;
  } else if (status === 'bad') {
    const x = schlecht[0];
    if (maxH > 0 && p.hoehe > maxH) {
      head = `Zu hoch für diese Stelle: hier ${hText(maxH)}.`;
      sub = `${fmt(x.abstand)} m bis zur ${sideName(site, x.seite).replace(/^an der /, '')}. Ab ${fmt(HOCH_M, 2)} m Abstand begrenzt Art. 47 die Höhe nicht.`;
    } else {
      head = `Zu nah an der Grenze: ${fmt(x.abstand)} m.`;
      sub = `Laut Art. 47 AGBGB gilt hier ein Abstand von mindestens ${fmt(x.noetig)} m.`;
    }
  } else {
    head = maxH === Infinity ? `Passt. Hier darf ${art.die} beliebig hoch werden.` : `Passt, solange ${art.die} höchstens ${fmt(maxH, 1)} m hoch bleibt.`;
    sub = mass ? `${fmt(mass.abstand)} m bis zur ${sideName(site, mass.seite).replace(/^an der /, '')}, nötig ${fmt(mass.noetig)} m${status === 'warn' ? ' – knapp, beim Pflanzen nachmessen' : ''}.` : '';
  }

  rows.push({ text: `Laut Art. 47 Abs. 1 AGBGB: Pflanzen bis 2 m Höhe mindestens ${fmt(KLEIN_M)} m, höhere mindestens ${fmt(HOCH_M)} m von der Grenze`, tag: ART47, kind: 'rule' });
  rows.push({
    text: p.art === 'baum' ? 'Gemessen ab der Stammmitte, wo der Stamm aus dem Boden kommt (Art. 49)' : 'Gemessen ab der Mitte der Triebe, die der Grenze am nächsten sind (Art. 49) – das ist die Pflanzreihe, nicht der Heckenrand',
    tag: 'AGBGB Art. 49',
    kind: 'rule',
  });
  for (const x of seiten) {
    const nm = sideName(site, x.seite);
    if (x.ausnahme === 'strasse') rows.push({ text: `${cap(nm)}: öffentliche Straße – Art. 47 gilt dort laut Art. 50 Abs. 1 nicht`, tag: 'nutzerbestätigt', kind: 'nutzerbestätigt' });
    else if (x.ausnahme === 'einfriedung') rows.push({ text: `${cap(nm)}: hinter einer ${fmt(angaben[x.seite]!.einfriedung!.value, 1)} m hohen Mauer oder dichten Einfriedung, die ${art.die} nicht überragt – Art. 47 gilt laut Art. 50 Abs. 1 nicht. Was „nicht erheblich überragen“ genau heißt, sagt das Gesetz nicht.`, tag: 'offen', kind: 'offen' });
    else rows.push({ text: `${cap(nm)}: ${fmt(x.abstand)} m, nötig ${fmt(x.noetig)} m`, tag: 'berechnet', kind: 'berechnet' });
  }
  rows.push({ text: `Geplante Höhe ${fmt(p.hoehe, 1)} m – maßgeblich ist die Höhe, die ${art.die} tatsächlich erreicht, nicht die beim Pflanzen`, tag: 'nutzerbestätigt', kind: 'nutzerbestätigt' });
  const offen = seiten.filter((x) => !angaben[x.seite]?.strasse);
  if (offen.length) rows.push({ text: 'Grenze zu einer öffentlichen Straße? Dort gilt Art. 47 nicht (Art. 50 Abs. 1). Bis zur Angabe rechnet Passt. mit Nachbargrundstück.', tag: 'offen', kind: 'offen' });
  if (seiten.some((x) => !angaben[x.seite]?.wald)) rows.push({ text: 'Ist ein Nachbar ein Waldgrundstück, gelten dort nur 0,50 m (Art. 47 Abs. 2). Annahme: kein Wald.', tag: 'Annahme', kind: 'Annahme' });
  // BGH V ZR 230/16 (Leitsatz): liegt der Nachbar höher, zählt die Wuchshöhe ab dessen Gelände – nur Hinweis
  if (innen && mass && site.ground) {
    const dx = mass.q[0] - mass.p[0];
    const dy = mass.q[1] - mass.p[1];
    const l = Math.hypot(dx, dy);
    if (l > 0.05) {
      const nachbar: Vec2 = [mass.q[0] + (dx / l) * 1.0, mass.q[1] + (dy / l) * 1.0];
      const diff = site.ground(nachbar) - site.ground(mass.p);
      if (diff > 0.2) rows.push({ text: `Das Nachbargrundstück liegt hier etwa ${fmt(diff, 1)} m höher (DGM1). Laut BGH (V ZR 230/16) wird die zulässige Höhe dann vom höheren Gelände des Nachbarn aus gemessen – Passt. rechnet das nicht ein.`, tag: 'offen', kind: 'offen' });
    }
  }
  if (p.art === 'baum') rows.push({ text: 'Art. 48 (4 m zu landwirtschaftlich genutztem Grundstück) gilt laut Art. 50 Abs. 2 nicht für Bäume im Hausgarten und nicht für Obstbäume. Annahme: Hausgarten.', tag: 'Annahme', kind: 'Annahme' });
  rows.push({ text: 'Nachbarrecht (Zivilrecht): Das Bauamt prüft das nicht. Gemeindliche Baumschutz- oder Gestaltungssatzungen können zusätzlich gelten.', tag: 'offen', kind: 'offen' });

  const dim = innen && mass ? { p: mass.p, q: mass.q, label: `${fmt(mass.abstand)} m` } : null;
  return { status, head, sub, rows, seiten, maxHoehe: innen ? maxH : 0, dim };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Pflanzzonen fürs ganze Grundstück: ROT = hier nicht (unter 0,50 m), GELB = bis 2 m hoch, GRUEN = keine
 * Höhengrenze aus Art. 47. Straßenseiten (Angabe) zählen nicht; Waldseiten nur mit 0,50 m. Einfriedungen hängen
 * von der Pflanzenhöhe ab und bleiben hier unberücksichtigt (sicher nach oben).
 * Rasterlage wie rules/zonen.ts (Bildzeilen von Norden nach Süden).
 */
export function pflanzZonen(site: Site, angaben: SeitenAngabe[], g: RasterGeometrie): Uint8Array {
  const plot = site.plot.boundary;
  const segs = edges(plot)
    .map(([a, b], i) => ({ a, b, s: segSide(site, i) }))
    .filter((x) => !angaben[x.s]?.strasse?.value);
  const feld = new Uint8Array(g.nx * g.ny);
  for (let r = 0; r < g.ny; r++) {
    for (let c = 0; c < g.nx; c++) {
      const p: Vec2 = [g.o[0] + (c + 0.5) * g.ex[0] + (r + 0.5) * g.ey[0], g.o[1] + (c + 0.5) * g.ex[1] + (r + 0.5) * g.ey[1]];
      let f = FREI;
      if (pointInPolygon(p, plot)) {
        let h = Infinity;
        for (const x of segs) h = Math.min(h, maxHoehe(pointSegment(p, x.a, x.b).d, !!angaben[x.s]?.wald?.value));
        f = h === 0 ? ROT : h === Infinity ? GRUEN : GELB;
      }
      feld[(g.ny - 1 - r) * g.nx + c] = f;
    }
  }
  return feld;
}

/* ---------- Pflanzen im Bestand (eigene und Nachbarn) ---------- */

export type Alter = 'unbekannt' | 'unter5' | 'ueber5';

export interface BestandsPflanze {
  id: string;
  art: PflanzenArt;
  eigen: boolean;
  seite: number;
  /** Abstand nach Art. 49 (Schätzung) und Spanne (±) */
  abstand: number;
  spanne: number;
  hoehe: number;
  hoeheSpanne: number;
  noetig: number;
  /** nur sachlich: liegt der geschätzte Abstand über, unter oder (wegen der Spanne) nicht eindeutig zum Wert? */
  vergleich: 'darueber' | 'darunter' | 'unklar';
  messpunkt: Vec2;
  grenzpunkt: Vec2;
  quelle: string;
  /** Messpunkt: angetippt (nutzerbestätigt) oder aus der Krone abgeleitet (erkannt) */
  provenance: Provenance;
}

const PFLANZ_KLASSEN = new Set(['baum', 'strauch', 'hecke']);

/**
 * Pflanzen aus der Garten-Erkennung bis 3 m an der Grenze. Messpunkt nach Art. 49:
 *  - Baum/Strauch: angetippter Stamm (Spanne 0,2 m), sonst Kronenmitte mit großer Spanne – der Stamm ist in den
 *    Laserdaten nicht verlässlich erkennbar (docs/messungen/staemme.md).
 *  - Hecke: Triebe liegen irgendwo zwischen Heckenrand und Heckenmitte → Abstand als Spanne zwischen beiden.
 * Straßenseiten (Angabe) werden ausgelassen.
 */
export function bestandsPflanzen(site: Site, angaben: SeitenAngabe[] = []): BestandsPflanze[] {
  const plot = site.plot.boundary;
  const out: BestandsPflanze[] = [];
  for (const b of site.bestand) {
    if (!b.kind || !PFLANZ_KLASSEN.has(b.kind)) continue;
    const art = b.kind as PflanzenArt;
    const h = b.hoehe?.wert ?? b.height;
    const hs = b.hoehe?.spanne ?? 0;
    let mp: Vec2;
    let spanne: number;
    let quelle: string;
    if (art !== 'hecke') {
      // Stamm im Laser nicht verlässlich erkennbar (docs/messungen/staemme.md): Kronenmitte, Spanne halber Ersatzradius
      mp = b.stamm ?? centroid(b.footprint);
      spanne = b.stamm ? b.stammSpanne ?? 0.2 : Math.max(KRONE_MIN_SPANNE, Math.sqrt(area(b.footprint) / Math.PI) / 2);
      quelle = b.stamm ? 'Stamm angetippt' : 'Kronenmitte (Stamm nicht erkennbar)';
    } else {
      mp = centroid(b.footprint);
      spanne = 0;
      quelle = 'Heckenrand bis Heckenmitte';
    }
    const eigen = pointInPolygon(mp, plot);
    // nächste Grenzseite
    let best: { d: number; q: Vec2; s: number; p: Vec2 } | null = null;
    edges(plot).forEach(([c, d], i) => {
      const s = segSide(site, i);
      if (angaben[s]?.strasse?.value) return;
      let r: { d: number; q: Vec2; p: Vec2 };
      if (art === 'hecke') {
        // Heckenrand: nächster Umrisspunkt (Umriss schneidet die Grenze → 0)
        let m = { d: Infinity, q: c, p: c } as { d: number; q: Vec2; p: Vec2 };
        for (const [u, v] of edges(b.footprint)) {
          const x = segmentSegment(u, v, c, d);
          if (x.d < m.d) m = { d: x.d, p: x.p, q: x.q };
        }
        r = m;
      } else {
        const x = pointSegment(mp, c, d);
        r = { d: x.d, q: x.q, p: mp };
      }
      if (!best || r.d < best.d) best = { ...r, s };
    });
    if (!best) continue;
    const bb = best as { d: number; q: Vec2; s: number; p: Vec2 };
    let abstand = bb.d;
    if (art === 'hecke') {
      // Spanne: vom Rand bis zur halben Heckenbreite nach innen
      const halb = (b.breite?.wert ?? 1) / 2;
      spanne = halb / 2;
      abstand = bb.d + spanne;
    }
    if (abstand - spanne > NAHE_M && !b.stamm) continue; // angetippte Stämme bleiben in der Liste
    const ang = angaben[bb.s];
    const noetig = noetigerAbstand(h, !!ang?.wald?.value);
    const lo = abstand - spanne;
    const hi = abstand + spanne;
    // Höhe mit Spanne kann den nötigen Abstand wechseln (um 2 m herum)
    const noetigLo = noetigerAbstand(h - hs, !!ang?.wald?.value);
    const vergleich = lo + 1e-9 >= noetig ? 'darueber' : hi + 1e-9 < noetigLo ? 'darunter' : 'unklar';
    out.push({
      id: b.id, art, eigen, seite: bb.s, abstand, spanne, hoehe: h, hoeheSpanne: hs, noetig, vergleich,
      messpunkt: bb.p, grenzpunkt: bb.q, quelle, provenance: b.stamm ? 'nutzerbestätigt' : b.provenance,
    });
  }
  return out.sort((x, y) => Number(y.eigen) - Number(x.eigen) || x.abstand - y.abstand);
}

/** Sachliche Beschreibung einer Bestandspflanze (keine Wertung, kein „Anspruch“). */
export function pflanzenText(site: Site, x: BestandsPflanze): string {
  const n = ARTNAME[x.art].n;
  const wo = x.eigen ? 'auf deinem Grundstück' : 'auf dem Nachbargrundstück';
  const hoehe = `etwa ${fmt(x.hoehe, 1)} m hoch${x.hoeheSpanne > 0 ? ` (±${fmt(x.hoeheSpanne, 1)} m)` : ''}`;
  const ab = x.art === 'hecke'
    ? `Triebe geschätzt ${fmt(Math.max(0, x.abstand - x.spanne), 1)}–${fmt(x.abstand + x.spanne, 1)} m`
    : `${x.quelle.startsWith('Stamm') ? 'Stamm' : 'Kronenmitte'} etwa ${fmt(x.abstand, 1)} m (±${fmt(x.spanne, 1)} m)`;
  const vgl = x.vergleich === 'darueber' ? 'liegt darüber' : x.vergleich === 'darunter' ? 'liegt darunter' : 'wegen der Messunsicherheit nicht eindeutig';
  return `${n} ${wo}, ${hoehe}. ${ab} ${sideName(site, x.seite).replace(/^an der /, 'von der ')}. Art. 47 nennt für diese Höhe ${fmt(x.noetig)} m – der geschätzte Abstand ${vgl}.`;
}

/** Hinweis zum Alter (Art. 52) – nur Information, keine Empfehlung. */
export function alterText(alter: Alter): string {
  const basis = `Laut Art. 52 Abs. 1 Satz 2 und 3 AGBGB verjährt der Anspruch auf Beseitigung eines Zustands, der den Abstand nicht einhält, in ${P.verjaehrungJahre.wert} Jahren. Die Frist beginnt mit dem Schluss des Jahres, in dem der Anspruch entstanden ist und der Eigentümer von den Umständen Kenntnis erlangt hat oder ohne grobe Fahrlässigkeit hätte erlangen müssen.`;
  const bgh = 'Nach dem Bundesgerichtshof (Urteil vom 1. Juni 2017, V ZR 230/16) entsteht der Anspruch bei Pflanzen über 2 m in dem Jahr, in dem sie die 2 m erstmals überschreiten. Ist die Verletzung zweifelhaft, beginnt die Frist erst, wenn sie eindeutig ist. Nach einem Rückschnitt entsteht der Anspruch bei erneutem Überwachsen neu.';
  const ersatz = 'Werden verjährte Pflanzen durch neue ersetzt, gilt für die neuen der Abstand wieder (Art. 52 Abs. 2).';
  const keine = 'Passt. rechnet diese Frist nicht aus – es kommt auf die Umstände im Einzelfall an.';
  const vorn = alter === 'ueber5' ? 'Steht seit mehr als fünf Jahren so: ' : alter === 'unter5' ? 'Steht seit weniger als fünf Jahren so: ' : 'Wie lange steht die Pflanze schon so? ';
  return `${vorn}${basis} ${bgh} ${ersatz} ${keine}`;
}
