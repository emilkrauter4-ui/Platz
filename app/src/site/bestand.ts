/**
 * Bestehende Objekte im Garten (Garten-Erkennung, pipeline/08_garten.py): Zuordnung zu den Grenzen
 * („Steht hier schon etwas?“), Maße aus nachgezogenen Umrissen und Texte mit Spanne.
 * Reine Funktionen ohne Cesium, mit Vitest getestet.
 */
import { LIMITS, fmt } from '../rules/evaluate';
import { area, centroid, edges, pointSegment } from '../rules/geometry';
import type { Bestand, GartenKlasse, Vec2 } from '../rules/types';

export const KLASSE_TEXT: Record<GartenKlasse, string> = {
  gartenhaus: 'Gartenhaus',
  gewaechshaus: 'Gewächshaus',
  carport_garage: 'Carport oder Garage',
  pool: 'Pool',
  teich: 'Teich',
  terrasse: 'Terrasse oder befestigte Fläche',
  trampolin: 'Trampolin',
  spielturm: 'Spielturm',
  hecke: 'Hecke',
  baum: 'Baum',
  strauch: 'Strauch',
  waermepumpe: 'Wärmepumpe (Außengerät)',
  zaun_mauer: 'Zaun oder Mauer',
};

/** Datensatz aus bestand.json (v2: Garten-Erkennung mit Maßen; v1: nur Kleinbauten). */
export interface BestandRec {
  id: string;
  fp: Vec2[];
  h: number;
  a: number;
  conf: number;
  k?: GartenKlasse;
  l?: number;
  b?: number;
  sl?: number;
  sh?: number;
  wh?: number;
  sw?: number;
  rund?: 1;
}

export function fromRec(r: BestandRec): Bestand {
  const m = (wert: number | undefined, spanne: number | undefined) => (wert == null ? undefined : { wert, spanne: spanne ?? 0 });
  return {
    id: r.id,
    footprint: r.fp,
    // Grenzbebauung: mittlere Wandhöhe, falls Dachebenen erkannt; sonst Gesamthöhe (sicher nach oben)
    height: r.wh ?? r.h ?? 0,
    provenance: 'erkannt',
    confidence: r.conf,
    kind: r.k,
    laenge: m(r.l, r.sl),
    breite: m(r.b, r.sl),
    hoehe: m(r.h, r.sh),
    wand: m(r.wh, r.sw),
    rund: r.rund === 1,
  };
}

/** Minimales gedrehtes Rechteck (Drehschieblehre über die konvexe Hülle): Länge ≥ Breite, Winkel der Länge. */
export function minRect(poly: Vec2[]): { laenge: number; breite: number; winkel: number; ecken: Vec2[] } {
  const h = hull(poly);
  let best = { flaeche: Infinity, laenge: 0, breite: 0, winkel: 0, ecken: [] as Vec2[] };
  for (const [a, b] of edges(h)) {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of h) {
      const x = p[0] * c + p[1] * s;
      const y = -p[0] * s + p[1] * c;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const w = x1 - x0;
    const d = y1 - y0;
    if (w * d < best.flaeche) {
      const back = (x: number, y: number): Vec2 => [x * c - y * s, x * s + y * c];
      best = {
        flaeche: w * d, laenge: Math.max(w, d), breite: Math.min(w, d), winkel: w >= d ? ang : ang + Math.PI / 2,
        ecken: [back(x0, y0), back(x1, y0), back(x1, y1), back(x0, y1)],
      };
    }
  }
  return { laenge: best.laenge, breite: best.breite, winkel: best.winkel, ecken: best.ecken };
}

function hull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Vec2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: Vec2[] = [];
  for (const q of [...p].reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/**
 * Seiten der Grenze, an denen das Objekt steht (Abstand ≤ grenzNaheM). Ein Objekt in einer Ecke gehört zu
 * beiden Seiten.
 */
export function seitenAnGrenze(fp: Vec2[], boundary: Vec2[], segmentSide: number[], maxD = LIMITS.bestand.grenzNaheM.wert): number[] {
  const out = new Set<number>();
  edges(boundary).forEach(([a, b], i) => {
    const d = Math.min(...fp.map((p) => pointSegment(p, a, b).d));
    if (d <= maxD + 1e-9) out.add(segmentSide[i]);
  });
  return [...out].sort((x, y) => x - y);
}

/** Griffe zum Nachziehen: Rechteck-Ecken für Bauten, Pools, Terrassen; sonst der (vereinfachte) Umriss. */
export function griffe(b: Bestand): Vec2[] {
  const eckig = !b.kind || ['gartenhaus', 'gewaechshaus', 'carport_garage', 'pool', 'terrasse', 'spielturm', 'waermepumpe'].includes(b.kind);
  if (eckig && !b.rund) return minRect(b.footprint).ecken;
  if (b.footprint.length <= 12) return b.footprint.map((p) => [p[0], p[1]] as Vec2);
  const step = b.footprint.length / 12;
  return Array.from({ length: 12 }, (_, i) => b.footprint[Math.floor(i * step)]);
}

/** Nachgezogener Umriss → Maße neu (Spanne 0,10 m: Fingergenauigkeit im Plan bei Einrasten). */
export function nachgezogen(b: Bestand, fp: Vec2[]): Bestand {
  const r = minRect(fp);
  return {
    ...b,
    footprint: fp,
    provenance: 'nutzerbestätigt',
    laenge: { wert: r.laenge, spanne: 0.1 },
    breite: { wert: r.breite, spanne: 0.1 },
  };
}

const pm = (m: { wert: number; spanne: number }) => (m.spanne > 0 ? `${fmt(m.wert)} m (±${fmt(m.spanne)} m)` : `${fmt(m.wert)} m`);

/** Kurzbeschreibung mit Maßen und Spanne, z. B. „Gartenhaus, 3,10 × 2,40 m (±0,25 m), Wand 2,30 m (±0,15 m)“. */
export function beschreibung(b: Bestand): string {
  const name = b.kind ? KLASSE_TEXT[b.kind] : 'Kleinbau';
  const teile = [name];
  if (b.laenge && b.breite) {
    const sp = Math.max(b.laenge.spanne, b.breite.spanne);
    teile.push(
      b.rund
        ? `Ø ${fmt(b.laenge.wert)} m${sp > 0 ? ` (±${fmt(sp)} m)` : ''}`
        : `${fmt(b.laenge.wert)} × ${fmt(b.breite.wert)} m${sp > 0 ? ` (±${fmt(sp)} m)` : ''}`,
    );
  } else {
    teile.push(`${fmt(area(b.footprint), 0)} m²`);
  }
  if (b.wand) teile.push(`Wandhöhe ${pm(b.wand)}`);
  else if (b.hoehe && b.hoehe.wert > 0.3 && b.kind !== 'pool' && b.kind !== 'teich' && b.kind !== 'terrasse') teile.push(`${pm(b.hoehe)} hoch`);
  else if (!b.kind) teile.push(`${fmt(b.height, 1)} m hoch`);
  return teile.join(', ');
}

/** Für „Steht hier schon etwas?“: je Grenzseite die Objekte dort, dazu alle übrigen im Garten. */
export function jeGrenze(bestand: Bestand[], boundary: Vec2[], segmentSide: number[], nSeiten: number): { seiten: Bestand[][]; innen: Bestand[] } {
  const seiten: Bestand[][] = Array.from({ length: nSeiten }, () => []);
  const innen: Bestand[] = [];
  for (const b of bestand) {
    const s = seitenAnGrenze(b.footprint, boundary, segmentSide);
    if (s.length) s.forEach((i) => seiten[i].push(b));
    else innen.push(b);
  }
  const ord = (a: Bestand, b: Bestand) => Number(isBau(b)) - Number(isBau(a)) || area(b.footprint) - area(a.footprint);
  seiten.forEach((l) => l.sort(ord));
  innen.sort(ord);
  return { seiten, innen };
}

const isBau = (b: Bestand) => !b.kind || ['gartenhaus', 'gewaechshaus', 'carport_garage'].includes(b.kind);

/** Neues, vom Nutzer gezeichnetes Objekt (Rechteck aus vier Ecken). Höhe ist eine Annahme, bis er sie ändert. */
export function neuesObjekt(id: string, fp: Vec2[], kind: GartenKlasse, hoehe: number): Bestand {
  const r = minRect(fp);
  return {
    id,
    footprint: fp,
    height: hoehe,
    provenance: 'nutzerbestätigt',
    kind,
    laenge: { wert: r.laenge, spanne: 0.1 },
    breite: { wert: r.breite, spanne: 0.1 },
    hoehe: { wert: hoehe, spanne: 0 },
  };
}

export { centroid };

/** Antwort des Tipp-Dienstes (pipeline/tipp.py). Koordinaten in EPSG:25832. */
export interface TippAntwort {
  ok: boolean;
  grund?: string;
  label?: string;
  klasse?: GartenKlasse;
  vorschlag?: { klasse: GartenKlasse; p: number }[];
  umriss?: Vec2[];
  masse?: {
    form?: 'kreis' | 'rechteck';
    laenge?: number; breite?: number; spanne_laenge?: number; spanne_breite?: number;
    hoehe?: number; spanne_hoehe?: number; wandhoehe_mittel?: number; spanne_wand?: number;
  };
  quelle?: string;
}

/**
 * „Ein Tipp erfasst“: Antwort des Dienstes → Bestand mit Herkunft „erfasst per Tipp“ (lokale Koordinaten).
 * Klasse wählt der Nutzer; ohne Wahl gilt der Vorschlag. Höhe für die Grenzbebauung: mittlere Wandhöhe aus den
 * Dachebenen, sonst die Gesamthöhe (sicher nach oben); eine vom Nutzer eingegebene Wandhöhe geht vor.
 */
export function ausTipp(id: string, a: TippAntwort, origin: Vec2, klasse?: GartenKlasse, wandhoehe?: number): Bestand {
  if (!a.ok || !a.umriss || a.umriss.length < 3) throw new Error(a.grund ?? 'Tipp ohne Umriss');
  const fp: Vec2[] = a.umriss.map(([x, y]) => [x - origin[0], y - origin[1]]);
  const m = a.masse ?? {};
  const r = minRect(fp);
  const mass = (wert: number | undefined, spanne: number | undefined, ersatz: number) => ({ wert: wert ?? ersatz, spanne: spanne ?? 0.3 });
  const hoehe = m.hoehe != null ? { wert: m.hoehe, spanne: m.spanne_hoehe ?? 0.3 } : undefined;
  const wand = m.wandhoehe_mittel != null ? { wert: m.wandhoehe_mittel, spanne: m.spanne_wand ?? 0.3 } : undefined;
  return {
    id,
    footprint: fp,
    height: wandhoehe ?? wand?.wert ?? hoehe?.wert ?? 0,
    provenance: 'erfasst per Tipp',
    kind: klasse ?? a.klasse,
    laenge: mass(m.laenge, m.spanne_laenge, r.laenge),
    breite: mass(m.breite, m.spanne_breite, r.breite),
    hoehe: wandhoehe != null ? { wert: wandhoehe, spanne: 0 } : hoehe,
    wand: wandhoehe != null ? undefined : wand,
    rund: m.form === 'kreis',
  };
}
