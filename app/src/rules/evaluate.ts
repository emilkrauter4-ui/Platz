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
import type { Gebietsart, ObjectKind, Placed, Result, Row, Site, Status, Vec2 } from './types';

export const LIMITS = L;

export function fmt(v: number, d = 2): string {
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

function analyse(site: Site, fp: Vec2[], wallFor: (a: Vec2, b: Vec2) => number): SegInfo[] {
  return segmentsOf(site).map((s) => {
    const m = polygonSegment(fp, s.a, s.b);
    const wallH = wallFor(s.a, s.b);
    const required = requiredDistance(wallH);
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
    segs: analyse(site, fps[k], (a, b) => {
      const [e0, e1] = facingWall(fps[k], a, b);
      return meanWallHeight(site, objs[k], e0, e1);
    }),
    provenance: 'berechnet',
  }));
  // Bestand auf dem eigenen Grundstück zählt mit (BayBO Art. 6: Gesamtlänge je Grenze).
  const bestandOnPlot = site.bestand.filter((b) => pointInPolygon(centroid(b.footprint), site.plot.boundary));
  const bestandCons: Contributor[] = bestandOnPlot.map((b) => ({
    id: b.id,
    fp: b.footprint,
    segs: analyse(site, b.footprint, () => b.height),
    provenance: b.provenance,
  }));
  const all = [...cons, ...bestandCons];
  const sums = sideSums(site, all);
  const total = sums.reduce((a, b) => a + b, 0);
  const bestandSums = sideSums(site, bestandCons);

  return {
    gartenhaus: building(site, objs, fps, 'gartenhaus', cons[0].segs, sums, total, bestandSums),
    carport: building(site, objs, fps, 'carport', cons[1].segs, sums, total, bestandSums),
    waermepumpe: heatpump(site, objs, fps),
  };
}

/* ---------- Gartenhaus und Carport ---------- */

function collision(site: Site, fps: Record<ObjectKind, Vec2[]>, k: ObjectKind): string | null {
  const fp = fps[k];
  for (const b of site.buildings) {
    if (overlaps(fp, b.footprint)) return b.own ? 'mit deinem Haus' : 'mit einem Nachbarhaus';
  }
  for (const other of ['gartenhaus', 'carport', 'waermepumpe'] as const) {
    if (other !== k && overlaps(fp, fps[other])) return NAMES[other].mit;
  }
  for (const b of site.bestand) {
    if (overlaps(fp, b.footprint)) return 'mit einem bestehenden Nebengebäude';
  }
  return null;
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

function limitFor(k: ObjectKind, o: Placed): Limit {
  if (k === 'gartenhaus') {
    const v = o.w * o.d * o.h;
    const max = L.gartenhaus.maxBruttoRauminhaltM3.wert;
    return {
      ok: v <= max + 1e-9,
      row: `Ohne Baugenehmigung bis ${max} m³ umbauten Raum. Deins: ${fmt(v, 1)} m³`,
      head: 'Zu groß für ohne Genehmigung.',
      sub: `Dein Gartenhaus hat ${fmt(v, 1)} m³ umbauten Raum. Ohne Bauantrag gehen bis ${max} m³.`,
    };
  }
  const a = o.w * o.d;
  const max = L.carport.maxFlaecheM2.wert;
  return {
    ok: a <= max + 1e-9,
    row: `Ohne Baugenehmigung bis ${max} m² Fläche. Deiner: ${fmt(a, 1)} m²`,
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
): Result {
  const o = objs[k];
  const fp = fps[k];
  const sides = site.plot.sides;
  const inside = insidePolygon(fp, site.plot.boundary);
  const lim = limitFor(k, o);
  const closest = segs.reduce((a, b) => (b.d < a.d ? b : a));
  const near = segs.filter((s) => s.near);
  const nearSides = [...new Set(near.map((s) => s.side))];
  const collide = collision(site, fps, k);

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
    const req = requiredDistance(maxWall);
    rows.push({ text: req > MIN_ABSTAND + EPS ? `Abstandsfläche 0,4 H = ${fmt(req)} m eingehalten` : `Mindestabstand von ${MIN_ABSTAND} m eingehalten`, tag: ART6, kind: 'rule' });
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
  rows.push(...contextRows(site));

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
    status = 'bad'; head = 'Im Außenbereich braucht das eine Genehmigung.'; sub = 'Außerhalb des bebauten Ortsteils ist auch ein kleines Nebengebäude nicht verfahrensfrei.';
  } else if (k === 'gartenhaus' && (site.aufenthaltsraum.value || site.feuerstaette.value)) {
    status = 'bad'; head = 'Mit Aufenthaltsraum oder Ofen braucht es eine Genehmigung.'; sub = 'Ohne Bauantrag gehen nur Gartenhäuser ohne Aufenthaltsraum und ohne Feuerstätte.';
  } else if (!lim.ok) {
    status = 'bad'; head = lim.head; sub = lim.sub;
  } else if (near.length) {
    const tooHigh = near.filter((s) => s.wallH > GRENZ_H + 1e-9);
    if (tooHigh.length) {
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

  return {
    status,
    head,
    sub,
    rows,
    badSegments: bad,
    dim: inside && closest.d > 0.02 ? { p: closest.p, q: closest.q, label: `${fmt(closest.d)} m` } : null,
  };
}

/** Die „schwächste" Herkunft gewinnt: eine Annahme bleibt eine Annahme. */
const RANK: Record<string, number> = { amtlich: 0, berechnet: 1, erkannt: 2, nutzerbestätigt: 3, Annahme: 4, offen: 5, Demo: 6 };
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

export function placement(site: Site, fp: Vec2[]): 'frei' | 'wand' | 'ecke' {
  const tol = L.waermepumpe.wandabstandM.wert;
  const dirs: Vec2[] = [];
  for (const b of site.buildings.filter((x) => x.own)) {
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

const PLACEMENT_TEXT = { frei: 'Gerät steht frei', wand: 'Gerät steht an der Hauswand', ecke: 'Gerät steht in einer Hausecke' };

function heatpump(site: Site, objs: Objects, fps: Record<ObjectKind, Vec2[]>): Result {
  const o = objs.waermepumpe;
  const fp = fps.waermepumpe;
  const W = L.waermepumpe;
  const inside = insidePolygon(fp, site.plot.boundary);
  const collide = collision(site, fps, 'waermepumpe');
  const place = placement(site, fp);
  const Q = W.richtwirkungQ.wert[place];
  const limit = W.richtwerteNachtDbA.wert[site.gebiet.value];
  const lw = o.lw ?? 58;
  const srcZ = W.quellhoeheM.wert;

  let best: { d: number; w: (typeof site.windows)[number] } | null = null;
  for (const w of site.windows) {
    const d = dist3([o.center[0], o.center[1], srcZ], [w.pos[0], w.pos[1], w.z]);
    if (!best || d < best.d) best = { d, w };
  }
  const rLimit = limitRadius(lw, Q, limit);
  const rows: Row[] = [
    { text: 'Keine Baugenehmigung nötig am Ein- oder Zweifamilienhaus', tag: ART57, kind: 'rule' },
  ];

  if (!best) {
    rows.push({ text: 'Kein Nachbarfenster bekannt. Tipp auf die Fassade des Nachbarhauses.', tag: 'offen', kind: 'offen' });
    rows.push({ text: `${PLACEMENT_TEXT[place]}, ${GEBIET_TEXT[site.gebiet.value]}`, tag: site.gebiet.provenance, kind: site.gebiet.provenance });
    rows.push(...contextRows(site).filter((r) => r.kind === 'Demo'));
    const base = { rows, badSegments: [], dim: null, rLimit };
    if (!inside) return { ...base, status: 'bad', head: 'Steht nicht ganz auf deinem Grundstück.', sub: 'Schieb die Wärmepumpe weiter nach innen.' };
    if (collide) return { ...base, status: 'bad', head: `Kollidiert ${collide}.`, sub: 'Such dir eine freie Stelle auf dem Grundstück.' };
    return { ...base, status: 'warn', head: 'Lärm noch nicht geprüft.', sub: `Ohne Nachbarfenster können wir den Pegel nicht berechnen. Ab ${fmt(rLimit, 1)} m Abstand sind es höchstens ${limit} dB(A).` };
  }

  const lp = soundPressure(lw, Q, best.d);
  const Lr = Math.round(lp);
  rows.push(
    { text: `Nachts am nächsten Fenster: ${Lr} dB(A). Richtwert: ${limit} dB(A)`, tag: 'TA Lärm', kind: 'rule' },
    { text: `Abstand zum nächsten Nachbarfenster: ${fmt(best.d, 1)} m`, tag: 'berechnet', kind: 'berechnet' },
  );
  if (best.w.provenance === 'Annahme') {
    rows.push({ text: `Fensterlage angenommen: Fassadenmitte auf ${fmt(W.fensterhoeheAnnahmeM.wert, 1)} m`, tag: 'Annahme', kind: 'Annahme' });
  }
  rows.push(
    { text: `${PLACEMENT_TEXT[place]}, ${GEBIET_TEXT[site.gebiet.value]}`, tag: site.gebiet.provenance, kind: site.gebiet.provenance },
    { text: 'Vereinfachtes Schallmodell, ersetzt keine Schallprognose', tag: 'Annahme', kind: 'Annahme' },
  );
  if (site.demo) rows.push({ text: 'Grundstück und Nachbarhäuser sind erfunden', tag: 'Demo', kind: 'Demo' });

  let status: Status;
  let head: string;
  let sub: string;
  const marge = W.knappMargeDb.wert;
  if (!inside) { status = 'bad'; head = 'Steht nicht ganz auf deinem Grundstück.'; sub = 'Schieb die Wärmepumpe weiter nach innen.'; }
  else if (collide) { status = 'bad'; head = `Kollidiert ${collide}.`; sub = 'Such dir eine freie Stelle auf dem Grundstück.'; }
  else if (lp > limit) { status = 'bad'; head = 'Nachts zu laut für die Nachbarn.'; sub = `Am nächsten Fenster kommen etwa ${Lr} dB(A) an, erlaubt sind ${limit}. Stell sie weiter weg oder nimm ein leiseres Gerät.`; }
  else if (lp > limit - marge) { status = 'warn'; head = 'Knapp, aber im Rahmen.'; sub = `Nachts etwa ${Lr} dB(A) am nächsten Nachbarfenster. Der Richtwert liegt bei ${limit}.`; }
  else { status = 'ok'; head = 'Passt so.'; sub = `Keine Baugenehmigung nötig. Nachts kommen am nächsten Nachbarfenster etwa ${Lr} dB(A) an.`; }

  return { status, head, sub, rows, badSegments: [], rLimit, lp, dim: { p: o.center, q: best.w.pos, label: `${Lr} dB(A)` } };
}

/** Fläche eines Objekts (für Anzeige). */
export const objectArea = (o: Placed) => area(footprint(o));
export { polygonDistance };
