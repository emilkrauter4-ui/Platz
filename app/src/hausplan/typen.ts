/**
 * Hausplan (AUFTRAG_V4 C2): ein Haus aus einem hochgeladenen Plan, als Daten für Prüfung und Darstellung.
 * Koordinaten lokal in Metern: Ursprung = Mitte des Umrissrechtecks, x = Osten, y = Norden des PLANS (nicht der Welt; die Drehung
 * beim Platzieren legt die Ausrichtung fest). Höhen über dem Fußboden des Erdgeschosses (FFB EG).
 *
 * Label: alles, was aus einem Plan stammt, trägt `aus Plan erfasst`. Bei IFC liest Passt. ein Modell (genau, soweit es die Datei ist),
 * bei PDF/Foto liest Passt. nur die Außenkontur und der Nutzer bestätigt den Maßstab und zieht die Kanten nach.
 */
import type { Vec2 } from '../rules/types';

export interface HausFenster {
  id: string;
  /** Mitte in Plan-Koordinaten (m) */
  pos: Vec2;
  /** Unterkante / Oberkante über FFB EG (m) */
  z0: number;
  z1: number;
  breite: number;
  /** Außennormale der Fassade (Einheitsvektor, Plan-Koordinaten) */
  normal: Vec2;
  /** Raum, zu dem das Fenster gehört (falls die Datei Räume enthält) */
  raum?: string;
  /** Geschoss (0 = Erdgeschoss) */
  geschoss: number;
}

export interface HausRaum {
  name: string;
  poly: Vec2[];
  z0: number;
  z1: number;
  geschoss: number;
}

export interface HausGeschoss {
  name: string;
  /** Oberkante Fußboden über FFB EG (m) */
  z0: number;
}

export type HausDach = { form: 'flach' | 'sattel' | 'pult' | 'andere'; neigung: number };

/** Dreiecksnetz zur Darstellung (Plan-Koordinaten, x/y/z in m; Farben RGBA je Eckpunkt). */
export interface HausNetz {
  pos: Float32Array;
  idx: Uint32Array;
  farbe: Uint8Array;
}

export interface HausPlan {
  quelle: 'IFC' | 'Bild';
  /** Dateiname oder Bezeichnung */
  name: string;
  /** Außenkontur im Erdgeschoss, gegen den Uhrzeigersinn */
  fussabdruck: Vec2[];
  geschosse: HausGeschoss[];
  /** Traufhöhe (Oberkante der Wand / Schnittpunkt Wand–Dachhaut) und höchster Punkt über FFB EG */
  traufe: number;
  first: number;
  dach: HausDach;
  fenster: HausFenster[];
  raeume: HausRaum[];
  netz?: HausNetz;
  /** Hinweise beim Lesen (z. B. Einheit angenommen, kein Dach gefunden) */
  warnungen: string[];
}

export const geschossHoehe = (p: HausPlan): number => {
  const z = p.geschosse.map((g) => g.z0).sort((a, b) => a - b);
  if (z.length >= 2) return (z[z.length - 1] - z[0]) / (z.length - 1);
  return z.length ? p.traufe / z.length : p.traufe;
};
