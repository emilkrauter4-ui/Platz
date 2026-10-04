/**
 * Sonnenstand und Schatten (AUFTRAG_V2 Phase 3.2, Nachbar-Link). Selbst berechnet, reine Funktionen.
 *
 * Sonnenstand: NOAA-Näherung (Meeus, „Astronomical Algorithms“, vereinfachte Reihen), Genauigkeit gegen den
 * NREL-SPA (pvlib) im Test < 0,2°. Ohne Refraktion; unter 5° Sonnenhöhe zählt Passt. keinen Schatten.
 *
 * Schatten: Körper als Prismen (Grundriss, Unter- und Oberkante, Satteldach als First). Am Boden als konvexe Hülle der
 * verschobenen Ecken, ebenes Gelände (Annahme). Ob ein Punkt im Schatten liegt, prüft ein Strahl zur Sonne.
 */
import { footprint, pointInPolygon } from './geometry';
import { dachHoehe } from './abstand';
import { pflanzLinie, type Pflanze } from './pflanzen';
import type { Building, Placed, Vec2 } from './types';

const RAD = Math.PI / 180;
/** unter dieser Sonnenhöhe kein Schatten mehr gerechnet (Dämmerung, Horizont, Gelände) */
export const MIN_HOEHE_GRAD = 5;

export interface Sonnenstand {
  /** Höhe über dem Horizont in Grad */
  hoehe: number;
  /** Azimut in Grad, 0 = Nord, 90 = Ost */
  azimut: number;
}

/** Sonnenstand für einen Zeitpunkt (UTC) an geografischer Breite/Länge in Grad. */
export function sonnenstand(t: Date, lat: number, lon: number): Sonnenstand {
  const jd = t.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const wahr = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = wahr - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const dekl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const zgl = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  const minuten = t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60;
  const wahreZeit = (((minuten + zgl + 4 * lon) % 1440) + 1440) % 1440;
  const stundenwinkel = (wahreZeit / 4 < 0 ? wahreZeit / 4 + 180 : wahreZeit / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZ = Math.sin(phi) * Math.sin(dekl) + Math.cos(phi) * Math.cos(dekl) * Math.cos(stundenwinkel);
  const zenit = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  const az = Math.atan2(Math.sin(stundenwinkel), Math.cos(stundenwinkel) * Math.sin(phi) - Math.tan(dekl) * Math.cos(phi));
  return { hoehe: 90 - zenit / RAD, azimut: ((az / RAD + 180) % 360 + 360) % 360 };
}

/**
 * Lokale Richtung: x = Osten, y = Norden. Achtung: lokales System ist UTM, Gitter-Nord weicht in Sulzbach-Rosenberg
 * um ~2° von geografisch Nord ab (Meridiankonvergenz) – `konvergenz` in Grad wird vom Azimut abgezogen.
 */
export function sonnenRichtung(s: Sonnenstand, konvergenz = 0): Vec2 {
  const a = (s.azimut - konvergenz) * RAD;
  return [Math.sin(a), Math.cos(a)];
}

/** Ein Körper, der Schatten wirft. Höhen über dem Boden; `first`: Satteldach zwischen Traufe z1 und First. */
export interface Koerper {
  id: string;
  fp: Vec2[];
  z0: number;
  z1: number;
  first?: { a: Vec2; b: Vec2; z: number; halbeTiefe: number };
}

/** Körper eines platzierten Objekts. Carport: nur das Dach (darunter offen). */
export function koerperAus(o: Placed): Koerper {
  const fp = footprint(o);
  if (o.kind === 'carport') return { id: o.kind, fp, z0: o.h - 0.2, z1: o.h };
  const dh = dachHoehe(o);
  if (dh <= 0) return { id: o.kind, fp, z0: 0, z1: o.h };
  // First entlang der Breite w (wie rules/abstand.ts)
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const a: Vec2 = [o.center[0] - (c * o.w) / 2, o.center[1] - (s * o.w) / 2];
  const b: Vec2 = [o.center[0] + (c * o.w) / 2, o.center[1] + (s * o.w) / 2];
  return { id: o.kind, fp, z0: 0, z1: o.h, first: { a, b, z: o.h + dh, halbeTiefe: o.d / 2 } };
}

export function koerperPflanze(p: Pflanze): Koerper {
  if (p.art === 'hecke') {
    const [a, b] = pflanzLinie(p);
    return { id: 'pflanze', fp: footprint({ center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], w: Math.max(p.laenge, 0.6), d: 0.6, angle: p.angle }), z0: 0, z1: p.hoehe };
  }
  const r = p.art === 'baum' ? Math.max(0.8, p.hoehe / 3) : Math.min(1.2, Math.max(0.4, p.hoehe / 3));
  const fp = Array.from({ length: 8 }, (_, i) => [p.center[0] + r * Math.cos((i * Math.PI) / 4), p.center[1] + r * Math.sin((i * Math.PI) / 4)] as Vec2);
  return { id: 'pflanze', fp, z0: p.art === 'baum' ? p.hoehe * 0.45 : 0, z1: p.hoehe };
}

/** Bestehendes Gebäude aus LoD2: Prisma bis Traufe + halbe Dachhöhe (Dachform unbekannt, Annahme). */
export function koerperGebaeude(b: Building): Koerper | null {
  if (b.trauf == null) return null;
  const first = b.first ?? b.trauf;
  return { id: b.id, fp: b.footprint, z0: 0, z1: b.trauf + Math.max(0, first - b.trauf) / 2 };
}

function huelle(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const x = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Vec2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && x(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: Vec2[] = [];
  for (const q of [...p].reverse()) {
    while (up.length >= 2 && x(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** Schatten am Boden (ebenes Gelände): konvexe Hülle der in Schattenrichtung verschobenen Ecken. null = Sonne zu tief. */
export function schattenAmBoden(k: Koerper, s: Sonnenstand, konvergenz = 0): Vec2[] | null {
  if (s.hoehe < MIN_HOEHE_GRAD) return null;
  const d = sonnenRichtung(s, konvergenz);
  const f = 1 / Math.tan(s.hoehe * RAD);
  const v = (z: number): Vec2 => [-d[0] * z * f, -d[1] * z * f];
  const pts: Vec2[] = [];
  const add = (p: Vec2, z: number) => {
    const o = v(z);
    pts.push([p[0] + o[0], p[1] + o[1]]);
  };
  for (const p of k.fp) {
    add(p, k.z0);
    add(p, k.z1);
  }
  if (k.first) {
    add(k.first.a, k.first.z);
    add(k.first.b, k.first.z);
  }
  return huelle(pts);
}

/** Oberkante eines Körpers an einem Punkt im Grundriss. */
function oben(k: Koerper, p: Vec2): number {
  if (!k.first) return k.z1;
  const { a, b, z, halbeTiefe } = k.first;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const quer = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
  return k.z1 + (z - k.z1) * Math.max(0, 1 - quer / halbeTiefe);
}

/** Liegt Punkt p in Höhe zp (über Boden) im Schatten eines der Körper? → id des Körpers oder null. */
export function imSchatten(p: Vec2, zp: number, koerper: Koerper[], s: Sonnenstand, konvergenz = 0): string | null {
  if (s.hoehe < MIN_HOEHE_GRAD) return null;
  const d = sonnenRichtung(s, konvergenz);
  const steig = Math.tan(s.hoehe * RAD);
  for (const k of koerper) {
    const zmax = Math.max(k.z1, k.first?.z ?? 0);
    if (zmax <= zp) continue;
    const weit = (zmax - zp) / steig;
    // Vorfilter: Körper in Reichweite des Strahls?
    let tMin = Infinity;
    let tMax = -Infinity;
    let qMin = Infinity;
    let qMax = -Infinity;
    for (const q of k.fp) {
      const t = (q[0] - p[0]) * d[0] + (q[1] - p[1]) * d[1];
      const quer = (q[0] - p[0]) * d[1] - (q[1] - p[1]) * d[0];
      tMin = Math.min(tMin, t);
      tMax = Math.max(tMax, t);
      qMin = Math.min(qMin, quer);
      qMax = Math.max(qMax, quer);
    }
    if (tMax < 0 || tMin > weit || qMin > 0 || qMax < 0) continue;
    for (let t = 0.1; t <= weit; t += 0.2) {
      const q: Vec2 = [p[0] + d[0] * t, p[1] + d[1] * t];
      if (!pointInPolygon(q, k.fp)) continue;
      const z = zp + t * steig;
      if (z >= k.z0 && z <= oben(k, q)) return k.id;
    }
  }
  return null;
}

/**
 * Sonnenstunden an einem Punkt für einen Tag (Ortszeit egal, gerechnet in UTC über 24 h), Schritt in Minuten.
 * Gezählt wird, wenn die Sonne über MIN_HOEHE_GRAD steht und kein Körper den Strahl verdeckt.
 */
export function sonnenstunden(p: Vec2, zp: number, koerper: Koerper[], tag: Date, lat: number, lon: number, konvergenz = 0, schritt = 10): number {
  const start = Date.UTC(tag.getUTCFullYear(), tag.getUTCMonth(), tag.getUTCDate());
  let n = 0;
  for (let m = 0; m < 1440; m += schritt) {
    const s = sonnenstand(new Date(start + m * 60000), lat, lon);
    if (s.hoehe < MIN_HOEHE_GRAD) continue;
    if (!imSchatten(p, zp, koerper, s, konvergenz)) n++;
  }
  return (n * schritt) / 60;
}
