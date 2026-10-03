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

const port = +(process.argv[2] || 4173);
const root = resolve(process.argv[3] || 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.xml': 'application/xml', '.ktx2': 'image/ktx2',
};
const COMPRESS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.bin', '.glb', '.svg', '.wasm', '.xml', '.webmanifest']);

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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
