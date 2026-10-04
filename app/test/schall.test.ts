import { describe, expect, it } from 'vitest';
import { abschirmung, evaluate, LIMITS, placement, soundPressure, type Building, type Site, type Vec2 } from '../src/rules';
import { demoObjects, demoSite } from '../src/rules/demo';

const haus = (id: string, x: number, y: number, w: number, d: number, own = false, trauf = 6): Building => ({
  id, own, provenance: 'amtlich', trauf, first: trauf + 3,
  footprint: [[x, y], [x + w, y], [x + w, y + d], [x, y + d]],
});
const wp = (c: Vec2): Vec2[] => [[c[0] - 0.25, c[1] - 0.5], [c[0] + 0.25, c[1] - 0.5], [c[0] + 0.25, c[1] + 0.5], [c[0] - 0.25, c[1] + 0.5]];

describe('Schallmodell Wärmepumpe (Phase 2.3)', () => {
  const site = (b: Building[]): Site => ({ ...demoSite(), buildings: b });

  it('Formel wie BWP-Schallrechner: 58 dB(A), Wand, 6 m → 37,4 dB(A) (BWP 37,4)', () => {
    expect(soundPressure(58, 4, 6)).toBeCloseTo(37.46, 1);
  });

  it('Wand bis 3 m: an der Wand; genau 3,0 m: frei (LAI: „bis zu 3 m“ – Grenzfall offen, hier < 3 m)', () => {
    const s = site([haus('h', 0, 0, 10, 8, true)]);
    expect(placement(s, wp([5, -2.9]))).toBe('wand'); // Gerätekante 2,4 m vor der Wand
    expect(placement(s, wp([5, -3.6]))).toBe('frei'); // Gerätekante 3,1 m
    expect(placement(s, wp([-1.5, -1.5]))).toBe('ecke'); // je 1,25 m zu zwei Wänden
  });

  it('Abschirmung: eigenes Haus dazwischen = abgewandte Seite (15 dB), fremdes Haus = 5 dB, frei = 0', () => {
    const eigen = haus('eigen', 0, 0, 10, 8, true);
    const fremd = haus('fremd', 20, 0, 6, 8);
    const ziel = haus('ziel', 40, 0, 8, 8);
    const s = site([eigen, fremd, ziel]);
    // Gerät westlich am eigenen Haus, Ziel östlich hinter beiden Häusern
    expect(abschirmung(s, [-1, 4], wp([-1, 4]), [40, 4], 'ziel')).toEqual({ db: 15, art: 'abgewandt' });
    // Gerät östlich vom eigenen Haus: nur das fremde Haus verdeckt
    expect(abschirmung(s, [12, 4], wp([12, 4]), [40, 4], 'ziel')).toEqual({ db: 5, art: 'verdeckt' });
    // freie Sicht nach Süden
    expect(abschirmung(s, [12, 4], wp([12, 4]), [12, -20], 'ziel').db).toBe(0);
    expect(LIMITS.waermepumpe.abschirmungDb.wert.verdeckt).toBe(5);
  });

  it('niedrige Gebäude (Traufe unter 2 m) schirmen nicht ab', () => {
    const s = site([haus('schuppen', 5, -1, 2, 2, false, 1.8)]);
    expect(abschirmung(s, [0, 0], wp([0, 0]), [10, 0]).db).toBe(0);
  });

  it('Fassade abgetastet: der lauteste Punkt zählt, nicht die Fassadenmitte', () => {
    const s = demoSite();
    const objs = demoObjects();
    // ein angenommenes Fenster mit langer Fassade, Gerät nahe am Fassadenende
    s.windows = [{ pos: [0, 30], z: 1.6, provenance: 'Annahme', fassade: [[-10, 30], [10, 30]], buildingId: 'x' }];
    s.buildings = [];
    objs.waermepumpe = { ...objs.waermepumpe, center: [9, 25] };
    const r = evaluate(s, objs).waermepumpe;
    const mitte = soundPressure(objs.waermepumpe.lw!, 2, Math.hypot(9, 5, 1.1));
    expect(r.lp!).toBeGreaterThan(mitte + 3);
    expect(r.rows.some((x) => x.text.includes('ganze Fassade'))).toBe(true);
  });

  it('Gerät aus der KEYMARK-Liste: zertifiziert, Hinweis auf Nachtbetrieb offen', () => {
    const objs = demoObjects();
    objs.waermepumpe = { ...objs.waermepumpe, lw: 55, geraet: { hersteller: 'Test', modell: 'X 8' } };
    const r = evaluate(demoSite(), objs).waermepumpe;
    expect(r.rows.find((x) => x.kind === 'zertifiziert')?.text).toContain('Nennbetrieb');
    expect(r.rows.some((x) => x.kind === 'offen' && x.text.includes('Nachtbetrieb'))).toBe(true);
  });

  it('über 2 m Höhe: Abstandsfläche offen (Art. 6 Abs. 1 Satz 3 Nr. 4)', () => {
    const objs = demoObjects();
    objs.waermepumpe = { ...objs.waermepumpe, h: 2.2 };
    expect(evaluate(demoSite(), objs).waermepumpe.rows.some((x) => x.kind === 'offen' && x.text.includes('Abstandsfläche'))).toBe(true);
  });
});
