/**
 * Rechenaufträge (Zufahrt, Schatten des großen Vorhabens, Hülle des Baurechts), die nicht auf dem Oberflächen-Thread laufen sollen (Zufahrt, Schatten).
 * Reine Funktion `bearbeite`; der Web Worker (rechner.worker.ts) ruft sie auf, die Tests direkt.
 * Das Gelände (`site.ground`) ist eine Funktion und nicht übertragbar; beide Rechnungen brauchen es nicht.
 */
import { berechneZufahrt, type ZufahrtEingabe, type ZufahrtErgebnis } from './zufahrt';
import { berechneVerschattung, type Lage, type SchattenErgebnis } from './verschattung';
import { huelleRaster, type HuelleModell, type HuelleRaster } from './huelle';
import type { Vorhaben } from './vorhaben';
import type { Site } from './types';

export type SiteOhneGelaende = Omit<Site, 'ground'>;

export type Anfrage =
  | { art: 'zufahrt'; id: number; e: Omit<ZufahrtEingabe, 'site'> & { site: SiteOhneGelaende } }
  | { art: 'schatten'; id: number; site: SiteOhneGelaende; v: Vorhaben; lage: Lage }
  | { art: 'huelle'; id: number; modell: HuelleModell; step?: number };

export type Antwort =
  | { art: 'zufahrt'; id: number; zufahrt: ZufahrtErgebnis; ms: number }
  | { art: 'schatten'; id: number; schatten: SchattenErgebnis | null; ms: number }
  | { art: 'huelle'; id: number; raster: HuelleRaster; ms: number };

export function bearbeite(a: Anfrage): Antwort {
  const t0 = performance.now();
  if (a.art === 'zufahrt') {
    const zufahrt = berechneZufahrt({ ...a.e, site: a.e.site as Site });
    return { art: 'zufahrt', id: a.id, zufahrt, ms: performance.now() - t0 };
  }
  if (a.art === 'huelle') {
    const raster = huelleRaster(a.modell, a.step);
    return { art: 'huelle', id: a.id, raster, ms: performance.now() - t0 };
  }
  const schatten = berechneVerschattung(a.site as Site, a.v, a.lage);
  return { art: 'schatten', id: a.id, schatten, ms: performance.now() - t0 };
}
