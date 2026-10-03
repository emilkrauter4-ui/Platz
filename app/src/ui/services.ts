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

/**
 * Liegt der Punkt in einem Trinkwasserschutzgebiet? (LfU-WMS, CC BY 4.0, nur Abfrage, nichts wird gespeichert)
 * Der Dienst sendet bei GetFeatureInfo keinen CORS-Header, deshalb läuft die Abfrage über den eigenen
 * Proxy `proxy/lfu-wsg` (scripts/serve.mjs bzw. Vite-Dev-Server), der nur genau diese Abfrage weiterreicht.
 */
export async function wasserschutz(p: Vec2): Promise<string[] | null> {
  const o = getOrigin();
  const e = p[0] + o[0];
  const n = p[1] + o[1];
  const u = new URL('proxy/lfu-wsg', location.href);
  u.search = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo', LAYERS: 'twsg', QUERY_LAYERS: 'twsg', STYLES: '',
    CRS: 'EPSG:25832', BBOX: `${e - 10},${n - 10},${e + 10},${n + 10}`, WIDTH: '101', HEIGHT: '101', I: '50', J: '50',
    INFO_FORMAT: 'application/geojson', FEATURE_COUNT: '3',
  }).toString();
  try {
    const r = await fetchRetry(u);
    if (!r.ok) return null;
    return parseWsg(await r.text());
  } catch {
    return null;
  }
}

/**
 * Antwort des LfU-Dienstes (ArcGIS) auswerten. Achtung: Der Dienst liefert ungültiges JSON mit
 * überzähligem Komma vor „}" – deshalb tolerant parsen.
 */
export function parseWsg(text: string): string[] {
  const js = JSON.parse(text.replace(/,\s*([}\]])/g, '$1')) as { features: { properties: Record<string, string> }[] };
  return js.features.map((f) => {
    const pr = f.properties;
    const name = pr.Gebietsname ?? pr.NAME ?? pr.name ?? 'Trinkwasserschutzgebiet';
    const status = pr.Status ? ` (${pr.Status}${pr.Festsetzungsdatum ? ` am ${pr.Festsetzungsdatum}` : ''})` : '';
    return `${name}${status}`;
  });
}

export interface Denkmal {
  art: string;
  bezeichnung: string;
  aktennummer: string;
}

const DENKMAL_LAYER: Record<string, string> = {
  einzeldenkmalO: 'Baudenkmal',
  bauensembleO: 'Ensemble',
  bodendenkmalO: 'Bodendenkmal',
  landschaftsdenkmalO: 'Landschaftsprägendes Denkmal',
};

/**
 * Denkmäler am Grundstück (BLfD-WMS, CC BY-ND 4.0, „© BLfD"): nur abgefragt und unverändert angezeigt.
 * Abfragepunkte: Schwerpunkt und Ecken des Grundstücks. Null, wenn der Dienst nicht erreichbar ist.
 */
export async function denkmaeler(points: Vec2[]): Promise<Denkmal[] | null> {
  const o = getOrigin();
  const layers = Object.keys(DENKMAL_LAYER).join(',');
  const found = new Map<string, Denkmal>();
  let ok = 0;
  for (const p of points) {
    try {
      const e = p[0] + o[0];
      const n = p[1] + o[1];
      const u = new URL('https://geoservices.bayern.de/od/wms/gdi/v1/denkmal');
      u.search = new URLSearchParams({
        SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo', LAYERS: layers, QUERY_LAYERS: layers, STYLES: '',
        CRS: 'EPSG:25832', BBOX: `${e - 10},${n - 10},${e + 10},${n + 10}`, WIDTH: '101', HEIGHT: '101', I: '50', J: '50',
        INFO_FORMAT: 'application/vnd.ogc.gml', FEATURE_COUNT: '10',
      }).toString();
      const r = await fetchRetry(u);
      if (!r.ok) continue;
      const doc = new DOMParser().parseFromString(await r.text(), 'application/xml');
      ok++;
      for (const [layer, art] of Object.entries(DENKMAL_LAYER)) {
        for (const f of Array.from(doc.getElementsByTagName(`${layer}_feature`))) {
          const get = (t: string) => f.getElementsByTagName(t)[0]?.textContent?.trim() ?? '';
          const akt = get('aktennummer');
          if (!akt || found.has(akt)) continue;
          // CC BY-ND: Texte nur vollständig und unverändert, deshalb keine gekürzte Beschreibung
          found.set(akt, { art, bezeichnung: get('bezeichnung') || get('kurzansprache'), aktennummer: akt });
        }
      }
    } catch {
      /* einzelner Punkt nicht abfragbar: die anderen zählen trotzdem */
    }
  }
  return ok ? [...found.values()] : null;
}

/** Eine Wiederholung bei Netzfehlern (Mobilfunk, Proxys). */
async function fetchRetry(u: URL | string, tries = 2): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      return await fetch(u);
    } catch (e) {
      if (i + 1 >= tries) throw e;
      await new Promise((r) => setTimeout(r, 600));
    }
  }
}
