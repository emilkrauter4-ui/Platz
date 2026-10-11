/**
 * Außenkontur aus einer Fläche: Dreiecke (oder ein fertiges Bild) → Raster → schließen → Löcher füllen → Rand verfolgen → vereinfachen.
 * Reine Funktionen, werden vom IFC-Import (Wandnetze von oben) und vom Bildimport (Plan-Foto) genutzt.
 */
import type { Vec2 } from '../rules/types';
import { signedArea } from '../rules/geometry';

export interface Maske {
  nx: number;
  ny: number;
  /** Zellgröße in m */
  zelle: number;
  x0: number;
  y0: number;
  /** 1 = Fläche; Zeile 0 = südlichste Zeile (y wächst nach Norden) */
  d: Uint8Array;
}

export function neueMaske(x0: number, y0: number, x1: number, y1: number, zelle: number): Maske {
  const nx = Math.max(1, Math.ceil((x1 - x0) / zelle) + 2);
  const ny = Math.max(1, Math.ceil((y1 - y0) / zelle) + 2);
  return { nx, ny, zelle, x0: x0 - zelle, y0: y0 - zelle, d: new Uint8Array(nx * ny) };
}

/** Dreieck in die Maske füllen (Zellmitten im Dreieck). */
export function fuelleDreieck(m: Maske, a: Vec2, b: Vec2, c: Vec2) {
  const minx = Math.min(a[0], b[0], c[0]);
  const maxx = Math.max(a[0], b[0], c[0]);
  const miny = Math.min(a[1], b[1], c[1]);
  const maxy = Math.max(a[1], b[1], c[1]);
  const i0 = Math.max(0, Math.floor((minx - m.x0) / m.zelle));
  const i1 = Math.min(m.nx - 1, Math.ceil((maxx - m.x0) / m.zelle));
  const j0 = Math.max(0, Math.floor((miny - m.y0) / m.zelle));
  const j1 = Math.min(m.ny - 1, Math.ceil((maxy - m.y0) / m.zelle));
  const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(det) < 1e-12) {
    // entartet (senkrechte Wand von oben): als Linie zeichnen
    const n = Math.max(1, Math.ceil(Math.hypot(maxx - minx, maxy - miny) / (m.zelle / 2)));
    const p = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 1e-9 ? [a, b] : [b, c];
    for (let k = 0; k <= n; k++) {
      const x = p[0][0] + ((p[1][0] - p[0][0]) * k) / n;
      const y = p[0][1] + ((p[1][1] - p[0][1]) * k) / n;
      const i = Math.floor((x - m.x0) / m.zelle);
      const j = Math.floor((y - m.y0) / m.zelle);
      if (i >= 0 && j >= 0 && i < m.nx && j < m.ny) m.d[j * m.nx + i] = 1;
    }
    return;
  }
  for (let j = j0; j <= j1; j++) {
    const y = m.y0 + (j + 0.5) * m.zelle;
    for (let i = i0; i <= i1; i++) {
      const x = m.x0 + (i + 0.5) * m.zelle;
      const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / det;
      const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / det;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) m.d[j * m.nx + i] = 1;
    }
  }
}

function morph(m: Maske, r: number, src: Uint8Array, wert: 0 | 1): Uint8Array {
  // wert 1: Dilatation, wert 0: Erosion (Dilatation des Hintergrunds); quadratisches Element, getrennt in x und y
  const out = new Uint8Array(src.length);
  const tmp = new Uint8Array(src.length);
  for (let j = 0; j < m.ny; j++) for (let i = 0; i < m.nx; i++) {
    let hit: number = wert === 1 ? 0 : 1;
    for (let k = -r; k <= r; k++) {
      const ii = i + k;
      const v = ii < 0 || ii >= m.nx ? 0 : src[j * m.nx + ii];
      if (wert === 1 ? v === 1 : v === 0) { hit = wert; break; }
    }
    tmp[j * m.nx + i] = hit;
  }
  for (let j = 0; j < m.ny; j++) for (let i = 0; i < m.nx; i++) {
    let hit: number = wert === 1 ? 0 : 1;
    for (let k = -r; k <= r; k++) {
      const jj = j + k;
      const v = jj < 0 || jj >= m.ny ? 0 : tmp[jj * m.nx + i];
      if (wert === 1 ? v === 1 : v === 0) { hit = wert; break; }
    }
    out[j * m.nx + i] = hit;
  }
  return out;
}

/** Morphologisches Schließen (Dilatation, dann Erosion) mit quadratischem Element der Kantenlänge 2r+1 Zellen. */
export function schliesse(m: Maske, r: number): Maske {
  return { ...m, d: morph(m, r, morph(m, r, m.d, 1), 0) };
}

/** Morphologisches Öffnen (Erosion, dann Dilatation): entfernt Strukturen dünner als 2r+1 Zellen (Maßlinien, Schrift, Papierkörnung). */
export function oeffne(m: Maske, r: number): Maske {
  return { ...m, d: morph(m, r, morph(m, r, m.d, 0), 1) };
}

/** Löcher füllen: alles, was vom Rand aus nicht über Hintergrund erreichbar ist, wird Fläche. */
export function fuelleLoecher(m: Maske): Maske {
  const aussen = new Uint8Array(m.d.length);
  const stapel: number[] = [];
  const pruef = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= m.nx || j >= m.ny) return;
    const k = j * m.nx + i;
    if (aussen[k] || m.d[k]) return;
    aussen[k] = 1;
    stapel.push(k);
  };
  for (let i = 0; i < m.nx; i++) { pruef(i, 0); pruef(i, m.ny - 1); }
  for (let j = 0; j < m.ny; j++) { pruef(0, j); pruef(m.nx - 1, j); }
  while (stapel.length) {
    const k = stapel.pop()!;
    const i = k % m.nx;
    const j = (k - i) / m.nx;
    pruef(i + 1, j); pruef(i - 1, j); pruef(i, j + 1); pruef(i, j - 1);
  }
  const d = new Uint8Array(m.d.length);
  for (let k = 0; k < d.length; k++) d[k] = aussen[k] ? 0 : 1;
  return { ...m, d };
}

/** Größte zusammenhängende Fläche (4er-Nachbarschaft). */
export function groessteFlaeche(m: Maske): Maske {
  const marke = new Int32Array(m.d.length);
  let beste = { id: 0, n: 0 };
  let id = 0;
  for (let s = 0; s < m.d.length; s++) {
    if (!m.d[s] || marke[s]) continue;
    id++;
    let n = 0;
    const st = [s];
    marke[s] = id;
    while (st.length) {
      const k = st.pop()!;
      n++;
      const i = k % m.nx;
      const j = (k - i) / m.nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= m.nx || jj >= m.ny) continue;
        const kk = jj * m.nx + ii;
        if (m.d[kk] && !marke[kk]) { marke[kk] = id; st.push(kk); }
      }
    }
    if (n > beste.n) beste = { id, n };
  }
  const d = new Uint8Array(m.d.length);
  for (let k = 0; k < d.length; k++) d[k] = marke[k] === beste.id ? 1 : 0;
  return { ...m, d };
}

/**
 * Äußeren Rand verfolgen: Randkanten der gefüllten Zellen (gegen den Uhrzeigersinn um die Fläche), zu einem Ring verkettet.
 * Ecken liegen exakt auf den Zellgrenzen, es gibt keinen Halbzellen-Versatz. Maske ohne Löcher (siehe fuelleLoecher).
 */
export function randVerfolgen(m: Maske): Vec2[] {
  const f = (i: number, j: number) => (i < 0 || j < 0 || i >= m.nx || j >= m.ny ? 0 : m.d[j * m.nx + i]);
  const W = m.nx + 1;
  const key = (i: number, j: number) => j * W + i;
  const next = new Map<number, number>();
  let start = -1;
  for (let j = 0; j < m.ny; j++) {
    for (let i = 0; i < m.nx; i++) {
      if (!f(i, j)) continue;
      if (!f(i, j - 1)) next.set(key(i, j), key(i + 1, j));
      if (!f(i + 1, j)) next.set(key(i + 1, j), key(i + 1, j + 1));
      if (!f(i, j + 1)) next.set(key(i + 1, j + 1), key(i, j + 1));
      if (!f(i - 1, j)) next.set(key(i, j + 1), key(i, j));
      if (start < 0 && !f(i, j - 1)) start = key(i, j);
    }
  }
  if (start < 0) return [];
  const ring: Vec2[] = [];
  let k = start;
  for (let n = 0; n < next.size + 2; n++) {
    ring.push([m.x0 + (k % W) * m.zelle, m.y0 + Math.floor(k / W) * m.zelle]);
    const nk = next.get(k);
    if (nk == null) break;
    k = nk;
    if (k === start) break;
  }
  return ring;
}

/** Douglas-Peucker für einen geschlossenen Ring. */
export function vereinfache(ring: Vec2[], eps: number): Vec2[] {
  if (ring.length < 4) return ring;
  const dp = (pts: Vec2[], a: number, b: number, keep: boolean[]) => {
    let dmax = 0;
    let imax = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > dmax) { dmax = d; imax = i; }
    }
    if (dmax > eps && imax > 0) {
      keep[imax] = true;
      dp(pts, a, imax, keep);
      dp(pts, imax, b, keep);
    }
  };
  // Ring an den zwei am weitesten entfernten Punkten teilen
  let i0 = 0;
  let i1 = 0;
  let best = -1;
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > best) { best = d; i1 = i; }
  }
  const teil = (a: number, b: number) => {
    const pts = a <= b ? ring.slice(a, b + 1) : [...ring.slice(a), ...ring.slice(0, b + 1)];
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    dp(pts, 0, pts.length - 1, keep);
    return pts.filter((_, i) => keep[i]);
  };
  const h1 = teil(i0, i1);
  const h2 = teil(i1, i0);
  return [...h1.slice(0, -1), ...h2.slice(0, -1)];
}

/** Aus einer gefüllten Maske ein einfaches Polygon (gegen den Uhrzeigersinn) mit Toleranz `eps` (m). */
export function maskeZuPolygon(m: Maske, eps = 0.08, minKante = 0.35, kollTol = 0.02): Vec2[] {
  const rand = randVerfolgen(groessteFlaeche(m));
  if (rand.length < 3) return [];
  let poly = vereinfache(rand, eps);
  if (signedArea(poly) < 0) poly = [...poly].reverse();
  return entferneKollineare(entferneKurzeKanten(entferneKollineare(poly, kollTol), minKante), kollTol);
}

/**
 * Kurze Stufen (Stoßfugen an Wandecken, Pfeiler, Vorsprünge unter `minL`) zwischen zwei langen Kanten entfernen: Die Eckpunkte der Stufe
 * werden durch den Schnittpunkt der beiden langen Kanten ersetzt. So wird aus einem Wandstoß mit fehlender Ecke wieder eine saubere Ecke.
 */
export function entferneKurzeKanten(poly: Vec2[], minL: number): Vec2[] {
  let p = poly;
  for (let runde = 0; runde < 20; runde++) {
    const n = p.length;
    if (n <= 4) break;
    const kurz = p.map((a, i) => {
      const b = p[(i + 1) % n];
      return Math.hypot(b[0] - a[0], b[1] - a[1]) < minL;
    });
    // Anfang eines Laufs kurzer Kanten: Kante i kurz, Kante i−1 lang
    let start = -1;
    for (let i = 0; i < n; i++) if (kurz[i] && !kurz[(i + n - 1) % n]) { start = i; break; }
    if (start < 0) break;
    let ende = start;
    while (kurz[(ende + 1) % n] && (ende + 1) % n !== start) ende++;
    // Kanten: lang0 = (start−1 → start), kurze Kanten start..ende, lang1 = (ende+1 → ende+2)
    const a0 = p[(start + n - 1) % n];
    const a1 = p[start];
    const b0 = p[(ende + 1) % n];
    const b1 = p[(ende + 2) % n];
    const d0: Vec2 = [a1[0] - a0[0], a1[1] - a0[1]];
    const d1: Vec2 = [b1[0] - b0[0], b1[1] - b0[1]];
    const det = d0[0] * d1[1] - d0[1] * d1[0];
    if (Math.abs(det) < 1e-9) { p = p.filter((_, i) => i !== (start + 1) % n); continue; }
    const t = ((b0[0] - a1[0]) * d1[1] - (b0[1] - a1[1]) * d1[0]) / det;
    const q: Vec2 = [a1[0] + d0[0] * t, a1[1] + d0[1] * t];
    // zu ersetzende Eckpunkte: start … ende+1
    const weg = new Set<number>();
    for (let i = start; i <= ende + 1; i++) weg.add(i % n);
    const out: Vec2[] = [];
    let eingefuegt = false;
    for (let i = 0; i < n; i++) {
      if (weg.has(i)) { if (!eingefuegt) { out.push(q); eingefuegt = true; } continue; }
      out.push(p[i]);
    }
    if (out.length < 3) break;
    p = out;
  }
  return p;
}

function entferneKollineare(poly: Vec2[], tol: number): Vec2[] {
  let p = poly;
  for (let runde = 0; runde < 3; runde++) {
    const out = p.filter((v, i) => {
      const a = p[(i + p.length - 1) % p.length];
      const b = p[(i + 1) % p.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
      return Math.abs((b[0] - a[0]) * (a[1] - v[1]) - (a[0] - v[0]) * (b[1] - a[1])) / L > tol;
    });
    if (out.length === p.length || out.length < 3) break;
    p = out;
  }
  return p;
}

/** Komplette Kette für Dreiecke von oben: Maske füllen, schließen, Löcher füllen, Polygon. */
export function kontur(dreiecke: Vec2[][], zelle = 0.05, schliessenM = 0.15, eps = 0.08): Vec2[] {
  if (!dreiecke.length) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of dreiecke) for (const p of t) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  let m = neueMaske(x0 - schliessenM, y0 - schliessenM, x1 + schliessenM, y1 + schliessenM, zelle);
  for (const [a, b, c] of dreiecke) fuelleDreieck(m, a, b, c);
  m = fuelleLoecher(schliesse(m, Math.max(1, Math.round(schliessenM / zelle))));
  return maskeZuPolygon(m, eps);
}
