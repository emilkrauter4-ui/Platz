#!/usr/bin/env node
/** Prüfmappe als PDF (A4, Seitenzahlen) aus docs/pruefmappe/pruefmappe.html.
 *  Aufruf: node pipeline/pruefmappe_pdf.mjs [--kurz]   (Playwright: PLAYWRIGHT_PATH, Chromium: CHROMIUM_PATH wie gartenblick_render.mjs) */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pw = await import(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const kurz = process.argv.includes('--kurz');
const quelle = path.resolve(`docs/pruefmappe/pruefmappe${kurz ? '_kurz' : ''}.html`);
const ziel = path.resolve(`docs/pruefmappe/pruefmappe${kurz ? '_kurz' : ''}.pdf`);
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
await page.goto(pathToFileURL(quelle).href);
await page.pdf({
  path: ziel, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-size:7pt;width:100%;padding:0 14mm;display:flex;justify-content:space-between;color:#666">'
    + '<span>Passt. – Prüfmappe Regelwerk' + (kurz ? ' (Kurzfassung)' : '') + ' · Orientierung, keine Genehmigung</span>'
    + '<span>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span></div>',
});
await browser.close();
console.log(`→ ${ziel}`);
