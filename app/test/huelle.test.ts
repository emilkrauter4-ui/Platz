import { describe, expect, it } from 'vitest';
import {
  abstandAn,
  area,
  clipArea,
  dachAnteilSattel,
  durchstoesse,
  hoeheAn,
  hoeheAusAbstand,
  huelleModell,
  huelleRaster,
  neuesVorhaben,
  pruefeAF,
  grundriss,
  strassenVersatz,
  type Site,
  type Vec2,
  type Vorhaben,
} from '../src/rules';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const site = (haus?: Vec2[], plot: Vec2[] = rect(0, 0, 30, 40)): Site => ({
  plot: { boundary: plot, sides: [{ name: 'S', grenze: 'S' }], provenance: 'Demo' },
  buildings: haus ? [{ id: 'haus', footprint: haus, provenance: 'amtlich', own: true, trauf: 6, first: 9 }] : [],
  bestand: [],
  windows: [],
  ground: () => 400,
  gebiet: { value: 'allgemein', provenance: 'Annahme' },
  bereich: { value: 'innen', provenance: 'Annahme' },
  bplan: { status: 'unbekannt', provenance: 'offen' },
  aufenthaltsraum: { value: false, provenance: 'Annahme' },
  feuerstaette: { value: false, provenance: 'Annahme' },
});

/** deterministischer Zufall */
const zufall = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('Hülle: Umkehrung von BayBO Art. 6 Abs. 5', () => {
  it('Grenzfälle am 3-m-Band: genau 3,00 m → H = 7,5 m; 2,99 m → keine Wand; 5 m → 12,5 m; Mitte → 2,5 · Abstand', () => {
    const m = huelleModell(site());
    expect(hoeheAn(m, [3, 20])).toBeCloseTo(7.5, 9);
    expect(hoeheAn(m, [2.99, 20])).toBe(0);
    expect(hoeheAn(m, [5, 20])).toBeCloseTo(12.5, 9);
    expect(hoeheAn(m, [15, 20])).toBeCloseTo(37.5, 9); // 15 m zur nächsten Grenze (Ost/West)
    expect(hoeheAn(m, [-1, 20])).toBe(0); // außerhalb
    expect(hoeheAusAbstand(3)).toBeCloseTo(7.5, 9);
    expect(hoeheAusAbstand(2.9999)).toBe(0);
  });

  it('schräge Grenze: Abstand zur nächsten Grenzkante, nicht zur Achse', () => {
    const m = huelleModell(site(undefined, [[0, 0], [20, 0], [26, 30], [0, 30]]));
    const q: Vec2 = [10, 15];
    const dOst = Math.abs(30 * q[0] - 6 * q[1] - 30 * 20 + 0) / Math.hypot(30, 6); // Abstand zur Ostkante (20,0)-(26,30)
    const d = Math.min(q[0], dOst, q[1], 30 - q[1]);
    expect(abstandAn(m, q)).toBeCloseTo(d, 6);
    expect(hoeheAn(m, q)).toBeCloseTo(2.5 * d, 6);
  });

  it('Verkehrsfläche an der Grenze: Abstandsfläche bis zur Mitte (Art. 6 Abs. 2 Satz 2) – Grenze um die halbe Straßenbreite nach außen', () => {
    const plot = rect(0, 0, 30, 40);
    const strasse = [rect(-10, -10, 40, 0)]; // 10 m breit, grenzt an die Südgrenze
    const v = strassenVersatz(plot, strasse);
    expect(v[0]).toBeCloseTo(5, 1); // Südkante
    expect(v.slice(1)).toEqual([0, 0, 0]);
    const mit = huelleModell(site(undefined, plot), strasse);
    const ohne = huelleModell(site(undefined, plot));
    expect(hoeheAn(ohne, [15, 3])).toBeCloseTo(7.5, 9);
    expect(hoeheAn(mit, [15, 3])).toBeCloseTo(2.5 * 8, 0); // 3 m + 5 m bis zur Straßenmitte
    expect(hoeheAn(mit, [15, 0.5])).toBeGreaterThan(10); // sogar direkt an der Grenze darf es (nach der Formel) hoch sein
  });

  it('Lücke zwischen Grundstück und Verkehrsfläche (> 0,5 m): keine Verschiebung (sichere Seite)', () => {
    expect(strassenVersatz(rect(0, 0, 30, 40), [rect(-10, -10, 40, -2)])[0]).toBe(0);
  });

  it('Überdeckungsverbot: eigenes Haus und seine Abstandsfläche sind Hindernis', () => {
    const m = huelleModell(site(rect(10, 15, 20, 23))); // Trauf 6, First 9 → H = 7 → Tiefe 3 m
    expect(hoeheAn(m, [15, 11.5])).toBe(0); // 3,5 m südlich vom Haus, aber 0,5 m außerhalb... Südwand bei y = 15, Fläche bis y = 12 → 0,5 m davor
    expect(abstandAn(m, [15, 11.5])).toBeCloseTo(0.5, 6);
    expect(hoeheAn(m, [15, 8.9])).toBeCloseTo(2.5 * 3.1, 6); // 3,1 m vor der Abstandsfläche
    expect(hoeheAn(m, [15, 17])).toBe(0); // im Haus
    expect(hoeheAn(m, [15, 13.5])).toBe(0); // in der Abstandsfläche
  });

  it('Kleinbauten aus Bestand sperren nur die Fläche, ohne Abstand', () => {
    const s = site();
    s.bestand = [{ id: 'g1', footprint: rect(14, 14, 17, 17), height: 2.5, provenance: 'nutzerbestätigt', kind: 'gartenhaus' }];
    const m = huelleModell(s);
    expect(hoeheAn(m, [15, 15])).toBe(0);
    expect(hoeheAn(m, [20, 15])).toBeCloseTo(2.5 * 10, 6); // 10 m zur Ostgrenze; das Gartenhaus verlangt keinen Abstand
  });

  it('ausgenommenes Haus (Aufstockung, Anbau) zählt nicht als Hindernis', () => {
    const s = site(rect(10, 15, 20, 23));
    expect(hoeheAn(huelleModell(s, [], ['haus']), [15, 17])).toBeGreaterThan(30);
  });

  it('Dachanteil: Satteldach 35°, 8 m tief → ein Drittel der Dachhöhe ≈ 0,93 m', () => {
    expect(dachAnteilSattel()).toBeCloseTo((4 * Math.tan((35 * Math.PI) / 180)) / 3, 9);
    expect(dachAnteilSattel(75, 8)).toBeCloseTo(4 * Math.tan((75 * Math.PI) / 180), 9); // über 70° voll
  });

  it('Raster 0,5 m: Werte stimmen mit der exakten Rechnung überein, außerhalb −1', () => {
    const m = huelleModell(site());
    const r = huelleRaster(m, 0.5);
    let abw = 0;
    for (let j = 0; j < r.ny; j += 3) for (let i = 0; i < r.nx; i += 3) {
      const p: Vec2 = [r.x0 + i * r.step, r.y0 + j * r.step];
      const v = r.h[j * r.nx + i];
      if (p[0] <= 0 || p[0] >= 30 || p[1] <= 0 || p[1] >= 40) continue;
      if (Math.abs(v - hoeheAn(m, p)) > 1e-4) abw++;
    }
    expect(abw).toBe(0);
    const schraeg = huelleRaster(huelleModell(site(undefined, [[0, 0], [30, 0], [0, 40]])));
    expect(schraeg.h[(schraeg.ny - 1) * schraeg.nx + schraeg.nx - 1]).toBe(-1); // Zelle in der abgeschnittenen Ecke liegt außerhalb
    console.info(`Hülle-Raster: ${r.nx} × ${r.ny} Zellen in ${r.ms.toFixed(0)} ms (30 × 40 m)`);
  });
});

describe('Hülle gegen die Einzelprüfung der Abstandsflächen an Zufallspunkten', () => {
  /** kleines Haus (10 cm) mit Wandhöhe h am Punkt p, Ausrichtung angle */
  const kleinhaus = (s: Site, p: Vec2, angle: number, h: number): { v: Vorhaben; ok: boolean; aus: number } => {
    const v: Vorhaben = { ...neuesVorhaben('wohnhaus', s), center: p, w: 0.1, d: 0.1, angle, geschosse: 1, geschosshoehe: h, dachform: 'flach' };
    const g = grundriss(s, v)!;
    const af = pruefeAF(s, v, g);
    const aus = af.waende.reduce((x, w) => x + Math.max(0, area(w.flaeche) - clipArea(s.plot.boundary, w.flaeche)), 0);
    return { v, ok: aus < 1e-9 && af.ueberdeckung.length === 0 && af.inFlaeche.length === 0, aus };
  };

  for (const [name, mitHaus] of [['nur Grundstück', false], ['mit eigenem Haus', true]] as const) {
    it(`${name}: 0 Abweichungen – unter der Hülle passt die Einzelprüfung (alle Ausrichtungen), 3 m darüber fällt sie bei Ausrichtung zum Hindernis durch`, () => {
      const s = site(mitHaus ? rect(8, 14, 20, 22) : undefined, [[0, 0], [30, 0], [34, 26], [28, 40], [0, 40]]);
      const m = huelleModell(s);
      const z = zufall(42);
      let geprueft = 0;
      let zuHoch = 0;
      let nichtDurchgefallen = 0;
      for (let k = 0; k < 900; k++) {
        const p: Vec2 = [z() * 34, z() * 40];
        // 3,2 m: das Häuschen hat 7 cm Ausdehnung, am 3-m-Band zählt der Abstand, nicht die Höhe (Mindesttiefe 3 m)
        if (abstandAn(m, p) < 3.2) continue;
        const H = hoeheAn(m, p);
        geprueft++;
        // Sicherheit: 8 Ausrichtungen, immer innerhalb der Hülle (0,3 m Spielraum für die Ecken des Häuschens)
        for (let a = 0; a < 8; a++) if (!kleinhaus(s, p, (a * Math.PI) / 8 + z(), H - 0.3).ok) zuHoch++;
        // Schärfe: Wand zum nächsten Hindernis ausgerichtet, 3 m über der Hülle
        let best = { d: Infinity, q: p };
        const ring = [...edges4(m.rand), ...m.hindernisse.flatMap((h) => edges4(h))]; // Rand und Hindernisse (Haus + Abstandsflächen)
        for (const [a, b] of ring) {
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
          const q: Vec2 = [a[0] + t * dx, a[1] + t * dy];
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (d < best.d) best = { d, q };
        }
        if (best.d < 3 + 1e-6) continue;
        const dir = Math.atan2(best.q[1] - p[1], best.q[0] - p[0]);
        // 3 m darüber: die Überdeckung zählt Passt. erst ab 0,05 m², das dünne Häuschen braucht deshalb etwas mehr Überstand
        if (kleinhaus(s, p, dir, H + 3).ok) nichtDurchgefallen++;
      }
      expect(geprueft).toBeGreaterThan(150);
      console.info(`Hülle gegen Einzelprüfung (${name}): ${geprueft} Zufallspunkte × 8 Ausrichtungen, ${zuHoch} Abweichungen`);
      expect(zuHoch).toBe(0);
      // Mit Haus: Liegt der nächste Hindernispunkt an der Schmalseite einer Abstandsfläche des Hauses, steht die neue Wand im Winkel
      // von 90° zur Hauswand – das erlaubt Art. 6 Abs. 3 Nr. 1. Die Hülle kennt die Ausrichtung nicht und bleibt auf der sicheren Seite.
      expect(nichtDurchgefallen).toBeLessThanOrEqual(mitHaus ? Math.ceil(geprueft * 0.03) : 0);
    });
  }
});

const edges4 = (poly: Vec2[]): [Vec2, Vec2][] => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);

describe('Durchstoß: geplante Wand gegen die Hülle', () => {
  const m = huelleModell(site());
  it('Wand genau an der Hülle: kein Durchstoß; 10 cm darüber: Durchstoß an genau diesen Stellen', () => {
    expect(durchstoesse(m, [3, 10], [3, 20], 7.5, 7.5, 0)).toEqual([]); // 3,00 m von der Westgrenze: H = 7,5 m
    const d = durchstoesse(m, [3, 10], [3, 20], 7.6, 7.6, 0);
    expect(d.length).toBeGreaterThan(30);
    expect(d[0].huelle).toBeCloseTo(7.5, 6);
  });
  it('Wand 2 m von der Grenze: überall rot (Hülle 0); Dachanteil zählt zu H', () => {
    expect(durchstoesse(m, [2, 10], [2, 20], 3, 3, 0).length).toBe(41);
    expect(durchstoesse(m, [8, 10], [8, 20], 19.5, 19.5, 0)).toEqual([]); // 20 m erlaubt
    expect(durchstoesse(m, [8, 10], [8, 20], 19.5, 19.5, 1)).toHaveLength(41); // 19,5 + 1 m Dach > 20 m
  });
  it('nur ein Teil der Wand reicht in die Sperrzone: Durchstoß nur dort', () => {
    // Wand quer zum Gefälle der Hülle: von x = 3 (7,5 m) nach x = 9 (22,5 m) mit konstant 15 m Höhe
    const d = durchstoesse(m, [3, 20], [9, 20], 15, 15, 0);
    expect(d.length).toBeGreaterThan(5);
    expect(d.every((x) => x.p[0] < 6.0 + 1e-9)).toBe(true);
  });
});

describe('Hülle im Rechen-Worker', () => {
  it('bearbeite({art: huelle}) liefert dasselbe Raster wie huelleRaster und ist übertragbar', async () => {
    const { bearbeite } = await import('../src/rules');
    const m = huelleModell(site(rect(10, 15, 20, 23)));
    expect(() => structuredClone({ art: 'huelle', id: 1, modell: m })).not.toThrow();
    const a = bearbeite({ art: 'huelle', id: 5, modell: structuredClone(m) });
    expect(a.art).toBe('huelle');
    if (a.art !== 'huelle') return;
    const direkt = huelleRaster(m);
    expect(a.id).toBe(5);
    expect(Array.from(a.raster.h)).toEqual(Array.from(direkt.h));
  });
});
