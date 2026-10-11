/**
 * Sonne in den Räumen (AUFTRAG_V4 C2): Sonnenstunden je Fenster und Raum eines Hauses aus einem Plan, an drei Stichtagen.
 *
 * Verfahren: Von der Mitte jedes Fensters (5 cm vor der Fassade) geht alle 10 Minuten ein Strahl zur Sonne (sonne.ts, ≥ 5° Höhe).
 * Er ist verdeckt, wenn er durch
 *  - den Körper des geplanten Hauses läuft (auch die eigene Wand von hinten und ein anderer Flügel eines L-Hauses),
 *  - ein Nachbargebäude (LoD2, amtlich; Prisma bis Traufe + halbe Dachhöhe) oder
 *  - ein Objekt des Oberflächenmodells (Bäume u. a., 1-m-Raster) läuft.
 * Raum = Sonne durch mindestens eins seiner Fenster. Das Ergebnis ist eine SIMULATION: Gelände eben angenommen, Fenstermitte statt Fläche,
 * Glas und Rahmen nicht gerechnet, Bäume nur so, wie Laser bzw. Bildkorrelation sie sehen (kahle Äste sind teils unsichtbar).
 * Winter (21.12., 21.3.): Laserdaten, Befliegung 08.03.2025, laubfrei. Sommer (21.6.): DOM20 minus DGM1, Bildflug 16.09.2023, belaubt.
 */
import L from './limits.json';
import { MIN_HOEHE_GRAD, koerperGebaeude, sonnenRichtung, sonnenstand, imSchatten, type Koerper } from './sonne';
import { vorhabenKoerper, type Lage } from './verschattung';
import type { Vorhaben } from './vorhaben';
import type { Site, Vec2 } from './types';

const R = L.raumsonne;
export const RAUM_STICHTAGE = R.stichtage.wert as { tag: string; name: string; saison: 'winter' | 'sommer' }[];
const RAD = Math.PI / 180;

/** Ausschnitt des Oberflächenmodells: Höhe von Bäumen u. a. über dem Gelände. Zeile 0 = Süden, (x0, y0) = Südwestecke der Zelle (0,0). */
export interface RasterAusschnitt {
  x0: number;
  y0: number;
  res: number;
  nx: number;
  ny: number;
  /** Höhenstufe in m je Wert */
  stufe: number;
  d: Uint8Array;
}

export function rasterHoehe(r: RasterAusschnitt, x: number, y: number): number {
  const i = Math.floor((x - r.x0) / r.res);
  const j = Math.floor((y - r.y0) / r.res);
  if (i < 0 || j < 0 || i >= r.nx || j >= r.ny) return 0;
  return r.d[j * r.nx + i] * r.stufe;
}

/** Fenster mit Weltkoordinaten: Mitte auf der Fassade, Außennormale, Höhe über Fußboden EG. */
export interface FensterWelt {
  id: string;
  pos: Vec2;
  normal: Vec2;
  /** Mitte des Fensters über dem Fußboden EG (m) */
  z: number;
  geschoss: number;
  raum?: string;
}

export interface RaumSonne {
  stichtage: { tag: string; name: string; saison: 'winter' | 'sommer' }[];
  /** Sonnenstunden je Stichtag */
  fenster: { id: string; geschoss: number; raum?: string; stunden: number[] }[];
  raeume: { name: string; geschoss: number; stunden: number[]; fenster: number }[];
  /** Wurde das Oberflächenmodell (Bäume) je Jahreszeit berücksichtigt? */
  mitBaeumen: { winter: boolean; sommer: boolean };
  schrittMin: number;
  ms: number;
}

/** Ist der Strahl vom Punkt zur Sonne durch ein Objekt des Oberflächenmodells verdeckt? */
function baumVerdeckt(r: RasterAusschnitt, p: Vec2, zp: number, d: Vec2, steig: number): boolean {
  const reichweite = R.reichweiteM.wert as number;
  const schritt = Math.max(0.5, r.res / 2);
  let hmax = 0;
  for (let i = 0; i < r.d.length; i += 97) hmax = Math.max(hmax, r.d[i] * r.stufe);
  hmax = Math.max(hmax, 45); // der Stichprobenwert reicht nicht für den Abbruch; höchste Objekte sind < 64 m
  const tEnde = Math.min(reichweite, (Math.min(hmax, 64) - zp) / steig);
  for (let t = schritt; t <= tEnde; t += schritt) {
    const x = p[0] + d[0] * t;
    const y = p[1] + d[1] * t;
    const h = rasterHoehe(r, x, y);
    if (h > 0 && h > zp + t * steig) return true;
  }
  return false;
}

/**
 * Sonnenstunden je Fenster und Raum. `fenster`/`raeume` in Weltkoordinaten (lokale Meter). `raeume`: Name, Geschoss und Umriss.
 * `raster`: Oberflächenmodell je Jahreszeit oder fehlend (dann ohne Bäume).
 */
export function berechneRaumsonne(
  site: Site,
  v: Vorhaben,
  fenster: FensterWelt[],
  raeume: { name: string; geschoss: number }[],
  lage: Lage,
  raster: { winter?: RasterAusschnitt; sommer?: RasterAusschnitt },
  jahr = 2026,
  schritt = R.schrittMin.wert as number,
): RaumSonne | null {
  const t0 = performance.now();
  const eigen = vorhabenKoerper(site, v);
  if (!eigen) return null;
  const mitte = eigen.fp.reduce<Vec2>((s, p) => [s[0] + p[0] / eigen.fp.length, s[1] + p[1] / eigen.fp.length], [0, 0]);
  const reichweite = R.reichweiteM.wert as number;
  const nachbarn: Koerper[] = site.buildings
    .filter((b) => b.footprint.some((p) => Math.hypot(p[0] - mitte[0], p[1] - mitte[1]) < reichweite))
    .map(koerperGebaeude)
    .filter((k): k is Koerper => !!k);
  const koerper = [...nachbarn, eigen];
  const fb = v.fbOffset ?? 0;
  const abstand = R.fensterAbstandM.wert as number;

  const ergF: RaumSonne['fenster'] = fenster.map((f) => ({ id: f.id, geschoss: f.geschoss, raum: f.raum, stunden: [] }));
  // sonnig[Fenster][Stichtag] = Bitfeld der Zeitschritte
  const sonnig: Uint8Array[][] = fenster.map(() => []);
  RAUM_STICHTAGE.forEach((st, si) => {
    const [m, d] = st.tag.split('-').map(Number);
    const start = Date.UTC(jahr, m - 1, d);
    const r = raster[st.saison];
    const n = Math.ceil(1440 / schritt);
    const stande = Array.from({ length: n }, (_, k) => sonnenstand(new Date(start + k * schritt * 60000), lage.lat, lage.lon));
    fenster.forEach((f, fi) => {
      const p: Vec2 = [f.pos[0] + f.normal[0] * abstand, f.pos[1] + f.normal[1] * abstand];
      const zp = fb + f.z;
      const bits = new Uint8Array(n);
      let stunden = 0;
      stande.forEach((s, k) => {
        if (s.hoehe < MIN_HOEHE_GRAD) return;
        const dir = sonnenRichtung(s, lage.konv);
        // Sonne hinter der Fassade: sofort verdeckt (Wand), auch wenn die Körperprüfung bei Eckfenstern knapp ist
        if (dir[0] * f.normal[0] + dir[1] * f.normal[1] <= 0) return;
        if (imSchatten(p, zp, koerper, s, lage.konv)) return;
        if (r && baumVerdeckt(r, p, zp, dir, Math.tan(s.hoehe * RAD))) return;
        bits[k] = 1;
        stunden++;
      });
      sonnig[fi][si] = bits;
      ergF[fi].stunden[si] = (stunden * schritt) / 60;
    });
  });

  const ergR: RaumSonne['raeume'] = raeume.map((r) => {
    const idx = fenster.map((f, i) => (f.raum === r.name && f.geschoss === r.geschoss ? i : -1)).filter((i) => i >= 0);
    const stunden = RAUM_STICHTAGE.map((_, si) => {
      const n = idx.length ? sonnig[idx[0]][si].length : 0;
      let z = 0;
      for (let k = 0; k < n; k++) if (idx.some((i) => sonnig[i][si][k])) z++;
      return (z * schritt) / 60;
    });
    return { name: r.name, geschoss: r.geschoss, stunden, fenster: idx.length };
  });
  return {
    stichtage: RAUM_STICHTAGE,
    fenster: ergF,
    raeume: ergR,
    mitBaeumen: { winter: !!raster.winter, sommer: !!raster.sommer },
    schrittMin: schritt,
    ms: performance.now() - t0,
  };
}
