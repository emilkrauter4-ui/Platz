/**
 * HTML-Bausteine für den Reiter „Starkregen“ (AUFTRAG_V4 C3), reine Funktionen ohne DOM.
 * Jede Zahl trägt ein Label: KOSTRA und Flächenarten `amtlich`, Rechnung `Simulation`, Parameter `Annahme`.
 */
import L from '../rules/limits.json';
import { fmt } from '../rules/evaluate';
import type { SimErgebnis } from '../rules/regen';

export type TagFn = (text: string, kind: string) => string;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const MESS_ARTEN: { id: string; name: string; schwelle: number }[] = [
  { id: 'kellertreppe', name: 'Kellertreppe', schwelle: L.starkregen.schwellenM.wert.kellertreppe },
  { id: 'lichtschacht', name: 'Lichtschacht', schwelle: L.starkregen.schwellenM.wert.lichtschacht },
  { id: 'garageneinfahrt', name: 'Garageneinfahrt', schwelle: L.starkregen.schwellenM.wert.garageneinfahrt },
];

/** Ehrliche Grenzen: immer sichtbar, nicht eingeklappt. */
export function grenzenHtml(tag: TagFn): string {
  const R = L.starkregen;
  return `<div class="warnbox"><b>Das ist eine Simulation, keine Vorhersage.</b> ${tag('Simulation', 'Simulation')}
    <ul class="fine" style="text-align:left;margin:6px 0 0 16px;padding:0">
      <li><b>Kanalnetz nicht berücksichtigt.</b> ${esc(R.kanalnetz.text)}</li>
      <li><b>Das 1-m-Gelände sieht Bordsteine, Mauern und Schwellen oft nicht.</b> ${esc(R.gelaendeAufloesung.text)}</li>
      <li>${esc(R.umkreisM.text)}</li>
      <li>${esc(R.regenform.text)}</li>
    </ul>
    <p class="fine" style="text-align:left;margin:6px 0 0">Die Simulation ist nie Grundlage einer Ampel. Für eine verbindliche Aussage braucht es eine Fachplanung (z. B. Starkregen-Gefahrenkarte der Gemeinde).</p></div>`;
}

export function szenarioText(mm: number, uc: number | null, quelleKostra: boolean, T: number, dauer: number, tag: TagFn): string {
  const h = mm / (dauer / 60);
  return `<p class="fine" style="text-align:left;margin:6px 0">${quelleKostra
    ? `Bemessungsniederschlag nach KOSTRA-DWD-2020 für den Ort: <b>${fmt(mm, 1)} mm in ${dauer} min</b> (1 Ereignis in ${T} Jahren, Unsicherheit ±${uc != null ? fmt(uc, 0) : '?'} %) ${tag('amtlich', 'amtlich')}`
    : `Eigene Eingabe: <b>${fmt(mm, 1)} mm in ${dauer} min</b> ${tag('nutzerbestätigt', 'nutzerbestätigt')}`} · Intensität ${fmt(h, 0)} mm/h als Blockregen ${tag('Annahme', 'Annahme')}</p>`;
}

export interface MessAnzeige {
  id: string;
  art: string;
  name: string;
  schwelle: number;
  /** Ergebnisse je Variante: Ankunft (min) und höchste Tiefe (cm) */
  mittel: { min: number | null; cm: number } | null;
  guenstig: { min: number | null; cm: number } | null;
  ungunstig: { min: number | null; cm: number } | null;
}

const m1 = (v: number) => fmt(v, 0);

export function messText(m: MessAnzeige): string {
  const n = m.name;
  if (!m.mittel) return `${esc(n)}: wird berechnet …`;
  const sp = (g: number, u: number) => (Math.abs(g - u) < 0.5 ? '' : ` (Spanne ${m1(Math.min(g, u))}–${m1(Math.max(g, u))})`);
  const gm = m.guenstig;
  const um = m.ungunstig;
  if (m.mittel.min == null) {
    const worst = um && um.min != null ? ` Mit ungünstigen Annahmen erreicht Wasser die Stelle nach etwa ${m1(um.min)} Minuten, Tiefe etwa ${m1(um.cm)} cm.` : '';
    return `<b>${esc(n)}:</b> In dieser Simulation erreicht das Wasser die Stelle nicht (höchste Tiefe etwa ${fmt(m.mittel.cm, 1)} cm, Schwelle ${m1(m.schwelle * 100)} cm).${worst}`;
  }
  const zeit = um && gm ? (gm.min == null ? ` (ungünstig ${m1(um.min ?? m.mittel.min)} min, günstig: erreicht sie nicht)` : sp(um.min ?? m.mittel.min, gm.min)) : '';
  const tiefe = um && gm ? sp(gm.cm, um.cm) : '';
  return `<b>${esc(n)}:</b> Wasser erreicht die Stelle nach etwa <b>${m1(m.mittel.min)} Minuten</b>${zeit}, Tiefe etwa <b>${m1(m.mittel.cm)} cm</b>${tiefe}.`;
}

export function bilanzText(e: SimErgebnis, tag: TagFn): string {
  const b = e.bilanz;
  const p = (x: number) => fmt((100 * x) / Math.max(b.regenM3, 1e-9), 0);
  return `<p class="fine" style="text-align:left">Wasserbilanz im Rechengebiet: ${fmt(b.regenM3, 0)} m³ Regen (davon ${fmt(b.daecherM3, 0)} m³ von Dächern, am Gebäuderand abgegeben) – ${p(b.versickertM3 + b.muldeM3)} % versickert oder in Mulden gebunden, ${p(b.abflussM3)} % am Rand abgeflossen, ${p(b.stehendM3)} % steht am Ende noch. ${tag('Simulation', 'Simulation')}</p>`;
}
