import { describe, expect, it } from 'vitest';
import { beschreibung, fromRec, jeGrenze, minRect, nachgezogen, seitenAnGrenze } from '../src/site/bestand';
import { sidesFromBoundary } from '../src/site/plot';
import type { Vec2 } from '../src/rules';

const plot: Vec2[] = [[0, 0], [20, 0], [20, 30], [0, 30]];
const { segmentSide, sides } = sidesFromBoundary(plot);

describe('Garten-Bestand', () => {
  it('minimales Rechteck eines gedrehten 3 × 2-m-Rechtecks', () => {
    const a = Math.PI / 6;
    const pts: Vec2[] = [[0, 0], [3, 0], [3, 2], [0, 2]].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
    const r = minRect(pts);
    expect(r.laenge).toBeCloseTo(3, 6);
    expect(r.breite).toBeCloseTo(2, 6);
  });

  it('Objekt 0,5 m von der Westgrenze gehört zu dieser Grenze, Ecke zu zwei Grenzen', () => {
    const west: Vec2[] = [[0.5, 10], [3, 10], [3, 13], [0.5, 13]];
    const s = seitenAnGrenze(west, plot, segmentSide);
    expect(s.map((i) => sides[i].name)).toEqual(['nach Westen']);
    const ecke: Vec2[] = [[0.2, 0.3], [2, 0.3], [2, 2], [0.2, 2]];
    expect(seitenAnGrenze(ecke, plot, segmentSide)).toHaveLength(2);
  });

  it('genau 1,00 m Abstand zählt noch als „an der Grenze“, 1,01 m nicht', () => {
    expect(seitenAnGrenze([[1, 10], [3, 10], [3, 12], [1, 12]], plot, segmentSide)).toHaveLength(1);
    expect(seitenAnGrenze([[1.01, 10], [3, 10], [3, 12], [1.01, 12]], plot, segmentSide)).toHaveLength(0);
  });

  it('jeGrenze trennt Grenzobjekte von Objekten mitten im Garten', () => {
    const b = [
      fromRec({ id: 'a', fp: [[0.5, 10], [3, 10], [3, 13], [0.5, 13]], h: 2.4, a: 7.5, conf: 0.9, k: 'gartenhaus' }),
      fromRec({ id: 'b', fp: [[8, 12], [11, 12], [11, 15], [8, 15]], h: 0, a: 9, conf: 0.8, k: 'pool', rund: 1 }),
    ];
    const r = jeGrenze(b, plot, segmentSide, sides.length);
    expect(r.innen.map((x) => x.id)).toEqual(['b']);
    expect(r.seiten.flat().map((x) => x.id)).toEqual(['a']);
  });

  it('Beschreibung zeigt Maß mit Spanne und Wandhöhe aus Dachebenen', () => {
    const b = fromRec({ id: 'a', fp: [[0, 0], [3.1, 0], [3.1, 2.4], [0, 2.4]], h: 2.9, a: 7.4, conf: 0.9, k: 'gartenhaus', l: 3.1, b: 2.4, sl: 0.25, sh: 0.15, wh: 2.3, sw: 0.15 });
    expect(beschreibung(b)).toBe('Gartenhaus, 3,10 × 2,40 m (±0,25 m), Wandhöhe 2,30 m (±0,15 m)');
    expect(b.height).toBe(2.3); // Grenzbebauung rechnet mit der mittleren Wandhöhe
  });

  it('nachgezogener Umriss wird nutzerbestätigt und neu vermessen', () => {
    const b = fromRec({ id: 'a', fp: [[0, 0], [3.1, 0], [3.1, 2.4], [0, 2.4]], h: 2.9, a: 7.4, conf: 0.6, k: 'gartenhaus', l: 3.1, b: 2.4, sl: 0.25 });
    const n = nachgezogen(b, [[0, 0], [3.5, 0], [3.5, 2.5], [0, 2.5]]);
    expect(n.provenance).toBe('nutzerbestätigt');
    expect(n.laenge?.wert).toBeCloseTo(3.5, 6);
    expect(beschreibung(n)).toContain('3,50 × 2,50 m (±0,10 m)');
  });
});
