import { defineConfig } from 'vitest/config';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Dev-Server: dieselbe Nachbar-API wie scripts/serve.mjs (SQLite, siehe scripts/nachbar-api.mjs). */
function nachbarApiDev() {
  return {
    name: 'passt-nachbar-api',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (fn: (req: never, res: never, next: () => void) => void) => void } }) {
      server.middlewares.use(async (req: { url?: string }, res, next) => {
        if (req.url?.includes('/api/lernen')) {
          // @ts-expect-error reines JS-Modul ohne Typen
          const { lernApi } = await import('./scripts/lern-api.mjs');
          return void lernApi(req, res);
        }
        if (req.url?.endsWith('/api/tipp') || req.url?.endsWith('/api/tipp/vorbereiten')) {
          const { tippApi } = await import('./scripts/tipp-proxy.mjs');
          return void tippApi(req, res);
        }
        if (req.url?.includes('/api/ar/')) {
          const { arApi } = await import('./scripts/ar-modell.mjs');
          return void arApi(req, res);
        }
        if (!req.url?.includes('/api/nachbar/')) return next();
        // @ts-expect-error reines JS-Modul ohne Typen
        const { nachbarApi } = await import('./scripts/nachbar-api.mjs');
        await nachbarApi(req, res);
      });
    },
  };
}

/**
 * Nach dem Build: Listen für den Service Worker schreiben.
 * - precache.json: App-Hülle (HTML, Bundle, die beim Durchlauf genutzten Cesium-Dateien, Startdaten)
 * - offline-files.json: alles, was die Offline-Demo braucht (Daten der Kachel, Kacheln, restliche Cesium-Dateien)
 */
function offlineManifest() {
  return {
    name: 'passt-offline-manifest',
    apply: 'build' as const,
    closeBundle() {
      const dist = 'dist';
      const files = walk(dist).map((f) => relative(dist, f).split('\\').join('/'));
      const used: string[] = JSON.parse(readFileSync('scripts/cesium-used.json', 'utf8'));
      const shell = [
        './',
        ...files.filter((f) => f.startsWith('assets/') && !f.endsWith('.map')),
        ...used.filter((f) => existsSync(join(dist, f))),
        'data/site.json',
        'data/terrain/terrain.json',
        'data/terrain/overview.bin',
      ];
      const offline = files.filter(
        (f) =>
          !f.startsWith('data/mesh/') && !f.startsWith('data/gebiete/') && (f.startsWith('data/') || f.startsWith('cesium/Workers/') || f.startsWith('cesium/Assets/IAU2006_XYS/') ||
            f === 'cesium/Assets/approximateTerrainHeights.json') && !shell.includes(f),
      );
      writeFileSync(join(dist, 'precache.json'), JSON.stringify(shell));
      writeFileSync(join(dist, 'offline-files.json'), JSON.stringify(offline));
      const version = createHash('sha256').update(shell.join('|')).digest('hex').slice(0, 10);
      const sw = join(dist, 'sw.js');
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('__PASST_VERSION__', version));
      const mb = offline.reduce((s, f) => s + statSync(join(dist, f)).size, 0) / 1e6;
      console.log(`Offline-Demo: ${shell.length} Dateien Hülle, ${offline.length} Dateien Daten (${mb.toFixed(1)} MB), Version ${version}`);
    },
  };
}

// Cesium ohne ion: die statischen Cesium-Dateien (Worker, Assets) werden mitgeliefert.
const cesiumSource = 'node_modules/@cesium/engine/Build';
const cesiumBase = 'cesium';

export default defineConfig({
  base: './',
  define: {
    CESIUM_BASE_URL: JSON.stringify(`./${cesiumBase}/`),
  },
  plugins: [
    offlineManifest(),
    nachbarApiDev(),
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumBase, rename: { stripBase: 4 } },
        { src: `${cesiumSource}/Workers`, dest: cesiumBase, rename: { stripBase: 4 } },
        { src: `${cesiumSource}/Assets`, dest: cesiumBase, rename: { stripBase: 4 } },
      ],
    }),
  ],
  // Dev-Server: dieselbe LfU-Abfrage wie scripts/serve.mjs (der LfU-Dienst sendet keinen CORS-Header)
  server: {
    proxy: {
      '/proxy/lfu-wsg': { target: 'https://www.lfu.bayern.de', changeOrigin: true, rewrite: (p) => p.replace('/proxy/lfu-wsg', '/gdi/wms/wasser/wsg') },
    },
  },
  build: { chunkSizeWarningLimit: 6000 },
  test: { include: ['test/**/*.test.ts'] },
});
