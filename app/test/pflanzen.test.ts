import { describe, expect, it } from 'vitest';
import {
  alterText, bestandsPflanzen, GELB, GRUEN, maxHoehe, noetigerAbstand, pflanzenText, pflanzLinie, pflanzZonen, pruefePflanze, ROT,
  type Bestand, type Pflanze, type Site, type Vec2,
} from '../src/rules';
import { fromRec } from '../src/site/bestand';

/** Quadrat 20 × 20 m, Seiten: 0 Süd, 1 Ost, 2 Nord, 3 West. */
function site(bestand: Bestand[] = [], boundary: Vec2[] = [[0, 0], [20, 0], [20, 20], [0, 20]]): Site {
  return {
    plot: {
      boundary,
      segmentSide: boundary.map((_, i) => i),
      sides: boundary.map((_, i) => ({ name: `Seite ${i}`, grenze: `an der Grenze ${i}` })),
      provenance: 'nutzerbestätigt',
    },
    buildings: [],
    bestand,
    windows: [],
    gebiet: { value: 'allgemein', provenance: 'Annahme' },
    bereich: { value: 'innen', provenance: 'Annahme' },
    bplan: { status: 'unbekannt', provenance: 'offen' },
    aufenthaltsraum: { value: false, provenance: 'Annahme' },
    feuerstaette: { value: false, provenance: 'Annahme' },
  };
}

const hecke = (y: number, hoehe: number, angle = 0, laenge = 6): Pflanze => ({ art: 'hecke', center: [10, y], laenge, angle, hoehe });
const baum = (p: Vec2, hoehe: number): Pflanze => ({ art: 'baum', center: p, laenge: 0, angle: 0, hoehe });

describe('Grenzabstand von Pflanzen (AGBGB Art. 47)', () => {
  it('Grenzwerte: bis einschließlich 2 m Höhe 0,50 m, darüber 2 m', () => {
    expect(noetigerAbstand(1.8)).toBe(0.5);
    expect(noetigerAbstand(2.0)).toBe(0.5); // „über 2 m hoch“: genau 2,00 m noch nicht
    expect(noetigerAbstand(2.01)).toBe(2);
    expect(noetigerAbstand(12, true)).toBe(0.5); // Waldgrundstück, Art. 47 Abs. 2
  });

  it('zulässige Höhe je Abstand, Grenzfälle genau 0,50 m und genau 2,00 m', () => {
    expect(maxHoehe(0.49)).toBe(0);
    expect(maxHoehe(0.5)).toBe(2);
    expect(maxHoehe(1.99)).toBe(2);
    expect(maxHoehe(2.0)).toBe(Infinity);
  });

  it('Hecke 1,8 m, 0,50 m von der Grenze: passt (knapp), bis 2 m', () => {
    const r = pruefePflanze(site(), hecke(0.5, 1.8));
    expect(r.status).toBe('warn');
    expect(r.maxHoehe).toBe(2);
    expect(r.head).toContain('höchstens 2,0 m');
    expect(r.dim!.label).toBe('0,50 m');
  });

  it('Hecke 0,40 m von der Grenze: zu nah', () => {
    const r = pruefePflanze(site(), hecke(0.4, 1.5));
    expect(r.status).toBe('bad');
    expect(r.head).toBe('Zu nah an der Grenze: 0,40 m.');
    expect(r.sub).toContain('0,50 m');
  });

  it('Hecke 2,5 m hoch bei 1,2 m Abstand: zu hoch, hier bis 2 m', () => {
    const r = pruefePflanze(site(), hecke(1.2, 2.5));
    expect(r.status).toBe('bad');
    expect(r.head).toBe('Zu hoch für diese Stelle: hier bis 2,0 m hoch.');
  });

  it('Baum 8 m, Stamm genau 2,00 m von der Grenze: passt, beliebig hoch', () => {
    const r = pruefePflanze(site(), baum([10, 2], 8));
    expect(r.status).toBe('warn'); // genau auf dem Wert: knapp
    expect(r.maxHoehe).toBe(Infinity);
    expect(r.rows.some((x) => x.text.includes('Art. 48'))).toBe(true);
  });

  it('schräge Hecke: der grenznächste Punkt der Pflanzreihe zählt', () => {
    // 6 m lang, 30° gedreht, Mitte 3 m von der Südgrenze → Ende bei 3 − 1,5 = 1,5 m
    const p = hecke(3, 1.8, Math.PI / 6);
    const [a, b] = pflanzLinie(p);
    expect(Math.min(a[1], b[1])).toBeCloseTo(1.5, 9);
    const r = pruefePflanze(site(), p);
    expect(r.seiten[0].abstand).toBeCloseTo(1.5, 9);
    expect(r.status).toBe('ok');
  });

  it('schräge Grundstücksgrenze: Abstand senkrecht zur Grenze', () => {
    const s = site([], [[0, 0], [20, 0], [20, 20], [0, 10]]); // Nordgrenze schräg
    // Punkt (10, 13): Abstand zur Strecke (20,20)→(0,10) = |…| / √(500) → 2/√5 ≈ 0,894 · 2 = 1,79 m
    const r = pruefePflanze(s, baum([10, 13], 5));
    const nord = r.seiten.find((x) => x.seite === 2)!;
    expect(nord.abstand).toBeCloseTo(2 / Math.sqrt(1.25), 6);
    expect(r.status).toBe('bad');
  });

  it('Straßenseite (Art. 50 Abs. 1 Satz 2) zählt nicht', () => {
    const r = pruefePflanze(site(), hecke(0.2, 1.5), [{ strasse: { value: true, provenance: 'nutzerbestätigt' } }]);
    expect(r.seiten.find((x) => x.seite === 0)!.ausnahme).toBe('strasse');
    expect(r.status).toBe('ok');
  });

  it('hinter 1,8 m Mauer: Hecke 1,8 m ausgenommen (offen), 2,5 m nicht', () => {
    const mauer = [{ einfriedung: { value: 1.8, provenance: 'nutzerbestätigt' as const } }];
    const a = pruefePflanze(site(), hecke(0.3, 1.8), mauer);
    expect(a.status).toBe('ok');
    expect(a.rows.some((x) => x.kind === 'offen' && x.text.includes('erheblich'))).toBe(true);
    expect(pruefePflanze(site(), hecke(0.3, 2.5), mauer).status).toBe('bad');
  });

  it('außerhalb des Grundstücks: passt nicht', () => {
    expect(pruefePflanze(site(), baum([25, 5], 3)).status).toBe('bad');
  });

  it('Pflanzzonen: rot unter 0,50 m, gelb bis 2 m, grün dahinter; Straßenseite frei', () => {
    const g = { o: [0, 0] as Vec2, ex: [0.25, 0] as Vec2, ey: [0, 0.25] as Vec2, nx: 80, ny: 80 };
    const f = pflanzZonen(site(), [], g);
    const at = (x: number, y: number) => f[(g.ny - 1 - Math.floor(y / 0.25)) * g.nx + Math.floor(x / 0.25)];
    expect(at(10, 0.3)).toBe(ROT);
    expect(at(10, 1.0)).toBe(GELB);
    expect(at(10, 5)).toBe(GRUEN);
    const f2 = pflanzZonen(site(), [{ strasse: { value: true, provenance: 'nutzerbestätigt' } }], g);
    expect(f2[(g.ny - 1 - 1) * g.nx + 40]).toBe(GRUEN); // y = 0,375 an der Straßenseite
  });
});

describe('Pflanzen im Bestand: sachlich, mit Spanne', () => {
  const baumRec = (st: Vec2, ss: number, h: number, fp: Vec2[]): Bestand => ({
    ...fromRec({ id: 'B1', k: 'baum', fp, h, sh: 0.4, a: 20, conf: 1, b: 6 }), stamm: st, stammSpanne: ss,
  });
  const krone: Vec2[] = [[18, 8], [24, 8], [24, 14], [18, 14]];

  it('Nachbarbaum, Stamm angetippt 1,2 m (±0,3) von der Ostgrenze: liegt darunter, neutraler Text', () => {
    const s = site([baumRec([21.2, 11], 0.3, 11.8, krone)]);
    const [x] = bestandsPflanzen(s);
    expect(x.eigen).toBe(false);
    expect(x.abstand).toBeCloseTo(1.2, 9);
    expect(x.noetig).toBe(2);
    expect(x.vergleich).toBe('darunter');
    expect(x.provenance).toBe('nutzerbestätigt');
    const t = pflanzenText(s, x);
    expect(t).toContain('Stamm etwa 1,2 m (±0,3 m)');
    expect(t).not.toMatch(/Anspruch|verlangen|muss|illegal|Verstoß/);
  });

  it('Spanne überdeckt den Wert: nicht eindeutig', () => {
    const s = site([baumRec([21.9, 11], 0.3, 11.8, krone)]);
    expect(bestandsPflanzen(s)[0].vergleich).toBe('unklar');
  });

  it('Höhe um 2 m mit Spanne: nicht eindeutig, wenn nur die kleinere Höhe den Abstand erfüllt', () => {
    const s = site([{ ...fromRec({ id: 'S', k: 'strauch', fp: [[20.5, 5], [21.5, 5], [21.5, 6], [20.5, 6]], h: 2.2, sh: 0.4, a: 1, conf: 1 }), stamm: [21, 5.5], stammSpanne: 0.25 }]);
    const [x] = bestandsPflanzen(s);
    expect(x.abstand).toBeCloseTo(1, 9);
    expect(x.vergleich).toBe('unklar');
  });

  it('ohne angetippten Stamm: Kronenmitte, Spanne halber Ersatzradius', () => {
    const s = site([fromRec({ id: 'B2', k: 'baum', fp: krone, h: 9, a: 36, conf: 1, b: 6 })]);
    const [x] = bestandsPflanzen(s);
    expect(x.spanne).toBeCloseTo(Math.sqrt(36 / Math.PI) / 2, 9);
    expect(x.provenance).toBe('erkannt');
    expect(x.quelle).toContain('Kronenmitte');
  });

  it('weiter als 3 m von der Grenze: nicht gelistet; Straßenseite: nicht gelistet', () => {
    const fern: Vec2[] = [[28, 9], [32, 9], [32, 13], [28, 13]];
    expect(bestandsPflanzen(site([fromRec({ id: 'F', k: 'baum', fp: fern, h: 10, a: 16, conf: 1 })]))).toHaveLength(0);
    // angetippter Stamm bleibt gelistet, auch wenn er weit weg liegt
    expect(bestandsPflanzen(site([baumRec([30, 11], 0.2, 10, fern)]))).toHaveLength(1);
    const s = site([fromRec({ id: 'K', k: 'strauch', fp: [[20.5, 10.5], [21.5, 10.5], [21.5, 11.5], [20.5, 11.5]], h: 1.5, a: 1, conf: 1 })]);
    expect(bestandsPflanzen(s)).toHaveLength(1);
    expect(bestandsPflanzen(s, [{}, { strasse: { value: true, provenance: 'nutzerbestätigt' } }])).toHaveLength(0);
  });

  it('Hecke: Abstand als Spanne vom Rand bis zur halben Breite', () => {
    const fp: Vec2[] = [[2, -1.2], [10, -1.2], [10, -0.2], [2, -0.2]]; // Nachbarhecke 1 m breit, Rand 0,2 m vor der Südgrenze
    const s = site([fromRec({ id: 'H', k: 'hecke', fp, h: 1.9, a: 8, conf: 1, b: 1 })]);
    const [x] = bestandsPflanzen(s);
    expect(x.abstand - x.spanne).toBeCloseTo(0.2, 9);
    expect(x.abstand + x.spanne).toBeCloseTo(0.7, 9);
    expect(x.vergleich).toBe('unklar');
  });

  it('Art. 52: nur Info-Text mit BGH V ZR 230/16, keine Fristberechnung', () => {
    for (const a of ['unbekannt', 'unter5', 'ueber5'] as const) {
      const t = alterText(a);
      expect(t).toContain('Schluss des Jahres');
      expect(t).toContain('grobe Fahrlässigkeit');
      expect(t).toContain('V ZR 230/16');
      expect(t).toContain('erstmals überschreiten');
      expect(t).toContain('eindeutig');
      expect(t).toContain('rechnet diese Frist nicht aus');
      expect(t).not.toMatch(/noch nicht abgelaufen|ist abgelaufen|bis \d{4}/);
    }
  });

  it('Hang: Nachbar 1 m höher → Hinweis nach BGH, Ergebnis unverändert', () => {
    const s = { ...site(), ground: (p: Vec2) => (p[1] < 0 ? 401 : 400) };
    const r = pruefePflanze(s, hecke(1.2, 1.8));
    expect(r.rows.some((x) => x.kind === 'offen' && x.text.includes('V ZR 230/16'))).toBe(true);
    expect(r.status).toBe(pruefePflanze(site(), hecke(1.2, 1.8)).status);
  });

  it('Alter-Hinweis nennt Art. 52 und die Ersatzpflanzung, ohne „Anspruch haben“', () => {
    const t = alterText('ueber5');
    expect(t).toContain('Art. 52 Abs. 1');
    expect(t).toContain('Art. 52 Abs. 2');
    expect(t).not.toMatch(/Sie haben|du hast Anspruch/);
  });
});
