/**
 * Datentypen des Regelwerks. Reine Daten, keine Abhängigkeit zu Cesium oder DOM.
 *
 * Koordinaten: lokales metrisches System, x = Osten, y = Norden, in Metern
 * (UTM 32N minus Ursprung des Gebiets). Höhen in Metern; welche Höhenart
 * (Normal- oder Ellipsoidhöhe) ist egal, solange Gelände und Objekte dieselbe nutzen.
 */

export type Vec2 = [number, number];

/** Herkunft jeder Angabe. Kernfeature, siehe CLAUDE.md Grundsatz 2. */
export type Provenance =
  | 'amtlich'
  | 'berechnet'
  | 'erkannt'
  | 'nutzerbestätigt'
  | 'Annahme'
  | 'offen'
  | 'Demo';

export type Status = 'ok' | 'warn' | 'bad';

/** Eine Zeile in „So haben wir geprüft". `kind` 'rule' = Regel aus Gesetz/Norm, sonst die Herkunft. */
export interface Row {
  text: string;
  tag: string;
  kind: 'rule' | Provenance;
}

export interface WithProvenance<T> {
  value: T;
  provenance: Provenance;
}

export interface PlotSide {
  /** z. B. „zur Straße" */
  name: string;
  /** z. B. „an der Straßengrenze" */
  grenze: string;
}

export interface Plot {
  /** Grenzpunkte gegen oder im Uhrzeigersinn, nicht geschlossen. */
  boundary: Vec2[];
  /** Segment i (boundary[i] → boundary[i+1]) gehört zu Seite segmentSide[i]. Fehlt: jedes Segment eine Seite. */
  segmentSide?: number[];
  sides: PlotSide[];
  provenance: Provenance;
}

/** Hauptgebäude oder Nachbargebäude (Kollision, Wandanschluss der Wärmepumpe). */
export interface Building {
  id: string;
  footprint: Vec2[];
  provenance: Provenance;
  /** true = Gebäude auf dem eigenen Grundstück (Wohnhaus). */
  own?: boolean;
}

/** Klassen der Garten-Erkennung (pipeline/08_garten.py). */
export type GartenKlasse =
  | 'gartenhaus'
  | 'gewaechshaus'
  | 'carport_garage'
  | 'pool'
  | 'teich'
  | 'terrasse'
  | 'trampolin'
  | 'spielturm'
  | 'hecke'
  | 'baum'
  | 'strauch'
  | 'waermepumpe'
  | 'zaun_mauer';

/** Maß mit Spanne (± in Metern). */
export interface Mass {
  wert: number;
  spanne: number;
}

/** Bestehendes Objekt im Garten, erkannt oder vom Nutzer bestätigt. Gebäude zählen bei der Grenzbebauung mit. */
export interface Bestand {
  id: string;
  footprint: Vec2[];
  /** mittlere Wandhöhe über Gelände (für die Grenzbebauung) */
  height: number;
  provenance: Provenance; // 'erkannt' oder 'nutzerbestätigt'
  confidence?: number;
  /** fehlt bei Altdaten (bestand.json v1): dann Kleinbau */
  kind?: GartenKlasse;
  laenge?: Mass;
  breite?: Mass;
  hoehe?: Mass;
  /** geometrisch gemittelte Wandhöhe aus Dachebenen (Laser) */
  wand?: Mass;
  rund?: boolean;
}

export interface NeighborWindow {
  /** Lage auf der Fassade */
  pos: Vec2;
  /** Höhe über Gelände */
  z: number;
  provenance: Provenance;
}

export type ObjectKind = 'gartenhaus' | 'carport' | 'waermepumpe';

export interface Placed {
  kind: ObjectKind;
  center: Vec2;
  /** Breite entlang der lokalen x-Achse vor Drehung */
  w: number;
  /** Tiefe entlang der lokalen y-Achse vor Drehung */
  d: number;
  /** Wandhöhe über Fußboden */
  h: number;
  /** Drehung in Bogenmaß, gegen den Uhrzeigersinn */
  angle: number;
  /** nur Wärmepumpe: Schallleistungspegel nachts laut Datenblatt */
  lw?: number;
  /** Fußbodenhöhe; fehlt: höchster Geländepunkt unter dem Grundriss (Annahme). */
  baseElevation?: number;
}

export type Gebietsart = 'rein' | 'allgemein' | 'misch';

export interface BPlan {
  status: 'unbekannt' | 'keiner' | 'vorhanden';
  name?: string;
  url?: string;
  provenance: Provenance;
}

export interface Site {
  plot: Plot;
  buildings: Building[];
  bestand: Bestand[];
  windows: NeighborWindow[];
  /** Geländehöhe an einem Punkt (DGM1). Fehlt: ebenes Gelände. */
  ground?: (p: Vec2) => number;
  groundProvenance?: Provenance;
  gebiet: WithProvenance<Gebietsart>;
  bereich: WithProvenance<'innen' | 'aussen'>;
  bplan: BPlan;
  /** Gartenhaus-Annahmen */
  aufenthaltsraum: WithProvenance<boolean>;
  feuerstaette: WithProvenance<boolean>;
  /** true = erfundene Demo-Geometrie */
  demo?: boolean;
}

export interface Dimension {
  p: Vec2;
  q: Vec2;
  label: string;
}

export interface Result {
  status: Status;
  head: string;
  sub: string;
  rows: Row[];
  /** Segmentindizes der Grenze, die rot markiert werden */
  badSegments: number[];
  dim: Dimension | null;
  /** Wärmepumpe: Radius, ab dem der Richtwert eingehalten ist */
  rLimit?: number;
  /** Wärmepumpe: Pegel am maßgeblichen Fenster */
  lp?: number;
  /** Grenzbebauung: welche bestehenden Objekte mitgezählt wurden und welche nicht (mit Grund) */
  bestandGezaehlt?: { id: string; grund: string }[];
  bestandNichtGezaehlt?: { id: string; grund: string }[];
}
