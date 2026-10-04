import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { abgelaufen, dekodieren, kodieren, linkIdAus, neuerSchluessel, projektHash, type Vorhaben } from '../src/nachbar/link';

const vorhaben = (): Vorhaben => ({
  v: 1,
  u: [699000, 5487000],
  b: [[0, 0], [20.123, 0], [20, 18.5], [0, 20]],
  o: { gartenhaus: { kind: 'gartenhaus', center: [5, 5], w: 3, d: 2.5, h: 2.3, angle: 0.3, neigung: 30 } },
  p: { art: 'hecke', center: [10, 1], laenge: 6, angle: 0, hoehe: 1.8 },
  bis: '2099-12-31',
  l: 'abcdefghijklmnopqrstuv',
});

describe('Nachbar-Link: Vorhaben im URL-Fragment', () => {
  it('kodieren → dekodieren ergibt dasselbe Vorhaben (cm-gerundet), Fragment ist kurz', async () => {
    const s = await kodieren(vorhaben());
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeLessThan(400);
    const v = (await dekodieren(s))!;
    expect(v.b[1]).toEqual([20.12, 0]);
    expect(v.o.gartenhaus).toMatchObject({ center: [5, 5], w: 3, d: 2.5, h: 2.3, angle: 0.3, neigung: 30 });
    expect(v.p).toEqual(vorhaben().p);
    expect(v.l).toBe('abcdefghijklmnopqrstuv');
  });

  it('kaputtes Fragment → null statt Absturz', async () => {
    expect(await dekodieren('kaputt!!')).toBeNull();
    expect(await dekodieren('')).toBeNull();
  });

  it('Projekt-Hash hängt am Vorhaben, nicht an Ablauf oder Kennung', async () => {
    const a = await projektHash(vorhaben());
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await projektHash({ ...vorhaben(), bis: '2000-01-01', l: 'x' } as Vorhaben)).toBe(a);
    const b = vorhaben();
    b.o.gartenhaus!.h = 2.4;
    expect(await projektHash(b)).not.toBe(a);
  });

  it('Link-Kennung aus dem Schlüssel: 22 Zeichen, wie im Server', async () => {
    const k = neuerSchluessel();
    const id = await linkIdAus(k);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const { createHash } = await import('node:crypto');
    expect(id).toBe(createHash('sha256').update(k).digest('base64url').slice(0, 22));
  });

  it('Ablauf am Ende des Tages', () => {
    expect(abgelaufen({ bis: '2026-10-04' }, new Date(2026, 9, 4, 23, 0))).toBe(false);
    expect(abgelaufen({ bis: '2026-10-04' }, new Date(2026, 9, 5, 0, 1))).toBe(true);
  });
});

describe('Nachbar-API (SQLite im Speicher)', () => {
  let server: Server;
  let basis = '';
  beforeAll(async () => {
    process.env.PASST_DB = ':memory:';
    // @ts-expect-error reines JS-Modul
    const { nachbarApi } = await import('../scripts/nachbar-api.mjs');
    server = createServer((req, res) => void nachbarApi(req, res));
    await new Promise<void>((ok) => server.listen(0, ok));
    basis = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/nachbar`;
  });
  afterAll(() => server.close());

  const rufe = (m: string, pfad: string, body?: unknown) =>
    fetch(basis + pfad, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  it('speichert nur Zeit, Antwort und Hash; Ersteller ruft mit Schlüssel ab, widerruft und löscht', async () => {
    const schluessel = neuerSchluessel();
    const link = await linkIdAus(schluessel);
    const hash = 'b'.repeat(64);
    const r1 = await rufe('POST', '/antwort', { link, antwort: 'passt', hash, bis: '2099-01-01', name: 'soll nicht gespeichert werden' });
    expect(r1.status).toBe(201);
    const { id } = await r1.json();
    expect((await rufe('POST', `/link/${link}/abruf`, { schluessel: 'falsch' })).status).toBe(403);
    const a = await (await rufe('POST', `/link/${link}/abruf`, { schluessel })).json();
    expect(a.antworten).toHaveLength(1);
    expect(Object.keys(a.antworten[0]).sort()).toEqual(['antwort', 'hash', 'zeit']);
    // Nachbar löscht seine Antwort
    expect((await rufe('DELETE', `/antwort/${id}`)).status).toBe(204);
    expect((await (await rufe('POST', `/link/${link}/abruf`, { schluessel })).json()).antworten).toHaveLength(0);
    // Widerruf: keine neuen Antworten
    await rufe('POST', '/antwort', { link, antwort: 'frage', hash, bis: '2099-01-01' });
    expect((await rufe('POST', `/link/${link}/widerruf`, { schluessel })).status).toBe(204);
    expect(await (await rufe('GET', `/link/${link}`)).json()).toEqual({ zurueckgezogen: true });
    expect((await rufe('POST', '/antwort', { link, antwort: 'passt', hash, bis: '2099-01-01' })).status).toBe(410);
    // Löschen
    expect((await rufe('POST', `/link/${link}/loeschen`, { schluessel })).status).toBe(204);
    expect((await (await rufe('POST', `/link/${link}/abruf`, { schluessel })).json()).antworten).toHaveLength(0);
  });

  it('lehnt ungültige Antworten und abgelaufene Links ab', async () => {
    const link = await linkIdAus(neuerSchluessel());
    expect((await rufe('POST', '/antwort', { link, antwort: 'egal', hash: 'c'.repeat(64), bis: '2099-01-01' })).status).toBe(400);
    expect((await rufe('POST', '/antwort', { link, antwort: 'passt', hash: 'c'.repeat(64), bis: '2020-01-01' })).status).toBe(410);
  });
});
