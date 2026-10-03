/** Externe Abfragen: Adresssuche (Nominatim) und Warnhinweise (Wasserschutzgebiete, LfU). */
import { localToLonLat, getOrigin } from '../scene/coords';
import type { Vec2 } from '../rules';

export interface Place {
  label: string;
  lon: number;
  lat: number;
}

/**
 * OSM Nominatim. Nutzungsrichtlinie: höchstens 1 Anfrage pro Sekunde, keine Autovervollständigung,
 * Quellenangabe sichtbar. Gesucht wird nur auf Absenden.
 */
let last = 0;
export async function searchAddress(q: string, bbox: [number, number, number, number]): Promise<Place[]> {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const sw = localToLonLat([bbox[0], bbox[1]]);
  const ne = localToLonLat([bbox[2], bbox[3]]);
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '5',
    countrycodes: 'de',
    viewbox: `${sw[0]},${ne[1]},${ne[0]},${sw[1]}`,
    bounded: '1',
    'accept-language': 'de',
  }).toString();
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Suche fehlgeschlagen (${r.status})`);
  const js = (await r.json()) as { display_name: string; lon: string; lat: string }[];
  return js.map((x) => ({ label: x.display_name, lon: +x.lon, lat: +x.lat }));
}

/** Liegt der Punkt in einem Trinkwasserschutzgebiet? (LfU-WMS, nur Abfrage, nichts wird gespeichert) */
export async function wasserschutz(p: Vec2): Promise<string[] | null> {
  const o = getOrigin();
  const e = p[0] + o[0];
  const n = p[1] + o[1];
  const u = new URL('https://www.lfu.bayern.de/gdi/wms/wasser/wsg');
  u.search = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo', LAYERS: 'twsg', QUERY_LAYERS: 'twsg', STYLES: '',
    CRS: 'EPSG:25832', BBOX: `${e - 10},${n - 10},${e + 10},${n + 10}`, WIDTH: '101', HEIGHT: '101', I: '50', J: '50',
    INFO_FORMAT: 'application/geojson', FEATURE_COUNT: '3',
  }).toString();
  try {
    const r = await fetch(u);
    if (!r.ok) return null;
    const js = (await r.json()) as { features: { properties: Record<string, unknown> }[] };
    return js.features.map((f) => String(f.properties.NAME ?? f.properties.name ?? f.properties.GEBIETSNAME ?? 'Trinkwasserschutzgebiet'));
  } catch {
    return null;
  }
}
