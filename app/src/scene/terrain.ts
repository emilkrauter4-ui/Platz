/**
 * Höhenraster aus der Pipeline (DGM1 + GCG2016 → Ellipsoidhöhen, 1 m, 250-m-Kacheln).
 * Dient gleichzeitig als Cesium-Gelände und als Geländefunktion für das Regelwerk.
 *
 * Ladezeit: Grobe Gelände-Kacheln (weite Ansicht) kommen aus einer 8-m-Übersicht (eine Datei),
 * die 1-m-Kacheln werden erst geladen, wenn Cesium nah heranzoomt oder das Regelwerk sie braucht.
 */
import {
  CustomHeightmapTerrainProvider,
  GeographicTilingScheme,
} from '@cesium/engine';
import {
  Math as CMath,
} from '@cesium/core';
import type { Vec2 } from '../rules';
import { lonLatToLocal } from './coords';

interface Meta {
  first: Vec2;
  res: number;
  chunk: number;
  cols: number;
  rows: number;
  base: number;
  scale: number;
  overview: { step: number; nx: number; ny: number };
}

const SAMPLES = 32;
/** Ab diesem Stützpunktabstand einer Cesium-Kachel reicht die 8-m-Übersicht. */
const FINE_BELOW_M = 3;

export class Terrain {
  private chunks = new Map<string, Uint16Array>();
  private pending = new Map<string, Promise<void>>();

  private constructor(private meta: Meta, private baseUrl: string, private ov: Uint16Array) {}

  static async load(baseUrl: string): Promise<Terrain> {
    const [meta, ov] = await Promise.all([
      fetch(`${baseUrl}/terrain.json`).then((r) => r.json() as Promise<Meta>),
      fetch(`${baseUrl}/overview.bin`).then((r) => r.arrayBuffer()),
    ]);
    return new Terrain(meta, baseUrl, new Uint16Array(ov));
  }

  /** Alle Dateien, die das Gelände braucht (für den Offline-Cache). */
  files(): string[] {
    const out = ['terrain.json', 'overview.bin'];
    for (let x = 0; x < this.meta.cols; x++) for (let y = 0; y < this.meta.rows; y++) out.push(`${x}_${y}.bin`);
    return out.map((f) => `${this.baseUrl}/${f}`);
  }

  private key(cx: number, cy: number) {
    return `${cx}_${cy}`;
  }

  private loadChunk(cx: number, cy: number): Promise<void> {
    const k = this.key(cx, cy);
    if (this.chunks.has(k)) return Promise.resolve();
    let p = this.pending.get(k);
    if (!p) {
      p = fetch(`${this.baseUrl}/${k}.bin`)
        .then((r) => {
          if (!r.ok) throw new Error(`Gelände-Kachel ${k} fehlt`);
          return r.arrayBuffer();
        })
        .then((b) => {
          this.chunks.set(k, new Uint16Array(b));
        })
        .finally(() => this.pending.delete(k));
      this.pending.set(k, p);
    }
    return p;
  }

  /** Gitterposition (Stützpunkt-Einheiten); außerhalb des Gebiets: Randwert (flaches Umland). */
  private gridPos(p: Vec2): [number, number] {
    const m = this.meta;
    // Weit entfernte Punkte liefern in UTM 32 NaN
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) p = [0, 0];
    const maxI = m.cols * m.chunk;
    const maxJ = m.rows * m.chunk;
    const gi = Math.min(Math.max((p[0] - m.first[0]) / m.res, 0), maxI - 1e-6);
    const gj = Math.min(Math.max((p[1] - m.first[1]) / m.res, 0), maxJ - 1e-6);
    return [gi, gj];
  }

  /** Alle 1-m-Kacheln laden, die das Rechteck berühren. */
  async ensure(min: Vec2, max: Vec2): Promise<void> {
    const [i0, j0] = this.gridPos(min);
    const [i1, j1] = this.gridPos(max);
    const n = this.meta.chunk;
    const jobs: Promise<void>[] = [];
    for (let cx = Math.floor(i0 / n); cx <= Math.floor(i1 / n); cx++) {
      for (let cy = Math.floor(j0 / n); cy <= Math.floor(j1 / n); cy++) jobs.push(this.loadChunk(cx, cy));
    }
    await Promise.all(jobs);
  }

  /** Grobe Höhe aus der 8-m-Übersicht (immer verfügbar). */
  coarse(p: Vec2): number {
    const m = this.meta;
    const o = m.overview;
    const [gi, gj] = this.gridPos(p);
    const fi = Math.min(gi / (o.step / m.res), o.nx - 1 - 1e-6);
    const fj = Math.min(gj / (o.step / m.res), o.ny - 1 - 1e-6);
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const fx = fi - i;
    const fy = fj - j;
    const v = (ii: number, jj: number) => this.ov[jj * o.nx + ii];
    const h = v(i, j) * (1 - fx) * (1 - fy) + v(i + 1, j) * fx * (1 - fy) + v(i, j + 1) * (1 - fx) * fy + v(i + 1, j + 1) * fx * fy;
    return m.base + h * m.scale;
  }

  /** Ellipsoidhöhe (bilinear, 1 m). NaN, wenn die Kachel noch nicht geladen ist. */
  height(p: Vec2): number {
    const m = this.meta;
    const [gi, gj] = this.gridPos(p);
    const cx = Math.floor(gi / m.chunk);
    const cy = Math.floor(gj / m.chunk);
    const data = this.chunks.get(this.key(cx, cy));
    if (!data) {
      void this.loadChunk(cx, cy);
      return NaN;
    }
    const li = gi - cx * m.chunk;
    const lj = gj - cy * m.chunk;
    const i = Math.floor(li);
    const j = Math.floor(lj);
    const fx = li - i;
    const fy = lj - j;
    const w = m.chunk + 1;
    const v = (ii: number, jj: number) => data[jj * w + ii];
    const h = v(i, j) * (1 - fx) * (1 - fy) + v(i + 1, j) * fx * (1 - fy) + v(i, j + 1) * (1 - fx) * fy + v(i + 1, j + 1) * fx * fy;
    return m.base + h * m.scale;
  }

  /** Feine Höhe, sonst grobe – für Anzeigezwecke, nie für das Regelwerk. */
  heightOrCoarse(p: Vec2): number {
    const h = this.height(p);
    return Number.isFinite(h) ? h : this.coarse(p);
  }

  provider(): CustomHeightmapTerrainProvider {
    const scheme = new GeographicTilingScheme();
    return new CustomHeightmapTerrainProvider({
      width: SAMPLES,
      height: SAMPLES,
      tilingScheme: scheme,
      callback: async (x, y, level) => {
        const r = scheme.tileXYToRectangle(x, y, level);
        const out = new Float32Array(SAMPLES * SAMPLES);
        const pts: Vec2[] = [];
        for (let row = 0; row < SAMPLES; row++) {
          const lat = CMath.toDegrees(r.north - ((r.north - r.south) * row) / (SAMPLES - 1));
          for (let col = 0; col < SAMPLES; col++) {
            const lon = CMath.toDegrees(r.west + ((r.east - r.west) * col) / (SAMPLES - 1));
            const q = lonLatToLocal(lon, lat);
            pts.push(Number.isFinite(q[0]) && Number.isFinite(q[1]) ? q : [0, 0]);
          }
        }
        const spacing = ((r.north - r.south) * 6371000) / (SAMPLES - 1);
        if (spacing >= FINE_BELOW_M) {
          pts.forEach((p, i) => (out[i] = this.coarse(p)));
          return out;
        }
        let min: Vec2 = [Infinity, Infinity];
        let max: Vec2 = [-Infinity, -Infinity];
        for (const p of pts) {
          min = [Math.min(min[0], p[0]), Math.min(min[1], p[1])];
          max = [Math.max(max[0], p[0]), Math.max(max[1], p[1])];
        }
        await this.ensure(min, max);
        pts.forEach((p, i) => (out[i] = this.heightOrCoarse(p)));
        return out;
      },
    });
  }
}
