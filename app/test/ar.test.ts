import { describe, expect, it } from 'vitest';
import { glb, teileAus, usda, usdz } from '../scripts/ar-modell.mjs';
import { arQuery } from '../src/ar';

const masse = (t: ReturnType<typeof teileAus>) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const x of t) for (let i = 0; i < x.pos.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], x.pos[i + a]); max[a] = Math.max(max[a], x.pos[i + a]); }
  return max.map((v, a) => v - min[a]);
};

describe('AR-Modelle 1:1', () => {
  it('Gartenhaus Satteldach 35°: Breite, Firsthöhe, Tiefe in Metern', () => {
    const [w, h, d] = masse(teileAus({ art: 'gartenhaus', w: 3, d: 2.5, h: 2.3, n: 35 }));
    expect(w).toBeCloseTo(3, 9);
    expect(d).toBeCloseTo(2.5, 9);
    expect(h).toBeCloseTo(2.3 + 1.25 * Math.tan((35 * Math.PI) / 180), 9);
  });

  it('Hecke 6 m × 0,6 m × 1,8 m, Boden bei y = 0', () => {
    const t = teileAus({ art: 'hecke', l: 6, h: 1.8 });
    expect(masse(t)).toEqual([6, 1.8, 0.6].map((v) => expect.closeTo(v, 9)));
    expect(Math.min(...t[0].pos.filter((_, i) => i % 3 === 1))).toBe(0);
  });

  it('Maße werden begrenzt, unbekannte Art abgelehnt', () => {
    expect(masse(teileAus({ art: 'waermepumpe', w: 999, d: 0.4, h: 0.9 }))[0]).toBe(12);
    expect(() => teileAus({ art: 'rakete', h: 2 })).toThrow();
  });

  it('GLB: Kopf, Länge, JSON- und BIN-Block', () => {
    const b = glb(teileAus({ art: 'carport', w: 3, d: 5, h: 2.5 }));
    const dv = new DataView(b.buffer, b.byteOffset);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    expect(dv.getUint32(8, true)).toBe(b.byteLength);
    const jl = dv.getUint32(12, true);
    const j = JSON.parse(new TextDecoder().decode(b.slice(20, 20 + jl)));
    expect(j.asset.version).toBe('2.0');
    expect(j.meshes[0].primitives).toHaveLength(2);
    expect(dv.getUint32(20 + jl + 4, true)).toBe(0x004e4942);
  });

  it('USDZ: unkomprimiert, Daten bei 64 Bytes, Meter und Y oben', () => {
    const t = teileAus({ art: 'baum', h: 8 });
    const z = usdz(t);
    const dv = new DataView(z.buffer, z.byteOffset);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(dv.getUint16(8, true)).toBe(0);
    const start = 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
    expect(start % 64).toBe(0);
    expect(new TextDecoder().decode(z.slice(start, start + 9))).toBe('#usda 1.0');
    const a = usda(t);
    expect(a).toContain('metersPerUnit = 1');
    expect(a).toContain('upAxis = "Y"');
  });

  it('URL-Parameter gerundet, nur was das Objekt braucht', () => {
    expect(arQuery({ art: 'gartenhaus', w: 3.004, d: 2.5, h: 2.3, n: 0 })).toBe('art=gartenhaus&h=2.3&w=3&d=2.5');
    expect(arQuery({ art: 'hecke', h: 1.8, l: 6 })).toBe('art=hecke&h=1.8&l=6');
  });
});
