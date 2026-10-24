/**
 * Setzt die Händler-Vorführung zusammen: Landingseite + Demo + Video, und rendert die Mail-Texte mit deinen Angaben.
 * Voraussetzung: vertrieb/konfig.json ausgefüllt, in app/ ein Build erzeugt:  cd app && npm run build:haendler
 * Aufruf (aus dem Repo-Ordner):  node vertrieb/bauen.mjs
 * Ergebnis:
 *   vertrieb/ausgabe/seite/        -> diesen Ordner hochladen (Cloudflare Pages, Netlify, eigener Webspace)
 *   vertrieb/ausgabe/mails/*.md    -> Mail-Texte mit eingesetzten Angaben
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const OUT = join(HIER, 'ausgabe');
const konfig = JSON.parse(readFileSync(join(HIER, 'konfig.json'), 'utf8'));
delete konfig._hinweis;

const demo = join(HIER, '..', 'app', 'dist-haendler');
if (!existsSync(join(demo, 'index.html'))) {
  console.error('Demo-Build fehlt. Erst ausführen:  cd app && npm run build:haendler');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const ersetze = (t) => t.replace(/\{\{([A-ZÄÖÜ_]+)\}\}/g, (m, k) => (k in konfig ? konfig[k] : m));
const offen = [];
const textDatei = /\.(html|md|txt|json)$/;

function kopiere(von, nach, mitErsetzen) {
  mkdirSync(nach, { recursive: true });
  for (const f of readdirSync(von)) {
    const a = join(von, f);
    const b = join(nach, f);
    if (statSync(a).isDirectory()) kopiere(a, b, mitErsetzen);
    else if (mitErsetzen && textDatei.test(f)) {
      const t = ersetze(readFileSync(a, 'utf8'));
      writeFileSync(b, t);
      for (const m of t.matchAll(/\{\{[^}]+\}\}/g)) offen.push(`${f}: ${m[0]}`);
    } else cpSync(a, b);
  }
}

kopiere(join(HIER, 'landing'), join(OUT, 'seite'), true);
cpSync(demo, join(OUT, 'seite', 'demo'), { recursive: true });
kopiere(join(HIER, 'mails'), join(OUT, 'mails'), true);

console.log(`Fertig: ${join(OUT, 'seite')} (Seite + Demo unter /demo/) und ${join(OUT, 'mails')}`);
const eindeutig = [...new Set(offen)];
if (eindeutig.length) {
  console.log(`\nNoch offene Platzhalter (${eindeutig.length}) – in vertrieb/konfig.json ausfüllen:`);
  eindeutig.slice(0, 30).forEach((x) => console.log('  ' + x));
  process.exitCode = 2;
}
