/** Amtliche und erkannte Daten aus der Pipeline (app/public/data). */
import { centroid, type Vec2 } from './rules';

export interface SiteMeta {
  name: string;
  origin: Vec2;
  bbox: [number, number, number, number];
  gemeinde: { name: string; ags: string; bauleitplanung_url: string | null; quelle: string };
  /** Demo-Adressen mit vorgezeichneter Grenze (Label `Demo`) – siehe docs/demo-adressen.md */
  demos?: DemoAdresse[];
}

export interface DemoAdresse {
  id: string;
  titel: string;
  adresse: string;
  grenze: Vec2[];
  objekt: 'gartenhaus' | 'carport' | 'waermepumpe';
  /** optionale Startposition des Objekts (Mitte, lokale Meter) */
  start?: Vec2;
  winkelGrad?: number;
  /** optionale Wandhöhe des Startobjekts */
  hoehe?: number;
  /** optionale Blickrichtung der Kamera (0 = nach Norden) */
  blickGrad?: number;
}

export interface BuildingRec {
  id: string;
  fp: Vec2[];
  trauf: number | null;
  first: number | null;
  q: string;
  c: Vec2;
}

export type { BestandRec } from './site/bestand';
import type { BestandRec } from './site/bestand';

export interface Data {
  site: SiteMeta;
  buildings: BuildingRec[];
  bestand: BestandRec[];
  /** Version des Erkennungsmodells, aus dem bestand.json stammt (für die Lernschleife) */
  modell?: number | null;
}

export const DATA_URL = `${import.meta.env.BASE_URL}data`;

const json = (f: string) => fetch(`${DATA_URL}/${f}`).then((r) => {
  if (!r.ok) throw new Error(`${f} fehlt (${r.status})`);
  return r.json();
});

/** Gebietsbeschreibung (klein, für den Start nötig). */
export const loadSite = (): Promise<SiteMeta> => json('site.json');

/** Grundrisse und Bestand (≈ 300 kB komprimiert) – erst nötig, wenn ein Grundstück gewählt wird. */
export async function loadDetails(): Promise<Pick<Data, 'buildings' | 'bestand' | 'modell'>> {
  const [b, best] = await Promise.all([json('buildings.json'), json('bestand.json')]);
  return {
    buildings: (b.buildings as Omit<BuildingRec, 'c'>[]).map((x) => ({ ...x, c: centroid(x.fp) })),
    bestand: (best.bestand as (Omit<BestandRec, 'conf'> & { c: number })[]).map(({ c, ...x }) => ({ ...x, conf: c })),
    modell: typeof best.modell === 'number' ? best.modell : null,
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
