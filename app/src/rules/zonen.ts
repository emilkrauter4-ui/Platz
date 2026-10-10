/**
 * „Wo darf es hin?“ – das Regelwerk auf einem Raster über das ganze Grundstück (AUFTRAG_V2 Phase 2.1).
 *
 * Für jede Rasterzelle wird das gewählte Objekt mit seiner aktuellen Größe dort hingestellt und geprüft:
 *   grün = passt in der aktuellen Ausrichtung, gelb = passt nur gedreht (parallel zu einer Grenze oder in
 *   45°-Schritten), rot = passt hier nicht, grau = außerhalb.
 * Zweistufig: erst 1 m, dann 0,25 m nur dort, wo benachbarte Grobzellen verschieden sind.
 * Geprüft wird mit derselben Logik wie in evaluate() (zonenPruefer), damit Fläche und Antwort übereinstimmen.
 *
 * Läuft im Web Worker (zonen.worker.ts); deshalb ist die Seite hier serialisierbar (Gelände als Raster).
 */
import { zonenPruefer, type Objects } from './evaluate';
import { pointInPolygon } from './geometry';
import { vorhabenPruefer, type Vorhaben } from './vorhaben';
import type { Site, Status, Vec2 } from './types';

export const FREI = 0;
export const GRUEN = 1;
export const GELB = 2;
export const ROT = 3;

/** Gelände als Raster (für den Worker): Höhe an (x0 + i·step, y0 + j·step), Zeilen von Süden nach Norden. */
export interface GelaendeRaster {
  x0: number;
  y0: number;
  step: number;
  nx: number;
  ny: number;
  z: Float32Array;
}

export function gelaendeAus(r: GelaendeRaster): (p: Vec2) => number {
  return ([x, y]) => {
    const fx = Math.min(Math.max((x - r.x0) / r.step, 0), r.nx - 1.001);
    const fy = Math.min(Math.max((y - r.y0) / r.step, 0), r.ny - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const z = r.z;
    const a = z[j * r.nx + i];
    const b = z[j * r.nx + i + 1];
    const c = z[(j + 1) * r.nx + i];
    const d = z[(j + 1) * r.nx + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

/**
 * Rastergeometrie: Zellmitte (c, r) liegt bei o + (c + 0,5)·ex + (r + 0,5)·ey in lokalen Metern. ex/ey sind die
 * lokalen Vektoren eines Schritts nach Osten/Norden in geografischen Koordinaten – so passt das Ergebnisbild genau
 * auf ein Cesium-Rectangle (keine Verdrehung durch die Meridiankonvergenz).
 */
export interface RasterGeometrie {
  o: Vec2;
  ex: Vec2;
  ey: Vec2;
  nx: number;
  ny: number;
}

export interface ZonenErgebnis {
  /** je Zelle (Zeile von Norden nach Süden, wie ein Bild): FREI/GRUEN/GELB/ROT */
  feld: Uint8Array;
  /** Index der Ausrichtung, die passt (−1 = keine) */
  winkelIdx: Int8Array;
  winkel: number[];
  /** beste Stelle: grüne (sonst gelbe) Zelle am nächsten zur aktuellen Position */
  beste: { p: Vec2; angle: number; farbe: number } | null;
  ms: number;
  pruefungen: number;
}

/** Ausrichtungen: aktuelle, parallel/senkrecht zu jeder Grenzstrecke, dann 45°-Schritte (doppelte < 3° weg). */
export function ausrichtungen(boundary: Vec2[], aktuell: number): number[] {
  const norm = (a: number) => ((a % Math.PI) + Math.PI) % Math.PI; // Rechteck: 180° symmetrisch
  const out: number[] = [];
  const add = (a: number) => {
    const n = norm(a);
    if (!out.some((x) => Math.min(Math.abs(x - n), Math.PI - Math.abs(x - n)) < (3 * Math.PI) / 180)) out.push(n);
  };
  add(aktuell);
  boundary.forEach((p, i) => {
    const q = boundary[(i + 1) % boundary.length];
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 2) return;
    add(Math.atan2(q[1] - p[1], q[0] - p[0]));
  });
  for (let d = 0; d < 180; d += 45) add((d * Math.PI) / 180);
  return out;
}

export function zonen(site: Site, objs: Objects, k: 'gartenhaus' | 'carport', g: RasterGeometrie): ZonenErgebnis {
  return zonenMit(site, zonenPruefer(site, objs, k), objs[k].center, objs[k].angle, g);
}

/** „Wo darf es hin?“ für das große Vorhaben: der ganze Hausgrundriss, geprüft mit vorhabenPruefer (ohne Zufahrt). */
export function zonenVorhaben(site: Site, v: Vorhaben, g: RasterGeometrie): ZonenErgebnis {
  return zonenMit(site, vorhabenPruefer(site, v), v.center, v.angle, g);
}

export function zonenMit(site: Site, pruef: (center: Vec2, angle: number) => Status, aktuell: Vec2, aktuellWinkel: number, g: RasterGeometrie): ZonenErgebnis {
  const t0 = performance.now();
  const winkel = ausrichtungen(site.plot.boundary, aktuellWinkel);
  const plot = site.plot.boundary;
  let pruefungen = 0;
  const ok = (p: Vec2, w: number): boolean => {
    pruefungen++;
    return (pruef(p, winkel[w]) as Status) === 'ok';
  };
  const mitte = (c: number, r: number, s = 1): Vec2 => [
    g.o[0] + (c + 0.5 * s) * g.ex[0] + (r + 0.5 * s) * g.ey[0],
    g.o[1] + (c + 0.5 * s) * g.ex[1] + (r + 0.5 * s) * g.ey[1],
  ];
  /** Farbe einer Stelle; Reihenfolge der Ausrichtungen: zuerst die aktuelle, dann Kandidaten */
  const farbe = (p: Vec2, kandidaten: number[]): [number, number] => {
    if (!pointInPolygon(p, plot)) return [FREI, -1];
    if (ok(p, 0)) return [GRUEN, 0];
    for (const w of kandidaten) if (w !== 0 && ok(p, w)) return [GELB, w];
    return [ROT, -1];
  };
  const alle = winkel.map((_, i) => i);

  // Stufe 1: Grobraster (4 × 4 Feinzellen = 1 m bei 0,25 m)
  const S = 4;
  const gx = Math.ceil(g.nx / S);
  const gy = Math.ceil(g.ny / S);
  const grob = new Uint8Array(gx * gy);
  const grobW = new Int8Array(gx * gy).fill(-1);
  for (let r = 0; r < gy; r++) {
    for (let c = 0; c < gx; c++) {
      const [f, w] = farbe(mitte(c * S, r * S, S), alle);
      grob[r * gx + c] = f;
      grobW[r * gx + c] = w;
    }
  }
  // Stufe 2: fein nur am Rand zwischen verschiedenen Grobzellen
  const feld = new Uint8Array(g.nx * g.ny);
  const winkelIdx = new Int8Array(g.nx * g.ny).fill(-1);
  for (let R = 0; R < gy; R++) {
    for (let C = 0; C < gx; C++) {
      const f0 = grob[R * gx + C];
      const nachbarn = new Set<number>();
      let rand = false;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = R + dr;
          const cc = C + dc;
          if (rr < 0 || cc < 0 || rr >= gy || cc >= gx) continue;
          if (grob[rr * gx + cc] !== f0) rand = true;
          if (grobW[rr * gx + cc] >= 0) nachbarn.add(grobW[rr * gx + cc]);
        }
      }
      const kand = [...nachbarn];
      for (let r = R * S; r < Math.min((R + 1) * S, g.ny); r++) {
        for (let c = C * S; c < Math.min((C + 1) * S, g.nx); c++) {
          let f = f0;
          let w = grobW[R * gx + C];
          if (rand) [f, w] = farbe(mitte(c, r), kand.length ? kand : alle);
          // Bildzeilen von Norden nach Süden
          const idx = (g.ny - 1 - r) * g.nx + c;
          feld[idx] = f;
          winkelIdx[idx] = w;
        }
      }
    }
  }
  // beste Stelle: grün vor gelb, am nächsten zur aktuellen Position
  const jetzt = aktuell;
  let beste: ZonenErgebnis['beste'] = null;
  let bd = Infinity;
  for (const want of [GRUEN, GELB]) {
    for (let r = 0; r < g.ny; r++) {
      for (let c = 0; c < g.nx; c++) {
        const idx = (g.ny - 1 - r) * g.nx + c;
        if (feld[idx] !== want) continue;
        const p = mitte(c, r);
        const d = Math.hypot(p[0] - jetzt[0], p[1] - jetzt[1]);
        if (d < bd) {
          bd = d;
          beste = { p, angle: winkel[winkelIdx[idx]], farbe: want };
        }
      }
    }
    if (beste) break;
  }
  return { feld, winkelIdx, winkel, beste, ms: performance.now() - t0, pruefungen };
}
