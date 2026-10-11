/**
 * Starkregen über dem Grundstück (AUFTRAG_V4 C3): vereinfachte Simulation, Label `Simulation`, nie Grundlage einer Ampel.
 *
 * Zwei Stufen:
 *  1. `fliessSenken`: Senken (Auffüllen nach Priority-Flood, Barnes et al. 2014) und Fließwege (D8, Einzugsgebiet in m²) nur aus dem Gelände.
 *  2. `simuliere`: zeitabhängiges Flächenmodell. Jede Zelle hat eine Wassertiefe h. Zwischen Nachbarzellen fließt nach Manning
 *     q = hf^(5/3) · S / (n · √|S|) je Meter Breite (hf = Fließtiefe über der höheren Sohle, S = Gefälle des Wasserspiegels,
 *     diffusive wave); der Austausch ist auf die Hälfte des Ausgleichs der Wasserspiegel begrenzt, und eine Zelle gibt nie mehr
 *     ab, als sie hat. Das Verfahren ist massenerhaltend (Test `Bilanz`). Eigene Umsetzung nach dem Prinzip der
 *     Zellular-/Diffusive-Wave-Modelle, kein Code aus Fremdprojekten.
 *
 * Gebäude sind Hindernisse (Zellen gesperrt); der Regen auf dem Dach geht an den Gebäuderand (Annahme). Versickerung konstant je
 * Flächenart, Anfangsverlust (Mulden). Am Rand des Gebiets fließt Wasser ab (Normalabfluss, Gefälle 2 %), von außen kommt keins hinein.
 * Nicht berücksichtigt: Kanalnetz, Bordsteine, Mauern und Schwellen unter der Auflösung des Geländes, Bodenart, Verdunstung.
 * Reine Funktionen, laufen im Worker (rechner.worker.ts).
 */
import L from './limits.json';
import { pointInPolygon } from './geometry';
import type { Vec2 } from './types';

const R = L.starkregen;
export const KLASSE_DURCHLAESSIG = 0;
export const KLASSE_VERSIEGELT = 1;
export const KLASSE_WASSER = 2;

export interface Gitter {
  nx: number;
  ny: number;
  /** Zellenkante in m */
  res: number;
  /** Südwestecke der Zelle (0,0) in lokalen Metern */
  x0: number;
  y0: number;
  /** Geländehöhe je Zelle (m), Zeile 0 = Süden */
  z: Float32Array;
  /** Flächenart 0 durchlässig, 1 versiegelt, 2 Gewässer */
  klasse: Uint8Array;
  /** Gebäude-ID je Zelle (≥ 0) oder −1 */
  gebaeude: Int32Array;
}

/** Lage des Rechengitters: Quadrat mit Zellenkante `res` um `mitte`, Halbkantenlänge ≥ `radius`. */
export function gitterGeometrie(mitte: Vec2, radius: number, res: number): { n: number; x0: number; y0: number; res: number } {
  const n = Math.max(20, Math.ceil((2 * radius) / res));
  return { n, x0: mitte[0] - (n * res) / 2, y0: mitte[1] - (n * res) / 2, res };
}

/**
 * Gitter aus Gelände (Höhenfunktion in m), Flächenarten (null = alles durchlässig, offen) und Gebäudegrundrissen.
 * `hoehe` muss für alle Zellmitten Werte liefern (Gelände vorher laden).
 */
export function baueGitter(
  geo: { n: number; x0: number; y0: number; res: number },
  hoehe: (p: Vec2) => number,
  klassen: Uint8Array | null,
  gebaeude: { footprint: Vec2[] }[],
): Gitter {
  const { n, x0, y0, res } = geo;
  const z = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = hoehe([x0 + (i + 0.5) * res, y0 + (j + 0.5) * res]);
  const geb = new Int32Array(n * n).fill(-1);
  gebaeude.forEach((b, id) => {
    if (b.footprint.length < 3) return;
    const xs = b.footprint.map((p) => p[0]);
    const ys = b.footprint.map((p) => p[1]);
    if (Math.max(...xs) < x0 || Math.min(...xs) > x0 + n * res || Math.max(...ys) < y0 || Math.min(...ys) > y0 + n * res) return;
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / res));
    const i1 = Math.min(n - 1, Math.floor((Math.max(...xs) - x0) / res));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / res));
    const j1 = Math.min(n - 1, Math.floor((Math.max(...ys) - y0) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (pointInPolygon([x0 + (i + 0.5) * res, y0 + (j + 0.5) * res], b.footprint)) geb[j * n + i] = id;
    }
  });
  return { nx: n, ny: n, res, x0, y0, z, klasse: klassen ?? new Uint8Array(n * n), gebaeude: geb };
}

export interface Parameter {
  manning: [number, number, number];
  /** m/s */
  versickerung: [number, number, number];
  /** m */
  mulde: [number, number, number];
}

export const STANDARD_PARAMETER: Parameter = {
  manning: [R.manning.wert.durchlaessig, R.manning.wert.versiegelt, R.manning.wert.gewaesser],
  versickerung: [R.versickerungMmH.wert.durchlaessig / 3.6e6, R.versickerungMmH.wert.versiegelt / 3.6e6, R.versickerungMmH.wert.gewaesser / 3.6e6],
  mulde: [R.muldenspeicherMm.wert.durchlaessig / 1000, R.muldenspeicherMm.wert.versiegelt / 1000, R.muldenspeicherMm.wert.gewaesser / 1000],
};

export type Variante = 'mittel' | 'guenstig' | 'ungunstig';

/** Parameter der drei Läufe: mittel (Annahmen), günstig, ungünstig (Spanne, siehe limits.json starkregen.spanne). */
export function parameterVariante(v: Variante, p: Parameter = STANDARD_PARAMETER): Parameter {
  if (v === 'mittel') return p;
  const s = v === 'guenstig' ? R.spanne.wert.guenstig : R.spanne.wert.ungunstig;
  return {
    manning: p.manning.map((n) => n * s.rauheit) as Parameter['manning'],
    versickerung: p.versickerung.map((f) => f * s.versickerung) as Parameter['versickerung'],
    mulde: p.mulde.map((m) => m * s.mulde) as Parameter['mulde'],
  };
}

export interface Messpunkt {
  id: string;
  i: number;
  j: number;
  /** Wassertiefe (m), ab der „Wasser erreicht die Stelle“ gilt */
  schwelle: number;
}

export interface SimEingabe {
  gitter: Gitter;
  /** Niederschlagshöhe (mm) und Dauer (min) des Blockregens */
  regenMm: number;
  regenMin: number;
  nachlaufMin: number;
  param: Parameter;
  messpunkte: Messpunkt[];
  /** Abstand der gespeicherten Bilder in Sekunden; 0 = keine Bilder */
  frameSek: number;
  /** Courant-Faktor des Zeitschritts (Standard 0,5; kleiner = genauer, langsamer; bei 0,8 weichen die Maximaltiefen um etwa 25 % von 0,25 ab) */
  courant?: number;
}

export interface MessErgebnis {
  id: string;
  /** Sekunden bis zur ersten Tiefe ≥ Schwelle (null = nie) */
  erstSek: number | null;
  maxM: number;
  maxSek: number;
}

export interface Bilanz {
  regenM3: number;
  /** davon Regen auf Dächern, an den Gebäuderand gegeben */
  daecherM3: number;
  versickertM3: number;
  muldeM3: number;
  abflussM3: number;
  stehendM3: number;
}

export interface SimErgebnis {
  nx: number;
  ny: number;
  frameSek: number;
  /** Wassertiefe je Bild in mm (Zeile 0 = Süden) */
  frames: Uint16Array[];
  maxMm: Uint16Array;
  mess: MessErgebnis[];
  bilanz: Bilanz;
  schritte: number;
  gesamtSek: number;
  ms: number;
}

/** hf^(5/3) per Tabelle (1-mm-Schritte bis 4 m), sonst pow */
const T53 = (() => {
  const t = new Float32Array(4002);
  for (let k = 0; k < t.length; k++) t[k] = Math.pow(k / 1000, 5 / 3);
  return t;
})();
function p53(h: number): number {
  const x = h * 1000;
  if (x >= 4000) return Math.pow(h, 5 / 3);
  const k = x | 0;
  return T53[k] + (T53[k + 1] - T53[k]) * (x - k);
}

const H_MIN = 1e-5;
const S_MIN = 1e-3;
const RAND_GEFAELLE = 0.02;
const DT_MIN = 0.25;
const DT_MAX = 3;
const SCHUTZ = 10; // Gebäude: Sohle um 10 m angehoben

export function simuliere(e: SimEingabe): SimErgebnis {
  const t0 = performance.now();
  const { gitter: g, param: pa } = e;
  const { nx, ny, res } = g;
  const n = nx * ny;
  const A = res * res;
  const zb = new Float32Array(n); // Sohle inkl. Gebäudesperre
  const nM = new Float32Array(n);
  const fCap = new Float32Array(n);
  const mulde = new Float32Array(n);
  const sperr = new Uint8Array(n);
  const rainMul = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const k = g.klasse[c];
    if (g.gebaeude[c] >= 0) {
      sperr[c] = 1;
      zb[c] = g.z[c] + SCHUTZ;
    } else {
      zb[c] = g.z[c];
      rainMul[c] = 1;
    }
    nM[c] = pa.manning[k] ?? pa.manning[1];
    fCap[c] = pa.versickerung[k] ?? 0;
    mulde[c] = pa.mulde[k] ?? 0;
  }
  // Regen auf Dächern → Randzellen (8er-Nachbarschaft) des Gebäudes
  {
    const zaehl = new Map<number, number>();
    const ring = new Map<number, Set<number>>();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      const b = g.gebaeude[c];
      if (b < 0) continue;
      zaehl.set(b, (zaehl.get(b) ?? 0) + 1);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const cc = jj * nx + ii;
        if (g.gebaeude[cc] >= 0) continue;
        let s = ring.get(b);
        if (!s) ring.set(b, (s = new Set()));
        s.add(cc);
      }
    }
    for (const [b, cells] of ring) {
      const anteil = (zaehl.get(b) ?? 0) / cells.size;
      for (const cc of cells) rainMul[cc] += anteil;
    }
    // Gebäude ohne Randzelle im Gebiet (am Rand abgeschnitten): ihr Dachregen geht verloren
  }

  const h = new Float32Array(n);
  const vx = new Float32Array((nx - 1) * ny);
  const vy = new Float32Array(nx * (ny - 1));
  const aus = new Float32Array(n);
  const maxM = new Float32Array(n);
  const total = (e.regenMin + e.nachlaufMin) * 60;
  const regenSek = e.regenMin * 60;
  const iRegen = e.regenMm / 1000 / regenSek; // m/s
  const frames: Uint16Array[] = [];
  const mess = e.messpunkte.map((m) => ({ ...m, c: m.j * nx + m.i, erst: null as number | null, max: 0, maxT: 0 }));
  const bil: Bilanz = { regenM3: 0, daecherM3: 0, versickertM3: 0, muldeM3: 0, abflussM3: 0, stehendM3: 0 };
  let t = 0;
  let dt = 0.5;
  let naechstesBild = 0;
  let schritte = 0;
  const bild = () => {
    const f = new Uint16Array(n);
    for (let c = 0; c < n; c++) f[c] = Math.min(65535, Math.round(h[c] * 1000));
    frames.push(f);
  };
  if (e.frameSek > 0) bild();
  naechstesBild = e.frameSek;

  const cour = e.courant ?? 0.5;
  let vmax = 0;
  // Austauschvolumen (m³) von Zelle a nach b in diesem Schritt (negativ: von b nach a)
  const fluss = (a: number, b: number, dts: number): number => {
    if (sperr[a] || sperr[b]) return 0;
    const ha = h[a];
    const hb = h[b];
    if (ha < H_MIN && hb < H_MIN) return 0;
    const Ha = zb[a] + ha;
    const Hb = zb[b] + hb;
    const hf = Math.max(Ha, Hb) - Math.max(zb[a], zb[b]);
    if (hf <= H_MIN) return 0;
    const dH = Ha - Hb;
    const S = dH / res;
    const aS = S < 0 ? -S : S;
    const nn = 0.5 * (nM[a] + nM[b]);
    const q = (p53(hf) * S) / (nn * Math.sqrt(aS > S_MIN ? aS : S_MIN)); // m²/s
    let v = q * res * dts;
    const lim = 0.18 * (dH < 0 ? -dH : dH) * A; // 4 Nachbarn: höchstens 1/5 des Ausgleichs je Fläche, sonst schwingt es
    if (v > lim) v = lim;
    else if (v < -lim) v = -lim;
    if (hf > 1e-3) {
      const u = (q < 0 ? -q : q) / hf; // Fließgeschwindigkeit m/s
      if (u > vmax) vmax = u;
    }
    if (v > 0) aus[a] += v;
    else if (v < 0) aus[b] -= v;
    return v;
  };
  const sc = new Float32Array(n);

  while (t < total - 1e-9) {
    // Zeitschritt nicht über Regenende und Bildzeitpunkt hinaus
    let dts = dt;
    if (t < regenSek && t + dts > regenSek) dts = regenSek - t;
    if (e.frameSek > 0 && t + dts > naechstesBild) dts = naechstesBild - t;
    if (t + dts > total) dts = total - t;
    if (dts < 1e-6) dts = 1e-6;

    // 1. Regen, Anfangsverlust, Versickerung
    const r = t < regenSek ? iRegen * dts : 0;
    for (let c = 0; c < n; c++) {
      if (sperr[c]) continue;
      let add = r * rainMul[c];
      if (r > 0) {
        bil.regenM3 += add * A;
        if (rainMul[c] > 1) bil.daecherM3 += r * (rainMul[c] - 1) * A;
      }
      if (add > 0 && mulde[c] > 0) {
        const m = Math.min(add, mulde[c]);
        mulde[c] -= m;
        add -= m;
        bil.muldeM3 += m * A;
      }
      let hc = h[c] + add;
      const f = fCap[c] * dts;
      if (f > 0 && hc > 0) {
        const v = Math.min(hc, f);
        hc -= v;
        bil.versickertM3 += v * A;
      }
      h[c] = hc;
    }

    // 2. Flüsse zwischen Nachbarzellen: erst alle Volumina, dann die Abgabe jeder Zelle auf ihr Wasser begrenzen, dann anwenden
    aus.fill(0);
    vmax = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx - 1; i++) vx[j * (nx - 1) + i] = fluss(j * nx + i, j * nx + i + 1, dts);
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx; i++) vy[j * nx + i] = fluss(j * nx + i, j * nx + i + nx, dts);
    for (let c = 0; c < n; c++) {
      const m = h[c] * A;
      sc[c] = aus[c] > m ? m / aus[c] : 1;
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const v = vx[j * (nx - 1) + i];
        if (v === 0) continue;
        const a = j * nx + i;
        const w = (v * sc[v > 0 ? a : a + 1]) / A;
        h[a] -= w;
        h[a + 1] += w;
      }
    }
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx; i++) {
        const v = vy[j * nx + i];
        if (v === 0) continue;
        const a = j * nx + i;
        const w = (v * sc[v > 0 ? a : a + nx]) / A;
        h[a] -= w;
        h[a + nx] += w;
      }
    }
    // 3. Abfluss am Rand (Normalabfluss)
    const rand = (c: number) => {
      const hc = h[c];
      if (hc < H_MIN) return;
      let v = ((p53(hc) * Math.sqrt(RAND_GEFAELLE)) / nM[c]) * res * dts;
      if (v > hc * A) v = hc * A;
      h[c] -= v / A;
      bil.abflussM3 += v;
    };
    for (let i = 0; i < nx; i++) { if (!sperr[i]) rand(i); if (!sperr[(ny - 1) * nx + i]) rand((ny - 1) * nx + i); }
    for (let j = 1; j < ny - 1; j++) { if (!sperr[j * nx]) rand(j * nx); if (!sperr[j * nx + nx - 1]) rand(j * nx + nx - 1); }
    t += dts;
    schritte++;
    for (let c = 0; c < n; c++) if (h[c] > maxM[c]) maxM[c] = h[c];
    for (const m of mess) {
      const d = h[m.c];
      if (m.erst === null && d >= m.schwelle) m.erst = t;
      if (d > m.max) { m.max = d; m.maxT = t; }
    }
    if (e.frameSek > 0 && t >= naechstesBild - 1e-6) {
      bild();
      naechstesBild += e.frameSek;
    }
    // nächster Zeitschritt: Courant über die schnellste Fließgeschwindigkeit
    // (die Austauschmenge ist auf den Ausgleich der Wasserspiegel begrenzt, kleinere Schritte als dtMin brauchen nur Genauigkeit)
    dt = vmax > 1e-4 ? Math.min(DT_MAX, Math.max(DT_MIN, (cour * res) / vmax)) : DT_MAX;
  }
  for (let c = 0; c < n; c++) bil.stehendM3 += h[c] * A;
  const maxMm = new Uint16Array(n);
  for (let c = 0; c < n; c++) maxMm[c] = Math.min(65535, Math.round(maxM[c] * 1000));
  return {
    nx,
    ny,
    frameSek: e.frameSek,
    frames,
    maxMm,
    mess: mess.map((m) => ({ id: m.id, erstSek: m.erst, maxM: m.max, maxSek: m.maxT })),
    bilanz: bil,
    schritte,
    gesamtSek: total,
    ms: performance.now() - t0,
  };
}

/* ---------- Senken und Fließwege nur aus dem Gelände ---------- */

export interface FliessSenken {
  /** Tiefe der Geländesenke (m): aufgefüllte Höhe − Gelände */
  senke: Float32Array;
  /** Zuflussfläche in m² (D8, inklusive der Zelle selbst), Gebäude sind gesperrt */
  zufluss: Float32Array;
  ms: number;
}

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    let i = this.k.length;
    this.k.push(key);
    this.v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p];
      this.v[i] = this.v[p];
      i = p;
    }
    this.k[i] = key;
    this.v[i] = val;
  }
  pop(): number {
    const top = this.v[0];
    const lk = this.k.pop()!;
    const lv = this.v.pop()!;
    const n = this.k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.k[c + 1] < this.k[c]) c++;
        if (this.k[c] >= lk) break;
        this.k[i] = this.k[c];
        this.v[i] = this.v[c];
        i = c;
      }
      this.k[i] = lk;
      this.v[i] = lv;
    }
    return top;
  }
}

const D8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Priority-Flood mit Epsilon-Neigung, danach D8-Fließrichtung und Zuflussfläche. Gebäude werden um 10 m angehoben (Hindernis). */
export function fliessSenken(g: Gitter): FliessSenken {
  const t0 = performance.now();
  const { nx, ny } = g;
  const n = nx * ny;
  const z = new Float64Array(n);
  for (let c = 0; c < n; c++) z[c] = g.z[c] + (g.gebaeude[c] >= 0 ? SCHUTZ : 0);
  const fill = new Float64Array(n).fill(Infinity);
  const heap = new MinHeap();
  const fertig = new Uint8Array(n);
  const rand = (i: number, j: number) => i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!rand(i, j)) continue;
    const c = j * nx + i;
    fill[c] = z[c];
    heap.push(z[c], c);
    fertig[c] = 1;
  }
  const EPS = 1e-4;
  const reihenfolge: number[] = [];
  while (heap.size) {
    const c = heap.pop();
    reihenfolge.push(c);
    const i = c % nx;
    const j = (c - i) / nx;
    for (const [di, dj] of D8) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const cc = jj * nx + ii;
      if (fertig[cc]) continue;
      fertig[cc] = 1;
      fill[cc] = Math.max(z[cc], fill[c] + EPS);
      heap.push(fill[cc], cc);
    }
  }
  const senke = new Float32Array(n);
  for (let c = 0; c < n; c++) senke[c] = Math.max(0, fill[c] - z[c]);
  // Auffüllung unter 2 mm (Epsilon-Neigung) zählt nicht als Senke
  for (let c = 0; c < n; c++) if (senke[c] < 0.002) senke[c] = 0;
  // D8 über die aufgefüllte Fläche; Zuflussfläche in umgekehrter Füllreihenfolge (hoch → tief) summieren
  const zufluss = new Float32Array(n).fill(g.res * g.res);
  for (const c of reihenfolge.slice().reverse()) {
    const i = c % nx;
    const j = (c - i) / nx;
    let best = -1;
    let bestS = 0;
    for (const [di, dj] of D8) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const cc = jj * nx + ii;
      const s = (fill[c] - fill[cc]) / (di !== 0 && dj !== 0 ? Math.SQRT2 : 1);
      if (s > bestS) { bestS = s; best = cc; }
    }
    if (best >= 0 && g.gebaeude[c] < 0) zufluss[best] += zufluss[c];
  }
  for (let c = 0; c < n; c++) if (g.gebaeude[c] >= 0) zufluss[c] = 0;
  return { senke, zufluss, ms: performance.now() - t0 };
}

/* ---------- KOSTRA-DWD ---------- */

export interface KostraTabelle {
  quelle: string;
  lizenz: string;
  tabelle: Record<string, Record<string, { hn: number; uc: number }>>;
}

export const KOSTRA_DAUERN = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 540, 720, 1080, 1440, 2880, 4320];
export const KOSTRA_WIEDERKEHR = [1, 2, 3, 5, 10, 20, 30, 50, 100];

/** Niederschlagshöhe (mm) für Dauer (min) und Wiederkehrintervall (a); zwischen den Dauerstufen logarithmisch interpoliert. */
export function kostraHn(k: KostraTabelle, dauerMin: number, wiederkehr: number): { hn: number; uc: number } | null {
  const T = String(wiederkehr);
  const D = KOSTRA_DAUERN;
  if (dauerMin < D[0] || dauerMin > D[D.length - 1]) return null;
  let lo = D[0];
  let hi = D[D.length - 1];
  for (const d of D) { if (d <= dauerMin) lo = d; if (d >= dauerMin) { hi = d; break; } }
  const a = k.tabelle[String(lo)]?.[T];
  const b = k.tabelle[String(hi)]?.[T];
  if (!a || !b) return null;
  if (lo === hi) return a;
  const f = (Math.log(dauerMin) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
  return { hn: a.hn + (b.hn - a.hn) * f, uc: a.uc + (b.uc - a.uc) * f };
}
