/**
 * Cesium-Szene ohne ion: eigenes Gelände, amtliches Luftbild (WMS), LoD2 als 3D Tiles.
 * Alle Standard-Widgets aus, die Oberfläche kommt aus dem Prototyp.
 */
import {
  Cesium3DTileset,
  Cesium3DTileStyle,
  Ion,
  ImageryLayer,
  ShadowMode,
  CesiumWidget,
  GeographicTilingScheme,
  UrlTemplateImageryProvider,
  WebMapServiceImageryProvider,
} from '@cesium/engine';
import {
  Color,
  Rectangle,
} from '@cesium/core';
import '@cesium/engine/Source/Widget/CesiumWidget.css';
import { localToLonLat } from './coords';
import type { Terrain } from './terrain';

// Sicherstellen, dass nie ein ion-Dienst angefragt wird.
Ion.defaultAccessToken = '';

export const WMS = {
  dop: { url: 'https://geoservices.bayern.de/od/wms/dop/v1/dop20', layers: 'by_dop20c' },
  parzellar: { url: 'https://geoservices.bayern.de/od/wms/alkis/v1/parzellarkarte', layers: 'by_alkis_parzellarkarte_umr_gelb' },
};

export interface Scene {
  viewer: CesiumWidget;
  /** 3D-Gebäude; lädt im Hintergrund, damit die Oberfläche nicht darauf wartet */
  tileset: Cesium3DTileset | null;
  tilesetReady: Promise<Cesium3DTileset | null>;
  parzellar: ImageryLayer;
  setTheme(dark: boolean): void;
}

/** Lokale Luftbild-/Flurkarten-Kacheln aus der Pipeline (Offline-Demo), Kachelschema geographisch. */
export interface LocalImagery {
  maxLevel: number;
  minLevel: number;
  parzMinLevel: number;
  parzMaxLevel: number;
  rect: [number, number, number, number];
}

export function createScene(
  container: HTMLElement,
  terrain: Terrain,
  dataUrl: string,
  bbox: [number, number, number, number],
  local: LocalImagery | null = null,
): Scene {
  // CesiumWidget statt Viewer: nur die Engine, keine Standard-Widgets (kleineres Bundle)
  const viewer = new CesiumWidget(container, {
    baseLayer: false,
    terrainProvider: terrain.provider(),
    scene3DOnly: true,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    shadows: false,
    msaaSamples: 4,
  });
  const scene = viewer.scene;
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.showGroundAtmosphere = false;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
  if (scene.skyBox) scene.skyBox.show = false;
  scene.fog.enabled = false;
  // Sonne und Mond braucht die Szene nicht (spart Texturen und Erdrotationsdaten)
  if (scene.moon) scene.moon.show = false;
  if (scene.sun) scene.sun.show = false;
  scene.screenSpaceCameraController.minimumZoomDistance = 8;
  scene.screenSpaceCameraController.maximumZoomDistance = 4000;
  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2) / (window.devicePixelRatio || 1);

  // Luftbild DOP20 (amtlich, CC BY 4.0) direkt vom Dienst der Bayerischen Vermessungsverwaltung
  const sw = localToLonLat([bbox[0], bbox[1]]);
  const ne = localToLonLat([bbox[2], bbox[3]]);
  const pad = 0.02;
  const credit = 'Bayerische Vermessungsverwaltung – www.geodaten.bayern.de';
  const localProvider = (layer: 'dop' | 'parzellar', ext: string) =>
    new UrlTemplateImageryProvider({
      url: `${dataUrl}/${layer}/{z}/{x}/{y}.${ext}`,
      tilingScheme: new GeographicTilingScheme(),
      minimumLevel: layer === 'dop' ? local!.minLevel : local!.parzMinLevel,
      maximumLevel: layer === 'dop' ? local!.maxLevel : local!.parzMaxLevel,
      rectangle: Rectangle.fromDegrees(...local!.rect),
      credit,
    });
  // Online: amtliche WMS-Dienste. Offline-Demo: dieselben Daten als vorab erzeugte Kacheln.
  viewer.imageryLayers.add(
    new ImageryLayer(
      local
        ? localProvider('dop', 'jpg')
        : new WebMapServiceImageryProvider({
            url: WMS.dop.url,
            layers: WMS.dop.layers,
            parameters: { format: 'image/jpeg', transparent: false },
            rectangle: Rectangle.fromDegrees(sw[0] - pad, sw[1] - pad, ne[0] + pad, ne[1] + pad),
            credit,
          }),
    ),
  );
  const parzellar = viewer.imageryLayers.addImageryProvider(
    local
      ? localProvider('parzellar', 'png')
      : new WebMapServiceImageryProvider({
          url: WMS.parzellar.url,
          layers: WMS.parzellar.layers,
          parameters: { format: 'image/png', transparent: true },
          credit,
        }),
  );
  parzellar.show = false;

  let dark = false;
  const styleTileset = (t: Cesium3DTileset) => {
    t.style = new Cesium3DTileStyle({ color: dark ? "color('#5b635e', 0.96)" : "color('#ffffff', 0.94)" });
  };
  const result: Scene = {
    viewer,
    tileset: null,
    parzellar,
    tilesetReady: Cesium3DTileset.fromUrl(`${dataUrl}/tiles/tileset.json`, {
      maximumScreenSpaceError: 8,
      shadows: ShadowMode.DISABLED,
    })
      .then((t) => {
        scene.primitives.add(t);
        result.tileset = t;
        styleTileset(t);
        scene.requestRender();
        return t;
      })
      .catch((e) => {
        console.error('3D-Gebäude konnten nicht laden', e);
        return null;
      }),
    setTheme: () => {},
  };

  result.setTheme = (d: boolean) => {
    dark = d;
    scene.backgroundColor = Color.fromCssColorString(dark ? '#121614' : '#EEF0EC');
    scene.globe.baseColor = Color.fromCssColorString(dark ? '#171C19' : '#E1E4DE');
    if (result.tileset) styleTileset(result.tileset);
    viewer.imageryLayers.get(0).brightness = dark ? 0.62 : 1.0;
    viewer.imageryLayers.get(0).saturation = dark ? 0.6 : 0.9;
    scene.requestRender();
  };

  return result;
}
