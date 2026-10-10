/**
 * Die unsichtbare Hülle des Baurechts (AUFTRAG_V4 C1): die größte zulässige Höhe H an jedem Punkt des Grundstücks, soweit es die
 * Abstandsflächen nach BayBO Art. 6 betrifft. ANNÄHERUNG (Label „Annäherung“), kein Rechtsurteil.
 *
 * Umkehrung des Wortlauts: Tiefe der Abstandsfläche t = max(3 m, 0,4 H) (Abs. 5 Satz 1); sie muss auf dem Grundstück selbst liegen
 * (Abs. 2 Satz 1), an öffentlichen Verkehrsflächen bis zu deren Mitte (Satz 2), und darf sich nicht mit den Abstandsflächen eigener
 * Gebäude überdecken (Abs. 3). Steht eine Wand im Abstand d vom nächsten Hindernis, passt sie, wenn t ≤ d: H = d / 0,4 = 2,5 d für
 * d ≥ 3 m, darunter keine Wand mit Abstandsfläche (H = 0).
 *
 * Warum der Abstand in ALLE Richtungen: Die Abstandsfläche einer Wand ist die Vereinigung der Strecken senkrecht von jedem Wandpunkt q
 * nach außen, jede Strecke der Länge t. Liegt um jeden Wandpunkt q die Kreisscheibe vom Radius t im erlaubten Bereich, liegt die ganze
 * Abstandsfläche darin – für jede Ausrichtung der Wand. Jedes Gebäude hat eine Wand zur nächsten Grenze, also ist das die sichere Seite.
 * Wer der Grenze den Rücken zukehrt, dürfte höher bauen; die Hülle zeigt das nicht.
 *
 * Nicht Teil der Hülle: Höhengrenzen aus Bebauungsplan oder § 34 BauGB; Ausnahmen (Abs. 3 Nr. 1 bis 3, Abs. 7: Garagen und kleine
 * Nebengebäude bis 3 m Wandhöhe in den Abstandsflächen); Grün- und Wasserflächen (keine Daten). Reine Funktionen, serialisierbar,
 * damit der Hintergrund-Worker rechnen kann.
 */
import L from './limits.json';
import { edges, pointInPolygon, pointSegment, signedArea } from './geometry';
import { gebaeudeFlaechen } from './abstand';
import { geprueft, istGebaeude } from './evaluate';
import type { Site, Vec2 } from './types';

const FAKTOR = L.abstand.faktorH.wert;
const MIN_T = L.abstand.minM.wert;
export const HUELLE_RASTER_M: number = L.huelle.rasterM.wert;
const DACH = L.huelle.dachAnteilAnnahme.wert;

export interface HuelleModell {
  /** Grundstücksgrenze (Anzeigebereich der Hülle) */
  plot: Vec2[];
  /** erlaubter Bereich der Abstandsflächen: Grundstück, an Verkehrsflächen bis zur Mitte nach außen verschoben (Art. 6 Abs. 2 Satz 2) */
  rand: Vec2[];
  /** Verschiebung je Grundstückskante nach außen in m (0 = keine Verkehrsfläche) */
  versatz: number[];
  /** eigene Gebäude und deren Abstandsflächen: Hindernis in jeder Richtung (Art. 6 Abs. 3, sichere Seite) */
  hindernisse: Vec2[][];
  /** nur gesperrte Flächen (Kleinbauten aus Bestand): innen 0, kein Abstand nötig (Art. 6 Abs. 7) */
  sperren: Vec2[][];
}

/** Größte zulässige H bei Abstand d zum nächsten Hindernis. */
export const hoeheAusAbstand = (d: number): number => (d >= MIN_T - 1e-9 ? d / FAKTOR : 0);

/** Bis wohin (m, ab der Grenze) reicht die Verkehrsfläche in Richtung n? [Eintritt, Austritt] oder null (auf 1 cm genau). */
function strassenStrecke(strassen: Vec2[][], m: Vec2, n: Vec2): [number, number] | null {
  const drin = (s: number) => strassen.some((p) => pointInPolygon([m[0] + n[0] * s, m[1] + n[1] * s], p));
  let s0 = -1;
  for (let s = 0.02; s <= 0.6; s += 0.02) if (drin(s)) { s0 = s; break; }
  if (s0 < 0) return null;
  let lo = s0;
  let hi = s0;
  for (let s = s0; s <= 60; s += 0.25) {
    if (!drin(s)) { hi = s; break; }
    lo = s;
    hi = s + 0.25;
  }
  for (let k = 0; k < 8; k++) {
    const mid = (lo + hi) / 2;
    if (drin(mid)) lo = mid; else hi = mid;
  }
  return [s0 <= 0.04 ? 0 : s0, lo];
}

/** Verschiebung jeder Grundstückskante an eine Verkehrsfläche: bis zu deren Mitte (Annäherung). */
export function strassenVersatz(plot: Vec2[], strassen: Vec2[][]): number[] {
  const ccw = signedArea(plot) > 0;
  return edges(plot).map(([a, b]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1 || !strassen.length) return 0;
    const n: Vec2 = ccw ? [(b[1] - a[1]) / len, -(b[0] - a[0]) / len] : [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    const mitten = [0.25, 0.5, 0.75].map((t): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    const strecken = mitten.map((m) => strassenStrecke(strassen, m, n)).filter((x): x is [number, number] => !!x);
    if (strecken.length < 2) return 0;
    const mittel = strecken.map(([s0, s1]) => (s0 + s1) / 2).sort((x, y) => x - y)[Math.floor(strecken.length / 2)];
    return Math.min(30, Math.max(0, mittel));
  });
}

/** Polygon mit je Kante verschobenen Linien (Gehrung an den Ecken). */
function versetzt(plot: Vec2[], off: number[]): Vec2[] {
  if (!off.some((o) => o > 0)) return plot;
  const ccw = signedArea(plot) > 0;
  const es = edges(plot);
  const lin = es.map(([a, b], i) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n: Vec2 = ccw ? [(b[1] - a[1]) / len, -(b[0] - a[0]) / len] : [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    return { p: [a[0] + n[0] * off[i], a[1] + n[1] * off[i]] as Vec2, d: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] as Vec2, n };
  });
  const out = plot.map((v, i): Vec2 => {
    const l0 = lin[(i + plot.length - 1) % plot.length];
    const l1 = lin[i];
    const det = l0.d[0] * l1.d[1] - l0.d[1] * l1.d[0];
    if (Math.abs(det) < 1e-6) return [v[0] + l1.n[0] * off[i], v[1] + l1.n[1] * off[i]];
    const t = ((l1.p[0] - l0.p[0]) * l1.d[1] - (l1.p[1] - l0.p[1]) * l1.d[0]) / det;
    return [l0.p[0] + l0.d[0] * t, l0.p[1] + l0.d[1] * t];
  });
  // Vorsicht bei verwinkelten Grenzen: sieht das Ergebnis unsinnig aus, bleibt es beim Grundstück
  const f0 = Math.abs(signedArea(plot));
  const f1 = Math.abs(signedArea(out));
  return f1 < f0 * 0.99 || f1 > f0 * 20 + 3000 ? plot : out;
}

/** Modell der Hülle für ein Grundstück. `ausgenommen`: Gebäude, die nicht als Hindernis zählen (das aufgestockte oder angebaute Haus). */
export function huelleModell(site: Site, strassen: Vec2[][] = [], ausgenommen: string[] = []): HuelleModell {
  const plot = site.plot.boundary;
  const versatz = strassenVersatz(plot, strassen);
  const hindernisse: Vec2[][] = [];
  for (const b of site.buildings) {
    if (!b.own || ausgenommen.includes(b.id) || b.footprint.length < 3) continue;
    hindernisse.push(b.footprint);
    for (const w of gebaeudeFlaechen(b)) hindernisse.push(w.flaeche);
  }
  const sperren = site.bestand.filter((b) => geprueft(b) && istGebaeude(b) && pointInPolygon(b.footprint[0], plot)).map((b) => b.footprint);
  return { plot, rand: versetzt(plot, versatz), versatz, hindernisse, sperren };
}

/** Abstand von p zum nächsten Hindernis (Rand des erlaubten Bereichs, eigene Gebäude und ihre Abstandsflächen); 0 außerhalb oder in einem Hindernis. */
export function abstandAn(m: HuelleModell, p: Vec2): number {
  if (!pointInPolygon(p, m.rand)) return 0;
  for (const h of m.hindernisse) if (pointInPolygon(p, h)) return 0;
  for (const s of m.sperren) if (pointInPolygon(p, s)) return 0;
  let d = Infinity;
  for (const [a, b] of edges(m.rand)) d = Math.min(d, pointSegment(p, a, b).d);
  for (const h of m.hindernisse) for (const [a, b] of edges(h)) d = Math.min(d, pointSegment(p, a, b).d);
  return d;
}

/** Größte zulässige H (Wandhöhe plus Dachanteil nach Art. 6 Abs. 4) an p; 0 = hier keine Wand mit Abstandsfläche. */
export const hoeheAn = (m: HuelleModell, p: Vec2): number => hoeheAusAbstand(abstandAn(m, p));

/** Dachanteil von H bei einem Satteldach (Annahme: 35°, 8 m Tiefe): ein Drittel der Dachhöhe (bis 70°). */
export function dachAnteilSattel(neigungGrad = DACH.neigungGrad, tiefeM = DACH.tiefeM): number {
  return ((tiefeM / 2) * Math.tan((neigungGrad * Math.PI) / 180)) / (neigungGrad > L.abstand.dachVollAbGrad.wert ? 1 : 3);
}

export interface HuelleRaster {
  x0: number;
  y0: number;
  step: number;
  nx: number;
  ny: number;
  /** je Zelle (Zeile von Süden nach Norden): größte H in m, 0 = nicht zulässig, −1 = außerhalb des Grundstücks */
  h: Float32Array;
  ms: number;
}

/** Raster der Hülle über dem Grundstück (Zellmitten). */
export function huelleRaster(m: HuelleModell, step = HUELLE_RASTER_M): HuelleRaster {
  const t0 = performance.now();
  const xs = m.plot.map((p) => p[0]);
  const ys = m.plot.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs) / step) * step;
  const y0 = Math.floor(Math.min(...ys) / step) * step;
  const nx = Math.ceil((Math.max(...xs) - x0) / step) + 1;
  const ny = Math.ceil((Math.max(...ys) - y0) / step) + 1;
  const h = new Float32Array(nx * ny).fill(-1);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p: Vec2 = [x0 + i * step, y0 + j * step];
      if (!pointInPolygon(p, m.plot)) continue;
      h[j * nx + i] = hoeheAn(m, p);
    }
  }
  return { x0, y0, step, nx, ny, h, ms: performance.now() - t0 };
}

/** H aus dem Raster an p (nächste Zelle); −1 außerhalb. Nur für die Anzeige, Prüfungen rechnen exakt mit hoeheAn. */
export function hoeheAusRaster(r: HuelleRaster, p: Vec2): number {
  const i = Math.round((p[0] - r.x0) / r.step);
  const j = Math.round((p[1] - r.y0) / r.step);
  return i < 0 || j < 0 || i >= r.nx || j >= r.ny ? -1 : r.h[j * r.nx + i];
}

/** Eine Stelle, an der ein geplantes Gebäude die Hülle durchstößt: Ort an der Wand, Höhe der Hülle dort, Höhe der Wand. */
export interface Durchstoss {
  p: Vec2;
  /** Hülle (Wandhöhe) an dieser Stelle */
  huelle: number;
  /** Höhe der Wand dort (Wandhöhe über Gelände, ohne Dachanteil) */
  wand: number;
}

/**
 * Wandstücke eines geplanten Gebäudes gegen die Hülle. `wand`: Strecke a–b mit Wandhöhe über Gelände an beiden Enden (ha, hb ohne
 * Dachanteil), `dachAnteil`: Zuschlag nach Art. 6 Abs. 4 (ein Drittel der Dachhöhe) für H. Alle 0,25 m eine Probe, exakt (kein Raster).
 * Durchstoß, wo H = Wandhöhe + Dachanteil größer ist als die Hülle (mit 1 cm Toleranz).
 */
export function durchstoesse(m: HuelleModell, a: Vec2, b: Vec2, ha: number, hb: number, dachAnteil: number): Durchstoss[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / 0.25));
  const out: Durchstoss[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const p: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const wand = ha + (hb - ha) * t;
    const H = hoeheAn(m, p);
    if (wand + dachAnteil > H + 0.01) out.push({ p, huelle: Math.max(0, H - dachAnteil), wand });
  }
  return out;
}

/** Mittlere Traufhöhe der Hauptgebäude in der Umgebung (aus planungsrecht.umfeldStatistik) → Höhe der Referenzebene. */
export function referenzHoehe(traufeMedian: number | null | undefined): number | null {
  return traufeMedian != null && Number.isFinite(traufeMedian) && traufeMedian > 0 ? traufeMedian : null;
}
