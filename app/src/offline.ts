/**
 * Offline-Demo: alle Daten der Kachel 698_5486 vorab in den Browser-Cache laden.
 * Danach läuft die App ohne Netz; Luftbild und Flurkarte kommen dann aus vorab erzeugten
 * Kacheln (pipeline/05_offline_tiles.py) statt aus den WMS-Diensten.
 */
import type { LocalImagery } from './scene/viewer';
import { DATA_URL } from './data';

const FLAG = 'passt-offline-demo';
const DATA_CACHE = 'passt-daten';

function getFlag(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

function setFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {
    /* privater Modus: dann gilt der Modus nur bis zum Neuladen */
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker nicht registriert', e));
}

/** Offline-Demo aktiv: ausdrücklich eingeschaltet, per ?offline erzwungen oder Gerät ohne Netz. */
export function offlineMode(): boolean {
  return getFlag() || new URLSearchParams(location.search).has('offline') || !navigator.onLine;
}

export async function localImagery(): Promise<LocalImagery | null> {
  if (!offlineMode()) return null;
  try {
    const m = await (await fetch(`${DATA_URL}/offline.json`)).json();
    return { minLevel: m.dop.minLevel, maxLevel: m.dop.maxLevel, parzMinLevel: m.parzellar.minLevel, parzMaxLevel: m.parzellar.maxLevel, rect: m.rect };
  } catch {
    return null;
  }
}

export interface OfflineStatus {
  ready: boolean;
  files: number;
  cached: number;
}

async function fileList(): Promise<string[]> {
  return (await (await fetch('./offline-files.json', { cache: 'no-cache' })).json()) as string[];
}

export async function offlineStatus(): Promise<OfflineStatus> {
  if (!('caches' in window)) return { ready: false, files: 0, cached: 0 };
  const list = await fileList();
  const cache = await caches.open(DATA_CACHE);
  const keys = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
  const want = list.map((u) => new URL(u, location.href).pathname);
  const cached = want.filter((p) => keys.has(p)).length;
  return { ready: cached === want.length && getFlag(), files: want.length, cached };
}

/** Lädt alle Dateien der Offline-Demo (6 parallel) und meldet den Fortschritt. */
export async function prepareOffline(progress: (done: number, total: number) => void): Promise<void> {
  if (!('caches' in window)) throw new Error('Dieser Browser kann keine Offline-Daten speichern.');
  const list = await fileList();
  const cache = await caches.open(DATA_CACHE);
  const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
  let done = 0;
  const queue = [...list];
  const worker = async () => {
    for (let u = queue.shift(); u; u = queue.shift()) {
      const abs = new URL(u, location.href);
      if (!have.has(abs.pathname)) {
        const r = await fetch(abs);
        if (!r.ok) throw new Error(`${u}: ${r.status}`);
        await cache.put(abs, r);
      }
      progress(++done, list.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  setFlag(true);
}

export async function endOffline(): Promise<void> {
  setFlag(false);
  if ('caches' in window) await caches.delete(DATA_CACHE);
}
