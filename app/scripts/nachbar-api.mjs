/**
 * API für Antworten auf Nachbar-Links (AUFTRAG_V2 Phase 3.2). SQLite über das eingebaute `node:sqlite`
 * (Node ≥ 22.5; ab 22.13 ohne Schalter). Keine zusätzliche Abhängigkeit.
 *
 * Datensparsam: je Antwort nur Zeitpunkt, Antwort ('passt' | 'frage'), Projekt-Hash, Link-Kennung und eine zufällige
 * Antwort-Kennung (Löschrecht des Nachbarn). Keine IP, kein Name, kein Vorhaben (das steht nur im URL-Fragment).
 * Widerruf: Tabelle mit Link-Kennung und Zeitpunkt. Antworten werden nach 400 Tagen automatisch gelöscht.
 *
 * Berechtigung des Link-Erstellers ohne Konto: Link-Kennung = base64url(SHA-256(Schlüssel))[0:22]; wer den Schlüssel
 * vorlegt, darf abrufen, widerrufen und löschen.
 *
 *   POST   /api/nachbar/antwort                 {link, antwort, hash, bis}  → {id}
 *   DELETE /api/nachbar/antwort/:id                                          → 204
 *   GET    /api/nachbar/link/:link                                           → {zurueckgezogen}
 *   POST   /api/nachbar/link/:link/abruf        {schluessel}                → {antworten: [{zeit, antwort, hash}]}
 *   POST   /api/nachbar/link/:link/widerruf     {schluessel}                → 204
 *   POST   /api/nachbar/link/:link/loeschen     {schluessel}                → 204
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUFBEWAHRUNG_TAGE = 400;
const LINK = /^[A-Za-z0-9_-]{22}$/;
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[0-9a-f-]{36}$/;
const ANTWORTEN = new Set(['passt', 'frage']);

let db = null;
let fehler = null;

async function oeffnen() {
  if (db || fehler) return db;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const pfad = process.env.PASST_DB || resolve(dirname(fileURLToPath(import.meta.url)), '../.daten/nachbar.sqlite');
    if (pfad !== ':memory:') mkdirSync(dirname(pfad), { recursive: true });
    db = new DatabaseSync(pfad);
    db.exec(`CREATE TABLE IF NOT EXISTS antwort (id TEXT PRIMARY KEY, link TEXT NOT NULL, zeit TEXT NOT NULL, antwort TEXT NOT NULL, hash TEXT NOT NULL);
             CREATE INDEX IF NOT EXISTS antwort_link ON antwort(link);
             CREATE TABLE IF NOT EXISTS widerruf (link TEXT PRIMARY KEY, zeit TEXT NOT NULL);`);
    aufraeumen();
  } catch (e) {
    fehler = `SQLite nicht verfügbar (Node ≥ 22.5 nötig): ${e.message}`;
    console.warn(fehler);
  }
  return db;
}

function aufraeumen() {
  const grenze = new Date(Date.now() - AUFBEWAHRUNG_TAGE * 86400000).toISOString();
  db.prepare('DELETE FROM antwort WHERE zeit < ?').run(grenze);
}

const linkAus = (schluessel) => createHash('sha256').update(String(schluessel)).digest('base64url').slice(0, 22);

/** einfache Drossel je Adresse (nur im Speicher, nichts wird geschrieben) */
const zaehler = new Map();
function gedrosselt(req) {
  const k = req.socket.remoteAddress || '?';
  const jetzt = Date.now();
  const z = zaehler.get(k) || { t: jetzt, n: 0 };
  if (jetzt - z.t > 60000) { z.t = jetzt; z.n = 0; }
  z.n++;
  zaehler.set(k, z);
  if (zaehler.size > 5000) zaehler.clear();
  return z.n > 30;
}

function lesen(req) {
  return new Promise((ok, nein) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 2000) { nein(new Error('zu groß')); req.destroy(); }
    });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { nein(e); } });
    req.on('error', nein);
  });
}

const json = (res, status, daten) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(daten === undefined ? '' : JSON.stringify(daten));
};
const leer = (res) => { res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end(); };
const falsch = (res, text, status = 400) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); };

/** Behandelt /api/nachbar/…; liefert false, wenn der Pfad nicht dazugehört. */
export async function nachbarApi(req, res) {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/\/api\/nachbar(\/.*)$/);
  if (!m) return false;
  const pfad = m[1];
  if (!(await oeffnen())) return falsch(res, fehler, 503), true;
  if (req.method !== 'GET' && gedrosselt(req)) return falsch(res, 'Zu viele Anfragen, bitte kurz warten.', 429), true;
  try {
    if (pfad === '/antwort' && req.method === 'POST') {
      const b = await lesen(req);
      if (!LINK.test(b.link || '') || !ANTWORTEN.has(b.antwort) || !HASH.test(b.hash || '') || !/^\d{4}-\d{2}-\d{2}$/.test(b.bis || '')) return falsch(res, 'Ungültige Angaben.'), true;
      const [y, mo, d] = b.bis.split('-').map(Number);
      if (Date.now() > Date.UTC(y, mo - 1, d, 23, 59, 59) + 14 * 3600000) return falsch(res, 'Der Link ist abgelaufen.', 410), true;
      if (db.prepare('SELECT 1 FROM widerruf WHERE link = ?').get(b.link)) return falsch(res, 'Der Link wurde zurückgezogen.', 410), true;
      const id = randomUUID();
      db.prepare('INSERT INTO antwort (id, link, zeit, antwort, hash) VALUES (?, ?, ?, ?, ?)').run(id, b.link, new Date().toISOString(), b.antwort, b.hash);
      return json(res, 201, { id }), true;
    }
    let t = pfad.match(/^\/antwort\/([^/]+)$/);
    if (t && req.method === 'DELETE') {
      if (!ID.test(t[1])) return falsch(res, 'Ungültige Kennung.'), true;
      db.prepare('DELETE FROM antwort WHERE id = ?').run(t[1]);
      return leer(res), true;
    }
    t = pfad.match(/^\/link\/([A-Za-z0-9_-]{22})(\/(abruf|widerruf|loeschen))?$/);
    if (t) {
      const link = t[1];
      if (!t[3] && req.method === 'GET') return json(res, 200, { zurueckgezogen: !!db.prepare('SELECT 1 FROM widerruf WHERE link = ?').get(link) }), true;
      if (req.method !== 'POST') return falsch(res, 'Methode nicht erlaubt.', 405), true;
      const b = await lesen(req);
      if (linkAus(b.schluessel ?? '') !== link) return falsch(res, 'Schlüssel passt nicht zum Link.', 403), true;
      if (t[3] === 'abruf') {
        const rows = db.prepare('SELECT zeit, antwort, hash FROM antwort WHERE link = ? ORDER BY zeit').all(link);
        return json(res, 200, { antworten: rows.map((r) => ({ zeit: r.zeit, antwort: r.antwort, hash: r.hash })) }), true;
      }
      db.prepare('INSERT OR IGNORE INTO widerruf (link, zeit) VALUES (?, ?)').run(link, new Date().toISOString());
      if (t[3] === 'loeschen') db.prepare('DELETE FROM antwort WHERE link = ?').run(link);
      return leer(res), true;
    }
    return falsch(res, 'Unbekannt.', 404), true;
  } catch (e) {
    return falsch(res, `Fehler: ${e.message}`), true;
  }
}
