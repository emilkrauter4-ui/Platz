/**
 * Zufahrt (AUFTRAG_V3 B2): freier Korridor von der öffentlichen Straße bis zum Vorhaben und seine schmalste Stelle.
 *
 * Verfahren: Das Grundstück wird auf einem 10-cm-Raster abgetastet. Hindernisse sind Gebäude (LoD2/Hausumringe),
 * vom Nutzer bestätigter Bestand und Baumstämme. Die lichte Breite einer Zelle ist der doppelte Abstand zum nächsten
 * Hindernis (bzw. zur Grundstücksgrenze). Gesucht ist der Weg von der Straße zum Haus, dessen schmalste Stelle am
 * breitesten ist (Widest-Path, Dijkstra mit Maximum-Minimum). Das ist die Zahl, die ausgegeben wird.
 *
 * Geforderte Breite (limits.json → grossesVorhaben):
 *  - Brüstung des obersten Anleiterfensters über 8 m → Zu- oder Durchfahrt (BayBO Art. 5 Abs. 1 Satz 2), 3 m lichte Breite
 *    (Muster-Richtlinie über Flächen für die Feuerwehr Nr. 2; Fassung in Bayern offen)
 *  - sonst Zu- oder Durchgang, 1,25 m (Nr. 14)
 *  - Gebäude mehr als 50 m von der Straße: Zufahrt „wenn aus Gründen des Feuerwehreinsatzes erforderlich“ (Art. 5 Abs. 1 Satz 4) → offen
 *  - „angemessene Breite“ der Erschließung (Art. 4 Abs. 1 Nr. 2) nennt das Gesetz nicht → offen
 * Das Grundstück ist die vom Nutzer bestätigte Grenze; ein Weg über Nachbargrundstücke (Baulast) zählt nicht.
 */
import L from './limits.json';
import { centroid, pointInPolygon, polygonDistance } from './geometry';
import { geprueft } from './evaluate';
import type { Row, Site, Status, Vec2 } from './types';
import type { Pruefpunkt } from './vorhaben';

const G = L.grossesVorhaben;
const BRUESTUNG_GRENZE = G.feuerwehrBruestungGrenzeM.wert;
const ENTFERNUNG = G.feuerwehrEntfernungM.wert;
const ZUGANG = G.zugangBreiteM.wert;
const ZUFAHRT = G.zufahrtBreiteM.wert;
const ZUFAHRT_BEGRENZT = G.zufahrtBreiteBegrenztM.wert;
const BEGRENZT_LAENGE = G.zufahrtBegrenztLaengeM.wert;

export interface ZufahrtEingabe {
  site: Site;
  /** Grundriss, bis zu dem der Weg führen soll */
  ziel: Vec2[];
  /** Gebäude, die nicht als Hindernis zählen (das aufgestockte Haus) */
  ausgenommen?: string[];
  /** Brüstung des obersten Anleiterfensters über Gelände (Annahme) */
  bruestung: number;
  /** öffentliche Verkehrsflächen (ALKIS Tatsächliche Nutzung) */
  strassen: Vec2[][];
  /** Reichweite um das Ziel in m für den Zugang (Standard 1,5) */
  zielNaehe?: number;
}

export interface ZufahrtErgebnis {
  status: Status | null;
  /** schmalste lichte Breite entlang des besten Korridors (m) */
  schmalsteM: number | null;
  schmalsteStelle: Vec2 | null;
  /** Mittellinie des Korridors, alle ~1 m ein Punkt */
  pfad: Vec2[];
  laengeM: number | null;
  /** weitester Punkt des Zielgebäudes von der nächsten öffentlichen Verkehrsfläche (Luftlinie) */
  entfernungStrasseM: number | null;
  erforderlichM: number;
  erforderlichGrund: string;
  grund: 'ok' | 'keine_strasse' | 'kein_weg';
  text: string;
  rows: Row[];
  /** Rechenzeit in ms */
  ms: number;
}

/* ---------- Raster ---------- */

interface Raster {
  x0: number;
  y0: number;
  res: number;
  nx: number;
  ny: number;
}

function fuelle(r: Raster, poly: Vec2[], f: (i: number) => void) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  const c0 = Math.max(0, Math.floor((x0 - r.x0) / r.res));
  const c1 = Math.min(r.nx - 1, Math.ceil((x1 - r.x0) / r.res));
  const r0 = Math.max(0, Math.floor((y0 - r.y0) / r.res));
  const r1 = Math.min(r.ny - 1, Math.ceil((y1 - r.y0) / r.res));
  for (let j = r0; j <= r1; j++) {
    const y = r.y0 + (j + 0.5) * r.res;
    for (let i = c0; i <= c1; i++) {
      if (pointInPolygon([r.x0 + (i + 0.5) * r.res, y], poly)) f(j * r.nx + i);
    }
  }
}

/** Euklidischer Abstand (in Zellen) jeder Zelle zur nächsten Zelle mit mask = 1 (Felzenszwalb/Huttenlocher). */
export function abstandsfeld(mask: Uint8Array, nx: number, ny: number): Float32Array {
  const INF = 1e12;
  const f = new Float64Array(Math.max(nx, ny));
  const d = new Float64Array(Math.max(nx, ny));
  const v = new Int32Array(Math.max(nx, ny));
  const z = new Float64Array(Math.max(nx, ny) + 1);
  const g = new Float64Array(nx * ny);
  for (let i = 0; i < g.length; i++) g[i] = mask[i] ? 0 : INF;
  const eins = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s: number;
      for (;;) {
        const p = v[k];
        s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
        if (s <= z[k] && k > 0) k--;
        else break;
      }
      if (s <= z[k]) {
        // k == 0
        v[0] = q;
        z[0] = -Infinity;
        z[1] = Infinity;
        continue;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = g[j * nx + i];
    eins(ny);
    for (let j = 0; j < ny; j++) g[j * nx + i] = d[j];
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) f[i] = g[j * nx + i];
    eins(nx);
    for (let i = 0; i < nx; i++) g[j * nx + i] = d[i];
  }
  const out = new Float32Array(nx * ny);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(g[i]);
  return out;
}

/** Max-Heap für (Wert, Zelle). */
class Heap {
  private w: number[] = [];
  private c: number[] = [];
  get size() {
    return this.w.length;
  }
  push(wert: number, zelle: number) {
    let i = this.w.length;
    this.w.push(wert);
    this.c.push(zelle);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.w[p] >= this.w[i]) break;
      [this.w[p], this.w[i]] = [this.w[i], this.w[p]];
      [this.c[p], this.c[i]] = [this.c[i], this.c[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.w[0], this.c[0]];
    const lw = this.w.pop()!;
    const lc = this.c.pop()!;
    if (this.w.length) {
      this.w[0] = lw;
      this.c[0] = lc;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.w.length && this.w[l] > this.w[m]) m = l;
        if (r < this.w.length && this.w[r] > this.w[m]) m = r;
        if (m === i) break;
        [this.w[m], this.w[i]] = [this.w[i], this.w[m]];
        [this.c[m], this.c[i]] = [this.c[i], this.c[m]];
        i = m;
      }
    }
    return top;
  }
}

const NACHBARN: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

function erforderlich(e: ZufahrtEingabe, entfernung: number | null): { m: number; grund: string; fernOffen: boolean } {
  if (e.bruestung > BRUESTUNG_GRENZE) {
    return {
      m: ZUFAHRT,
      grund: `Die Brüstung des obersten Anleiterfensters liegt bei etwa ${e.bruestung.toFixed(1).replace('.', ',')} m, also über ${BRUESTUNG_GRENZE} m: statt eines Zugangs braucht es eine Zufahrt (BayBO Art. 5 Abs. 1 Satz 2), mindestens ${String(ZUFAHRT).replace('.', ',')} m lichte Breite (Richtlinie über Flächen für die Feuerwehr Nr. 2).`,
      fernOffen: false,
    };
  }
  const fern = entfernung != null && entfernung > ENTFERNUNG;
  return {
    m: ZUGANG,
    grund: `Brüstung etwa ${e.bruestung.toFixed(1).replace('.', ',')} m, also bis ${BRUESTUNG_GRENZE} m: ein geradliniger Zugang genügt, mindestens ${String(ZUGANG).replace('.', ',')} m breit (Richtlinie über Flächen für die Feuerwehr Nr. 14).`,
    fernOffen: fern,
  };
}

const fm = (v: number) => v.toFixed(2).replace('.', ',');

export function berechneZufahrt(e: ZufahrtEingabe): ZufahrtErgebnis {
  const t0 = performance.now();
  const plot = e.site.plot.boundary;
  const ziel = e.ziel;

  // Entfernung des weitesten Punktes des Ziels zur nächsten öffentlichen Verkehrsfläche (Luftlinie)
  const c = centroid(plot);
  const nahe = e.strassen.filter((s) => polygonDistance([c], s) < 250);
  const entfernung = nahe.length ? Math.max(...ziel.map((p) => Math.min(...nahe.map((s) => polygonDistance([p], s))))) : null;
  const req = erforderlich(e, entfernung);

  const leer = (grund: ZufahrtErgebnis['grund'], text: string, status: Status | null): ZufahrtErgebnis => ({
    status, schmalsteM: null, schmalsteStelle: null, pfad: [], laengeM: null, entfernungStrasseM: entfernung,
    erforderlichM: req.m, erforderlichGrund: req.grund, grund, text, rows: reihen(e, null, req, entfernung, null), ms: performance.now() - t0,
  });

  // Straße am Grundstück? (Abstand der Grenze zu einer Verkehrsfläche höchstens 3 m)
  const strassenNah = e.strassen.filter((s) => polygonDistance(plot, s) <= 3);
  if (!strassenNah.length) {
    return leer('keine_strasse', 'Eine öffentliche Straße am Grundstück ist in den amtlichen Nutzungsdaten nicht zu erkennen. Ohne sie kann Passt. die Zufahrt nicht prüfen (offen).', null);
  }

  // Raster über Grundstück + 12 m Rand
  const xs = plot.map((p) => p[0]);
  const ys = plot.map((p) => p[1]);
  const rand = 12;
  const bx0 = Math.min(...xs) - rand;
  const by0 = Math.min(...ys) - rand;
  const bw = Math.max(...xs) + rand - bx0;
  const bh = Math.max(...ys) + rand - by0;
  const res = Math.max(0.1, Math.sqrt((bw * bh) / 600000));
  const r: Raster = { x0: bx0, y0: by0, res, nx: Math.ceil(bw / res), ny: Math.ceil(bh / res) };
  const n = r.nx * r.ny;

  const imGrundstueck = new Uint8Array(n);
  fuelle(r, plot, (i) => (imGrundstueck[i] = 1));
  const strasse = new Uint8Array(n);
  for (const s of strassenNah) fuelle(r, s, (i) => (strasse[i] = 1));
  const gebaeude = new Uint8Array(n);
  const hindernis = new Uint8Array(n);
  const aus = new Set(e.ausgenommen ?? []);
  for (const b of e.site.buildings) {
    if (aus.has(b.id)) continue;
    fuelle(r, b.footprint, (i) => { gebaeude[i] = 1; hindernis[i] = 1; });
  }
  for (const b of e.site.bestand) {
    if (!geprueft(b) || !pointInPolygon(centroid(b.footprint), plot)) continue;
    if (b.kind === 'terrasse') continue;
    if (b.kind === 'baum') {
      // Stamm: Radius 0,4 m plus Spanne der Stammlage
      const p = b.stamm ?? centroid(b.footprint);
      const rad = 0.4 + (b.stammSpanne ?? 0);
      const poly: Vec2[] = Array.from({ length: 12 }, (_, k) => [p[0] + rad * Math.cos((k * Math.PI) / 6), p[1] + rad * Math.sin((k * Math.PI) / 6)]);
      fuelle(r, poly, (i) => (hindernis[i] = 1));
      continue;
    }
    fuelle(r, b.footprint, (i) => {
      hindernis[i] = 1;
      if (b.kind === undefined || ['gartenhaus', 'gewaechshaus', 'carport_garage'].includes(b.kind)) gebaeude[i] = 1;
    });
  }
  // das Ziel selbst ist kein Weg (Wohnhaus, Anbau: Grundriss wird gebaut; Aufstockung: Haus ausgenommen, bleibt Ziel)
  // Für die Breite zählt es nicht als Engstelle, dass der Weg am Ziel endet: Hindernisse ohne das Ziel merken
  const hindernisOhneZiel = Uint8Array.from(hindernis);
  const zielMaske = new Uint8Array(n);
  fuelle(r, ziel, (i) => { zielMaske[i] = 1; hindernis[i] = 1; });

  // Straßenzellen, dazu 1,5 m Spielraum für Abweichungen zwischen eigener Grenze und Straßendaten
  const abStrasse = abstandsfeld(strasse, r.nx, r.ny);
  const frei = new Uint8Array(n);
  const spiel = 1.5 / res;
  for (let i = 0; i < n; i++) frei[i] = (imGrundstueck[i] || abStrasse[i] <= spiel) && !hindernis[i] ? 1 : 0;
  const blockiert = new Uint8Array(n);
  for (let i = 0; i < n; i++) blockiert[i] = (imGrundstueck[i] || abStrasse[i] <= spiel) && !hindernisOhneZiel[i] ? 0 : 1;
  const abHindernis = abstandsfeld(blockiert, r.nx, r.ny);
  const breite = new Float64Array(n);
  for (let i = 0; i < n; i++) breite[i] = frei[i] ? Math.max(res, 2 * abHindernis[i] * res - res) : 0;
  // Breite zwischen Gebäuden allein (für die 12-m-Regel)
  const nurGeb = new Uint8Array(n);
  for (let i = 0; i < n; i++) nurGeb[i] = gebaeude[i] || !(imGrundstueck[i] || abStrasse[i] <= spiel) ? 1 : 0;
  const abGeb = abstandsfeld(nurGeb, r.nx, r.ny);

  // Ziel-Zellen: freie Zellen höchstens zielNaehe (1,5 m) vom Ziel entfernt
  const abZiel = abstandsfeld(zielMaske, r.nx, r.ny);
  const naehe = (e.zielNaehe ?? 1.5) / res;
  const start: number[] = [];
  const istZiel = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (strasse[i] && frei[i]) start.push(i);
    if (frei[i] && abZiel[i] <= naehe) istZiel[i] = 1;
  }
  if (!start.length) return leer('kein_weg', 'Zwischen Grundstück und Straße gibt es keinen freien Übergang.', 'bad');

  // Widest-Path: größte „kleinste Breite“
  const best = new Float64Array(n).fill(-1);
  const heap = new Heap();
  for (const s of start) {
    best[s] = breite[s];
    heap.push(breite[s], s);
  }
  let zielZelle = -1;
  while (heap.size) {
    const [w, ci] = heap.pop();
    if (w < best[ci]) continue;
    if (istZiel[ci]) {
      zielZelle = ci;
      break;
    }
    const cx = ci % r.nx;
    const cy = (ci - cx) / r.nx;
    for (const [dx, dy] of NACHBARN) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= r.nx || y >= r.ny) continue;
      const ni = y * r.nx + x;
      if (!frei[ni]) continue;
      const cand = Math.min(w, breite[ni]);
      if (cand > best[ni]) {
        best[ni] = cand;
        heap.push(cand, ni);
      }
    }
  }
  if (zielZelle < 0) {
    return leer('kein_weg', 'Es gibt keinen freien Weg von der Straße bis zum Haus: Gebäude, Bestand oder die Grundstücksgrenze versperren ihn.', 'bad');
  }
  const B = best[zielZelle];

  // kürzester Weg unter den Zellen mit Breite ≥ B (kleine Toleranz)
  const ok = (i: number) => frei[i] === 1 && breite[i] >= B - 1e-4;
  const dist = new Float64Array(n).fill(Infinity);
  const von = new Int32Array(n).fill(-1);
  // einfacher Dijkstra mit Min-Heap über negierten Max-Heap
  const hp = new Heap();
  for (const s of start) if (ok(s)) { dist[s] = 0; hp.push(0, s); }
  let ende = -1;
  while (hp.size) {
    const [negd, ci] = hp.pop();
    const d = -negd;
    if (d > dist[ci]) continue;
    if (istZiel[ci]) { ende = ci; break; }
    const cx = ci % r.nx;
    const cy = (ci - cx) / r.nx;
    for (const [dx, dy, kosten] of NACHBARN) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= r.nx || y >= r.ny) continue;
      const ni = y * r.nx + x;
      if (!ok(ni)) continue;
      const nd = d + kosten;
      if (nd < dist[ni]) { dist[ni] = nd; von[ni] = ci; hp.push(-nd, ni); }
    }
  }
  if (ende < 0) ende = zielZelle;
  const zellen: number[] = [];
  for (let i = ende; i >= 0; i = von[i]) zellen.push(i);
  zellen.reverse();
  const mitte = (i: number): Vec2 => [r.x0 + ((i % r.nx) + 0.5) * res, r.y0 + (Math.floor(i / r.nx) + 0.5) * res];

  // schmalste Stelle auf dem Weg (nur das Stück auf dem eigenen Grundstück zählt)
  let schmal = Infinity;
  let stelle: Vec2 | null = null;
  for (const i of zellen) {
    if (!imGrundstueck[i] && strasse[i]) continue;
    if (breite[i] < schmal) { schmal = breite[i]; stelle = mitte(i); }
  }
  if (!Number.isFinite(schmal)) { schmal = B; stelle = mitte(zellen[0]); }
  const laenge = (dist[ende] === Infinity ? zellen.length : dist[ende]) * res;

  // Strecke zwischen Gebäuden: Zellen mit Breite < 3,5 m, die von Gebäuden begrenzt sind
  let lauf = 0;
  let laengste = 0;
  for (const i of zellen) {
    const gebBreite = Math.max(res, 2 * abGeb[i] * res - res);
    if (breite[i] < ZUFAHRT_BEGRENZT && gebBreite < ZUFAHRT_BEGRENZT + 0.3) lauf += res;
    else lauf = 0;
    laengste = Math.max(laengste, lauf);
  }

  const pfad: Vec2[] = [];
  const schritt = Math.max(1, Math.round(1 / res));
  zellen.forEach((i, k) => { if (k % schritt === 0 || k === zellen.length - 1) pfad.push(mitte(i)); });

  // Status
  let status: Status = 'ok';
  const teile: string[] = [];
  if (schmal < req.m - 1e-6) {
    status = 'bad';
    teile.push(`Die schmalste Stelle des Weges ist ${fm(schmal)} m breit, gefordert sind mindestens ${fm(req.m)} m.`);
  } else {
    teile.push(`Die schmalste Stelle des Weges ist ${fm(schmal)} m breit (gefordert mindestens ${fm(req.m)} m).`);
  }
  if (status === 'ok' && req.fernOffen && schmal < ZUFAHRT) {
    status = 'warn';
    teile.push(`Das Haus liegt mehr als ${ENTFERNUNG} m von der Straße. Dann sind Zufahrten nötig, wenn die Feuerwehr es für den Einsatz verlangt (Art. 5 Abs. 1 Satz 4, offen) – bei weniger als ${fm(ZUFAHRT)} m Breite wäre das nicht erfüllt.`);
  }
  if (status === 'ok' && req.m >= ZUFAHRT && schmal < ZUFAHRT_BEGRENZT && laengste > BEGRENZT_LAENGE) {
    status = 'warn';
    teile.push(`Über ${fm(laengste)} m liegt der Weg unter ${fm(ZUFAHRT_BEGRENZT)} m Breite zwischen Gebäuden. Wird er auf mehr als ${BEGRENZT_LAENGE} m beidseitig durch Bauteile begrenzt, verlangt die Richtlinie ${fm(ZUFAHRT_BEGRENZT)} m (Nr. 2). Ob beidseitig, klärt die Feuerwehr (offen).`);
  }
  const text = teile.join(' ');
  return {
    status, schmalsteM: schmal, schmalsteStelle: stelle, pfad, laengeM: laenge, entfernungStrasseM: entfernung,
    erforderlichM: req.m, erforderlichGrund: req.grund, grund: 'ok', text,
    rows: reihen(e, schmal, req, entfernung, laengste), ms: performance.now() - t0,
  };
}

function reihen(e: ZufahrtEingabe, schmal: number | null, req: { m: number; grund: string; fernOffen: boolean }, entfernung: number | null, begrenzt: number | null): Row[] {
  const rows: Row[] = [
    { text: req.grund, tag: G.feuerwehrBruestungGrenzeM.quelle, kind: 'rule' },
    { text: `Brüstungshöhe des obersten Anleiterfensters etwa ${e.bruestung.toFixed(1).replace('.', ',')} m über Gelände: Geschosse × Geschosshöhe + ${String(G.bruestungshoeheAnnahmeM.wert).replace('.', ',')} m, Dachgeschossfenster nicht berücksichtigt.`, tag: 'Annahme', kind: 'Annahme' },
    { text: 'Welche Fassung der Richtlinie über Flächen für die Feuerwehr in Bayern gilt (Muster 02/2007 hier verwendet), ist offen.', tag: 'offen', kind: 'offen' },
    { text: 'Wie breit die Erschließung „angemessen“ sein muss (BayBO Art. 4 Abs. 1 Nr. 2), nennt das Gesetz nicht (offen). Passt. zeigt die Breite des freien Korridors auf deinem Grundstück.', tag: 'offen', kind: 'offen' },
  ];
  if (entfernung != null) rows.push({ text: `Der weiteste Punkt des Hauses ist ${entfernung.toFixed(0)} m Luftlinie von der öffentlichen Verkehrsfläche entfernt${entfernung > ENTFERNUNG ? ` (über ${ENTFERNUNG} m: Art. 5 Abs. 1 Satz 4, ob Zufahrten nötig sind, entscheidet die Feuerwehr – offen)` : ''}.`, tag: G.feuerwehrEntfernungM.quelle, kind: entfernung > ENTFERNUNG ? 'offen' : 'rule' });
  if (schmal != null) rows.push({ text: `Hindernisse: Gebäude (LoD2, Hausumringe), von dir bestätigter Bestand, Baumstämme. Gemessen auf einem 10-cm-Raster, Mittellinie des breitesten Weges.`, tag: 'berechnet', kind: 'berechnet' });
  if (begrenzt != null && begrenzt > BEGRENZT_LAENGE) rows.push({ text: `Strecke unter ${ZUFAHRT_BEGRENZT} m zwischen Gebäuden: ${begrenzt.toFixed(1)} m.`, tag: G.zufahrtBreiteBegrenztM.quelle, kind: 'rule' });
  return rows;
}

export function zufahrtPunkt(z: ZufahrtErgebnis): Pruefpunkt {
  return { id: 'zufahrt', name: 'Zufahrt', status: z.status, text: z.text };
}
