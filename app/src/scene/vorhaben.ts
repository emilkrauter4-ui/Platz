/**
 * Zeichnet das große Vorhaben (Wohnhaus, Anbau, Aufstockung) in Cesium: Wände und Dach aus rules/vorhaben.ts
 * (vorhabenModell), die Abstandsflächen am Boden, die Zufahrt mit schmalster Stelle. Wird bei jeder Änderung
 * neu aufgebaut (wenige Entities, schnell genug zum Ziehen).
 */
import { CallbackProperty, ClassificationType, ConstantProperty, Entity, PolylineDashMaterialProperty, type CesiumWidget as Viewer } from '@cesium/engine';
import { Cartesian2, Color, PolygonHierarchy, type Cartesian3 } from '@cesium/core';
import type { Flaeche3D, Vec2, ZufahrtErgebnis } from '../rules';
import { localToCartesian } from './coords';

export const KEY_VORHABEN = 'vorhaben';

export interface VorhabenAnzeige {
  flaechen: Flaeche3D[];
  /** Abstandsflächen am Boden */
  af: Vec2[][];
  afSchlecht: boolean;
  /** Anteil rot einfärben (Ampel) */
  status: 'ok' | 'warn' | 'bad' | null;
  zufahrt: ZufahrtErgebnis | null;
  showAF: boolean;
  dark: boolean;
  mesh: boolean;
  /** neutrale Körperfarbe (mit eingeblendeter Hülle, damit die roten Durchstoßstellen auffallen) */
  neutral?: boolean;
}

export class VorhabenLayer {
  private ents: Entity[] = [];

  constructor(private viewer: Viewer) {}

  weg() {
    this.ents.forEach((e) => this.viewer.entities.remove(e));
    this.ents = [];
    this.viewer.scene.requestRender();
  }

  private add(e: Entity.ConstructorOptions, key = false) {
    const ent = this.viewer.entities.add(e);
    if (key) {
      ent.addProperty('passtKey');
      (ent as unknown as Record<string, unknown>).passtKey = new ConstantProperty(KEY_VORHABEN);
    }
    this.ents.push(ent);
    return ent;
  }

  zeige(a: VorhabenAnzeige | null) {
    this.weg();
    if (!a) return;
    const cls = a.mesh ? ClassificationType.BOTH : ClassificationType.TERRAIN;
    const koerper = Color.fromCssColorString(a.status === 'bad' && !a.neutral ? '#E0A19D' : '#E4D3B8');
    const dach = Color.fromCssColorString(a.status === 'bad' ? '#B5544E' : '#A8765A');
    const aufsatz = Color.fromCssColorString('#F0A94A');
    // Abstandsflächen
    if (a.showAF) {
      const col = Color.fromCssColorString(a.afSchlecht ? '#C9302A' : '#2E7D5B');
      for (const f of a.af) {
        this.add({
          polygon: { hierarchy: new PolygonHierarchy(f.map((p) => localToCartesian(p, 0))), material: col.withAlpha(0.18), classificationType: cls },
        });
        this.add({
          polyline: { positions: [...f, f[0]].map((p) => localToCartesian(p, 0)), width: 2, clampToGround: true, classificationType: cls, material: new PolylineDashMaterialProperty({ color: col, dashLength: 10 }) },
        });
      }
    }
    for (const f of a.flaechen) {
      const farbe = f.art === 'dach' ? dach : f.art === 'aufsatz' ? aufsatz : koerper;
      const cart = (): Cartesian3[] => f.pts.map((p, i) => localToCartesian(p, f.z[i]));
      if (f.art === 'wand' || (f.art === 'aufsatz' && f.zUnten)) {
        this.add({ wall: { positions: cart(), maximumHeights: f.z, minimumHeights: f.zUnten, material: farbe, outline: true, outlineColor: Color.fromCssColorString('#1D2321').withAlpha(0.5) } }, true);
      } else {
        this.add({ polygon: { hierarchy: new PolygonHierarchy(cart()), perPositionHeight: true, material: farbe, outline: true, outlineColor: Color.fromCssColorString('#1D2321').withAlpha(0.5) } }, true);
      }
    }
    // Zufahrt
    const z = a.zufahrt;
    if (z && z.pfad.length > 1) {
      const col = Color.fromCssColorString(z.status === 'bad' ? '#C9302A' : z.status === 'warn' ? '#A06410' : '#2B59C3');
      this.add({ polyline: { positions: z.pfad.map((p) => localToCartesian(p, 0)), width: 4, clampToGround: true, classificationType: cls, material: new PolylineDashMaterialProperty({ color: col, dashLength: 14 }) } });
      if (z.schmalsteStelle && z.schmalsteM != null) {
        this.add({
          position: localToCartesian(z.schmalsteStelle, 0.2),
          point: { pixelSize: 11, color: col, outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: {
            text: `${z.schmalsteM.toFixed(1).replace('.', ',')} m`, font: '600 14px sans-serif', fillColor: a.dark ? Color.WHITE : Color.fromCssColorString('#1D2321'),
            outlineColor: a.dark ? Color.BLACK : Color.WHITE, outlineWidth: 4, style: 2 /* FILL_AND_OUTLINE */, pixelOffset: new Cartesian2(0, -22), disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
    }
    this.viewer.scene.requestRender();
  }
}

export { CallbackProperty };
