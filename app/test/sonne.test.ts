import { describe, expect, it } from 'vitest';
import { imSchatten, koerperAus, koerperPflanze, schattenAmBoden, sonnenstand, sonnenstunden, type Koerper } from '../src/rules';
import { area } from '../src/rules/geometry';

const LAT = 49.505;
const LON = 11.745;

describe('Sonnenstand gegen NREL-SPA (pvlib 0.16, ohne Refraktion)', () => {
  // Referenz: pvlib.solarposition.get_solarposition(method='nrel_numpy'), Spalten elevation/azimuth
  const ref: [string, number, number][] = [
    ['2026-06-21T11:00:00Z', 63.77, 172.286],
    ['2026-06-21T17:30:00Z', 15.258, 288.384],
    ['2026-03-20T08:00:00Z', 24.507, 122.493],
    ['2026-12-21T11:15:00Z', 17.051, 180.943],
    ['2026-09-23T14:45:00Z', 21.721, 241.741],
  ];
  for (const [t, h, az] of ref) {
    it(`${t}: Höhe und Azimut auf 0,2° genau`, () => {
      const s = sonnenstand(new Date(t), LAT, LON);
      expect(Math.abs(s.hoehe - h)).toBeLessThan(0.2);
      expect(Math.abs(s.azimut - az)).toBeLessThan(0.2);
    });
  }
});

describe('Schatten', () => {
  const sued = { hoehe: 45, azimut: 180 }; // Sonne im Süden, 45° → Schatten nach Norden so lang wie hoch
  const box: Koerper = { id: 'g', fp: [[0, 0], [2, 0], [2, 2], [0, 2]], z0: 0, z1: 3 };

  it('Box 2 × 2 × 3 m bei 45° aus Süden: Schatten reicht 3 m nach Norden', () => {
    const f = schattenAmBoden(box, sued)!;
    expect(Math.max(...f.map((p) => p[1]))).toBeCloseTo(5, 9);
    expect(area(f)).toBeCloseTo(2 * 5, 9);
  });

  it('Punkt am Boden nördlich im Schatten, südlich nicht; Fenster in 4 m Höhe über dem Schatten', () => {
    expect(imSchatten([1, 4], 0, [box], sued)).toBe('g');
    expect(imSchatten([1, 5.5], 0, [box], sued)).toBeNull();
    expect(imSchatten([1, -1], 0, [box], sued)).toBeNull();
    expect(imSchatten([1, 3], 4, [box], sued)).toBeNull();
  });

  it('Meridiankonvergenz dreht die Richtung (2° → Schatten leicht nach Westen versetzt... im Gitter)', () => {
    const f = schattenAmBoden(box, sued, 2)!;
    expect(Math.min(...f.map((p) => p[0]))).toBeLessThan(0);
  });

  it('Sonne unter 5°: kein Schatten', () => {
    expect(schattenAmBoden(box, { hoehe: 3, azimut: 90 })).toBeNull();
    expect(imSchatten([1, 4], 0, [box], { hoehe: 3, azimut: 180 })).toBeNull();
  });

  it('Satteldach: First wirft weiter als die Traufe', () => {
    const o = { kind: 'gartenhaus' as const, center: [1, 1] as [number, number], w: 2, d: 2, h: 2, angle: 0, neigung: 60 };
    const k = koerperAus(o); // First entlang x in y = 1, tan 60° = 1,732 m über der Traufe
    const f = schattenAmBoden(k, sued)!;
    expect(Math.max(...f.map((p) => p[1]))).toBeCloseTo(1 + 2 + Math.tan(Math.PI / 3), 6);
    // Bodenpunkt 4,3 m nördlich: Strahl läuft über die Traufe, trifft aber die Dachfläche
    expect(imSchatten([1, 4.3], 0, [k], sued)).toBe('gartenhaus');
    expect(imSchatten([1, 4.3], 0, [{ ...k, first: undefined }], sued)).toBeNull();
  });

  it('Carport: nur das Dach, darunter fällt Licht schräg durch', () => {
    const o = { kind: 'carport' as const, center: [0, 0] as [number, number], w: 3, d: 5, h: 2.5, angle: 0 };
    const k = koerperAus(o);
    expect(k.z0).toBeCloseTo(2.3, 9);
    // Bodenpunkt 0,5 m südlich vor dem Carport: Strahl nach Süden hoch, trifft das Dach nicht
    expect(imSchatten([0, -3], 0, [k], sued)).toBeNull();
  });

  it('Baumkrone beginnt erst in 45 % der Höhe', () => {
    const k = koerperPflanze({ art: 'baum', center: [0, 0], laenge: 0, angle: 0, hoehe: 10 });
    expect(k.z0).toBeCloseTo(4.5, 9);
  });

  it('Sonnenstunden: freier Punkt am 21. Juni rund 15 h über 5°, Wand im Süden nimmt fast alles', () => {
    const tag = new Date('2026-06-21T00:00:00Z');
    const frei = sonnenstunden([0, 0], 1.6, [], tag, LAT, LON);
    expect(frei).toBeGreaterThan(14);
    expect(frei).toBeLessThan(16);
    const wand: Koerper = { id: 'w', fp: [[-20, -2], [20, -2], [20, -1.5], [-20, -1.5]], z0: 0, z1: 10 };
    expect(sonnenstunden([0, 0], 1.6, [wand], tag, LAT, LON)).toBeLessThan(frei - 6);
  });
});
