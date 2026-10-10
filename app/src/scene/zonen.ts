/**
 * „Wo darf es hin?“ in der Szene: fragt den Web Worker (lazy geladen), zeigt das Ergebnis als Farbbild am Boden
 * (genau auf einem geografischen Rechteck, damit es auf dem Luftbild sitzt) und merkt sich die beste Stelle.
 */
import { ClassificationType, ImageMaterialProperty, type Entity, type CesiumWidget as Viewer } from '@cesium/engine';
import { Color, Rectangle, Math as CMath } from '@cesium/core';
import type { Objects, RasterGeometrie, Site, Vec2, Vorhaben, ZonenErgebnis } from '../rules';
import type { ZonenAnfrage } from '../rules/zonen.worker';
import { lonLatToLocal, localToLonLat } from './coords';

const ZELLE = 0.25;
const RAND = 1.0;

export interface ZonenAnzeige extends ZonenErgebnis {
  /** Zeit inkl. Übertragung zum Worker und zurück */
  msGesamt: number;
}

let worker: Worker | null = null;
let naechste = 0;
const warten = new Map<number, (r: ZonenAnzeige) => void>();

function holeWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../rules/zonen.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<ZonenErgebnis & { id: number }>) => {
      const cb = warten.get(e.data.id);
      warten.delete(e.data.id);
      cb?.({ ...e.data, msGesamt: 0 });
    };
  }
  return worker;
}

/** Rastergeometrie (geografisch ausgerichtet) für ein Grundstück. */
export function geometrieFuer(boundary: Vec2[]): { geo: RasterGeometrie; rect: [number, number, number, number] } {
  const xs = boundary.map((p) => p[0]);
  const ys = boundary.map((p) => p[1]);
  const ecken: Vec2[] = [
    [Math.min(...xs) - RAND, Math.min(...ys) - RAND], [Math.max(...xs) + RAND, Math.min(...ys) - RAND],
    [Math.max(...xs) + RAND, Math.max(...ys) + RAND], [Math.min(...xs) - RAND, Math.max(...ys) + RAND],
  ];
  const ll = ecken.map(localToLonLat);
  const w = Math.min(...ll.map((p) => p[0]));
  const e = Math.max(...ll.map((p) => p[0]));
  const s = Math.min(...ll.map((p) => p[1]));
  const n = Math.max(...ll.map((p) => p[1]));
  const o = lonLatToLocal(w, s);
  const breite = Math.hypot(...(lonLatToLocal(e, s).map((v, i) => v - o[i]) as Vec2));
  const hoehe = Math.hypot(...(lonLatToLocal(w, n).map((v, i) => v - o[i]) as Vec2));
  const nx = Math.ceil(breite / ZELLE);
  const ny = Math.ceil(hoehe / ZELLE);
  const pe = lonLatToLocal(w + (e - w) / nx, s);
  const pn = lonLatToLocal(w, s + (n - s) / ny);
  return { geo: { o, ex: [pe[0] - o[0], pe[1] - o[1]], ey: [pn[0] - o[0], pn[1] - o[1]], nx, ny }, rect: [w, s, e, n] };
}

/** Gelände unter dem Grundstück als Raster für den Worker (0,5 m, 8 m Rand). */
function gelaende(boundary: Vec2[], height: (p: Vec2) => number) {
  const step = 0.5;
  const xs = boundary.map((p) => p[0]);
  const ys = boundary.map((p) => p[1]);
  const x0 = Math.min(...xs) - 8;
  const y0 = Math.min(...ys) - 8;
  const nx = Math.ceil((Math.max(...xs) + 8 - x0) / step) + 1;
  const ny = Math.ceil((Math.max(...ys) + 8 - y0) / step) + 1;
  const z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = height([x0 + i * step, y0 + j * step]);
  return { x0, y0, step, nx, ny, z };
}

export function berechneZonen(site: Site, objs: Objects, k: 'gartenhaus' | 'carport' | 'vorhaben', vorhaben?: Vorhaben): Promise<ZonenAnzeige & { rect: [number, number, number, number]; geo: RasterGeometrie }> {
  const t0 = performance.now();
  const { geo, rect } = geometrieFuer(site.plot.boundary);
  const { ground, ...rest } = site;
  const id = ++naechste;
  const anfrage: ZonenAnfrage = { id, site: rest, gelaende: gelaende(site.plot.boundary, ground ?? (() => 0)), objs, k, vorhaben, geo };
  return new Promise((res) => {
    warten.set(id, (r) => res({ ...r, msGesamt: performance.now() - t0, rect, geo }));
    holeWorker().postMessage(anfrage);
  });
}

const FARBEN: Record<number, [number, number, number, number]> = {
  1: [46, 160, 91, 120],
  2: [227, 164, 60, 120],
  3: [201, 48, 42, 105],
};

export class ZonenLayer {
  private entity: Entity | null = null;
  constructor(private viewer: Viewer) {}

  zeige(feld: Uint8Array, nx: number, ny: number, rect: [number, number, number, number]) {
    const cv = document.createElement('canvas');
    cv.width = nx;
    cv.height = ny;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(nx, ny);
    for (let i = 0; i < feld.length; i++) {
      const c = FARBEN[feld[i]];
      if (!c) continue;
      img.data.set(c, i * 4);
    }
    ctx.putImageData(img, 0, 0);
    this.weg();
    this.entity = this.viewer.entities.add({
      rectangle: {
        coordinates: Rectangle.fromDegrees(...rect),
        material: new ImageMaterialProperty({ image: cv, transparent: true, color: Color.WHITE }),
        classificationType: ClassificationType.BOTH,
      },
    });
    this.viewer.scene.requestRender();
  }

  weg() {
    if (this.entity) this.viewer.entities.remove(this.entity);
    this.entity = null;
    this.viewer.scene.requestRender();
  }
}

export const grad = (r: number) => Math.round(CMath.toDegrees(r));
