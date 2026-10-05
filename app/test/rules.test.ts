import { describe, expect, it } from 'vitest';
import {
  evaluate,
  footprint,
  limitRadius,
  meanWallHeight,
  placement,
  soundPressure,
  type Objects,
  type Site,
  type Vec2,
} from '../src/rules';
import { demoObjects, demoSite } from '../src/rules/demo';

/** Rechteckiges Testgrundstück 30 × 30 m, Straße im Norden. Kein Haus, damit nichts kollidiert. */
function square(): Site {
  return {
    ...demoSite(),
    demo: false,
    plot: {
      boundary: [[0, 0], [30, 0], [30, -30], [0, -30]],
      sides: [
        { name: 'zur Straße', grenze: 'an der Straßengrenze' },
        { name: 'nach Osten', grenze: 'an der Ostgrenze' },
        { name: 'nach hinten', grenze: 'an der hinteren Grenze' },
        { name: 'nach Westen', grenze: 'an der Westgrenze' },
      ],
      provenance: 'nutzerbestätigt',
    },
    buildings: [],
    windows: [],
  };
}

/** Objekte weit weg voneinander in der Mitte; einzelne Tests verschieben sie. */
function objs(): Objects {
  const o = demoObjects();
  o.gartenhaus.center = [15, -15];
  o.carport.center = [15, -6];
  o.waermepumpe.center = [8, -24];
  return o;
}

describe('Abstand: genau 3,00 m', () => {
  it('3,00 m zur Westgrenze: Mindestabstand eingehalten', () => {
    const o = objs();
    o.gartenhaus.center = [3 + 1.5, -15]; // w = 3 → linke Wand bei x = 3,00
    const r = evaluate(square(), o).gartenhaus;
    expect(r.status).toBe('ok');
    expect(r.sub).toBe('Keine Baugenehmigung nötig, und der Abstand zur Grenze stimmt.');
    expect(r.rows.some((x) => x.text === 'Mindestabstand von 3 m eingehalten')).toBe(true);
    expect(r.dim?.label).toBe('3,00 m');
  });

  it('2,99 m zur Westgrenze: Grenzbebauung, bei 2,5 m Wandhöhe erlaubt', () => {
    const o = objs();
    o.gartenhaus.center = [2.99 + 1.5, -15];
    const r = evaluate(square(), o).gartenhaus;
    expect(r.status).toBe('ok');
    expect(r.sub).toContain('So nah an der Grenze');
    expect(r.rows.map((x) => x.text)).toContain('An der Westgrenze belegt: 3,0 von 9 m');
  });

  it('2,99 m zur Grenze mit 3,05 m Wandhöhe: zu nah', () => {
    const o = objs();
    o.gartenhaus.center = [2.99 + 1.5, -15];
    o.gartenhaus.h = 3.05;
    const r = evaluate(square(), o).gartenhaus;
    expect(r.status).toBe('bad');
    expect(r.head).toBe('Noch 0,01 m zu nah an der Grenze.');
    expect(r.badSegments).toEqual([3]);
  });

  it('genau 3,00 m Wandhöhe an der Grenze ist noch erlaubt', () => {
    const o = objs();
    o.gartenhaus.center = [1.5, -15];
    o.gartenhaus.h = 3;
    expect(evaluate(square(), o).gartenhaus.status).toBe('ok');
  });
});

describe('Grenzbebauung: genau 9,00 m je Seite, 15 m gesamt', () => {
  it('Carport 9,00 m lang an der Westgrenze: erlaubt', () => {
    const o = objs();
    o.carport = { ...o.carport, w: 3, d: 9, center: [1.5, -10] }; // 27 m² < 50
    const r = evaluate(square(), o).carport;
    expect(r.status).toBe('ok');
    expect(r.rows.map((x) => x.text)).toContain('An der Westgrenze belegt: 9,0 von 9 m');
  });

  it('Carport 9,00 m + Gartenhaus an derselben Grenze: zu viel', () => {
    const o = objs();
    o.carport = { ...o.carport, w: 3, d: 9, center: [1.5, -10] };
    o.gartenhaus.center = [1.5, -20];
    const r = evaluate(square(), o);
    expect(r.gartenhaus.status).toBe('bad');
    expect(r.gartenhaus.head).toBe('Zu viel an der Westgrenze.');
    expect(r.carport.status).toBe('bad');
  });

  it('9,01 m: zu viel', () => {
    const o = objs();
    o.carport = { ...o.carport, w: 3, d: 9.01, center: [1.5, -10] };
    expect(evaluate(square(), o).carport.head).toBe('Zu viel an der Westgrenze.');
  });

  it('insgesamt 15 m: erlaubt, darüber nicht', () => {
    const site = square();
    const o = objs();
    o.carport = { ...o.carport, w: 3, d: 9, center: [1.5, -10] }; // West: 9 m
    o.gartenhaus = { ...o.gartenhaus, w: 6, d: 2, h: 2.5, center: [15, -29] }; // hinten: 6 m, 30 m³
    expect(evaluate(site, o).gartenhaus.status).toBe('ok');
    o.gartenhaus.w = 6.2;
    const r = evaluate(site, o).gartenhaus;
    expect(r.status).toBe('bad');
    expect(r.head).toBe('Zu viel Bebauung an deinen Grenzen.');
    expect(r.sub).toContain('15,2 m');
  });
});

describe('Bestand zählt mit', () => {
  it('per Tipp erfasstes Gartenhaus an der Westgrenze plus neuer Carport > 9 m', () => {
    const site = square();
    site.bestand = [{ id: 'b1', footprint: [[0, -20], [2.5, -20], [2.5, -24], [0, -24]], height: 2.2, provenance: 'erfasst per Tipp', kind: 'gartenhaus' }];
    const o = objs();
    o.carport = { ...o.carport, w: 3, d: 6, center: [1.5, -8] };
    const r = evaluate(site, o).carport;
    expect(r.status).toBe('bad');
    expect(r.head).toBe('Zu viel an der Westgrenze.');
    expect(r.rows.find((x) => x.text.startsWith('Davon bestehende'))?.text).toBe('Davon bestehende Kleinbauten: 4,0 m');
    expect(r.bestandGezaehlt).toEqual([{ id: 'b1', grund: 'von dir per Tipp erfasst' }]);
  });

  it('Bestand auf dem Nachbargrundstück zählt nicht', () => {
    const site = square();
    site.bestand = [{ id: 'b2', footprint: [[-3, -20], [-0.5, -20], [-0.5, -24], [-3, -24]], height: 2.2, provenance: 'erkannt' }];
    const o = objs();
    o.carport = { ...o.carport, w: 3, d: 6, center: [1.5, -8] };
    expect(evaluate(site, o).carport.status).toBe('ok');
  });

  it('automatisch erkannt zählt nie – auch nicht mit hoher Konfidenz –, wird aber als Hinweis genannt', () => {
    const site = square();
    site.bestand = [{ id: 'b1', footprint: [[0, -20], [2.5, -20], [2.5, -24], [0, -24]], height: 2.2, provenance: 'erkannt', confidence: 0.99, kind: 'gartenhaus' }];
    const o = objs();
    o.carport = { ...o.carport, w: 3, d: 6, center: [1.5, -8] };
    const r = evaluate(site, o).carport;
    expect(r.status).not.toBe('bad');
    expect(r.bestandGezaehlt).toEqual([]);
    expect(r.bestandNichtGezaehlt?.[0].grund).toContain('Hinweis der Automatik');
  });

  it('dasselbe Objekt vom Nutzer bestätigt zählt immer', () => {
    const site = square();
    site.bestand = [{ id: 'b1', footprint: [[0, -20], [2.5, -20], [2.5, -24], [0, -24]], height: 2.2, provenance: 'nutzerbestätigt', confidence: 0.55, kind: 'gartenhaus' }];
    const o = objs();
    o.carport = { ...o.carport, w: 3, d: 6, center: [1.5, -8] };
    const r = evaluate(site, o).carport;
    expect(r.head).toBe('Zu viel an der Westgrenze.');
    expect(r.bestandGezaehlt).toEqual([{ id: 'b1', grund: 'von dir bestätigt' }]);
  });

  it('Pool und Hecke an der Grenze zählen nicht zur Grenzbebauung', () => {
    const site = square();
    site.bestand = [
      { id: 'p', footprint: [[0.5, -20], [3, -20], [3, -24], [0.5, -24]], height: 0, provenance: 'nutzerbestätigt', kind: 'pool' },
      { id: 'h', footprint: [[0, -10], [0.8, -10], [0.8, -19], [0, -19]], height: 2, provenance: 'nutzerbestätigt', kind: 'hecke' },
    ];
    const o = objs();
    o.carport = { ...o.carport, w: 3, d: 6, center: [1.5, -8] };
    const r = evaluate(site, o).carport;
    expect(r.head).not.toBe('Zu viel an der Westgrenze.');
    expect(r.bestandNichtGezaehlt?.map((x) => x.grund)).toEqual(['kein Gebäude', 'kein Gebäude']);
  });

  it('Kollision mit Pool, aber nicht mit Strauch', () => {
    const site = square();
    site.bestand = [{ id: 's', footprint: [[14, -14], [16, -14], [16, -16], [14, -16]], height: 1.5, provenance: 'nutzerbestätigt', kind: 'strauch' }];
    expect(evaluate(site, objs()).gartenhaus.head).not.toContain('Kollidiert');
    site.bestand[0].kind = 'pool';
    expect(evaluate(site, objs()).gartenhaus.head).toBe('Kollidiert mit dem Pool.');
  });

  it('Automatisch erkanntes Objekt: keine Kollision, nur Hinweis', () => {
    const site = square();
    site.bestand = [{ id: 'b1', footprint: [[14, -14], [16, -14], [16, -16], [14, -16]], height: 2.2, provenance: 'erkannt', confidence: 0.95 }];
    const r = evaluate(site, objs()).gartenhaus;
    expect(r.head).not.toContain('Kollidiert');
    expect(r.rows.some((x) => x.text.startsWith('Hier scheint noch etwas zu stehen') && x.kind === 'erkannt')).toBe(true);
  });

  it('Kollision mit Bestand', () => {
    const site = square();
    site.bestand = [{ id: 'b1', footprint: [[14, -14], [16, -14], [16, -16], [14, -16]], height: 2.2, provenance: 'nutzerbestätigt' }];
    expect(evaluate(site, objs()).gartenhaus.head).toBe('Kollidiert mit einem bestehenden Nebengebäude.');
  });
});

describe('Schräge Grundstücksgrenze', () => {
  // Westgrenze verläuft schräg von (0,0) nach (10,-30)
  const slanted = (): Site => {
    const s = square();
    s.plot.boundary = [[0, 0], [30, 0], [30, -30], [10, -30]];
    return s;
  };
  const dir: Vec2 = [10, -30];
  const len = Math.hypot(...dir);
  const u: Vec2 = [dir[0] / len, dir[1] / len];
  const n: Vec2 = [-u[1], u[0]]; // Normale nach innen (Osten)

  it('parallel gedrehtes Gartenhaus 1,00 m von der Grenze: Abstand korrekt gemessen', () => {
    const o = objs();
    const along = 15;
    const off = 1 + 1.5; // halbe Breite (w = 3) + 1 m
    o.gartenhaus.center = [u[0] * along + n[0] * off, u[1] * along + n[1] * off];
    o.gartenhaus.angle = Math.atan2(u[1], u[0]) + Math.PI / 2; // w quer zur Grenze
    const r = evaluate(slanted(), o).gartenhaus;
    expect(r.status).toBe('ok');
    expect(r.rows[1].text).toBe('Abstand nach Westen: 1,00 m');
    expect(r.rows.map((x) => x.text)).toContain('An der Westgrenze belegt: 3,0 von 9 m');
  });

  it('ragt über die schräge Grenze: nicht auf dem Grundstück', () => {
    const o = objs();
    o.gartenhaus.center = [u[0] * 15 + n[0] * 1, u[1] * 15 + n[1] * 1];
    o.gartenhaus.angle = Math.atan2(u[1], u[0]);
    expect(evaluate(slanted(), o).gartenhaus.head).toBe('Steht nicht ganz auf deinem Grundstück.');
  });
});

describe('Hanglage: Wandhöhe über Gelände (DGM1)', () => {
  // Gelände fällt nach Westen um 0,5 m je Meter ab (nur nahe der Grenze)
  const hang = (): Site => ({ ...square(), ground: (p) => Math.min(p[0], 4) * 0.5, groundProvenance: 'amtlich' });

  it('mittlere Wandhöhe der Grenzwand wird über dem Gelände gemessen', () => {
    const o = objs().gartenhaus;
    o.center = [1.5, -15];
    o.h = 2.5;
    // Fußboden am höchsten Eckpunkt (x = 3 → 1,5 m), Grenzwand bei x = 0 → Gelände 0
    expect(meanWallHeight(hang(), o, [0, -13.5], [0, -16.5])).toBeCloseTo(4.0, 6);
  });

  it('auf ebenem Gelände erlaubt, im Hang zu hoch', () => {
    const o = objs();
    o.gartenhaus.center = [1.5, -15];
    expect(evaluate(square(), o).gartenhaus.status).toBe('ok');
    const r = evaluate(hang(), o).gartenhaus;
    expect(r.status).toBe('bad');
    expect(r.rows.map((x) => x.text)).toContain('So nah an der Grenze nur bis 3 m Wandhöhe. Deine: 4,00 m');
    expect(r.rows.some((x) => x.text.includes('DGM1') && x.kind === 'amtlich')).toBe(true);
  });

  it('vorgegebene Fußbodenhöhe wird übernommen', () => {
    const o = objs();
    o.gartenhaus.center = [1.5, -15];
    o.gartenhaus.baseElevation = 0;
    expect(evaluate(hang(), o).gartenhaus.status).toBe('ok');
  });
});

describe('Abstandsfläche 0,4 H', () => {
  it('bei 10 m Wandhöhe sind 4 m nötig', () => {
    const o = objs();
    o.gartenhaus = { ...o.gartenhaus, w: 2, d: 2, h: 10, center: [3.5 + 1, -15] }; // 40 m³
    const r = evaluate(square(), o).gartenhaus;
    expect(r.status).toBe('bad');
    expect(r.head).toBe('Noch 0,50 m zu nah an der Grenze.');
    expect(r.sub).toContain('4,00 m');
    o.gartenhaus.center = [4 + 1, -15];
    const ok = evaluate(square(), o).gartenhaus;
    expect(ok.status).toBe('ok');
    expect(ok.rows.map((x) => x.text)).toContain('Abstandsfläche 0,4 H = 4,00 m eingehalten');
  });
});

describe('Größengrenzen BayBO Art. 57', () => {
  it('Gartenhaus genau 75 m³ erlaubt, darüber nicht', () => {
    const o = objs();
    o.gartenhaus = { ...o.gartenhaus, w: 5, d: 5, h: 3 };
    expect(evaluate(square(), o).gartenhaus.status).toBe('ok');
    o.gartenhaus.h = 3.05;
    expect(evaluate(square(), o).gartenhaus.head).toBe('Zu groß für ohne Genehmigung.');
  });

  it('Carport genau 50 m² erlaubt, darüber nicht', () => {
    const o = objs();
    o.carport = { ...o.carport, w: 5, d: 10, center: [15, -8] };
    expect(evaluate(square(), o).carport.status).toBe('ok');
    o.carport.d = 10.1;
    expect(evaluate(square(), o).carport.sub).toContain('50,5 m²');
  });

  it('Außenbereich: nicht verfahrensfrei', () => {
    const s = square();
    s.bereich = { value: 'aussen', provenance: 'nutzerbestätigt' };
    const r = evaluate(s, objs());
    expect(r.gartenhaus.status).toBe('bad');
    expect(r.carport.status).toBe('bad');
  });

  it('Gartenhaus mit Feuerstätte im Innenbereich: verfahrensfrei bis 75 m³ (aktueller Wortlaut), aber gelb', () => {
    const s = square();
    s.feuerstaette = { value: true, provenance: 'nutzerbestätigt' };
    expect(evaluate(s, objs()).gartenhaus.status).toBe('warn');
    expect(evaluate(s, objs()).carport.status).toBe('ok');
  });
});

describe('Wärmepumpe', () => {
  it('Formel Lp = Lw + 10·log10(Q) − 11 − 20·log10(r)', () => {
    expect(soundPressure(58, 2, 10)).toBeCloseTo(58 + 3.0103 - 11 - 20, 3);
    expect(soundPressure(58, 4, 1)).toBeCloseTo(58 + 6.0206 - 11, 3);
    expect(limitRadius(58, 2, 40)).toBeCloseTo(10 ** ((58 + 3.0103 - 11 - 40) / 20), 3);
  });

  it('Richtwert hängt von der Gebietsart ab', () => {
    const s = square();
    s.windows = [{ pos: [8, -14], z: 1.6, provenance: 'nutzerbestätigt' }];
    const o = objs();
    o.waermepumpe.lw = 56; // r ≈ 10 m → Lp ≈ 28 dB(A)
    o.waermepumpe.center = [8, -24];
    const lp = evaluate(s, o).waermepumpe.lp!;
    expect(lp).toBeGreaterThan(27);
    expect(lp).toBeLessThan(29);
    o.waermepumpe.lw = 64; // ≈ 36 dB(A)
    expect(evaluate(s, o).waermepumpe.status).toBe('ok'); // allgemein 40, Marge 3 → 36 ok
    s.gebiet = { value: 'rein', provenance: 'nutzerbestätigt' };
    expect(evaluate(s, o).waermepumpe.status).toBe('bad');
    s.gebiet = { value: 'misch', provenance: 'nutzerbestätigt' };
    expect(evaluate(s, o).waermepumpe.status).toBe('ok');
  });

  it('Aufstellung: frei, Wand, Ecke', () => {
    const s = square();
    s.buildings = [{ id: 'haus', own: true, footprint: [[10, -10], [20, -10], [20, -20], [10, -20]], provenance: 'amtlich' }];
    const fp = (c: Vec2) => footprint({ center: c, w: 0.45, d: 1, angle: 0 });
    expect(placement(s, fp([5, -15]))).toBe('frei');
    expect(placement(s, fp([20.3, -15]))).toBe('wand');
    expect(placement(s, fp([20.3, -9.4]))).toBe('ecke');
  });

  it('ohne Nachbarfenster: gelb und offen', () => {
    const r = evaluate(square(), objs()).waermepumpe;
    expect(r.status).toBe('warn');
    expect(r.rows.some((x) => x.kind === 'offen')).toBe(true);
  });

  it('angenommenes Fenster wird als Annahme ausgewiesen', () => {
    const s = square();
    s.windows = [{ pos: [8, -14], z: 1.6, provenance: 'Annahme' }];
    const r = evaluate(s, objs()).waermepumpe;
    expect(r.rows.some((x) => x.kind === 'Annahme' && x.text.startsWith('Fensterlage angenommen'))).toBe(true);
  });
});

describe('Herkunfts-Labels', () => {
  it('jede Zeile trägt ein Label', () => {
    const r = evaluate(demoSite(), demoObjects());
    for (const res of Object.values(r)) {
      for (const row of res.rows) expect(row.tag.length).toBeGreaterThan(0);
    }
  });

  it('echtes Grundstück: Grenze als nutzerbestätigt, Satzungshinweis offen', () => {
    const r = evaluate(square(), objs()).gartenhaus;
    expect(r.rows.some((x) => x.kind === 'nutzerbestätigt' && x.text.includes('Grundstücksgrenze'))).toBe(true);
    expect(r.rows.some((x) => x.kind === 'offen' && x.text.includes('Gemeindesatzungen'))).toBe(true);
    expect(r.rows.some((x) => x.kind === 'Demo')).toBe(false);
  });
});
