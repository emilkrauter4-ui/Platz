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
  dachHoehe,
  edges,
  pflanzLinie,
  type Pflanze,
  type PflanzenErgebnis,
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
  /** fotorealistisches DOM-Mesh statt LoD2 anzeigen */
  mesh: boolean;
  /** Umriss eines bestehenden Objekts wird nachgezogen (ref = erkannter Umriss als Hilfslinie) */
  kante: { id: string; fp: Vec2[]; ref: Vec2[] } | null;
  /** neues Objekt wird gezeichnet (getippte Ecken) */
  zeichnen: Vec2[] | null;
  /** Abstandsflächen am Boden zeigen */
  showAF: boolean;
  /** Reiter „Hecke, Baum“: geplante Pflanze und Ergebnis nach AGBGB */
  modus: 'objekt' | 'pflanzen';
  pflanze: Pflanze | null;
  pflanzRes: PflanzenErgebnis | null;
  /** 'nachbar' = Ansicht über einen Nachbar-Link: nur lesen, nur die geteilten Objekte */
  ansicht: 'eigen' | 'nachbar';
  sichtbar: ObjectKind[] | null;
  /** Schatten am Boden (Nachbar-Link): Vorhaben kräftig, Häuser blass */
  schatten: { poly: Vec2[]; vorhaben: boolean }[];
  /** Blickpunkt des Nachbarn */
  blick: { p: Vec2; z: number; annahme: boolean } | null;
}

/** Maßkette des gerade gewählten Reiters. */
function dimOf(s: RenderState) {
  if (s.step !== 'pruefen' || s.ansicht === 'nachbar') return null;
  return s.modus === 'pflanzen' ? s.pflanzRes?.dim ?? null : s.res?.[s.selected].dim ?? null;
}

/** Achteck um p (Krone, Stamm). */
function achteck(p: Vec2, r: number): Vec2[] {
  return Array.from({ length: 8 }, (_, i) => [p[0] + r * Math.cos((i * Math.PI) / 4), p[1] + r * Math.sin((i * Math.PI) / 4)] as Vec2);
}

/** Farben der Garten-Klassen (Bauten nach Herkunft, siehe syncContext). */
const KLASSE_FARBE: Partial<Record<string, string>> = {
  pool: '#2E8BC0', teich: '#2E6FA0', terrasse: '#9A9A92', trampolin: '#6B5B95', spielturm: '#B07D3C',
  hecke: '#4C8A3F', baum: '#3F7A35', strauch: '#6FA35A', zaun_mauer: '#8A7B6B', waermepumpe: '#7A7F86',
};
const FLACH = new Set(['pool', 'teich', 'terrasse', 'trampolin']);

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
  private editEntities: Entity[] = [];
  private plotEntities: Entity[] = [];
  private schattenEntities: Entity[] = [];
  private dimMid: Vec2 | null = null;
  private dimLabel = '';

  constructor(private viewer: Viewer, private terrain: Terrain, private s: () => RenderState, private dimEl: HTMLElement) {
    viewer.scene.postRender.addEventListener(() => this.placeLabel());
    this.buildDraft();
    this.buildObjects();
    this.buildDim();
    this.buildPflanze();
  }

  /** Bodenlinien und -flächen liegen auf dem Gelände, mit Foto-Mesh auch auf dem Mesh. */
  private cls() {
    return new CallbackProperty(() => (this.s().mesh ? ClassificationType.BOTH : ClassificationType.TERRAIN), false);
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
        classificationType: this.cls(),
        material: this.color(() => Color.fromCssColorString(this.pal().red)),
      },
    });
    this.draftEntities.push(line);
  }

  /** Nachziehen und Zeichnen: Linie, Griffe an den Ecken, erkannter Umriss gestrichelt als Hilfslinie. */
  syncEdit() {
    const v = this.viewer;
    this.editEntities.forEach((e) => v.entities.remove(e));
    this.editEntities = [];
    const st = this.s();
    const pts = st.kante?.fp ?? st.zeichnen;
    if (pts && pts.length) {
      if (st.kante) {
        this.editEntities.push(v.entities.add({
          polyline: {
            positions: this.cart([...st.kante.ref, st.kante.ref[0]]),
            width: 2,
            clampToGround: true,
            classificationType: this.cls(),
            material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString(this.pal().warn), dashLength: 10 }),
          },
        }));
      }
      if (pts.length >= 2) {
        this.editEntities.push(v.entities.add({
          polyline: {
            positions: this.cart(st.kante || pts.length >= 3 ? [...pts, pts[0]] : pts),
            width: 3,
            clampToGround: true,
            classificationType: this.cls(),
            material: Color.fromCssColorString(this.pal().user),
          },
        }));
      }
      pts.forEach((p, i) => {
        const e = v.entities.add({
          position: localToCartesian(p, this.ground(p) + 0.2),
          point: {
            pixelSize: 16,
            color: Color.fromCssColorString(this.pal().user),
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        e.addProperty(KEY);
        (e as unknown as Record<string, unknown>)[KEY] = new ConstantProperty(`ecke:${i}`);
        this.editEntities.push(e);
      });
    }
    v.scene.requestRender();
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
          classificationType: this.cls(),
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
            classificationType: this.cls(),
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
    const obj = (k: ObjectKind) => (st().step === 'pruefen' && st().objs && (!st().sichtbar || st().sichtbar!.includes(k)) ? st().objs![k] : null);
    const sel = (k: ObjectKind, c: string) => () => {
      const col = Color.fromCssColorString(c);
      return st().selected === k ? col : Color.lerp(col, Color.fromCssColorString(this.s().dark ? '#121614' : '#ffffff'), 0.25, new Color());
    };
    // Gartenhaus: Körper + Dachplatte (Flachdach) bzw. Satteldach mit Giebeln
    const gh = () => obj('gartenhaus');
    const flachdach = () => (gh() && !((gh()!.neigung ?? 0) > 0) ? grown(gh()!, 0.15) : null);
    this.objectEntities.push(
      this.extruded('gartenhaus', () => (gh() ? footprint(gh()!) : null), () => this.base(gh()!), () => this.base(gh()!) + gh()!.h, sel('gartenhaus', this.pal().balsa)),
      this.extruded('gartenhaus', flachdach, () => this.base(gh()!) + gh()!.h, () => this.base(gh()!) + gh()!.h + 0.12, sel('gartenhaus', this.pal().balsaDark)),
    );
    for (const seite of [0, 1]) this.objectEntities.push(this.dachflaeche(gh, seite, sel('gartenhaus', this.pal().balsaDark)));
    for (const seite of [1, 3]) this.objectEntities.push(this.giebel(gh, seite, sel('gartenhaus', this.pal().balsa)));
    this.buildAF();
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
        classificationType: this.cls(),
        material: this.color(() => {
          const r = st().res?.waermepumpe.status;
          const c = r === 'bad' ? this.pal().red : r === 'warn' ? this.pal().warn : this.pal().ok;
          return Color.fromCssColorString(c).withAlpha(0.18);
        }),
        show: new CallbackProperty(() => st().step === 'pruefen' && st().ansicht === 'eigen' && st().modus === 'objekt' && st().selected === 'waermepumpe', false),
      },
    });
  }

  /** Geplante Pflanze: Hecke als grüner Block entlang der Pflanzreihe, Baum als Stamm + Krone, Strauch als Krone. */
  private buildPflanze() {
    const st = this.s;
    const p = () => (st().step === 'pruefen' && (st().modus === 'pflanzen' || st().ansicht === 'nachbar') ? st().pflanze : null);
    const gruen = () => Color.fromCssColorString(st().pflanzRes?.status === 'bad' ? this.pal().red : '#4C8A3F').withAlpha(0.85);
    const braun = () => Color.fromCssColorString('#7A5A3A');
    const boden = (q: Pflanze) => this.ground(q.center);
    this.objectEntities.push(
      this.extruded('pflanze', () => {
        const q = p();
        if (!q) return null;
        if (q.art === 'hecke') {
          const [a, b] = pflanzLinie(q);
          return footprint({ center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], w: Math.max(q.laenge, 0.6), d: 0.6, angle: q.angle });
        }
        return achteck(q.center, q.art === 'baum' ? 0.15 : Math.min(1.2, Math.max(0.4, q.hoehe / 3)));
      }, () => boden(p()!), () => boden(p()!) + (p()!.art === 'baum' ? p()!.hoehe * 0.45 : p()!.hoehe), () => (p()?.art === 'baum' ? braun() : gruen())),
      this.extruded('pflanze', () => {
        const q = p();
        return q?.art === 'baum' ? achteck(q.center, Math.max(0.8, q.hoehe / 3)) : null;
      }, () => boden(p()!) + p()!.hoehe * 0.45, () => boden(p()!) + p()!.hoehe, gruen),
    );
  }

  /** Satteldach: First entlang der Breite w, Traufen an Kante 0 und 2 (wie rules/abstand.ts). */
  private dachflaeche(o: () => Placed | null, seite: number, col: () => Color) {
    const e = this.viewer.entities.add({
      polygon: {
        hierarchy: new CallbackProperty(() => {
          const x = o();
          if (!x || !((x.neigung ?? 0) > 0)) return new PolygonHierarchy([]);
          const g = grown(x, 0.15);
          const top = this.base(x) + x.h;
          const dh = dachHoehe(x) + (0.15 * Math.tan(((x.neigung ?? 0) * Math.PI) / 180));
          const mid = (p: Vec2, q: Vec2): Vec2 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          const [p0, p1, p2, p3] = g;
          const r0 = mid(p0, p3);
          const r1 = mid(p1, p2);
          const pts = seite === 0 ? [[p0, 0], [p1, 0], [r1, dh], [r0, dh]] : [[p2, 0], [p3, 0], [r0, dh], [r1, dh]];
          return new PolygonHierarchy(pts.map(([p, z]) => localToCartesian(p as Vec2, top + (z as number))));
        }, false),
        perPositionHeight: true,
        material: this.color(col),
      },
    });
    (e as unknown as Record<string, unknown>)[KEY] = new ConstantProperty('gartenhaus');
    return e;
  }

  private giebel(o: () => Placed | null, kante: number, col: () => Color) {
    const e = this.viewer.entities.add({
      wall: {
        positions: new CallbackProperty(() => {
          const x = o();
          if (!x || !((x.neigung ?? 0) > 0)) return [];
          const f = footprint(x);
          const a = f[kante];
          const b = f[(kante + 1) % 4];
          return [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Vec2, b].map((p) => localToCartesian(p, 0));
        }, false),
        minimumHeights: new CallbackProperty(() => {
          const x = o();
          return x && (x.neigung ?? 0) > 0 ? [0, 0, 0].map(() => this.base(x) + x.h) : [];
        }, false),
        show: new CallbackProperty(() => { const x = o(); return !!x && (x.neigung ?? 0) > 0; }, false),
        maximumHeights: new CallbackProperty(() => {
          const x = o();
          if (!x || !((x.neigung ?? 0) > 0)) return [];
          const top = this.base(x) + x.h;
          return [top, top + dachHoehe(x), top];
        }, false),
        material: this.color(col),
      },
    });
    (e as unknown as Record<string, unknown>)[KEY] = new ConstantProperty('gartenhaus');
    return e;
  }

  /** Abstandsflächen am Boden: vier je Objekt (rot = Verstoß, grün = auf dem Grundstück, grau = nicht nötig nach Abs. 7)
   * und die des eigenen Hauses (blass). Feste Plätze mit CallbackProperty, damit beim Ziehen nichts neu aufgebaut wird. */
  private buildAF() {
    const st = this.s;
    const res = () => {
      const s = st();
      if (s.step !== 'pruefen' || !s.res || s.selected === 'waermepumpe' || s.kante || s.zeichnen) return null;
      return s.res[s.selected].af ?? null;
    };
    for (let i = 0; i < 4; i++) {
      this.viewer.entities.add({
        polygon: {
          hierarchy: new CallbackProperty(() => new PolygonHierarchy(res()?.flaechen[i] ? this.cart(res()!.flaechen[i].poly) : []), false),
          classificationType: this.cls(),
          material: this.color(() => {
            const f = res()?.flaechen[i];
            const c = !f ? this.pal().muted : f.status === 'bad' ? this.pal().red : f.status === 'ok' ? this.pal().ok : this.pal().muted;
            return Color.fromCssColorString(c).withAlpha(f?.status === 'bad' ? 0.4 : f?.status === 'ok' ? 0.3 : 0.22);
          }),
          show: new CallbackProperty(() => !!res()?.flaechen[i] && this.s().showAF && this.s().modus === 'objekt', false),
        },
      });
      this.viewer.entities.add({
        polyline: {
          positions: new CallbackProperty(() => {
            const f = res()?.flaechen[i];
            return f && this.s().showAF && this.s().modus === 'objekt' ? this.cart([...f.poly, f.poly[0]]) : [];
          }, false),
          width: 2,
          clampToGround: true,
          classificationType: this.cls(),
          material: this.color(() => {
            const f = res()?.flaechen[i];
            return Color.fromCssColorString(!f ? this.pal().muted : f.status === 'bad' ? this.pal().red : f.status === 'ok' ? this.pal().ok : this.pal().muted);
          }),
        },
      });
    }
    for (let i = 0; i < 64; i++) {
      this.viewer.entities.add({
        polygon: {
          hierarchy: new CallbackProperty(() => new PolygonHierarchy(res()?.haus[i] ? this.cart(res()!.haus[i]) : []), false),
          classificationType: this.cls(),
          material: this.color(() => Color.fromCssColorString(this.pal().user).withAlpha(0.15)),
          show: new CallbackProperty(() => !!res()?.haus[i] && !res()!.privilegiert && this.s().showAF && this.s().modus === 'objekt', false),
        },
      });
    }
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
      if (b.status === 'entfernt' || st.kante?.id === b.id) continue;
      const base = Math.min(...b.footprint.map((p) => this.ground(p)));
      const conf = b.provenance === 'nutzerbestätigt' || b.provenance === 'erfasst per Tipp';
      const hinweis = b.provenance === 'erkannt';
      const farbe = b.kind && KLASSE_FARBE[b.kind];
      // Automatische Hinweise: nur blass am Boden, nie als Körper – sie sind nicht geprüft
      const e = hinweis
        ? v.entities.add({
          polygon: {
            hierarchy: new PolygonHierarchy(this.cart(b.footprint)),
            classificationType: this.cls(),
            material: Color.fromCssColorString(this.pal().warn).withAlpha(0.28),
          },
        })
        : farbe && FLACH.has(b.kind!)
        ? v.entities.add({
          polygon: {
            hierarchy: new PolygonHierarchy(this.cart(b.footprint)),
            classificationType: this.cls(),
            material: Color.fromCssColorString(farbe).withAlpha(conf ? 0.7 : 0.5),
          },
        })
        : v.entities.add({
          polygon: {
            hierarchy: new PolygonHierarchy(this.cart(b.footprint)),
            height: base,
            extrudedHeight: base + Math.max(b.hoehe?.wert ?? b.height, 0.3),
            material: farbe
              ? Color.fromCssColorString(farbe).withAlpha(0.35)
              : Color.fromCssColorString(conf ? this.pal().user : this.pal().warn).withAlpha(conf ? 0.75 : 0.55),
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

  /* ---------- Nachbar-Link: Schatten und Blickpunkt ---------- */
  syncSchatten() {
    const v = this.viewer;
    this.schattenEntities.forEach((e) => v.entities.remove(e));
    this.schattenEntities = [];
    const st = this.s();
    for (const sch of st.schatten) {
      this.schattenEntities.push(
        v.entities.add({
          polygon: {
            hierarchy: new PolygonHierarchy(this.cart(sch.poly)),
            classificationType: this.cls(),
            material: Color.fromCssColorString(sch.vorhaben ? '#1B2A4A' : '#1D2321').withAlpha(sch.vorhaben ? 0.5 : 0.22),
          },
        }),
      );
    }
    if (st.blick) {
      this.schattenEntities.push(
        v.entities.add({
          position: localToCartesian(st.blick.p, this.ground(st.blick.p) + st.blick.z),
          point: {
            pixelSize: 14,
            color: Color.fromCssColorString(st.blick.annahme ? this.pal().muted : this.pal().user),
            outlineColor: Color.WHITE,
            outlineWidth: 2,
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
          const d = dimOf(st());
          if (!d) return [];
          return this.cart([d.p, d.q]);
        }, false),
        width: 3,
        clampToGround: true,
        classificationType: this.cls(),
        material: this.color(() => Color.fromCssColorString(this.pal().ink)),
      },
    });
  }

  updateDim() {
    const d = dimOf(this.s());
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
