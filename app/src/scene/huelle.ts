/**
 * Die Hülle des Baurechts in Cesium (AUFTRAG_V4 C1): halbtransparenter Glaskörper über dem Grundstück, rote Leuchtflächen dort, wo ein
 * geplantes Gebäude hindurchstößt, und eine gestrichelte Referenzebene auf der mittleren Traufhöhe der Umgebung (Label „Orientierung“).
 * Alles ANNÄHERUNG (siehe rules/huelle.ts), nie Grundlage einer Ampel.
 *
 * Der Glaskörper ist ein eigenes Dreiecksnetz mit Vertexfarben: Oberseite über allen Rasterzellen, in denen gebaut werden darf, dazu
 * senkrechte „Schürzen“ an den Rändern der Sperrzonen; die Deckkraft läuft zu den Rändern hin aus (weiche Kanten).
 */
import {
  ClassificationType,
  Entity,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolylineDashMaterialProperty,
  Primitive,
  type CesiumWidget as Viewer,
} from '@cesium/engine';
import { BoundingSphere, Cartesian3, Color, ComponentDatatype, Geometry, GeometryAttribute, GeometryAttributes, PrimitiveType, PolygonHierarchy } from '@cesium/core';
import type { HuelleRaster, Vec2 } from '../rules';
import { localToCartesian } from './coords';

/** Ein rotes Wandstück: Strecke a–b mit Unterkante (Hülle) und Oberkante (Wand), absolute Höhen je Punkt. */
export interface RotesPaneel {
  pts: Vec2[];
  unten: number[];
  oben: number[];
}

export interface HuelleAnzeige {
  raster: HuelleRaster;
  /** Gelände an p (absolute Höhe) */
  boden: (p: Vec2) => number;
  /** Dachanteil von H, der von der Hülle abgezogen wird (Wandhöhe statt H); 0 = Flachdach */
  anteil: number;
  paneele: RotesPaneel[];
  /** Referenzebene (Orientierung): Umriss des Grundstücks und absolute Höhe; null = keine */
  referenz: { plot: Vec2[]; hoehe: number } | null;
  dark: boolean;
}

const FARBE: [number, number, number] = [110, 185, 255];

export class HuelleLayer {
  private prims: Primitive[] = [];
  private ents: Entity[] = [];

  constructor(private viewer: Viewer) {}

  weg() {
    this.prims.forEach((p) => this.viewer.scene.primitives.remove(p));
    this.prims = [];
    this.ents.forEach((e) => this.viewer.entities.remove(e));
    this.ents = [];
    this.viewer.scene.requestRender();
  }

  /** Nur die roten Paneele und die Referenzebene neu (beim Ziehen eines Gebäudes), der Glaskörper bleibt. */
  zeigeRot(paneele: RotesPaneel[]) {
    this.rot.forEach((e) => this.viewer.entities.remove(e));
    this.rot = [];
    for (const p of paneele) {
      const pos = p.pts.map((q, i) => localToCartesian(q, p.oben[i]));
      this.rot.push(this.viewer.entities.add({
        wall: { positions: pos, minimumHeights: p.unten, maximumHeights: p.oben, material: Color.fromCssColorString('#FF1A12').withAlpha(0.95), outline: true, outlineColor: Color.fromCssColorString('#FFD0CC'), outlineWidth: 2 },
      }));
    }
    this.viewer.scene.requestRender();
  }
  private rot: Entity[] = [];

  zeige(a: HuelleAnzeige) {
    this.weg();
    this.glas(a);
    if (a.referenz) this.ebene(a.referenz, a.dark);
    this.zeigeRot(a.paneele);
  }

  /** Nur den Glaskörper neu (z. B. anderes Dach). */
  glasNeu(a: HuelleAnzeige) {
    this.prims.forEach((p) => this.viewer.scene.primitives.remove(p));
    this.prims = [];
    this.glas(a);
  }

  private glas(a: HuelleAnzeige) {
    const { raster: r, boden, anteil } = a;
    // Anzeigeraster: höchstens ~9000 Zellen (bei großen Grundstücken gröber)
    const stride = Math.max(1, Math.ceil(Math.sqrt((r.nx * r.ny) / 9000)));
    const gx = Math.floor((r.nx - 1) / stride) + 1;
    const gy = Math.floor((r.ny - 1) / stride) + 1;
    const hoehe = (i: number, j: number) => r.h[Math.min(r.ny - 1, j * stride) * r.nx + Math.min(r.nx - 1, i * stride)];
    const wand = (h: number) => Math.max(0.05, h - anteil);
    const ok = (i: number, j: number) => hoehe(i, j) > 0;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const vid = new Map<string, number>();
    const punkt = (i: number, j: number, z: 'boden' | 'oben', alpha: number): number => {
      const k = `${i},${j},${z},${alpha}`;
      const v = vid.get(k);
      if (v != null) return v;
      const p: Vec2 = [r.x0 + Math.min(r.nx - 1, i * stride) * r.step, r.y0 + Math.min(r.ny - 1, j * stride) * r.step];
      const g = boden(p);
      const c = localToCartesian(p, z === 'boden' ? g : g + wand(hoehe(i, j)));
      pos.push(c.x, c.y, c.z);
      col.push(FARBE[0], FARBE[1], FARBE[2], Math.round(255 * alpha));
      const n = pos.length / 3 - 1;
      vid.set(k, n);
      return n;
    };
    // Abstand zum Rand der zulässigen Fläche in Zellen (für die auslaufende Deckkraft)
    const randNah = (i: number, j: number): number => {
      for (let d = 1; d <= 3; d++) for (let dj = -d; dj <= d; dj++) for (let di = -d; di <= d; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== d) continue;
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= gx || jj >= gy || !ok(ii, jj)) return d;
      }
      return 4;
    };
    const topAlpha = (i: number, j: number) => 0.1 + 0.2 * Math.min(1, (randNah(i, j) - 1) / 3);
    const quad = (i: number, j: number) => ok(i, j) && ok(i + 1, j) && ok(i, j + 1) && ok(i + 1, j + 1);
    for (let j = 0; j < gy - 1; j++) {
      for (let i = 0; i < gx - 1; i++) {
        if (!quad(i, j)) continue;
        const a0 = punkt(i, j, 'oben', topAlpha(i, j));
        const a1 = punkt(i + 1, j, 'oben', topAlpha(i + 1, j));
        const a2 = punkt(i + 1, j + 1, 'oben', topAlpha(i + 1, j + 1));
        const a3 = punkt(i, j + 1, 'oben', topAlpha(i, j + 1));
        idx.push(a0, a1, a2, a0, a2, a3);
        // Schürzen an Seiten ohne Nachbarquad: oben mit Deckkraft 0,26, unten durchsichtig
        const seiten: [number, number, number, number, number, number][] = [
          [i, j, i + 1, j, i, j - 1], // Süd
          [i + 1, j, i + 1, j + 1, i + 1, j], // Ost
          [i + 1, j + 1, i, j + 1, i, j + 1], // Nord
          [i, j + 1, i, j, i - 1, j], // West
        ];
        for (const [x0, y0, x1, y1, qi, qj] of seiten) {
          if (qi >= 0 && qj >= 0 && qi < gx - 1 && qj < gy - 1 && quad(qi, qj)) continue;
          const o0 = punkt(x0, y0, 'oben', 0.26);
          const o1 = punkt(x1, y1, 'oben', 0.26);
          const b0 = punkt(x0, y0, 'boden', 0);
          const b1 = punkt(x1, y1, 'boden', 0);
          idx.push(b0, b1, o1, b0, o1, o0);
        }
      }
    }
    if (!idx.length) return;
    const position = new Float64Array(pos);
    const attributes = new GeometryAttributes();
    attributes.position = new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: position });
    attributes.color = new GeometryAttribute({ componentDatatype: ComponentDatatype.UNSIGNED_BYTE, componentsPerAttribute: 4, normalize: true, values: new Uint8Array(col) });
    const geometry = new Geometry({
      attributes,
      indices: new Uint32Array(idx),
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: BoundingSphere.fromVertices(Array.from(position)),
    });
    const prim = new Primitive({
      geometryInstances: new GeometryInstance({ geometry }),
      appearance: new PerInstanceColorAppearance({ flat: true, translucent: true, closed: false, faceForward: false }),
      asynchronous: false,
      allowPicking: false,
      releaseGeometryInstances: true,
    });
    this.viewer.scene.primitives.add(prim);
    this.prims.push(prim);
    this.viewer.scene.requestRender();
  }

  private ebene(ref: { plot: Vec2[]; hoehe: number }, dark: boolean) {
    const col = dark ? Color.fromCssColorString('#E7ECE8') : Color.fromCssColorString('#1D2321');
    const ring = [...ref.plot, ref.plot[0]].map((p) => localToCartesian(p, ref.hoehe));
    this.ents.push(this.viewer.entities.add({
      polyline: { positions: ring, width: 2, material: new PolylineDashMaterialProperty({ color: col, dashLength: 14 }) },
    }));
    this.ents.push(this.viewer.entities.add({
      polygon: { hierarchy: new PolygonHierarchy(ref.plot.map((p) => localToCartesian(p, ref.hoehe))), perPositionHeight: true, material: col.withAlpha(0.05) },
    }));
    // Beschriftung an der nördlichsten Ecke
    const n = ref.plot.reduce((a, b) => (b[1] > a[1] ? b : a));
    this.ents.push(this.viewer.entities.add({
      position: localToCartesian(n, ref.hoehe),
      label: { text: 'Orientierung: mittlere Traufhöhe der Umgebung', font: '600 13px sans-serif', fillColor: col, outlineColor: dark ? Color.BLACK : Color.WHITE, outlineWidth: 4, style: 2, pixelOffset: { x: 0, y: -14 } as never, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    }));
  }
}

export { Cartesian3, ClassificationType };
