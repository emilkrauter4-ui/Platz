import { describe, expect, it } from 'vitest';
import { dekodieren, kodieren, projektHash, type Vorhaben as Link } from '../src/nachbar/link';
import { voranfrageBauen, voranfrageHtml, HINWEIS_VORANFRAGE } from '../src/antrag/voranfrage';
import {
  ANTRAG_LINKS,
  berechneVerschattung,
  berechneZufahrt,
  bewerteVorhaben,
  fragenAnGemeinde,
  gemeindeAbschnitt,
  neuesVorhaben,
  zufahrtPunkt,
  type Building,
  type Site,
  type Vec2,
} from '../src/rules';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const site = (): Site => ({
  plot: { boundary: rect(0, 0, 30, 40), sides: [{ name: 'S', grenze: 'S' }], provenance: 'nutzerbestätigt' },
  buildings: [{ id: 'haus', footprint: rect(10, 4, 20, 12), provenance: 'amtlich', own: true, trauf: 6, first: 9 } as Building],
  bestand: [],
  windows: [{ pos: [15, 60], z: 1.6, provenance: 'Annahme' }],
  ground: () => 400,
  gebiet: { value: 'allgemein', provenance: 'Annahme' },
  bereich: { value: 'innen', provenance: 'Annahme' },
  bplan: { status: 'unbekannt', provenance: 'offen' },
  aufenthaltsraum: { value: false, provenance: 'Annahme' },
  feuerstaette: { value: false, provenance: 'Annahme' },
});
const STRASSE: Vec2[][] = [rect(-10, -12, 40, -1)];

describe('Bauvoranfrage (Vorbescheid, Art. 71 BayBO)', () => {
  const s = site();
  const v = { ...neuesVorhaben('wohnhaus', s), center: [15, 28] as Vec2, w: 10, d: 8, dachform: 'sattel' as const, neigung: 35 };
  const z = berechneZufahrt({ site: s, ziel: rect(10, 24, 20, 32), bruestung: 4.6, strassen: STRASSE });
  const res = bewerteVorhaben(s, v, zufahrtPunkt(z), STRASSE)!;
  const sch = berechneVerschattung(s, v, { lat: 49.5, lon: 11.74, konv: 0 });
  const gem = gemeindeAbschnitt(s, 'wohnhaus', null, [], 'Sulzbach-Rosenberg');
  const p = voranfrageBauen({
    site: s, v, res, zufahrt: z, schatten: sch, gemeinde: gem, fragen: fragenAnGemeinde('wohnhaus', s, [], null, false),
    bestand: [], ursprung: [699000, 5487000], adresse: 'Musterweg 1', erstellt: new Date('2026-10-10T10:00:00Z'), links: ANTRAG_LINKS, version: 'test',
  });

  it('enthält Lageplan-Skizze, Kubatur, Fragen an die Gemeinde und den Hinweis „keine Genehmigung“', () => {
    expect(p.schema).toBe('passt.bauvoranfrage/1');
    expect(p.hinweise[0]).toBe(HINWEIS_VORANFRAGE);
    expect(p.vorhaben.kubatur.rauminhalt).toBeCloseTo(res.kennzahlen.rauminhalt, 0);
    expect(p.vorhaben.kubatur.grundflaeche).toBe(80);
    expect(p.zeichnungen.lageplan.svg).toMatch(/<svg/);
    expect(p.zeichnungen.lageplan.svg).toMatch(/Lageplan-Skizze zur Bauvoranfrage/);
    expect(p.zeichnungen.lageplan.svg).toMatch(/keine amtliche Lageplanunterlage/);
    expect(p.fragen.length).toBeGreaterThanOrEqual(5);
    expect(p.verfahren.quelle).toBe('BayBO Art. 71');
    expect(p.schatten.map((x) => x.stichtag)).toEqual(['21. März', '21. Dezember']);
    expect(p.vorhaben.lage.grundriss[0][0]).toBeGreaterThan(699000);
  });

  it('HTML: Abschnitt „Was die Gemeinde entscheidet“, Weg „Bauvoranfrage empfohlen“, Quellenangabe, Orientierung', () => {
    const h = voranfrageHtml(p);
    expect(h).toMatch(/Bauvoranfrage: Zweites Wohnhaus/);
    expect(h).toMatch(/Was die Gemeinde entscheidet/);
    expect(h).toMatch(/Bauvoranfrage empfohlen/);
    expect(h).toMatch(/Fragen an die Gemeinde/);
    expect(h).toMatch(/Orientierung, keine Genehmigung/);
    expect(h).toMatch(/Bayerische Vermessungsverwaltung – www\.geodaten\.bayern\.de/);
    expect(h).toMatch(/Zusätzliche Verschattung der Nachbarn/);
    expect(h).not.toMatch(/undefined|NaN/);
  });
});

describe('Nachbar-Link mit großem Vorhaben', () => {
  const link = (): Link => ({
    v: 1, u: [699000, 5487000], b: rect(0, 0, 30, 40), o: {}, bis: '2026-12-31', l: 'abc',
    g: { art: 'anbau', center: [12.345, 6.789], w: 4, d: 3.5, angle: 0.5, geschosse: 2, geschosshoehe: 2.8, dachform: 'sattel', neigung: 30, hostId: 'DEBY_LOD2_1', hostKante: 1, versatz: -0.5, firstQuer: true },
  });
  it('kodieren → dekodieren behält das Vorhaben; die Prüfsumme ändert sich mit dem Vorhaben', async () => {
    const v = (await dekodieren(await kodieren(link())))!;
    expect(v.g).toMatchObject({ art: 'anbau', w: 4, d: 3.5, geschosse: 2, dachform: 'sattel', neigung: 30, hostId: 'DEBY_LOD2_1', hostKante: 1, versatz: -0.5, firstQuer: true });
    expect(v.g!.center).toEqual([12.35, 6.79]);
    const a = await projektHash(link());
    const l2 = link();
    l2.g!.geschosse = 3;
    expect(await projektHash(l2)).not.toBe(a);
  });
  it('Aufstockung: Gebäude-ID bleibt erhalten', async () => {
    const l = link();
    l.g = { art: 'aufstockung', center: [0, 0], w: 0, d: 0, angle: 0, geschosse: 1, geschosshoehe: 2.8, dachform: 'sattel', neigung: 35, zielId: 'DEBY_LOD2_9' };
    const v = (await dekodieren(await kodieren(l)))!;
    expect(v.g!.zielId).toBe('DEBY_LOD2_9');
    expect(v.g!.hostId).toBeUndefined();
  });
});
