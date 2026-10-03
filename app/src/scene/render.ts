/**
 * Zeichnet Grundstück, Abstandsbänder, Objekte, Bestand, Fenster und Maßkette in Cesium.
 * Alle Geometrien hängen über CallbackProperty am App-Zustand und folgen ihm ohne Neuaufbau.
 */
import {
  CallbackPositionProperty,
  CallbackProperty,
  ClassificationType,
  ColorMaterialProperty,
  ConstantProperty,
  Entity,
  PolylineDashMaterialProperty,
  SceneTransforms,
  type CesiumWidget as Viewer,
} from '@cesium/engine';
import {
  Color,
  PolygonHierarchy,
  type Cartesian3,
} from '@cesium/core';
import {
  edges,
  footprint,
  type Bestand,
  type NeighborWindow,
  type ObjectKind,
  type Placed,
  type Result,
  type Vec2,
} from '../rules';
import { localToCartesian } from './coords';
import type { Terrain } from './terrain';

export const PAL = {
  light: { balsa: '#D8B98E', balsaDark: '#C29E70', white: '#F3F3F0', red: '#C9302A', ok: '#2E7D5B', warn: '#A06410', ink: '#1D2321', band: '#1D2321', user: '#2B59C3', muted: '#5C6662' },
  dark: { balsa: '#C4A174', balsaDark: '#A6855B', white: '#8E9691', red: '#F0605A', ok: '#4CC38A', warn: '#E3A43C', ink: '#E7ECE8', band: '#E7ECE8', user: '#8FAEFF', muted: '#9AA59F' },
};
export type Palette = typeof PAL.light;

export interface RenderState {
  step: 'start' | 'grenze' | 'pruefen';
  draft: Vec2[];
  plot: Vec2[] | null;
  objs: Record<ObjectKind, Placed> | null;
  selected: ObjectKind;
  res: Record<ObjectKind, Result> | null;
  bestand: (Bestand & { status: 'aktiv' | 'entfernt' })[];
  windows: NeighborWindow[];
  dark: boolean;
}

const KEY = 'passtKey';

/** Rechteck um `grow` Meter vergrößert (Dachüberstand). */
function grown(o: Placed, grow: number): Vec2[] {
  return footprint({ ...o, w: o.w + 2 * grow, d: o.d + 2 * grow });
}

function inset(o: Placed, sx: number, sy: number, size: number): Vec2[] {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const x = sx * (o.w / 2 - 0.12);
  const y = sy * (o.d / 2 - 0.12);
  const center: Vec2 = [o.center[0] + x * c - y * s, o.center[1] + x * s + y * c];
  return footprint({ center, w: size, d: size, angle: o.angle });
}

export class Renderer {
  private objectEntities: Entity[] = [];
  private bestandEntities: Entity[] = [];
  private windowEntities: Entity[] = [];
  private draftEntities: Entity[] = [];
  private plotEntities: Entity[] = [];
  private dimMid: Vec2 | null = null;
  private dimLabel = '';

  constructor(private viewer: Viewer, private terrain: Terrain, private s: () => RenderState, private dimEl: HTMLElement) {
    viewer.scene.postRender.addEventListener(() => this.placeLabel());
    this.buildDraft();
    this.buildObjects();
    this.buildDim();
  }

  private pal(): Palette {
    return this.s().dark ? PAL.dark : PAL.light;
  }

  private ground(p: Vec2): number {
    return this.terrain.heightOrCoarse(p);
  }

  base(o: Placed): number {
    if (o.baseElevation != null) return o.baseElevation;
    return Math.max(...footprint(o).map((p) => this.ground(p)));
  }

  private cart(poly: Vec2[], h = 0): Cartesian3[] {
    return poly.map((p) => localToCartesian(p, h));
  }

  private color(fn: () => Color) {
    return new ColorMaterialProperty(new CallbackProperty(fn, false));
  }

  /* ---------- Grenze setzen ---------- */
  private buildDraft() {
    const v = this.viewer;
    const line = v.entities.add({
      polyline: {
        positions: new CallbackProperty(() => {
          const st = this.s();
          if (st.step !== 'grenze' || st.draft.length < 2) return [];
          const pts = [...st.draft, st.draft[0]];
          return this.cart(pts, 0);
        }, false),
        width: 3,
        clampToGround: true,
        classificationType: ClassificationType.TERRAIN,
        material: this.color(() => Color.fromCssColorString(this.pal().red)),
      },
    });
    this.draftEntities.push(line);
  }

  /** Punkte der Grenze neu zeichnen (wenige, deshalb einfacher Neuaufbau). */
  syncDraftPoints() {
    const v = this.viewer;
    this.draftEntities.splice(1).forEach((e) => v.entities.remove(e));
    const st = this.s();
    if (st.step !== 'grenze') return this.viewer.scene.requestRender();
    st.draft.forEach((p, i) => {
      this.draftEntities.push(
        v.entities.add({
          position: localToCartesian(p, this.ground(p) + 0.2),
          point: {
            pixelSize: i === 0 ? 14 : 11,
            color: Color.fromCssColorString(this.pal().red),
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    });
    v.scene.requestRender();
  }

  /* ---------- Grundstück und Bänder ---------- */
  syncPlot(segmentSideBad: () => Set<number>) {
    const v = this.viewer;
    this.plotEntities.forEach((e) => v.entities.remove(e));
    this.plotEntities = [];
    const plot = this.s().plot;
    if (!plot) return;
    this.plotEntities.push(
      v.entities.add({
        polyline: {
          positions: this.cart([...plot, plot[0]]),
          width: 4,
          clampToGround: true,
          classificationType: ClassificationType.TERRAIN,
          material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString(this.pal().red), dashLength: 18 }),
        },
      }),
    );
    // 3-m-Bänder innen an jeder Grenzstrecke
    const cx = plot.reduce((a, p) => a + p[0], 0) / plot.length;
    const cy = plot.reduce((a, p) => a + p[1], 0) / plot.length;
    edges(plot).forEach(([a, b], i) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      let nx = -(b[1] - a[1]) / L;
      let ny = (b[0] - a[0]) / L;
      if (nx * (cx - a[0]) + ny * (cy - a[1]) < 0) {
        nx = -nx;
        ny = -ny;
      }
      const band: Vec2[] = [a, b, [b[0] + nx * 3, b[1] + ny * 3], [a[0] + nx * 3, a[1] + ny * 3]];
      this.plotEntities.push(
        v.entities.add({
          polygon: {
            hierarchy: new PolygonHierarchy(this.cart(band)),
            classificationType: ClassificationType.TERRAIN,
            material: this.color(() => {
              const bad = segmentSideBad().has(i);
              return Color.fromCssColorString(bad ? this.pal().red : this.pal().band).withAlpha(bad ? 0.32 : 0.1);
            }),
          },
        }),
      );
    });
    v.scene.requestRender();
  }

  /* ---------- Objekte ---------- */
  private extruded(key: ObjectKind | string, poly: () => Vec2[] | null, from: () => number, to: () => number, color: () => Color) {
    const e = this.viewer.entities.add({
      polygon: {
        hierarchy: new CallbackProperty(() => {
          const p = poly();
          return new PolygonHierarchy(p ? this.cart(p) : []);
        }, false),
        // Solange das Objekt nicht platziert ist, nichts aus dem Zustand lesen
        height: new CallbackProperty(() => (poly() ? from() : 0), false),
        extrudedHeight: new CallbackProperty(() => (poly() ? to() : 0), false),
        material: this.color(color),
        show: new CallbackProperty(() => poly() != null, false),
      },
    });
    e.addProperty(KEY);
    (e as unknown as Record<string, unknown>)[KEY] = new ConstantProperty(key);
    return e;
  }

  private buildObjects() {
    const st = this.s;
    const obj = (k: ObjectKind) => (st().step === 'pruefen' && st().objs ? st().objs![k] : null);
    const sel = (k: ObjectKind, c: string) => () => {
      const col = Color.fromCssColorString(c);
      return st().selected === k ? col : Color.lerp(col, Color.fromCssColorString(this.s().dark ? '#121614' : '#ffffff'), 0.25, new Color());
    };
    // Gartenhaus: Körper + Dachplatte
    this.objectEntities.push(
      this.extruded('gartenhaus', () => (obj('gartenhaus') ? footprint(obj('gartenhaus')!) : null), () => this.base(obj('gartenhaus')!), () => this.base(obj('gartenhaus')!) + obj('gartenhaus')!.h, sel('gartenhaus', this.pal().balsa)),
      this.extruded('gartenhaus', () => (obj('gartenhaus') ? grown(obj('gartenhaus')!, 0.15) : null), () => this.base(obj('gartenhaus')!) + obj('gartenhaus')!.h, () => this.base(obj('gartenhaus')!) + obj('gartenhaus')!.h + 0.12, sel('gartenhaus', this.pal().balsaDark)),
    );
    // Carport: vier Pfosten + Dach
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      this.objectEntities.push(
        this.extruded('carport', () => (obj('carport') ? inset(obj('carport')!, sx, sy, 0.12) : null), () => this.base(obj('carport')!), () => this.base(obj('carport')!) + obj('carport')!.h, sel('carport', this.pal().balsa)),
      );
    }
    this.objectEntities.push(
      this.extruded('carport', () => (obj('carport') ? grown(obj('carport')!, 0.1) : null), () => this.base(obj('carport')!) + obj('carport')!.h, () => this.base(obj('carport')!) + obj('carport')!.h + 0.16, sel('carport', this.pal().balsaDark)),
      this.extruded('waermepumpe', () => (obj('waermepumpe') ? footprint(obj('waermepumpe')!) : null), () => this.base(obj('waermepumpe')!), () => this.base(obj('waermepumpe')!) + obj('waermepumpe')!.h, sel('waermepumpe', this.pal().white)),
    );
    // Schallkreis um die Wärmepumpe (Richtwert-Radius)
    this.viewer.entities.add({
      position: new CallbackPositionProperty(() => {
        const o = obj('waermepumpe');
        return o ? localToCartesian(o.center, this.ground(o.center)) : undefined;
      }, false),
      ellipse: {
        semiMajorAxis: new CallbackProperty(() => Math.max(0.3, st().res?.waermepumpe.rLimit ?? 1), false),
        semiMinorAxis: new CallbackProperty(() => Math.max(0.3, st().res?.waermepumpe.rLimit ?? 1), false),
        classificationType: ClassificationType.TERRAIN,
        material: this.color(() => {
          const r = st().res?.waermepumpe.status;
          const c = r === 'bad' ? this.pal().red : r === 'warn' ? this.pal().warn : this.pal().ok;
          return Color.fromCssColorString(c).withAlpha(0.18);
        }),
        show: new CallbackProperty(() => st().step === 'pruefen' && st().selected === 'waermepumpe', false),
      },
    });
  }

  /** Bestand und Fenster (ändern sich selten). */
  syncContext() {
    const v = this.viewer;
    [...this.bestandEntities, ...this.windowEntities].forEach((e) => v.entities.remove(e));
    this.bestandEntities = [];
    this.windowEntities = [];
    const st = this.s();
    if (st.step !== 'pruefen') return v.scene.requestRender();
    for (const b of st.bestand) {
      if (b.status === 'entfernt') continue;
      const base = Math.min(...b.footprint.map((p) => this.ground(p)));
      const conf = b.provenance === 'nutzerbestätigt';
      const e = v.entities.add({
        polygon: {
          hierarchy: new PolygonHierarchy(this.cart(b.footprint)),
          height: base,
          extrudedHeight: base + b.height,
          material: Color.fromCssColorString(conf ? this.pal().user : this.pal().warn).withAlpha(conf ? 0.75 : 0.55),
        },
      });
      e.addProperty(KEY);
      (e as unknown as Record<string, unknown>)[KEY] = new ConstantProperty(`bestand:${b.id}`);
      this.bestandEntities.push(e);
    }
    for (const w of st.windows) {
      this.windowEntities.push(
        v.entities.add({
          position: localToCartesian(w.pos, this.ground(w.pos) + w.z),
          point: {
            pixelSize: w.provenance === 'Annahme' ? 9 : 12,
            color: Color.fromCssColorString(w.provenance === 'Annahme' ? this.pal().muted : this.pal().user),
            outlineColor: Color.WHITE,
            outlineWidth: 1.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    }
    v.scene.requestRender();
  }

  /* ---------- Maßkette ---------- */
  private buildDim() {
    const st = this.s;
    this.viewer.entities.add({
      polyline: {
        positions: new CallbackProperty(() => {
          const s = st();
          const d = s.step === 'pruefen' ? s.res?.[s.selected].dim : null;
          if (!d) return [];
          return this.cart([d.p, d.q]);
        }, false),
        width: 3,
        clampToGround: true,
        classificationType: ClassificationType.TERRAIN,
        material: this.color(() => Color.fromCssColorString(this.pal().ink)),
      },
    });
  }

  updateDim() {
    const s = this.s();
    const d = s.step === 'pruefen' ? s.res?.[s.selected].dim : null;
    this.dimMid = d ? [(d.p[0] + d.q[0]) / 2, (d.p[1] + d.q[1]) / 2] : null;
    this.dimLabel = d?.label ?? '';
  }

  private placeLabel() {
    if (!this.dimMid) {
      this.dimEl.hidden = true;
      return;
    }
    const w = localToCartesian(this.dimMid, this.ground(this.dimMid) + 0.1);
    const px = SceneTransforms.worldToWindowCoordinates(this.viewer.scene, w);
    if (!px) {
      this.dimEl.hidden = true;
      return;
    }
    this.dimEl.hidden = false;
    this.dimEl.textContent = this.dimLabel;
    this.dimEl.style.transform = `translate(${px.x}px,${px.y}px) translate(-50%,-50%)`;
  }

  /** Welcher App-Schlüssel steckt hinter einem Pick? */
  static keyOf(picked: unknown): string | null {
    const id = (picked as { id?: Record<string, unknown> } | undefined)?.id;
    const prop = id?.[KEY] as ConstantProperty | undefined;
    return prop ? (prop.getValue() as string) : null;
  }
}
