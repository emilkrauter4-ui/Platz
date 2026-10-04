import { describe, expect, it } from 'vitest';
import { evaluate, verfahrenFuer, ANTRAG_LINKS, type Objects, type Site } from '../src/rules';
import { demoObjects, demoSite } from '../src/rules/demo';
import { ansichtenSvg, grundrissSvg, HINWEIS_SKIZZE, lageplanSvg, massstab, paketBauen, paketHtml, richtung, schnittSvg, SCHEMA } from '../src/antrag/paket';

/** Rechteckiges Testgrundstück 30 × 30 m, ohne Haus, Gelände eben. */
function square(): Site {
  return {
    ...demoSite(),
    demo: false,
    ground: () => 400,
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
function objs(): Objects {
  const o = demoObjects();
  o.gartenhaus.center = [15, -15];
  o.carport.center = [8, -6];
  o.waermepumpe.center = [25, -25];
  return o;
}

describe('Verfahren aus den Befunden', () => {
  it('kleines Gartenhaus mitten im Garten: kein Antrag, keine Checkliste', () => {
    const s = square();
    const o = objs();
    const r = evaluate(s, o).gartenhaus;
    expect(r.befunde).toEqual([]);
    const v = verfahrenFuer(s, 'gartenhaus', o.gartenhaus, r);
    expect(v.verfahren).toBe('frei');
    expect(v.checkliste).toHaveLength(0);
    expect(v.entwurfsverfasser).toBeNull();
  });

  it('Gartenhaus 5 × 5 × 3,2 m (80 m³): Bauantrag, Architekt/Ingenieur, vollständige Checkliste nach BauVorlV § 3', () => {
    const s = square();
    const o = objs();
    o.gartenhaus = { ...o.gartenhaus, w: 5, d: 5, h: 3.2 };
    const r = evaluate(s, o).gartenhaus;
    expect(r.befunde).toContain('groesse');
    const v = verfahrenFuer(s, 'gartenhaus', o.gartenhaus, r);
    expect(v.verfahren).toBe('genehmigung');
    expect(v.entwurfsverfasser?.quelle).toContain('Art. 61');
    expect(v.entwurfsverfasser?.offen).toBeTruthy();
    expect(v.checkliste.map((c) => c.id)).toEqual(expect.arrayContaining(['katasterauszug', 'lageplan', 'bauzeichnungen', 'baubeschreibung', 'nachbar', 'form']));
    expect(v.checkliste.find((c) => c.id === 'lageplan')!.passt).toBe('skizze');
    expect(v.checkliste.find((c) => c.id === 'katasterauszug')!.passt).toBe('nein');
    expect(v.schritte.some((x) => x.quelle === 'BayBO Art. 66 Abs. 1' && x.text.includes('ersetzt diese Unterschrift nicht'))).toBe(true);
  });

  it('Gartenhaus mit Ofen im Innenbereich, frei stehend: verfahrensfrei (Art. 57 Abs. 1 Nr. 1 a), aber gelb', () => {
    const s = { ...square(), feuerstaette: { value: true, provenance: 'nutzerbestätigt' as const } };
    const o = objs();
    const r = evaluate(s, o).gartenhaus;
    expect(r.status).toBe('warn');
    expect(r.befunde).toEqual([]);
    expect(r.rows.some((x) => x.kind === 'offen' && x.text.includes('Feuerstätte'))).toBe(true);
    expect(verfahrenFuer(s, 'gartenhaus', o.gartenhaus, r).verfahren).toBe('frei');
  });

  it('Gartenhaus mit Aufenthaltsraum direkt an der Grenze: kein Privileg nach Art. 6 Abs. 7', () => {
    const s = { ...square(), aufenthaltsraum: { value: true, provenance: 'nutzerbestätigt' as const } };
    const o = objs();
    o.gartenhaus = { ...o.gartenhaus, center: [o.gartenhaus.w / 2 + 0.3, -15], angle: 0 };
    const r = evaluate(s, o).gartenhaus;
    expect(r.status).toBe('bad');
    expect(r.befunde).toContain('grenze_aufenthaltsraum');
    expect(r.head).toContain('Aufenthaltsraum');
    // ohne Aufenthaltsraum wäre dieselbe Stelle erlaubt
    const ohne = evaluate(square(), o).gartenhaus;
    expect(ohne.befunde).not.toContain('grenze_aufenthaltsraum');
    expect(ohne.status).toBe('ok');
    const v = verfahrenFuer(s, 'gartenhaus', o.gartenhaus, r);
    expect(v.verfahren).toBe('frei_abweichung');
  });

  it('Außenbereich: Passt. gibt nicht frei, nennt aber die 20-m³-Regel', () => {
    const s = { ...square(), bereich: { value: 'aussen' as const, provenance: 'nutzerbestätigt' as const } };
    const r = evaluate(s, objs()).gartenhaus;
    expect(r.status).toBe('bad');
    expect(r.sub).toContain('20 m³');
  });

  it('Carport 6 × 9 m (54 m²): Bauantrag; als Kleingarage auch Techniker/Meister', () => {
    const s = square();
    const o = objs();
    o.carport = { ...o.carport, w: 6, d: 9, center: [6, -20] };
    const v = verfahrenFuer(s, 'carport', o.carport, evaluate(s, o).carport);
    expect(v.verfahren).toBe('genehmigung');
    expect(v.entwurfsverfasser?.wer).toContain('Kleingarage');
    expect(v.entwurfsverfasser?.quelle).toContain('GaStellV');
  });

  it('verfahrensfrei, aber 3,5 m hoch direkt an der Grenze: Abweichungsantrag (Art. 63 Abs. 2 Satz 2)', () => {
    const s = square();
    const o = objs();
    o.gartenhaus = { ...o.gartenhaus, w: 3, d: 2, h: 3.5, center: [15, -1] };
    const r = evaluate(s, o).gartenhaus;
    expect(r.befunde).toContain('grenze_wandhoehe');
    const v = verfahrenFuer(s, 'gartenhaus', o.gartenhaus, r);
    expect(v.verfahren).toBe('frei_abweichung');
    expect(v.schritte.some((x) => x.quelle.includes('Art. 63'))).toBe(true);
    expect(v.checkliste[0].id).toBe('abweichung');
  });

  it('außerhalb des Grundstücks: erst die Lage klären', () => {
    const s = square();
    const o = objs();
    o.gartenhaus.center = [29.5, -15];
    const v = verfahrenFuer(s, 'gartenhaus', o.gartenhaus, evaluate(s, o).gartenhaus);
    expect(v.verfahren).toBe('lage');
  });
});

describe('Zeichnungen und Paket', () => {
  it('Maßstab: 1:200 für kleine, 1:1000 für große Grundstücke', () => {
    expect(massstab(30, 40)).toBe(200);
    expect(massstab(80, 100)).toBe(500);
    expect(massstab(150, 200)).toBe(1000);
  });

  it('Himmelsrichtung der Außennormale', () => {
    expect(richtung([0, -1])).toBe('Süd');
    expect(richtung([1, 0])).toBe('Ost');
    expect(richtung([-0.7, 0.7])).toBe('Nordwest');
  });

  it('Grundriss 1:100: 3 m breit = 30 mm', () => {
    const o = { ...objs().gartenhaus, w: 3, d: 2.5 };
    const svg = grundrissSvg(o, 'gartenhaus');
    expect(svg).toContain('width="30" height="25"');
    expect(svg).toContain('3,00 m');
  });

  it('Lageplan: Skizzen-Hinweis, Grenze, Maßketten', () => {
    const s = square();
    const o = objs();
    o.gartenhaus.center = [15, -2];
    const r = evaluate(s, o).gartenhaus;
    const { svg, massstab: m } = lageplanSvg({ site: s, o: o.gartenhaus, k: 'gartenhaus', res: r, bestand: [] });
    expect(m).toBe(500); // 30 m + 2 × 8 m Rand = 46 m → bei 1:250 zu breit für 180 mm
    expect(svg).toContain('keine amtliche Lageplanunterlage');
    expect(svg).toContain('0,50 m'); // 15/-2 mit Tiefe 3 → 0,50 m zur Straße
  });

  it('Ansichten und Schnitt enthalten Wandhöhe und Dachneigung', () => {
    const s = square();
    const o = { ...objs().gartenhaus, neigung: 30 };
    expect(ansichtenSvg(s, o, 'gartenhaus')).toContain('Giebelseite');
    expect(schnittSvg(o, 'gartenhaus')).toContain('Dachneigung 30°');
  });

  it('Paket: Schema, UTM-Koordinaten, Hinweise; HTML eigenständig', () => {
    const s = square();
    const o = objs();
    o.gartenhaus = { ...o.gartenhaus, w: 5, d: 5, h: 3.2 };
    const r = evaluate(s, o).gartenhaus;
    const p = paketBauen({
      site: s, k: 'gartenhaus', o: o.gartenhaus, res: r, verfahren: verfahrenFuer(s, 'gartenhaus', o.gartenhaus, r), bestand: [],
      ursprung: [699000, 5487000], adresse: 'Teststraße 1', erstellt: new Date('2026-10-04T10:00:00Z'), links: ANTRAG_LINKS, version: 'test',
    });
    expect(p.schema).toBe(SCHEMA);
    expect(p.vorhaben.lage.mitte).toEqual([699015, 5486985]);
    expect(p.vorhaben.masse.bruttoRauminhalt).toBe(80);
    expect(p.hinweise).toContain(HINWEIS_SKIZZE);
    const json = JSON.parse(JSON.stringify(p));
    expect(json.verfahren.verfahren).toBe('genehmigung');
    const html = paketHtml(p);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Orientierung, keine Genehmigung');
    expect(html).toContain('digitaler_bauantrag');
    expect(html).not.toMatch(/<script|<link /);
  });
});
