/**
 * Zeichnet das Haus aus einem hochgeladenen Plan (AUFTRAG_V4 C2): das Modell aus der IFC-Datei als eigenes Dreiecksnetz mit festem Licht
 * (in die Vertexfarben eingerechnet), dazu die Fenster als helle Flächen in der Fassade. Das Netz ist in Plan-Koordinaten gespeichert und
 * wird hier gedreht, verschoben und auf den Fußboden gesetzt.
 */
import { ConstantProperty, Entity, GeometryInstance, PerInstanceColorAppearance, Primitive, type CesiumWidget as Viewer } from '@cesium/engine';
import { BoundingSphere, Color, ComponentDatatype, Geometry, GeometryAttribute, GeometryAttributes, PrimitiveType } from '@cesium/core';
import type { HausFenster, HausNetz } from '../hausplan/typen';
import type { Vec2 } from '../rules';
import { localToCartesian } from './coords';
import { KEY_VORHABEN } from './vorhaben';

/** Mehr Eckpunkte stellt Passt. nicht als Netz dar (Browser, iPhone); dann bleibt der extrudierte Umriss. */
export const MAX_NETZ_PUNKTE = 120_000;

const LICHT: [number, number, number] = (() => {
  const l = Math.hypot(0.4, -0.5, 0.75);
  return [0.4 / l, -0.5 / l, 0.75 / l];
})();

export class HausPlanLayer {
  private prim: Primitive | null = null;
  private ents: Entity[] = [];

  constructor(private viewer: Viewer) {}

  weg() {
    if (this.prim) this.viewer.scene.primitives.remove(this.prim);
    this.prim = null;
    this.ents.forEach((e) => this.viewer.entities.remove(e));
    this.ents = [];
    this.viewer.scene.requestRender();
  }

  fensterAnzahl() { return this.ents.length; }

  /** Ist das Netz klein genug für die Anzeige? */
  static darstellbar(n: HausNetz | undefined): n is HausNetz {
    return !!n && n.idx.length > 0 && n.idx.length <= MAX_NETZ_PUNKTE;
  }

  zeige(netz: HausNetz, mitte: Vec2, winkel: number, fb: number, farbeUeberschreiben?: [number, number, number]) {
    this.weg();
    const c = Math.cos(winkel);
    const s = Math.sin(winkel);
    const n = netz.idx.length;
    const pos = new Float64Array(n * 3);
    const col = new Uint8Array(n * 4);
    const w = new Float64Array(3 * 3);
    const lokal = new Float64Array(9);
    for (let t = 0; t < n; t += 3) {
      for (let k = 0; k < 3; k++) {
        const v = netz.idx[t + k];
        const x = netz.pos[v * 3];
        const y = netz.pos[v * 3 + 1];
        lokal[k * 3] = x * c - y * s;
        lokal[k * 3 + 1] = x * s + y * c;
        lokal[k * 3 + 2] = netz.pos[v * 3 + 2];
        const p: Vec2 = [mitte[0] + lokal[k * 3], mitte[1] + lokal[k * 3 + 1]];
        const cart = localToCartesian(p, fb + lokal[k * 3 + 2]);
        w[k * 3] = cart.x; w[k * 3 + 1] = cart.y; w[k * 3 + 2] = cart.z;
        pos[(t + k) * 3] = cart.x; pos[(t + k) * 3 + 1] = cart.y; pos[(t + k) * 3 + 2] = cart.z;
      }
      // Flächennormale (lokal, x Ost / y Nord / z oben) für das feste Licht
      const ux = lokal[3] - lokal[0], uy = lokal[4] - lokal[1], uz = lokal[5] - lokal[2];
      const vx = lokal[6] - lokal[0], vy = lokal[7] - lokal[1], vz = lokal[8] - lokal[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const hell = 0.5 + 0.5 * Math.abs(nx * LICHT[0] + ny * LICHT[1] + nz * LICHT[2]);
      for (let k = 0; k < 3; k++) {
        const v = netz.idx[t + k];
        const f = farbeUeberschreiben ?? [netz.farbe[v * 4], netz.farbe[v * 4 + 1], netz.farbe[v * 4 + 2]];
        col[(t + k) * 4] = Math.min(255, Math.round(f[0] * hell));
        col[(t + k) * 4 + 1] = Math.min(255, Math.round(f[1] * hell));
        col[(t + k) * 4 + 2] = Math.min(255, Math.round(f[2] * hell));
        col[(t + k) * 4 + 3] = 255;
      }
    }
    const attributes = new GeometryAttributes();
    attributes.position = new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: pos });
    attributes.color = new GeometryAttribute({ componentDatatype: ComponentDatatype.UNSIGNED_BYTE, componentsPerAttribute: 4, normalize: true, values: col });
    const indices = new Uint32Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    const geometry = new Geometry({ attributes, indices, primitiveType: PrimitiveType.TRIANGLES, boundingSphere: BoundingSphere.fromVertices(Array.from(pos.subarray(0, Math.min(pos.length, 3000)))) });
    this.prim = new Primitive({
      geometryInstances: new GeometryInstance({ geometry, id: { passtKey: new ConstantProperty(KEY_VORHABEN) } }),
      appearance: new PerInstanceColorAppearance({ flat: true, translucent: false, closed: false, faceForward: false }),
      asynchronous: false,
      allowPicking: true,
      releaseGeometryInstances: true,
    });
    this.viewer.scene.primitives.add(this.prim);
    this.viewer.scene.requestRender();
  }

  /** Fenster als helle, leicht vor die Fassade gesetzte Flächen. */
  fenster(liste: HausFenster[], mitte: Vec2, winkel: number, fb: number, farbe = '#7CC4FF') {
    this.ents.forEach((e) => this.viewer.entities.remove(e));
    this.ents = [];
    const c = Math.cos(winkel);
    const s = Math.sin(winkel);
    const dreh = (p: Vec2): Vec2 => [mitte[0] + p[0] * c - p[1] * s, mitte[1] + p[0] * s + p[1] * c];
    for (const f of liste) {
      const nx = f.normal[0] * c - f.normal[1] * s;
      const ny = f.normal[0] * s + f.normal[1] * c;
      const tx = -ny;
      const ty = nx;
      const m = dreh(f.pos);
      const a: Vec2 = [m[0] - (tx * f.breite) / 2 + nx * 0.04, m[1] - (ty * f.breite) / 2 + ny * 0.04];
      const b: Vec2 = [m[0] + (tx * f.breite) / 2 + nx * 0.04, m[1] + (ty * f.breite) / 2 + ny * 0.04];
      this.ents.push(this.viewer.entities.add({
        wall: {
          positions: [localToCartesian(a, fb + f.z1), localToCartesian(b, fb + f.z1)],
          minimumHeights: [fb + f.z0, fb + f.z0],
          maximumHeights: [fb + f.z1, fb + f.z1],
          material: Color.fromCssColorString(farbe).withAlpha(0.85),
          outline: true,
          outlineColor: Color.fromCssColorString('#0B3A66'),
        },
      }));
    }
    this.viewer.scene.requestRender();
  }
}
