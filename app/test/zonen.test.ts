import { describe, expect, it } from 'vitest';
import { ausrichtungen, evaluate, FREI, GELB, GRUEN, ROT, zonen, type Vec2 } from '../src/rules';
import { demoObjects, demoSite } from '../src/rules/demo';

describe('Wo darf es hin? (Zonen)', () => {
  const site = demoSite();
  const objs = demoObjects();
  const xs = site.plot.boundary.map((p) => p[0]);
  const ys = site.plot.boundary.map((p) => p[1]);
  const x0 = Math.min(...xs) - 1, y0 = Math.min(...ys) - 1;
  const nx = Math.ceil((Math.max(...xs) + 1 - x0) / 0.25), ny = Math.ceil((Math.max(...ys) + 1 - y0) / 0.25);
  const geo = { o: [x0, y0] as Vec2, ex: [0.25, 0] as Vec2, ey: [0, 0.25] as Vec2, nx, ny };

  it('Ausrichtungen: aktuelle zuerst, Grenzen parallel, ohne Dubletten', () => {
    const w = ausrichtungen([[0, 0], [10, 0], [10, 10], [0, 10]], 0.3);
    expect(w[0]).toBeCloseTo(0.3, 9);
    expect(w.filter((a) => Math.abs(a) < 1e-9 || Math.abs(a - Math.PI / 2) < 1e-9)).toHaveLength(2);
  });

  it('jede Zelle stimmt mit evaluate() überein (aktuelle Ausrichtung: grün ⇔ ok); Abweichung durch Grobraster < 2 %', () => {
    const r = zonen(site, objs, 'gartenhaus', geo);
    let n = 0, falsch = 0, gelb = 0;
    for (let row = 0; row < ny; row++) {
      for (let c = 0; c < nx; c++) {
        const f = r.feld[(ny - 1 - row) * nx + c];
        if (f === FREI) continue;
        n++;
        const p: Vec2 = [x0 + (c + 0.5) * 0.25, y0 + (row + 0.5) * 0.25];
        const o = { ...objs, gartenhaus: { ...objs.gartenhaus, center: p } };
        const ok = evaluate(site, o).gartenhaus.status === 'ok';
        if ((f === GRUEN) !== ok) falsch++;
        if (f === GELB) {
          gelb++;
          const o2 = { ...objs, gartenhaus: { ...objs.gartenhaus, center: p, angle: r.winkel[r.winkelIdx[(ny - 1 - row) * nx + c]] } };
          expect(evaluate(site, o2).gartenhaus.status).toBe('ok');
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(falsch / n).toBeLessThan(0.02);
    expect([GRUEN, GELB, ROT].every((f) => r.feld.includes(f))).toBe(true);
    console.log(`Zonen: ${n} Zellen, ${falsch} abweichend (${((100 * falsch) / n).toFixed(2)} %), ${gelb} gelb, ${r.pruefungen} Prüfungen, ${r.ms.toFixed(0)} ms`);
  });

  it('beste Stelle ist grün und passt laut evaluate()', () => {
    const r = zonen(site, objs, 'gartenhaus', geo);
    expect(r.beste).not.toBeNull();
    const o = { ...objs, gartenhaus: { ...objs.gartenhaus, center: r.beste!.p, angle: r.beste!.angle } };
    expect(evaluate(site, o).gartenhaus.status).toBe('ok');
  });
});
