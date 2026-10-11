/**
 * Oberflächenmodell (Bäume u. a., Höhe über Gelände, 1 m) für die Sonne in den Räumen. Kacheln à 250 m, uint8 in 0,25-m-Stufen,
 * Winter aus Laserdaten (laubfrei), Sommer aus DOM20 minus DGM1 (belaubt), siehe pipeline/25_oberflaeche.py.
 * Geladen wird nur der Ausschnitt um das Haus; fehlt der Datensatz (anderes Gebiet), bleibt das Ergebnis null.
 */
import type { RasterAusschnitt } from '../rules/raumsonne';
import type { Vec2 } from '../rules/types';

interface Meta {
  res: number;
  chunk: number;
  cols: number;
  rows: number;
  stufe: number;
  first: [number, number];
  winter: { quelle: string; befliegung: string };
  sommer: { quelle: string; befliegung: string };
}

export interface OberflaecheQuelle {
  winter: string;
  sommer: string;
}

export class Oberflaeche {
  private kacheln = new Map<string, Promise<Uint8Array | null>>();

  private constructor(private meta: Meta, private baseUrl: string) {}

  /** null, wenn für dieses Gebiet kein Oberflächenmodell vorliegt. */
  static async load(baseUrl: string): Promise<Oberflaeche | null> {
    try {
      const r = await fetch(`${baseUrl}/oberflaeche.json`);
      if (!r.ok) return null;
      const m = (await r.json()) as Meta;
      return m.res > 0 ? new Oberflaeche(m, baseUrl) : null;
    } catch {
      return null;
    }
  }

  get quelle(): OberflaecheQuelle {
    return { winter: this.meta.winter.quelle, sommer: this.meta.sommer.quelle };
  }

  private kachel(saison: 'winter' | 'sommer', cx: number, cy: number): Promise<Uint8Array | null> {
    const k = `${saison}/${cx}_${cy}`;
    let p = this.kacheln.get(k);
    if (!p) {
      p = fetch(`${this.baseUrl}/${k}.bin`).then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null)).catch(() => null);
      this.kacheln.set(k, p);
    }
    return p;
  }

  /** Quadratischer Ausschnitt um `mitte` mit Halbkantenlänge `radius` (m); Zellen außerhalb des Gebiets bleiben 0. */
  async ausschnitt(saison: 'winter' | 'sommer', mitte: Vec2, radius: number): Promise<RasterAusschnitt> {
    const m = this.meta;
    const res = m.res;
    const x0 = m.first[0] + Math.floor((mitte[0] - radius - m.first[0]) / res) * res;
    const y0 = m.first[1] + Math.floor((mitte[1] - radius - m.first[1]) / res) * res;
    const n = Math.ceil((2 * radius) / res) + 1;
    const d = new Uint8Array(n * n);
    const cx0 = Math.max(0, Math.floor((x0 - m.first[0]) / (m.chunk * res)));
    const cx1 = Math.min(m.cols - 1, Math.floor((x0 + n * res - m.first[0]) / (m.chunk * res)));
    const cy0 = Math.max(0, Math.floor((y0 - m.first[1]) / (m.chunk * res)));
    const cy1 = Math.min(m.rows - 1, Math.floor((y0 + n * res - m.first[1]) / (m.chunk * res)));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = await this.kachel(saison, cx, cy);
        if (!k) continue;
        for (let j = 0; j < n; j++) {
          const gy = Math.round((y0 + j * res - m.first[1]) / res) - cy * m.chunk;
          if (gy < 0 || gy >= m.chunk) continue;
          for (let i = 0; i < n; i++) {
            const gx = Math.round((x0 + i * res - m.first[0]) / res) - cx * m.chunk;
            if (gx < 0 || gx >= m.chunk) continue;
            d[j * n + i] = k[gy * m.chunk + gx];
          }
        }
      }
    }
    return { x0, y0, res, nx: n, ny: n, stufe: m.stufe, d };
  }
}
