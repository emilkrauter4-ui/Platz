/**
 * Bauvoranfrage (Vorbescheid, BayBO Art. 71) für das große Vorhaben (AUFTRAG_V3 B4): Lageplan-Skizze, Kubatur und Fragen
 * an die Gemeinde – statt eines Bauantrags. Als JSON (Schema „passt.bauvoranfrage/1“) und druckbares HTML (A4).
 * Wie das Antrag-Paket: Skizzen in Millimetern, keine amtlichen Bauvorlagen, reine Funktionen.
 * Welche Unterlagen die Behörde für den Vorbescheid verlangt, steht nicht im Wortlaut, den Passt. kennt (offen):
 * vorher erfragen.
 */
import { area, centroid, edges, pointSegment } from '../rules/geometry';
import { fmt } from '../rules/evaluate';
import { massstab } from './paket';
import { STICHTAG_NAME, type SchattenErgebnis } from '../rules/verschattung';
import { VORHABEN_NAME, type Vorhaben, type VorhabenErgebnis } from '../rules/vorhaben';
import type { ZufahrtErgebnis } from '../rules/zufahrt';
import type { GemeindeAbschnitt } from '../rules/planungsrecht';
import type { Bestand, Building, Site, Vec2 } from '../rules/types';

export const SCHEMA_VORANFRAGE = 'passt.bauvoranfrage/1';
export const HINWEIS_VORANFRAGE = 'Orientierung, keine Genehmigung. Die Bauvoranfrage ist eine Frage an die Gemeinde und die Bauaufsichtsbehörde; Passt. entscheidet nichts.';
export const HINWEIS_SKIZZE_V = 'SKIZZE – keine amtliche Lageplanunterlage (BauVorlV § 7). Grundlage: selbst gesetzte Grundstücksgrenze, amtliche Gebäude (LoD2) und Gelände (DGM1).';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const n1 = (v: number) => (Math.round(v * 100) / 100).toString();

export interface VoranfrageEingabe {
  site: Site;
  v: Vorhaben;
  res: VorhabenErgebnis;
  zufahrt: ZufahrtErgebnis | null;
  schatten: SchattenErgebnis | null;
  gemeinde: GemeindeAbschnitt;
  fragen: string[];
  bestand: Bestand[];
  ursprung: Vec2;
  adresse: string | null;
  erstellt: Date;
  links: Record<string, string>;
  version: string;
}

export function voranfrageLageplan(e: VoranfrageEingabe): { svg: string; massstab: number } {
  const { site, res, zufahrt } = e;
  const plot = site.plot.boundary;
  const xs = plot.map((p) => p[0]);
  const ys = plot.map((p) => p[1]);
  const R = 8;
  const x0 = Math.min(...xs) - R;
  const x1 = Math.max(...xs) + R;
  const y0 = Math.min(...ys) - R;
  const y1 = Math.max(...ys) + R;
  const m = massstab(x1 - x0, y1 - y0);
  const k = 1000 / m;
  const W = (x1 - x0) * k;
  const H = (y1 - y0) * k;
  const P = (p: Vec2) => `${n1((p[0] - x0) * k)},${n1((y1 - p[1]) * k)}`;
  const poly = (ps: Vec2[], attr: string) => `<polygon points="${ps.map(P).join(' ')}" ${attr}/>`;
  const txt = (p: Vec2, t: string, size = 2.4, attr = '') => `<text x="${n1((p[0] - x0) * k)}" y="${n1((y1 - p[1]) * k)}" font-size="${size}" text-anchor="middle" ${attr}>${esc(t)}</text>`;
  const imRahmen = (b: { footprint: Vec2[] }) => b.footprint.some((p) => p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1);
  const teile: string[] = [];
  const geb = (site.buildings.filter(imRahmen) as Building[]).sort((a, b) => area(b.footprint) - area(a.footprint));
  for (const b of geb) teile.push(poly(b.footprint, `fill="${b.own ? '#d9d9d4' : '#eeeeea'}" stroke="#555" stroke-width="0.25"`));
  const belegt: Vec2[] = [];
  for (const b of geb) {
    if (b.trauf == null || area(b.footprint) < 12) continue;
    const c = centroid(b.footprint);
    if (c[0] < x0 + 4 || c[0] > x1 - 4 || c[1] < y0 + 2 || c[1] > y1 - 2 || belegt.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < 7)) continue;
    belegt.push(c);
    teile.push(txt(c, `TH ${fmt(b.trauf, 1)} / FH ${fmt(b.first ?? b.trauf, 1)} m`, 1.8, 'fill="#333" stroke="#fff" stroke-width="0.4" paint-order="stroke"'));
  }
  for (const b of e.bestand.filter(imRahmen)) teile.push(poly(b.footprint, 'fill="none" stroke="#8a6d3b" stroke-width="0.25" stroke-dasharray="1,0.7"'));
  // Abstandsflächen des Vorhabens
  const afRot = res.af.ausserhalbM2 > 0.05 || res.af.ueberdeckung.length > 0;
  for (const w of res.af.waende) teile.push(poly(w.flaeche, `fill="${afRot ? '#c9302a' : '#2e7d5b'}" fill-opacity="0.12" stroke="${afRot ? '#c9302a' : '#2e7d5b'}" stroke-width="0.2" stroke-dasharray="0.8,0.6"`));
  teile.push(poly(plot, 'fill="none" stroke="#c9302a" stroke-width="0.5" stroke-dasharray="2,1"'));
  // Zufahrt
  if (zufahrt && zufahrt.pfad.length > 1) {
    teile.push(`<polyline points="${zufahrt.pfad.map(P).join(' ')}" fill="none" stroke="#2b59c3" stroke-width="0.5" stroke-dasharray="1.5,0.8"/>`);
    if (zufahrt.schmalsteStelle && zufahrt.schmalsteM != null) teile.push(txt(zufahrt.schmalsteStelle, `${fmt(zufahrt.schmalsteM, 1)} m`, 2, 'fill="#2b59c3" font-weight="700" stroke="#fff" stroke-width="0.5" paint-order="stroke"'));
  }
  // Vorhaben
  const fp = res.grundriss.fp;
  teile.push(poly(fp, `fill="${e.v.art === 'aufstockung' ? '#f0c27a' : '#e2c49b'}" stroke="#000" stroke-width="0.4"`));
  teile.push(txt(centroid(fp), `${VORHABEN_NAME[e.v.art].name}${e.v.art === 'aufstockung' ? ` +${e.v.geschosse} Geschoss` : ` ${fmt(e.v.w, 1)} × ${fmt(e.v.d, 1)} m`}`, 2.2, 'font-weight="600"'));
  // Abstände zu den Grenzseiten
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
    teile.push(`<line x1="${P(x.p).split(',')[0]}" y1="${P(x.p).split(',')[1]}" x2="${P(x.q).split(',')[0]}" y2="${P(x.q).split(',')[1]}" stroke="#000" stroke-width="0.25"/>`);
    teile.push(txt([(x.p[0] + x.q[0]) / 2, (x.p[1] + x.q[1]) / 2], `${fmt(x.d)} m`, 2, 'fill="#000" stroke="#fff" stroke-width="0.6" paint-order="stroke"'));
  }
  const leiste = m <= 250 ? 5 : m <= 500 ? 10 : 20;
  const stempel = `<g font-size="2"><rect x="2" y="${n1(H + 2)}" width="${n1(W - 4)}" height="20" fill="#fff" stroke="#000" stroke-width="0.3"/>
    <text x="4" y="${n1(H + 6.5)}" font-weight="700" font-size="2.2">Lageplan-Skizze zur Bauvoranfrage: ${esc(VORHABEN_NAME[e.v.art].name)} · 1:${m} bei Druck in Originalgröße</text>
    <text x="4" y="${n1(H + 10.5)}" fill="#c9302a" font-weight="700">${esc(HINWEIS_SKIZZE_V.split('. ')[0])}.</text>
    <text x="4" y="${n1(H + 14.3)}">Grenze: ${esc(site.plot.provenance)} · Gebäude: amtlich (LoD2), TH/FH = Trauf-/Firsthöhe · Abstände und Abstandsflächen berechnet · blau: Zufahrt mit schmalster Stelle</text>
    <text x="4" y="${n1(H + 18.1)}">Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de</text></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n1(W)}mm" height="${n1(H + 24)}mm" viewBox="0 0 ${n1(W)} ${n1(H + 24)}" font-family="Helvetica, Arial, sans-serif">
  <rect width="${n1(W)}" height="${n1(H)}" fill="#fff"/>
  ${teile.join('\n  ')}
  <g transform="translate(${n1(W - 12)},8)"><path d="M0,-5 L2.5,3 L0,1.5 L-2.5,3 z" fill="#000"/><text y="7" font-size="2.6" text-anchor="middle">N</text></g>
  <g transform="translate(4,${n1(H - 5)})"><rect width="${n1(leiste * k)}" height="1.2" fill="#000"/><text y="-1" font-size="2">0</text><text x="${n1(leiste * k)}" y="-1" font-size="2" text-anchor="end">${leiste} m</text></g>
  ${stempel}
</svg>`;
  return { svg, massstab: m };
}

const utm = (p: Vec2, u: Vec2): Vec2 => [Math.round((p[0] + u[0]) * 100) / 100, Math.round((p[1] + u[1]) * 100) / 100];

export interface Voranfrage {
  schema: typeof SCHEMA_VORANFRAGE;
  erstellt: string;
  quelle: { app: 'Passt.'; version: string };
  hinweise: string[];
  vorhaben: {
    art: Vorhaben['art'];
    name: string;
    kubatur: { grundflaeche: number; bgf: number; geschosse: number; geschosshoehe: number; wandhoehe: number; firsthoehe: number; rauminhalt: number; dachform: string; dachneigungGrad: number };
    lage: { crs: 'EPSG:25832'; grundriss: Vec2[] };
  };
  grundstueck: { adresse: string | null; grenze: Vec2[]; herkunft: string };
  pruefung: { status: string | null; kurz: string; punkte: { name: string; status: string | null; text: string }[]; zeilen: { text: string; quelle: string; herkunft: string }[] };
  zufahrt: { schmalsteM: number | null; erforderlichM: number; text: string } | null;
  schatten: { stichtag: string; fensterMaxStunden: number; gartenMaxStunden: number; gartenMittelStunden: number }[];
  gemeinde: GemeindeAbschnitt;
  fragen: string[];
  verfahren: { empfehlung: string; text: string; quelle: string };
  zeichnungen: { lageplan: { svg: string; massstab: number } };
  links: Record<string, string>;
  datenquellen: string[];
}

export function voranfrageBauen(e: VoranfrageEingabe): Voranfrage {
  const { v, res } = e;
  const k = res.kennzahlen;
  const dachformText = v.art === 'aufstockung' ? 'Dach wie vorhanden (LoD2)' : v.dachform === 'sattel' ? 'Satteldach' : v.dachform === 'pult' ? 'Pultdach' : 'Flachdach';
  return {
    schema: SCHEMA_VORANFRAGE,
    erstellt: e.erstellt.toISOString(),
    quelle: { app: 'Passt.', version: e.version },
    hinweise: [HINWEIS_VORANFRAGE, HINWEIS_SKIZZE_V, 'Grenzwerte noch nicht von einer Fachperson geprüft (limits.json, geprueft: false).'],
    vorhaben: {
      art: v.art,
      name: VORHABEN_NAME[v.art].name,
      kubatur: {
        grundflaeche: Math.round(k.grundflaeche * 10) / 10, bgf: Math.round(k.bgf * 10) / 10, geschosse: v.geschosse, geschosshoehe: v.geschosshoehe,
        wandhoehe: Math.round(k.wandhoehe * 100) / 100, firsthoehe: Math.round(k.firsthoehe * 100) / 100, rauminhalt: Math.round(k.rauminhalt * 10) / 10,
        dachform: dachformText, dachneigungGrad: v.art === 'aufstockung' || v.dachform === 'flach' ? 0 : v.neigung,
      },
      lage: { crs: 'EPSG:25832', grundriss: res.grundriss.fp.map((p) => utm(p, e.ursprung)) },
    },
    grundstueck: { adresse: e.adresse, grenze: e.site.plot.boundary.map((p) => utm(p, e.ursprung)), herkunft: e.site.plot.provenance },
    pruefung: {
      status: res.status,
      kurz: res.head,
      punkte: res.punkte.map((p) => ({ name: p.name, status: p.status, text: p.text })),
      zeilen: [...res.rows, ...(e.zufahrt?.rows ?? [])].map((r) => ({ text: r.text, quelle: r.tag, herkunft: r.kind })),
    },
    zufahrt: e.zufahrt ? { schmalsteM: e.zufahrt.schmalsteM, erforderlichM: e.zufahrt.erforderlichM, text: e.zufahrt.text } : null,
    schatten: e.schatten ? e.schatten.stichtage.map((s, i) => ({
      stichtag: STICHTAG_NAME[s] ?? s,
      fensterMaxStunden: Math.round(e.schatten!.fenster.maxExtra[i] * 10) / 10,
      gartenMaxStunden: Math.round(e.schatten!.garten.maxExtra[i] * 10) / 10,
      gartenMittelStunden: Math.round(e.schatten!.garten.mittelExtra[i] * 10) / 10,
    })) : [],
    gemeinde: e.gemeinde,
    fragen: e.fragen,
    verfahren: {
      empfehlung: 'Bauvoranfrage (Vorbescheid)',
      text: '„Vor Einreichung des Bauantrags ist auf Antrag des Bauherrn zu einzelnen Fragen des Bauvorhabens ein Vorbescheid zu erteilen.“ Welche Unterlagen die Bauaufsichtsbehörde dafür will, vorher erfragen (offen).',
      quelle: 'BayBO Art. 71',
    },
    zeichnungen: { lageplan: voranfrageLageplan(e) },
    links: e.links,
    datenquellen: [
      'Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (LoD2, Hausumringe, DGM1, DOP20, ALKIS Tatsächliche Nutzung; CC BY 4.0)',
      'Bebauungspläne: Bauleitplanung Bayern (Landesportal), nur Verweis',
      'Quasigeoid GCG2016: © BKG (CC BY 4.0)',
      'Gesetzestexte: BayBO, BauGB (amtliche Werke, § 5 UrhG); Wortlaut verglichen, siehe docs/recht/',
    ],
  };
}

export function voranfrageHtml(p: Voranfrage): string {
  const datum = new Date(p.erstellt).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const k = p.vorhaben.kubatur;
  const li = (t: string, q?: string) => `<li>${esc(t)}${q ? ` <span class="q">${esc(q)}</span>` : ''}</li>`;
  const WORT: Record<string, string> = { ok: 'passt', warn: 'knapp / offen', bad: 'passt nicht' };
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Bauvoranfrage ${esc(p.vorhaben.name)} – Passt.</title>
<style>
@page{size:A4;margin:14mm}
body{font-family:Helvetica,Arial,sans-serif;color:#1d2321;font-size:10.5pt;line-height:1.4;max-width:190mm;margin:0 auto;padding:8mm}
h1{font-size:18pt;margin:0 0 2mm}h2{font-size:13pt;margin:8mm 0 2mm;border-bottom:0.3mm solid #999}
.warn{border:0.5mm solid #c9302a;color:#c9302a;padding:2mm 3mm;font-weight:700;margin:3mm 0}
.q{color:#5c6662;font-size:9pt}table{border-collapse:collapse;width:100%}td,th{border:0.2mm solid #bbb;padding:1.2mm 2mm;text-align:left;vertical-align:top;font-size:9.5pt}
.blatt{page-break-before:always}.svg svg{max-width:100%;height:auto}.fine{font-size:8.5pt;color:#5c6662}
@media print{.svg svg{max-width:none}}
</style></head><body>
<h1>Bauvoranfrage: ${esc(p.vorhaben.name)}</h1>
<p>${esc(p.grundstueck.adresse ?? 'Grundstück')} · erstellt am ${esc(datum)} mit Passt.</p>
<div class="warn">${esc(HINWEIS_VORANFRAGE)}<br>Die Zeichnung ist eine Skizze – keine amtliche Bauvorlage.</div>
<h2>Was angefragt wird</h2>
<table><tr><th>Vorhaben</th><td>${esc(p.vorhaben.name)}</td></tr>
<tr><th>Grundfläche / BGF</th><td>${fmt(k.grundflaeche, 1)} m² / ${fmt(k.bgf, 1)} m² (${k.geschosse} ${p.vorhaben.art === 'aufstockung' ? 'zusätzliche ' : ''}Geschoss${k.geschosse === 1 ? '' : 'e'} à ${fmt(k.geschosshoehe, 2)} m, Annahme)</td></tr>
<tr><th>Höhen</th><td>Wandhöhe (Traufe) ${fmt(k.wandhoehe, 2)} m${p.vorhaben.art === 'aufstockung' ? ' über Grund' : ' über Fußboden'}, höchster Punkt ${fmt(k.firsthoehe, 2)} m · ${esc(k.dachform)}${k.dachneigungGrad ? ` ${fmt(k.dachneigungGrad, 0)}°` : ''}</td></tr>
<tr><th>Brutto-Rauminhalt (Kubatur)</th><td>${fmt(k.rauminhalt, 0)} m³ ${p.vorhaben.art === 'aufstockung' ? '(zusätzlicher Raum)' : '(mit Dachraum, berechnet)'}</td></tr>
<tr><th>Lage (EPSG:25832)</th><td>${p.vorhaben.lage.grundriss.map((q) => q.map((x) => x.toFixed(2)).join(' / ')).join(' · ')}</td></tr>
<tr><th>Grundstücksgrenze</th><td>${esc(p.grundstueck.herkunft)} – nicht amtlich</td></tr></table>
<h2>Fragen an die Gemeinde</h2>
<ol>${p.fragen.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>
<h2>Was Passt. messen konnte</h2>
<p><b>${esc(p.pruefung.kurz)}</b></p>
<table><tr><th>Punkt</th><th>Ergebnis</th><th>Erläuterung</th></tr>${p.pruefung.punkte.map((q) => `<tr><td>${esc(q.name)}</td><td>${q.status ? esc(WORT[q.status]) : 'offen'}</td><td>${esc(q.text)}</td></tr>`).join('')}</table>
${p.zufahrt ? `<p><b>Zufahrt:</b> ${esc(p.zufahrt.text)}</p>` : ''}
${p.schatten.length ? `<p><b>Zusätzliche Verschattung der Nachbarn</b> (Stunden Sonne weniger, berechnet, ebenes Gelände, Gartenpunkte angenommen)</p><table><tr><th>Stichtag</th><th>Fenster, größter Wert</th><th>Garten, größter Wert</th><th>Garten, Mittel</th></tr>${p.schatten.map((s) => `<tr><td>${esc(s.stichtag)}</td><td>${fmt(s.fensterMaxStunden, 1)} h</td><td>${fmt(s.gartenMaxStunden, 1)} h</td><td>${fmt(s.gartenMittelStunden, 1)} h</td></tr>`).join('')}</table>` : ''}
<p><b>So wurde geprüft</b></p><ul>${p.pruefung.zeilen.map((z) => li(z.text, `${z.quelle}${z.herkunft !== 'rule' && z.herkunft !== z.quelle ? ` · ${z.herkunft}` : ''}`)).join('')}</ul>
<h2>${esc(p.gemeinde.titel)}</h2>
<p>${esc(p.gemeinde.einleitung)}</p>
${p.gemeinde.hinweise.map((h) => `<p><b>${esc(h.titel)}</b> <span class="q">${esc(h.kind === 'rule' ? h.quelle : `${h.kind} · ${h.quelle}`)}</span><br>${esc(h.text)}${(h.links ?? []).map((l) => `<br><a href="${esc(l.url)}">${esc(l.text)}</a>`).join('')}</p>`).join('')}
<h2>${esc(p.gemeinde.weg.titel)}</h2>
<p>${esc(p.gemeinde.weg.text)}</p>
<p>${esc(p.verfahren.text)} <span class="q">${esc(p.verfahren.quelle)}</span></p>
<p><b>Offizielle Stellen</b></p><ul>
<li>Digitaler Bauantrag Bayern: <a href="${esc(p.links.digitalerBauantrag)}">${esc(p.links.digitalerBauantrag)}</a></li>
<li>Bayerische Bauordnung: <a href="${esc(p.links.baybo)}">${esc(p.links.baybo)}</a></li></ul>
<div class="blatt"><h2>Lageplan-Skizze</h2><div class="warn">${esc(HINWEIS_SKIZZE_V)}</div><div class="svg">${p.zeichnungen.lageplan.svg}</div></div>
<p class="fine">${p.datenquellen.map(esc).join('<br>')}<br>${p.hinweise.map(esc).join('<br>')}<br>Schema ${esc(p.schema)}, Passt. ${esc(p.quelle.version)}</p>
</body></html>`;
}
