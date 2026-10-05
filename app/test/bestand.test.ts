import { describe, expect, it } from 'vitest';
import { ausTipp, beschreibung, fromRec, jeGrenze, minRect, nachgezogen, seitenAnGrenze } from '../src/site/bestand';
import type { TippAntwort } from '../src/site/bestand';
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

describe('Ein Tipp erfasst', () => {
  const antwort: TippAntwort = {
    ok: true, label: 'erfasst per Tipp', klasse: 'gartenhaus',
    vorschlag: [{ klasse: 'gartenhaus', p: 0.72 }, { klasse: 'gewaechshaus', p: 0.1 }],
    umriss: [[699010, 5487020], [699013, 5487020], [699013, 5487022.5], [699010, 5487022.5]],
    masse: { form: 'rechteck', laenge: 3.02, breite: 2.48, spanne_laenge: 0.38, spanne_breite: 0.38, hoehe: 2.6, spanne_hoehe: 0.12, wandhoehe_mittel: 2.3, spanne_wand: 0.16 },
  };
  it('lokale Koordinaten, Herkunft „erfasst per Tipp“, Maße mit Spanne aus dem Dienst', () => {
    const b = ausTipp('t1', antwort, [699000, 5487000]);
    expect(b.provenance).toBe('erfasst per Tipp');
    expect(b.footprint[0]).toEqual([10, 20]);
    expect(b.kind).toBe('gartenhaus');
    expect(b.height).toBe(2.3);
    expect(b.laenge).toEqual({ wert: 3.02, spanne: 0.38 });
    expect(beschreibung(b)).toContain('3,02 × 2,48 m');
  });
  it('Klasse und Wandhöhe vom Nutzer gehen vor', () => {
    const b = ausTipp('t1', antwort, [699000, 5487000], 'gewaechshaus', 2.1);
    expect(b.kind).toBe('gewaechshaus');
    expect(b.height).toBe(2.1);
    expect(b.hoehe).toEqual({ wert: 2.1, spanne: 0 });
  });
  it('nachgezogen: Kanten bleiben änderbar, danach nutzerbestätigt', () => {
    const b = nachgezogen(ausTipp('t1', antwort, [699000, 5487000]), [[10, 20], [13.2, 20], [13.2, 22.5], [10, 22.5]]);
    expect(b.provenance).toBe('nutzerbestätigt');
    expect(b.laenge?.wert).toBeCloseTo(3.2);
  });
  it('ohne Umriss: Fehler mit Grund', () => {
    expect(() => ausTipp('t', { ok: false, grund: 'Kein Umriss gefunden.' }, [0, 0])).toThrow('Kein Umriss gefunden.');
  });
});
