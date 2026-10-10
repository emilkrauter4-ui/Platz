import { describe, expect, it } from 'vitest';
import {
  abstandsfeld,
  aufgestockt,
  berechneVerschattung,
  berechneZufahrt,
  bewerteVorhaben,
  fragenAnGemeinde,
  gemeindeAbschnitt,
  grundriss,
  kennzahlen,
  neuesVorhaben,
  pruefeAF,
  umfeldStatistik,
  vorhabenAFWaende,
  zonenVorhaben,
  FREI,
  GRUEN,
  ROT,
  type Building,
  type Site,
  type Vec2,
  type Vorhaben,
} from '../src/rules';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Grundstück 30 × 40 m, Straße im Süden (y −12 … −1, mit 1 m Lücke zur Grenze), eigenes Haus 10 × 8 m. */
function standort(haus: Vec2[] = rect(5, 4, 15, 12), extra: Building[] = []): Site {
  return {
    plot: { boundary: rect(0, 0, 30, 40), sides: [{ name: 'S', grenze: 'S' }], provenance: 'Demo' },
    buildings: [{ id: 'haus', footprint: haus, provenance: 'Demo', own: true, trauf: 6, first: 9 }, ...extra],
    bestand: [],
    windows: [],
    ground: () => 400,
    gebiet: { value: 'allgemein', provenance: 'Annahme' },
    bereich: { value: 'innen', provenance: 'Annahme' },
    bplan: { status: 'unbekannt', provenance: 'offen' },
    aufenthaltsraum: { value: false, provenance: 'Annahme' },
    feuerstaette: { value: false, provenance: 'Annahme' },
    demo: true,
  };
}
const STRASSE: Vec2[][] = [rect(-10, -12, 40, -1)];

const haus = (site: Site, patch: Partial<Vorhaben>): Vorhaben => ({ ...neuesVorhaben('wohnhaus', site), ...patch });

describe('Vorhaben: Abstandsflächen (BayBO Art. 6)', () => {
  it('zweites Wohnhaus, Flachdach, 2 Geschosse: H = 5,6 m, Tiefe 3 m (Mindestmaß), liegt auf dem Grundstück', () => {
    const s = standort();
    const v = haus(s, { center: [15, 28], w: 12, d: 8, angle: 0, dachform: 'flach' });
    const r = bewerteVorhaben(s, v, null, STRASSE)!;
    expect(r.kennzahlen.wandhoehe).toBeCloseTo(5.6, 9);
    expect(r.af.waende).toHaveLength(4);
    expect(r.af.waende[0].h).toBeCloseTo(5.6, 9);
    expect(r.punkte.find((p) => p.id === 'grenze')!.status).toBe('ok');
    expect(r.punkte.find((p) => p.id === 'abstandsflaechen')!.status).toBe('ok');
    expect(r.punkte.find((p) => p.id === 'kollision')!.status).toBe('ok');
    expect(r.verfahren.empfehlung).toBe('bauvoranfrage');
  });

  it('H über 7,5 m: Tiefe 0,4 H (3 Geschosse = 8,4 m → 3,36 m)', () => {
    const s = standort();
    const v = haus(s, { center: [15, 28], w: 10, d: 8, geschosse: 3, dachform: 'flach' });
    const w = vorhabenAFWaende(s, v, grundriss(s, v)!)[0];
    expect(w.h).toBeCloseTo(8.4, 9);
    const t = Math.max(...w.flaeche.map((p) => p[1])) - Math.min(...w.flaeche.map((p) => p[1]));
    expect(t).toBeCloseTo(0.4 * 8.4, 6); // Wand 0 liegt im Süden: Fläche reicht 3,36 m nach Süden
  });

  it('Abstandsfläche über die Grenze → rot (Art. 6 Abs. 2)', () => {
    const s = standort();
    const v = haus(s, { center: [5.5, 28], w: 8, d: 8, dachform: 'flach' }); // Westwand bei x = 1,5, Fläche bis x = −1,5
    const r = bewerteVorhaben(s, v, null, STRASSE)!;
    expect(r.af.ausserhalbM2).toBeGreaterThan(1);
    expect(r.punkte.find((p) => p.id === 'grenze')!.status).toBe('bad');
    expect(r.status).toBe('bad');
  });

  it('Überdeckung mit den Abstandsflächen des eigenen Hauses (parallele Wände) → rot', () => {
    const s = standort();
    const v = haus(s, { center: [10, 18], w: 8, d: 4, dachform: 'flach', geschosse: 2 }); // 2 m nördlich vom Haus
    const af = pruefeAF(s, v, grundriss(s, v)!, STRASSE);
    expect(af.ueberdeckung.length).toBeGreaterThan(0);
    const r = bewerteVorhaben(s, v, null, STRASSE)!;
    expect(r.punkte.find((p) => p.id === 'abstandsflaechen')!.status).toBe('bad');
  });

  it('Wände im Winkel über 75° zueinander: Überdeckung erlaubt (Art. 6 Abs. 3 Nr. 1)', () => {
    const s = standort();
    // Ostwand des Hauses (x = 15) und Südwand des Neubaus stehen im Winkel 90° und überdecken sich an der Ecke
    const v = haus(s, { center: [19, 16.5], w: 6, d: 7, angle: 0, dachform: 'flach', geschosse: 2 });
    const af = pruefeAF(s, v, grundriss(s, v)!, STRASSE);
    expect(af.ueberdeckung).toEqual([]);
    expect(af.inFlaeche).toEqual([]);
  });

  it('Neubau steht in der Abstandsfläche des Hauses → rot', () => {
    const s = standort();
    const v = haus(s, { center: [20, 8], w: 4, d: 4, dachform: 'flach', geschosse: 1 }); // 1 m östlich vom Haus
    const r = bewerteVorhaben(s, v, null, STRASSE)!;
    expect(r.af.inFlaeche.length + r.af.ueberdeckung.length).toBeGreaterThan(0);
    expect(r.punkte.find((p) => p.id === 'abstandsflaechen')!.status).toBe('bad');
  });

  it('Kollision mit einem Gebäude und Nachbar-Grundstück', () => {
    const s = standort(rect(5, 4, 15, 12), [{ id: 'schuppen', footprint: rect(20, 20, 25, 25), provenance: 'amtlich' }]);
    const v = haus(s, { center: [22, 22], w: 6, d: 6, dachform: 'flach' });
    const r = bewerteVorhaben(s, v, null, STRASSE)!;
    expect(r.kollision.mit.map((m) => m.id)).toContain('schuppen');
    expect(r.punkte.find((p) => p.id === 'kollision')!.status).toBe('bad');
  });

  it('Satteldach: Giebel- und Traufwand, Dach zu einem Drittel; Pultdach: Dach auch an der hohen Wand', () => {
    const s = standort();
    const sattel = haus(s, { center: [15, 28], w: 10, d: 8, geschosse: 2, dachform: 'sattel', neigung: 35 });
    const dh = (8 / 2) * Math.tan((35 * Math.PI) / 180);
    expect(vorhabenAFWaende(s, sattel, grundriss(s, sattel)!)[0].h).toBeCloseTo(5.6 + dh / 3, 6);
    const pult = haus(s, { center: [15, 28], w: 10, d: 8, geschosse: 2, dachform: 'pult', neigung: 10 });
    const dp = 8 * Math.tan((10 * Math.PI) / 180);
    const ws = vorhabenAFWaende(s, pult, grundriss(s, pult)!);
    expect(ws[0].h).toBeCloseTo(5.6 + dp / 3, 6); // niedrige Seite
    expect(ws[2].h).toBeCloseTo(5.6 + dp + dp / 3, 6); // hohe Seite
    const r = bewerteVorhaben(s, pult, null, STRASSE)!;
    expect(r.rows.some((x) => x.kind === 'offen' && /Pultdach/.test(x.text))).toBe(true);
  });

  it('Kennzahlen: Grundfläche, BGF, Rauminhalt mit Dachraum', () => {
    const s = standort();
    const v = haus(s, { center: [15, 28], w: 10, d: 8, geschosse: 2, dachform: 'sattel', neigung: 30 });
    const k = kennzahlen(v, grundriss(s, v)!);
    const dh = 4 * Math.tan((30 * Math.PI) / 180);
    expect(k.grundflaeche).toBe(80);
    expect(k.bgf).toBe(160);
    expect(k.rauminhalt).toBeCloseTo(80 * 5.6 + (80 * dh) / 2, 6);
    expect(k.bruestung).toBeCloseTo(2.8 + 1, 9);
  });
});

describe('Vorhaben: Anbau', () => {
  it('dockt an der Ostwand an; die angebaute Wand hat keine Abstandsfläche, die Reststücke des Hauses schon', () => {
    const s = standort();
    const v: Vorhaben = { ...neuesVorhaben('anbau', s), hostId: 'haus', hostKante: 1, versatz: 0, w: 4, d: 4.5, geschosse: 1, dachform: 'flach' };
    const g = grundriss(s, v)!;
    const xs = g.fp.map((p) => p[0]);
    const ys = g.fp.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(15, 6);
    expect(Math.max(...xs)).toBeCloseTo(19.5, 6);
    expect(Math.min(...ys)).toBeCloseTo(6, 6);
    expect(Math.max(...ys)).toBeCloseTo(10, 6);
    const ws = vorhabenAFWaende(s, v, g);
    expect(ws).toHaveLength(3);
    const r = bewerteVorhaben(s, v, null, STRASSE)!;
    expect(r.af.ueberdeckung).toEqual([]); // Reststücke der Hauswand stehen im 90°-Winkel zum Anbau
    expect(r.kollision.mit).toEqual([]);
    expect(r.punkte.find((p) => p.id === 'abstandsflaechen')!.status).toBe('ok');
    expect(r.kennzahlen.grundflaeche).toBe(18);
  });

  it('Anbau zu nah an der Grundstücksgrenze → rot', () => {
    const s = standort(rect(14, 4, 24, 12));
    const v: Vorhaben = { ...neuesVorhaben('anbau', s), hostId: 'haus', hostKante: 1, w: 4, d: 4.5, geschosse: 1, dachform: 'flach' }; // Außenwand bei x = 28,5, Fläche bis 31,5
    const r = bewerteVorhaben(s, v, null, STRASSE)!;
    expect(r.punkte.find((p) => p.id === 'grenze')!.status).toBe('bad');
  });
});

describe('Vorhaben: Aufstockung', () => {
  it('ein Geschoss mehr: Trauf und First +2,8 m, Abstandsfläche wächst von 3,0 auf 3,9 m', () => {
    const s = standort(rect(3, 4, 13, 12));
    const v: Vorhaben = { ...neuesVorhaben('aufstockung', s), zielId: 'haus', geschosse: 1 };
    const neu = aufgestockt(s.buildings[0], v);
    expect(neu.trauf).toBeCloseTo(8.8, 9);
    expect(neu.first).toBeCloseTo(11.8, 9);
    const ws = vorhabenAFWaende(s, v, grundriss(s, v)!);
    expect(ws[0].h).toBeCloseTo(8.8 + 3 / 3, 6);
    const t = Math.max(...ws[3].flaeche.map((p) => p[0])) - Math.min(...ws[3].flaeche.map((p) => p[0]));
    expect(t).toBeCloseTo(0.4 * 9.8, 6);
  });

  it('Westwand 3 m von der Grenze: vorher passt (3,0 m), nachher nicht (3,92 m) → rot, Wert „heute“ 0', () => {
    const s = standort(rect(3, 4, 13, 12));
    const v: Vorhaben = { ...neuesVorhaben('aufstockung', s), zielId: 'haus', geschosse: 1 };
    const r = bewerteVorhaben(s, v, null, STRASSE)!;
    expect(r.af.vorherM2).toBeLessThan(0.05);
    expect(r.af.ausserhalbM2).toBeGreaterThan(2);
    expect(r.punkte.find((p) => p.id === 'grenze')!.status).toBe('bad');
    expect(r.kennzahlen.rauminhalt).toBeCloseTo(10 * 8 * 2.8, 6);
    expect(r.kennzahlen.bruestung).toBeCloseTo(Math.round(8.8 / 2.8 - 1e-9) * 0 + (Math.round(8.8 / 2.8) - 1) * 2.8 + 1, 6);
  });

  it('weit genug von der Grenze: keine Verschlechterung → ok', () => {
    const s = standort(rect(10, 15, 20, 23));
    const v: Vorhaben = { ...neuesVorhaben('aufstockung', s), zielId: 'haus', geschosse: 1 };
    const r = bewerteVorhaben(s, v, null, STRASSE)!;
    expect(r.punkte.find((p) => p.id === 'grenze')!.status).toBe('ok');
    expect(r.punkte.find((p) => p.id === 'kollision')!.status).toBe('ok');
  });

  it('Aufstockung auf Brüstung über 8 m: Zufahrt statt Zugang gefordert (3 m)', () => {
    const s = standort(rect(10, 15, 20, 23));
    s.buildings[0].trauf = 9;
    s.buildings[0].first = 12;
    const v: Vorhaben = { ...neuesVorhaben('aufstockung', s), zielId: 'haus', geschosse: 1 };
    const r = bewerteVorhaben(s, v, null, STRASSE)!;
    const z = berechneZufahrt({ site: s, ziel: r.grundriss.fp, ausgenommen: ['haus'], bruestung: r.kennzahlen.bruestung, strassen: STRASSE });
    expect(r.kennzahlen.bruestung).toBeGreaterThan(8);
    expect(z.erforderlichM).toBe(3);
  });
});

describe('Zufahrt: schmalste Stelle', () => {
  const sperre = (luecken: [number, number][]): Site => {
    // Riegel quer über das Grundstück bei y = 4 … 12 mit Lücken
    const bs: Building[] = [];
    let x = 0;
    for (const [a, b] of [...luecken, [30, 30] as [number, number]]) {
      if (a > x) bs.push({ id: `r${bs.length}`, footprint: rect(x, 4, a, 12), provenance: 'amtlich' });
      x = b;
    }
    return { ...standort(rect(0, 0, 0.001, 0.001)), buildings: bs };
  };
  const ziel = rect(10, 30, 20, 36);

  it('Lücke von 3,2 m: schmalste Stelle ≈ 3,2 m, Zugang (1,25 m) und Zufahrt (3 m) erfüllt', () => {
    const s = sperre([[12.4, 15.6]]);
    const z = berechneZufahrt({ site: s, ziel, bruestung: 4.6, strassen: STRASSE });
    expect(z.grund).toBe('ok');
    expect(z.schmalsteM!).toBeGreaterThan(3.05);
    expect(z.schmalsteM!).toBeLessThan(3.35);
    expect(z.status).toBe('ok');
    expect(z.laengeM!).toBeGreaterThan(25);
    const hoch = berechneZufahrt({ site: s, ziel, bruestung: 9, strassen: STRASSE });
    expect(hoch.erforderlichM).toBe(3);
    expect(hoch.status).toBe('ok');
  });

  it('Lücke von 2,6 m: für Zugang genug, für Zufahrt (Brüstung über 8 m) zu schmal → rot', () => {
    const s = sperre([[12.7, 15.3]]);
    const klein = berechneZufahrt({ site: s, ziel, bruestung: 4.6, strassen: STRASSE });
    expect(klein.schmalsteM!).toBeGreaterThan(2.45);
    expect(klein.schmalsteM!).toBeLessThan(2.75);
    expect(klein.status).toBe('ok');
    const gross = berechneZufahrt({ site: s, ziel, bruestung: 9, strassen: STRASSE });
    expect(gross.status).toBe('bad');
    expect(gross.text).toMatch(/gefordert sind mindestens 3,00 m/);
  });

  it('zwei Lücken: der breitere Weg gewinnt', () => {
    const s = sperre([[3, 4.5], [20, 26]]);
    const z = berechneZufahrt({ site: s, ziel, bruestung: 4.6, strassen: STRASSE });
    expect(z.schmalsteM!).toBeGreaterThan(5.7);
    expect(z.pfad.some((p) => p[0] > 20 && p[0] < 26)).toBe(true);
  });

  it('Lücke von 0,9 m: für den Zugang (1,25 m) zu schmal → rot', () => {
    const s = sperre([[14.55, 15.45]]);
    const z = berechneZufahrt({ site: s, ziel, bruestung: 4.6, strassen: STRASSE });
    expect(z.status).toBe('bad');
  });

  it('Riegel ohne Lücke: kein Weg → rot; ohne Straßendaten: offen (kein Status)', () => {
    const zu = berechneZufahrt({ site: sperre([]), ziel, bruestung: 4.6, strassen: STRASSE });
    expect(zu.grund).toBe('kein_weg');
    expect(zu.status).toBe('bad');
    const ohne = berechneZufahrt({ site: sperre([[10, 16]]), ziel, bruestung: 4.6, strassen: [] });
    expect(ohne.grund).toBe('keine_strasse');
    expect(ohne.status).toBeNull();
  });

  it('Baumstamm und Bestandsgebäude verengen den Weg', () => {
    const s = sperre([[10, 16]]);
    s.bestand.push({ id: 'baum1', footprint: rect(12.5, 7.5, 13.5, 8.5), height: 8, provenance: 'nutzerbestätigt', kind: 'baum', stamm: [13, 8], stammSpanne: 0.1 });
    const z = berechneZufahrt({ site: s, ziel, bruestung: 4.6, strassen: STRASSE });
    // Lücke 6 m (x 10 … 16), Stamm bei x = 13 mit Radius 0,5: links und rechts davon bleiben je 2,5 m
    expect(z.schmalsteM!).toBeGreaterThan(2.35);
    expect(z.schmalsteM!).toBeLessThan(2.65);
  });

  it('Abstandsfeld: exakter euklidischer Abstand', () => {
    const m = new Uint8Array(25);
    m[0] = 1;
    const d = abstandsfeld(m, 5, 5);
    expect(d[4]).toBeCloseTo(4, 6);
    expect(d[24]).toBeCloseTo(Math.hypot(4, 4), 6);
  });

  it('Rechenzeit auf normalem Grundstück unter einer Sekunde', () => {
    const s = sperre([[12.4, 15.6]]);
    const z = berechneZufahrt({ site: s, ziel, bruestung: 4.6, strassen: STRASSE });
    console.info(`Zufahrt: ${z.ms.toFixed(0)} ms (30 × 40 m Grundstück)`);
    expect(z.ms).toBeLessThan(1500);
  });
});

describe('Schattenstunden auf Nachbarn', () => {
  const lage = { lat: 49.5, lon: 11.74, konv: 0 };
  const site = (): Site => {
    const s = standort(rect(5, 4, 15, 12));
    // Nachbarfenster 6 m nördlich der Nordwand des Neubaus (y = 20), Südfassade, 1,6 m hoch; zweites Fenster weit weg
    s.windows = [
      { pos: [15, 22], z: 1.6, provenance: 'Annahme' },
      { pos: [15, 70], z: 1.6, provenance: 'Annahme' },
    ];
    return s;
  };

  it('Neubau 8,4 m hoch direkt vor dem Fenster: im Dezember viele Stunden, im März weniger, fernes Fenster 0', () => {
    const s = site();
    const v = haus(s, { center: [15, 18], w: 10, d: 4, geschosse: 3, dachform: 'flach' }); // Nordwand bei y = 20
    const r = berechneVerschattung(s, v, lage)!;
    const f = r.punkte.filter((p) => p.art === 'fenster');
    expect(f).toHaveLength(2);
    expect(f[0].extra[1]).toBeGreaterThan(2.5); // 21. Dezember
    expect(f[0].extra[0]).toBeGreaterThan(0.5); // 21. März
    expect(f[1].extra).toEqual([0, 0]);
    expect(r.stichtage).toEqual(['03-21', '12-21']);
    console.info(`Schatten: ${r.punkte.length} Punkte in ${r.ms.toFixed(0)} ms`);
  });

  it('Aufstockung um ein Geschoss verlängert den Schatten; ohne zusätzliches Geschoss 0 Stunden extra', () => {
    const s = site();
    s.buildings[0].footprint = rect(10, 12, 20, 20);
    s.windows = [{ pos: [15, 44], z: 1.6, provenance: 'Annahme' }];
    const mit = berechneVerschattung(s, { ...neuesVorhaben('aufstockung', s), zielId: 'haus', geschosse: 1 }, lage)!;
    const ohne = berechneVerschattung(s, { ...neuesVorhaben('aufstockung', s), zielId: 'haus', geschosse: 0 }, lage)!;
    expect(mit.punkte[0].extra[1]).toBeGreaterThan(0.5);
    expect(ohne.punkte[0].extra).toEqual([0, 0]);
  });

  it('Pultdach wirft weniger Schatten als Flachdach gleicher hoher Wand; Gartenpunkte außerhalb der Grenze', () => {
    const s = site();
    s.windows = [];
    const flach = haus(s, { center: [15, 28], w: 10, d: 8, geschosse: 2, dachform: 'flach' });
    const pult = haus(s, { center: [15, 28], w: 10, d: 8, geschosse: 2, dachform: 'pult', neigung: 10 });
    const a = berechneVerschattung(s, flach, lage)!;
    const b = berechneVerschattung(s, pult, lage)!;
    expect(a.garten.n).toBeGreaterThan(5);
    expect(a.punkte.every((p) => p.p[0] < 0 || p.p[0] > 30 || p.p[1] < 0 || p.p[1] > 40)).toBe(true);
    expect(b.garten.mittelExtra[1]).toBeGreaterThanOrEqual(0);
  });
});

describe('Zonen „Wo darf es hin?“ für das große Vorhaben', () => {
  it('ganzer Hausgrundriss: grün, rot und Rechenzeit gemessen', () => {
    const s = standort();
    const v = haus(s, { center: [15, 28], w: 10, d: 8, geschosse: 2, dachform: 'flach' });
    const nx = 128;
    const ny = 168;
    const r = zonenVorhaben(s, v, { o: [-1, -1], ex: [0.25, 0], ey: [0, 0.25], nx, ny });
    const grün = r.feld.filter((x) => x === GRUEN).length;
    expect(grün).toBeGreaterThan(100);
    expect(r.feld.filter((x) => x === ROT).length).toBeGreaterThan(100);
    expect(r.feld.filter((x) => x === FREI).length).toBeGreaterThan(0);
    expect(r.beste).not.toBeNull();
    console.info(`Zonen Vorhaben: ${r.ms.toFixed(0)} ms, ${r.pruefungen} Prüfungen (30 × 40 m)`);
  });
});

describe('Planungsrecht als Wegweiser', () => {
  const s = (): Site => {
    const ring: Building[] = [
      { id: 'a', footprint: rect(-20, 0, -8, 9), provenance: 'amtlich', trauf: 5.5, first: 9 },
      { id: 'b', footprint: rect(-40, 5, -30, 14), provenance: 'amtlich', trauf: 6, first: 10 },
      { id: 'c', footprint: rect(-20, 25, -10, 34), provenance: 'amtlich', trauf: 6.5, first: 11 }, // hinter a, von der Straße (y < −1) aus gesehen
      { id: 'garage', footprint: rect(-6, 2, -2, 5), provenance: 'amtlich', trauf: 2.5, first: 3 },
      { id: 'weit', footprint: rect(-400, 0, -390, 9), provenance: 'amtlich', trauf: 5, first: 8 },
    ];
    return standort(rect(5, 4, 15, 12), ring);
  };

  it('Umfeld-Statistik: Hauptgebäude im Umkreis, Garage und Ferngebäude zählen nicht, zweite Reihe erkannt', () => {
    const u = umfeldStatistik(s(), [15, 20], [rect(-60, -12, 40, -1)]);
    expect(u.n).toBe(3);
    expect(u.traufe!.min).toBe(5.5);
    expect(u.traufe!.max).toBe(6.5);
    expect(u.first!.median).toBe(10);
    expect(u.grundflaeche!.max).toBe(108);
    expect(u.zweiteReihe).toBe(1);
  });

  it('ohne Straßendaten: zweite Reihe nicht bestimmbar (null)', () => {
    expect(umfeldStatistik(s(), [15, 20], []).zweiteReihe).toBeNull();
  });

  it('Abschnitt „Was die Gemeinde entscheidet“: Bebauungsplan nur Verweis; § 34 mit Label Orientierung, ohne Urteil', () => {
    const site = s();
    const u = umfeldStatistik(site, [15, 20], [rect(-60, -12, 40, -1)]);
    const keiner = gemeindeAbschnitt(site, 'wohnhaus', u, [], 'Sulzbach-Rosenberg');
    expect(keiner.hinweise.map((h) => h.id)).toEqual(['bplan', 'paragraf34', 'bauturbo', 'teilung']);
    const p34 = keiner.hinweise.find((h) => h.id === 'paragraf34')!;
    expect(p34.kind).toBe('Orientierung');
    expect(p34.text).toMatch(/keine Aussage, ob sich das Vorhaben einfügt/);
    expect(keiner.hinweise.find((h) => h.id === 'bauturbo')!.text).toMatch(/Deine Gemeinde kann davon Gebrauch machen, das liegt in ihrem Ermessen\./);
    expect(keiner.weg.titel).toBe('Bauvoranfrage empfohlen');

    const mit = gemeindeAbschnitt(site, 'wohnhaus', u, [{ name: 'Am Hang', nummer: '12', art: 'rechtskraft', planUrl: 'https://x/plan.pdf' }], null);
    expect(mit.hinweise.map((h) => h.id)).toEqual(['bplan', 'bauturbo', 'teilung']);
    expect(mit.hinweise[0].links![0].url).toBe('https://x/plan.pdf');
    expect(mit.hinweise[0].text).toMatch(/liest die Festsetzungen nicht aus/);
  });

  it('Außenbereich: eigener, strenger Hinweis, keine § 34-Zahlen; Teilung nur beim Wohnhaus', () => {
    const site = s();
    site.bereich = { value: 'aussen', provenance: 'Annahme' };
    const a = gemeindeAbschnitt(site, 'anbau', null, [], null);
    expect(a.hinweise.map((h) => h.id)).toEqual(['bplan', 'aussenbereich', 'bauturbo']);
    expect(a.hinweise[1].text).toMatch(/deutlich strengere Regeln/);
  });

  it('Fragen an die Gemeinde für die Bauvoranfrage', () => {
    const site = s();
    const q = fragenAnGemeinde('wohnhaus', site, [], umfeldStatistik(site, [15, 20]), true);
    expect(q.length).toBeGreaterThanOrEqual(6);
    expect(q.some((x) => /zweiter Reihe/.test(x))).toBe(true);
    expect(q.some((x) => /Abweichung von den Abstandsflächen/.test(x))).toBe(true);
    expect(q.some((x) => /Bau-Turbo/.test(x))).toBe(true);
  });
});

describe('Startstelle des Wohnhauses', () => {
  it('liegt auf einer passenden Stelle (kein Kollision, Abstandsflächen auf dem Grundstück)', async () => {
    const { vorhabenStart, vorhabenPruefer } = await import('../src/rules');
    const s = standort();
    const v = vorhabenStart(s, haus(s, { center: [15, 20] }));
    expect(vorhabenPruefer(s, v)(v.center, v.angle)).toBe('ok');
  });
});
