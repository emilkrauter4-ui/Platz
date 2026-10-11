/**
 * Starkregen (AUFTRAG_V4 C3): Daten laden, Gitter aufbauen, Wasser in Cesium zeichnen.
 *  - `RegenDaten`: KOSTRA-DWD-Tabelle (DWD, CC BY 4.0) und Flächenarten (ALKIS Tatsächliche Nutzung + NDVI aus dem DOP20-CIR) aus
 *    pipeline/27_regen_daten.py.
 *  - `baueGitter`: Gelände (DGM1), Flächenarten und LoD2-Gebäude als Zellraster um das Grundstück.
 *  - `RegenLayer`: Wassertiefe als Netz mit Vertexfarben, Senken und Fließwege (nur Gelände), Messpunkte.
 */
import { Entity, GeometryInstance, PerInstanceColorAppearance, Primitive, type CesiumWidget as Viewer } from '@cesium/engine';
import { BoundingSphere, Color, ComponentDatatype, Geometry, GeometryAttribute, GeometryAttributes, PrimitiveType } from '@cesium/core';
import type { Vec2 } from '../rules';
import type { Gitter, KostraTabelle } from '../rules/regen';
import { localToCartesian } from './coords';

interface FlaechenMeta {
  res: number;
  chunk: number;
  cols: number;
  rows: number;
  first: [number, number];
  quelle: string;
  bildflug: string;
  anteil: Record<string, number>;
}

export class RegenDaten {
  private kacheln = new Map<string, Promise<Uint8Array | null>>();

  private constructor(readonly kostra: KostraTabelle & { mitte: [number, number] }, private meta: FlaechenMeta, private baseUrl: string) {}

  /** null, wenn für das Gebiet keine Regen-Daten vorliegen. */
  static async load(baseUrl: string): Promise<RegenDaten | null> {
    try {
      const [k, f] = await Promise.all([fetch(`${baseUrl}/kostra.json`), fetch(`${baseUrl}/flaechen.json`)]);
      if (!k.ok || !f.ok) return null;
      return new RegenDaten((await k.json()) as RegenDaten['kostra'], (await f.json()) as FlaechenMeta, baseUrl);
    } catch {
      return null;
    }
  }

  get quelleFlaechen(): string {
    return this.meta.quelle;
  }

  private kachel(cx: number, cy: number): Promise<Uint8Array | null> {
    const k = `${cx}_${cy}`;
    let p = this.kacheln.get(k);
    if (!p) {
      p = fetch(`${this.baseUrl}/flaechen/${k}.bin`).then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null)).catch(() => null);
      this.kacheln.set(k, p);
    }
    return p;
  }

  /** Flächenart je Zelle (0 durchlässig, 1 versiegelt, 2 Gewässer); außerhalb der Kacheln: durchlässig. */
  async klassen(x0: number, y0: number, nx: number, ny: number, res: number): Promise<Uint8Array> {
    const m = this.meta;
    const out = new Uint8Array(nx * ny);
    const need = new Set<string>();
    const cell = (x: number, y: number) => [Math.floor((x - m.first[0]) / m.res), Math.floor((y - m.first[1]) / m.res)] as const;
    for (const [x, y] of [[x0, y0], [x0 + nx * res, y0], [x0, y0 + ny * res], [x0 + nx * res, y0 + ny * res]] as const) {
      const [i, j] = cell(x, y);
      need.add(`${Math.floor(i / m.chunk)}_${Math.floor(j / m.chunk)}`);
    }
    const [ia, ja] = cell(x0, y0);
    const [ib, jb] = cell(x0 + nx * res, y0 + ny * res);
    for (let cy = Math.floor(ja / m.chunk); cy <= Math.floor(jb / m.chunk); cy++) for (let cx = Math.floor(ia / m.chunk); cx <= Math.floor(ib / m.chunk); cx++) {
      if (cx >= 0 && cy >= 0 && cx < m.cols && cy < m.rows) need.add(`${cx}_${cy}`);
    }
    const tiles = new Map<string, Uint8Array | null>();
    for (const k of need) {
      const [cx, cy] = k.split('_').map(Number);
      if (cx >= 0 && cy >= 0 && cx < m.cols && cy < m.rows) tiles.set(k, await this.kachel(cx, cy));
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const [gi, gj] = cell(x0 + (i + 0.5) * res, y0 + (j + 0.5) * res);
        const k = `${Math.floor(gi / m.chunk)}_${Math.floor(gj / m.chunk)}`;
        const t = tiles.get(k);
        if (t) out[j * nx + i] = t[(gj - Math.floor(gj / m.chunk) * m.chunk) * m.chunk + (gi - Math.floor(gi / m.chunk) * m.chunk)];
      }
    }
    return out;
  }
}

const RAMPE: [number, [number, number, number]][] = [
  [0.005, [150, 205, 245]],
  [0.05, [90, 160, 235]],
  [0.15, [40, 105, 215]],
  [0.4, [20, 55, 170]],
  [1.0, [70, 20, 120]],
];
function wasserFarbe(d: number): [number, number, number, number] {
  if (d <= RAMPE[0][0]) return [150, 205, 245, 0];
  for (let k = 1; k < RAMPE.length; k++) {
    if (d <= RAMPE[k][0]) {
      const [d0, c0] = RAMPE[k - 1];
      const [d1, c1] = RAMPE[k];
      const f = (d - d0) / (d1 - d0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f, Math.round(255 * Math.min(0.9, 0.45 + d * 2))];
    }
  }
  return [...RAMPE[RAMPE.length - 1][1], 230];
}

export interface MesspunktAnzeige {
  id: string;
  pos: Vec2;
  text: string;
  status: 'nass' | 'trocken' | 'offen';
}

export class RegenLayer {
  private wasser: Primitive | null = null;
  private senken: Primitive | null = null;
  private ents: Entity[] = [];
  private hoehe: Float32Array | null = null;
  private g: Gitter | null = null;
  /** Eckpunkte (Cesium-Koordinaten) des Gitters, einmal berechnet: Wasser knapp über dem Boden, Senken etwas höher */
  private eckW: Float64Array | null = null;
  private eckS: Float64Array | null = null;

  constructor(private viewer: Viewer, private boden: (p: Vec2) => number) {}

  weg() {
    this.wegWasser();
    if (this.senken) this.viewer.scene.primitives.remove(this.senken);
    this.senken = null;
    this.ents.forEach((e) => this.viewer.entities.remove(e));
    this.ents = [];
    this.viewer.scene.requestRender();
  }

  private wegWasser() {
    if (this.wasser) this.viewer.scene.primitives.remove(this.wasser);
    this.wasser = null;
  }

  /** Gitter für die Anzeige merken (Geländehöhen je Zellmitte einmal berechnen). */
  setzeGitter(g: Gitter) {
    this.g = g;
    const h = new Float32Array(g.nx * g.ny);
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) h[j * g.nx + i] = this.boden([g.x0 + (i + 0.5) * g.res, g.y0 + (j + 0.5) * g.res]);
    this.hoehe = h;
    const ecken = (off: number) => {
      const out = new Float64Array((g.nx + 1) * (g.ny + 1) * 3);
      for (let j = 0; j <= g.ny; j++) {
        for (let i = 0; i <= g.nx; i++) {
          // Eckhöhe = Mittel der angrenzenden Zellen
          let sum = 0;
          let cnt = 0;
          for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
            const ii = i + di;
            const jj = j + dj;
            if (ii >= 0 && jj >= 0 && ii < g.nx && jj < g.ny) { sum += h[jj * g.nx + ii]; cnt++; }
          }
          const c = localToCartesian([g.x0 + i * g.res, g.y0 + j * g.res], sum / cnt + off);
          const k = (j * (g.nx + 1) + i) * 3;
          out[k] = c.x; out[k + 1] = c.y; out[k + 2] = c.z;
        }
      }
      return out;
    };
    this.eckW = ecken(0.04);
    this.eckS = ecken(0.09);
  }

  /** Ein Bild: Wassertiefe je Zelle (mm). Nur nasse Zellen werden gezeichnet. */
  zeigeBild(frame: Uint16Array | null) {
    this.wegWasser();
    const g = this.g;
    const hz = this.hoehe;
    if (!g || !hz || !frame) return this.viewer.scene.requestRender();
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const ew = this.eckW!;
    const W = g.nx + 1;
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const c = j * g.nx + i;
        const d = frame[c] / 1000;
        if (d < 0.005) continue;
        const f = wasserFarbe(d);
        const base = pos.length / 3;
        for (const k of [j * W + i, j * W + i + 1, (j + 1) * W + i + 1, (j + 1) * W + i]) {
          pos.push(ew[k * 3], ew[k * 3 + 1], ew[k * 3 + 2]);
          col.push(f[0], f[1], f[2], f[3]);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    if (!idx.length) return this.viewer.scene.requestRender();
    this.wasser = this.mesh(pos, col, idx);
    this.viewer.scene.requestRender();
  }

  private mesh(pos: number[], col: number[], idx: number[]): Primitive {
    const position = new Float64Array(pos);
    const attributes = new GeometryAttributes();
    attributes.position = new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: position });
    attributes.color = new GeometryAttribute({ componentDatatype: ComponentDatatype.UNSIGNED_BYTE, componentsPerAttribute: 4, normalize: true, values: new Uint8Array(col) });
    const geometry = new Geometry({
      attributes,
      indices: new Uint32Array(idx),
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: BoundingSphere.fromVertices(Array.from(position.subarray(0, Math.min(position.length, 3000)))),
    });
    const prim = new Primitive({
      geometryInstances: new GeometryInstance({ geometry }),
      appearance: new PerInstanceColorAppearance({ flat: true, translucent: true, closed: false, faceForward: false }),
      asynchronous: false,
      allowPicking: false,
      releaseGeometryInstances: true,
    });
    this.viewer.scene.primitives.add(prim);
    return prim;
  }

  /** Senken (lila) und Fließwege (blaue Linien, ab `minZufluss` m²) nur aus dem Gelände. */
  zeigeSenken(senke: Float32Array | null, zufluss: Float32Array | null, minZufluss = 400) {
    if (this.senken) this.viewer.scene.primitives.remove(this.senken);
    this.senken = null;
    const g = this.g;
    const hz = this.hoehe;
    if (!g || !hz || !senke || !zufluss) return this.viewer.scene.requestRender();
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const c = j * g.nx + i;
        let f: [number, number, number, number] | null = null;
        if (g.gebaeude[c] >= 0) continue;
        if (senke[c] >= 0.05) f = [150, 60, 190, Math.round(255 * Math.min(0.85, 0.4 + senke[c]))];
        else if (zufluss[c] >= minZufluss) f = [20, 100, 230, Math.round(255 * Math.min(0.85, 0.35 + zufluss[c] / 6000))];
        if (!f) continue;
        const base = pos.length / 3;
        const es = this.eckS!;
        const W = g.nx + 1;
        for (const k of [j * W + i, j * W + i + 1, (j + 1) * W + i + 1, (j + 1) * W + i]) {
          pos.push(es[k * 3], es[k * 3 + 1], es[k * 3 + 2]);
          col.push(...f);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    if (!idx.length) return this.viewer.scene.requestRender();
    this.senken = this.mesh(pos, col, idx);
    this.viewer.scene.requestRender();
  }

  /** Markierte Stellen (Kellertreppe, Lichtschacht, Garageneinfahrt) mit Beschriftung. */
  zeigeMesspunkte(liste: MesspunktAnzeige[], dark: boolean) {
    this.ents.forEach((e) => this.viewer.entities.remove(e));
    this.ents = [];
    for (const m of liste) {
      const farbe = m.status === 'nass' ? '#C9302A' : m.status === 'trocken' ? '#2E7D5B' : '#1D2321';
      this.ents.push(this.viewer.entities.add({
        position: localToCartesian(m.pos, this.boden(m.pos) + 0.3),
        point: { pixelSize: 13, color: Color.fromCssColorString(farbe), outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: {
          text: m.text,
          font: '600 13px sans-serif',
          fillColor: dark ? Color.WHITE : Color.fromCssColorString('#1D2321'),
          outlineColor: dark ? Color.BLACK : Color.WHITE,
          outlineWidth: 4,
          style: 2,
          pixelOffset: { x: 0, y: -22 } as never,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }));
    }
    this.viewer.scene.requestRender();
  }
}
