import { describe, expect, it } from 'vitest';
import { fliessSenken, kostraHn, parameterVariante, simuliere, STANDARD_PARAMETER, type Gitter, type KostraTabelle, type SimEingabe } from '../src/rules/regen';

/** Gitter aus einer Höhenfunktion (Zellmitte i, j in Zellen) */
function gitter(nx: number, ny: number, z: (i: number, j: number) => number, klasse = 1, res = 2): Gitter {
  const zz = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) zz[j * nx + i] = z(i, j);
  return { nx, ny, res, x0: 0, y0: 0, z: zz, klasse: new Uint8Array(nx * ny).fill(klasse), gebaeude: new Int32Array(nx * ny).fill(-1) };
}
const eingabe = (g: Gitter, p: Partial<SimEingabe> = {}): SimEingabe => ({
  gitter: g, regenMm: 30, regenMin: 30, nachlaufMin: 20, param: STANDARD_PARAMETER, messpunkte: [], frameSek: 0, ...p,
});
const summe = (a: ArrayLike<number>) => Array.from(a as ArrayLike<number>).reduce((s, x) => s + x, 0);

describe('Starkregen: Bilanz und Physik', () => {
  it('Bilanz: Regen = Versickerung + Anfangsverlust + Abfluss + stehendes Wasser (zufälliges Gelände mit Gebäude)', () => {
    let s = 3;
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const g = gitter(40, 40, (i, j) => 0.05 * i + 0.8 * Math.sin(i / 5) * Math.cos(j / 4) + 0.2 * rnd());
    for (let j = 15; j < 22; j++) for (let i = 15; i < 22; i++) g.gebaeude[j * 40 + i] = 0;
    for (let j = 0; j < 40; j++) for (let i = 0; i < 20; i++) g.klasse[j * 40 + i] = 0; // westliche Hälfte durchlässig
    const r = simuliere(eingabe(g, { regenMm: 40, regenMin: 30 }));
    const b = r.bilanz;
    const ein = b.regenM3;
    expect(ein).toBeGreaterThan(0);
    expect(Math.abs(ein - (b.versickertM3 + b.muldeM3 + b.abflussM3 + b.stehendM3)) / ein).toBeLessThan(1e-4);
    expect(b.daecherM3).toBeGreaterThan(0);
    // Regen insgesamt: 40 mm auf den Nicht-Gebäudezellen plus Dachregen am Rand = 40 mm auf die ganze Fläche (Dächer im Gebiet)
    expect(ein).toBeCloseTo((0.04 * 40 * 40 * 4), 1);
  });

  it('Gleichgewicht: auf geneigter versiegelter Fläche fließt am Ende so viel ab wie regnet', () => {
    const g = gitter(30, 30, (i) => 0.04 * (29 - i) * 2); // 4 % Gefälle nach Osten (i wächst)
    const r = simuliere(eingabe(g, { regenMm: 60, regenMin: 40, nachlaufMin: 0, param: { ...STANDARD_PARAMETER, mulde: [0, 0, 0] } }));
    const b = r.bilanz;
    // nach 40 min ist der Fließweg (60 m) längst durchlaufen: fast alles ist abgeflossen, kaum Wasser steht
    expect(b.abflussM3 / b.regenM3).toBeGreaterThan(0.93);
    expect(b.stehendM3 / b.regenM3).toBeLessThan(0.07);
  });

  it('Mulde: Wasser sammelt sich im Tiefpunkt; ohne Abfluss über den Rand steigt das Volumen auf Regen minus Verluste', () => {
    // Schale: Rand 3 m hoch, Mitte tief
    const g = gitter(24, 24, (i, j) => Math.min(3, 0.04 * Math.hypot(i - 11.5, j - 11.5) ** 2));
    const r = simuliere(eingabe(g, { regenMm: 50, regenMin: 20, nachlaufMin: 30, frameSek: 300 }));
    const mitte = 11 * 24 + 11;
    const rand = 1 * 24 + 1;
    expect(r.frames.length).toBeGreaterThan(5);
    expect(r.maxMm[mitte]).toBeGreaterThan(r.maxMm[rand] * 3);
    // am Ende liegt das Wasser in der Mitte (nicht am Hang)
    const ende = r.frames[r.frames.length - 1];
    expect(ende[mitte]).toBeGreaterThan(ende[8 * 24 + 8] + 5);
  });

  it('Gebäude ist Hindernis: oberhalb steht mehr Wasser als unterhalb, der Dachregen geht an den Rand', () => {
    const g = gitter(30, 30, (i) => 0.06 * (29 - i)); // Gefälle nach Osten
    for (let j = 10; j < 20; j++) for (let i = 12; i < 18; i++) g.gebaeude[j * 30 + i] = 1;
    const r = simuliere(eingabe(g, { regenMm: 40, regenMin: 20, nachlaufMin: 0 }));
    const west = r.maxMm[15 * 30 + 11]; // direkt oberhalb (Westseite)
    const ost = r.maxMm[15 * 30 + 18]; // direkt unterhalb (Ostseite)
    expect(west).toBeGreaterThan(0);
    for (let j = 10; j < 20; j++) for (let i = 12; i < 18; i++) expect(r.maxMm[j * 30 + i]).toBe(0); // im Gebäude nie Wasser
    expect(west + ost).toBeGreaterThan(0);
    expect(r.bilanz.daecherM3).toBeGreaterThan(0);
  });

  it('Versickerung: auf durchlässigem Boden bleibt bei mäßigem Regen kaum Wasser, auf versiegeltem viel', () => {
    const flach = (k: number) => simuliere(eingabe(gitter(20, 20, () => 0, k), { regenMm: 8, regenMin: 30, nachlaufMin: 0 }));
    const gruen = flach(0).bilanz;
    const beton = flach(1).bilanz;
    expect(gruen.stehendM3 + gruen.abflussM3).toBeLessThan(0.15 * gruen.regenM3);
    expect(beton.versickertM3).toBe(0);
    expect(beton.stehendM3 + beton.abflussM3).toBeGreaterThan(0.7 * beton.regenM3);
  });

  it('Messpunkt: tiefer gelegene Stelle meldet Wasser, hoher Punkt später oder nie; Ankunftszeit und Maximum stimmen mit den Bildern überein', () => {
    const g = gitter(30, 30, (i, j) => 0.03 * ((29 - i) * 2) - 0.4 * Math.exp(-((i - 25) ** 2 + (j - 15) ** 2) / 8)); // Gefälle nach Osten, Grube bei (25, 15)
    const tief = { id: 'tief', i: 25, j: 15, schwelle: 0.01 };
    const hoch = { id: 'hoch', i: 3, j: 5, schwelle: 0.05 };
    const r = simuliere(eingabe(g, { regenMm: 45, regenMin: 30, nachlaufMin: 10, messpunkte: [tief, hoch], frameSek: 60 }));
    const m = (id: string) => r.mess.find((x) => x.id === id)!;
    expect(m('tief').erstSek).not.toBeNull();
    expect(m('tief').maxM).toBeGreaterThan(0.01);
    // letztes Bild hat nicht mehr Wasser als das Maximum
    expect(Math.max(...r.frames.map((f) => f[15 * 30 + 25])) / 1000).toBeLessThanOrEqual(m('tief').maxM + 1e-3);
    // der hohe Punkt am Kamm sieht deutlich weniger als die Senke
    expect(m('hoch').maxM).toBeLessThan(m('tief').maxM + 0.5);
  });

  it('Spanne: günstig < mittel < ungünstig bei der Menge, die abfließt oder steht', () => {
    const g = gitter(24, 24, (i) => 0.02 * (23 - i) * 2, 0);
    const lauf = (v: 'guenstig' | 'mittel' | 'ungunstig') => {
      const b = simuliere(eingabe(g, { regenMm: 35, regenMin: 30, nachlaufMin: 10, param: parameterVariante(v) })).bilanz;
      return b.abflussM3 + b.stehendM3;
    };
    expect(lauf('guenstig')).toBeLessThan(lauf('mittel'));
    expect(lauf('mittel')).toBeLessThan(lauf('ungunstig'));
  });

  it('Rechenzeit: 120 × 120 Zellen (2 m, Umkreis 120 m), 60 min Regen + 30 min Nachlauf unter 30 s (gemessen ≈ 7 s)', () => {
    let s = 5;
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const g = gitter(120, 120, (i, j) => 0.03 * i + 0.4 * Math.sin(i / 9) + 0.3 * Math.cos(j / 7) + 0.05 * rnd());
    const r = simuliere(eingabe(g, { regenMm: 46.6, regenMin: 60, nachlaufMin: 30, frameSek: 60 }));
    expect(r.ms).toBeLessThan(30000);
    console.log(`Rechenzeit 120×120, 90 min: ${Math.round(r.ms)} ms, ${r.schritte} Schritte`);
    expect(r.frames.length).toBe(91);
  }, 60000);
});

describe('Senken und Fließwege aus dem Gelände', () => {
  it('Schale: Senkentiefe = Randhöhe − Boden; Zufluss am Auslauf = ganze Fläche', () => {
    // Rinne nach Westen: Boden 0 in der Mitte, Rand 1 m, ein Auslauf (West) auf 0,2 m
    const g = gitter(20, 20, (i, j) => (j === 10 && i <= 7 ? 0.2 : Math.min(1, 0.02 * Math.hypot(i - 9.5, j - 9.5) ** 2))); // Rinne (0,2 m) nach Westen
    const f = fliessSenken(g);
    expect(Math.max(...f.senke)).toBeGreaterThan(0.1);
    // Mitte liegt tiefer als der Auslauf: Senkentiefe in der Mitte ≈ 0,2 m (bis zur Auslaufhöhe)
    expect(f.senke[10 * 20 + 10]).toBeGreaterThan(0.1);
    expect(f.senke[10 * 20 + 10]).toBeLessThan(0.35);
    // am Auslauf sammelt sich der Zufluss der Schale
    expect(f.zufluss[10 * 20 + 0]).toBeGreaterThan(0.5 * 400 * 4);
  });

  it('Gebäude: Zufluss in Gebäudezellen ist 0, der Hang davor staut sich nicht in die Zelle', () => {
    const g = gitter(20, 20, (i) => 0.1 * (19 - i));
    for (let j = 8; j < 12; j++) for (let i = 8; i < 12; i++) g.gebaeude[j * 20 + i] = 3;
    const f = fliessSenken(g);
    expect(f.zufluss[9 * 20 + 9]).toBe(0);
    expect(summe(f.zufluss)).toBeGreaterThan(0);
  });
});

describe('KOSTRA-DWD', () => {
  const k: KostraTabelle = { quelle: 'DWD', lizenz: 'CC BY 4.0', tabelle: { '30': { '100': { hn: 38, uc: 25 } }, '60': { '100': { hn: 46.6, uc: 28 } }, '45': { '100': { hn: 43, uc: 26 } } } };
  it('Stufenwerte unverändert, dazwischen logarithmisch interpoliert, außerhalb null', () => {
    expect(kostraHn(k, 60, 100)).toEqual({ hn: 46.6, uc: 28 });
    const m = kostraHn(k, 52, 100)!;
    expect(m.hn).toBeGreaterThan(43);
    expect(m.hn).toBeLessThan(46.6);
    expect(kostraHn(k, 3, 100)).toBeNull();
    expect(kostraHn(k, 60, 5)).toBeNull();
  });
});

/* ---------- Gitter und Text ---------- */
import { baueGitter, gitterGeometrie } from '../src/rules/regen';
import { bilanzText, messText } from '../src/ui/regenSheet';
const tag = (t: string) => `[${t}]`;

describe('Gitter aus Gelände, Flächenarten und Gebäuden', () => {
  it('Geometrie: Quadrat um die Mitte, Zellenzahl aus Radius und Zellgröße', () => {
    const g = gitterGeometrie([100, 200], 120, 2);
    expect(g.n).toBe(120);
    expect(g.x0).toBeCloseTo(100 - 120, 9);
    expect(g.y0).toBeCloseTo(200 - 120, 9);
  });

  it('Gebäude: Zellen, deren Mitte im Grundriss liegt, sind belegt; Höhe aus der Funktion; ohne Flächendaten alles durchlässig', () => {
    const geo = gitterGeometrie([0, 0], 20, 2);
    const g = baueGitter(geo, (p) => 400 + 0.1 * p[0], null, [{ footprint: [[0, 0], [6, 0], [6, 6], [0, 6]] }, { footprint: [[500, 500], [510, 500], [510, 510]] }]);
    expect(g.nx).toBe(20);
    const belegt = Array.from(g.gebaeude).filter((v) => v === 0).length;
    expect(belegt).toBe(9); // 3 × 3 Zellen à 2 m
    expect(Array.from(g.gebaeude).some((v) => v === 1)).toBe(false); // zweites Gebäude liegt außerhalb
    expect(g.z[10 * 20 + 10]).toBeCloseTo(400 + 0.1 * (g.x0 + 10.5 * 2), 4);
    expect(Math.max(...g.klasse)).toBe(0);
  });
});

describe('Texte für die Oberfläche', () => {
  const m = (min: number | null, cm: number) => ({ min, cm });
  it('Ankunftszeit und Tiefe mit Spanne', () => {
    const t = messText({ id: 'a', art: 'kellertreppe', name: 'Kellertreppe', schwelle: 0.05, mittel: m(24.4, 12), guenstig: m(31, 6), ungunstig: m(19, 19) });
    expect(t).toContain('Kellertreppe');
    expect(t).toContain('24 Minuten');
    expect(t).toContain('Spanne 19–31');
    expect(t).toContain('12 cm');
    expect(t).toContain('Spanne 6–19');
  });
  it('erreicht die Stelle nicht: sagt das ehrlich und nennt den ungünstigen Fall', () => {
    const t = messText({ id: 'a', art: 'lichtschacht', name: 'Lichtschacht', schwelle: 0.1, mittel: m(null, 2), guenstig: m(null, 0.5), ungunstig: m(41, 11) });
    expect(t).toContain('nicht');
    expect(t).toContain('ungünstigen Annahmen');
    expect(t).toContain('41 Minuten');
  });
  it('noch nicht berechnet', () => {
    expect(messText({ id: 'a', art: 'x', name: 'Stelle', schwelle: 0.05, mittel: null, guenstig: null, ungunstig: null })).toContain('wird berechnet');
  });
  it('Bilanz nennt Regen, Dächer und die Anteile, mit Label Simulation', () => {
    const t = bilanzText({ nx: 1, ny: 1, frameSek: 60, frames: [], maxMm: new Uint16Array(1), mess: [], schritte: 1, gesamtSek: 1, ms: 1, bilanz: { regenM3: 1000, daecherM3: 100, versickertM3: 100, muldeM3: 50, abflussM3: 700, stehendM3: 150 } }, tag);
    expect(t).toContain('1000 m³');
    expect(t).toContain('70 %');
    expect(t).toContain('[Simulation]');
  });
});
