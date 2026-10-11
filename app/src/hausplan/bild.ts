/**
 * Plan aus PDF oder Foto (AUFTRAG_V4 C2, Weg B): liest die AUSSENKONTUR eines Grundrisses aus einem Bild.
 *
 * Verfahren (klassische Bildverarbeitung, KEINE KI): Graustufen → Schwellwert nach Otsu (dunkle Linien/Wände) → Schließen (Lücken von Türen
 * und Fenstern, Doppellinien) → Löcher füllen → größte Fläche → Rand verfolgen → vereinfachen. Fenster, Türen und Maßketten liest Passt.
 * NICHT aus dem Bild: Der Maßstab kommt immer über eine vom Nutzer bestätigte Länge („Diese Wand ist 9,50 m lang“), Fenster setzt der Nutzer
 * per Tipp. Jede Ecke ist nachziehbar. Label `aus Plan erfasst`.
 * Datenschutz: Das Bild bleibt im Speicher der Sitzung; nichts wird hochgeladen oder gespeichert.
 */
import { fuelleLoecher, groessteFlaeche, maskeZuPolygon, oeffne, schliesse, type Maske } from './kontur';
import { signedArea } from '../rules/geometry';
import type { Vec2 } from '../rules/types';
import type { HausFenster, HausPlan } from './typen';

export interface Bild {
  width: number;
  height: number;
  /** RGBA, Zeile 0 oben (wie ImageData) */
  data: Uint8ClampedArray | Uint8Array;
}

/** Schwellwert nach Otsu über das Histogramm der Graustufen. */
export function otsu(grau: Uint8Array): number {
  const h = new Float64Array(256);
  for (const g of grau) h[g]++;
  const n = grau.length;
  let summe = 0;
  for (let i = 0; i < 256; i++) summe += i * h[i];
  let sb = 0;
  let wb = 0;
  let best = 0;
  let bestT = 128;
  for (let t = 0; t < 256; t++) {
    wb += h[t];
    if (!wb) continue;
    const wf = n - wb;
    if (!wf) break;
    sb += t * h[t];
    const mb = sb / wb;
    const mf = (summe - sb) / wf;
    const v = wb * wf * (mb - mf) ** 2;
    if (v > best) { best = v; bestT = t; }
  }
  return bestT;
}

export function grauwerte(b: Bild): Uint8Array {
  const g = new Uint8Array(b.width * b.height);
  for (let i = 0; i < g.length; i++) {
    const a = b.data[i * 4 + 3] / 255;
    // durchsichtige Pixel (PDF ohne Hintergrund) zählen als weiß
    const v = 0.299 * b.data[i * 4] + 0.587 * b.data[i * 4 + 1] + 0.114 * b.data[i * 4 + 2];
    g[i] = Math.round(v * a + 255 * (1 - a));
  }
  return g;
}

export interface BildKontur {
  /** Außenkontur in Bildpixeln (x nach rechts, y nach unten), geschlossen, ohne Wiederholung des ersten Punkts */
  px: Vec2[];
  /** verwendeter Schwellwert */
  schwelle: number;
  /** Anteil dunkler Pixel (Plausibilität) */
  dunkel: number;
}

/**
 * Außenkontur des dunklen Gebäudekörpers. `luecke`: größte zu überbrückende Lücke in Pixeln (Standard 10 % der kürzeren Bildseite: Türen und Fensteröffnungen in der Wand).
 * Gibt null zurück, wenn nichts Gebäudeähnliches gefunden wird (zu wenig dunkle Fläche, Kontur füllt das ganze Bild).
 */
export function bildKontur(b: Bild, luecke?: number): BildKontur | null {
  const grau = grauwerte(b);
  const schwelle = otsu(grau);
  const w = b.width;
  const h = b.height;
  // y nach oben legen (Maske: Zeile 0 = unten), Kontur später zurückspiegeln
  const m: Maske = { nx: w + 2, ny: h + 2, zelle: 1, x0: -1, y0: -1, d: new Uint8Array((w + 2) * (h + 2)) };
  let dunkel = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (grau[y * w + x] <= schwelle) {
      dunkel++;
      m.d[(h - 1 - y + 1) * m.nx + (x + 1)] = 1;
    }
  }
  const anteil = dunkel / (w * h);
  if (anteil < 0.002 || anteil > 0.6) return null;
  const r = Math.max(1, Math.round((luecke ?? 0.1 * Math.min(w, h)) / 2));
  const gross = Math.max(w, h);
  // Erst dünne Linien (Maßketten, Schrift, Körnung) entfernen, sonst überbrückt das Schließen den Abstand zur Wand
  const sauber = oeffne(m, Math.max(1, Math.round(0.003 * gross)));
  const zu = fuelleLoecher(schliesse(sauber, r));
  const fl = groessteFlaeche(zu);
  const poly = maskeZuPolygon(fl, Math.max(1.5, 0.004 * gross), Math.max(3, 0.012 * gross), 0.5);
  if (poly.length < 3) return null;
  // zurück in Bildkoordinaten (y nach unten)
  const px = poly.map((p): Vec2 => [p[0], h - p[1]]);
  const flaeche = Math.abs(signedArea(px));
  if (flaeche > 0.97 * w * h || flaeche < 0.01 * w * h) return null;
  return { px, schwelle, dunkel: anteil };
}

/** Meter je Pixel aus einer bestätigten Länge: Strecke a–b im Bild hat `meter` m. */
export function massstab(a: Vec2, b: Vec2, meter: number): number {
  const px = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(px > 0) || !(meter > 0)) throw new Error('Strecke und Länge müssen größer als 0 sein.');
  return meter / px;
}

/** Bildpixel → Meter (y nach oben), Ursprung in der Mitte des Umrissrechtecks, gegen den Uhrzeigersinn. */
export function pxZuMeter(px: Vec2[], mProPx: number): Vec2[] {
  const m = px.map((p): Vec2 => [p[0] * mProPx, -p[1] * mProPx]);
  const x = m.map((p) => p[0]);
  const y = m.map((p) => p[1]);
  const cx = (Math.min(...x) + Math.max(...x)) / 2;
  const cy = (Math.min(...y) + Math.max(...y)) / 2;
  let out = m.map((p): Vec2 => [Math.round((p[0] - cx) * 1000) / 1000, Math.round((p[1] - cy) * 1000) / 1000]);
  if (signedArea(out) < 0) out = out.reverse();
  return out;
}

export interface BildAngaben {
  name: string;
  /** Außenkontur in Bildpixeln (vom Nutzer nachgezogen) */
  px: Vec2[];
  /** Meter je Pixel aus der bestätigten Länge */
  mProPx: number;
  geschosse: number;
  /** Geschosshöhe Fußboden zu Fußboden (m, Annahme oder Eingabe) */
  geschosshoehe: number;
  /** Traufhöhe über Fußboden EG; fehlt: Geschosse × Geschosshöhe */
  traufe?: number;
  dach: 'flach' | 'sattel' | 'pult';
  neigung: number;
  /** vom Nutzer getippte Fenster (Bildpixel) mit Geschoss (0 = EG) */
  fenster: { px: Vec2; geschoss: number; breite?: number }[];
}

const FENSTER_BRUESTUNG = 0.9;
const FENSTER_HOEHE = 1.2;
const FENSTER_BREITE = 1.2;

/**
 * Hausplan aus den bestätigten Angaben zu einem Bildplan. Alles trägt `aus Plan erfasst`; die Höhen (Geschosshöhe, Traufe, Dach) sind
 * Eingaben des Nutzers, nicht aus dem Bild gelesen. First: Satteldach über die kürzere Seite, Pultdach über die kürzere Seite.
 */
export function planAusBild(a: BildAngaben): HausPlan {
  const fp = pxZuMeter(a.px, a.mProPx);
  const xs = fp.map((p) => p[0]);
  const ys = fp.map((p) => p[1]);
  const kurz = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const traufe = a.traufe ?? a.geschosse * a.geschosshoehe;
  const dh = a.dach === 'flach' ? 0 : a.dach === 'sattel' ? (kurz / 2) * Math.tan((a.neigung * Math.PI) / 180) : kurz * Math.tan((a.neigung * Math.PI) / 180);
  // Pixel → Plan-Meter mit demselben Ursprung wie der Umriss
  const m = a.px.map((p): Vec2 => [p[0] * a.mProPx, -p[1] * a.mProPx]);
  const mx = m.map((p) => p[0]);
  const my = m.map((p) => p[1]);
  const cx = (Math.min(...mx) + Math.max(...mx)) / 2;
  const cy = (Math.min(...my) + Math.max(...my)) / 2;
  const nachPlan = (p: Vec2): Vec2 => [p[0] * a.mProPx - cx, -p[1] * a.mProPx - cy];
  const fenster: HausFenster[] = a.fenster.map((f, i) => {
    const q = nachPlan(f.px);
    let best = { d: Infinity, pos: q, n: [0, -1] as Vec2 };
    fp.forEach((v, k) => {
      const w = fp[(k + 1) % fp.length];
      const l = Math.hypot(w[0] - v[0], w[1] - v[1]) || 1;
      const u: Vec2 = [(w[0] - v[0]) / l, (w[1] - v[1]) / l];
      const t = Math.max(0, Math.min(l, (q[0] - v[0]) * u[0] + (q[1] - v[1]) * u[1]));
      const pos: Vec2 = [v[0] + u[0] * t, v[1] + u[1] * t];
      const d = Math.hypot(q[0] - pos[0], q[1] - pos[1]);
      // CCW-Umriss: Außennormale zeigt nach rechts der Laufrichtung
      if (d < best.d) best = { d, pos, n: [u[1], -u[0]] };
    });
    const z0 = f.geschoss * a.geschosshoehe + FENSTER_BRUESTUNG;
    return { id: `F${i + 1}-G${f.geschoss}`, pos: best.pos, z0, z1: z0 + FENSTER_HOEHE, breite: f.breite ?? FENSTER_BREITE, normal: best.n, geschoss: f.geschoss };
  });
  return {
    quelle: 'Bild',
    name: a.name,
    fussabdruck: fp,
    geschosse: Array.from({ length: a.geschosse }, (_, i) => ({ name: i === 0 ? 'Erdgeschoss' : `${i}. Obergeschoss`, z0: i * a.geschosshoehe })),
    traufe,
    first: traufe + dh,
    dach: { form: a.dach, neigung: a.dach === 'flach' ? 0 : a.neigung },
    fenster,
    raeume: [],
    warnungen: [
      'Umriss aus dem Bild gelesen; Maßstab von dir bestätigt. Höhen, Dach und Fenster sind deine Angaben.',
      ...(fenster.length ? ['Fenster: Position von dir getippt, Größe 1,20 × 1,20 m und Brüstung 0,90 m angenommen.'] : []),
    ],
  };
}
