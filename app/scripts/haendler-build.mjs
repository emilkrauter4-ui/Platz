/**
 * Baut die Vorführung für Hersteller und Händler (Händler-Modus, siehe src/haendler.ts) nach dist-haendler/:
 *  - vite build --mode haendler (neutral, ohne Service Worker)
 *  - Daten auf das Mustergrundstück beschneiden: alles, was die Vorführung nicht lädt, wird entfernt
 *    (Foto-Mesh, Mess-Gebiete, Regen, Oberfläche, Beispieldateien, Geräteliste)
 *  - Grundrisse und Bestand nur im Umkreis des Mustergrundstücks
 * Aufruf: npm run build:haendler   (Aufnahme-Build fürs Video: node scripts/haendler-build.mjs --debug)
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import proj4 from 'proj4';

const DEBUG = process.argv.includes('--debug'); // Aufnahme-Build für das Video: mit Test-Schnittstelle (?debug)
const OUT = DEBUG ? 'dist-haendler-debug' : 'dist-haendler';
const MITTE = [-114, -432];
const RADIUS = 260;

rmSync(OUT, { recursive: true, force: true });
execSync(`npx vite build --mode haendler --outDir ${OUT}`, { stdio: 'inherit', env: { ...process.env, ...(DEBUG ? { VITE_HAENDLER_DEBUG: '1' } : {}) } });

for (const p of ['sw.js', 'precache.json', 'offline-files.json', 'beispiele', 'data/mesh', 'data/gebiete', 'data/regen', 'data/oberflaeche', 'data/waermepumpen.json', 'data/parzellar']) {
  rmSync(join(OUT, p), { recursive: true, force: true });
}

const nah = (c) => Math.hypot(c[0] - MITTE[0], c[1] - MITTE[1]) < RADIUS;
const mitte = (fp) => [fp.reduce((s, p) => s + p[0], 0) / fp.length, fp.reduce((s, p) => s + p[1], 0) / fp.length];
const lies = (f) => JSON.parse(readFileSync(join(OUT, 'data', f), 'utf8'));
const schreib = (f, o) => writeFileSync(join(OUT, 'data', f), JSON.stringify(o));

const b = lies('buildings.json');
b.buildings = b.buildings.filter((x) => nah(mitte(x.fp)));
schreib('buildings.json', b);
const best = lies('bestand.json');
best.bestand = best.bestand.filter((x) => nah(mitte(x.fp)));
schreib('bestand.json', best);
const str = lies('strassen.json');
str.strassen = str.strassen.filter((s) => s.some(nah));
schreib('strassen.json', str);

// Luftbild-Kacheln: die feinen Stufen nur im Umkreis des Mustergrundstücks (weniger Dateien, schnellerer Upload).
// Gröbere Stufen bleiben vollständig, außerhalb sieht man dann nur das unscharfe Übersichtsbild.
proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs');
const [ox, oy] = [699000, 5487000];
// Die Kacheln liegen im geografischen Raster (EPSG:4326): 2^(z+1) Spalten, 2^z Zeilen, Zeile 0 im Norden.
const kachel = (x, y, z) => {
  const [lon, lat] = proj4('EPSG:25832', 'WGS84', [ox + x, oy + y]);
  return [Math.floor(((lon + 180) / 360) * 2 ** (z + 1)), Math.floor(((90 - lat) / 180) * 2 ** z)];
};
const DOP_RADIUS = { 16: 900, 17: 600, 18: 420 };
let dopWeg = 0;
for (const [z, r] of Object.entries(DOP_RADIUS)) {
  const [x0, y1] = kachel(MITTE[0] - r, MITTE[1] - r, +z);
  const [x1, y0] = kachel(MITTE[0] + r, MITTE[1] + r, +z);
  const dir = join(OUT, 'data', 'dop', z);
  if (!existsSync(dir)) continue;
  for (const xs of readdirSync(dir)) {
    for (const f of readdirSync(join(dir, xs))) {
      const y = parseInt(f, 10);
      if (+xs < x0 || +xs > x1 || y < y0 || y > y1) { rmSync(join(dir, xs, f)); dopWeg++; }
    }
  }
}
console.log(`Luftbild-Kacheln entfernt: ${dopWeg}`);

const groesse = (d) => readdirSync(d).reduce((s, f) => { const p = join(d, f); return s + (statSync(p).isDirectory() ? groesse(p) : statSync(p).size); }, 0);
console.log(`${OUT}: ${(groesse(OUT) / 1e6).toFixed(1)} MB (Gebäude ${b.buildings.length}, Bestand ${best.bestand.length}, Straßen ${str.strassen.length})`);
if (!existsSync(join(OUT, 'index.html'))) throw new Error('index.html fehlt');
