import { describe, expect, it } from 'vitest';
import { evaluate, footprint, insidePolygon, overlaps, type Vec2 } from '../src/rules';
import { assumedWindows, ccw, classifyBuildings, dominantAngle, initialObjects, isSimple, sidesFromBoundary, snap } from '../src/site/plot';

const plot: Vec2[] = [[0, 0], [0, -30], [20, -30], [20, 0]]; // im Uhrzeigersinn gesetzt

describe('Grenzseiten', () => {
  it('benennt Seiten nach Himmelsrichtung, unabhängig von der Klickrichtung', () => {
    const { sides, segmentSide } = sidesFromBoundary(plot);
    expect(segmentSide).toHaveLength(4);
    expect(sides.map((s) => s.name).sort()).toEqual(['nach Norden', 'nach Osten', 'nach Süden', 'nach Westen']);
  });

  it('fasst einen leichten Knick zu einer Seite zusammen', () => {
    const p: Vec2[] = [[0, 0], [10, 0.5], [20, 0], [20, -30], [0, -30]];
    const { sides, segmentSide } = sidesFromBoundary(p);
    expect(sides).toHaveLength(4);
    const b = ccw(p);
    expect(new Set(segmentSide).size).toBe(4);
    expect(b).toHaveLength(5);
  });
});

describe('Kontext', () => {
  const buildings = classifyBuildings(plot, [
    { id: 'eigen', fp: [[5, -5], [15, -5], [15, -15], [5, -15]] },
    { id: 'nachbar', fp: [[25, -5], [35, -5], [35, -15], [25, -15]] },
    { id: 'weit', fp: [[200, -5], [210, -5], [210, -15], [200, -15]] },
  ]);

  it('erkennt das eigene Haus', () => {
    expect(buildings.filter((b) => b.own).map((b) => b.id)).toEqual(['eigen']);
  });

  it('nimmt Fenster an der zugewandten Fassade an', () => {
    const w = assumedWindows(plot, buildings);
    expect(w).toHaveLength(1);
    expect(w[0].pos).toEqual([25, -10]);
    expect(w[0].z).toBe(1.6);
    expect(w[0].provenance).toBe('Annahme');
  });

  it('platziert alle Objekte frei auf dem Grundstück', () => {
    const o = initialObjects(plot, buildings, []);
    const fps = Object.values(o).map((x) => footprint(x));
    for (const fp of fps) expect(insidePolygon(fp, plot)).toBe(true);
    for (const fp of fps) expect(overlaps(fp, buildings[0].footprint)).toBe(false);
    expect(overlaps(fps[0], fps[1])).toBe(false);
    const site = { plot: { boundary: plot, ...sidesFromBoundary(plot), provenance: 'nutzerbestätigt' as const }, buildings, bestand: [], windows: assumedWindows(plot, buildings), gebiet: { value: 'allgemein' as const, provenance: 'Annahme' as const }, bereich: { value: 'innen' as const, provenance: 'Annahme' as const }, bplan: { status: 'unbekannt' as const, provenance: 'offen' as const }, aufenthaltsraum: { value: false, provenance: 'Annahme' as const }, feuerstaette: { value: false, provenance: 'Annahme' as const } };
    const r = evaluate(site, o);
    expect(r.gartenhaus.head).not.toMatch(/Kollidiert|nicht ganz/);
    expect(r.waermepumpe.rows.some((x) => x.text.includes('Hauswand'))).toBe(true);
  });

  it('richtet Objekte an der längsten Grenze aus', () => {
    const rot: Vec2[] = plot.map(([x, y]) => [x * Math.cos(0.3) - y * Math.sin(0.3), x * Math.sin(0.3) + y * Math.cos(0.3)]);
    expect(dominantAngle(rot)).toBeCloseTo(0.3, 6);
  });
});

describe('Einrasten und Plausibilität', () => {
  const fps: Vec2[][] = [[[5, -5], [15, -5], [15, -15], [5, -15]]];
  it('rastet zuerst auf Ecken, dann auf Kanten ein', () => {
    expect(snap([5.3, -5.2], fps, 0.6)).toEqual({ p: [5, -5], snapped: 'ecke' });
    expect(snap([10, -5.2], fps, 0.6).snapped).toBe('kante');
    expect(snap([10, -5.2], fps, 0.6).p[1]).toBeCloseTo(-5, 9);
    expect(snap([10, -8], fps, 0.6).snapped).toBe(null);
  });
  it('erkennt Selbstüberschneidung', () => {
    expect(isSimple(plot)).toBe(true);
    expect(isSimple([[0, 0], [10, -10], [10, 0], [0, -10]])).toBe(false);
  });
});
