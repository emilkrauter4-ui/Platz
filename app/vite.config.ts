import { defineConfig } from 'vitest/config';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Cesium ohne ion: die statischen Cesium-Dateien (Worker, Assets) werden mitgeliefert.
const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBase = 'cesium';

export default defineConfig({
  base: './',
  define: {
    CESIUM_BASE_URL: JSON.stringify(`./${cesiumBase}/`),
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumBase, rename: { stripBase: 4 } },
        { src: `${cesiumSource}/Workers`, dest: cesiumBase, rename: { stripBase: 4 } },
        { src: `${cesiumSource}/Assets`, dest: cesiumBase, rename: { stripBase: 4 } },
        { src: `${cesiumSource}/Widgets`, dest: cesiumBase, rename: { stripBase: 4 } },
      ],
    }),
  ],
  build: { chunkSizeWarningLimit: 6000 },
  test: { include: ['test/**/*.test.ts'] },
});
