/**
 * /api/tipp → Tipp-Dienst (pipeline/tipp_dienst.py, nur localhost). Reicht nur x, y und Klasse weiter, speichert nichts.
 * /api/tipp/vorbereiten → Embeddings für Grundstück + 20 m Rand im Hintergrund rechnen lassen (nur Umrisspunkte, ohne Adresse).
 * Adresse: PASST_TIPP_URL (Standard http://127.0.0.1:8765/tipp).
 */
const ZIEL = process.env.PASST_TIPP_URL || 'http://127.0.0.1:8765/tipp';
const ZIEL_VORBEREITEN = ZIEL.replace(/\/tipp$/, '/vorbereiten');
const KLASSEN = new Set(['gartenhaus', 'carport_garage', 'gewaechshaus', 'pool', 'trampolin', 'spielturm', 'terrasse', 'teich', 'hecke', 'baum', 'strauch', 'waermepumpe']);
const imGebiet = (x, y) => Number.isFinite(x) && Number.isFinite(y) && x >= 500000 && x <= 900000 && y >= 5200000 && y <= 5650000;

export function tippAnfrage(body) {
  const x = Number(body?.x);
  const y = Number(body?.y);
  if (!imGebiet(x, y)) return null;
  const k = body?.klasse;
  if (k != null && !KLASSEN.has(k)) return null;
  return k ? { x, y, klasse: k } : { x, y };
}

/** Nur Umrisspunkte (UTM), höchstens 200, Ausdehnung höchstens 400 m – sonst null. */
export function vorbereitenAnfrage(body) {
  const u = body?.umriss;
  if (!Array.isArray(u) || u.length < 1 || u.length > 200) return null;
  const pts = u.map((p) => (Array.isArray(p) && p.length === 2 ? [Number(p[0]), Number(p[1])] : [NaN, NaN]));
  if (!pts.every(([x, y]) => imGebiet(x, y))) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  if (Math.max(...xs) - Math.min(...xs) > 400 || Math.max(...ys) - Math.min(...ys) > 400) return null;
  return { umriss: pts.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]) };
}

export async function tippApi(req, res) {
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST') return json(405, { ok: false, grund: 'nur POST' });
  const vorb = /\/vorbereiten\/?(\?|$)/.test(req.url ?? '');
  let roh = '';
  for await (const c of req) { roh += c; if (roh.length > (vorb ? 20000 : 2000)) return json(413, { ok: false, grund: 'zu groß' }); }
  let q;
  try { q = (vorb ? vorbereitenAnfrage : tippAnfrage)(JSON.parse(roh)); } catch { q = null; }
  if (!q) return json(400, { ok: false, grund: 'Anfrage ungültig' });
  try {
    const r = await fetch(vorb ? ZIEL_VORBEREITEN : ZIEL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q), signal: AbortSignal.timeout(vorb ? 10000 : 60000) });
    json(r.status, await r.json());
  } catch {
    json(503, { ok: false, dienst: false, grund: 'Der Tipp-Dienst läuft nicht. Start: cd pipeline && python3 tipp_dienst.py (braucht die Rohdaten). Du kannst das Objekt auch einzeichnen.' });
  }
}
