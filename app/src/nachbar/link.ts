/**
 * Nachbar-Link (AUFTRAG_V2 Phase 3.2, Speicher-Entscheidung vom 4. Oktober 2026):
 * Das Vorhaben steht komprimiert im URL-Fragment (#n=…). Das Fragment schickt der Browser nie an einen Server –
 * das Vorhaben wird nirgends gespeichert. Gespeichert wird nur die Antwort des Nachbarn (siehe ../speicher).
 *
 * Link-Kennung = die ersten 22 Zeichen von base64url(SHA-256(Schlüssel)). Den Schlüssel kennt nur, wer den Link
 * erstellt hat (localStorage). Damit kann der Server Widerruf und Löschen prüfen, ohne Links zu speichern.
 */
import type { ObjectKind, Placed, Vec2 } from '../rules/types';
import type { Pflanze } from '../rules/pflanzen';

export const VERSION = 1;

export interface Vorhaben {
  v: number;
  /** UTM-Ursprung der lokalen Koordinaten (EPSG:25832) */
  u: Vec2;
  /** Grundstücksgrenze (lokal, cm-gerundet) */
  b: Vec2[];
  /** geteilte Objekte */
  o: Partial<Record<ObjectKind, Placed>>;
  p?: Pflanze;
  /** Ablauf (YYYY-MM-DD) */
  bis: string;
  /** Link-Kennung */
  l: string;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const rp = (p: Vec2): Vec2 => [r2(p[0]), r2(p[1])];

function kompakt(v: Omit<Vorhaben, 'bis' | 'l'>): unknown {
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v.o) as [ObjectKind, Placed][]) {
    o[k] = [r2(x.center[0]), r2(x.center[1]), r2(x.w), r2(x.d), r2(x.h), Math.round(x.angle * 1e4) / 1e4, x.neigung ?? 0, x.lw ?? 0];
  }
  const p = v.p ? [v.p.art, r2(v.p.center[0]), r2(v.p.center[1]), r2(v.p.laenge), Math.round(v.p.angle * 1e4) / 1e4, r2(v.p.hoehe)] : undefined;
  return { v: v.v, u: v.u, b: v.b.map(rp), o, ...(p ? { p } : {}) };
}

function auspacken(j: { v: number; u: Vec2; b: Vec2[]; o: Record<string, number[]>; p?: [Pflanze['art'], number, number, number, number, number]; bis: string; l: string }): Vorhaben {
  const o: Vorhaben['o'] = {};
  for (const [k, a] of Object.entries(j.o)) {
    const kind = k as ObjectKind;
    o[kind] = { kind, center: [a[0], a[1]], w: a[2], d: a[3], h: a[4], angle: a[5], ...(a[6] ? { neigung: a[6] } : {}), ...(a[7] ? { lw: a[7] } : {}) };
  }
  const p = j.p ? { art: j.p[0], center: [j.p[1], j.p[2]] as Vec2, laenge: j.p[3], angle: j.p[4], hoehe: j.p[5] } : undefined;
  return { v: j.v, u: j.u, b: j.b, o, ...(p ? { p } : {}), bis: j.bis, l: j.l };
}

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function strom(daten: Uint8Array, s: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([daten as BlobPart]).stream().pipeThrough(s));
  return new Uint8Array(await out.arrayBuffer());
}

/**
 * SHA-256. crypto.subtle gibt es nur in sicherem Kontext (https oder localhost); über http im WLAN
 * (iPhone → Laptop) fehlt es, dann rechnet die kleine Ersatzfunktion.
 */
export async function sha256(text: string): Promise<Uint8Array> {
  const daten = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) return new Uint8Array(await crypto.subtle.digest('SHA-256', daten));
  return sha256Js(daten);
}

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Js(m: Uint8Array): Uint8Array {
  const l = m.length;
  const n = Math.ceil((l + 9) / 64) * 64;
  const b = new Uint8Array(n);
  b.set(m);
  b[l] = 0x80;
  const dv = new DataView(b.buffer);
  dv.setUint32(n - 8, Math.floor(l / 0x20000000), false);
  dv.setUint32(n - 4, (l * 8) >>> 0, false);
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const r = (x: number, k: number) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += bb; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const od = new DataView(out.buffer);
  h.forEach((x, i) => od.setUint32(i * 4, x, false));
  return out;
}

/** Prüfsumme des Vorhabens (ohne Ablauf und Kennung): zeigt, auf welchen Stand sich eine Antwort bezieht. */
export async function projektHash(v: Omit<Vorhaben, 'bis' | 'l'>): Promise<string> {
  return [...(await sha256(JSON.stringify(kompakt(v))))].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function linkIdAus(schluessel: string): Promise<string> {
  return b64u(await sha256(schluessel)).slice(0, 22);
}

export function neuerSchluessel(): string {
  return b64u(crypto.getRandomValues(new Uint8Array(24)));
}

export async function kodieren(v: Vorhaben): Promise<string> {
  const json = JSON.stringify({ ...(kompakt(v) as object), bis: v.bis, l: v.l });
  return b64u(await strom(new TextEncoder().encode(json), new CompressionStream('deflate-raw')));
}

export async function dekodieren(s: string): Promise<Vorhaben | null> {
  try {
    const roh = await strom(unb64u(s), new DecompressionStream('deflate-raw'));
    const j = JSON.parse(new TextDecoder().decode(roh));
    if (j.v !== VERSION || !Array.isArray(j.b) || typeof j.l !== 'string') return null;
    return auspacken(j);
  } catch {
    return null;
  }
}

/** Ist der Link abgelaufen? Ablauf am Ende des Tages `bis` (Ortszeit). */
export function abgelaufen(v: Pick<Vorhaben, 'bis'>, jetzt = new Date()): boolean {
  const [y, m, d] = v.bis.split('-').map(Number);
  return jetzt.getTime() > new Date(y, m - 1, d, 23, 59, 59).getTime();
}
