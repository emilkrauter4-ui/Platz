/** Amtliche und erkannte Daten aus der Pipeline (app/public/data). */
import { centroid, type Vec2 } from './rules';

export interface SiteMeta {
  name: string;
  origin: Vec2;
  bbox: [number, number, number, number];
  gemeinde: { name: string; ags: string; bauleitplanung_url: string | null; quelle: string };
}

export interface BuildingRec {
  id: string;
  fp: Vec2[];
  trauf: number | null;
  first: number | null;
  q: string;
  c: Vec2;
}

export interface BestandRec {
  id: string;
  fp: Vec2[];
  h: number;
  a: number;
  /** Konfidenz der Erkennung 0…1 */
  conf: number;
}

export interface Data {
  site: SiteMeta;
  buildings: BuildingRec[];
  bestand: BestandRec[];
}

export const DATA_URL = `${import.meta.env.BASE_URL}data`;

export async function loadData(): Promise<Data> {
  const [site, b, best] = await Promise.all(
    ['site.json', 'buildings.json', 'bestand.json'].map((f) => fetch(`${DATA_URL}/${f}`).then((r) => r.json())),
  );
  return {
    site,
    buildings: (b.buildings as Omit<BuildingRec, 'c'>[]).map((x) => ({ ...x, c: centroid(x.fp) })),
    bestand: (best.bestand as (Omit<BestandRec, 'conf'> & { c: number })[]).map(({ c, ...x }) => ({ ...x, conf: c })),
  };
}

export function inBbox(site: SiteMeta, p: Vec2, margin = 0): boolean {
  const [x0, y0, x1, y1] = site.bbox;
  return p[0] >= x0 + margin && p[0] <= x1 - margin && p[1] >= y0 + margin && p[1] <= y1 - margin;
}

export function near<T extends { c?: Vec2; fp: Vec2[] }>(items: T[], p: Vec2, r: number): T[] {
  return items.filter((x) => {
    const c = x.c ?? centroid(x.fp);
    return Math.hypot(c[0] - p[0], c[1] - p[1]) < r;
  });
}
