/**
 * /api/tipp → Tipp-Dienst (pipeline/tipp_dienst.py, nur localhost). Reicht nur x, y und Klasse weiter, speichert nichts.
 * Adresse: PASST_TIPP_URL (Standard http://127.0.0.1:8765/tipp).
 */
const ZIEL = process.env.PASST_TIPP_URL || 'http://127.0.0.1:8765/tipp';
const KLASSEN = new Set(['gartenhaus', 'carport_garage', 'gewaechshaus', 'pool', 'trampolin', 'spielturm', 'terrasse', 'teich', 'hecke', 'baum', 'strauch', 'waermepumpe']);

export function tippAnfrage(body) {
  const x = Number(body?.x);
  const y = Number(body?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 500000 || x > 900000 || y < 5200000 || y > 5650000) return null;
  const k = body?.klasse;
  if (k != null && !KLASSEN.has(k)) return null;
  return k ? { x, y, klasse: k } : { x, y };
}

export async function tippApi(req, res) {
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST') return json(405, { ok: false, grund: 'nur POST' });
  let roh = '';
  for await (const c of req) { roh += c; if (roh.length > 2000) return json(413, { ok: false, grund: 'zu groß' }); }
  let q;
  try { q = tippAnfrage(JSON.parse(roh)); } catch { q = null; }
  if (!q) return json(400, { ok: false, grund: 'Anfrage ungültig' });
  try {
    const r = await fetch(ZIEL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q), signal: AbortSignal.timeout(60000) });
    json(r.status, await r.json());
  } catch {
    json(503, { ok: false, dienst: false, grund: 'Der Tipp-Dienst läuft nicht. Start: cd pipeline && python3 tipp_dienst.py (braucht die Rohdaten). Du kannst das Objekt auch einzeichnen.' });
  }
}
