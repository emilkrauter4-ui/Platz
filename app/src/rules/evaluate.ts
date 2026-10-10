/**
 * Das feste Regelwerk. Entscheidet allein über die Ampel; ein LLM darf höchstens erklären.
 * Ausgangspunkt: Prüflogik aus design/prototyp.html, erweitert um gedrehte Objekte,
 * beliebige Grundstücksformen, Gelände (DGM1), Bestand und 0,4 H.
 */
import L from './limits.json';
import {
  area,
  centroid,
  dist3,
  edges,
  EPS,
  footprint,
  insidePolygon,
  overlaps,
  pointInPolygon,
  pointSegment,
  polygonDistance,
  polygonSegment,
  projectedLength,
} from './geometry';
import { pruefeAbstandsflaechen, rauminhalt, waende, wandhoeheArt7 } from './abstand';
import type { Befund, Bestand, GeraeteKlasse, Gebietsart, ObjectKind, Placed, Result, Row, Site, Status, Vec2 } from './types';

export const LIMITS = L;

/** Während der Zonen-Rechnung werden keine Texte gebraucht: fmt() liefert dann sofort einen leeren Text. */
let OHNE_TEXT = false;

export function fmt(v: number, d = 2): string {
  if (OHNE_TEXT) return '';
  const f = 10 ** d;
  return (Math.round(v * f) / f).toFixed(d).replace('.', ',');
}

export const NAMES: Record<ObjectKind, { name: string; art: string; mit: string }> = {
  gartenhaus: { name: 'Gartenhaus', art: 'das Gartenhaus', mit: 'mit dem Gartenhaus' },
  carport: { name: 'Carport', art: 'den Carport', mit: 'mit dem Carport' },
  waermepumpe: { name: 'Wärmepumpe', art: 'die Wärmepumpe', mit: 'mit der Wärmepumpe' },
};

export const GEBIET_TEXT: Record<Gebietsart, string> = {
  rein: 'reines Wohngebiet',
  allgemein: 'allgemeines Wohngebiet',
  misch: 'Mischgebiet',
};

const MIN_ABSTAND = L.abstand.minM.wert;
const FAKTOR_H = L.abstand.faktorH.wert;
const GRENZ_H = L.grenzbebauung.maxMittlereWandhoeheM.wert;
const MAX_SEITE = L.grenzbebauung.maxLaengeJeSeiteM.wert;
const MAX_GESAMT = L.grenzbebauung.maxLaengeGesamtM.wert;

const BESTAND_KLASSEN = new Set<string>(L.bestand.gebaeudeKlassen.wert);

const ART6 = 'BayBO Art. 6';
const ART57 = 'BayBO Art. 57';

export type Objects = Record<ObjectKind, Placed>;

/* ---------- Gelände und Wandhöhe ---------- */

function groundAt(site: Site, p: Vec2): number {
  return site.ground ? site.ground(p) : 0;
}

/** Fußbodenhöhe: vorgegeben oder höchster Geländepunkt unter dem Grundriss (dann sitzt nichts im Hang). */
export function baseElevation(site: Site, o: Placed): number {
  if (o.baseElevation != null) return o.baseElevation;
  return Math.max(...footprint(o).map((p) => groundAt(site, p)));
}

/** Mittlere Wandhöhe einer Außenwand über dem Gelände (DGM1), nicht über einem Nullniveau. */
export function meanWallHeight(site: Site, o: Placed, a: Vec2, b: Vec2): number {
  const top = baseElevation(site, o) + o.h;
  const n = 8;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    sum += groundAt(site, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return top - sum / (n + 1);
}

/** Die Wand des Objekts, die der Grenzstrecke a–b zugewandt ist (Wandmitte am nächsten). */
function facingWall(fp: Vec2[], a: Vec2, b: Vec2): [Vec2, Vec2] {
  let best: [Vec2, Vec2] = [fp[0], fp[1]];
  let bd = Infinity;
  for (const [e0, e1] of edges(fp)) {
    const m: Vec2 = [(e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2];
    const d = pointSegment(m, a, b).d;
    if (d < bd - EPS) {
      bd = d;
      best = [e0, e1];
    }
  }
  return best;
}

export const requiredDistance = (wallH: number) => Math.max(MIN_ABSTAND, FAKTOR_H * wallH);

/* ---------- Grenzbebauung über alle Objekte ---------- */

interface SegInfo {
  seg: number;
  side: number;
  d: number;
  p: Vec2;
  q: Vec2;
  len: number;
  wallH: number;
  required: number;
  near: boolean;
}

interface Contributor {
  id: string;
  fp: Vec2[];
  segs: SegInfo[];
  provenance: string;
}

function segmentsOf(site: Site) {
  const b = site.plot.boundary;
  return b.map((p, i) => ({
    i,
    a: p,
    b: b[(i + 1) % b.length],
    side: site.plot.segmentSide?.[i] ?? i,
  }));
}

/** wallFor liefert je Grenzstrecke die mittlere Wandhöhe nach Abs. 7 (h7, Privileg) und H nach Abs. 4 (h4, Tiefe). */
function analyse(site: Site, fp: Vec2[], wallFor: (a: Vec2, b: Vec2) => { h7: number; h4: number }): SegInfo[] {
  return segmentsOf(site).map((s) => {
    const m = polygonSegment(fp, s.a, s.b);
    const { h7: wallH, h4 } = wallFor(s.a, s.b);
    const required = requiredDistance(h4);
    return {
      seg: s.i,
      side: s.side,
      d: m.d,
      p: m.p,
      q: m.q,
      len: projectedLength(fp, s.a, s.b),
      wallH,
      required,
      near: m.d < required - EPS,
    };
  });
}

/** Belegte Länge je Seite: pro Objekt die größte Projektion auf eine nahe Strecke dieser Seite. */
function sideSums(site: Site, cons: Contributor[]): number[] {
  const sums = site.plot.sides.map(() => 0);
  for (const c of cons) {
    const perSide = new Map<number, number>();
    for (const s of c.segs) {
      if (s.d < MIN_ABSTAND - EPS) perSide.set(s.side, Math.max(perSide.get(s.side) ?? 0, s.len));
    }
    perSide.forEach((len, side) => (sums[side] += len));
  }
  return sums;
}

/** Wandhöhen je Grenzstrecke aus den einmal berechneten Wänden des Objekts (Abs. 7 und Abs. 4). */
function wandFuer(site: Site, o: Placed, fp: Vec2[]) {
  const ws = waende(site, o);
  return (a: Vec2, b: Vec2) => {
    const [e0] = facingWall(fp, a, b);
    const w = ws.find((x) => x.a[0] === e0[0] && x.a[1] === e0[1])!;
    return { h7: wandhoeheArt7(w, o).h, h4: Math.max(w.ha, w.hb) };
  };
}

/* ---------- Hauptfunktion ---------- */

export function evaluate(site: Site, objs: Objects): Record<ObjectKind, Result> {
  const fps: Record<ObjectKind, Vec2[]> = {
    gartenhaus: footprint(objs.gartenhaus),
    carport: footprint(objs.carport),
    waermepumpe: footprint(objs.waermepumpe),
  };

  const cons: Contributor[] = (['gartenhaus', 'carport'] as const).map((k) => ({
    id: k,
    fp: fps[k],
    segs: analyse(site, fps[k], wandFuer(site, objs[k], fps[k])),
    provenance: 'berechnet',
  }));
  // Bestand auf dem eigenen Grundstück zählt mit (BayBO Art. 6: Gesamtlänge je Grenze) – nur Gebäude und nur
  // vom Nutzer geprüfte. Automatisch erkannte sind nie Grundlage einer Prüfung.
  const zaehlung = zaehleBestand(site);
  const ids = new Set(zaehlung.gezaehlt.map((x) => x.id));
  const bestandOnPlot = site.bestand.filter((b) => ids.has(b.id));
  const bestandCons: Contributor[] = bestandOnPlot.map((b) => ({
    id: b.id,
    fp: b.footprint,
    segs: analyse(site, b.footprint, () => ({ h7: b.height, h4: b.height })),
    provenance: b.provenance,
  }));
  const all = [...cons, ...bestandCons];
  const sums = sideSums(site, all);
  const total = sums.reduce((a, b) => a + b, 0);
  const bestandSums = sideSums(site, bestandCons);

  const mitZaehlung = (r: Result): Result => ({ ...r, bestandGezaehlt: zaehlung.gezaehlt, bestandNichtGezaehlt: zaehlung.nicht });
  return {
    gartenhaus: mitZaehlung(building(site, objs, fps, 'gartenhaus', cons[0].segs, sums, total, bestandSums)),
    carport: mitZaehlung(building(site, objs, fps, 'carport', cons[1].segs, sums, total, bestandSums)),
    waermepumpe: heatpump(site, objs, fps),
  };
}

/**
 * Schnelle Prüfung eines Objekts an vielen Stellen („Wo darf es hin?“). Alles, was nicht von der Lage des Objekts
 * abhängt (Bestand, das andere Objekt), wird einmal vorberechnet; je Lage läuft dieselbe Prüfung wie in evaluate().
 */
export function zonenPruefer(site: Site, objs: Objects, k: 'gartenhaus' | 'carport'): (center: Vec2, angle: number) => Status {
  const andere: 'gartenhaus' | 'carport' = k === 'gartenhaus' ? 'carport' : 'gartenhaus';
  const zaehlung = zaehleBestand(site);
  const ids = new Set(zaehlung.gezaehlt.map((x) => x.id));
  const bestandCons: Contributor[] = site.bestand.filter((b) => ids.has(b.id)).map((b) => ({
    id: b.id, fp: b.footprint, segs: analyse(site, b.footprint, () => ({ h7: b.height, h4: b.height })), provenance: b.provenance,
  }));
  const fpAndere = footprint(objs[andere]);
  const consAndere: Contributor = {
    id: andere, fp: fpAndere, provenance: 'berechnet',
    segs: analyse(site, fpAndere, wandFuer(site, objs[andere], fpAndere)),
  };
  const bestandSums = sideSums(site, bestandCons);
  const fix = sideSums(site, [...bestandCons, consAndere]);
  const fpWp = footprint(objs.waermepumpe);
  const plot = site.plot.boundary;
  const hindernisse = [
    ...site.buildings.map((b) => b.footprint),
    fpAndere,
    fpWp,
    ...site.bestand.filter((b) => geprueft(b) && (istGebaeude(b) || b.kind === 'pool' || b.kind === 'teich')).map((b) => b.footprint),
  ];
  return (center, angle) => {
    // Billige Vorprüfung: Ecken außerhalb des Grundstücks oder Kollision → sicher nicht ok (wie in building())
    const fp0 = footprint({ ...objs[k], center, angle });
    if (!fp0.every((p) => pointInPolygon(p, plot)) && !insidePolygon(fp0, plot)) return 'bad';
    const b0 = box(fp0);
    for (const h of hindernisse) if (boxesMeet(b0, box(h)) && overlaps(fp0, h)) return 'bad';
    const o = { ...objs[k], center, angle };
    const o2 = { ...objs, [k]: o };
    const fp = footprint(o);
    const fps = { gartenhaus: k === 'gartenhaus' ? fp : fpAndere, carport: k === 'carport' ? fp : fpAndere, waermepumpe: fpWp };
    const segs = analyse(site, fp, wandFuer(site, o, fp));
    const own = sideSums(site, [{ id: k, fp, segs, provenance: 'berechnet' }]);
    const sums = fix.map((v, i) => v + own[i]);
    const total = sums.reduce((x, y) => x + y, 0);
    OHNE_TEXT = true;
    try {
      return building(site, o2, fps, k, segs, sums, total, bestandSums, true).status;
    } finally {
      OHNE_TEXT = false;
    }
  };
}

/** Ist das Objekt ein Gebäude im Sinn der Grenzbebauung (Gartenhaus, Gewächshaus, Garage/Carport)? */
export function istGebaeude(b: Bestand): boolean {
  return b.kind === undefined || BESTAND_KLASSEN.has(b.kind);
}

/** Vom Menschen geprüft (bestätigt, eingezeichnet, nachgezogen oder per Tipp erfasst)? Nur das trägt eine Prüfung.
 *  Die Vollautomatik („erkannt“) ist nur ein Hinweis (limits.json bestand.automatikNurHinweis). */
export function geprueft(b: Bestand): boolean {
  return b.provenance !== 'erkannt';
}

/**
 * Welche bestehenden Objekte zählen bei der Grenzbebauung (9 m / 15 m) mit?
 * Gebäude auf dem eigenen Grundstück, wenn vom Nutzer bestätigt, eingezeichnet oder per Tipp erfasst.
 * Automatisch erkannte zählen nie – sie sind nur ein Hinweis, bis der Nutzer „Stimmt“ sagt.
 */
export function zaehleBestand(site: Site): { gezaehlt: { id: string; grund: string }[]; nicht: { id: string; grund: string }[] } {
  const gezaehlt: { id: string; grund: string }[] = [];
  const nicht: { id: string; grund: string }[] = [];
  for (const b of site.bestand) {
    if (!pointInPolygon(centroid(b.footprint), site.plot.boundary)) continue;
    if (!istGebaeude(b)) {
      nicht.push({ id: b.id, grund: 'kein Gebäude' });
    } else if (b.provenance === 'nutzerbestätigt') {
      gezaehlt.push({ id: b.id, grund: 'von dir bestätigt' });
    } else if (b.provenance === 'erfasst per Tipp') {
      gezaehlt.push({ id: b.id, grund: b.dach ? 'von dir per Tipp erfasst, Wandumriss geschätzt (Dach minus Überstand)' : 'von dir per Tipp erfasst' });
    } else {
      nicht.push({ id: b.id, grund: 'nur ein Hinweis der Automatik – zählt erst, wenn du „Stimmt“ sagst' });
    }
  }
  return { gezaehlt, nicht };
}

/* ---------- Gartenhaus und Carport ---------- */

type Box = [number, number, number, number];
const BOX = new WeakMap<Vec2[], Box>();
function box(p: Vec2[]): Box {
  let b = BOX.get(p);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of p) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
    BOX.set(p, b);
  }
  return b;
}
/** Schnelle Vorprüfung: überlappen die umschließenden Rechtecke überhaupt? */
const boxesMeet = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function collision(site: Site, fps: Record<ObjectKind, Vec2[]>, k: ObjectKind): string | null {
  const fp = fps[k];
  const bf = box(fp);
  for (const b of site.buildings) {
    if (boxesMeet(bf, box(b.footprint)) && overlaps(fp, b.footprint)) return b.own ? 'mit deinem Haus' : 'mit einem Nachbarhaus';
  }
  for (const other of ['gartenhaus', 'carport', 'waermepumpe'] as const) {
    if (other !== k && overlaps(fp, fps[other])) return NAMES[other].mit;
  }
  for (const b of site.bestand) {
    // Pflanzen, Terrassen, Trampoline lassen sich versetzen oder überbauen – kollidieren nur Gebäude und Wasser.
    // Automatisch erkannte nur als Hinweis (hinweisAutomatik), nie als Kollision.
    if (!geprueft(b) || !(istGebaeude(b) || b.kind === 'pool' || b.kind === 'teich')) continue;
    if (boxesMeet(bf, box(b.footprint)) && overlaps(fp, b.footprint)) return b.kind === 'pool' ? 'mit dem Pool' : b.kind === 'teich' ? 'mit dem Teich' : 'mit einem bestehenden Nebengebäude';
  }
  return null;
}

/** „Hier scheint noch etwas zu stehen“: das Objekt überschneidet sich mit einem nur automatisch erkannten Objekt. */
function hinweisAutomatik(site: Site, fp: Vec2[]): Row | null {
  const bf = box(fp);
  const b = site.bestand.find((x) => !geprueft(x) && (istGebaeude(x) || x.kind === 'pool' || x.kind === 'teich')
    && boxesMeet(bf, box(x.footprint)) && overlaps(fp, x.footprint));
  return b ? { text: 'Hier scheint noch etwas zu stehen (automatischer Hinweis, nicht geprüft). Bitte unter „Steht hier schon etwas?“ ansehen.', tag: 'erkannt', kind: 'erkannt' } : null;
}

function contextRows(site: Site): Row[] {
  const rows: Row[] = [];
  if (site.ground) rows.push({ text: 'Wandhöhe über dem Gelände gemessen (DGM1)', tag: site.groundProvenance ?? 'amtlich', kind: site.groundProvenance ?? 'amtlich' });
  const bp = site.bplan;
  if (bp.status === 'vorhanden') rows.push({ text: `Bebauungsplan „${bp.name ?? 'ohne Namen'}“: Festsetzungen gehen vor`, tag: bp.provenance, kind: bp.provenance });
  else if (bp.status === 'keiner') rows.push({ text: 'Kein Bebauungsplan gefunden', tag: bp.provenance, kind: bp.provenance });
  else rows.push({ text: site.demo ? 'Bebauungsplan: in der Demo nicht hinterlegt' : 'Bebauungsplan: noch nicht geprüft', tag: 'offen', kind: 'offen' });
  if (site.demo) rows.push({ text: 'Grundstück und Nachbarhäuser sind erfunden', tag: 'Demo', kind: 'Demo' });
  else {
    rows.push({
      text: site.plot.provenance === 'Demo' ? 'Grundstücksgrenze für die Demo nach der Flurkarte nachgezeichnet' : 'Grundstücksgrenze von dir gesetzt',
      tag: site.plot.provenance,
      kind: site.plot.provenance,
    });
    rows.push({ text: 'Gemeindesatzungen können andere Abstände festlegen', tag: 'offen', kind: 'offen' });
  }
  return rows;
}

interface Limit {
  ok: boolean;
  row: string;
  head: string;
  sub: string;
}

/** Größengrenze nach Art. 57. Im Außenbereich gelten andere Grenzen: Gebäude nur bis 20 m³ (ohne Aufenthaltsraum, Toilette,
 *  Feuerstätte), Garagen und Carports sind dort nicht freigestellt (die Ampel bleibt dort ohnehin rot, siehe building()). */
function limitFor(k: ObjectKind, o: Placed, bereich: 'innen' | 'aussen' = 'innen'): Limit {
  const aussen = bereich === 'aussen';
  if (k === 'gartenhaus') {
    const v = rauminhalt(o);
    const max = aussen ? L.gartenhaus.aussenbereichMaxM3.wert : L.gartenhaus.maxBruttoRauminhaltM3.wert;
    return {
      ok: v <= max + 1e-9,
      row: aussen
        ? `Im Außenbereich ohne Baugenehmigung nur bis ${max} m³, ohne Aufenthaltsraum, Toilette und Feuerstätte. Deins: ${fmt(v, 1)} m³`
        : `Ohne Baugenehmigung bis ${max} m³ umbauten Raum. Deins: ${fmt(v, 1)} m³`,
      head: 'Zu groß für ohne Genehmigung.',
      sub: `Dein Gartenhaus hat ${fmt(v, 1)} m³ umbauten Raum. Ohne Bauantrag gehen ${aussen ? 'im Außenbereich' : ''} bis ${max} m³.`.replace('  ', ' '),
    };
  }
  const a = o.w * o.d;
  const max = L.carport.maxFlaecheM2.wert;
  return {
    ok: a <= max + 1e-9,
    row: aussen
      ? `Im Außenbereich sind Garagen und Carports nicht freigestellt (Art. 57: bis ${max} m² nur außerhalb des Außenbereichs). Deiner: ${fmt(a, 1)} m²`
      : `Ohne Baugenehmigung bis ${max} m² Fläche. Deiner: ${fmt(a, 1)} m²`,
    head: 'Zu groß für ohne Genehmigung.',
    sub: `Dein Carport hat ${fmt(a, 1)} m². Ohne Bauantrag gehen bis ${max} m².`,
  };
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function building(
  site: Site,
  objs: Objects,
  fps: Record<ObjectKind, Vec2[]>,
  k: 'gartenhaus' | 'carport',
  segs: SegInfo[],
  sums: number[],
  total: number,
  bestandSums: number[],
  schnell = false,
): Result {
  const o = objs[k];
  const fp = fps[k];
  const sides = site.plot.sides;
  const inside = schnell || insidePolygon(fp, site.plot.boundary); // schnell: Vorprüfung in zonenPruefer hat es geklärt
  const lim = limitFor(k, o, site.bereich.value);
  const closest = segs.reduce((a, b) => (b.d < a.d ? b : a));
  const near = segs.filter((s) => s.near);
  const nearSides = [...new Set(near.map((s) => s.side))];
  const collide = schnell ? null : collision(site, fps, k);

  const rows: Row[] = [
    { text: lim.row, tag: ART57, kind: 'rule' },
    { text: `Abstand ${sides[closest.side].name}: ${fmt(Math.max(0, closest.d))} m`, tag: 'berechnet', kind: 'berechnet' },
  ];
  const maxWall = near.length ? Math.max(...near.map((s) => s.wallH)) : closest.wallH;
  if (near.length) {
    for (const side of nearSides) {
      rows.push({ text: `${cap(sides[side].grenze)} belegt: ${fmt(sums[side], 1)} von ${MAX_SEITE} m`, tag: ART6, kind: 'rule' });
      if (bestandSums[side] > EPS) rows.push({ text: `Davon bestehende Kleinbauten: ${fmt(bestandSums[side], 1)} m`, tag: 'erkannt', kind: 'erkannt' });
    }
    rows.push({ text: `So nah an der Grenze nur bis ${GRENZ_H} m Wandhöhe. Deine: ${fmt(maxWall)} m`, tag: ART6, kind: 'rule' });
  } else {
    const req = closest.required;
    rows.push({ text: req > MIN_ABSTAND + EPS ? `Abstandsfläche 0,4 H = ${fmt(req)} m eingehalten` : `Mindestabstand von ${MIN_ABSTAND} m eingehalten`, tag: ART6, kind: 'rule' });
  }
  // Abstandsflächen (Art. 6 Abs. 2–7). Privilegierte Nebengebäude brauchen keine eigenen (Abs. 7 Satz 1).
  const ws = waende(site, o);
  const h7max = Math.max(...ws.map((w) => wandhoeheArt7(w, o).h));
  const a7offen = ws.some((w) => wandhoeheArt7(w, o).offen);
  const ohneRaum = k === 'carport' || !(site.aufenthaltsraum.value || site.feuerstaette.value);
  const privilegiert = ohneRaum && h7max <= GRENZ_H + 1e-9;
  if ((o.neigung ?? 0) > 0) {
    rows.push({
      text: `Satteldach ${fmt(o.neigung!, 0)}°: Dach ${(o.neigung ?? 0) > 70 ? 'voll' : 'zu einem Drittel'} zur Wandhöhe (H bis ${fmt(Math.max(...ws.map((w) => Math.max(w.ha, w.hb))))} m)`,
      tag: 'BayBO Art. 6 Abs. 4', kind: 'rule',
    });
    rows.push({ text: 'Giebelfläche wie das Dach angerechnet – Auslegung, bitte prüfen lassen', tag: 'offen', kind: 'offen' });
  }
  if (a7offen) rows.push({ text: 'Dach steiler als 45°: Anrechnung der Giebelfläche bei der mittleren Wandhöhe ist nicht eindeutig geregelt', tag: 'offen', kind: 'offen' });
  // Abstandsflächen-Prüfung nur, wo sie zählt (nicht privilegiert, nicht an der Grenze) oder für die Anzeige
  const afNoetig = !privilegiert && !near.length;
  const af = afNoetig || !schnell ? pruefeAbstandsflaechen(site, o) : null;
  const afAusserhalb = !!af && af.ausserhalb.some((x) => x > 0.05);
  const afUeber = !!af && af.ueberdeckung.length > 0;
  const afIn = !!af && af.inFlaeche.length > 0;
  if (privilegiert) {
    rows.push({ text: `Mittlere Wandhöhe ${fmt(h7max)} m: braucht keine eigene Abstandsfläche und darf in Abstandsflächen stehen`, tag: 'BayBO Art. 6 Abs. 7', kind: 'rule' });
  } else if (!near.length) {
    rows.push({
      text: afAusserhalb ? 'Abstandsfläche reicht über die Grundstücksgrenze' : `Abstandsflächen 0,4 H (mind. ${MIN_ABSTAND} m) liegen auf deinem Grundstück`,
      tag: 'BayBO Art. 6 Abs. 2', kind: 'rule',
    });
    if (afAusserhalb) rows.push({ text: 'Grenzt die Seite an eine öffentliche Straße, Grün- oder Wasserfläche, darf sie bis zu deren Mitte reichen – nicht geprüft', tag: 'offen', kind: 'offen' });
    if (af && af.hausFlaechen.length) {
      rows.push({
        text: afUeber || afIn ? 'Überschneidet sich mit den Abstandsflächen deines Hauses' : 'Keine Überdeckung mit den Abstandsflächen deines Hauses',
        tag: 'BayBO Art. 6 Abs. 3', kind: 'rule',
      });
      rows.push({ text: 'Abstandsflächen des Hauses aus LoD2: Dachneigung angenommen bis 70°', tag: 'Annahme', kind: 'Annahme' });
    }
  }
  if (k === 'gartenhaus') {
    rows.push({
      text: `${site.aufenthaltsraum.value ? 'Mit' : 'Kein'} Aufenthaltsraum, ${site.feuerstaette.value ? 'mit' : 'keine'} Feuerstätte, ${site.bereich.value === 'innen' ? 'Innenbereich' : 'Außenbereich'}`,
      tag: worst(site.aufenthaltsraum.provenance, site.feuerstaette.provenance, site.bereich.provenance),
      kind: worst(site.aufenthaltsraum.provenance, site.feuerstaette.provenance, site.bereich.provenance),
    });
  } else {
    rows.push({ text: `Offener Carport im ${site.bereich.value === 'innen' ? 'Innenbereich' : 'Außenbereich'}`, tag: site.bereich.provenance, kind: site.bereich.provenance });
  }
  if (!schnell) {
    const hw = hinweisAutomatik(site, fp);
    if (hw) rows.push(hw);
    rows.push(...contextRows(site));
  }

  const befunde: Befund[] = [];
  if (!inside) befunde.push('ausserhalb');
  if (collide) befunde.push('kollision');
  if (site.bereich.value === 'aussen') befunde.push('aussenbereich');
  if (!lim.ok) befunde.push('groesse');
  if (!privilegiert && !near.length) {
    if (afAusserhalb) befunde.push('af_nachbar');
    if (afUeber || afIn) befunde.push('af_haus');
  }
  if (near.length) {
    if (!ohneRaum) befunde.push('grenze_aufenthaltsraum');
    if (near.some((s) => s.wallH > GRENZ_H + 1e-9)) befunde.push('grenze_wandhoehe');
    if (nearSides.some((side) => sums[side] > MAX_SEITE + EPS)) befunde.push('grenze_seite');
    if (total > MAX_GESAMT + EPS) befunde.push('grenze_gesamt');
  }

  let status: Status = 'ok';
  let head = 'Passt so.';
  let sub: string;
  let bad: number[] = [];
  const segsOfSides = (ss: number[]) => segs.filter((s) => ss.includes(s.side) && s.near).map((s) => s.seg);

  if (!inside) {
    status = 'bad'; head = 'Steht nicht ganz auf deinem Grundstück.'; sub = `Schieb ${NAMES[k].art} weiter nach innen.`;
  } else if (collide) {
    status = 'bad'; head = `Kollidiert ${collide}.`; sub = 'Such dir eine freie Stelle auf dem Grundstück.';
  } else if (site.bereich.value === 'aussen') {
    status = 'bad'; head = 'Im Außenbereich kann Passt. das nicht freigeben.';
    sub = k === 'gartenhaus'
      ? `Laut Art. 57 sind dort nur Gebäude bis ${L.gartenhaus.aussenbereichMaxM3.wert} m³ ohne Aufenthaltsraum, Toilette und Feuerstätte verfahrensfrei – und ob sie im Außenbereich überhaupt zulässig sind, klärt das Bauamt.`
      : 'Laut Art. 57 sind Garagen und Carports nur außerhalb des Außenbereichs verfahrensfrei.';
  } else if (!lim.ok) {
    status = 'bad'; head = lim.head; sub = lim.sub;
  } else if (!privilegiert && !near.length && (afAusserhalb || afUeber || afIn)) {
    status = 'bad';
    if (afAusserhalb) {
      head = 'Die Abstandsfläche reicht aufs Nachbargrundstück.';
      sub = `Mit ${fmt(h7max)} m mittlerer Wandhöhe braucht ${NAMES[k].art} eigene Abstandsflächen auf deinem Grundstück. Rück weiter von der Grenze weg, bau niedriger oder frag den Nachbarn nach einer schriftlichen Zustimmung.`;
    } else {
      head = 'Zu nah an deinem Haus.';
      sub = 'Die Abstandsflächen dürfen sich nicht überdecken. Rück weiter vom Haus weg oder bau niedriger (bis 3 m mittlere Wandhöhe ist es erlaubt).';
    }
  } else if (near.length) {
    const tooHigh = near.filter((s) => s.wallH > GRENZ_H + 1e-9);
    if (!ohneRaum) {
      const worstSeg = near.reduce((a, b) => (b.required - b.d > a.required - a.d ? b : a));
      status = 'bad';
      bad = near.map((s) => s.seg);
      head = 'Mit Aufenthaltsraum oder Feuerstätte nicht so nah an die Grenze.';
      sub = `Ohne eigenen Abstand sind laut Art. 6 Abs. 7 nur Gebäude ohne Aufenthaltsräume und Feuerstätten zulässig. Halte ${fmt(worstSeg.required, worstSeg.required === MIN_ABSTAND ? 0 : 2)} m Abstand ein.`;
    } else if (tooHigh.length) {
      const worstSeg = tooHigh.reduce((a, b) => (b.required - b.d > a.required - a.d ? b : a));
      status = 'bad';
      bad = tooHigh.map((s) => s.seg);
      head = `Noch ${fmt(worstSeg.required - worstSeg.d)} m zu nah an der Grenze.`;
      sub = `Ab ${GRENZ_H} m Wandhöhe gilt der volle Abstand von ${fmt(worstSeg.required, worstSeg.required === MIN_ABSTAND ? 0 : 2)} m. Bau niedriger oder rück weiter von der Grenze weg.`;
    } else {
      const over = nearSides.find((side) => sums[side] > MAX_SEITE + EPS);
      if (over != null) {
        status = 'bad'; bad = segsOfSides([over]);
        head = `Zu viel ${sides[over].grenze}.`;
        sub = `Dort stehen jetzt ${fmt(sums[over], 1)} m direkt an der Grenze, erlaubt sind ${MAX_SEITE} m. Bau kürzer oder halte ${MIN_ABSTAND} m Abstand.`;
      } else if (total > MAX_GESAMT + EPS) {
        status = 'bad'; bad = segsOfSides(nearSides);
        head = 'Zu viel Bebauung an deinen Grenzen.';
        sub = `Zusammen stehen ${fmt(total, 1)} m an den Grenzen, erlaubt sind ${MAX_GESAMT} m.`;
      } else sub = 'Keine Baugenehmigung nötig. So nah an der Grenze ist das als kleines Nebengebäude erlaubt.';
    }
  } else sub = 'Keine Baugenehmigung nötig, und der Abstand zur Grenze stimmt.';
  if (status === 'ok' && !ohneRaum) {
    status = 'warn';
    head = 'Verfahrensfrei. Brandschutz und Feuerstätte prüft die App nicht.';
    sub = `Laut Art. 57 Abs. 1 Nr. 1 Buchst. a ist ein Gebäude bis ${L.gartenhaus.maxBruttoRauminhaltM3.wert} m³ im Innenbereich verfahrensfrei.`;
  }
  if (!ohneRaum) rows.push({ text: 'Aufenthaltsraum oder Feuerstätte: Anforderungen an Brandschutz, Feuerstätte und Abgasanlage nicht geprüft', tag: 'offen', kind: 'offen' });

  return {
    status,
    befunde,
    head,
    sub,
    rows,
    badSegments: bad,
    dim: inside && closest.d > 0.02 ? { p: closest.p, q: closest.q, label: `${fmt(closest.d)} m` } : null,
    af: af ? {
      // je Wand: bis 3 m mittlere Wandhöhe (ohne Aufenthaltsraum) braucht die Wand keine eigene Fläche → grau
      flaechen: ws.map((w, i) => ({
        poly: w.flaeche,
        status: privilegiert || (ohneRaum && wandhoeheArt7(w, o).h <= GRENZ_H + 1e-9) ? 'info'
          : af!.ausserhalb[i] > 0.05 || af!.ueberdeckung.some((u) => u.wand === i) ? 'bad' : 'ok',
      })),
      haus: af.hausFlaechen,
      privilegiert,
    } : undefined,
  };
}

/** Die „schwächste" Herkunft gewinnt: eine Annahme bleibt eine Annahme. */
const RANK: Record<string, number> = { amtlich: 0, zertifiziert: 0.5, berechnet: 1, erkannt: 2, 'erfasst per Tipp': 2.5, nutzerbestätigt: 3, geschätzt: 3.5, Annahme: 4, offen: 5, Demo: 6 };
function worst<T extends string>(...ps: T[]): T {
  return ps.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
}

/* ---------- Wärmepumpe ---------- */

export function soundPressure(lw: number, q: number, r: number): number {
  return lw + 10 * Math.log10(q) - 11 - 20 * Math.log10(Math.max(0.5, r));
}

/** Abstand, ab dem der Richtwert eingehalten ist. */
export function limitRadius(lw: number, q: number, limit: number): number {
  return 10 ** ((lw + 10 * Math.log10(q) - 11 - limit) / 20);
}

/** Richtwirkung aus der Geometrie: reflektierende Wände (alle Gebäude aus LoD2) bis 3 m Abstand (LAI). */
export function placement(site: Site, fp: Vec2[]): 'frei' | 'wand' | 'ecke' {
  const tol = L.waermepumpe.wandabstandM.wert;
  const dirs: Vec2[] = [];
  for (const b of site.buildings) {
    for (const [a, c] of edges(b.footprint)) {
      if (polygonSegment(fp, a, c).d < tol) {
        const l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
        dirs.push([(c[0] - a[0]) / l, (c[1] - a[1]) / l]);
      }
    }
  }
  if (!dirs.length) return 'frei';
  // Ecke: zwei nahe Wände, die nicht parallel sind
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      if (Math.abs(dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1]) < 0.5) return 'ecke';
    }
  }
  return 'wand';
}

const PLACEMENT_TEXT = {
  frei: 'Gerät steht frei (keine Wand näher als 3 m)',
  wand: 'Gerät steht an einer Wand (bis 3 m)',
  ecke: 'Gerät steht in einer Ecke (zwei Wände bis 3 m)',
};

/** Schneidet die Strecke p–q das Polygon (Kante gekreuzt oder Endpunkt innen)? */
function streckeSchneidet(p: Vec2, q: Vec2, poly: Vec2[]): boolean {
  if (pointInPolygon(p, poly) || pointInPolygon(q, poly)) return true;
  for (const [a, b] of edges(poly)) {
    const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const d2 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    const d3 = (q[0] - p[0]) * (a[1] - p[1]) - (q[1] - p[1]) * (a[0] - p[0]);
    const d4 = (q[0] - p[0]) * (b[1] - p[1]) - (q[1] - p[1]) * (b[0] - p[0]);
    if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  }
  return false;
}

/**
 * Abschirmung (LAI, vereinfacht): Sichtlinie Gerät–Immissionsort gegen Grundrisse aus LoD2 (ab 2 m Traufe).
 * Verdeckt das Gebäude, an dem das Gerät steht (bis 3 m), liegt der Ort auf der abgewandten Seite.
 */
export function abschirmung(site: Site, quelle: Vec2, fp: Vec2[], ziel: Vec2, zielGebaeude?: string): { db: number; art: 'sichtfrei' | 'verdeckt' | 'abgewandt' } {
  const A = L.waermepumpe.abschirmungDb.wert;
  const tol = L.waermepumpe.wandabstandM.wert;
  let art: 'sichtfrei' | 'verdeckt' | 'abgewandt' = 'sichtfrei';
  for (const b of site.buildings) {
    if (b.id === zielGebaeude || (b.trauf != null && b.trauf < 2)) continue;
    if (!streckeSchneidet(quelle, ziel, b.footprint)) continue;
    const anDiesem = edges(b.footprint).some(([a, c]) => polygonSegment(fp, a, c).d < tol);
    if (anDiesem) return { db: A.abgewandt, art: 'abgewandt' };
    art = 'verdeckt';
  }
  return { db: A[art], art };
}

/** Immissionsorte eines Fensters: gesetzte Fenster als Punkt, angenommene über die ganze Fassade (1 m Raster, EG und OG). */
function immissionsorte(w: Site['windows'][number]): { pos: Vec2; z: number }[] {
  if (!w.fassade || w.provenance !== 'Annahme') return [{ pos: w.pos, z: w.z }];
  const [a, b] = w.fassade;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.round(len / L.waermepumpe.fassadenRasterM.wert));
  const out: { pos: Vec2; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const pos: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    out.push({ pos, z: w.z });
    if (w.zOG != null) out.push({ pos, z: w.zOG });
  }
  return out;
}

/* ---------- Außengeräte: Klassen (Wärmepumpe, Klimagerät, Pool-Wärmepumpe) ---------- */

export const GERAETE_NAME: Record<GeraeteKlasse, { name: string; art: string }> = {
  lwwp: { name: 'Luft-Wasser-Wärmepumpe', art: 'die Wärmepumpe' },
  klima: { name: 'Klimagerät (Außeneinheit)', art: 'das Klimagerät' },
  pool: { name: 'Pool-Wärmepumpe', art: 'die Pool-Wärmepumpe' },
};

export const geraeteKlasse = (o: Placed): GeraeteKlasse => o.geraeteklasse ?? 'lwwp';

/** Platzhalter für die Schallleistung, solange der Nutzer keinen Datenblattwert eingibt (Label Annahme). */
export const standardLw = (k: GeraeteKlasse): number => (k === 'lwwp' ? 58 : L.aussengeraete.standardLwDbA.wert[k]);

/** Übliche Abmessungen der Außeneinheit (Annahme) für Kollision und Darstellung. */
export const standardMasse = (k: GeraeteKlasse): { w: number; d: number; h: number } =>
  k === 'lwwp' ? { w: 0.45, d: 1, h: 0.9 } : L.aussengeraete.standardMasseM.wert[k];

/** Richtwert für das Gerät: nachts, bei der Pool-Wärmepumpe auf Wunsch tagsüber (TA Lärm Nr. 6.1, 6.4). */
export function richtwertFuer(o: Placed, gebiet: Gebietsart): { limit: number; zeit: 'Nachts' | 'Tagsüber' } {
  const tags = geraeteKlasse(o) === 'pool' && !!o.nurTags;
  return tags ? { limit: L.aussengeraete.richtwerteTagDbA.wert[gebiet], zeit: 'Tagsüber' } : { limit: L.waermepumpe.richtwerteNachtDbA.wert[gebiet], zeit: 'Nachts' };
}

function heatpump(site: Site, objs: Objects, fps: Record<ObjectKind, Vec2[]>): Result {
  const o = objs.waermepumpe;
  const fp = fps.waermepumpe;
  const W = L.waermepumpe;
  const klasse = geraeteKlasse(o);
  const gn = GERAETE_NAME[klasse];
  const AG = L.aussengeraete;
  const inside = insidePolygon(fp, site.plot.boundary);
  const collide = collision(site, fps, 'waermepumpe');
  const place = placement(site, fp);
  const Q = W.richtwirkungQ.wert[place];
  const { limit, zeit } = richtwertFuer(o, site.gebiet.value);
  const lw = o.lw ?? standardLw(klasse);
  const srcZ = W.quellhoeheM.wert;

  // maßgeblich: der lauteste Punkt über alle Fenster bzw. abgetasteten Fassaden (Abstand und Abschirmung)
  let best: { d: number; w: (typeof site.windows)[number]; pos: Vec2; z: number; lp: number; ab: ReturnType<typeof abschirmung> } | null = null;
  for (const w of site.windows) {
    for (const io of immissionsorte(w)) {
      const d = dist3([o.center[0], o.center[1], srcZ], [io.pos[0], io.pos[1], io.z]);
      const ab = abschirmung(site, o.center, fp, io.pos, w.buildingId);
      const lpHier = soundPressure(lw, Q, d) - ab.db;
      if (!best || lpHier > best.lp) best = { d, w, pos: io.pos, z: io.z, lp: lpHier, ab };
    }
  }
  const rLimit = limitRadius(lw, Q, limit);
  const rows: Row[] = [];
  if (klasse === 'lwwp') {
    rows.push({ text: 'Keine Baugenehmigung nötig am Ein- oder Zweifamilienhaus', tag: ART57, kind: 'rule' });
  } else if (klasse === 'klima') {
    rows.push({ text: 'Außeneinheit eines Klimageräts: verfahrensfrei als „sonstige Anlage der technischen Gebäudeausrüstung“ (Art. 57 Abs. 1 Nr. 2 Buchst. b)', tag: ART57, kind: 'rule' });
    rows.push({ text: 'Klimageräte nennt der Wortlaut nicht ausdrücklich; die Zuordnung ist eine Auslegung, das Bauamt bestätigt sie', tag: 'offen', kind: 'offen' });
  } else {
    rows.push({ text: 'Wärmepumpe eines Pools: verfahrensfrei als „sonstige Anlage der technischen Gebäudeausrüstung“ (Art. 57 Abs. 1 Nr. 2 Buchst. b)', tag: ART57, kind: 'rule' });
    rows.push({ text: 'Die Zuordnung der Pool-Wärmepumpe ist eine Auslegung, das Bauamt bestätigt sie', tag: 'offen', kind: 'offen' });
    rows.push({ text: `Das Schwimmbecken selbst prüft Passt. nicht (Art. 57 Abs. 1 Nr. 10 Buchst. a: verfahrensfrei, außer im Außenbereich${site.bereich.value === 'aussen' ? ' – hier angenommen: Außenbereich' : ''})`, tag: 'offen', kind: 'offen' });
  }
  const abstandBis = klasse === 'klima' ? AG.klimaAbstandsflaecheBisM.wert : klasse === 'pool' ? AG.poolAbstandsflaecheBisM.wert : L.abstand.waermepumpeOhneAbstandsflaecheBisM.wert;
  if (o.h <= abstandBis) {
    rows.push({ text: `Bis ${fmt(abstandBis, 0)} m Höhe braucht sie keine Abstandsfläche`, tag: 'BayBO Art. 6 Abs. 1', kind: 'rule' });
    if (klasse !== 'lwwp') rows.push({ text: klasse === 'klima' ? 'Art. 6 Abs. 1 Satz 3 Nr. 4 nennt „Wärmepumpen“; ob ein Klimagerät darunter fällt, regelt der Wortlaut nicht – Passt. wendet die 2 m als Annahme an' : 'Art. 6 Abs. 1 Satz 3 Nr. 4 nennt „Wärmepumpen“; ob die Vorschrift auch auf Pool-Wärmepumpen zielt, sagt der Wortlaut nicht ausdrücklich', tag: klasse === 'klima' ? 'Annahme' : 'offen', kind: klasse === 'klima' ? 'Annahme' : 'offen' });
  } else {
    rows.push({ text: `Über ${fmt(abstandBis, 0)} m Höhe (mit Einhausung): Abstandsfläche nötig – nicht geprüft`, tag: 'offen', kind: 'offen' });
  }
  if (o.geraet) {
    rows.push({ text: `${o.geraet.hersteller} ${o.geraet.modell}: Schallleistung ${fmt(lw, 0)} dB(A) im Nennbetrieb (EN 12102, Heat Pump KEYMARK)`, tag: 'zertifiziert', kind: 'zertifiziert' });
    rows.push({ text: 'Nachtbetrieb (Silent-Modus) ist oft leiser – laut Hersteller-Datenblatt prüfen', tag: 'offen', kind: 'offen' });
  } else if (klasse !== 'lwwp') {
    rows.push(o.lwVomNutzer
      ? { text: `Schallleistung ${fmt(lw, 0)} dB(A) von dir aus dem Datenblatt der Außeneinheit`, tag: 'nutzerbestätigt', kind: 'nutzerbestätigt' }
      : { text: `Schallleistung ${fmt(lw, 0)} dB(A) angenommen (Platzhalter) – Wert aus dem Datenblatt der Außeneinheit eingeben`, tag: 'Annahme', kind: 'Annahme' });
  }
  if (klasse === 'klima') rows.push({ text: 'Klimageräte laufen vor allem im Sommer und oft nachts. Dann sind Fenster häufiger offen. Passt. rechnet nachts (strengerer Richtwert)', tag: 'Annahme', kind: 'Annahme' });
  if (klasse === 'pool') rows.push(o.nurTags
    ? { text: 'Betrieb nur tagsüber (06–22 Uhr): Tagwerte nach TA Lärm Nr. 6.1 und 6.4', tag: 'nutzerbestätigt', kind: 'nutzerbestätigt' }
    : { text: 'Betrieb auch nachts angenommen (strengerer Richtwert). Läuft sie nur tagsüber, kannst du das einstellen', tag: 'Annahme', kind: 'Annahme' });

  if (!best) {
    rows.push({ text: 'Kein Nachbarfenster bekannt. Tipp auf die Fassade des Nachbarhauses.', tag: 'offen', kind: 'offen' });
    rows.push({ text: `${PLACEMENT_TEXT[place]}, ${GEBIET_TEXT[site.gebiet.value]}`, tag: site.gebiet.provenance, kind: site.gebiet.provenance });
    rows.push(...contextRows(site).filter((r) => r.kind === 'Demo'));
    const base = { rows, badSegments: [], dim: null, rLimit };
    if (!inside) return { ...base, status: 'bad', head: 'Steht nicht ganz auf deinem Grundstück.', sub: `Schieb ${gn.art} weiter nach innen.` };
    if (collide) return { ...base, status: 'bad', head: `Kollidiert ${collide}.`, sub: 'Such dir eine freie Stelle auf dem Grundstück.' };
    return { ...base, status: 'warn', head: 'Lärm noch nicht geprüft.', sub: `Ohne Nachbarfenster können wir den Pegel nicht berechnen. Ab ${fmt(rLimit, 1)} m Abstand sind es höchstens ${limit} dB(A).` };
  }

  const lp = best.lp;
  const Lr = Math.round(lp);
  rows.push(
    { text: `${zeit} am nächsten Fenster: ${Lr} dB(A). Richtwert: ${limit} dB(A)`, tag: 'TA Lärm', kind: 'rule' },
    { text: `Abstand zum nächsten Nachbarfenster: ${fmt(best.d, 1)} m`, tag: 'berechnet', kind: 'berechnet' },
  );
  if (best.ab.db > 0) {
    rows.push({ text: best.ab.art === 'abgewandt' ? `Auf der abgewandten Hausseite: −${best.ab.db} dB` : `Gebäude verdeckt die Sichtlinie: −${best.ab.db} dB`, tag: 'berechnet', kind: 'berechnet' });
  }
  if (best.w.provenance === 'Annahme') {
    rows.push({ text: best.w.fassade ? `Fenster angenommen: ganze Fassade abgetastet (alle ${fmt(W.fassadenRasterM.wert, 0)} m, ${fmt(W.fensterhoeheAnnahmeM.wert, 1)} m${best.w.zOG != null ? ` und ${fmt(best.w.zOG, 1)} m` : ''} hoch), lautester Punkt zählt` : `Fensterlage angenommen: Fassadenmitte auf ${fmt(W.fensterhoeheAnnahmeM.wert, 1)} m`, tag: 'Annahme', kind: 'Annahme' });
  }
  rows.push(
    { text: `${PLACEMENT_TEXT[place]}, ${GEBIET_TEXT[site.gebiet.value]}`, tag: site.gebiet.provenance, kind: site.gebiet.provenance },
    { text: klasse === 'lwwp' ? 'Vereinfachtes Schallmodell, ersetzt keine Schallprognose' : 'Vereinfachtes Schallmodell der Luftwärmepumpe (LAI) auch für diese Geräteklasse übernommen, ersetzt keine Schallprognose', tag: 'Annahme', kind: 'Annahme' },
    { text: 'Zuschlag für Ton- oder Informationshaltigkeit (TA Lärm) nicht berücksichtigt', tag: 'offen', kind: 'offen' },
  );
  if (site.demo) rows.push({ text: 'Grundstück und Nachbarhäuser sind erfunden', tag: 'Demo', kind: 'Demo' });

  let status: Status;
  let head: string;
  let sub: string;
  const marge = W.knappMargeDb.wert;
  if (!inside) { status = 'bad'; head = 'Steht nicht ganz auf deinem Grundstück.'; sub = `Schieb ${gn.art} weiter nach innen.`; }
  else if (collide) { status = 'bad'; head = `Kollidiert ${collide}.`; sub = 'Such dir eine freie Stelle auf dem Grundstück.'; }
  else if (lp > limit) { status = 'bad'; head = `${zeit} zu laut für die Nachbarn.`; sub = `Am nächsten Fenster kommen etwa ${Lr} dB(A) an, erlaubt sind ${limit}. Stell sie weiter weg oder nimm ein leiseres Gerät.`; }
  else if (lp > limit - marge) { status = 'warn'; head = 'Knapp, aber im Rahmen.'; sub = `${zeit} etwa ${Lr} dB(A) am nächsten Nachbarfenster. Der Richtwert liegt bei ${limit}.`; }
  else { status = 'ok'; head = 'Passt so.'; sub = `Keine Baugenehmigung nötig. ${zeit} kommen am nächsten Nachbarfenster etwa ${Lr} dB(A) an.`; }

  return { status, head, sub, rows, badSegments: [], rLimit, lp, dim: { p: o.center, q: best.pos, label: `${Lr} dB(A)` } };
}

/** Fläche eines Objekts (für Anzeige). */
export const objectArea = (o: Placed) => area(footprint(o));
export { polygonDistance };
