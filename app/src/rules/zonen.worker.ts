/// <reference lib="webworker" />
/** Web Worker für „Wo darf es hin?“: rechnet das Zonenraster abseits des UI-Threads. */
import { gelaendeAus, zonen, zonenVorhaben, type GelaendeRaster, type RasterGeometrie } from './zonen';
import type { Objects } from './evaluate';
import type { Vorhaben } from './vorhaben';
import type { Site } from './types';

export interface ZonenAnfrage {
  id: number;
  site: Omit<Site, 'ground'>;
  gelaende: GelaendeRaster;
  objs: Objects;
  k: 'gartenhaus' | 'carport' | 'vorhaben';
  vorhaben?: Vorhaben;
  geo: RasterGeometrie;
}

self.onmessage = (e: MessageEvent<ZonenAnfrage>) => {
  const { id, site, gelaende, objs, k, geo, vorhaben } = e.data;
  const s = { ...site, ground: gelaendeAus(gelaende) } as Site;
  const r = k === 'vorhaben' && vorhaben ? zonenVorhaben(s, vorhaben, geo) : zonen(s, objs, k as 'gartenhaus' | 'carport', geo);
  (self as unknown as Worker).postMessage({ id, ...r }, [r.feld.buffer, r.winkelIdx.buffer]);
};
