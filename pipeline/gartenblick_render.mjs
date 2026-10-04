#!/usr/bin/env node
/**
 * Gartenblick (AUFTRAG_V2 Phase 5.2): virtuelle Kamerabilder aus dem amtlichen DOM-Mesh rendern – als Eingabe für
 * Gaussian Splatting (Skyfall-GS-Format „Satellite“ bzw. NeRF-transforms mit fl_x/fl_y/cx/cy).
 *
 * Statt Satellitenbildern: die eigene Cesium-Szene (DOM-Mesh 2023, CC BY 4.0, ECEF über GCG2016) aus vielen
 * Blickwinkeln – von oben, schräg und aus Gartenhöhe (1,6 m). Kameraposen exakt aus Cesium, in einem lokalen
 * Koordinatensystem: x = Osten (UTM), y = Norden, z = Ellipsoidhöhe, Ursprung = Grundstücksmitte am Boden.
 * Kamera-Konvention: OpenCV/COLMAP (x rechts, y unten, z Blickrichtung), wie Skyfall-GS sie für Satellitendaten liest.
 *
 * Voraussetzung: App gebaut und gestartet (`npm run build && npm run serve` in app/), Mesh in app/public/data/mesh,
 * Playwright mit Chromium (`npm i -D playwright && npx playwright install chromium` oder PLAYWRIGHT_PATH setzen).
 *
 * Aufruf: node pipeline/gartenblick_render.mjs <demo-id> [ausgabe] [url]
 *   z. B. node pipeline/gartenblick_render.mjs grenze data/build/gartenblick/grenze http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';

const [demo = 'grenze', aus = `data/build/gartenblick/${demo}`, url = 'http://localhost:4173'] = process.argv.slice(2);
const pw = await import(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const W = 1024;
const H = 768;
const FOV = 60;

const browser = await pw.chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
await page.goto(`${url}/?debug`);
await page.waitForFunction(() => window.passt, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate((d) => window.passt.startDemo(d), demo);
await page.waitForFunction(() => window.passt.st.step === 'pruefen', null, { timeout: 120000 });
await page.evaluate(() => window.passt.nurMesh());
await page.waitForTimeout(3000);

/** Warten, bis Mesh und Gelände 2 s lang vollständig geladen sind (höchstens 45 s). Jede Abfrage fordert ein Bild an –
 *  die App rendert sonst nur auf Anforderung, und Cesium lädt dann keine Kacheln nach. */
const bereit = async (max = 25000) => {
  const t = Date.now();
  let stabil = 0;
  await page.waitForTimeout(500);
  while (Date.now() - t < max) {
    // Maßgeblich ist das Mesh; das Gelände (Luftbild über WMS) nur, solange es in der Zeit bleibt
    const ok = await page.evaluate((spaet) => window.passt.meshLoaded() && (spaet || window.passt.tilesLoaded()), Date.now() - t > 10000);
    stabil = ok ? stabil + 1 : 0;
    if (stabil >= 8) return true;
    await page.waitForTimeout(250);
  }
  return false;
};

// Grundstücksmitte und Boden
const { plot, mitte, boden, haeuser } = await page.evaluate(() => {
  const b = window.passt.st.plot;
  const c = [b.reduce((a, p) => a + p[0], 0) / b.length, b.reduce((a, p) => a + p[1], 0) / b.length];
  return { plot: b, mitte: c, boden: window.passt.boden(c), haeuser: window.passt.st.buildings.map((x) => x.footprint) };
});
const inPoly = (p, poly) => {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
};
// im Grundstück, nicht in einem Gebäude und mindestens 1,5 m von dessen Wänden
const drinnen = (p) => inPoly(p, plot) && !haeuser.some((h) => [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].some(([dx, dy]) => inPoly([p[0] + dx, p[1] + dy], h)));

// Kameraplan
const ansichten = [];
const ziel = [mitte[0], mitte[1], boden + 1.5];
for (const [r, dz, n] of [[12, 4, 16], [25, 12, 16], [45, 30, 16]]) {
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * (i + (r === 25 ? 0.5 : 0))) / n;
    ansichten.push({ art: `ring${r}`, pos: [mitte[0] + r * Math.cos(a), mitte[1] + r * Math.sin(a), boden + dz], ziel });
  }
}
for (const dx of [-15, 0, 15]) for (const dy of [-15, 0, 15]) {
  ansichten.push({ art: 'oben', pos: [mitte[0] + dx, mitte[1] + dy, boden + 60], ziel: [mitte[0] + dx * 0.9, mitte[1] + dy * 0.9 + 1, boden] });
}
// Gartenhöhe: bis 6 Standorte im Grundstück (Raster 4 m), je 8 Richtungen, Augenhöhe 1,6 m
const xs = plot.map((p) => p[0]);
const ys = plot.map((p) => p[1]);
const orte = [];
for (let x = Math.min(...xs) + 2; x < Math.max(...xs) - 2; x += 4) for (let y = Math.min(...ys) + 2; y < Math.max(...ys) - 2; y += 4) if (drinnen([x, y])) orte.push([x, y]);
orte.sort((a, b) => Math.hypot(a[0] - mitte[0], a[1] - mitte[1]) - Math.hypot(b[0] - mitte[0], b[1] - mitte[1]));
const auswahl = orte.filter((_, i) => i % Math.max(1, Math.floor(orte.length / 4)) === 0).slice(0, 4);
for (const o of auswahl) {
  const h = await page.evaluate((p) => window.passt.boden(p), o);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    ansichten.push({ art: 'garten', pos: [o[0], o[1], h + 1.6], ziel: [o[0] + 10 * Math.cos(a), o[1] + 10 * Math.sin(a), h + 1.2] });
  }
}

fs.mkdirSync(path.join(aus, 'images'), { recursive: true });
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const kreuz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const ursprung = [mitte[0], mitte[1], boden];
const frames = [];
const t0 = Date.now();
for (let i = 0; i < ansichten.length; i++) {
  const v = ansichten[i];
  await page.evaluate(([p, z, f]) => window.passt.kamera(p, z, f), [v.pos, v.ziel, FOV]);
  if (!(await bereit())) console.log(`  ${i}: nicht vollständig geladen (25 s), Bild trotzdem gespeichert`);
  const name = `${String(i).padStart(3, '0')}_${v.art}`;
  await page.locator('#map canvas').first().screenshot({ path: path.join(aus, 'images', `${name}.jpg`), type: 'jpeg', quality: 93 });
  const k = await page.evaluate(() => window.passt.kameraInfo());
  // OpenCV: x rechts, y unten, z vorwärts; Spalten der c2w-Matrix = Achsen in Weltkoordinaten
  const p = sub(k.pos, ursprung);
  const f = norm(sub(k.vor, k.pos));
  const u = norm(sub(k.auf, k.pos));
  const r = norm(kreuz(f, u));
  const d = [-u[0], -u[1], -u[2]];
  const c2w = [[r[0], d[0], f[0], p[0]], [r[1], d[1], f[1], p[1]], [r[2], d[2], f[2], p[2]], [0, 0, 0, 1]];
  const w = k.w;
  const hh = k.h;
  const fovX = w >= hh ? k.fov : 2 * Math.atan(Math.tan(k.fov / 2) * (w / hh));
  const fl = w / 2 / Math.tan(fovX / 2);
  frames.push({ file_path: `images/${name}.jpg`, transform_matrix: c2w, fl_x: fl, fl_y: fl, cx: w / 2, cy: hh / 2, w, h: hh, art: v.art });
  if (i % 10 === 0) console.log(`  ${i + 1}/${ansichten.length} ${name} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
const train = frames.filter((_, i) => i % 8 !== 0);
const test = frames.filter((_, i) => i % 8 === 0);
const kopf = { camera_model: 'PINHOLE', koordinaten: 'lokal: x Ost, y Nord (UTM 32N, EPSG:25832), z Ellipsoidhöhe GRS80; Ursprung siehe meta.json', konvention: 'OpenCV (x rechts, y unten, z vorwärts), c2w' };
fs.writeFileSync(path.join(aus, 'transforms_train.json'), JSON.stringify({ ...kopf, frames: train }, null, 1));
fs.writeFileSync(path.join(aus, 'transforms_test.json'), JSON.stringify({ ...kopf, frames: test }, null, 1));
const site = await page.evaluate(() => window.passt.st.address);
const meta = {
  demo, adresse: site, erstellt: new Date().toISOString(),
  ursprung_lokal: ursprung, hinweis_ursprung: 'lokale App-Koordinaten (UTM minus Gebietsursprung, siehe app/public/data/site.json); Höhe = Ellipsoidhöhe',
  bilder: frames.length, train: train.length, test: test.length, aufloesung: [W, H], fov_grad: FOV,
  quelle: 'DOM-Mesh 2023 (Los 123028_1) und DOP20, Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (CC BY 4.0), gerendert mit CesiumJS',
  kennzeichnung: 'Eingabedaten für eine KI-Visualisierung – nicht gemessen, nie für Prüfungen',
};
fs.writeFileSync(path.join(aus, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(`fertig: ${frames.length} Bilder in ${Math.round((Date.now() - t0) / 1000)} s → ${aus}`);
await browser.close();
