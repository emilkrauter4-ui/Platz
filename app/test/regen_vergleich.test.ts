/**
 * Erzeugt die Rechenergebnisse für den Vergleich mit der LfU-Hinweiskarte (docs/starkregen_vergleich.md).
 * Läuft nur mit PASST_VERGLEICH=1 (liest die Gelände- und Flächendaten aus app/public/data, schreibt data/build/regen_vergleich/*.json);
 * danach: python pipeline/29_regen_vergleich.py (lädt die LfU-Karte, rechnet die Kennzahlen, zeichnet die Bilder).
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { baueGitter, fliessSenken, gitterGeometrie, kostraHn, parameterVariante, simuliere } from '../src/rules/regen';
import { RegenDaten } from '../src/scene/regen';
import { Terrain } from '../src/scene/terrain';
import type { Vec2 } from '../src/rules/types';

const AN = !!process.env.PASST_VERGLEICH;
const DATEN = 'public/data';
const ORTE = [
  { id: 'froeschau', name: 'Fröschau 41, Sulzbach-Rosenberg', root: DATEN, mitte: [362.8, -250.9] as Vec2 },
  { id: 'schuetzenheim', name: 'Am Schützenheim 3, Sulzbach-Rosenberg', root: DATEN, mitte: [309.6, 164.1] as Vec2 },
  { id: 'carlorff', name: 'Carl-Orff-Straße 1, Sulzbach-Rosenberg', root: DATEN, mitte: [82.5, -911.2] as Vec2 },
  { id: 'scharhof', name: 'Scharhof 1, Hirschau', root: `${DATEN}/gebiete/scharhof`, mitte: null as Vec2 | null },
];

(AN ? describe : describe.skip)('Starkregen: Rechenergebnisse für den Vergleich mit der LfU-Karte', () => {
  for (const o of ORTE) {
    it(o.name, async () => {
      const orig = globalThis.fetch;
      globalThis.fetch = (async (u: string) => {
        const p = String(u).replace(/^http:\/\/lokal\//, '');
        try { return new Response(readFileSync(p)); } catch { return new Response('', { status: 404 }); }
      }) as typeof fetch;
      try {
        const terrain = await Terrain.load(`http://lokal/${o.root}/terrain`);
        const tm = JSON.parse(readFileSync(`${o.root}/terrain/terrain.json`, 'utf8')) as { origin: [number, number] };
        const mitte: Vec2 = o.mitte ?? [715420 - tm.origin[0], 5491910 - tm.origin[1]];
        const daten = await RegenDaten.load(`http://lokal/${o.root}/regen`);
        const geo = gitterGeometrie(mitte, 120, 2);
        await terrain.ensure([geo.x0, geo.y0], [geo.x0 + geo.n * geo.res, geo.y0 + geo.n * geo.res]);
        const klassen = daten ? await daten.klassen(geo.x0, geo.y0, geo.n, geo.n, geo.res) : null;
        const geb = (JSON.parse(readFileSync(`${o.root}/buildings.json`, 'utf8')) as { buildings: { fp: Vec2[] }[] }).buildings.map((b) => ({ footprint: b.fp }));
        const g = baueGitter(geo, (p) => terrain.heightOrCoarse(p), klassen, geb);
        const k = kostraHn(daten!.kostra, 60, 100)!;
        const r = simuliere({ gitter: g, regenMm: k.hn, regenMin: 60, nachlaufMin: 30, param: parameterVariante('mittel'), messpunkte: [], frameSek: 0 });
        const f = fliessSenken(g);
        mkdirSync('../data/build/regen_vergleich', { recursive: true });
        writeFileSync(`../data/build/regen_vergleich/${o.id}.json`, JSON.stringify({
          id: o.id, name: o.name, origin: tm.origin, x0: g.x0, y0: g.y0, res: g.res, nx: g.nx, ny: g.ny, regenMm: k.hn, regenMin: 60, ms: Math.round(r.ms),
          bilanz: r.bilanz, maxMm: Array.from(r.maxMm), senke: Array.from(f.senke, (v) => Math.round(v * 1000) / 1000), zufluss: Array.from(f.zufluss, (v) => Math.round(v)),
          gebaeude: Array.from(g.gebaeude, (v) => (v >= 0 ? 1 : 0)), klasse: Array.from(g.klasse),
        }));
        expect(r.bilanz.regenM3).toBeGreaterThan(0);
      } finally {
        globalThis.fetch = orig;
      }
    }, 120000);
  }
});
