import { describe, expect, it } from 'vitest';
import { evaluate, GERAETE_NAME, geraeteKlasse, LIMITS, richtwertFuer, soundPressure, standardLw, standardMasse, type Placed } from '../src/rules';
import { demoObjects, demoSite } from '../src/rules/demo';

const mit = (p: Partial<Placed>) => {
  const objs = demoObjects();
  objs.waermepumpe = { ...objs.waermepumpe, ...p };
  return objs;
};
const zeilen = (r: { rows: { text: string }[] }) => r.rows.map((x) => x.text).join(' | ');

describe('Außengeräte (AUFTRAG_V3 Phase A)', () => {
  it('Klasse fehlt = Luft-Wasser-Wärmepumpe, Namen und Platzhalter je Klasse', () => {
    expect(geraeteKlasse(demoObjects().waermepumpe)).toBe('lwwp');
    expect(GERAETE_NAME.klima.name).toContain('Klimagerät');
    expect(standardLw('lwwp')).toBe(58);
    expect(standardLw('klima')).toBe(LIMITS.aussengeraete.standardLwDbA.wert.klima);
    expect(standardMasse('pool').w).toBeGreaterThan(0);
  });

  it('Schall: gleiche Formel für alle Klassen – gleiche Schallleistung ergibt gleichen Pegel am Fenster', () => {
    const a = evaluate(demoSite(), mit({ lw: 58, geraeteklasse: 'lwwp' })).waermepumpe;
    const b = evaluate(demoSite(), mit({ lw: 58, geraeteklasse: 'klima', lwVomNutzer: true })).waermepumpe;
    const c = evaluate(demoSite(), mit({ lw: 58, geraeteklasse: 'pool', lwVomNutzer: true })).waermepumpe;
    expect(b.lp).toBeCloseTo(a.lp!, 6);
    expect(c.lp).toBeCloseTo(a.lp!, 6);
  });

  it('Formel von Hand: Klimagerät 62 dB(A), Wand (Q = 4), 5 m → 43,0 dB(A); BWP-Rechner nur für Luft-Wasser, hier nicht vergleichbar', () => {
    expect(soundPressure(62, 4, 5)).toBeCloseTo(43.04, 1);
  });

  it('Klimagerät: verfahrensfrei als Auslegung (offen), Wortlaut nennt es nicht', () => {
    const r = evaluate(demoSite(), mit({ geraeteklasse: 'klima', lw: 60 })).waermepumpe;
    const z = zeilen(r);
    expect(z).toContain('Art. 57 Abs. 1 Nr. 2 Buchst. b');
    expect(r.rows.some((x) => x.kind === 'offen' && x.text.includes('nennt der Wortlaut nicht ausdrücklich'))).toBe(true);
    expect(r.rows.some((x) => x.kind === 'Annahme' && x.text.includes('Art. 6 Abs. 1 Satz 3 Nr. 4'))).toBe(true);
    expect(z).toContain('Sommer');
  });

  it('Klimagerät: Schallleistung ohne Eingabe = Annahme (Platzhalter), mit Eingabe = nutzerbestätigt', () => {
    const ohne = evaluate(demoSite(), mit({ geraeteklasse: 'klima', lw: 60 })).waermepumpe.rows.find((x) => x.text.startsWith('Schallleistung'))!;
    expect(ohne.kind).toBe('Annahme');
    const nutzer = evaluate(demoSite(), mit({ geraeteklasse: 'klima', lw: 56, lwVomNutzer: true })).waermepumpe.rows.find((x) => x.text.startsWith('Schallleistung'))!;
    expect(nutzer.kind).toBe('nutzerbestätigt');
    expect(nutzer.text).toContain('56 dB(A)');
  });

  it('Pool-Wärmepumpe: nachts oder nur tagsüber (TA Lärm Nr. 6.1 / 6.4), Schwimmbecken selbst ungeprüft', () => {
    const o = mit({ geraeteklasse: 'pool', lw: 55 }).waermepumpe;
    expect(richtwertFuer(o, 'allgemein')).toEqual({ limit: 40, zeit: 'Nachts' });
    expect(richtwertFuer({ ...o, nurTags: true }, 'allgemein')).toEqual({ limit: 55, zeit: 'Tagsüber' });
    expect(richtwertFuer({ ...o, nurTags: true }, 'rein').limit).toBe(50);
    expect(richtwertFuer({ ...o, nurTags: true }, 'misch').limit).toBe(60);
    // nur bei der Pool-Wärmepumpe gibt es den Tagwert
    expect(richtwertFuer({ ...mit({ geraeteklasse: 'klima' }).waermepumpe, nurTags: true }, 'allgemein').limit).toBe(40);
    const r = evaluate(demoSite(), mit({ geraeteklasse: 'pool', lw: 55, nurTags: true })).waermepumpe;
    expect(zeilen(r)).toContain('Tagsüber am nächsten Fenster');
    expect(zeilen(r)).toContain('Schwimmbecken selbst prüft Passt. nicht');
  });

  it('Pool-Wärmepumpe tagsüber darf lauter sein als nachts (gleiches Gerät, gleiche Stelle)', () => {
    const laut = { geraeteklasse: 'pool' as const, lw: 66, lwVomNutzer: true };
    const nachts = evaluate(demoSite(), mit(laut)).waermepumpe;
    const tags = evaluate(demoSite(), mit({ ...laut, nurTags: true })).waermepumpe;
    expect(nachts.lp).toBeCloseTo(tags.lp!, 6);
    const rank = { ok: 0, warn: 1, bad: 2 };
    expect(rank[tags.status]).toBeLessThanOrEqual(rank[nachts.status]);
    expect(tags.head).not.toContain('Nachts');
  });

  it('Pool im Außenbereich: Hinweis auf das Becken, Außenbereich genannt', () => {
    const s = demoSite();
    s.bereich = { value: 'aussen', provenance: 'Annahme' };
    expect(zeilen(evaluate(s, mit({ geraeteklasse: 'pool' })).waermepumpe)).toContain('hier angenommen: Außenbereich');
  });

  it('über 2 m Höhe: Abstandsfläche offen, bei allen Klassen', () => {
    for (const k of ['lwwp', 'klima', 'pool'] as const) {
      const r = evaluate(demoSite(), mit({ geraeteklasse: k, h: 2.3 })).waermepumpe;
      expect(r.rows.some((x) => x.kind === 'offen' && x.text.includes('Abstandsfläche nötig'))).toBe(true);
    }
  });

  it('Luft-Wasser-Wärmepumpe: Zeilen und Satz wie bisher (kein Klimahinweis, keine Pool-Zeile)', () => {
    const r = evaluate(demoSite(), demoObjects()).waermepumpe;
    expect(zeilen(r)).toContain('Keine Baugenehmigung nötig am Ein- oder Zweifamilienhaus');
    expect(zeilen(r)).not.toContain('Sommer');
    expect(zeilen(r)).not.toContain('Schwimmbecken');
    expect(zeilen(r)).toContain('Nachts am nächsten Fenster');
  });

  it('alle neuen Regeln: geprueft = false, mit Quelle', () => {
    for (const [k, v] of Object.entries(LIMITS.aussengeraete)) {
      if (k.startsWith('_')) continue;
      const e = v as { geprueft?: boolean; quelle?: string };
      expect(e.geprueft, k).toBe(false);
      expect(e.quelle, k).toBeTruthy();
    }
  });
});
