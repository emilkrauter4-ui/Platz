/** Reine 2D-Geometrie für das Regelwerk. */
import type { Placed, Vec2 } from './types';

export const EPS = 1e-6;

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Ecken eines gedrehten Rechtecks, gegen den Uhrzeigersinn. */
export function footprint(o: Pick<Placed, 'center' | 'w' | 'd' | 'angle'>): Vec2[] {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const hw = o.w / 2;
  const hd = o.d / 2;
  return ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Vec2[]).map(([x, y]) => [
    o.center[0] + x * c - y * s,
    o.center[1] + x * s + y * c,
  ]);
}

export function edges(poly: Vec2[]): [Vec2, Vec2][] {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
}

export function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j][0] * poly[i][1]) - (poly[i][0] * poly[j][1]);
  }
  return a / 2;
}

export const area = (poly: Vec2[]) => Math.abs(signedArea(poly));

export function pointSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; q: Vec2 } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1) : 0;
  const q: Vec2 = [a[0] + t * dx, a[1] + t * dy];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q };
}

const orient = (a: Vec2, b: Vec2, c: Vec2) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function properCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
}

/** Kürzester Abstand zweier Strecken mit den beiden nächsten Punkten (p auf ab, q auf cd). */
export function segmentSegment(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { d: number; p: Vec2; q: Vec2 } {
  if (properCross(a, b, c, d)) return { d: 0, p: a, q: a };
  let best = { d: Infinity, p: a, q: c };
  const take = (p: Vec2, q: Vec2, dd: number) => {
    if (dd < best.d) best = { d: dd, p, q };
  };
  let r = pointSegment(a, c, d); take(a, r.q, r.d);
  r = pointSegment(b, c, d); take(b, r.q, r.d);
  r = pointSegment(c, a, b); take(r.q, c, r.d);
  r = pointSegment(d, a, b); take(r.q, d, r.d);
  return best;
}

/** Abstand eines Polygons zu einer Strecke. p liegt auf dem Polygon, q auf der Strecke. */
export function polygonSegment(poly: Vec2[], a: Vec2, b: Vec2) {
  let best = { d: Infinity, p: poly[0], q: a };
  for (const [e0, e1] of edges(poly)) {
    const s = segmentSegment(e0, e1, a, b);
    if (s.d < best.d) best = s;
  }
  return best;
}

/** Länge der Projektion eines Polygons auf die Richtung der Strecke ab. */
export function projectedLength(poly: Vec2[], a: Vec2, b: Vec2): number {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const L = Math.hypot(ux, uy) || 1;
  const ps = poly.map((c) => ((c[0] - a[0]) * ux + (c[1] - a[1]) * uy) / L);
  return Math.max(...ps) - Math.min(...ps);
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * Schnittfläche eines beliebigen (auch konkaven) Polygons mit einem konvexen Polygon
 * (Sutherland-Hodgman). Die Fläche ist auch bei konkavem Subjekt korrekt.
 */
export function clipArea(subject: Vec2[], convexClip: Vec2[]): number {
  let clip = convexClip;
  if (signedArea(clip) < 0) clip = [...clip].reverse();
  let out = subject;
  for (const [a, b] of edges(clip)) {
    if (!out.length) break;
    const input = out;
    out = [];
    const inside = (p: Vec2) => orient(a, b, p) >= 0;
    const inter = (p: Vec2, q: Vec2): Vec2 => {
      const d1 = orient(a, b, p);
      const d2 = orient(a, b, q);
      const t = d1 / (d1 - d2);
      return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
    };
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(inter(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(inter(prev, cur));
    }
  }
  return out.length >= 3 ? area(out) : 0;
}

/** Überlappen sich die Flächen (Berühren zählt nicht)? `convex` muss konvex sein. */
export function overlaps(convex: Vec2[], other: Vec2[], tol = 0.01): boolean {
  return clipArea(other, convex) > tol;
}

/** Liegt das konvexe Polygon vollständig im (auch konkaven) Grundstück? */
export function insidePolygon(convex: Vec2[], plot: Vec2[], tol = 0.005): boolean {
  return clipArea(plot, convex) >= area(convex) - tol;
}

/** Kürzester Abstand zweier Polygone (0, wenn sie sich schneiden oder eines im anderen liegt). */
export function polygonDistance(a: Vec2[], b: Vec2[]): number {
  if (a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a))) return 0;
  let d = Infinity;
  for (const [e0, e1] of edges(b)) d = Math.min(d, polygonSegment(a, e0, e1).d);
  return d;
}

export function centroid(poly: Vec2[]): Vec2 {
  const n = poly.length;
  return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
}

export const dist3 = (a: [number, number, number], b: [number, number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
