/**
 * Baut die Vorführung für Hersteller und Händler (Händler-Modus, siehe src/haendler.ts) nach dist-haendler/:
 *  - vite build --mode haendler (neutral, ohne Service Worker)
 *  - Daten auf das Mustergrundstück beschneiden: alles, was die Vorführung nicht lädt, wird entfernt
 *    (Foto-Mesh, Mess-Gebiete, Regen, Oberfläche, Beispieldateien, Geräteliste)
 *  - Grundrisse und Bestand nur im Umkreis des Mustergrundstücks
 * Aufruf: npm run build:haendler
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'dist-haendler';
const MITTE = [-114, -432];
const RADIUS = 260;

rmSync(OUT, { recursive: true, force: true });
execSync(`npx vite build --mode haendler --outDir ${OUT}`, { stdio: 'inherit' });

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

const groesse = (d) => readdirSync(d).reduce((s, f) => { const p = join(d, f); return s + (statSync(p).isDirectory() ? groesse(p) : statSync(p).size); }, 0);
console.log(`${OUT}: ${(groesse(OUT) / 1e6).toFixed(1)} MB (Gebäude ${b.buildings.length}, Bestand ${best.bestand.length}, Straßen ${str.strassen.length})`);
if (!existsSync(join(OUT, 'index.html'))) throw new Error('index.html fehlt');
