/**
 * Höhenraster aus der Pipeline (DGM1 + GCG2016 → Ellipsoidhöhen, 1 m, 250-m-Kacheln).
 * Dient gleichzeitig als Cesium-Gelände und als Geländefunktion für das Regelwerk.
 */
import { CustomHeightmapTerrainProvider, GeographicTilingScheme, Math as CMath } from 'cesium';
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
}

const SAMPLES = 32;

export class Terrain {
  private chunks = new Map<string, Uint16Array>();
  private pending = new Map<string, Promise<void>>();

  private constructor(private meta: Meta, private baseUrl: string) {}

  static async load(baseUrl: string): Promise<Terrain> {
    const meta = (await (await fetch(`${baseUrl}/terrain.json`)).json()) as Meta;
    return new Terrain(meta, baseUrl);
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
        });
      this.pending.set(k, p);
    }
    return p;
  }

  private gridPos(p: Vec2): [number, number] {
    const m = this.meta;
    const maxI = m.cols * m.chunk;
    const maxJ = m.rows * m.chunk;
    // Außerhalb des Gebiets: Randwert (flaches Umland). Weit entfernte Punkte liefern in UTM 32 NaN.
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) p = [0, 0];
    const gi = Math.min(Math.max((p[0] - m.first[0]) / m.res, 0), maxI - 1e-6);
    const gj = Math.min(Math.max((p[1] - m.first[1]) / m.res, 0), maxJ - 1e-6);
    return [gi, gj];
  }

  /** Alle Kacheln laden, die das Rechteck berühren. */
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

  /** Ellipsoidhöhe (bilinear). NaN, wenn die Kachel noch nicht geladen ist. */
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

  /** Höhe, notfalls nach Laden der Kachel. */
  async heightAsync(p: Vec2): Promise<number> {
    await this.ensure(p, p);
    return this.height(p);
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
            // weit außerhalb von UTM 32 liefert proj4 NaN: dann Gebietsmitte (Randwert-Logik greift ohnehin)
            pts.push(Number.isFinite(q[0]) && Number.isFinite(q[1]) ? q : [0, 0]);
          }
        }
        let min: Vec2 = [Infinity, Infinity];
        let max: Vec2 = [-Infinity, -Infinity];
        for (const p of pts) {
          min = [Math.min(min[0], p[0]), Math.min(min[1], p[1])];
          max = [Math.max(max[0], p[0]), Math.max(max[1], p[1])];
        }
        await this.ensure(min, max);
        pts.forEach((p, i) => (out[i] = this.height(p)));
        const bad = out.findIndex((v) => !Number.isFinite(v));
        if (bad >= 0) {
          // Sicherheitsnetz: Cesium bricht bei NaN das Rendern ab
          const fallback = this.meta.base;
          for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) out[i] = fallback;
        }
        return out;
      },
    });
  }
}
