/**
 * HTML-Bausteine für den Reiter „Großes Vorhaben“ (reine Funktionen, ohne DOM): Ampel-Punkte, Kennzahlen,
 * Schattenstunden und der Abschnitt „Was die Gemeinde entscheidet“.
 */
import { fmt } from '../rules/evaluate';
import { STICHTAG_NAME, type SchattenErgebnis } from '../rules/verschattung';
import type { GemeindeAbschnitt } from '../rules/planungsrecht';
import type { Kennzahlen, Pruefpunkt } from '../rules/vorhaben';
import type { Row } from '../rules/types';
import type { RaumSonne } from '../rules/raumsonne';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
type TagFn = (text: string, kind: string) => string;

const WORT = { ok: 'passt', warn: 'knapp', bad: 'passt nicht' };

export function punkteHtml(punkte: Pruefpunkt[], tag: TagFn): string {
  return `<ul class="rows">${punkte
    .map((p) => `<li><span><b>${esc(p.name)}</b> · ${p.status ? WORT[p.status] : 'offen'}<br><small class="fine">${esc(p.text)}</small></span>${p.status ? `<span class="d ${p.status}" style="width:10px;height:10px;border-radius:50%;margin-top:6px;flex:none" aria-hidden="true"></span>` : tag('offen', 'offen')}</li>`)
    .join('')}</ul>`;
}

export function kennzahlenHtml(k: Kennzahlen, art: 'wohnhaus' | 'anbau' | 'aufstockung' | 'hausplan', tag: TagFn): string {
  const aufst = art === 'aufstockung';
  return `<p class="fine" style="text-align:left;margin:8px 0">${aufst ? `Neue Traufhöhe ${fmt(k.wandhoehe, 1)} m, höchster Punkt ${fmt(k.firsthoehe, 1)} m über Grund; zusätzlicher Raum ${fmt(k.rauminhalt, 0)} m³ (${fmt(k.bgf, 0)} m² Geschossfläche).` : `Grundfläche ${fmt(k.grundflaeche, 0)} m², Geschossfläche ${fmt(k.bgf, 0)} m², Wandhöhe ${fmt(k.wandhoehe, 1)} m, höchster Punkt ${fmt(k.firsthoehe, 1)} m, Brutto-Rauminhalt ${fmt(k.rauminhalt, 0)} m³.`} ${art === 'hausplan' ? `${tag('aus Plan erfasst', 'aus Plan erfasst')} ${tag('berechnet', 'berechnet')}` : tag('berechnet', 'berechnet')}</p>`;
}

export function rowsHtml(rows: Row[], tag: TagFn): string {
  return rows.map((x) => `<li><span>${esc(x.text)}</span>${tag(x.tag, x.kind)}</li>`).join('');
}

export function schattenHtml(s: SchattenErgebnis | null, laeuft: boolean, tag: TagFn): string {
  if (laeuft && !s) return '<p class="fine" style="text-align:left">Verschattung wird berechnet …</p>';
  if (!s) return '';
  const f = (v: number) => `${fmt(v, 1)} h`;
  const zeile = (i: number) => `<tr><td>${esc(STICHTAG_NAME[s.stichtage[i]] ?? s.stichtage[i])}</td><td>${s.fenster.n ? f(s.fenster.maxExtra[i]) : '–'}</td><td>${f(s.garten.maxExtra[i])}</td><td>${f(s.garten.mittelExtra[i])}</td></tr>`;
  return `<p class="fine" style="text-align:left;margin:8px 0 4px"><b>Zusätzliche Verschattung der Nachbarn</b> – so viele Sonnenstunden weniger als ohne das Vorhaben. ${tag('berechnet', 'berechnet')}</p>
    <table class="fine" style="width:100%;border-collapse:collapse;text-align:left"><thead><tr><th style="text-align:left">Stichtag</th><th style="text-align:left">Fenster (größter Wert)</th><th style="text-align:left">Garten (größter Wert)</th><th style="text-align:left">Garten (Mittel)</th></tr></thead>
    <tbody>${s.stichtage.map((_, i) => zeile(i)).join('')}</tbody></table>
    <p class="fine" style="text-align:left">${s.fenster.n} Nachbarfenster (${tag('Annahme', 'Annahme')} Fassadenmitte, wenn nicht getippt) und ${s.garten.n} Gartenpunkte in 2, 5 und 8 m Abstand hinter der Grenze (${tag('Annahme', 'Annahme')}, die Nachbargrundstücke sind nicht bekannt). Ebenes Gelände angenommen. Eine gesetzliche Grenze für Verschattung gibt es in der BayBO nicht – die Zahlen sind für das Gespräch mit den Nachbarn.</p>`;
}

export function gemeindeHtml(g: GemeindeAbschnitt, tag: TagFn): string {
  return `<h3 style="margin:18px 0 6px;font-size:16px">${esc(g.titel)}</h3>
    <p class="fine" style="text-align:left">${esc(g.einleitung)}</p>
    ${g.hinweise
      .map((h) => `<div class="field" style="display:block"><b>${esc(h.titel)}</b> ${tag(h.kind === 'rule' ? h.quelle : h.kind, h.kind === 'rule' ? 'rule' : h.kind)}
        <p class="fine" style="text-align:left;margin:4px 0">${esc(h.text)}</p>
        ${(h.links ?? []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.text)}</a>`).join(' · ')}</div>`)
      .join('')}
    <div class="warnbox"><b>${esc(g.weg.titel)}.</b> ${esc(g.weg.text)}</div>`;
}


/** „Sonne in den Räumen“: Tabelle je Raum und je Fenster, mit Herkunft der Bäume (Winter Laser, Sommer DOM). */
export function raumsonneHtml(r: RaumSonne | null, laeuft: boolean, quelle: { winter: string; sommer: string } | null, tag: TagFn): string {
  if (laeuft && !r) return '<p class="fine" style="text-align:left">Sonnenstunden werden berechnet …</p>';
  if (!r) return '<p class="fine" style="text-align:left">Noch nicht berechnet.</p>';
  const f = (v: number) => `${fmt(v, 1)} h`;
  const kopf = `<tr><th style="text-align:left">&nbsp;</th>${r.stichtage.map((s) => `<th style="text-align:right">${esc(s.name)}</th>`).join('')}</tr>`;
  const gName = (g: number) => (g === 0 ? 'EG' : `${g}. OG`);
  const raeume = r.raeume.length
    ? `<table class="fine" style="width:100%;border-collapse:collapse;text-align:left"><thead>${kopf}</thead><tbody>${r.raeume
        .map((x) => `<tr><td>${esc(x.name)} <small>(${gName(x.geschoss)}${x.fenster ? `, ${x.fenster} Fenster` : ', kein Fenster'})</small></td>${x.stunden.map((h) => `<td style="text-align:right;font-variant-numeric:tabular-nums">${f(h)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`
    : '';
  const fenster = `<details><summary>${r.fenster.length} Fenster einzeln</summary><table class="fine" style="width:100%;border-collapse:collapse;text-align:left"><thead>${kopf}</thead><tbody>${r.fenster
    .map((x) => `<tr><td>${esc(x.id)}${x.raum ? ` <small>${esc(x.raum)}</small>` : ''} <button class="link" type="button" data-hpblick="${esc(x.id)}">Blick</button></td>${x.stunden.map((h) => `<td style="text-align:right;font-variant-numeric:tabular-nums">${f(h)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></details>`;
  const baeume = r.mitBaeumen.winter || r.mitBaeumen.sommer
    ? `Bäume und andere Objekte: <b>21. Dezember und 21. März</b> mit dem laubfreien Modell (${esc(quelle?.winter ?? 'Laserdaten, Befliegung 08.03.2025')}), <b>21. Juni</b> mit dem belaubten (${esc(quelle?.sommer ?? 'DOM20 minus DGM1, Bildflug 16.09.2023')}) ${tag('amtlich', 'amtlich')}. Kahle Äste sieht der Laser nur teilweise, im Winter ist der Baumschatten deshalb eher zu klein.`
    : '<b>Bäume sind nicht berücksichtigt</b>: Für dieses Gebiet liegt kein Oberflächenmodell vor (offen). Berücksichtigt sind nur Gebäude.';
  const neu = laeuft ? '<p class="fine" style="text-align:left;color:var(--warn)">Das Haus wurde bewegt: Die Zahlen werden neu berechnet …</p>' : '';
  return `${neu}<p class="fine" style="text-align:left;margin:8px 0 4px"><b>Sonnenstunden an der Fenstermitte</b> – ${tag('Simulation', 'Simulation')} ${tag('berechnet', 'berechnet')}</p>
    ${raeume}${fenster}
    <p class="fine" style="text-align:left">Gerechnet alle ${r.schrittMin} Minuten, wenn die Sonne mindestens 5° hoch steht und der Strahl von der Fenstermitte frei ist. Verdeckt wird durch das Haus selbst, Nachbargebäude (LoD2, ${tag('amtlich', 'amtlich')}) und Bäume. ${baeume} Gelände eben angenommen ${tag('Annahme', 'Annahme')}; Glas, Rahmen und Dachüberstände sind nicht gerechnet. Eine Mindestsonnenzeit für Räume kennt die BayBO nicht (offen), Passt. bewertet die Zahlen nicht. Gerechnet in ${Math.round(r.ms)} ms im Hintergrund.</p>`;
}
