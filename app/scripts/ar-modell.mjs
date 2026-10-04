/**
 * AR-Modelle im Maßstab 1:1 (AUFTRAG_V2 Phase 3.3), ohne Abhängigkeiten.
 *   glb(teile)  → glTF 2.0 binär (Android Scene Viewer)
 *   usdz(teile) → USDZ mit USDA-Text (iOS AR Quick Look)
 * Wird im Browser (Download) und im Node-Server (/api/ar/modell.glb|usdz, zustandslos aus Parametern) benutzt.
 *
 * Koordinaten: Meter, Y nach oben, Boden bei y = 0, Mitte des Grundrisses im Ursprung; x = Breite, z = Tiefe.
 */

/** @typedef {{ name: string, farbe: [number, number, number], pos: number[], nrm: number[], idx: number[] }} Teil */

const FARBEN = {
  holz: [0.85, 0.73, 0.56],
  holzDunkel: [0.76, 0.62, 0.44],
  geraet: [0.93, 0.93, 0.92],
  gruen: [0.30, 0.54, 0.25],
  stamm: [0.48, 0.35, 0.23],
};

/** @returns {Teil} */
function neu(name, farbe) {
  return { name, farbe, pos: [], nrm: [], idx: [] };
}

/** Viereck (gegen den Uhrzeigersinn von außen gesehen), flache Normale. */
function viereck(t, a, b, c, d) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  n = n.map((x) => x / l);
  const i = t.pos.length / 3;
  for (const p of [a, b, c, d]) { t.pos.push(...p); t.nrm.push(...n); }
  t.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
}
function dreieck(t, a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  n = n.map((x) => x / l);
  const i = t.pos.length / 3;
  for (const p of [a, b, c]) { t.pos.push(...p); t.nrm.push(...n); }
  t.idx.push(i, i + 1, i + 2);
}

/** Quader x0..x1, y0..y1 (Höhe), z0..z1. */
function quader(t, x0, x1, y0, y1, z0, z1) {
  viereck(t, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // +z
  viereck(t, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]); // −z
  viereck(t, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); // +x
  viereck(t, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // −x
  viereck(t, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]); // oben
  viereck(t, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // unten
}

/** Senkrechtes Prisma über einem Vieleck (x, z) gegen den Uhrzeigersinn von oben. */
function prisma(t, poly, y0, y1) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % n];
    viereck(t, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]);
  }
  for (let i = 1; i < n - 1; i++) {
    dreieck(t, [poly[0][0], y1, poly[0][1]], [poly[i][0], y1, poly[i][1]], [poly[i + 1][0], y1, poly[i + 1][1]]);
    dreieck(t, [poly[0][0], y0, poly[0][1]], [poly[i + 1][0], y0, poly[i + 1][1]], [poly[i][0], y0, poly[i][1]]);
  }
}

/** Achteck (x, z), Umlauf so, dass die Seitenflächen nach außen zeigen (Y oben). */
function achteck(r) {
  return Array.from({ length: 8 }, (_, i) => [r * Math.cos((-i * Math.PI) / 4), r * Math.sin((-i * Math.PI) / 4)]);
}

const zahl = (v, min, max, std) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : std;
};

/**
 * Teile eines Objekts aus Parametern (gleiche Bedeutung wie in der App).
 * art: gartenhaus | carport | waermepumpe | hecke | baum | strauch
 * w, d, h: Breite, Tiefe, Wandhöhe; n: Dachneigung (Gartenhaus, Satteldach, First entlang der Breite);
 * l: Heckenlänge.
 * @returns {Teil[]}
 */
export function teileAus(p) {
  const art = String(p.art);
  const w = zahl(p.w, 0.3, 12, 3);
  const d = zahl(p.d, 0.3, 12, 3);
  const h = zahl(p.h, 0.3, 20, 2.5);
  if (art === 'gartenhaus') {
    const koerper = neu('Wände', FARBEN.holz);
    quader(koerper, -w / 2, w / 2, 0, h, -d / 2, d / 2);
    const dach = neu('Dach', FARBEN.holzDunkel);
    const n = zahl(p.n, 0, 60, 0);
    if (n <= 0) {
      quader(dach, -w / 2 - 0.15, w / 2 + 0.15, h, h + 0.12, -d / 2 - 0.15, d / 2 + 0.15);
    } else {
      const dh = (d / 2) * Math.tan((n * Math.PI) / 180);
      const g = neu('Giebel', FARBEN.holz);
      // Dachflächen (First entlang x bei z = 0)
      viereck(dach, [-w / 2, h, d / 2], [w / 2, h, d / 2], [w / 2, h + dh, 0], [-w / 2, h + dh, 0]);
      viereck(dach, [w / 2, h, -d / 2], [-w / 2, h, -d / 2], [-w / 2, h + dh, 0], [w / 2, h + dh, 0]);
      dreieck(g, [w / 2, h, d / 2], [w / 2, h, -d / 2], [w / 2, h + dh, 0]);
      dreieck(g, [-w / 2, h, -d / 2], [-w / 2, h, d / 2], [-w / 2, h + dh, 0]);
      return [koerper, dach, g];
    }
    return [koerper, dach];
  }
  if (art === 'carport') {
    const pf = neu('Pfosten', FARBEN.holz);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = sx * (w / 2 - 0.12);
      const z = sz * (d / 2 - 0.12);
      quader(pf, x - 0.06, x + 0.06, 0, h, z - 0.06, z + 0.06);
    }
    const dach = neu('Dach', FARBEN.holzDunkel);
    quader(dach, -w / 2 - 0.1, w / 2 + 0.1, h, h + 0.16, -d / 2 - 0.1, d / 2 + 0.1);
    return [pf, dach];
  }
  if (art === 'waermepumpe') {
    const t = neu('Gerät', FARBEN.geraet);
    quader(t, -w / 2, w / 2, 0, h, -d / 2, d / 2);
    return [t];
  }
  if (art === 'hecke') {
    const l = zahl(p.l, 0.6, 40, 6);
    const t = neu('Hecke', FARBEN.gruen);
    quader(t, -l / 2, l / 2, 0, h, -0.3, 0.3);
    return [t];
  }
  if (art === 'baum') {
    const st = neu('Stamm', FARBEN.stamm);
    prisma(st, achteck(0.15), 0, h * 0.45);
    const kr = neu('Krone', FARBEN.gruen);
    prisma(kr, achteck(Math.max(0.8, h / 3)), h * 0.45, h);
    return [st, kr];
  }
  if (art === 'strauch') {
    const t = neu('Strauch', FARBEN.gruen);
    prisma(t, achteck(Math.min(1.2, Math.max(0.4, h / 3))), 0, h);
    return [t];
  }
  throw new Error(`unbekannte Art: ${art}`);
}

/* ---------- glTF 2.0 binär ---------- */

/** @param {Teil[]} teile @returns {Uint8Array} */
export function glb(teile) {
  const chunks = [];
  let laenge = 0;
  const views = [];
  const accessors = [];
  const add = (arr, target) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (laenge % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); laenge += pad; }
    views.push({ buffer: 0, byteOffset: laenge, byteLength: bytes.byteLength, target });
    chunks.push(bytes);
    laenge += bytes.byteLength;
    return views.length - 1;
  };
  const materials = [];
  const primitives = teile.map((t, i) => {
    const pos = new Float32Array(t.pos);
    const nrm = new Float32Array(t.nrm);
    const idx = t.pos.length / 3 > 65535 ? new Uint32Array(t.idx) : new Uint16Array(t.idx);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < pos.length; k += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], pos[k + a]); max[a] = Math.max(max[a], pos[k + a]); }
    const vp = add(pos, 34962);
    accessors.push({ bufferView: vp, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    const ap = accessors.length - 1;
    const vn = add(nrm, 34962);
    accessors.push({ bufferView: vn, componentType: 5126, count: nrm.length / 3, type: 'VEC3' });
    const an = accessors.length - 1;
    const vi = add(idx, 34963);
    accessors.push({ bufferView: vi, componentType: idx instanceof Uint32Array ? 5125 : 5123, count: idx.length, type: 'SCALAR' });
    const ai = accessors.length - 1;
    materials.push({ name: t.name, pbrMetallicRoughness: { baseColorFactor: [...t.farbe, 1], metallicFactor: 0, roughnessFactor: 0.9 }, doubleSided: true });
    return { attributes: { POSITION: ap, NORMAL: an }, indices: ai, material: i };
  });
  const bin = new Uint8Array(laenge + ((4 - (laenge % 4)) % 4));
  let o = 0;
  for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
  const json = {
    asset: { version: '2.0', generator: 'Passt. (ar-modell.mjs)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Vorhaben' }],
    meshes: [{ primitives }],
    materials,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.byteLength }],
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (js.byteLength % 4)) % 4;
  if (jpad) { const x = new Uint8Array(js.byteLength + jpad).fill(0x20); x.set(js); js = x; }
  const total = 12 + 8 + js.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // glTF
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, js.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // JSON
  out.set(js, 20);
  const b0 = 20 + js.byteLength;
  dv.setUint32(b0, bin.byteLength, true);
  dv.setUint32(b0 + 4, 0x004e4942, true); // BIN
  out.set(bin, b0 + 8);
  return out;
}

/* ---------- USDZ (USDA in unkomprimiertem ZIP, 64-Byte-ausgerichtet) ---------- */

const f = (x) => Number(x.toFixed(5));

/** @param {Teil[]} teile @returns {string} */
export function usda(teile) {
  const mats = teile.map((t, i) => `
    def Material "M${i}"
    {
        token outputs:surface.connect = </Vorhaben/Materialien/M${i}/Oberflaeche.outputs:surface>
        def Shader "Oberflaeche"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = (${t.farbe.map(f).join(', ')})
            float inputs:metallic = 0
            float inputs:roughness = 0.9
            token outputs:surface
        }
    }`).join('\n');
  const meshes = teile.map((t, i) => {
    const n = t.idx.length / 3;
    const pts = [];
    for (let k = 0; k < t.pos.length; k += 3) pts.push(`(${f(t.pos[k])}, ${f(t.pos[k + 1])}, ${f(t.pos[k + 2])})`);
    const nrm = [];
    for (const v of t.idx) nrm.push(`(${f(t.nrm[v * 3])}, ${f(t.nrm[v * 3 + 1])}, ${f(t.nrm[v * 3 + 2])})`);
    return `
    def Mesh "Teil${i}"
    {
        uniform bool doubleSided = 1
        int[] faceVertexCounts = [${Array(n).fill(3).join(', ')}]
        int[] faceVertexIndices = [${t.idx.join(', ')}]
        point3f[] points = [${pts.join(', ')}]
        normal3f[] normals = [${nrm.join(', ')}] (
            interpolation = "faceVarying"
        )
        uniform token subdivisionScheme = "none"
        rel material:binding = </Vorhaben/Materialien/M${i}>
    }`;
  }).join('\n');
  return `#usda 1.0
(
    defaultPrim = "Vorhaben"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "Vorhaben" (
    kind = "component"
    prepend apiSchemas = ["MaterialBindingAPI"]
)
{
    def Scope "Materialien"
    {${mats}
    }
${meshes}
}
`;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {Teil[]} teile @returns {Uint8Array} */
export function usdz(teile) {
  const name = new TextEncoder().encode('modell.usda');
  const daten = new TextEncoder().encode(usda(teile));
  const crc = crc32(daten);
  // Daten müssen bei einem Vielfachen von 64 Bytes beginnen: Lückenfüller im Extra-Feld des lokalen Kopfes
  const kopf = 30 + name.length;
  const extra = (64 - ((kopf + 4) % 64)) % 64 + 4;
  const lokal = new Uint8Array(kopf + extra);
  const dl = new DataView(lokal.buffer);
  dl.setUint32(0, 0x04034b50, true);
  dl.setUint16(4, 20, true);
  dl.setUint16(8, 0, true); // gespeichert, nicht komprimiert
  dl.setUint32(14, crc, true);
  dl.setUint32(18, daten.length, true);
  dl.setUint32(22, daten.length, true);
  dl.setUint16(26, name.length, true);
  dl.setUint16(28, extra, true);
  lokal.set(name, 30);
  dl.setUint16(kopf, 0x1986, true); // eigene Kennung für das Füllfeld
  dl.setUint16(kopf + 2, extra - 4, true);
  const zentral = new Uint8Array(46 + name.length);
  const dz = new DataView(zentral.buffer);
  dz.setUint32(0, 0x02014b50, true);
  dz.setUint16(4, 20, true);
  dz.setUint16(6, 20, true);
  dz.setUint32(16, crc, true);
  dz.setUint32(20, daten.length, true);
  dz.setUint32(24, daten.length, true);
  dz.setUint16(28, name.length, true);
  dz.setUint32(42, 0, true);
  zentral.set(name, 46);
  const ende = new Uint8Array(22);
  const de = new DataView(ende.buffer);
  de.setUint32(0, 0x06054b50, true);
  de.setUint16(8, 1, true);
  de.setUint16(10, 1, true);
  de.setUint32(12, zentral.length, true);
  de.setUint32(16, lokal.length + daten.length, true);
  const out = new Uint8Array(lokal.length + daten.length + zentral.length + ende.length);
  out.set(lokal, 0);
  out.set(daten, lokal.length);
  out.set(zentral, lokal.length + daten.length);
  out.set(ende, lokal.length + daten.length + zentral.length);
  return out;
}

/** Server: /api/ar/modell.glb|usdz?art=…&w=…&d=…&h=…&n=…&l=… – zustandslos, nichts wird gespeichert. */
export function arApi(req, res) {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/\/api\/ar\/modell\.(glb|usdz)$/);
  if (!m) return false;
  try {
    const p = Object.fromEntries(url.searchParams);
    const teile = teileAus(p);
    const daten = m[1] === 'glb' ? glb(teile) : usdz(teile);
    res.writeHead(200, {
      'Content-Type': m[1] === 'glb' ? 'model/gltf-binary' : 'model/vnd.usdz+zip',
      'Content-Length': daten.byteLength,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(Buffer.from(daten.buffer, daten.byteOffset, daten.byteLength));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(e.message));
  }
  return true;
}
