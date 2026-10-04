/**
 * Parität mit dem getesteten Prototyp: Die Prüflogik wird direkt aus design/prototyp.html
 * geladen und für viele zufällige Positionen gegen das neue Regelwerk verglichen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { area, clipArea, evaluate, footprint, placement, type ObjectKind } from '../src/rules';
import { demoObjects, demoSite } from '../src/rules/demo';

type ProtoObj = { cx: number; cz: number; w: number; d: number; h: number; rot: number; lw?: number };
type Proto = { OBJ: Record<'gh' | 'cp' | 'wp', ProtoObj>; evaluate: () => Record<'gh' | 'cp' | 'wp', { status: string; head: string; sub: string }> };

function loadPrototype(): Proto {
  const html = readFileSync(resolve(__dirname, '../../design/prototyp.html'), 'utf8');
  const start = html.indexOf('/* ---------- Demo-Geometrie');
  const end = html.indexOf('/* ---------- Szene');
  const helpers = `function fmt(v,d){d=d==null?2:d;var f=Math.pow(10,d);return (Math.round(v*f)/f).toFixed(d).replace('.',',');}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${helpers}\n${html.slice(start, end)}\nreturn {OBJ:OBJ,evaluate:evaluate};`)() as Proto;
}

const MAP: Record<ObjectKind, 'gh' | 'cp' | 'wp'> = { gartenhaus: 'gh', carport: 'cp', waermepumpe: 'wp' };

// deterministischer Zufall
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe('Parität mit design/prototyp.html', () => {
  it('Startzustand identisch', () => {
    const P = loadPrototype();
    const pr = P.evaluate();
    const r = evaluate(demoSite(), demoObjects());
    for (const k of Object.keys(MAP) as ObjectKind[]) {
      expect(r[k].status, k).toBe(pr[MAP[k]].status);
      expect(r[k].head, k).toBe(pr[MAP[k]].head);
      expect(r[k].sub, k).toBe(pr[MAP[k]].sub);
    }
  });

  it('2000 zufällige Platzierungen: gleiche Ampel, gleicher Satz', () => {
    const P = loadPrototype();
    const rand = rng(42);
    let mismatches: string[] = [];
    let skipped = 0;
    let neueRegel = 0;
    for (let n = 0; n < 2000; n++) {
      const objs = demoObjects();
      for (const k of Object.keys(MAP) as ObjectKind[]) {
        const po = P.OBJ[MAP[k]];
        const o = objs[k];
        // auf 5-cm-Raster wie beim Ziehen im Prototyp
        po.cx = Math.round((-4 + rand() * 30) * 20) / 20;
        po.cz = Math.round((-3 + rand() * 34) * 20) / 20;
        if (k !== 'waermepumpe') {
          po.w = Math.round((2 + rand() * 4) * 10) / 10;
          po.d = Math.round((2 + rand() * 5) * 10) / 10;
          po.h = Math.round((2 + rand() * 1.6) * 20) / 20;
          po.rot = rand() < 0.3 ? 1 : 0;
        } else po.lw = Math.round(48 + rand() * 20);
        o.center = [po.cx, -po.cz];
        o.w = po.w; o.d = po.d; o.h = po.h; o.lw = po.lw;
        o.angle = po.rot ? Math.PI / 2 : 0;
      }
      const pr = P.evaluate();
      const site = demoSite();
      const r = evaluate(site, objs);
      for (const k of Object.keys(MAP) as ObjectKind[]) {
        const a = pr[MAP[k]];
        const b = r[k];
        if (a.status === b.status && a.head === b.head && a.sub === b.sub) continue;
        const fp = footprint(objs[k]);
        // Gewollte Abweichungen:
        // 1. Wärmepumpe in einer Hausecke: Q = 8 (CLAUDE.md), der Prototyp kannte nur Q = 4.
        if (k === 'waermepumpe' && placement(site, fp) === 'ecke') { skipped++; continue; }
        // 2. Objekt liegt exakt auf der Grenze (< 0,01 m² außerhalb): zählt als auf dem Grundstück.
        if (a.head.startsWith('Steht nicht ganz') && area(fp) - clipArea(site.plot.boundary, fp) < 0.01) { skipped++; continue; }
        // 3. BayBO Art. 6 Abs. 1/3 (Phase 2.2): nicht privilegiert (Wandhöhe > 3 m) und in bzw. über den
        //    Abstandsflächen des Hauses – der Prototyp kannte keine Abstandsflächen des Hauses.
        if (b.head === 'Zu nah an deinem Haus.' && a.status === 'ok' && objs[k].h > 3 && !b.af?.privilegiert) { neueRegel++; continue; }
        {
          mismatches.push(`${n} ${k} ${JSON.stringify(objs[k])}: proto=[${a.status}] ${a.head} ${a.sub} | neu=[${b.status}] ${b.head} ${b.sub}`);
        }
      }
    }
    mismatches = mismatches.slice(0, 10);
    expect(skipped).toBeLessThan(400);
    expect(neueRegel).toBeGreaterThan(0); // die neue Regel greift tatsächlich
    expect(neueRegel).toBeLessThan(200);
    expect(mismatches).toEqual([]);
  });
});
