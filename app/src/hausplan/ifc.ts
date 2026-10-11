/**
 * IFC-Import (AUFTRAG_V4 C2, Weg A): liest Außenwände, Geschosse, Höhen, Dach und Fenster (Position, Größe) und Räume aus einer IFC-Datei.
 * Bibliothek: web-ifc (That Open Company, MPL-2.0, läuft als WebAssembly im Browser – die Datei verlässt das Gerät nicht).
 *
 * Die Schnittstelle `IfcApi` ist schmal gehalten, damit dieselbe Funktion im Browser (web-ifc-api.js) und in Node (Tests) läuft.
 * web-ifc liefert Netze in Y-oben (IFC-Z wird zu Y, IFC-Y zu −Z); hier wird zurückgerechnet.
 *
 * Annahmen (im Ergebnis als Warnung): Einheit Meter (bei Millimetern: Netz größer als 60 m → Faktor 0,001); +Y des Plans ist „Norden des
 * Plans“, die Himmelsrichtung legt der Nutzer beim Platzieren fest; EG = unterstes Geschoss in der Datei.
 */
import { kontur } from './kontur';
import { signedArea } from '../rules/geometry';
import type { HausDach, HausFenster, HausGeschoss, HausNetz, HausPlan, HausRaum } from './typen';
import type { Vec2 } from '../rules/types';

/** Der Teil von web-ifc, den der Import braucht. */
export interface IfcApi {
  OpenModel(daten: Uint8Array): number;
  CloseModel(id: number): void;
  StreamAllMeshes(id: number, cb: (mesh: { expressID: number; geometries: { size(): number; get(i: number): PlatzierteGeometrie } }) => void): void;
  GetGeometry(id: number, geometryExpressID: number): { GetVertexData(): number; GetVertexDataSize(): number; GetIndexData(): number; GetIndexDataSize(): number; delete(): void };
  GetVertexArray(ptr: number, size: number): Float32Array;
  GetIndexArray(ptr: number, size: number): Uint32Array;
  GetFlatMesh(id: number, expressID: number): { expressID: number; geometries: { size(): number; get(i: number): PlatzierteGeometrie } };
  GetLineType(id: number, expressID: number): number;
  GetLine(id: number, expressID: number): Record<string, { value?: unknown } | undefined>;
  GetLineIDsWithType(id: number, typ: number): { size(): number; get(i: number): number };
}
export interface PlatzierteGeometrie {
  geometryExpressID: number;
  flatTransformation: number[];
  color: { x: number; y: number; z: number; w: number };
}
/** IFC-Typkonstanten (aus web-ifc: WebIFC.IFCWALL usw.) */
export interface IfcTypen {
  IFCWALL: number; IFCWALLSTANDARDCASE: number; IFCSLAB: number; IFCROOF: number; IFCWINDOW: number; IFCDOOR: number; IFCSPACE: number;
  IFCBUILDINGSTOREY: number; IFCCOLUMN: number; IFCSTAIR: number; IFCBEAM: number; IFCCURTAINWALL: number;
}

interface Teil {
  typ: 'wand' | 'platte' | 'dach' | 'fenster' | 'tuer' | 'raum' | 'sonst';
  id: number;
  /** Eckpunkte (IFC-Koordinaten, m), je 3 Zahlen */
  pos: number[];
  idx: number[];
  farbe: [number, number, number, number];
}

const zuIfc = (m: number[], x: number, y: number, z: number): [number, number, number] => {
  // flatTransformation (Spaltenreihenfolge) in web-ifc-Koordinaten (Y oben), dann zurück: IFC = (x, −z, y)
  const X = m[0] * x + m[4] * y + m[8] * z + m[12];
  const Y = m[1] * x + m[5] * y + m[9] * z + m[13];
  const Z = m[2] * x + m[6] * y + m[10] * z + m[14];
  return [X, -Z, Y];
};

function bbox(pos: number[]) {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (let k = 0; k < pos.length; k += 3) {
    b.x0 = Math.min(b.x0, pos[k]); b.x1 = Math.max(b.x1, pos[k]);
    b.y0 = Math.min(b.y0, pos[k + 1]); b.y1 = Math.max(b.y1, pos[k + 1]);
    b.z0 = Math.min(b.z0, pos[k + 2]); b.z1 = Math.max(b.z1, pos[k + 2]);
  }
  return b;
}

const text = (l: Record<string, { value?: unknown } | undefined>, k: string): string => {
  const v = l[k]?.value;
  return typeof v === 'string' ? v : '';
};

/** Dach aus den Dreiecken des Dachelements: Form, Neigung (Median, flächengewichtet), Traufe (tiefster Punkt der geneigten Flächen). */
export function dachAus(t: Teil[]): { dach: HausDach; traufe: number | null; first: number | null } {
  let zmax = -Infinity;
  const flaechen: { a: number; neig: number; az: number; zmin: number }[] = [];
  for (const d of t) {
    for (let k = 0; k < d.idx.length; k += 3) {
      const P = [0, 1, 2].map((i) => [d.pos[d.idx[k + i] * 3], d.pos[d.idx[k + i] * 3 + 1], d.pos[d.idx[k + i] * 3 + 2]]);
      for (const p of P) zmax = Math.max(zmax, p[2]);
      const u = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]];
      const v = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const L = Math.hypot(n[0], n[1], n[2]);
      if (L < 1e-9) continue;
      const nz = n[2] / L;
      if (nz < 0.05) continue; // Unterseite und senkrechte Flächen
      flaechen.push({ a: L / 2, neig: (Math.acos(Math.min(1, nz)) * 180) / Math.PI, az: Math.atan2(n[1], n[0]), zmin: Math.min(P[0][2], P[1][2], P[2][2]) });
    }
  }
  if (!flaechen.length) return { dach: { form: 'flach', neigung: 0 }, traufe: null, first: Number.isFinite(zmax) ? zmax : null };
  const gesamt = flaechen.reduce((s, f) => s + f.a, 0);
  const geneigt = flaechen.filter((f) => f.neig > 5);
  const geneigtA = geneigt.reduce((s, f) => s + f.a, 0);
  if (geneigtA < 0.15 * gesamt) return { dach: { form: 'flach', neigung: 0 }, traufe: zmax, first: zmax };
  // Median der Neigung, flächengewichtet
  const sort = [...geneigt].sort((a, b) => a.neig - b.neig);
  let acc = 0;
  let med = sort[0].neig;
  for (const f of sort) { acc += f.a; if (acc >= geneigtA / 2) { med = f.neig; break; } }
  // Himmelsrichtungen der geneigten Flächen: zwei gegenüberliegende Gruppen → Sattel, eine → Pult
  const gruppen: { az: number; a: number }[] = [];
  for (const f of geneigt) {
    const g = gruppen.find((x) => Math.abs(Math.atan2(Math.sin(x.az - f.az), Math.cos(x.az - f.az))) < 0.35);
    if (g) g.a += f.a; else gruppen.push({ az: f.az, a: f.a });
  }
  gruppen.sort((a, b) => b.a - a.a);
  const gegen = gruppen.length >= 2 && gruppen[1].a >= 0.25 * geneigtA && Math.abs(Math.atan2(Math.sin(gruppen[0].az - gruppen[1].az), Math.cos(gruppen[0].az - gruppen[1].az))) > 2.6;
  const form: HausDach['form'] = gegen ? 'sattel' : gruppen[0].a >= 0.8 * geneigtA ? 'pult' : 'andere';
  return { dach: { form, neigung: Math.round(med * 10) / 10 }, traufe: Math.min(...geneigt.map((f) => f.zmin)), first: zmax };
}

export async function leseIfc(api: IfcApi, T: IfcTypen, daten: Uint8Array, name: string): Promise<HausPlan> {
  const id = api.OpenModel(daten);
  const warnungen: string[] = [];
  try {
    const typEnum = (t: number): Teil['typ'] =>
      t === T.IFCWALL || t === T.IFCWALLSTANDARDCASE || t === T.IFCCURTAINWALL ? 'wand'
        : t === T.IFCSLAB ? 'platte' : t === T.IFCROOF ? 'dach' : t === T.IFCWINDOW ? 'fenster' : t === T.IFCDOOR ? 'tuer' : t === T.IFCSPACE ? 'raum' : 'sonst';
    const teile: Teil[] = [];
    const sammle = (mesh: { expressID: number; geometries: { size(): number; get(i: number): PlatzierteGeometrie } }) => {
      const typ = typEnum(api.GetLineType(id, mesh.expressID));
      for (let i = 0; i < mesh.geometries.size(); i++) {
        const g = mesh.geometries.get(i);
        const geom = api.GetGeometry(id, g.geometryExpressID);
        const v = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const ix = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
        const pos: number[] = [];
        for (let k = 0; k < v.length; k += 6) pos.push(...zuIfc(g.flatTransformation, v[k], v[k + 1], v[k + 2]));
        teile.push({ typ, id: mesh.expressID, pos, idx: Array.from(ix), farbe: [g.color.x, g.color.y, g.color.z, g.color.w] });
        geom.delete();
      }
    };
    api.StreamAllMeshes(id, sammle);
    // Räume (IfcSpace) streamt web-ifc nicht mit: einzeln holen
    if (!teile.some((t) => t.typ === 'raum')) {
      const sp = api.GetLineIDsWithType(id, T.IFCSPACE);
      for (let i = 0; i < sp.size(); i++) {
        try { sammle(api.GetFlatMesh(id, sp.get(i))); } catch { /* Raum ohne Geometrie */ }
      }
    }
    const bau = teile.filter((t) => t.typ !== 'raum' && t.typ !== 'sonst');
    const wand = teile.filter((t) => t.typ === 'wand');
    if (!wand.length) throw new Error('Die Datei enthält keine Wände (IfcWall).');
    // Einheit: Millimeter-Modelle sind hunderte Meter groß
    const all = bbox(bau.flatMap((t) => t.pos));
    const ausdehnung = Math.max(all.x1 - all.x0, all.y1 - all.y0, all.z1 - all.z0);
    let faktor = 1;
    if (ausdehnung > 60) {
      faktor = 0.001;
      warnungen.push(`Das Modell ist ${ausdehnung.toFixed(0)} Einheiten groß: Passt. nimmt Millimeter an und rechnet mit Faktor 0,001. Bitte Maße prüfen.`);
    }
    if (faktor !== 1) for (const t of teile) t.pos = t.pos.map((x) => x * faktor);

    // Geschosse
    const storeys: { name: string; elev: number }[] = [];
    const ids = api.GetLineIDsWithType(id, T.IFCBUILDINGSTOREY);
    for (let i = 0; i < ids.size(); i++) {
      const l = api.GetLine(id, ids.get(i));
      const e = Number(l.Elevation?.value ?? 0) * (faktor === 1 ? 1 : faktor);
      storeys.push({ name: text(l, 'LongName') || text(l, 'Name') || `Geschoss ${i + 1}`, elev: e });
    }
    storeys.sort((a, b) => a.elev - b.elev);
    const ffb = storeys.length ? storeys[0].elev : Math.min(...wand.flatMap((w) => [bbox(w.pos).z0]));
    if (!storeys.length) warnungen.push('Die Datei nennt keine Geschosse; Passt. nimmt ein Geschoss an.');
    const geschosse: HausGeschoss[] = (storeys.length ? storeys : [{ name: 'Erdgeschoss', elev: ffb }]).map((s) => ({ name: s.name, z0: Math.round((s.elev - ffb) * 1000) / 1000 }));

    // Umrisse und Ursprung: Außenkontur aus den Wänden des Erdgeschosses (alle Wände, die ab dem Fußboden stehen)
    const eg = wand.filter((w) => bbox(w.pos).z0 < ffb + 0.5);
    const dreiecke: Vec2[][] = [];
    for (const w of eg.length ? eg : wand) {
      for (let k = 0; k < w.idx.length; k += 3) {
        dreiecke.push([0, 1, 2].map((i) => [w.pos[w.idx[k + i] * 3], w.pos[w.idx[k + i] * 3 + 1]] as Vec2));
      }
    }
    let fuss = kontur(dreiecke, 0.05, 0.3, 0.1);
    if (fuss.length < 3) throw new Error('Aus den Wänden ließ sich keine Außenkontur bilden.');
    if (signedArea(fuss) < 0) fuss = [...fuss].reverse();
    const fb = { x0: Math.min(...fuss.map((p) => p[0])), x1: Math.max(...fuss.map((p) => p[0])), y0: Math.min(...fuss.map((p) => p[1])), y1: Math.max(...fuss.map((p) => p[1])) };
    const ox = (fb.x0 + fb.x1) / 2;
    const oy = (fb.y0 + fb.y1) / 2;
    const lokal = (p: Vec2): Vec2 => [Math.round((p[0] - ox) * 1000) / 1000, Math.round((p[1] - oy) * 1000) / 1000];
    const fussabdruck = fuss.map(lokal);

    // Dach und Höhen
    const dachTeile = teile.filter((t) => t.typ === 'dach');
    const wandOben = Math.max(...wand.map((w) => bbox(w.pos).z1));
    let dach: HausDach = { form: 'flach', neigung: 0 };
    let traufe = wandOben - ffb;
    let first = wandOben - ffb;
    if (dachTeile.length) {
      const d = dachAus(dachTeile);
      dach = d.dach;
      first = (d.first ?? wandOben) - ffb;
      traufe = (d.traufe ?? d.first ?? wandOben) - ffb;
    } else warnungen.push('Die Datei enthält kein Dach (IfcRoof): Passt. rechnet mit einem Flachdach auf der Oberkante der Wände.');

    // Fenster
    const kanten = fussabdruck.map((a, i) => [a, fussabdruck[(i + 1) % fussabdruck.length]] as [Vec2, Vec2]);
    const fenster: HausFenster[] = [];
    teile.filter((t) => t.typ === 'fenster').forEach((t, n) => {
      const b = bbox(t.pos);
      const c: Vec2 = lokal([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]);
      // nächste Außenkante → Außennormale; die Position wird auf die Fassade gelegt (Außenfläche der Wand), dort beginnt der Sonnenstrahl
      let best = { d: Infinity, normal: [0, -1] as Vec2, q: c };
      for (const [a, e] of kanten) {
        const dx = e[0] - a[0];
        const dy = e[1] - a[1];
        const L2 = dx * dx + dy * dy || 1e-9;
        const tt = Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / L2));
        const d = Math.hypot(c[0] - (a[0] + tt * dx), c[1] - (a[1] + tt * dy));
        if (d < best.d) { const L = Math.sqrt(L2); best = { d, normal: [dy / L, -dx / L], q: [a[0] + tt * dx, a[1] + tt * dy] }; }
      }
      const w = Math.max(b.x1 - b.x0, b.y1 - b.y0);
      const z0 = b.z0 - ffb;
      const gi = geschosse.reduce((g, s, i) => (z0 >= s.z0 - 0.2 ? i : g), 0);
      fenster.push({ id: text(api.GetLine(id, t.id), 'Name') || `Fenster ${n + 1}`, pos: [Math.round(best.q[0] * 1000) / 1000, Math.round(best.q[1] * 1000) / 1000], z0: Math.round(z0 * 1000) / 1000, z1: Math.round((b.z1 - ffb) * 1000) / 1000, breite: Math.round(w * 1000) / 1000, normal: best.normal, geschoss: gi });
    });
    if (!fenster.length) warnungen.push('Die Datei enthält keine Fenster (IfcWindow): Die Sonne in den Räumen lässt sich nicht berechnen.');

    // Räume
    const raeume: HausRaum[] = [];
    for (const t of teile.filter((x) => x.typ === 'raum')) {
      const b = bbox(t.pos);
      const tri: Vec2[][] = [];
      for (let k = 0; k < t.idx.length; k += 3) tri.push([0, 1, 2].map((i) => [t.pos[t.idx[k + i] * 3], t.pos[t.idx[k + i] * 3 + 1]] as Vec2));
      let poly = kontur(tri, 0.05, 0.05, 0.05);
      if (poly.length < 3) continue;
      if (signedArea(poly) < 0) poly = [...poly].reverse();
      const l = api.GetLine(id, t.id);
      const z0 = b.z0 - ffb;
      raeume.push({ name: text(l, 'LongName') || text(l, 'Name') || `Raum ${raeume.length + 1}`, poly: poly.map(lokal), z0: Math.round(z0 * 1000) / 1000, z1: Math.round((b.z1 - ffb) * 1000) / 1000, geschoss: geschosse.reduce((g, s, i) => (z0 >= s.z0 - 0.2 ? i : g), 0) });
    }
    // Fenster den Räumen zuordnen: im selben Geschoss, Mitte höchstens 0,4 m außerhalb des Raumumrisses
    for (const f of fenster) {
      let best = { d: 0.4, name: undefined as string | undefined };
      for (const r of raeume.filter((x) => x.geschoss === f.geschoss)) {
        const d = abstandZuPolygon(f.pos, r.poly);
        if (d < best.d) best = { d, name: r.name };
      }
      f.raum = best.name;
    }

    // Netz zur Darstellung (ohne Räume), Ursprung wie der Fußabdruck, Höhen über FFB
    const verts: number[] = [];
    const indices: number[] = [];
    const farben: number[] = [];
    for (const t of bau) {
      const basis = verts.length / 3;
      for (let k = 0; k < t.pos.length; k += 3) {
        verts.push(t.pos[k] - ox, t.pos[k + 1] - oy, t.pos[k + 2] - ffb);
        const fb2 = t.typ === 'fenster' ? [150, 205, 235, 170] : t.typ === 'dach' ? [168, 118, 90, 255] : t.typ === 'platte' ? [190, 190, 185, 255] : t.typ === 'tuer' ? [150, 110, 80, 255] : [228, 218, 200, 255];
        farben.push(...fb2);
      }
      for (const i of t.idx) indices.push(basis + i);
    }
    const netz: HausNetz = { pos: new Float32Array(verts), idx: new Uint32Array(indices), farbe: new Uint8Array(farben) };
    return { quelle: 'IFC', name, fussabdruck, geschosse, traufe: Math.round(traufe * 1000) / 1000, first: Math.round(first * 1000) / 1000, dach, fenster, raeume, netz, warnungen };
  } finally {
    api.CloseModel(id);
  }
}

function abstandZuPolygon(p: Vec2, poly: Vec2[]): number {
  let inside = false;
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi;
    const dy = yj - yi;
    const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - xi) * dx + (p[1] - yi) * dy) / L2));
    d = Math.min(d, Math.hypot(p[0] - (xi + t * dx), p[1] - (yi + t * dy)));
  }
  return inside ? 0 : d;
}
