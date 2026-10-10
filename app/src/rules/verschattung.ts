/**
 * Zusätzliche Verschattung durch ein großes Vorhaben an festen Stichtagen (AUFTRAG_V3 B2), als Zahl in Stunden.
 *
 * Verglichen werden die Sonnenstunden eines Punktes ohne und mit dem Vorhaben (bei der Aufstockung: vorher/nachher).
 * Punkte: angenommene oder getippte Nachbarfenster (site.windows der Nachbargebäude) und Gartenpunkte außerhalb der
 * Grundstücksgrenze (Annahme, weil die Nachbargrundstücke nicht bekannt sind: Ringe in 2/5/8 m, alle 2 m, 1 m über Boden,
 * nicht in Gebäuden). Eine gesetzliche Grenze für Verschattung gibt es in der BayBO nicht (limits.json schattenStichtage);
 * die Zahlen sind Information für das Gespräch mit den Nachbarn, keine Ampel.
 * Selbst gerechnet (sonne.ts), ebenes Gelände angenommen.
 */
import L from './limits.json';
import { koerperAus, koerperGebaeude, sonnenstunden, type Koerper } from './sonne';
import { edges, pointInPolygon } from './geometry';
import { aufgestockt, grundriss, type Vorhaben } from './vorhaben';
import { vorhabenDachHoehe } from './vorhaben';
import type { Site, Vec2 } from './types';

const G = L.grossesVorhaben;
export const RINGE_M: number[] = G.schattenGartenRingeM.wert;
export const STICHTAGE: string[] = G.schattenStichtage.wert;
const GARTEN_Z = 1.0;
const MAX_GARTENPUNKTE = 150;

export interface Lage {
  lat: number;
  lon: number;
  /** Meridiankonvergenz in Grad */
  konv: number;
}

export interface SchattenPunkt {
  art: 'fenster' | 'garten';
  p: Vec2;
  z: number;
  /** Sonnenstunden ohne / mit Vorhaben je Stichtag */
  ohne: number[];
  mit: number[];
  /** zusätzliche Verschattung je Stichtag in Stunden */
  extra: number[];
  annahme: boolean;
}

export interface SchattenErgebnis {
  stichtage: string[];
  punkte: SchattenPunkt[];
  fenster: { n: number; maxExtra: number[]; betroffen: number[] };
  garten: { n: number; maxExtra: number[]; mittelExtra: number[]; betroffen: number[] };
  ms: number;
}

/** Körper des Vorhabens: Haus mit Sattel-, Pult- oder Flachdach. */
export function vorhabenKoerper(site: Site, v: Vorhaben): Koerper | null {
  const g = grundriss(site, v);
  if (!g) return null;
  if (v.art === 'aufstockung') return g.host ? koerperGebaeude(aufgestockt(g.host, v)) : null;
  const proxy = g.proxy!;
  if (v.dachform !== 'pult') return { ...koerperAus(proxy), id: 'vorhaben' };
  const dh = vorhabenDachHoehe(v, g);
  const es = edges(g.fp);
  const [a, b] = es[g.niedrigKante ?? 0];
  // nach innen: von der niedrigen Kante zur gegenüberliegenden
  const gegenueber = es[(g.niedrigKante ?? 0) === 0 ? 2 : 0][0];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  let n: Vec2 = [-dy / l, dx / l];
  if ((gegenueber[0] - a[0]) * n[0] + (gegenueber[1] - a[1]) * n[1] < 0) n = [-n[0], -n[1]];
  return { id: 'vorhaben', fp: g.fp, z0: 0, z1: proxy.h, pult: { a, b, n, z: proxy.h + dh, tiefe: proxy.d } };
}

/** Körper der Umgebung: Gebäude aus LoD2 im Umkreis, ohne das aufgestockte Haus. */
function umgebung(site: Site, mitte: Vec2, ohneId?: string): Koerper[] {
  return site.buildings
    .filter((b) => b.id !== ohneId && b.footprint.some((p) => Math.hypot(p[0] - mitte[0], p[1] - mitte[1]) < 120))
    .map(koerperGebaeude)
    .filter((k): k is Koerper => !!k);
}

/** Gartenpunkte außerhalb der Grenze, in der Nähe des Vorhabens (Annahme). */
export function gartenPunkte(site: Site, mitte: Vec2, reichweite = 40): Vec2[] {
  const plot = site.plot.boundary;
  const pts: Vec2[] = [];
  const ccw = plot.reduce((s, p, i) => s + (p[0] * plot[(i + 1) % plot.length][1] - plot[(i + 1) % plot.length][0] * p[1]), 0) > 0;
  for (const [a, b] of edges(plot)) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1) continue;
    const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const n: Vec2 = ccw ? [u[1], -u[0]] : [-u[1], u[0]];
    for (const r of RINGE_M) {
      for (let t = 1; t < len; t += 2) {
        const p: Vec2 = [a[0] + u[0] * t + n[0] * r, a[1] + u[1] * t + n[1] * r];
        if (Math.hypot(p[0] - mitte[0], p[1] - mitte[1]) > reichweite) continue;
        if (pointInPolygon(p, plot)) continue;
        if (site.buildings.some((b) => pointInPolygon(p, b.footprint))) continue;
        pts.push(p);
      }
    }
  }
  if (pts.length <= MAX_GARTENPUNKTE) return pts;
  const k = pts.length / MAX_GARTENPUNKTE;
  return Array.from({ length: MAX_GARTENPUNKTE }, (_, i) => pts[Math.floor(i * k)]);
}

export function berechneVerschattung(site: Site, v: Vorhaben, lage: Lage, jahr = 2026, schritt = 10): SchattenErgebnis | null {
  const t0 = performance.now();
  const neu = vorhabenKoerper(site, v);
  const g = grundriss(site, v);
  if (!neu || !g) return null;
  const mitte = g.fp.reduce<Vec2>((s, p) => [s[0] + p[0] / g.fp.length, s[1] + p[1] / g.fp.length], [0, 0]);
  const ohneId = v.art === 'aufstockung' ? v.zielId : undefined;
  const umf = umgebung(site, mitte, ohneId);
  // ohne Vorhaben: bei der Aufstockung das Haus in der alten Höhe, sonst nur die Umgebung
  const alt = v.art === 'aufstockung' && g.host ? koerperGebaeude(g.host) : null;
  const basis = alt ? [...umf, alt] : umf;
  const mit = [...umf, neu];
  const tage = STICHTAGE.map((s) => {
    const [m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(jahr, m - 1, d));
  });

  const kandidaten: { art: SchattenPunkt['art']; p: Vec2; z: number; annahme: boolean }[] = [];
  for (const w of site.windows) {
    const geb = site.buildings.find((b) => b.id === w.buildingId);
    if (geb?.own || (v.art === 'aufstockung' && w.buildingId === v.zielId)) continue;
    if (Math.hypot(w.pos[0] - mitte[0], w.pos[1] - mitte[1]) > 60) continue;
    kandidaten.push({ art: 'fenster', p: w.pos, z: w.z, annahme: w.provenance === 'Annahme' });
  }
  for (const p of gartenPunkte(site, mitte)) kandidaten.push({ art: 'garten', p, z: GARTEN_Z, annahme: true });

  const punkte: SchattenPunkt[] = kandidaten.map((k) => {
    const ohne = tage.map((t) => sonnenstunden(k.p, k.z, basis, t, lage.lat, lage.lon, lage.konv, schritt));
    const mitV = tage.map((t) => sonnenstunden(k.p, k.z, mit, t, lage.lat, lage.lon, lage.konv, schritt));
    const extra = ohne.map((o, i) => Math.max(0, o - mitV[i]));
    return { ...k, ohne, mit: mitV, extra };
  });
  const zusammen = (art: SchattenPunkt['art']) => {
    const ps = punkte.filter((p) => p.art === art);
    const je = (f: (xs: number[]) => number) => tage.map((_, i) => f(ps.map((p) => p.extra[i])));
    return {
      n: ps.length,
      maxExtra: je((xs) => Math.max(0, ...xs)),
      mittelExtra: je((xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)),
      betroffen: je((xs) => xs.filter((x) => x >= 0.25).length),
    };
  };
  const f = zusammen('fenster');
  const ga = zusammen('garten');
  return {
    stichtage: STICHTAGE,
    punkte,
    fenster: { n: f.n, maxExtra: f.maxExtra, betroffen: f.betroffen },
    garten: ga,
    ms: performance.now() - t0,
  };
}

export const STICHTAG_NAME: Record<string, string> = { '03-21': '21. März', '12-21': '21. Dezember' };
