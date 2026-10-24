/** Erzeugt vertrieb/ausgabe/onepager.pdf aus ausgabe/seite/onepager.html (vorher: node vertrieb/bauen.mjs). */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const hier = resolve(import.meta.dirname);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve(hier, 'ausgabe/seite/onepager.html')).href);
await page.pdf({ path: resolve(hier, 'ausgabe/onepager.pdf'), format: 'A4', printBackground: true });
await browser.close();
console.log('ausgabe/onepager.pdf');
