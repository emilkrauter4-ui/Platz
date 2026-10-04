#!/usr/bin/env node
/**
 * Statischer Server für dist/ mit Kompression (Brotli/gzip) und Cache-Headern – so wie ein
 * normales Hosting. Für Ladezeit-Messungen und für die Offline-Demo auf einem Laptop.
 * Aufruf: node scripts/serve.mjs [port] [verzeichnis]
 */
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createBrotliCompress, createGzip, constants } from 'node:zlib';
import { nachbarApi } from './nachbar-api.mjs';

const port = +(process.argv[2] || 4173);
const root = resolve(process.argv[3] || 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.xml': 'application/xml', '.ktx2': 'image/ktx2',
};
const COMPRESS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.bin', '.glb', '.svg', '.wasm', '.xml', '.webmanifest']);

/**
 * Proxy nur für die LfU-Wasserschutz-Abfrage (GetFeatureInfo ohne CORS-Header beim LfU).
 * Lizenz des Dienstes: CC BY 4.0 (Geoportal-Metadaten 7d264700-d887-11e0-b7aa-0000779eba3a).
 * Weitergereicht werden nur die erlaubten Parameter an genau diesen Endpunkt; nichts wird gespeichert.
 */
const LFU = 'https://www.lfu.bayern.de/gdi/wms/wasser/wsg';
const LFU_PARAMS = ['SERVICE', 'VERSION', 'REQUEST', 'LAYERS', 'QUERY_LAYERS', 'STYLES', 'CRS', 'BBOX', 'WIDTH', 'HEIGHT', 'I', 'J', 'INFO_FORMAT', 'FEATURE_COUNT'];
async function lfuProxy(req, res) {
  const inUrl = new URL(req.url, 'http://x');
  const out = new URL(LFU);
  for (const k of LFU_PARAMS) if (inUrl.searchParams.has(k)) out.searchParams.set(k, inUrl.searchParams.get(k));
  if (out.searchParams.get('REQUEST') !== 'GetFeatureInfo' || out.searchParams.get('QUERY_LAYERS') !== 'twsg') {
    res.writeHead(400).end('nur GetFeatureInfo auf twsg');
    return;
  }
  try {
    const r = await fetch(out, { signal: AbortSignal.timeout(15000) });
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json', 'Cache-Control': 'public, max-age=86400' });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(502).end(String(e));
  }
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/proxy/lfu-wsg')) return void lfuProxy(req, res);
  if (path.includes('/api/nachbar/')) return void nachbarApi(req, res);
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404).end('nicht gefunden'); return; }
  const ext = extname(file);
  const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' };
  // Gehashte Bundles und Daten dürfen lange gecacht werden, HTML und Service Worker nicht
  headers['Cache-Control'] = /\/assets\/|\/cesium\//.test(path) ? 'public, max-age=31536000, immutable' : ext === '.html' || path.endsWith('sw.js') ? 'no-cache' : 'public, max-age=86400';
  const ae = req.headers['accept-encoding'] || '';
  let stream = createReadStream(file);
  if (COMPRESS.has(ext)) {
    if (/\bbr\b/.test(ae)) { headers['Content-Encoding'] = 'br'; stream = stream.pipe(createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })); }
    else if (/\bgzip\b/.test(ae)) { headers['Content-Encoding'] = 'gzip'; stream = stream.pipe(createGzip()); }
    headers['Vary'] = 'Accept-Encoding';
  } else headers['Content-Length'] = statSync(file).size;
  res.writeHead(200, headers);
  stream.pipe(res);
}).listen(port, () => console.log(`Passt. auf http://localhost:${port} (${root})`));
