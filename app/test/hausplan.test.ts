import { describe, expect, it, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { leseIfc, type IfcApi, type IfcTypen } from '../src/hausplan/ifc';
import { kontur } from '../src/hausplan/kontur';
import { area } from '../src/rules/geometry';
import type { HausPlan } from '../src/hausplan/typen';

const require = createRequire(import.meta.url);
const WebIFC = require('web-ifc');
let api: IfcApi;
const T = WebIFC as unknown as IfcTypen;
const lade = (datei: string): Promise<HausPlan> => leseIfc(api, T, new Uint8Array(readFileSync(`../docs/beispiele/ifc/${datei}`)), datei);

beforeAll(async () => {
  const a = new WebIFC.IfcAPI();
  await a.Init();
  api = a as unknown as IfcApi;
});

describe('Kontur aus Dreiecken', () => {
  it('Rechteck mit Lücke in der Wand (Wanddicke 0,3): Außenkontur 10 × 8 m, Fläche stimmt auf 2 %', () => {
    // vier Wandstreifen mit 0,3 m Dicke, Lücke von 0,2 m in der Südwand (Stoßfuge)
    const streifen = (x0: number, y0: number, x1: number, y1: number): [number, number][][] => [[[x0, y0], [x1, y0], [x1, y1]], [[x0, y0], [x1, y1], [x0, y1]]];
    const tri = [...streifen(0, 0, 4.9, 0.3), ...streifen(5.1, 0, 10, 0.3), ...streifen(10 - 0.3, 0, 10, 8), ...streifen(0, 8 - 0.3, 10, 8), ...streifen(0, 0, 0.3, 8)];
    const p = kontur(tri, 0.05, 0.3, 0.1);
    expect(p).toHaveLength(4);
    expect(area(p)).toBeCloseTo(80, 0);
    const xs = p.map((q) => q[0]);
    const ys = p.map((q) => q[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(8, 1);
  });

  it('L-Form: sechs Ecken, Fläche 12·10 − 6·4 = 96 m²', () => {
    const streifen = (x0: number, y0: number, x1: number, y1: number): [number, number][][] => [[[x0, y0], [x1, y0], [x1, y1]], [[x0, y0], [x1, y1], [x0, y1]]];
    const t = 0.25;
    const tri = [...streifen(0, 0, 12, t), ...streifen(12 - t, 0, 12, 6), ...streifen(6, 6 - t, 12, 6), ...streifen(6 - t, 6, 6, 10), ...streifen(0, 10 - t, 6, 10), ...streifen(0, 0, t, 10)];
    const p = kontur(tri, 0.05, 0.3, 0.1);
    expect(p).toHaveLength(6);
    expect(area(p)).toBeCloseTo(96, 0);
  });
});

describe('IFC-Import (web-ifc, eigene Beispieldateien)', () => {
  it('Satteldachhaus: Umriss 10,3 × 8,3 m, 2 Geschosse à 2,80 m, Satteldach 35°, Traufe 5,6 m, First 8,68 m', async () => {
    const h = await lade('haus_satteldach.ifc');
    expect(h.quelle).toBe('IFC');
    const xs = h.fussabdruck.map((p) => p[0]);
    const ys = h.fussabdruck.map((p) => p[1]);
    // 10 m Achsmaß + 2 · 0,15 m halbe Wanddicke; das Raster von 5 cm rundet je Seite höchstens um eine Zelle auf
    expect(Math.abs(Math.max(...xs) - Math.min(...xs) - 10.3)).toBeLessThan(0.12);
    expect(Math.abs(Math.max(...ys) - Math.min(...ys) - 8.3)).toBeLessThan(0.12);
    expect(h.fussabdruck).toHaveLength(4);
    expect(h.geschosse.map((g) => g.z0)).toEqual([0, 2.8]);
    expect(h.dach.form).toBe('sattel');
    expect(h.dach.neigung).toBeGreaterThan(34);
    expect(h.dach.neigung).toBeLessThan(36);
    expect(h.traufe).toBeCloseTo(5.6, 1);
    expect(h.first).toBeCloseTo((4 + 0.4) * Math.tan((35 * Math.PI) / 180) + 5.6, 1);
    expect(h.netz!.idx.length).toBeGreaterThan(300);
  });

  it('Fenster: 12 gelesen (6 je Geschoss) mit Position, Breite, Brüstung, Außennormale und Raum', async () => {
    const h = await lade('haus_satteldach.ifc');
    expect(h.fenster).toHaveLength(12);
    const s1 = h.fenster.find((f) => f.id === 'F1-G0-1')!; // Südwand, x = 2,0 m (Achsmaß), Breite 1,5 m, Brüstung 0,9 m
    expect(s1.breite).toBeCloseTo(1.5, 1);
    expect(s1.z0).toBeCloseTo(0.9, 2);
    expect(s1.z1).toBeCloseTo(0.9 + 1.35, 2);
    expect(s1.normal[1]).toBeCloseTo(-1, 2); // Südwand: Außennormale nach −y
    expect(s1.pos[0]).toBeCloseTo(2.0 - 5.0, 1); // Ursprung = Mitte des Umrisses (Achsmaß 10 m, Mitte 5 m)
    expect(s1.raum).toBe('Wohnen');
    const og = h.fenster.find((f) => f.id === 'F3-G1-4')!; // Nordwand? (Wand 3 = Nordwand, x = 3 m von Osten gezählt)
    expect(og.geschoss).toBe(1);
    expect(og.z0).toBeCloseTo(2.8 + 0.9, 1);
    expect(og.normal[1]).toBeCloseTo(1, 2);
    expect(h.raeume.map((r) => r.name).sort()).toEqual(['Arbeiten', 'Bad', 'Bad OG', 'Kind', 'Kind 2', 'Küche', 'Schlafen', 'Wohnen'].sort());
    expect(h.fenster.filter((f) => f.raum).length).toBe(h.fenster.length);
  });

  it('L-Haus mit Flachdach: sechs Ecken, Fläche ≈ 96 m² plus Wandstärke, Flachdach, Traufe = First = Oberkante Dach 5,9 m', async () => {
    const h = await lade('haus_l_flachdach.ifc');
    expect(h.fussabdruck).toHaveLength(6);
    expect(area(h.fussabdruck)).toBeGreaterThan(100);
    expect(area(h.fussabdruck)).toBeLessThan(108);
    expect(h.dach.form).toBe('flach');
    expect(h.traufe).toBeCloseTo(5.9, 1);
    expect(h.first).toBeCloseTo(5.9, 1);
    expect(h.fenster).toHaveLength(7);
    expect(h.raeume).toHaveLength(4);
  });

  it('Datei ohne Wände: verständliche Fehlermeldung', async () => {
    const leer = 'ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'\'),\'2;1\');\nFILE_NAME(\'x\',\'\',(\'\'),(\'\'),\'\',\'\',\'\');\nFILE_SCHEMA((\'IFC4\'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n';
    await expect(leseIfc(api, T, new TextEncoder().encode(leer), 'leer.ifc')).rejects.toThrow(/keine Wände/);
  });
});

import { bildKontur, massstab, pxZuMeter, type Bild } from '../src/hausplan/bild';
import type { Vec2 } from '../src/rules/types';

/** Eigener Beispielplan als Bild: weißer Grund, Wände als dicke dunkle Linien mit Türlücken, Innenwand, Maßkette außen (dünn). */
function planBild(w: number, h: number, ring: Vec2[], opt: { dicke?: number; luecken?: [Vec2, Vec2][]; innen?: [Vec2, Vec2][]; rauschen?: number } = {}): Bild {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  const punkt = (x: number, y: number, v = 20) => {
    const i = (Math.round(y) * w + Math.round(x)) * 4;
    if (i >= 0 && i < d.length) { d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  };
  const dicke = opt.dicke ?? 7;
  const linie = (a: Vec2, b: Vec2, t: number, v = 20) => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n;
      const y = a[1] + ((b[1] - a[1]) * k) / n;
      for (let dx = -t / 2; dx <= t / 2; dx++) for (let dy = -t / 2; dy <= t / 2; dy++) punkt(x + dx, y + dy, v);
    }
  };
  const luecken = opt.luecken ?? [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Lücken: Abschnitte der Kante auslassen
    const stuecke: [number, number][] = [[0, 1]];
    for (const [g0, g1] of luecken) {
      const t0 = ((g0[0] - a[0]) * (b[0] - a[0]) + (g0[1] - a[1]) * (b[1] - a[1])) / (L * L);
      const t1 = ((g1[0] - a[0]) * (b[0] - a[0]) + (g1[1] - a[1]) * (b[1] - a[1])) / (L * L);
      const dist = Math.abs((g0[0] - a[0]) * (b[1] - a[1]) - (g0[1] - a[1]) * (b[0] - a[0])) / L;
      if (dist > 3 || t1 < 0 || t0 > 1) continue;
      const neu: [number, number][] = [];
      for (const [s0, s1] of stuecke) {
        if (t0 > s0) neu.push([s0, Math.min(s1, t0)]);
        if (t1 < s1) neu.push([Math.max(s0, t1), s1]);
      }
      stuecke.splice(0, stuecke.length, ...neu);
    }
    for (const [s0, s1] of stuecke) linie([a[0] + (b[0] - a[0]) * s0, a[1] + (b[1] - a[1]) * s0], [a[0] + (b[0] - a[0]) * s1, a[1] + (b[1] - a[1]) * s1], dicke);
  });
  for (const [a, b] of opt.innen ?? []) linie(a, b, dicke - 2);
  // Maßkette außen: dünne Linie mit Strichen, 40 px vom Haus
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  linie([Math.min(...xs), Math.max(...ys) + 40], [Math.max(...xs), Math.max(...ys) + 40], 1);
  linie([Math.min(...xs), Math.max(...ys) + 34], [Math.min(...xs), Math.max(...ys) + 46], 1);
  linie([Math.max(...xs), Math.max(...ys) + 34], [Math.max(...xs), Math.max(...ys) + 46], 1);
  // Rauschen (Papierkörnung): einzelne graue Pixel
  let s = 7;
  for (let k = 0; k < (opt.rauschen ?? 0); k++) { s = (s * 1664525 + 1013904223) % 4294967296; punkt(s % w, Math.floor(s / w) % h, 140); }
  return { width: w, height: h, data: d };
}

describe('Plan aus Bild (Weg B, klassische Bildverarbeitung)', () => {
  const haus: Vec2[] = [[150, 100], [650, 100], [650, 500], [150, 500]]; // 500 × 400 px; 10 × 8 m → 50 px/m
  it('Rechteck mit Türlücke (60 px), Innenwand und Maßkette: vier Ecken auf wenige Pixel genau; Maßstab aus bestätigter Länge', () => {
    const b = planBild(800, 640, haus, { luecken: [[[300, 500], [360, 500]], [[650, 250], [650, 310]]], innen: [[[400, 100], [400, 500]], [[150, 300], [400, 300]]], rauschen: 800 });
    const k = bildKontur(b)!;
    expect(k).not.toBeNull();
    expect(k.px).toHaveLength(4);
    const xs = k.px.map((p) => p[0]);
    const ys = k.px.map((p) => p[1]);
    // Wandmitte ± halbe Wanddicke (3,5 px): Außenkante
    expect(Math.min(...xs)).toBeGreaterThan(150 - 7);
    expect(Math.min(...xs)).toBeLessThan(150 - 1);
    expect(Math.max(...xs)).toBeGreaterThan(650 + 1);
    expect(Math.max(...xs)).toBeLessThan(650 + 7);
    expect(Math.min(...ys)).toBeGreaterThan(100 - 7);
    expect(Math.max(...ys)).toBeLessThan(500 + 7);
    // Der Nutzer bestätigt: „Die Südwand ist 10,00 m lang“ (Strecke zwischen den Außenkanten)
    const mpp = massstab([Math.min(...xs), Math.max(...ys)], [Math.max(...xs), Math.max(...ys)], 10.0);
    const m = pxZuMeter(k.px, mpp);
    const mx = m.map((p) => p[0]);
    const my = m.map((p) => p[1]);
    expect(Math.max(...mx) - Math.min(...mx)).toBeCloseTo(10, 1);
    expect(Math.max(...my) - Math.min(...my)).toBeCloseTo(8, 0); // 400 px / 50 = 8 m, ± 2 Wandstärken auf die Außenkante
    expect(area(m)).toBeCloseTo(80, -1);
    expect(Math.abs(m.reduce((s, p, i) => s + (p[0] * m[(i + 1) % m.length][1] - m[(i + 1) % m.length][0] * p[1]), 0)) / 2).toBeGreaterThan(75);
  });

  it('L-förmiger Plan mit Lücken: sechs Ecken', () => {
    const l: Vec2[] = [[100, 80], [700, 80], [700, 380], [400, 380], [400, 580], [100, 580]];
    const b = planBild(800, 660, l, { luecken: [[[200, 80], [260, 80]], [[100, 300], [100, 360]]], rauschen: 400 });
    const k = bildKontur(b)!;
    expect(k.px).toHaveLength(6);
  });

  it('Seite ohne Gebäude (weiß) oder nur Text: keine Kontur statt einer erfundenen', () => {
    const leer: Bild = { width: 400, height: 300, data: new Uint8ClampedArray(400 * 300 * 4).fill(255) };
    expect(bildKontur(leer)).toBeNull();
  });

  it('Maßstab: ungültige Eingaben werden abgelehnt', () => {
    expect(() => massstab([0, 0], [0, 0], 5)).toThrow();
    expect(() => massstab([0, 0], [10, 0], 0)).toThrow();
    expect(massstab([0, 0], [100, 0], 9.5)).toBeCloseTo(0.095, 9);
  });
});
