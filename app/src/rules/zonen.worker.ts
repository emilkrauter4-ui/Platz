/// <reference lib="webworker" />
/** Web Worker für „Wo darf es hin?“: rechnet das Zonenraster abseits des UI-Threads. */
import { gelaendeAus, zonen, type GelaendeRaster, type RasterGeometrie } from './zonen';
import type { Objects } from './evaluate';
import type { Site } from './types';

export interface ZonenAnfrage {
  id: number;
  site: Omit<Site, 'ground'>;
  gelaende: GelaendeRaster;
  objs: Objects;
  k: 'gartenhaus' | 'carport';
  geo: RasterGeometrie;
}

self.onmessage = (e: MessageEvent<ZonenAnfrage>) => {
  const { id, site, gelaende, objs, k, geo } = e.data;
  const r = zonen({ ...site, ground: gelaendeAus(gelaende) } as Site, objs, k, geo);
  (self as unknown as Worker).postMessage({ id, ...r }, [r.feld.buffer, r.winkelIdx.buffer]);
};
