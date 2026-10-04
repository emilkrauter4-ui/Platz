import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kachelAus } from '../src/speicher';

const geo: [number, number][] = [[698012.34, 5486020.01], [698015.3, 5486020.0], [698015.3, 5486022.5], [698012.3, 5486022.5]];
const gut = { aktion: 'nachgezogen', klasse: 'gartenhaus', geometrie: geo, kachel: kachelAus(geo[0][0], geo[0][1]), modell: 4 };

describe('Lernschleife: nur Geometrie, Klasse, Kachel – nur mit Einwilligung', () => {
  let server: Server;
  let basis = '';
  let datei = '';
  beforeAll(async () => {
    datei = join(mkdtempSync(join(tmpdir(), 'passt-')), 'lernen.jsonl');
    process.env.PASST_LERNEN = datei;
    // @ts-expect-error reines JS-Modul
    const { lernApi } = await import('../scripts/lern-api.mjs');
    server = createServer((req, res) => void lernApi(req, res));
    await new Promise<void>((ok) => server.listen(0, ok));
    basis = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/lernen`;
  });
  afterAll(() => server.close());
  const post = (pfad: string, body: unknown) => fetch(basis + pfad, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('Kachel = 1-km-Kachel der ersten Ecke', () => {
    expect(kachelAus(698012.3, 5486020)).toBe('698_5486');
  });

  it('speichert nur die erlaubten Felder, rundet auf 10 cm, verwirft Unbekanntes und Ungültiges', async () => {
    const r = await post('', { eintraege: [
      { ...gut, adresse: 'Musterweg 1', name: 'X', grenze: [[1, 2]] },
      { ...gut, klasse: 'rakete' },
      { ...gut, kachel: '699_5486' }, // passt nicht zur Geometrie
      { ...gut, geometrie: [[1, 2], [3, 4], [5, 6]] }, // außerhalb Bayerns
    ] });
    expect(r.status).toBe(201);
    const { ids } = await r.json();
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids.slice(1)).toEqual([null, null, null]);
    const zeilen = readFileSync(datei, 'utf8').trim().split('\n').map((z) => JSON.parse(z));
    expect(zeilen).toHaveLength(1);
    expect(Object.keys(zeilen[0]).sort()).toEqual(['aktion', 'geometrie', 'id', 'kachel', 'klasse', 'modell']);
    expect(zeilen[0].geometrie[0]).toEqual([698012.3, 5486020]);
  });

  it('löscht eigene Beiträge über die Kennung', async () => {
    const { ids } = await (await post('', { eintraege: [gut, { ...gut, aktion: 'verworfen' }] })).json();
    const r = await (await post('/loeschen', { ids })).json();
    expect(r.geloescht).toBe(2);
    expect(readFileSync(datei, 'utf8').trim().split('\n')).toHaveLength(1);
  });
});
