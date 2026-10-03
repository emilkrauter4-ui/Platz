/**
 * Vom bestätigten Grundstück zum Prüf-Kontext (reine Funktionen, mit Vitest getestet):
 * Seiten benennen, eigenes Haus finden, Nachbarfenster annehmen, Objekte frei platzieren, Einrasten.
 */
import {
  centroid,
  edges,
  footprint,
  insidePolygon,
  overlaps,
  pointInPolygon,
  pointSegment,
  signedArea,
  type Bestand,
  type Building,
  type NeighborWindow,
  type ObjectKind,
  type Placed,
  type PlotSide,
  type Vec2,
} from '../rules';
import LIM from '../rules/limits.json';

export function ccw(poly: Vec2[]): Vec2[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

const DIRS = [
  ['Norden', 'Nordgrenze'], ['Nordosten', 'Nordostgrenze'], ['Osten', 'Ostgrenze'], ['Südosten', 'Südostgrenze'],
  ['Süden', 'Südgrenze'], ['Südwesten', 'Südwestgrenze'], ['Westen', 'Westgrenze'], ['Nordwesten', 'Nordwestgrenze'],
] as const;

/**
 * Grenzseiten aus den Segmenten: benachbarte Segmente mit ähnlicher Richtung (< 25°) bilden eine Seite.
 * Benennung nach der Himmelsrichtung der Außennormalen (UTM-Gitternord, ~2° neben geographisch Nord).
 */
export function sidesFromBoundary(boundary: Vec2[]): { segmentSide: number[]; sides: PlotSide[] } {
  const b = ccw(boundary);
  const segs = edges(b);
  const ang = segs.map(([a, c]) => Math.atan2(c[1] - a[1], c[0] - a[0]));
  const similar = (i: number, j: number) => {
    let d = Math.abs(ang[i] - ang[j]) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d < (25 * Math.PI) / 180;
  };
  const segmentSide = new Array(segs.length).fill(-1);
  // Start an einem Knick, damit eine Seite nicht über den Ringanfang zerschnitten wird
  let start = 0;
  for (let i = 0; i < segs.length; i++) if (!similar(i, (i + segs.length - 1) % segs.length)) { start = i; break; }
  let side = -1;
  const groups: number[][] = [];
  for (let k = 0; k < segs.length; k++) {
    const i = (start + k) % segs.length;
    if (k === 0 || !similar(i, (i + segs.length - 1) % segs.length)) {
      side++;
      groups.push([]);
    }
    segmentSide[i] = side;
    groups[side].push(i);
  }
  const used = new Map<string, number>();
  const sides = groups.map((g) => {
    // längengewichtete Außennormale (bei CCW: (dy, −dx))
    let nx = 0;
    let ny = 0;
    for (const i of g) {
      const [a, c] = segs[i];
      nx += c[1] - a[1];
      ny += -(c[0] - a[0]);
    }
    const bearing = (Math.atan2(nx, ny) * 180) / Math.PI; // 0 = Nord, im Uhrzeigersinn
    const idx = ((Math.round(bearing / 45) % 8) + 8) % 8;
    const [dir, grenze] = DIRS[idx];
    const n = (used.get(dir) ?? 0) + 1;
    used.set(dir, n);
    const suffix = n > 1 ? ` (${n})` : '';
    return { name: `nach ${dir}${suffix}`, grenze: `an der ${grenze}${suffix}` };
  });
  return { segmentSide, sides };
}

/** Gebäude, deren Schwerpunkt im Grundstück liegt, sind das eigene Haus. */
export function classifyBuildings(boundary: Vec2[], buildings: { id: string; fp: Vec2[] }[]): Building[] {
  return buildings.map((b) => ({
    id: b.id,
    footprint: b.fp,
    provenance: 'amtlich' as const,
    own: pointInPolygon(centroid(b.fp), boundary),
  }));
}

/**
 * Ohne Eingabe: je Nachbarhaus ein Fenster in der Mitte der dem Grundstück zugewandten Fassade,
 * auf 1,6 m Höhe (Label `Annahme`). Nur Häuser bis `radius` Meter vom Grundstück.
 */
export function assumedWindows(boundary: Vec2[], buildings: Building[], radius = 35): (NeighborWindow & { buildingId: string })[] {
  const c = centroid(boundary);
  const out: (NeighborWindow & { buildingId: string })[] = [];
  for (const b of buildings) {
    if (b.own) continue;
    let best: { d: number; m: Vec2 } | null = null;
    for (const [a, e] of edges(b.footprint)) {
      if (Math.hypot(e[0] - a[0], e[1] - a[1]) < 2) continue; // kein Fenster in Mini-Kanten
      const m: Vec2 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
      const d = Math.hypot(m[0] - c[0], m[1] - c[1]);
      if (!best || d < best.d) best = { d, m };
    }
    if (!best) continue;
    const toPlot = Math.min(...edges(boundary).map(([a, e]) => pointSegment(best!.m, a, e).d));
    if (toPlot > radius) continue;
    out.push({ pos: best.m, z: LIM.waermepumpe.fensterhoeheAnnahmeM.wert, provenance: 'Annahme', buildingId: b.id });
  }
  return out;
}

const DEFAULTS: Record<ObjectKind, Omit<Placed, 'center'>> = {
  gartenhaus: { kind: 'gartenhaus', w: 3, d: 3, h: 2.5, angle: 0 },
  carport: { kind: 'carport', w: 3, d: 5.5, h: 2.5, angle: 0 },
  waermepumpe: { kind: 'waermepumpe', w: 0.45, d: 1, h: 0.9, angle: 0, lw: 58 },
};

/** Ausrichtung entlang der längsten Grenzseite, damit die Objekte parallel zur Grenze stehen. */
export function dominantAngle(boundary: Vec2[]): number {
  let best = 0;
  let bl = -1;
  for (const [a, c] of edges(boundary)) {
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (l > bl) {
      bl = l;
      best = Math.atan2(c[1] - a[1], c[0] - a[0]);
    }
  }
  // auf (−45°, 45°] normieren, Rechtecke sind 90°-symmetrisch
  let a = best % (Math.PI / 2);
  if (a > Math.PI / 4) a -= Math.PI / 2;
  if (a <= -Math.PI / 4) a += Math.PI / 2;
  return a;
}

function free(o: Placed, boundary: Vec2[], obstacles: Vec2[][]): boolean {
  const fp = footprint(o);
  return insidePolygon(fp, boundary) && !obstacles.some((x) => overlaps(fp, x, 0.001));
}

/** Startpositionen: Gartenhaus weit weg vom Haus, Carport nah an der Grenze, Wärmepumpe an der Hauswand. */
export function initialObjects(boundary: Vec2[], buildings: Building[], bestand: Bestand[]): Record<ObjectKind, Placed> {
  const b = ccw(boundary);
  const angle = dominantAngle(b);
  const own = buildings.filter((x) => x.own).map((x) => x.footprint);
  const obstacles = [...buildings.map((x) => x.footprint), ...bestand.map((x) => x.footprint)];
  const xs = b.map((p) => p[0]);
  const ys = b.map((p) => p[1]);
  const cands: Vec2[] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.5) if (pointInPolygon([x, y], b)) cands.push([x, y]);
  }
  const distOwn = (p: Vec2) => (own.length ? Math.min(...own.flatMap((f) => edges(f).map(([a, c]) => pointSegment(p, a, c).d))) : 0);
  const distBound = (p: Vec2) => Math.min(...edges(b).map(([a, c]) => pointSegment(p, a, c).d));

  const pick = (kind: ObjectKind, score: (p: Vec2) => number, extra: Vec2[][]): Placed => {
    let best: Placed | null = null;
    let bs = -Infinity;
    for (const c of cands) {
      const o = { ...DEFAULTS[kind], angle, center: c };
      if (!free(o, b, [...obstacles, ...extra])) continue;
      const s = score(c);
      if (s > bs) {
        bs = s;
        best = o;
      }
    }
    return best ?? { ...DEFAULTS[kind], angle, center: centroid(b) };
  };

  // Gartenhaus: möglichst mit vollem Abstand von 3 m zur Grenze, sonst weit weg vom Haus
  const fpDistBound = (p: Vec2, kind: ObjectKind) => {
    const fp = footprint({ ...DEFAULTS[kind], angle, center: p });
    return Math.min(...fp.map(distBound));
  };
  const gh = pick('gartenhaus', (p) => (fpDistBound(p, 'gartenhaus') >= 3.05 ? 100 : 0) + distOwn(p) - 0.3 * Math.max(0, distBound(p) - 4), []);
  const cp = pick('carport', (p) => -distBound(p) + 0.2 * Math.hypot(p[0] - gh.center[0], p[1] - gh.center[1]), [footprint(gh)]);
  const mids = own.flatMap((f) => edges(f).map(([a, c]): Vec2 => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]));
  const distMid = (p: Vec2) => (mids.length ? Math.min(...mids.map((m) => Math.hypot(m[0] - p[0], m[1] - p[1]))) : 0);
  // an der Wand, möglichst Wandmitte (nicht in der Ecke: dort Q = 8, also lauter)
  const wp = pick('waermepumpe', (p) => -Math.abs(distOwn(p) - 0.5) - 0.05 * distMid(p), [footprint(gh), footprint(cp)]);
  return { gartenhaus: gh, carport: cp, waermepumpe: wp };
}

/**
 * Einrasten beim Setzen der Grenzpunkte: zuerst auf Gebäudeecken, dann auf Gebäudekanten.
 * `tol` in Metern (die App rechnet ihn aus Bildschirmpixeln um).
 */
export function snap(p: Vec2, footprints: Vec2[][], tol: number): { p: Vec2; snapped: 'ecke' | 'kante' | null } {
  let best: Vec2 | null = null;
  let bd = tol;
  for (const f of footprints) {
    for (const v of f) {
      const d = Math.hypot(v[0] - p[0], v[1] - p[1]);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
  }
  if (best) return { p: [best[0], best[1]], snapped: 'ecke' };
  bd = tol * 0.6;
  for (const f of footprints) {
    for (const [a, c] of edges(f)) {
      const r = pointSegment(p, a, c);
      if (r.d < bd) {
        bd = r.d;
        best = r.q;
      }
    }
  }
  return best ? { p: best, snapped: 'kante' } : { p, snapped: null };
}

/** Einfaches Polygon ohne Selbstüberschneidung? */
export function isSimple(poly: Vec2[]): boolean {
  const es = edges(poly);
  const orient = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === es.length - 1)) continue;
      const [a, b] = es[i];
      const [c, d] = es[j];
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) return false;
    }
  }
  return true;
}
