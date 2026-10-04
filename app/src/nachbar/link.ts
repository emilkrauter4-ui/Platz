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

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
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
