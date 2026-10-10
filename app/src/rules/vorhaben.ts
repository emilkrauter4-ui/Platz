/**
 * Stockwerk 3 „Großes Vorhaben“ (AUFTRAG_V3 Phase B): zweites Wohnhaus, Anbau, Aufstockung.
 * Das Ergebnis ist Orientierung, nie eine Zusage – ob gebaut werden darf, entscheidet die Gemeinde.
 *
 * Geprüft wird nur, was sich messen lässt: Abstandsflächen (BayBO Art. 6, Überdeckung nach Abs. 3 auch mit den
 * Abstandsflächen eigener Gebäude), Lage im Grundstück, Kollisionen und – in zufahrt.ts – die Zufahrt. Alle Grenzwerte
 * stehen in limits.json (`abstand`, `grossesVorhaben`, alle `geprueft: false`). Reine Funktionen.
 *
 * Auslegungen (im Ergebnis als `offen` gekennzeichnet):
 *  - Pultdach: Passt. rechnet 1/3 der Dachhöhe an allen Wänden an, auch an der hohen Wand (sicher nach oben).
 *  - Giebelwände: wie das Dach (1/3, wie in abstand.ts `giebelAlsDach`).
 *  - Abs. 3 Nr. 2 (fremder Sicht entzogener Gartenhof) kann Passt. nicht erkennen.
 */
import L from './limits.json';
import { area, centroid, clipArea, edges, footprint, insidePolygon, pointInPolygon, signedArea } from './geometry';
import {
  aussenNormale,
  dachAnteil4,
  dachHoehe,
  flaeche,
  gebaeudeFlaechen,
  tiefe,
  waende,
  wandWinkel,
  type Wand,
} from './abstand';
import { fmt, geprueft, istGebaeude } from './evaluate';
import type { Building, Placed, Row, Site, Status, Vec2 } from './types';

const G = L.grossesVorhaben;
const WINKEL_UEBERDECKUNG = L.abstand.ueberdeckungWinkelGrad.wert;
/** Gebäude in den Abstandsflächen bis zu dieser mittleren Wandhöhe (Art. 6 Abs. 7 Satz 1 Nr. 1) */
const KLEINBAU_HOEHE = L.grenzbebauung.maxMittlereWandhoeheM.wert;

export type VorhabenArt = 'wohnhaus' | 'anbau' | 'aufstockung';
export type Dachform = 'sattel' | 'pult' | 'flach';

export const VORHABEN_NAME: Record<VorhabenArt, { name: string; art: string }> = {
  wohnhaus: { name: 'Zweites Wohnhaus', art: 'das zweite Wohnhaus' },
  anbau: { name: 'Anbau', art: 'den Anbau' },
  aufstockung: { name: 'Aufstockung', art: 'die Aufstockung' },
};

export interface Vorhaben {
  art: VorhabenArt;
  /** Wohnhaus: Mitte des Grundrisses. Anbau und Aufstockung: wird aus dem Gebäude abgeleitet. */
  center: Vec2;
  /** Wohnhaus: Breite (lokale x-Achse). Anbau: Länge entlang der Hauswand. */
  w: number;
  /** Wohnhaus: Tiefe. Anbau: Tiefe senkrecht zur Hauswand. */
  d: number;
  /** Drehung in Bogenmaß (nur Wohnhaus; beim Anbau folgt sie der Wand) */
  angle: number;
  /** Wohnhaus/Anbau: Zahl der Vollgeschosse. Aufstockung: zusätzliche Geschosse (meist 1). */
  geschosse: number;
  /** Geschosshöhe Fußboden zu Fußboden (Annahme, vom Nutzer einstellbar) */
  geschosshoehe: number;
  dachform: Dachform;
  /** Dachneigung in Grad (Sattel, Pult) */
  neigung: number;
  /** Anbau: Gebäude, Wandseite (Index der Kante des Grundrisses) und Versatz der Mitte entlang der Wand in m */
  hostId?: string;
  hostKante?: number;
  versatz?: number;
  /** Anbau mit Satteldach: First quer zur Hauswand (sonst parallel) */
  firstQuer?: boolean;
  /** Aufstockung: das aufgestockte Gebäude */
  zielId?: string;
  /** Fußbodenhöhe; fehlt: höchster Geländepunkt unter dem Grundriss (Annahme) */
  baseElevation?: number;
}

/** Ein Wandstück mit Abstandsfläche (gemeinsame Form für neue und bestehende Gebäude). */
export interface AFWand {
  a: Vec2;
  b: Vec2;
  flaeche: Vec2[];
  /** H nach Art. 6 Abs. 4 (größter Wert an den Wandenden) */
  h: number;
}

export interface Grundriss {
  fp: Vec2[];
  /** Hilfsobjekt für Wände, Dach und Körper (First entlang w); null bei der Aufstockung */
  proxy: Placed | null;
  /** Pultdach: Kante (0 oder 2) der niedrigen Traufe */
  niedrigKante: 0 | 2 | null;
  host: Building | null;
  /** Anbau: angebaute Wand als Strecke */
  dock: [Vec2, Vec2] | null;
}

export function eigeneGebaeude(site: Site): Building[] {
  return site.buildings.filter((b) => b.own && b.footprint.length >= 3);
}

export function neuesVorhaben(art: VorhabenArt, site: Site): Vorhaben {
  const c = centroid(site.plot.boundary);
  const eigene = eigeneGebaeude(site);
  const gross = [...eigene].sort((a, b) => area(b.footprint) - area(a.footprint))[0];
  const basis = { center: c, angle: 0, geschosshoehe: G.geschosshoeheAnnahmeM.wert };
  if (art === 'wohnhaus') return { art, ...basis, w: 10, d: 8, geschosse: 2, dachform: 'sattel', neigung: 35 };
  if (art === 'anbau') {
    const host = gross;
    let kante = 0;
    if (host) {
      // längste Wand, vor der noch Platz im Grundstück ist
      const es = edges(host.footprint);
      const len = (i: number) => Math.hypot(es[i][1][0] - es[i][0][0], es[i][1][1] - es[i][0][1]);
      const frei = es.map((_, i) => i).filter((i) => {
        const [a, b] = es[i];
        const n = aussenNormale(a, b, signedArea(host.footprint) > 0);
        const m: Vec2 = [(a[0] + b[0]) / 2 + n[0] * 2, (a[1] + b[1]) / 2 + n[1] * 2];
        return pointInPolygon(m, site.plot.boundary);
      });
      kante = (frei.length ? frei : es.map((_, i) => i)).sort((i, j) => len(j) - len(i))[0];
    }
    return { art, ...basis, w: 4, d: 3.5, geschosse: 1, dachform: 'flach', neigung: 10, hostId: host?.id, hostKante: kante, versatz: 0 };
  }
  return { art, ...basis, w: 0, d: 0, geschosse: 1, dachform: 'sattel', neigung: 35, zielId: gross?.id };
}

const hostVon = (site: Site, id?: string) => site.buildings.find((b) => b.id === id) ?? null;

/** Grundriss und Hilfsobjekte. null, wenn das gewählte Gebäude fehlt. */
export function grundriss(site: Site, v: Vorhaben): Grundriss | null {
  const wand = v.geschosse * v.geschosshoehe;
  const neig = v.dachform === 'flach' ? 0 : v.neigung;
  const basis = { kind: 'gartenhaus' as const, h: wand, baseElevation: v.baseElevation };
  if (v.art === 'aufstockung') {
    const host = hostVon(site, v.zielId);
    return host ? { fp: host.footprint, proxy: null, niedrigKante: null, host, dock: null } : null;
  }
  if (v.art === 'wohnhaus') {
    const proxy: Placed = { ...basis, center: v.center, w: v.w, d: v.d, angle: v.angle, neigung: neig };
    return { fp: footprint(proxy), proxy, niedrigKante: v.dachform === 'pult' ? 0 : null, host: null, dock: null };
  }
  const host = hostVon(site, v.hostId);
  const es = host ? edges(host.footprint) : [];
  const e = es[v.hostKante ?? 0];
  if (!host || !e) return null;
  const [a, b] = e;
  const L0 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u: Vec2 = [(b[0] - a[0]) / L0, (b[1] - a[1]) / L0];
  const n = aussenNormale(a, b, signedArea(host.footprint) > 0);
  const t = L0 / 2 + (v.versatz ?? 0);
  const m: Vec2 = [a[0] + u[0] * t, a[1] + u[1] * t];
  const center: Vec2 = [m[0] + n[0] * (v.d / 2), m[1] + n[1] * (v.d / 2)];
  // lokales +y = nach außen, lokales x = −u (siehe footprint): Kante 0 liegt an der Hauswand, Kante 2 außen
  const angle = Math.atan2(-u[1], -u[0]);
  const fp = footprint({ center, w: v.w, d: v.d, angle });
  const quer = v.dachform === 'sattel' && v.firstQuer;
  const proxy: Placed = quer
    ? { ...basis, center, w: v.d, d: v.w, angle: angle + Math.PI / 2, neigung: neig }
    : { ...basis, center, w: v.w, d: v.d, angle, neigung: neig };
  const dock: [Vec2, Vec2] = [
    [m[0] - u[0] * (v.w / 2), m[1] - u[1] * (v.w / 2)],
    [m[0] + u[0] * (v.w / 2), m[1] + u[1] * (v.w / 2)],
  ];
  return { fp, proxy, niedrigKante: v.dachform === 'pult' ? 2 : null, host, dock };
}

/** Dachhöhe (First bzw. hohe Traufe über der niedrigen Traufe) des Vorhabens. */
export function vorhabenDachHoehe(v: Vorhaben, g: Grundriss): number {
  if (v.art === 'aufstockung') return Math.max(0, (g.host?.first ?? g.host?.trauf ?? 0) - (g.host?.trauf ?? 0));
  if (v.dachform === 'flach' || !g.proxy) return 0;
  if (v.dachform === 'sattel') return dachHoehe(g.proxy);
  return g.proxy.d * Math.tan((v.neigung * Math.PI) / 180);
}

/** Wände eines Pultdachhauses: Wandhöhe an jedem Ende bis zur Dachhaut, Dach zu 1/3 (≤ 70°) aufgeschlagen. */
function waendePult(site: Site, v: Vorhaben, g: Grundriss): Wand[] {
  const o = g.proxy!;
  const fp = footprint(o);
  const ground = (p: Vec2) => (site.ground ? site.ground(p) : 0);
  const base = o.baseElevation ?? Math.max(...fp.map(ground));
  const dh = vorhabenDachHoehe(v, g);
  const zu = dh * dachAnteil4(v.neigung);
  const niedrig = g.niedrigKante ?? 0;
  // Höhe der Dachhaut an den vier Ecken (Ecken 0,1 liegen bei y = −d/2, Ecken 2,3 bei y = +d/2)
  const ecke = [0, 1, 2, 3].map((i) => {
    const vorne = i < 2;
    const hoch = niedrig === 0 ? !vorne : vorne;
    return base + o.h + (hoch ? dh : 0);
  });
  return edges(fp).map(([a, b], i) => {
    const wa = ecke[i] - ground(a);
    const wb = ecke[(i + 1) % 4] - ground(b);
    let sum = 0;
    for (let t = 0; t <= 8; t++) {
      const p: Vec2 = [a[0] + ((b[0] - a[0]) * t) / 8, a[1] + ((b[1] - a[1]) * t) / 8];
      sum += ecke[i] + ((ecke[(i + 1) % 4] - ecke[i]) * t) / 8 - ground(p);
    }
    const ha = wa + zu;
    const hb = wb + zu;
    const ta = tiefe(ha);
    const tb = tiefe(hb);
    return { a, b, typ: i % 2 === 0 ? 'traufe' : 'giebel', wa, wb, wm: sum / 9, ha, hb, ta, tb, flaeche: flaeche(a, b, ta, tb, aussenNormale(a, b, true)) } as Wand;
  });
}

/** Das aufgestockte Gebäude: gleiche Grundfläche, Trauf- und Firsthöhe um `geschosse × Geschosshöhe` höher. */
export function aufgestockt(host: Building, v: Pick<Vorhaben, 'geschosse' | 'geschosshoehe'>): Building {
  const plus = v.geschosse * v.geschosshoehe;
  return { ...host, trauf: (host.trauf ?? 0) + plus, first: (host.first ?? host.trauf ?? 0) + plus };
}

/** Abstandsflächen der Wände des Vorhabens (Anbau: ohne die angebaute Wand, die hier keine Außenwand ist). */
export function vorhabenAFWaende(site: Site, v: Vorhaben, g: Grundriss): AFWand[] {
  if (v.art === 'aufstockung') {
    return g.host && g.host.trauf != null ? gebaeudeFlaechen(aufgestockt(g.host, v)) : [];
  }
  const ws = v.dachform === 'pult' ? waendePult(site, v, g) : waende(site, g.proxy!);
  const alle = ws.map((w) => ({ a: w.a, b: w.b, flaeche: w.flaeche, h: Math.max(w.ha, w.hb) }));
  // Anbau: die angebaute Wand (Kante 0 des Grundrisses) ist keine Außenwand
  return v.art === 'anbau' ? alle.filter((_, i) => i !== 0) : alle;
}

/** Abstandsflächen der Wände des Hauses ohne den angebauten Abschnitt (Reststücke bleiben Außenwand). */
function hostOhneDock(host: Building, dock: [Vec2, Vec2]): AFWand[] {
  const out: AFWand[] = [];
  const [d0, d1] = dock;
  for (const w of gebaeudeFlaechen(host)) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const u: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
    const t = (p: Vec2) => (p[0] - w.a[0]) * u[0] + (p[1] - w.a[1]) * u[1];
    const quer = (p: Vec2) => Math.abs((p[0] - w.a[0]) * u[1] - (p[1] - w.a[1]) * u[0]);
    if (quer(d0) > 0.1 || quer(d1) > 0.1) {
      out.push({ ...w });
      continue;
    }
    const lo = Math.max(0, Math.min(t(d0), t(d1)));
    const hi = Math.min(len, Math.max(t(d0), t(d1)));
    if (hi - lo < 0.05) {
      out.push({ ...w });
      continue;
    }
    const tf = tiefe(w.h);
    // Außenrichtung wie im Original (je nach Umlaufsinn des Hauses)
    const nx = w.flaeche[3][0] - w.a[0];
    const ny = w.flaeche[3][1] - w.a[1];
    const nl = Math.hypot(nx, ny) || 1;
    const n: Vec2 = [nx / nl, ny / nl];
    const stueck = (s: number, e: number) => {
      if (e - s < 0.3) return;
      const a: Vec2 = [w.a[0] + u[0] * s, w.a[1] + u[1] * s];
      const b: Vec2 = [w.a[0] + u[0] * e, w.a[1] + u[1] * e];
      out.push({ a, b, h: w.h, flaeche: flaeche(a, b, tf, tf, n) });
    };
    stueck(0, lo);
    stueck(hi, len);
  }
  return out;
}

export interface AFErgebnis {
  waende: AFWand[];
  /** Fläche der Abstandsflächen außerhalb des Grundstücks, ohne öffentliche Verkehrsfläche (m²) */
  ausserhalbM2: number;
  /** Teil davon auf öffentlicher Verkehrsfläche (Art. 6 Abs. 2 Satz 2: nur bis zur Mitte – offen) */
  ausserhalbStrasseM2: number;
  /** Aufstockung: Fläche außerhalb schon vor der Aufstockung */
  vorherM2: number | null;
  ueberdeckung: { gebaeude: string; flaeche: number }[];
  /** Gebäude, die in der Abstandsfläche des Vorhabens stehen (außer privilegierte Kleinbauten) */
  inFlaeche: string[];
  /** Kleinbauten (Art. 6 Abs. 7), die in der Abstandsfläche des Vorhabens stehen – zulässig, wenn ohne Aufenthaltsraum */
  kleinbauten: string[];
  /** Abstandsflächen der anderen eigenen Gebäude (zur Anzeige) */
  hausFlaechen: Vec2[][];
}

export function pruefeAF(site: Site, v: Vorhaben, g: Grundriss, strassen: Vec2[][] = []): AFErgebnis {
  const ws = vorhabenAFWaende(site, v, g);
  const plot = site.plot.boundary;
  let aus = 0;
  let strasse = 0;
  for (const w of ws) {
    const gesamt = area(w.flaeche);
    const innen = clipArea(plot, w.flaeche);
    const draussen = Math.max(0, gesamt - innen);
    if (draussen < 0.05) continue;
    // Teil auf öffentlicher Verkehrsfläche (außerhalb des Grundstücks)
    let s = 0;
    for (const sp of strassen) s += clipArea(sp, w.flaeche);
    s = Math.min(draussen, Math.max(0, s));
    strasse += s;
    aus += draussen - s;
  }
  let vorher: number | null = null;
  if (v.art === 'aufstockung' && g.host) {
    vorher = 0;
    for (const w of gebaeudeFlaechen(g.host)) vorher += Math.max(0, area(w.flaeche) - clipArea(plot, w.flaeche));
  }

  const ueberdeckung: AFErgebnis['ueberdeckung'] = [];
  const inFlaeche: string[] = [];
  const kleinbauten: string[] = [];
  const hausFlaechen: Vec2[][] = [];
  const ausgenommen = v.art === 'aufstockung' ? v.zielId : undefined;
  for (const h of eigeneGebaeude(site)) {
    if (h.id === ausgenommen) continue;
    // Anbau: das Haus, an das angebaut wird, zählt ohne die angebaute Wand
    const gf: AFWand[] = v.art === 'anbau' && h.id === g.host?.id && g.dock ? hostOhneDock(h, g.dock) : gebaeudeFlaechen(h);
    gf.forEach((x) => hausFlaechen.push(x.flaeche));
    for (const w of ws) {
      for (const x of gf) {
        if (wandWinkel(w.a, w.b, x.a, x.b) > WINKEL_UEBERDECKUNG) continue;
        const f = clipArea(x.flaeche, w.flaeche);
        if (f > 0.05) ueberdeckung.push({ gebaeude: h.id, flaeche: f });
      }
    }
    // Haus steht in der Abstandsfläche des Vorhabens (Art. 6 Abs. 1 Satz 1: freizuhalten). Beim Anbau gehört das Haus dazu.
    if (!(v.art === 'anbau' && h.id === g.host?.id)) {
      if (ws.some((w) => clipArea(h.footprint, w.flaeche) > 0.05)) inFlaeche.push(h.id);
    }
  }
  // fremde Gebäude in der Abstandsfläche: nur Nachbarhäuser auf dem eigenen Grundstück gibt es nicht; Kleinbauten aus Bestand
  for (const b of site.bestand) {
    if (!geprueft(b) || !istGebaeude(b) || !pointInPolygon(centroid(b.footprint), plot)) continue;
    if (ws.some((w) => clipArea(b.footprint, w.flaeche) > 0.05)) {
      if (b.height <= KLEINBAU_HOEHE) kleinbauten.push(b.id);
      else inFlaeche.push(b.id);
    }
  }
  return { waende: ws, ausserhalbM2: aus, ausserhalbStrasseM2: strasse, vorherM2: vorher, ueberdeckung, inFlaeche, kleinbauten, hausFlaechen };
}

export interface Kollision {
  /** Überschneidung mit Gebäude (LoD2/Hausumring) oder Bestand */
  mit: { id: string; art: 'gebaeude' | 'bestand' }[];
  /** Bäume, deren Stamm im Grundriss steht */
  baeume: string[];
  /** liegt der Grundriss ganz im Grundstück? */
  imGrundstueck: boolean;
}

export function pruefeKollision(site: Site, v: Vorhaben, g: Grundriss): Kollision {
  if (v.art === 'aufstockung') return { mit: [], baeume: [], imGrundstueck: true };
  const mit: Kollision['mit'] = [];
  for (const b of site.buildings) {
    if (b.id === g.host?.id) continue;
    if (clipArea(b.footprint, g.fp) > 0.05) mit.push({ id: b.id, art: 'gebaeude' });
  }
  const baeume: string[] = [];
  for (const b of site.bestand) {
    if (!geprueft(b)) continue;
    if (b.kind === 'baum') {
      const p = b.stamm ?? centroid(b.footprint);
      if (pointInPolygon(p, g.fp)) baeume.push(b.id);
      continue;
    }
    if (b.kind === 'strauch' || b.kind === 'hecke' || !istGebaeude(b)) continue;
    if (clipArea(b.footprint, g.fp) > 0.05) mit.push({ id: b.id, art: 'bestand' });
  }
  return { mit, baeume, imGrundstueck: insidePolygon(g.fp, site.plot.boundary) };
}

export interface Kennzahlen {
  /** überbaute Grundfläche (m²); Aufstockung: unverändert */
  grundflaeche: number;
  /** Brutto-Grundfläche über alle Geschosse (m²); bei der Aufstockung nur das neue Geschoss */
  bgf: number;
  /** Wandhöhe bis Traufe über dem Fußboden (m); Aufstockung: neue Gesamt-Traufhöhe über Grund */
  wandhoehe: number;
  /** Firsthöhe (bzw. höchster Punkt) über dem Fußboden (m) */
  firsthoehe: number;
  /** Brutto-Rauminhalt des Vorhabens (m³): Anbau und Haus ganz, Aufstockung nur der zusätzliche Raum */
  rauminhalt: number;
  /** Oberkante der Brüstung des obersten zum Anleitern bestimmten Fensters (m über Gelände), Annahme */
  bruestung: number;
}

export function kennzahlen(v: Vorhaben, g: Grundriss): Kennzahlen {
  const dh = vorhabenDachHoehe(v, g);
  if (v.art === 'aufstockung') {
    const host = g.host!;
    const fl = area(host.footprint);
    const trauf = (host.trauf ?? 0) + v.geschosse * v.geschosshoehe;
    const gesamtGeschosse = Math.max(1, Math.round(trauf / v.geschosshoehe));
    return {
      grundflaeche: fl,
      bgf: fl * v.geschosse,
      wandhoehe: trauf,
      firsthoehe: (host.first ?? host.trauf ?? 0) + v.geschosse * v.geschosshoehe,
      rauminhalt: fl * v.geschosse * v.geschosshoehe,
      bruestung: (gesamtGeschosse - 1) * v.geschosshoehe + G.bruestungshoeheAnnahmeM.wert,
    };
  }
  const fl = v.w * v.d;
  const wand = v.geschosse * v.geschosshoehe;
  return {
    grundflaeche: fl,
    bgf: fl * v.geschosse,
    wandhoehe: wand,
    firsthoehe: wand + dh,
    rauminhalt: fl * wand + (v.dachform === 'flach' ? 0 : (fl * dh) / 2),
    bruestung: (v.geschosse - 1) * v.geschosshoehe + G.bruestungshoeheAnnahmeM.wert,
  };
}

/* ---------- Ergebnis ---------- */

export type PunktId = 'abstandsflaechen' | 'grenze' | 'zufahrt' | 'kollision';

export interface Pruefpunkt {
  id: PunktId;
  name: string;
  /** null = nicht prüfbar (offen) */
  status: Status | null;
  text: string;
}

export interface VorhabenErgebnis {
  /** Schlechtester Status der prüfbaren Punkte; null, wenn nichts prüfbar ist */
  status: Status | null;
  head: string;
  sub: string;
  punkte: Pruefpunkt[];
  rows: Row[];
  kennzahlen: Kennzahlen;
  grundriss: Grundriss;
  af: AFErgebnis;
  kollision: Kollision;
  /** Verfahren: immer Baugenehmigung; Bauvoranfrage (Vorbescheid) ist der empfohlene erste Schritt */
  verfahren: { art: 'baugenehmigung'; empfehlung: 'bauvoranfrage'; quelle: string };
}

const RANG: Record<Status, number> = { ok: 0, warn: 1, bad: 2 };
export const schlechter = (a: Status | null, b: Status | null): Status | null => (a == null ? b : b == null ? a : RANG[b] > RANG[a] ? b : a);

/** Punkt „Zufahrt“ kommt aus zufahrt.ts (rechnet auf einem Raster, nicht bei jedem Ziehen) und wird übergeben. */
export function bewerteVorhaben(site: Site, v: Vorhaben, zufahrt: Pruefpunkt | null, strassen: Vec2[][] = []): VorhabenErgebnis | null {
  const g = grundriss(site, v);
  if (!g) return null;
  const af = pruefeAF(site, v, g, strassen);
  const ko = pruefeKollision(site, v, g);
  const kz = kennzahlen(v, g);
  const rows: Row[] = [];
  const punkte: Pruefpunkt[] = [];
  const name = VORHABEN_NAME[v.art].name;

  // --- Grenze / Lage im Grundstück und Abstandsfläche auf dem Grundstück (Abs. 2)
  {
    let status: Status = 'ok';
    let text: string;
    if (!ko.imGrundstueck) {
      status = 'bad';
      text = `Der Grundriss steht nicht ganz auf deinem Grundstück.`;
    } else if (af.ausserhalbM2 > 0.05) {
      const neu = af.vorherM2 == null ? af.ausserhalbM2 : af.ausserhalbM2 - af.vorherM2;
      if (af.vorherM2 != null && neu <= 0.05) {
        status = 'warn';
        text = `Die Abstandsfläche reicht schon heute auf das Nachbargrundstück (${fmt(af.vorherM2, 1)} m²); die Aufstockung macht es nicht größer.`;
      } else {
        status = 'bad';
        text = `Die Abstandsfläche reicht mit ${fmt(af.ausserhalbM2, 1)} m² auf das Nachbargrundstück${af.vorherM2 != null ? ` (heute ${fmt(af.vorherM2, 1)} m²)` : ''}. Sie muss auf dem eigenen Grundstück liegen, sonst braucht es die schriftliche Zustimmung des Nachbarn oder eine Abweichung.`;
      }
    } else if (af.ausserhalbStrasseM2 > 0.05) {
      status = 'warn';
      text = `Die Abstandsfläche reicht ${fmt(af.ausserhalbStrasseM2, 1)} m² auf die öffentliche Verkehrsfläche. Das ist nur bis zu deren Mitte zulässig; wo die Mitte liegt, weiß Passt. nicht (offen).`;
    } else {
      text = 'Der Grundriss und alle Abstandsflächen liegen auf deinem Grundstück.';
    }
    punkte.push({ id: 'grenze', name: 'Grenze', status, text });
    rows.push({ text: 'Abstandsflächen auf dem eigenen Grundstück (Art. 6 Abs. 2): ' + text, tag: L.abstand.eigenesGrundstueck.quelle, kind: 'rule' });
  }

  // --- Abstandsflächen: Tiefe 0,4 H, mindestens 3 m; Überdeckung (Abs. 3) mit eigenen Gebäuden
  {
    let status: Status = 'ok';
    const teile: string[] = [];
    const hMax = Math.max(0, ...af.waende.map((w) => w.h));
    if (af.ueberdeckung.length) {
      status = 'bad';
      const sum = af.ueberdeckung.reduce((s, x) => s + x.flaeche, 0);
      teile.push(`Die Abstandsflächen überdecken sich mit denen deines Hauses (${fmt(sum, 1)} m²). Das ist nur bei Wänden über 75° zueinander erlaubt.`);
    }
    if (af.inFlaeche.length) {
      status = 'bad';
      teile.push('Ein Gebäude steht in der Abstandsfläche (oder das Vorhaben in der des Hauses). Sie muss frei bleiben.');
    }
    if (af.kleinbauten.length) {
      if (status === 'ok') status = 'warn';
      teile.push(`Ein Kleinbau (${af.kleinbauten.join(', ')}) steht in der Abstandsfläche. Das ist nach Art. 6 Abs. 7 zulässig, wenn er höchstens ${KLEINBAU_HOEHE} m mittlere Wandhöhe hat und keinen Aufenthaltsraum und keine Feuerstätte enthält.`);
    }
    const text = teile.length
      ? teile.join(' ')
      : `Tiefe der Abstandsfläche ${fmt(tiefe(hMax), 1)} m (0,4 H bei H = ${fmt(hMax, 1)} m, mindestens 3 m). Keine Überdeckung mit den Abstandsflächen deiner Gebäude.`;
    punkte.push({ id: 'abstandsflaechen', name: 'Abstandsflächen', status, text });
    rows.push({ text: `Abstandsfläche ${fmt(tiefe(hMax), 1)} m (H = ${fmt(hMax, 1)} m): ${text}`, tag: L.abstand.faktorH.quelle, kind: 'rule' });
    rows.push({ text: 'Keine Überdeckung der Abstandsflächen (Art. 6 Abs. 3); Ausnahmen bei Wänden über 75° zueinander berücksichtigt.', tag: L.abstand.ueberdeckungWinkelGrad.quelle, kind: 'rule' });
    rows.push({ text: 'Ausnahme „fremder Sicht entzogener Gartenhof“ (Abs. 3 Nr. 2) kann Passt. nicht erkennen; Gemeindesatzungen können die Abstandsflächen anders regeln.', tag: 'offen', kind: 'offen' });
    if (v.dachform === 'pult' && v.art !== 'aufstockung') {
      rows.push({ text: 'Pultdach: Passt. rechnet 1/3 der Dachhöhe an allen Wänden an, auch an der hohen Wand (sicher nach oben). Der Wortlaut regelt das nicht ausdrücklich.', tag: 'offen', kind: 'offen' });
    }
    if (v.art === 'aufstockung') {
      rows.push({ text: 'Das Dach des Hauses ist aus LoD2 nur als Trauf- und Firsthöhe bekannt; Passt. nimmt eine Neigung bis 70° an (Dach zu 1/3).', tag: 'Annahme', kind: 'Annahme' });
    }
  }

  // --- Kollisionen
  {
    let status: Status = 'ok';
    const teile: string[] = [];
    if (ko.mit.length) {
      status = 'bad';
      teile.push(`Der Grundriss überschneidet ${ko.mit.length === 1 ? 'ein Gebäude' : `${ko.mit.length} Gebäude`} (${ko.mit.map((m) => m.id).join(', ')}).`);
    }
    if (ko.baeume.length) {
      if (status === 'ok') status = 'warn';
      teile.push(`Ein Baum steht im Grundriss (${ko.baeume.join(', ')}). Er müsste weichen.`);
    }
    const text = teile.length ? teile.join(' ') : v.art === 'aufstockung' ? 'Keine neue Grundfläche, also keine Überschneidung.' : 'Nichts im Weg: kein Gebäude, kein Bestand, kein Baum im Grundriss.';
    punkte.push({ id: 'kollision', name: 'Kollisionen', status, text });
    rows.push({ text: `Kollisionen: ${text}`, tag: 'Passt.-Prüfung', kind: 'rule' });
  }

  // --- Zufahrt (aus zufahrt.ts)
  punkte.push(zufahrt ?? { id: 'zufahrt', name: 'Zufahrt für die Feuerwehr', status: null, text: 'Die Zufahrt ist noch nicht berechnet.' });

  const status = punkte.reduce<Status | null>((s, p) => schlechter(s, p.status), null);
  const lage = site.bereich.value === 'aussen';
  const bad = punkte.filter((p) => p.status === 'bad');
  const head =
    status === 'bad'
      ? `So passt ${VORHABEN_NAME[v.art].art} nicht.`
      : status === 'warn'
        ? `${name}: knapp – ein Punkt ist offen oder grenzwertig.`
        : `Geometrisch passt ${VORHABEN_NAME[v.art].art}.`;
  const sub = bad.length
    ? `${bad.map((p) => p.name).join(', ')}: siehe unten. Ob gebaut werden darf, entscheidet am Ende die Gemeinde.`
    : `${lage ? 'Im Außenbereich gelten deutlich strengere Regeln. ' : ''}Ob gebaut werden darf, entscheidet die Gemeinde – frag mit einer Bauvoranfrage nach.`;

  return {
    status,
    head,
    sub,
    punkte,
    rows,
    kennzahlen: kz,
    grundriss: g,
    af,
    kollision: ko,
    verfahren: { art: 'baugenehmigung', empfehlung: 'bauvoranfrage', quelle: G.verfahrenWohnhaus.quelle },
  };
}

/** Für „Wo darf es hin?“: schneller Test ohne Zufahrt. */
export function vorhabenPruefer(site: Site, v: Vorhaben): (center: Vec2, angle: number) => Status {
  return (center, angle) => {
    const t: Vorhaben = { ...v, center, angle };
    const g = grundriss(site, t);
    if (!g) return 'bad';
    if (!insidePolygon(g.fp, site.plot.boundary)) return 'bad';
    for (const b of site.buildings) if (clipArea(b.footprint, g.fp) > 0.05) return 'bad';
    for (const b of site.bestand) if (geprueft(b) && istGebaeude(b) && clipArea(b.footprint, g.fp) > 0.05) return 'bad';
    const af = pruefeAF(site, t, g);
    if (af.ausserhalbM2 > 0.05 || af.ueberdeckung.length || af.inFlaeche.length) return 'bad';
    return 'ok';
  };
}

/* ---------- 3D-Modell (nur zur Anzeige) ---------- */

/** Eine Fläche des Anzeigemodells: Punkte im Grundriss mit absoluten Höhen; Wände optional mit Unterkante. */
export interface Flaeche3D {
  art: 'wand' | 'dach' | 'aufsatz';
  pts: Vec2[];
  z: number[];
  /** nur Wand: Unterkante je Punkt */
  zUnten?: number[];
}

const mitte = (p: Vec2, q: Vec2): Vec2 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];

/**
 * Anzeigemodell des Vorhabens. `base` = Fußboden (Wohnhaus, Anbau) bzw. tiefster Geländepunkt am Haus (Aufstockung:
 * die Höhen aus LoD2 sind relativ zum Grund).
 */
export function vorhabenModell(v: Vorhaben, g: Grundriss, base: number): Flaeche3D[] {
  if (v.art === 'aufstockung') {
    if (!g.host || g.host.trauf == null) return [];
    const unten = base + g.host.trauf;
    const oben = unten + v.geschosse * v.geschosshoehe;
    const out: Flaeche3D[] = edges(g.fp).map(([a, b]) => ({ art: 'aufsatz' as const, pts: [a, b], z: [oben, oben], zUnten: [unten, unten] }));
    out.push({ art: 'aufsatz', pts: g.fp, z: g.fp.map(() => oben) });
    return out;
  }
  const o = g.proxy!;
  const W = base + o.h;
  const dh = vorhabenDachHoehe(v, g);
  const p = footprint(o); // Ecken des Dach-Hilfsobjekts (First entlang w)
  const out: Flaeche3D[] = [];
  if (v.dachform === 'pult') {
    const low = g.niedrigKante ?? 0;
    const zc = g.fp.map((_, i) => W + ((low === 0 ? i >= 2 : i < 2) ? dh : 0));
    edges(g.fp).forEach(([a, b], i) => out.push({ art: 'wand', pts: [a, b], z: [zc[i], zc[(i + 1) % 4]], zUnten: [base, base] }));
    out.push({ art: 'dach', pts: g.fp, z: zc });
    return out;
  }
  if (v.dachform === 'sattel' && dh > 0) {
    const r0 = mitte(p[0], p[3]);
    const r1 = mitte(p[1], p[2]);
    out.push({ art: 'wand', pts: [p[0], p[1]], z: [W, W], zUnten: [base, base] });
    out.push({ art: 'wand', pts: [p[2], p[3]], z: [W, W], zUnten: [base, base] });
    out.push({ art: 'wand', pts: [p[1], r1, p[2]], z: [W, W + dh, W], zUnten: [base, base, base] });
    out.push({ art: 'wand', pts: [p[3], r0, p[0]], z: [W, W + dh, W], zUnten: [base, base, base] });
    out.push({ art: 'dach', pts: [p[0], p[1], r1, r0], z: [W, W, W + dh, W + dh] });
    out.push({ art: 'dach', pts: [p[2], p[3], r0, r1], z: [W, W, W + dh, W + dh] });
    return out;
  }
  edges(g.fp).forEach(([a, b]) => out.push({ art: 'wand', pts: [a, b], z: [W, W], zUnten: [base, base] }));
  out.push({ art: 'dach', pts: g.fp, z: g.fp.map(() => W) });
  return out;
}
