/**
 * Händler-Modus: eine ausgesuchte Vorführung für Hersteller und Händler (Gartenhäuser, Carports).
 *
 * Aktiv mit `vite build --mode haendler` (eigene Vorführ-Adresse, nur dieser Modus) oder lokal mit `?haendler`.
 * Der Modus zeigt EIN fiktives Mustergrundstück mit einem fiktiven Wohnhaus (Label `Demo`), darauf lassen sich Modelle
 * aus einer Auswahl ziehen. Alles andere (Adresssuche, Grenze setzen, Wärmepumpe, Pflanzen, Starkregen, Hausplan, …) ist
 * ausgeblendet. Die Prüflogik ist dieselbe wie in der App: dieselben Regeln, dieselben Herkunfts-Labels.
 *
 * Das Grundstück liegt auf einer Wiese; Gelände (DGM1), Luftbild (DOP20) und die Gebäude der Umgebung (LoD2) sind amtlich.
 * Grenze und Wohnhaus sind erfunden und stehen so in keinem Register.
 */
import type { DemoAdresse } from './data';
import type { ObjectKind, Placed, Vec2 } from './rules';

export const HAENDLER: boolean =
  import.meta.env.MODE === 'haendler' || new URLSearchParams(location.search).has('haendler');

/** Neutrale Beschriftung, bewusst ohne Wortmarke. Der Händler setzt hier später seinen eigenen Namen ein. */
export const HAENDLER_TEXT = {
  wort: 'Platzcheck',
  tagline: 'Passt das Modell auf mein Grundstück?',
  titel: 'Platzcheck – Passt das Modell auf mein Grundstück?',
};

export const MUSTER_HAUS_ID = 'muster-haus';

/** Erfundenes Wohnhaus auf dem Mustergrundstück: 11 × 9 m, zwei Geschosse, Satteldach 35°, First parallel zur Breite. */
export const MUSTER_HAUS = {
  fp: [[-121.5, -427.5], [-110.5, -427.5], [-110.5, -418.5], [-121.5, -418.5]] as Vec2[],
  geschosse: 2,
  geschosshoehe: 2.9,
  neigung: 35,
};
/** Traufe und First über Grund (so wie bei LoD2) */
export const MUSTER_HAUS_TRAUFE = MUSTER_HAUS.geschosse * MUSTER_HAUS.geschosshoehe;
export const MUSTER_HAUS_FIRST = MUSTER_HAUS_TRAUFE + (9 / 2) * Math.tan((MUSTER_HAUS.neigung * Math.PI) / 180);

export const MUSTER: DemoAdresse = {
  id: 'muster',
  titel: 'Mustergrundstück',
  adresse: 'Mustergrundstück (fiktives Beispiel)',
  grenze: [[-128, -450], [-100, -450], [-100, -414], [-128, -414]],
  objekt: 'gartenhaus',
  start: [-113, -441],
  winkelGrad: 0,
  blickGrad: 0,
};

export interface Produkt {
  id: string;
  kind: Extract<ObjectKind, 'gartenhaus' | 'carport'>;
  name: string;
  /** Maße laut „Datenblatt“ (Beispielwerte, keine echten Produkte) */
  w: number;
  d: number;
  h: number;
  neigung?: number;
  /** Gartenhaus mit Aufenthaltsraum und Ofen (Wohnlaube): kein Grenzprivileg nach Art. 6 Abs. 7 */
  mitOfen?: boolean;
}

/** Beispielmodelle mit erfundenen Namen. Im echten Einsatz kommen sie aus dem Sortiment des Händlers (Artikeldaten). */
export const PRODUKTE: Produkt[] = [
  { id: 'gh-m', kind: 'gartenhaus', name: 'Gartenhaus Mittel', w: 3.5, d: 2.8, h: 2.3, neigung: 20 },
  { id: 'gh-h', kind: 'gartenhaus', name: 'Gartenhaus Hoch', w: 3.5, d: 3, h: 3.2, neigung: 30 },
  { id: 'gh-o', kind: 'gartenhaus', name: 'Gartenstube mit Ofen', w: 4, d: 3, h: 2.5, neigung: 20, mitOfen: true },
  { id: 'cp-e', kind: 'carport', name: 'Carport Einzel', w: 3, d: 5, h: 2.4 },
  { id: 'cp-d', kind: 'carport', name: 'Carport Doppel', w: 5.5, d: 5.5, h: 2.4 },
];

/** Das Modell mit seinen Maßen auf ein Objekt anwenden (Lage und Drehung bleiben). */
export function mitProdukt(o: Placed, p: Produkt): Placed {
  return { ...o, kind: p.kind, w: p.w, d: p.d, h: p.h, neigung: p.neigung ?? 0 };
}

/** Passt ein Objekt noch zu einem Produkt (für die Hervorhebung)? */
export function istProdukt(o: Placed, p: Produkt): boolean {
  return o.kind === p.kind && o.w === p.w && o.d === p.d && o.h === p.h && (o.neigung ?? 0) === (p.neigung ?? 0);
}
