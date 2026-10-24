/**
 * Nimmt das Vorführ-Video auf (ohne Marke, fiktives Mustergrundstück).
 *
 * Die Szene rendert in Software und ist zu langsam für eine Live-Aufnahme. Deshalb: Bild für Bild (Playwright-Screenshots),
 * Untertitel und Titelkarten als Overlay in der Seite, zusammengesetzt mit ffmpeg. Das Ergebnis ist immer dasselbe.
 *
 * Voraussetzung: Aufnahme-Build läuft auf Port 4181:
 *   cd app && node scripts/haendler-build.mjs --debug && node scripts/serve.mjs 4181 dist-haendler-debug
 * Aufruf:
 *   PLAYWRIGHT_PATH=<Pfad zu playwright/index.mjs> CHROMIUM_PATH=<Chromium> node vertrieb/video/aufnahme.mjs [Ausgabeordner]
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const OUT = resolve(process.argv[2] ?? 'vertrieb/video/ausgabe');
const FR = join(OUT, 'frames');
rmSync(FR, { recursive: true, force: true });
mkdirSync(FR, { recursive: true });
const URL = process.env.DEMO_URL ?? 'http://localhost:4181/?debug';
const W = 1280, H = 720;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
});
const page = await browser.newPage({ viewport: { width: W, height: H }, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
await page.goto(URL);
await page.waitForFunction(() => window.passt, null, { timeout: 60000 });
await page.waitForFunction(() => window.passt.st.step === 'pruefen' && window.passt.st.res, null, { timeout: 180000 });

// Overlay: Untertitel und Karten
await page.addStyleTag({ content: `
  #hint{display:none!important}
  #vk-cap{position:fixed;left:24px;right:calc(24px + 400px);bottom:28px;z-index:99999;background:rgba(18,22,20,.9);color:#fff;
    font:600 24px/1.3 'Instrument Sans',system-ui,sans-serif;padding:14px 20px;border-radius:14px;text-align:left;transition:none}
  #vk-cap small{display:block;font-weight:400;font-size:17px;opacity:.8;margin-top:4px}
  #vk-cap:empty{display:none}
  #vk-card{position:fixed;inset:0;z-index:100000;background:#0F1F1A;color:#fff;display:none;flex-direction:column;align-items:center;justify-content:center;
    text-align:center;padding:48px;font-family:'Instrument Sans',system-ui,sans-serif}
  #vk-card h1{font-size:54px;line-height:1.1;margin:0 0 18px;letter-spacing:-.02em;max-width:980px}
  #vk-card p{font-size:26px;line-height:1.35;margin:6px 0;max-width:900px;opacity:.9}
  #vk-card p.klein{font-size:19px;opacity:.7;margin-top:28px}
` });
await page.evaluate(() => {
  const cap = document.createElement('div'); cap.id = 'vk-cap'; document.body.appendChild(cap);
  const card = document.createElement('div'); card.id = 'vk-card'; document.body.appendChild(card);
});
const caption = (t, klein = '') => page.evaluate(([t, k]) => { document.getElementById('vk-cap').innerHTML = t ? `${t}${k ? `<small>${k}</small>` : ''}` : ''; }, [t, klein]);
const card = (html) => page.evaluate((h) => { const c = document.getElementById('vk-card'); c.innerHTML = h; c.style.display = h ? 'flex' : 'none'; }, html);
const tilesFertig = async () => {
  const t = Date.now();
  while (Date.now() - t < 90000) { if (await page.evaluate(() => window.passt.tilesLoaded())) break; await page.waitForTimeout(400); }
};

const liste = [];
let n = 0;
async function bild(dauer) {
  const f = join(FR, `f${String(n++).padStart(4, '0')}.png`);
  await page.screenshot({ path: f });
  liste.push([f, dauer]);
}
async function setze(x, y, winkel) {
  await page.evaluate(([x, y, a]) => { const P = window.passt, s = P.st, o = s.objs[s.selected]; o.center = [x, y]; if (a != null) o.angle = a * Math.PI / 180; P.update(); }, [x, y, winkel]);
}
async function ziehe(von, nach, schritte, dauer) {
  for (let i = 1; i <= schritte; i++) {
    const t = i / schritte, e = t * t * (3 - 2 * t);
    await setze(von[0] + (nach[0] - von[0]) * e, von[1] + (nach[1] - von[1]) * e);
    await page.waitForTimeout(350);
    await bild(dauer);
  }
}
const pos = () => page.evaluate(() => window.passt.st.objs[window.passt.st.selected].center);

await tilesFertig(); await page.waitForTimeout(2000);

// 0 Titel
await card(`<h1>Passt das Gartenhaus auf mein Grundstück?</h1><p>Eine Idee, als Prototyp umgesetzt. Kein fertiges Produkt.</p>`);
await bild(3.2);
await card('');

// 1 Grundstück
await caption('Der Kunde sieht sein Grundstück in 3D.', 'Amtliches Gelände, Luftbild und Nachbargebäude. Hier: ein fiktives Mustergrundstück.');
await bild(4);

// 2 Modell ziehen
await caption('Er wählt Ihr Modell und zieht es dorthin, wo es stehen soll.');
await bild(2.2);
const start = await pos();
await ziehe(start, [-102.2, -441], 14, 0.12);
await caption('Direkt an der Grenze: erlaubt – bis 3 m Wandhöhe.', 'Das Ergebnis steht sofort da: Ampel, ein Satz, gemessener Abstand.');
await page.waitForTimeout(500);
await bild(4.2);

// 3 anderes Modell
await page.click('[data-produkt="gh-h"]');
await page.waitForTimeout(800);
await caption('Anderes Modell, 3,2 m hoch: hier zu nah an der Grenze.', 'Die Punkte an den Modellen zeigen, welche Modelle an dieser Stelle passen.');
await tilesFertig(); await page.waitForTimeout(800);
await bild(4.6);

// 4 Zonen
await page.click('#zonenBtn');
await page.waitForTimeout(3000);
await caption('Die Karte zeigt, wo genau das Modell stehen darf.', 'Grün: passt. Rot: geht nicht.');
await tilesFertig(); await page.waitForTimeout(1500);
await bild(4.6);

// 5 Hierhin setzen
await page.click('#zonenHin');
await page.waitForTimeout(1200);
await caption('Ein Klick: das Modell steht an einer passenden Stelle.');
await tilesFertig(); await page.waitForTimeout(1200);
await bild(4);

// 6 Herkunft der Angaben
await page.evaluate(() => { const r = document.getElementById('rows'); r?.scrollIntoView({ block: 'start' }); });
await page.waitForTimeout(800);
await caption('Jede Angabe nennt ihre Herkunft: amtlich, berechnet, Annahme.', 'Die Prüfung ist nachvollziehbar – Zeile für Zeile.');
await bild(5);

// 7 Auswahl
await page.evaluate(() => window.scrollTo(0, 0));
await page.evaluate(() => { document.querySelector('.sheet')?.scrollTo?.(0, 0); document.getElementById('stepBody')?.scrollIntoView({ block: 'start' }); });
await page.click('[data-produkt="cp-e"]');
await page.waitForTimeout(1000);
await caption('Welche Modelle passen auf dieses Grundstück? Der Kunde sieht es auf einen Blick.');
await tilesFertig(); await page.waitForTimeout(800);
await bild(4.4);

// Schluss
await caption('');
await card(`<h1>Kommt das bei Ihnen vor?</h1><p>Wie oft fragen Kunden nach Genehmigung und Grenzabstand?<br>Wäre eine schnelle Antwort im Shop hilfreich, egal oder ein Risiko?</p>
<p class="klein">Prototyp, kein Angebot. Orientierung, keine Genehmigung: Verbindlich entscheidet die zuständige Behörde.<br>Beispiel mit fiktivem Grundstück und Wohnhaus · Regeln der Bayerischen Bauordnung · Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (CC BY 4.0)</p>`);
await bild(6.5);

await page.screenshot({ path: join(OUT, 'poster-ende.png') });
await card('');
await browser.close();

// Zusammensetzen
const txt = liste.map(([f, d]) => `file '${f}'\nduration ${d}`).join('\n') + `\nfile '${liste.at(-1)[0]}'\n`;
writeFileSync(join(OUT, 'liste.txt'), txt);
execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', join(OUT, 'liste.txt'), '-vf', 'fps=25,format=yuv420p,scale=1280:720', '-c:v', 'libx264', '-crf', '22', '-preset', 'slow', '-movflags', '+faststart', join(OUT, 'demo.mp4')], { stdio: 'inherit' });
// Vorschaubild: Szene 3 (rot)
const rot = liste[Math.min(liste.length - 1, Math.floor(liste.length * 0.45))][0];
execFileSync('ffmpeg', ['-y', '-i', rot, '-vf', 'scale=1280:720', join(OUT, 'poster.jpg')], { stdio: 'ignore' });
console.log('fertig:', join(OUT, 'demo.mp4'), `${liste.length} Bilder, ${liste.reduce((s, [, d]) => s + d, 0).toFixed(1)} s`);
