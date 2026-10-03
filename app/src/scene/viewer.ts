/**
 * Cesium-Szene ohne ion: eigenes Gelände, amtliches Luftbild (WMS), LoD2 als 3D Tiles.
 * Alle Standard-Widgets aus, die Oberfläche kommt aus dem Prototyp.
 */
import {
  Cesium3DTileset,
  Cesium3DTileStyle,
  Color,
  Ion,
  ImageryLayer,
  Rectangle,
  ShadowMode,
  Viewer,
  WebMapServiceImageryProvider,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { localToLonLat } from './coords';
import type { Terrain } from './terrain';

// Sicherstellen, dass nie ein ion-Dienst angefragt wird.
Ion.defaultAccessToken = '';

export const WMS = {
  dop: { url: 'https://geoservices.bayern.de/od/wms/dop/v1/dop20', layers: 'by_dop20c' },
  parzellar: { url: 'https://geoservices.bayern.de/od/wms/alkis/v1/parzellarkarte', layers: 'by_alkis_parzellarkarte_umr_gelb' },
};

export interface Scene {
  viewer: Viewer;
  tileset: Cesium3DTileset | null;
  parzellar: ImageryLayer;
  setTheme(dark: boolean): void;
}

export async function createScene(container: HTMLElement, terrain: Terrain, dataUrl: string, bbox: [number, number, number, number]): Promise<Scene> {
  const viewer = new Viewer(container, {
    baseLayer: false,
    terrainProvider: terrain.provider(),
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
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
  scene.screenSpaceCameraController.minimumZoomDistance = 8;
  scene.screenSpaceCameraController.maximumZoomDistance = 4000;
  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2) / (window.devicePixelRatio || 1);

  // Luftbild DOP20 (amtlich, CC BY 4.0) direkt vom Dienst der Bayerischen Vermessungsverwaltung
  const sw = localToLonLat([bbox[0], bbox[1]]);
  const ne = localToLonLat([bbox[2], bbox[3]]);
  const pad = 0.02;
  viewer.imageryLayers.add(
    new ImageryLayer(
      new WebMapServiceImageryProvider({
        url: WMS.dop.url,
        layers: WMS.dop.layers,
        parameters: { format: 'image/jpeg', transparent: false },
        rectangle: Rectangle.fromDegrees(sw[0] - pad, sw[1] - pad, ne[0] + pad, ne[1] + pad),
        credit: 'Bayerische Vermessungsverwaltung – www.geodaten.bayern.de',
      }),
    ),
  );
  const parzellar = viewer.imageryLayers.addImageryProvider(
    new WebMapServiceImageryProvider({
      url: WMS.parzellar.url,
      layers: WMS.parzellar.layers,
      parameters: { format: 'image/png', transparent: true },
      credit: 'Bayerische Vermessungsverwaltung – www.geodaten.bayern.de',
    }),
  );
  parzellar.show = false;

  let tileset: Cesium3DTileset | null = null;
  try {
    tileset = await Cesium3DTileset.fromUrl(`${dataUrl}/tiles/tileset.json`, {
      maximumScreenSpaceError: 8,
      shadows: ShadowMode.DISABLED,
    });
    scene.primitives.add(tileset);
  } catch (e) {
    console.error('3D-Gebäude konnten nicht laden', e);
  }

  const setTheme = (dark: boolean) => {
    scene.backgroundColor = Color.fromCssColorString(dark ? '#121614' : '#EEF0EC');
    scene.globe.baseColor = Color.fromCssColorString(dark ? '#171C19' : '#E1E4DE');
    if (tileset) {
      tileset.style = new Cesium3DTileStyle({ color: dark ? "color('#5b635e', 0.96)" : "color('#ffffff', 0.94)" });
    }
    viewer.imageryLayers.get(0).brightness = dark ? 0.62 : 1.0;
    viewer.imageryLayers.get(0).saturation = dark ? 0.6 : 0.9;
    scene.requestRender();
  };

  return { viewer, tileset, parzellar, setTheme };
}
