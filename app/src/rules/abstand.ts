/**
 * Abstandsflächen nach BayBO Art. 6 (Wortlaut: docs/recht/BayBO_Art6.txt).
 *
 * - Abs. 4: Tiefe nach der Wandhöhe, senkrecht zur Wand. Wandhöhe = Geländeoberfläche bis Schnittpunkt Wand/Dachhaut.
 *   Dächer bis einschließlich 70° zu einem Drittel, steiler voll hinzugerechnet → H.
 * - Abs. 5: Tiefe 0,4 H, mindestens 3 m.
 * - Abs. 2: Abstandsflächen auf dem eigenen Grundstück (öffentliche Verkehrs-/Grün-/Wasserflächen bis zur Mitte: offen).
 * - Abs. 3: keine Überdeckung, außer Wände > 75° zueinander und in Abstandsflächen zulässige Anlagen.
 * - Abs. 7 Satz 1 Nr. 1: Garagen und Gebäude ohne Aufenthaltsräume/Feuerstätten mit mittlerer Wandhöhe bis 3 m sind
 *   in den Abstandsflächen und ohne eigene Abstandsflächen zulässig; Dächer > 45° zu einem Drittel, > 70° voll;
 *   Giebelflächen bis 45° unberücksichtigt.
 *
 * Auslegungen, die nicht eindeutig aus dem Wortlaut folgen, sind im Ergebnis als `offen` gekennzeichnet.
 * Reine Funktionen, keine Abhängigkeit zu Cesium.
 */
import L from './limits.json';
import { area, clipArea, edges, footprint, pointInPolygon, signedArea } from './geometry';
import type { Building, Placed, Site, Vec2 } from './types';

const FAKTOR = L.abstand.faktorH.wert;
const MIN_T = L.abstand.minM.wert;
const STEIL = L.abstand.dachVollAbGrad.wert; // > 70°: voll
const A7_DACH = L.grenzbebauung.dachDrittelAbGrad.wert; // > 45°: ein Drittel
const WINKEL_UEBERDECKUNG = L.abstand.ueberdeckungWinkelGrad.wert; // > 75°

export type WandTyp = 'flach' | 'traufe' | 'giebel';

export interface Wand {
  a: Vec2;
  b: Vec2;
  typ: WandTyp;
  /** Wandhöhe über Gelände an a und b (bis Traufe bzw. oberem Abschluss) */
  wa: number;
  wb: number;
  /** H nach Abs. 4 an a und b */
  ha: number;
  hb: number;
  /** Tiefe der Abstandsfläche an a und b */
  ta: number;
  tb: number;
  /** Abstandsfläche am Boden */
  flaeche: Vec2[];
}

/** Dachhöhe (First über Traufe) eines Satteldachs mit First entlang der Breite w. */
export function dachHoehe(o: Pick<Placed, 'd' | 'neigung'>): number {
  const n = o.neigung ?? 0;
  if (n <= 0) return 0;
  return (o.d / 2) * Math.tan((n * Math.PI) / 180);
}

/** Brutto-Rauminhalt: Quader bis Traufe plus Dachraum (Satteldach = halbes Prisma). */
export function rauminhalt(o: Pick<Placed, 'w' | 'd' | 'h' | 'neigung'>): number {
  return o.w * o.d * o.h + (o.w * o.d * dachHoehe(o)) / 2;
}

const tiefe = (h: number) => Math.max(MIN_T, FAKTOR * h);
const dachAnteil4 = (neigung: number) => (neigung > STEIL ? 1 : 1 / 3);

function aussenNormale(a: Vec2, b: Vec2, ccw: boolean): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return ccw ? [dy / l, -dx / l] : [-dy / l, dx / l];
}

function flaeche(a: Vec2, b: Vec2, ta: number, tb: number, n: Vec2): Vec2[] {
  return [a, b, [b[0] + n[0] * tb, b[1] + n[1] * tb], [a[0] + n[0] * ta, a[1] + n[1] * ta]];
}

/**
 * Wände des platzierten Objekts mit H und Abstandsfläche. Fußboden am höchsten Geländepunkt (wie im Regelwerk),
 * Wandhöhe an jedem Wandende über dem dortigen Gelände (DGM1) – am Hang wird die Fläche zum Trapez.
 * Satteldach: First entlang der Breite w → Kanten 0 und 2 sind Traufwände, 1 und 3 Giebelwände.
 */
export function waende(site: Site, o: Placed): Wand[] {
  const fp = footprint(o);
  const ground = (p: Vec2) => (site.ground ? site.ground(p) : 0);
  const base = o.baseElevation ?? Math.max(...fp.map(ground));
  const traufe = base + o.h;
  const dh = dachHoehe(o);
  const neig = o.neigung ?? 0;
  return edges(fp).map(([a, b], i) => {
    const typ: WandTyp = dh <= 0 ? 'flach' : i % 2 === 0 ? 'traufe' : 'giebel';
    const wa = traufe - ground(a);
    const wb = traufe - ground(b);
    const zu = typ === 'flach' ? 0 : dh * dachAnteil4(neig);
    const ha = wa + zu;
    const hb = wb + zu;
    const ta = tiefe(ha);
    const tb = tiefe(hb);
    return { a, b, typ, wa, wb, ha, hb, ta, tb, flaeche: flaeche(a, b, ta, tb, aussenNormale(a, b, true)) };
  });
}

/**
 * Mittlere Wandhöhe nach Abs. 7 Satz 1 Nr. 1 für eine Wand: Mittel der Wandhöhe über Gelände, dazu das Dach
 * (> 45° ein Drittel, > 70° voll). Giebelflächen bis 45° bleiben unberücksichtigt; darüber nimmt Passt. die
 * mittlere Giebelhöhe (halbe Dachhöhe) – der Wortlaut sagt nicht, wie (offen, sicher nach oben).
 */
export function wandhoeheArt7(w: Wand, o: Placed): { h: number; offen: boolean } {
  const mittel = (w.wa + w.wb) / 2;
  const dh = dachHoehe(o);
  const n = o.neigung ?? 0;
  if (dh <= 0 || n <= A7_DACH) return { h: mittel, offen: false };
  if (w.typ === 'traufe') return { h: mittel + dh * (n > STEIL ? 1 : 1 / 3), offen: false };
  return { h: mittel + Math.max(dh / 2, dh * (n > STEIL ? 1 : 1 / 3)), offen: true };
}

/**
 * Abstandsflächen eines bestehenden Gebäudes aus LoD2 (Trauf- und Firsthöhe über Grund). Die Dachneigung ist nicht
 * bekannt: Annahme ≤ 70°, also Dach und Giebel zu einem Drittel → H = Traufe + (First − Traufe) / 3 an allen Wänden.
 */
const CACHE = new WeakMap<Building, { key: string; r: { a: Vec2; b: Vec2; flaeche: Vec2[]; h: number }[] }>();

export function gebaeudeFlaechen(b: Building): { a: Vec2; b: Vec2; flaeche: Vec2[]; h: number }[] {
  const key = `${b.trauf}|${b.first}|${b.footprint.length}`;
  const c = CACHE.get(b);
  if (c && c.key === key) return c.r;
  const r = gebaeudeFlaechenNeu(b);
  CACHE.set(b, { key, r });
  return r;
}

function gebaeudeFlaechenNeu(b: Building): { a: Vec2; b: Vec2; flaeche: Vec2[]; h: number }[] {
  if (b.trauf == null) return [];
  const h = b.trauf + Math.max(0, (b.first ?? b.trauf) - b.trauf) / 3;
  const t = tiefe(h);
  const ccw = signedArea(b.footprint) > 0;
  return edges(b.footprint)
    .filter(([a, c]) => Math.hypot(c[0] - a[0], c[1] - a[1]) > 0.3)
    .map(([a, c]) => ({ a, b: c, h, flaeche: flaeche(a, c, t, t, aussenNormale(a, c, ccw)) }));
}

/** Winkel zwischen zwei Wänden in Grad (0–90, Richtung egal). */
export function wandWinkel(a1: Vec2, b1: Vec2, a2: Vec2, b2: Vec2): number {
  const u = Math.atan2(b1[1] - a1[1], b1[0] - a1[0]);
  const v = Math.atan2(b2[1] - a2[1], b2[0] - a2[0]);
  let d = Math.abs(((u - v) * 180) / Math.PI) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

export interface AFPruefung {
  waende: Wand[];
  /** Teil der Abstandsflächen außerhalb des Grundstücks (m²) je Wand */
  ausserhalb: number[];
  /** Überdeckungen mit Abstandsflächen eigener Gebäude (Abs. 3), nur wo nicht über 75° */
  ueberdeckung: { wand: number; gebaeude: string; flaeche: number }[];
  /** Objekt steht in der Abstandsfläche eines eigenen Gebäudes oder ein Gebäude in seiner (Abs. 1 Satz 1) */
  inFlaeche: { gebaeude: string; richtung: 'objekt_in_haus' | 'haus_in_objekt' }[];
  /** Abstandsflächen der eigenen Gebäude (zur Anzeige) */
  hausFlaechen: Vec2[][];
}

/** Konvexe Hülle genügt für clipArea (Abstandsflächen sind Trapeze, also konvex). */
export function pruefeAbstandsflaechen(site: Site, o: Placed): AFPruefung {
  const ws = waende(site, o);
  const fp = footprint(o);
  const plot = site.plot.boundary;
  const ausserhalb = ws.map((w) => Math.max(0, area(w.flaeche) - clipArea(plot, w.flaeche)));
  const ueberdeckung: AFPruefung['ueberdeckung'] = [];
  const inFlaeche: AFPruefung['inFlaeche'] = [];
  const hausFlaechen: Vec2[][] = [];
  for (const g of site.buildings.filter((x) => x.own)) {
    const gf = gebaeudeFlaechen(g);
    gf.forEach((x) => hausFlaechen.push(x.flaeche));
    ws.forEach((w, i) => {
      for (const h of gf) {
        if (wandWinkel(w.a, w.b, h.a, h.b) > WINKEL_UEBERDECKUNG) continue;
        const f = clipArea(h.flaeche, w.flaeche);
        if (f > 0.05) ueberdeckung.push({ wand: i, gebaeude: g.id, flaeche: f });
      }
    });
    if (gf.some((h) => clipArea(fp, h.flaeche) > 0.05)) inFlaeche.push({ gebaeude: g.id, richtung: 'objekt_in_haus' });
    if (ws.some((w) => clipArea(g.footprint, w.flaeche) > 0.05 || g.footprint.some((p) => pointInPolygon(p, w.flaeche)))) {
      inFlaeche.push({ gebaeude: g.id, richtung: 'haus_in_objekt' });
    }
  }
  return { waende: ws, ausserhalb, ueberdeckung, inFlaeche, hausFlaechen };
}
