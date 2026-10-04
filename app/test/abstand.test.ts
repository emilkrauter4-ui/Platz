import { describe, expect, it } from 'vitest';
import { dachHoehe, evaluate, gebaeudeFlaechen, rauminhalt, waende, wandhoeheArt7, wandWinkel, type Site } from '../src/rules';
import { demoObjects, demoSite } from '../src/rules/demo';

const flach = (): Site => ({ ...demoSite(), ground: () => 400 });

describe('Abstandsflächen nach BayBO Art. 6', () => {
  it('Flachdach 3,5 m: H = 3,5, Tiefe 3 m (Mindestmaß), Fläche als Rechteck vor jeder Wand', () => {
    const o = { ...demoObjects().gartenhaus, center: [10, -15] as [number, number], w: 3, d: 3, h: 3.5, angle: 0, neigung: 0 };
    const ws = waende(flach(), o);
    expect(ws.map((w) => w.typ)).toEqual(['flach', 'flach', 'flach', 'flach']);
    expect(ws[0].ha).toBeCloseTo(3.5, 9);
    expect(ws[0].ta).toBeCloseTo(3, 9);
    // Wand 0 ist die Südwand (y = −16,5), Fläche reicht nach Süden bis −19,5
    expect(Math.min(...ws[0].flaeche.map((p) => p[1]))).toBeCloseTo(-19.5, 9);
  });

  it('10 m Wandhöhe: Tiefe 0,4 H = 4 m', () => {
    const o = { ...demoObjects().gartenhaus, center: [10, -15] as [number, number], w: 3, d: 3, h: 10, angle: 0 };
    expect(waende(flach(), o)[0].ta).toBeCloseTo(4, 9);
  });

  it('Satteldach 45°: Dach zu einem Drittel (Abs. 4); bis 45° bei Abs. 7 nicht angerechnet', () => {
    const o = { ...demoObjects().gartenhaus, center: [10, -15] as [number, number], w: 4, d: 3, h: 2.2, angle: 0, neigung: 45 };
    expect(dachHoehe(o)).toBeCloseTo(1.5, 9);
    const ws = waende(flach(), o);
    expect(ws[0].typ).toBe('traufe');
    expect(ws[1].typ).toBe('giebel');
    expect(ws[0].ha).toBeCloseTo(2.2 + 0.5, 9);
    expect(wandhoeheArt7(ws[0], o).h).toBeCloseTo(2.2, 9); // genau 45°: „mehr als 45 Grad“ greift nicht
    expect(wandhoeheArt7(ws[1], o).h).toBeCloseTo(2.2, 9);
    expect(wandhoeheArt7(ws[1], o).offen).toBe(false);
  });

  it('Satteldach 50°: Abs. 7 rechnet ein Drittel des Dachs an, Giebel offen', () => {
    const o = { ...demoObjects().gartenhaus, center: [10, -15] as [number, number], w: 4, d: 3, h: 2.2, angle: 0, neigung: 50 };
    const dh = dachHoehe(o);
    const ws = waende(flach(), o);
    expect(wandhoeheArt7(ws[0], o).h).toBeCloseTo(2.2 + dh / 3, 9);
    expect(wandhoeheArt7(ws[1], o).offen).toBe(true);
  });

  it('Dach über 70°: voll angerechnet', () => {
    const o = { ...demoObjects().gartenhaus, center: [10, -15] as [number, number], w: 4, d: 2, h: 2.2, angle: 0, neigung: 75 };
    expect(waende(flach(), o)[0].ha).toBeCloseTo(2.2 + dachHoehe(o), 9);
  });

  it('Hang: Wandhöhe an jedem Wandende über dem dortigen Gelände, Fläche wird Trapez', () => {
    const site: Site = { ...demoSite(), ground: (p) => 400 + 0.2 * p[0] }; // steigt nach Osten
    const o = { ...demoObjects().gartenhaus, center: [10, -15] as [number, number], w: 4, d: 3, h: 3.2, angle: 0 };
    const w0 = waende(site, o)[0]; // Südwand von West (x=8) nach Ost (x=12)
    expect(w0.wa).toBeCloseTo(3.2 + 0.8, 6); // Fußboden am höchsten Punkt (x=12): West 0,8 m tiefer
    expect(w0.wb).toBeCloseTo(3.2, 6);
    expect(w0.ta).toBeGreaterThan(w0.tb - 1e-9);
  });

  it('Brutto-Rauminhalt mit Dachraum', () => {
    expect(rauminhalt({ w: 4, d: 3, h: 2.2, neigung: 45 })).toBeCloseTo(4 * 3 * 2.2 + (4 * 3 * 1.5) / 2, 9);
  });

  it('Wandwinkel: senkrecht = 90, parallel = 0', () => {
    expect(wandWinkel([0, 0], [1, 0], [0, 0], [0, 5])).toBeCloseTo(90, 9);
    expect(wandWinkel([0, 0], [1, 0], [3, 3], [1, 3])).toBeCloseTo(0, 9);
  });

  it('Haus aus LoD2: H = Traufe + (First − Traufe)/3', () => {
    const f = gebaeudeFlaechen({ id: 'h', footprint: [[0, 0], [10, 0], [10, 8], [0, 8]], provenance: 'amtlich', own: true, trauf: 6, first: 9 });
    expect(f).toHaveLength(4);
    expect(f[0].h).toBeCloseTo(7, 9);
    expect(Math.min(...f[0].flaeche.map((p) => p[1]))).toBeCloseTo(-3, 9); // max(0,4·7=2,8; 3) = 3
  });

  it('privilegiertes Gartenhaus (≤ 3 m) darf in der Abstandsfläche des Hauses stehen', () => {
    const site = demoSite();
    const own = site.buildings.find((b) => b.own)!;
    own.trauf = 6; own.first = 9;
    const objs = demoObjects();
    const fp = own.footprint;
    const minY = Math.min(...fp.map((p) => p[1]));
    const midX = (Math.min(...fp.map((p) => p[0])) + Math.max(...fp.map((p) => p[0]))) / 2;
    objs.gartenhaus = { ...objs.gartenhaus, center: [midX, minY - 2.2], w: 3, d: 2, h: 2.5, angle: 0 };
    const r = evaluate(site, objs).gartenhaus;
    expect(r.af?.privilegiert).toBe(true);
    expect(r.head).not.toBe('Zu nah an deinem Haus.');
    // 3,2 m Wandhöhe: nicht privilegiert, steht in der Abstandsfläche des Hauses
    objs.gartenhaus.h = 3.2;
    const r2 = evaluate(site, objs).gartenhaus;
    expect(r2.af?.privilegiert).toBe(false);
    expect(r2.head).toBe('Zu nah an deinem Haus.');
  });
});
