/**
 * Antrag-Paket (AUFTRAG_V2 Phase 4.1): Zusammenfassung, Lageplan-Skizze, Grundriss, Ansichten, Schnitt und Checkliste,
 * als JSON (für Anbieter, Schema „passt.antragspaket/1“) und als druckbares HTML. Zeichnungen als SVG in Millimetern,
 * damit sie beim Druck in Originalgröße maßstäblich sind. Reine Funktionen (kein DOM, kein Cesium).
 *
 * Die Lageplan-Skizze ist ausdrücklich KEINE amtliche Lageplanunterlage (BauVorlV § 7 verlangt einen Lageplan auf
 * Grundlage eines beglaubigten Katasterauszugs).
 */
import { dachHoehe, rauminhalt, waende } from '../rules/abstand';
import { area, edges, footprint, pointSegment, centroid } from '../rules/geometry';
import { fmt, NAMES } from '../rules/evaluate';
import type { VerfahrensErgebnis } from '../rules/verfahren';
import type { Bestand, Building, Placed, Result, Site, Vec2 } from '../rules/types';

export const SCHEMA = 'passt.antragspaket/1';
export const HINWEIS_SKIZZE = 'SKIZZE – keine amtliche Lageplanunterlage (BauVorlV § 7). Grundlage: selbst gesetzte Grundstücksgrenze, amtliche Gebäude (LoD2) und Gelände (DGM1).';
export const HINWEIS_ORIENTIERUNG = 'Orientierung, keine Genehmigung. Verbindlich entscheidet die Bauaufsichtsbehörde.';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const n1 = (v: number) => (Math.round(v * 100) / 100).toString();

/* ---------- Lageplan-Skizze ---------- */

const RICHTUNG = ['Ost', 'Nordost', 'Nord', 'Nordwest', 'West', 'Südwest', 'Süd', 'Südost'];
/** Himmelsrichtung einer Außennormale (Gitter-Nord, UTM) */
export function richtung(n: Vec2): string {
  const a = ((Math.atan2(n[1], n[0]) * 180) / Math.PI + 360 + 22.5) % 360;
  return RICHTUNG[Math.floor(a / 45)];
}

export interface LageplanDaten {
  site: Site;
  o: Placed;
  k: 'gartenhaus' | 'carport';
  res: Result;
  bestand: Bestand[];
}

/** Maßstab so groß wie möglich (1:200, 1:250, 1:500, 1:1000), passend auf 180 × 240 mm. */
export function massstab(breiteM: number, hoeheM: number): number {
  for (const m of [200, 250, 500, 1000]) if ((breiteM * 1000) / m <= 180 && (hoeheM * 1000) / m <= 240) return m;
  return 1000;
}

export function lageplanSvg(d: LageplanDaten): { svg: string; massstab: number } {
  const { site, o, res } = d;
  const plot = site.plot.boundary;
  const xs = plot.map((p) => p[0]);
  const ys = plot.map((p) => p[1]);
  const R = 8;
  const x0 = Math.min(...xs) - R;
  const x1 = Math.max(...xs) + R;
  const y0 = Math.min(...ys) - R;
  const y1 = Math.max(...ys) + R;
  const m = massstab(x1 - x0, y1 - y0);
  const k = 1000 / m; // mm je Meter
  const W = (x1 - x0) * k;
  const H = (y1 - y0) * k;
  const P = (p: Vec2) => `${n1((p[0] - x0) * k)},${n1((y1 - p[1]) * k)}`;
  const poly = (ps: Vec2[], attr: string) => `<polygon points="${ps.map(P).join(' ')}" ${attr}/>`;
  const txt = (p: Vec2, t: string, size = 2.4, attr = '') => `<text x="${n1((p[0] - x0) * k)}" y="${n1((y1 - p[1]) * k)}" font-size="${size}" text-anchor="middle" ${attr}>${esc(t)}</text>`;
  const imRahmen = (b: { footprint: Vec2[] }) => b.footprint.some((p) => p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1);
  const teile: string[] = [];
  // Nachbar- und eigene Gebäude (LoD2, amtlich) mit Trauf-/Firsthöhe
  const gebaeude = (site.buildings.filter(imRahmen) as Building[]).sort((a, b) => area(b.footprint) - area(a.footprint));
  for (const b of gebaeude) teile.push(poly(b.footprint, `fill="${b.own ? '#d9d9d4' : '#eeeeea'}" stroke="#555" stroke-width="0.25"`));
  // Beschriftung nur der größeren Teile, ohne Überlappung (mind. 7 m Abstand zwischen Beschriftungen)
  const belegt: Vec2[] = [];
  for (const b of gebaeude) {
    if (b.trauf == null || area(b.footprint) < 12) continue;
    const c = centroid(b.footprint);
    if (c[0] < x0 + 4 || c[0] > x1 - 4 || c[1] < y0 + 2 || c[1] > y1 - 2) continue;
    if (belegt.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < 7)) continue;
    belegt.push(c);
    teile.push(txt(c, `TH ${fmt(b.trauf, 1)} / FH ${fmt(b.first ?? b.trauf, 1)} m`, 1.8, 'fill="#333" stroke="#fff" stroke-width="0.4" paint-order="stroke"'));
  }
  // Bestand (erkannt/bestätigt)
  for (const b of d.bestand.filter(imRahmen)) teile.push(poly(b.footprint, 'fill="none" stroke="#8a6d3b" stroke-width="0.25" stroke-dasharray="1,0.7"'));
  // Abstandsflächen
  for (const f of res.af?.flaechen ?? []) {
    if (f.status === 'info') continue;
    teile.push(poly(f.poly, `fill="${f.status === 'bad' ? '#c9302a' : '#2e7d5b'}" fill-opacity="0.12" stroke="${f.status === 'bad' ? '#c9302a' : '#2e7d5b'}" stroke-width="0.2" stroke-dasharray="0.8,0.6"`));
  }
  // Grundstück
  teile.push(poly(plot, 'fill="none" stroke="#c9302a" stroke-width="0.5" stroke-dasharray="2,1"'));
  // Vorhaben
  const fp = footprint(o);
  teile.push(poly(fp, 'fill="#e2c49b" stroke="#000" stroke-width="0.4"'));
  teile.push(txt(o.center, `${NAMES[d.k].name} ${fmt(o.w, 2)} × ${fmt(o.d, 2)} m`, 2.2, 'font-weight="600"'));
  // Abstände zu jeder Grenzseite (kürzester Abstand je Seite, bis 15 m)
  const seiten = new Map<number, { d: number; p: Vec2; q: Vec2 }>();
  edges(plot).forEach(([a, b], i) => {
    const s = site.plot.segmentSide?.[i] ?? i;
    for (const c of fp) {
      const r = pointSegment(c, a, b);
      const cur = seiten.get(s);
      if (!cur || r.d < cur.d) seiten.set(s, { d: r.d, p: c, q: r.q });
    }
  });
  for (const [, x] of seiten) {
    if (x.d > 15 || x.d < 0.02) continue;
    teile.push(`<line x1="${P(x.p).split(',')[0]}" y1="${P(x.p).split(',')[1]}" x2="${P(x.q).split(',')[0]}" y2="${P(x.q).split(',')[1]}" stroke="#000" stroke-width="0.25" marker-start="url(#pf)" marker-end="url(#pf)"/>`);
    teile.push(txt([(x.p[0] + x.q[0]) / 2, (x.p[1] + x.q[1]) / 2], `${fmt(x.d)} m`, 2, 'fill="#000" stroke="#fff" stroke-width="0.6" paint-order="stroke"'));
  }
  // Nordpfeil (Gitter-Nord), Maßstabsleiste, Stempel
  const nx = W - 12;
  const leiste = m <= 250 ? 5 : m <= 500 ? 10 : 20;
  const stempel = `<g font-size="2"><rect x="2" y="${n1(H + 2)}" width="${n1(W - 4)}" height="20" fill="#fff" stroke="#000" stroke-width="0.3"/>
    <text x="4" y="${n1(H + 6.5)}" font-weight="700" font-size="2.2">Lageplan-Skizze ${esc(NAMES[d.k].name)} · 1:${m} bei Druck in Originalgröße</text>
    <text x="4" y="${n1(H + 10.5)}" fill="#c9302a" font-weight="700">${esc(HINWEIS_SKIZZE.split('. ')[0])}.</text>
    <text x="4" y="${n1(H + 14.3)}">Grenze: ${esc(site.plot.provenance)} · Gebäude: amtlich (LoD2), TH/FH = Trauf-/Firsthöhe · Abstände berechnet</text>
    <text x="4" y="${n1(H + 18.1)}">Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de</text></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n1(W)}mm" height="${n1(H + 24)}mm" viewBox="0 0 ${n1(W)} ${n1(H + 24)}" font-family="Helvetica, Arial, sans-serif">
  <defs><marker id="pf" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="2.4" markerHeight="2.4" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 z" fill="#000"/></marker></defs>
  <rect width="${n1(W)}" height="${n1(H)}" fill="#fff"/>
  ${teile.join('\n  ')}
  <g transform="translate(${n1(nx)},8)"><path d="M0,-5 L2.5,3 L0,1.5 L-2.5,3 z" fill="#000"/><text y="7" font-size="2.6" text-anchor="middle">N</text></g>
  <g transform="translate(4,${n1(H - 5)})"><rect width="${n1(leiste * k)}" height="1.2" fill="#000"/><text y="-1" font-size="2">0</text><text x="${n1(leiste * k)}" y="-1" font-size="2" text-anchor="end">${leiste} m</text></g>
  ${stempel}
</svg>`;
  return { svg, massstab: m };
}

/* ---------- Bauzeichnungen 1:100 ---------- */

const MM = 10; // 1:100 → 10 mm je Meter

/** Grundriss 1:100 mit Außenmaßen; Satteldach: Firstlinie gestrichelt. */
export function grundrissSvg(o: Placed, k: 'gartenhaus' | 'carport'): string {
  const w = o.w * MM;
  const d = o.d * MM;
  const r = 14;
  const dach = (o.neigung ?? 0) > 0;
  const inhalt = k === 'carport'
    ? [[0, 0], [1, 0], [1, 1], [0, 1]].map(([sx, sy]) => `<rect x="${n1(r + sx * (w - 2.4))}" y="${n1(r + sy * (d - 2.4))}" width="1.2" height="1.2" fill="#000"/>`).join('') +
      `<rect x="${r - 1}" y="${r - 1}" width="${n1(w + 2)}" height="${n1(d + 2)}" fill="none" stroke="#000" stroke-width="0.3" stroke-dasharray="2,1"/>`
    : `<rect x="${r}" y="${r}" width="${n1(w)}" height="${n1(d)}" fill="none" stroke="#000" stroke-width="0.6"/>` +
      (dach ? `<line x1="${r}" y1="${n1(r + d / 2)}" x2="${n1(r + w)}" y2="${n1(r + d / 2)}" stroke="#000" stroke-width="0.25" stroke-dasharray="3,1.5"/><text x="${n1(r + w / 2)}" y="${n1(r + d / 2 - 1)}" font-size="2.2" text-anchor="middle">First</text>` : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n1(w + 2 * r)}mm" height="${n1(d + 2 * r + 8)}mm" viewBox="0 0 ${n1(w + 2 * r)} ${n1(d + 2 * r + 8)}" font-family="Helvetica, Arial, sans-serif">
  ${inhalt}
  <line x1="${r}" y1="${r - 6}" x2="${n1(r + w)}" y2="${r - 6}" stroke="#000" stroke-width="0.25"/><text x="${n1(r + w / 2)}" y="${r - 7}" font-size="2.6" text-anchor="middle">${fmt(o.w, 2)} m</text>
  <line x1="${n1(r + w + 6)}" y1="${r}" x2="${n1(r + w + 6)}" y2="${n1(r + d)}" stroke="#000" stroke-width="0.25"/><text x="${n1(r + w + 8)}" y="${n1(r + d / 2)}" font-size="2.6" transform="rotate(90 ${n1(r + w + 8)} ${n1(r + d / 2)})" text-anchor="middle">${fmt(o.d, 2)} m</text>
  <text x="${r}" y="${n1(d + 2 * r + 4)}" font-size="2.4">Grundriss ${esc(NAMES[k].name)} · 1:100 · Skizze aus den Maßen</text>
</svg>`;
}

/** Ansichten aller vier Seiten 1:100 mit Gelände aus DGM1 und Wandhöhe nach Art. 6 Abs. 4 an beiden Enden. */
export function ansichtenSvg(site: Site, o: Placed, k: 'gartenhaus' | 'carport'): string {
  const ws = waende(site, o);
  const ground = (p: Vec2) => (site.ground ? site.ground(p) : 0);
  const fp = footprint(o);
  const base = o.baseElevation ?? Math.max(...fp.map(ground));
  const dh = dachHoehe(o);
  const hoechst = o.h + dh + 0.3;
  const tief = Math.max(...fp.map((p) => base - ground(p))) + 0.3;
  const breiteMax = Math.max(o.w, o.d);
  const zellW = (breiteMax + 4) * MM;
  const zellH = (hoechst + tief + 1.5) * MM;
  const ansicht = (i: number): string => {
    const w = ws[i];
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const ox = 2 * MM;
    const oy = (hoechst + 0.5) * MM; // Fußbodenhöhe in der Zelle
    const X = (t: number) => n1(ox + t * len * MM);
    const Y = (z: number) => n1(oy - z * MM); // z relativ zum Fußboden
    // Gelände entlang der Wand
    const gel: string[] = [];
    for (let s = 0; s <= 20; s++) {
      const t = s / 20;
      const p: Vec2 = [w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t];
      gel.push(`${X(t)},${Y(ground(p) - base)}`);
    }
    const nrm: Vec2 = [(w.b[1] - w.a[1]) / len, -(w.b[0] - w.a[0]) / len];
    const name = richtung(nrm);
    const istCarport = k === 'carport';
    let koerper: string;
    if (istCarport) {
      koerper = `<rect x="${X(0)}" y="${Y(o.h + 0.16)}" width="${n1(len * MM)}" height="${n1(0.16 * MM)}" fill="#e2c49b" stroke="#000" stroke-width="0.3"/>` +
        [0.02, 0.98].map((t) => `<rect x="${n1(Number(X(t)) - 0.6)}" y="${Y(o.h)}" width="1.2" height="${n1((o.h + tief) * MM)}" fill="#e2c49b" stroke="#000" stroke-width="0.2"/>`).join('');
    } else {
      const giebel = w.typ === 'giebel';
      const dachPkt = dh > 0 ? (giebel ? `${X(0)},${Y(o.h)} ${X(0.5)},${Y(o.h + dh)} ${X(1)},${Y(o.h)}` : `${X(0)},${Y(o.h)} ${X(0)},${Y(o.h + dh)} ${X(1)},${Y(o.h + dh)} ${X(1)},${Y(o.h)}`) : `${X(-0.03)},${Y(o.h)} ${X(-0.03)},${Y(o.h + 0.12)} ${X(1.03)},${Y(o.h + 0.12)} ${X(1.03)},${Y(o.h)}`;
      koerper = `<polygon points="${X(0)},${Y(-tief)} ${X(0)},${Y(o.h)} ${X(1)},${Y(o.h)} ${X(1)},${Y(-tief)}" fill="#f1e2cc" stroke="#000" stroke-width="0.4"/>` +
        `<polygon points="${dachPkt}" fill="${dh > 0 && !giebel ? '#c29e70' : dh > 0 ? '#f1e2cc' : '#c29e70'}" stroke="#000" stroke-width="0.4"/>`;
    }
    const masz = istCarport ? '' : `<text x="${n1(Number(X(0)) - 1)}" y="${Y(o.h / 2)}" font-size="2" text-anchor="end">H ${fmt(w.ha)}</text><text x="${n1(Number(X(1)) + 1)}" y="${Y(o.h / 2)}" font-size="2">H ${fmt(w.hb)}</text>`;
    return `<g>
      <clipPath id="c${i}"><rect width="${n1(zellW)}" height="${n1(zellH)}"/></clipPath>
      <g clip-path="url(#c${i})">
      ${koerper}
      <polygon points="${X(-0.15)},${Y(-tief - 1)} ${gel.join(' ')} ${X(1.15)},${Y(-tief - 1)}" fill="#fff" stroke="none"/>
      <polyline points="${gel.join(' ')}" fill="none" stroke="#2e7d5b" stroke-width="0.5"/>
      </g>
      ${masz}
      <text x="${n1(ox)}" y="${n1(zellH - 2)}" font-size="2.4">Ansicht ${name} · Wand ${fmt(len, 2)} m${w.typ !== 'flach' ? ` · ${w.typ === 'traufe' ? 'Traufseite' : 'Giebelseite'}` : ''}</text>
    </g>`;
  };
  const zellen = [0, 1, 2, 3].map((i) => `<g transform="translate(${n1((i % 2) * zellW)},${n1(Math.floor(i / 2) * zellH)})">${ansicht(i)}</g>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n1(2 * zellW)}mm" height="${n1(2 * zellH + 10)}mm" viewBox="0 0 ${n1(2 * zellW)} ${n1(2 * zellH + 10)}" font-family="Helvetica, Arial, sans-serif">
  ${zellen}
  <text x="2" y="${n1(2 * zellH + 6)}" font-size="2.4">Ansichten 1:100 · grüne Linie: Gelände aus DGM1 (amtlich) · H = Wandhöhe nach BayBO Art. 6 Abs. 4 an den Wandenden (berechnet)</text>
</svg>`;
}

/** Schnitt quer zum First 1:100 mit Traufhöhe, Firsthöhe und Dachneigung. */
export function schnittSvg(o: Placed, k: 'gartenhaus' | 'carport'): string {
  const dh = dachHoehe(o);
  const d = o.d * MM;
  const h = o.h * MM;
  const r = 16;
  const top = r + (dh + 0.5) * MM;
  const boden = top + h;
  const dach = k === 'carport'
    ? `<rect x="${r - 1}" y="${n1(top - 1.6)}" width="${n1(d + 2)}" height="1.6" fill="#c29e70" stroke="#000" stroke-width="0.3"/><rect x="${r}" y="${n1(top)}" width="1.2" height="${n1(h)}" fill="#e2c49b" stroke="#000" stroke-width="0.2"/><rect x="${n1(r + d - 1.2)}" y="${n1(top)}" width="1.2" height="${n1(h)}" fill="#e2c49b" stroke="#000" stroke-width="0.2"/>`
    : `<rect x="${r}" y="${n1(top)}" width="${n1(d)}" height="${n1(h)}" fill="#f1e2cc" stroke="#000" stroke-width="0.5"/>` +
      (dh > 0 ? `<polygon points="${r},${n1(top)} ${n1(r + d / 2)},${n1(top - dh * MM)} ${n1(r + d)},${n1(top)}" fill="#f1e2cc" stroke="#000" stroke-width="0.5"/>` : `<rect x="${r - 1.5}" y="${n1(top - 1.2)}" width="${n1(d + 3)}" height="1.2" fill="#c29e70" stroke="#000" stroke-width="0.3"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n1(d + 2 * r + 20)}mm" height="${n1(boden + 14)}mm" viewBox="0 0 ${n1(d + 2 * r + 20)} ${n1(boden + 14)}" font-family="Helvetica, Arial, sans-serif">
  ${dach}
  <line x1="${r - 6}" y1="${n1(boden)}" x2="${n1(r + d + 6)}" y2="${n1(boden)}" stroke="#2e7d5b" stroke-width="0.5"/>
  <line x1="${n1(r + d + 8)}" y1="${n1(boden)}" x2="${n1(r + d + 8)}" y2="${n1(top)}" stroke="#000" stroke-width="0.25"/><text x="${n1(r + d + 10)}" y="${n1((boden + top) / 2)}" font-size="2.4">${k === 'carport' ? 'Höhe' : 'Traufe'} ${fmt(o.h, 2)} m</text>
  ${dh > 0 ? `<text x="${n1(r + d / 2)}" y="${n1(top - dh * MM - 2)}" font-size="2.4" text-anchor="middle">First ${fmt(o.h + dh, 2)} m · Dachneigung ${fmt(o.neigung ?? 0, 0)}°</text>` : ''}
  <text x="${r}" y="${n1(boden + 4)}" font-size="2.2">Tiefe ${fmt(o.d, 2)} m · Höhen über Fußboden</text>
  <text x="${r}" y="${n1(boden + 9)}" font-size="2.4">Schnitt quer${dh > 0 ? ' zum First' : ''} · 1:100 · Skizze aus den Maßen, ohne Gründung und Aufbauten</text>
</svg>`;
}

/* ---------- Paket ---------- */

export interface PaketEingabe {
  site: Site;
  k: 'gartenhaus' | 'carport';
  o: Placed;
  res: Result;
  verfahren: VerfahrensErgebnis;
  bestand: Bestand[];
  /** UTM-Ursprung der lokalen Koordinaten */
  ursprung: Vec2;
  adresse: string | null;
  erstellt: Date;
  links: Record<string, string>;
  version: string;
}

export interface Paket {
  schema: typeof SCHEMA;
  erstellt: string;
  quelle: { app: 'Passt.'; version: string };
  hinweise: string[];
  vorhaben: {
    art: 'gartenhaus' | 'carport';
    name: string;
    masse: { breite: number; tiefe: number; wandhoehe: number; dachneigungGrad: number; firsthoehe: number; flaeche: number; bruttoRauminhalt?: number };
    lage: { crs: 'EPSG:25832'; hoehen: 'relativ zum Fußboden'; mitte: Vec2; drehungGrad: number; grundriss: Vec2[] };
  };
  grundstueck: { adresse: string | null; grenze: Vec2[]; herkunft: string };
  ergebnis: { status: string; kurz: string; text: string; befunde: string[]; zeilen: { text: string; quelle: string; herkunft: string }[] };
  verfahren: VerfahrensErgebnis;
  zeichnungen: { lageplan: { svg: string; massstab: number }; grundriss: string; ansichten: string; schnitt: string };
  links: Record<string, string>;
  datenquellen: string[];
}

const utm = (p: Vec2, u: Vec2): Vec2 => [Math.round((p[0] + u[0]) * 100) / 100, Math.round((p[1] + u[1]) * 100) / 100];

export function paketBauen(e: PaketEingabe): Paket {
  const { o, k, site, res } = e;
  const dh = dachHoehe(o);
  return {
    schema: SCHEMA,
    erstellt: e.erstellt.toISOString(),
    quelle: { app: 'Passt.', version: e.version },
    hinweise: [HINWEIS_ORIENTIERUNG, HINWEIS_SKIZZE, 'Grenzwerte noch nicht von einer Fachperson geprüft (limits.json, geprueft: false).'],
    vorhaben: {
      art: k,
      name: NAMES[k].name,
      masse: {
        breite: o.w, tiefe: o.d, wandhoehe: o.h, dachneigungGrad: o.neigung ?? 0, firsthoehe: Math.round((o.h + dh) * 100) / 100,
        flaeche: Math.round(o.w * o.d * 100) / 100,
        ...(k === 'gartenhaus' ? { bruttoRauminhalt: Math.round(rauminhalt(o) * 10) / 10 } : {}),
      },
      lage: { crs: 'EPSG:25832', hoehen: 'relativ zum Fußboden', mitte: utm(o.center, e.ursprung), drehungGrad: Math.round(((o.angle * 180) / Math.PI) * 10) / 10, grundriss: footprint(o).map((p) => utm(p, e.ursprung)) },
    },
    grundstueck: { adresse: e.adresse, grenze: site.plot.boundary.map((p) => utm(p, e.ursprung)), herkunft: site.plot.provenance },
    ergebnis: { status: res.status, kurz: res.head, text: res.sub, befunde: res.befunde ?? [], zeilen: res.rows.map((r) => ({ text: r.text, quelle: r.tag, herkunft: r.kind })) },
    verfahren: e.verfahren,
    zeichnungen: {
      lageplan: lageplanSvg({ site, o, k, res, bestand: e.bestand }),
      grundriss: grundrissSvg(o, k),
      ansichten: ansichtenSvg(site, o, k),
      schnitt: schnittSvg(o, k),
    },
    links: e.links,
    datenquellen: [
      'Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (LoD2, Hausumringe, DGM1, DOP20; CC BY 4.0)',
      'Quasigeoid GCG2016: © BKG (CC BY 4.0)',
      'Gesetzestexte: BayBO, BauVorlV, GaStellV (amtliche Werke, § 5 UrhG); Wortlaut verglichen, siehe docs/recht/',
    ],
  };
}

/** Druckbares HTML (A4), eigenständig, ohne externe Dateien. */
export function paketHtml(p: Paket): string {
  const v = p.verfahren;
  const datum = new Date(p.erstellt).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const m = p.vorhaben.masse;
  const li = (t: string, q?: string) => `<li>${esc(t)}${q ? ` <span class="q">${esc(q)}</span>` : ''}</li>`;
  const noetig = { ja: 'nötig', wenn: 'wenn zutreffend', nein: 'in der Regel nicht' };
  const beitrag = { skizze: 'Skizze von Passt.', daten: 'Angaben von Passt.', nein: 'selbst besorgen' };
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Antrag-Paket ${esc(p.vorhaben.name)} – Passt.</title>
<style>
@page{size:A4;margin:14mm}
body{font-family:Helvetica,Arial,sans-serif;color:#1d2321;font-size:10.5pt;line-height:1.4;max-width:190mm;margin:0 auto;padding:8mm}
h1{font-size:18pt;margin:0 0 2mm}h2{font-size:13pt;margin:8mm 0 2mm;border-bottom:0.3mm solid #999}
.warn{border:0.5mm solid #c9302a;color:#c9302a;padding:2mm 3mm;font-weight:700;margin:3mm 0}
.q{color:#5c6662;font-size:9pt}table{border-collapse:collapse;width:100%}td,th{border:0.2mm solid #bbb;padding:1.2mm 2mm;text-align:left;vertical-align:top;font-size:9.5pt}
.blatt{page-break-before:always}.svg svg{max-width:100%;height:auto}.fine{font-size:8.5pt;color:#5c6662}
@media print{.svg svg{max-width:none}}
</style></head><body>
<h1>Antrag-Paket: ${esc(p.vorhaben.name)}</h1>
<p>${esc(p.grundstueck.adresse ?? 'Grundstück')} · erstellt am ${esc(datum)} mit Passt.</p>
<div class="warn">${esc(HINWEIS_ORIENTIERUNG)}<br>Die Zeichnungen sind Skizzen aus den eingegebenen Maßen – keine amtlichen Bauvorlagen.</div>
<h2>${esc(v.titel)}</h2>
<p><b>Ergebnis der Prüfung:</b> ${esc(p.ergebnis.kurz)} ${esc(p.ergebnis.text)}</p>
${v.gruende.length ? `<p><b>Gründe</b></p><ul>${v.gruende.map((g) => li(g.text, g.quelle)).join('')}</ul>` : ''}
<p><b>Nächste Schritte</b></p><ul>${v.schritte.map((s) => li(s.text, s.quelle + (s.kind === 'offen' ? ' · offen' : ''))).join('')}</ul>
${v.entwurfsverfasser ? `<p><b>Entwurfsverfasser nötig:</b> ${esc(v.entwurfsverfasser.wer)} <span class="q">${esc(v.entwurfsverfasser.quelle)}</span>${v.entwurfsverfasser.offen ? `<br><span class="q">Offen: ${esc(v.entwurfsverfasser.offen)}</span>` : ''}</p>` : ''}
<h2>Vorhaben</h2>
<table><tr><th>Breite × Tiefe</th><td>${fmt(m.breite, 2)} × ${fmt(m.tiefe, 2)} m (${fmt(m.flaeche, 1)} m²)</td></tr>
<tr><th>Wandhöhe (Traufe)</th><td>${fmt(m.wandhoehe, 2)} m</td></tr>
<tr><th>Dach</th><td>${m.dachneigungGrad > 0 ? `Satteldach ${fmt(m.dachneigungGrad, 0)}°, First ${fmt(m.firsthoehe, 2)} m` : 'Flachdach'}</td></tr>
${m.bruttoRauminhalt != null ? `<tr><th>Brutto-Rauminhalt</th><td>${fmt(m.bruttoRauminhalt, 1)} m³ (mit Dachraum, berechnet)</td></tr>` : ''}
<tr><th>Lage (EPSG:25832)</th><td>Mitte ${p.vorhaben.lage.mitte.map((x) => x.toFixed(2)).join(' / ')}, Drehung ${fmt(p.vorhaben.lage.drehungGrad, 1)}°</td></tr>
<tr><th>Grundstücksgrenze</th><td>${esc(p.grundstueck.herkunft)} – nicht amtlich</td></tr></table>
<p><b>So wurde geprüft</b></p><ul>${p.ergebnis.zeilen.map((z) => li(z.text, `${z.quelle}${z.herkunft !== 'rule' && z.herkunft !== z.quelle ? ` · ${z.herkunft}` : ''}`)).join('')}</ul>
${v.checkliste.length ? `<h2>Checkliste Unterlagen</h2><table><tr><th>Unterlage</th><th>Quelle</th><th>Nötig</th><th>Passt.</th></tr>${v.checkliste.map((c) => `<tr><td><b>${esc(c.titel)}</b><br><span class="q">${esc(c.hinweis)}</span></td><td>${esc(c.quelle)}</td><td>${noetig[c.noetig]}</td><td>${beitrag[c.passt]}</td></tr>`).join('')}</table>` : ''}
<p><b>Offizielle Stellen</b></p><ul>
<li>Digitaler Bauantrag Bayern: <a href="${esc(p.links.digitalerBauantrag)}">${esc(p.links.digitalerBauantrag)}</a></li>
<li>Bauantragsformulare: <a href="${esc(p.links.formulare)}">${esc(p.links.formulare)}</a></li>
<li>Bauvorlagenverordnung: <a href="${esc(p.links.bauvorlv)}">${esc(p.links.bauvorlv)}</a> · Bayerische Bauordnung: <a href="${esc(p.links.baybo)}">${esc(p.links.baybo)}</a></li></ul>
<div class="blatt"><h2>Lageplan-Skizze</h2><div class="warn">${esc(HINWEIS_SKIZZE)}</div><div class="svg">${p.zeichnungen.lageplan.svg}</div></div>
<div class="blatt"><h2>Grundriss und Schnitt</h2><div class="svg">${p.zeichnungen.grundriss}</div><div class="svg">${p.zeichnungen.schnitt}</div></div>
<div class="blatt"><h2>Ansichten</h2><div class="svg">${p.zeichnungen.ansichten}</div></div>
<p class="fine">${p.datenquellen.map(esc).join('<br>')}<br>${p.hinweise.map(esc).join('<br>')}<br>Schema ${esc(p.schema)}, Passt. ${esc(p.quelle.version)}</p>
</body></html>`;
}
