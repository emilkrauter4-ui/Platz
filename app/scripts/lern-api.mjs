/**
 * Lernschleife (AUFTRAG_V2 Phase 4.2, Speicher-Entscheidung vom 4. Oktober 2026): Bestätigungen und Korrekturen der
 * Garten-Erkennung – nur mit ausdrücklicher Einwilligung in der App, nur Geometrie, Klasse und Kachel. Lokal als
 * JSONL-Datei (`app/.daten/lernen.jsonl`, Pfad über PASST_LERNEN). Keine IP, kein Zeitpunkt, keine Adresse, keine
 * Grundstücksgrenze. Jeder Eintrag bekommt eine zufällige Kennung; mit ihr kann man ihn wieder löschen.
 *
 *   POST /api/lernen         {eintraege: [{aktion, klasse, geometrie, kachel, modell}]}  → {ids}
 *   POST /api/lernen/loeschen {ids: [...]}                                                → {geloescht}
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AKTIONEN = new Set(['bestaetigt', 'verworfen', 'nachgezogen', 'neu']);
export const KLASSEN = new Set(['gartenhaus', 'gewaechshaus', 'carport_garage', 'pool', 'teich', 'terrasse', 'trampolin', 'spielturm', 'hecke', 'baum', 'strauch', 'waermepumpe', 'zaun_mauer', 'kleinbau']);
const MAX_PUNKTE = 64;
const MAX_DATEI = 20 * 1024 * 1024;
// grob Bayern in EPSG:25832
const E = [500000, 900000];
const N = [5230000, 5620000];

const pfad = () => process.env.PASST_LERNEN || resolve(dirname(fileURLToPath(import.meta.url)), '../.daten/lernen.jsonl');

/** Prüft und bereinigt einen Eintrag; null = ungültig. Unbekannte Felder werden verworfen. */
export function bereinigen(e) {
  if (!e || typeof e !== 'object') return null;
  if (!AKTIONEN.has(e.aktion) || !KLASSEN.has(e.klasse)) return null;
  if (typeof e.kachel !== 'string' || !/^\d{3}_\d{4}$/.test(e.kachel)) return null;
  const g = e.geometrie;
  if (!Array.isArray(g) || g.length < 3 || g.length > MAX_PUNKTE) return null;
  const punkte = [];
  for (const p of g) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) return null;
    if (p[0] < E[0] || p[0] > E[1] || p[1] < N[0] || p[1] > N[1]) return null;
    punkte.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
  }
  // Kachel muss zur Geometrie passen (1-km-Kachel der ersten Ecke)
  if (`${Math.floor(punkte[0][0] / 1000)}_${Math.floor(punkte[0][1] / 1000)}` !== e.kachel) return null;
  const modell = Number.isInteger(e.modell) && e.modell >= 0 && e.modell < 10000 ? e.modell : null;
  return { aktion: e.aktion, klasse: e.klasse, geometrie: punkte, kachel: e.kachel, modell };
}

function lesen(req) {
  return new Promise((ok, nein) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 200000) { nein(new Error('zu groß')); req.destroy(); }
    });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { nein(e); } });
    req.on('error', nein);
  });
}

const antwort = (res, status, daten) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(daten));
};

const zaehler = new Map();
function gedrosselt(req) {
  const k = req.socket.remoteAddress || '?';
  const jetzt = Date.now();
  const z = zaehler.get(k) || { t: jetzt, n: 0 };
  if (jetzt - z.t > 60000) { z.t = jetzt; z.n = 0; }
  z.n++;
  zaehler.set(k, z);
  if (zaehler.size > 5000) zaehler.clear();
  return z.n > 60;
}

/** Behandelt /api/lernen…; false, wenn der Pfad nicht dazugehört. */
export async function lernApi(req, res) {
  const p = new URL(req.url, 'http://x').pathname;
  const m = p.match(/\/api\/lernen(\/loeschen)?$/);
  if (!m) return false;
  if (req.method !== 'POST') return antwort(res, 405, { fehler: 'Methode nicht erlaubt' }), true;
  if (gedrosselt(req)) return antwort(res, 429, { fehler: 'Zu viele Anfragen' }), true;
  try {
    const b = await lesen(req);
    const datei = pfad();
    mkdirSync(dirname(datei), { recursive: true });
    if (!m[1]) {
      if (!Array.isArray(b.eintraege) || b.eintraege.length > 50) return antwort(res, 400, { fehler: 'eintraege fehlen' }), true;
      if (existsSync(datei) && statSync(datei).size > MAX_DATEI) return antwort(res, 507, { fehler: 'Speicher voll' }), true;
      const ids = [];
      const zeilen = [];
      for (const e of b.eintraege) {
        const x = bereinigen(e);
        if (!x) { ids.push(null); continue; }
        const id = randomUUID();
        ids.push(id);
        zeilen.push(JSON.stringify({ id, ...x }));
      }
      if (zeilen.length) appendFileSync(datei, zeilen.join('\n') + '\n', 'utf8');
      return antwort(res, 201, { ids }), true;
    }
    const weg = new Set((Array.isArray(b.ids) ? b.ids : []).filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x)));
    if (!weg.size || !existsSync(datei)) return antwort(res, 200, { geloescht: 0 }), true;
    const alt = readFileSync(datei, 'utf8').split('\n').filter(Boolean);
    const neu = alt.filter((z) => { try { return !weg.has(JSON.parse(z).id); } catch { return false; } });
    writeFileSync(datei, neu.length ? neu.join('\n') + '\n' : '', 'utf8');
    return antwort(res, 200, { geloescht: alt.length - neu.length }), true;
  } catch (e) {
    return antwort(res, 400, { fehler: String(e.message) }), true;
  }
}
