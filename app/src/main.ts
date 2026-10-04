import {
  Cesium3DTileset,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from '@cesium/engine';
import {
  Cartesian2,
  Cartesian3,
  HeadingPitchRange,
  Math as CMath,
  Matrix4,
  BoundingSphere,
} from '@cesium/core';
import {
  area,
  centroid,
  edges,
  evaluate,
  fmt,
  footprint,
  GEBIET_TEXT,
  istGebaeude,
  LIMITS,
  NAMES,
  pointInPolygon,
  polygonDistance,
  type Bestand,
  type Building,
  type Gebietsart,
  type NeighborWindow,
  type ObjectKind,
  type Placed,
  type Provenance,
  type Result,
  type Site,
  type Vec2,
  type GartenKlasse,
  zaehleBestand,
} from './rules';
import { beschreibung, fromRec, griffe, jeGrenze, KLASSE_TEXT, nachgezogen, neuesObjekt } from './site/bestand';
import { DATA_URL, inBbox, loadDetails, loadSite, near, type Data, type DemoAdresse } from './data';
import { cartesianToLocal, localToCartesian, lonLatToLocal, setOrigin } from './scene/coords';
import { Terrain } from './scene/terrain';
import { createScene, type Scene } from './scene/viewer';
import { Renderer, type RenderState } from './scene/render';
import { assumedWindows, awayFromBoundary, ccw, classifyBuildings, initialObjects, isSimple, sidesFromBoundary, snap } from './site/plot';
import { denkmaeler, searchAddress, wasserschutz, type Denkmal, type Place } from './ui/services';
import { endOffline, localImagery, offlineMode, offlineStatus, prepareOffline, registerServiceWorker } from './offline';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ORDER: ObjectKind[] = ['gartenhaus', 'carport', 'waermepumpe'];
const WORD = { ok: 'passt', warn: 'knapp', bad: 'passt nicht' };
const TAG_CLASS: Record<string, string> = {
  rule: 'rule', berechnet: 'calc', Annahme: 'assume', offen: 'open', Demo: 'demo', amtlich: 'off', erkannt: 'det', nutzerbestätigt: 'user',
};

/* ---------- Zustand ---------- */
type BestandItem = Bestand & { status: 'aktiv' | 'entfernt' };
interface State extends RenderState {
  address: string | null;
  buildings: Building[];
  bestand: BestandItem[];
  windows: (NeighborWindow & { buildingId?: string })[];
  gebiet: { value: Gebietsart; provenance: Provenance };
  bereich: { value: 'innen' | 'aussen'; provenance: Provenance };
  aufenthaltsraum: { value: boolean; provenance: Provenance };
  feuerstaette: { value: boolean; provenance: Provenance };
  /** undefined = wird abgefragt, null = nicht abfragbar */
  wsg: string[] | null | undefined;
  /** Denkmäler am Grundstück (BLfD); undefined = wird abgefragt, null = nicht abfragbar */
  denkmal: Denkmal[] | null | undefined;
  view: '3d' | 'plan';
  heading: number;
  hasDragged: boolean;
}

const st: State = {
  step: 'start',
  draft: [],
  plot: null,
  objs: null,
  selected: 'gartenhaus',
  res: null,
  bestand: [],
  windows: [],
  dark: false,
  mesh: false,
  address: null,
  buildings: [],
  gebiet: { value: 'allgemein', provenance: 'Annahme' },
  bereich: { value: 'innen', provenance: 'Annahme' },
  aufenthaltsraum: { value: false, provenance: 'Annahme' },
  feuerstaette: { value: false, provenance: 'Annahme' },
  wsg: null,
  denkmal: null,
  view: '3d',
  heading: 0,
  hasDragged: false,
  kante: null,
  zeichnen: null,
};
/** Grenzseite, für die gerade ein Objekt eingezeichnet wird (nur für den Hinweistext). */
let zeichnenSeite: number | null = null;

let data: Data;
/** Grenze vom Nutzer gesetzt oder für eine Demo-Adresse vorgezeichnet */
let plotProvenance: Provenance = 'nutzerbestätigt';
/** Grundrisse und Bestand laden im Hintergrund, sobald die Startansicht steht. */
let details: Promise<unknown>;
let terrain: Terrain;
let scene: Scene;
let renderer: Renderer;
let site: Site | null = null;

/* ---------- Hilfen ---------- */
function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function hint(text: string | null) {
  const h = $('hint');
  if (!text) h.classList.add('gone');
  else {
    h.textContent = text;
    h.classList.remove('gone');
  }
}

function verdict(head: string, sub: string, status: 'ok' | 'warn' | 'bad' | 'none' = 'none') {
  $('vHead').textContent = head;
  $('vSub').textContent = sub;
  const d = $('vDot');
  d.className = `vdot ${status === 'none' ? '' : status}`;
  d.style.visibility = status === 'none' ? 'hidden' : 'visible';
}

function tag(text: string, kind: string) {
  return `<span class="tg ${TAG_CLASS[kind] ?? ''}">${esc(text)}</span>`;
}

function render() {
  scene.viewer.scene.requestRender();
}

/** Bildschirmpixel → Meter am Grundstück (für Einrast-Toleranz). */
function metersPerPixel(p: Vec2): number {
  const c = localToCartesian(p, terrain.heightOrCoarse(p));
  const v = scene.viewer;
  return v.camera.getPixelSize(new BoundingSphere(c, 1), v.scene.drawingBufferWidth, v.scene.drawingBufferHeight);
}

function pickGround(pos: Cartesian2): Vec2 | null {
  const v = scene.viewer;
  const ray = v.camera.getPickRay(pos);
  if (!ray) return null;
  const c = v.scene.globe.pick(ray, v.scene);
  return c ? cartesianToLocal(c).p : null;
}

/* ---------- Kamera ---------- */
function frame(center: Vec2, radius: number, view: '3d' | 'plan' = st.view, animate = true) {
  const h = terrain.heightOrCoarse(center);
  const target = localToCartesian(center, h);
  const pitch = view === 'plan' ? -CMath.PI_OVER_TWO + 0.0001 : CMath.toRadians(-38);
  const range = view === 'plan' ? radius * 2.6 : radius * 2.4;
  const v = scene.viewer;
  const hpr = new HeadingPitchRange(st.heading, pitch, range);
  if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    v.camera.flyToBoundingSphere(new BoundingSphere(target, radius), { offset: hpr, duration: 0.6 });
  } else {
    v.camera.lookAt(target, hpr);
    v.camera.lookAtTransform(Matrix4.IDENTITY);
  }
  render();
}

function plotFrame(animate = true) {
  const p = st.plot ?? st.draft;
  if (!p.length) return;
  const c = centroid(p);
  const r = Math.max(18, ...p.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1]))) + 6;
  frame(c, r, st.view, animate);
}

/* ---------- Schritt 1: Adresse ---------- */
function showStart(msg?: string) {
  st.step = 'start';
  st.draft = [];
  scene.parzellar.show = false;
  const online = navigator.onLine && !new URLSearchParams(location.search).has('offline');
  verdict(
    'Wo steht dein Haus?',
    msg ?? (online ? 'Such deine Adresse oder tipp auf dein Grundstück in der Karte.' : 'Ohne Internet gibt es keine Adresssuche. Tipp auf dein Grundstück oder wähl eine Demo-Adresse.'),
  );
  const demos = data.site.demos ?? [];
  const demoHtml = demos.length
    ? `<h3 style="font-size:14px;margin:16px 0 2px">Demo-Adressen</h3><ul class="results">${demos
        .map((d) => `<li><button type="button" data-demo="${esc(d.id)}"><strong>${esc(d.titel)}</strong><br>${esc(d.adresse)}</button></li>`)
        .join('')}</ul>`
    : '';
  $('stepBody').innerHTML = `
    <form class="search" id="searchForm" role="search" ${online ? '' : 'hidden'}>
      <label class="sr" for="q" hidden>Adresse</label>
      <input id="q" name="q" type="search" autocomplete="street-address" placeholder="Straße und Hausnummer" value="${esc(st.address ?? (document.getElementById('q') as HTMLInputElement | null)?.value ?? '')}">
      <button type="submit">Suchen</button>
    </form>
    <ul class="results" id="results"></ul>
    ${demoHtml}
    <p class="fine">Daten liegen für 2 × 2 km in ${esc(data.site.gemeinde.name)} vor.${online ? ' Adresssuche: © OpenStreetMap-Mitwirkende (Nominatim).' : ''}</p>`;
  document.querySelectorAll<HTMLButtonElement>('[data-demo]').forEach((b) =>
    b.addEventListener('click', () => startDemo(demos.find((d) => d.id === b.dataset.demo)!)),
  );
  $('searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = ($('q') as HTMLInputElement).value.trim();
    if (!q) return;
    const list = $('results');
    list.innerHTML = '<li class="fine">Suche …</li>';
    try {
      const res = await searchAddress(q.includes(data.site.gemeinde.name) ? q : `${q}, ${data.site.gemeinde.name}`, data.site.bbox);
      list.innerHTML = res.length
        ? res.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.label)}</button></li>`).join('')
        : '<li class="fine">Nichts gefunden. Tipp stattdessen auf die Karte.</li>';
      list.querySelectorAll<HTMLButtonElement>('button[data-i]').forEach((b) =>
        b.addEventListener('click', () => choosePlace(res[+b.dataset.i!])),
      );
    } catch (err) {
      list.innerHTML = `<li class="fine">${esc(String((err as Error).message))}</li>`;
    }
  });
  hint(null);
  renderer.syncDraftPoints();
  renderer.syncContext();
  renderer.updateDim();
}

/** Demo-Adresse: Grenze ist vorgezeichnet (Label `Demo`), danach geht es direkt ins Prüfen. */
async function startDemo(d: DemoAdresse) {
  st.address = d.adresse;
  await Promise.all([details, terrain.ensure([d.grenze[0][0] - 90, d.grenze[0][1] - 90], [d.grenze[0][0] + 90, d.grenze[0][1] + 90])]);
  st.draft = d.grenze.map((p) => [p[0], p[1]] as Vec2);
  plotProvenance = 'Demo';
  if (d.blickGrad != null) st.heading = CMath.toRadians(d.blickGrad);
  await confirmPlot();
  if (d.start && st.objs) {
    const o = st.objs[d.objekt];
    o.center = d.start;
    if (d.winkelGrad != null) o.angle = CMath.toRadians(d.winkelGrad);
    if (d.hoehe != null) o.h = d.hoehe;
    // Das jeweils andere Nebengebäude von den Grenzen wegrücken, damit es die Grenzbebauung nicht verfälscht
    const other = d.objekt === 'carport' ? 'gartenhaus' : 'carport';
    const obstacles = [
      ...st.buildings.map((b) => b.footprint),
      ...st.bestand.map((b) => b.footprint),
      ...(['gartenhaus', 'carport', 'waermepumpe'] as const).filter((k) => k !== other).map((k) => footprint(st.objs![k])),
    ];
    st.objs[other] = awayFromBoundary(st.objs[other], st.plot!, obstacles);
  }

  select(d.objekt);
}

function choosePlace(p: Place) {
  st.address = p.label.split(',').slice(0, 2).join(',');
  goToPlot(lonLatToLocal(p.lon, p.lat));
}

async function goToPlot(p: Vec2) {
  if (!inBbox(data.site, p, 20)) {
    showStart('Hier haben wir noch keine Daten. Die Demo deckt 2 × 2 km rund um die Altstadt ab.');
    return;
  }
  await Promise.all([details, terrain.ensure([p[0] - 80, p[1] - 80], [p[0] + 80, p[1] + 80])]);
  st.view = 'plan';
  syncViewButtons();
  frame(p, 22, 'plan');
  showGrenze();
}

/* ---------- Schritt 2: Grenze bestätigen ---------- */
function showGrenze() {
  st.step = 'grenze';
  st.plot = null;
  st.objs = null;
  st.res = null;
  scene.parzellar.show = true;
  renderer.syncPlot(() => new Set());
  renderer.syncContext();
  renderer.updateDim();
  updateGrenzeUI();
}

function updateGrenzeUI(msg?: string) {
  const n = st.draft.length;
  verdict(
    'Setz deine Grenzpunkte.',
    msg ?? 'Tipp die Ecken deines Grundstücks an. Die gelben Linien der Flurkarte helfen dir, an Hausecken rasten die Punkte ein.',
  );
  const a = n >= 3 ? area(st.draft) : 0;
  $('stepBody').innerHTML = `
    <ul class="rows" style="margin-top:14px">
      <li><span>Gesetzte Punkte</span><span>${n}</span></li>
      ${n >= 3 ? `<li><span>Fläche</span><span>${fmt(a, 0)} m²</span></li>` : ''}
      <li><span>Grenzlinien der Flurkarte sind nur Hilfslinien</span>${tag('amtlich', 'amtlich')}</li>
    </ul>
    <div class="btnrow">
      <button class="primary" id="doneBtn" type="button" ${n < 3 ? 'disabled' : ''}>Grenze bestätigen</button>
      <button class="sec" id="undoBtn" type="button" ${n ? '' : 'disabled'}>Letzten Punkt löschen</button>
      <button class="sec" id="backBtn" type="button">Andere Adresse</button>
    </div>`;
  $('doneBtn').addEventListener('click', confirmPlot);
  $('undoBtn').addEventListener('click', () => {
    st.draft.pop();
    renderer.syncDraftPoints();
    updateGrenzeUI();
  });
  $('backBtn').addEventListener('click', () => showStart());
  hint(n === 0 ? 'Tipp auf die erste Ecke deines Grundstücks.' : n < 3 ? 'Weiter: die nächste Ecke.' : 'Fertig? Tipp auf den ersten Punkt oder bestätige unten.');
  render();
}

function addBoundaryPoint(p: Vec2) {
  plotProvenance = 'nutzerbestätigt';
  const tol = Math.max(0.4, 16 * metersPerPixel(p));
  if (st.draft.length >= 3 && Math.hypot(p[0] - st.draft[0][0], p[1] - st.draft[0][1]) < tol) {
    confirmPlot();
    return;
  }
  const fps = near(data.buildings, p, 40).map((b) => b.fp);
  const s = snap(p, fps, tol);
  st.draft.push(s.p);
  renderer.syncDraftPoints();
  updateGrenzeUI(s.snapped ? `Eingerastet an einer Hausecke${s.snapped === 'kante' ? 'nkante' : ''}.` : undefined);
}

async function confirmPlot() {
  const b = ccw(st.draft);
  if (b.length < 3) return;
  if (!isSimple(b)) return updateGrenzeUI('Die Grenzlinien kreuzen sich. Lösch den letzten Punkt und setz ihn neu.');
  const a = area(b);
  if (a < 40 || a > 8000) return updateGrenzeUI(`Die Fläche von ${fmt(a, 0)} m² wirkt nicht wie ein Wohngrundstück. Prüf die Punkte.`);
  st.plot = b;
  const c = centroid(b);
  await terrain.ensure([c[0] - 90, c[1] - 90], [c[0] + 90, c[1] + 90]);
  st.buildings = classifyBuildings(b, near(data.buildings, c, 90));
  if (!st.buildings.some((x) => x.own)) {
    // Kein Haus im Grundstück: Hauptgebäude mit der größten Überdeckung nehmen
    const touching = st.buildings.filter((x) => x.footprint.some((p) => pointInPolygon(p, b)));
    touching.forEach((x) => (x.own = true));
  }
  st.bestand = near(data.bestand, c, 90)
    .filter((x) => pointInPolygon(centroid(x.fp), b))
    .map((x) => ({ ...fromRec(x), status: 'aktiv' as const }));
  st.kante = null;
  st.zeichnen = null;
  st.windows = assumedWindows(b, st.buildings);
  st.objs = initialObjects(b, st.buildings, st.bestand);
  st.step = 'pruefen';
  st.view = '3d';
  syncViewButtons();
  scene.parzellar.show = false;
  st.wsg = undefined;
  st.denkmal = undefined;
  wasserschutz(c).then((w) => {
    st.wsg = w;
    if (st.step === 'pruefen') renderSheet();
  });
  denkmaeler([c, ...b]).then((d) => {
    st.denkmal = d;
    if (st.step === 'pruefen') renderSheet();
  });
  buildSite();
  renderer.syncDraftPoints();
  renderer.syncPlot(badSegments);
  renderer.syncContext();
  plotFrame();
  select('gartenhaus');
}

/* ---------- Schritt 3: Prüfen ---------- */
function buildSite() {
  if (!st.plot) return;
  site = {
    plot: { boundary: st.plot, ...sidesFromBoundary(st.plot), provenance: plotProvenance },
    buildings: st.buildings,
    bestand: st.bestand.filter((x) => x.status === 'aktiv'),
    windows: st.windows,
    ground: (p) => {
      const h = terrain.height(p);
      return Number.isFinite(h) ? h : terrain.height(centroid(st.plot!));
    },
    groundProvenance: 'amtlich',
    gebiet: st.gebiet,
    bereich: st.bereich,
    bplan: { status: 'unbekannt', provenance: 'offen' },
    aufenthaltsraum: st.aufenthaltsraum,
    feuerstaette: st.feuerstaette,
  };
}

function badSegments(): Set<number> {
  const s = new Set<number>();
  if (st.res) for (const k of ['gartenhaus', 'carport'] as const) st.res[k].badSegments.forEach((i) => s.add(i));
  return s;
}

function update() {
  if (!site || !st.objs) return;
  st.res = evaluate(site, st.objs);
  renderer.updateDim();
  renderVerdict();
  render();
}

function renderVerdict() {
  const r = st.res![st.selected];
  verdict(r.head, r.sub, r.status);
  ORDER.forEach((k) => {
    const b = document.querySelector<HTMLButtonElement>(`[data-obj="${k}"]`);
    if (!b) return;
    b.setAttribute('aria-selected', String(k === st.selected));
    b.querySelector('.d')!.className = `d ${st.res![k].status}`;
    b.setAttribute('aria-label', `${NAMES[k].name}, ${WORD[st.res![k].status]}`);
  });
  const rows = document.getElementById('rows');
  if (rows) rows.innerHTML = r.rows.map((x) => `<li><span>${esc(x.text)}</span>${tag(x.tag, x.kind)}</li>`).join('');
  document.querySelectorAll<HTMLOutputElement>('#controls output').forEach((out) => (out.textContent = valText(out.dataset.k!)));
}

const CTL: Record<ObjectKind, { k: keyof Placed | 'deg'; l: string; min: number; max: number; step: number }[]> = {
  gartenhaus: [
    { k: 'w', l: 'Breite', min: 2, max: 6, step: 0.1 },
    { k: 'd', l: 'Tiefe', min: 2, max: 6, step: 0.1 },
    { k: 'h', l: 'Wandhöhe', min: 2, max: 3.6, step: 0.05 },
    { k: 'deg', l: 'Drehung', min: -90, max: 90, step: 1 },
  ],
  carport: [
    { k: 'w', l: 'Breite', min: 2.5, max: 6.5, step: 0.1 },
    { k: 'd', l: 'Länge', min: 4, max: 9, step: 0.1 },
    { k: 'h', l: 'Höhe', min: 2.2, max: 3.4, step: 0.05 },
    { k: 'deg', l: 'Drehung', min: -90, max: 90, step: 1 },
  ],
  waermepumpe: [
    { k: 'lw', l: 'Lautstärke nachts laut Datenblatt', min: 48, max: 68, step: 1 },
    { k: 'deg', l: 'Drehung', min: -90, max: 90, step: 1 },
  ],
};

function valText(k: string) {
  const o = st.objs![st.selected];
  if (k === 'lw') return `${Math.round(o.lw ?? 58)} dB(A)`;
  if (k === 'deg') return `${Math.round(CMath.toDegrees(o.angle))}°`;
  return `${fmt(o[k as 'w'] as number, k === 'h' ? 2 : 1)} m`;
}

function select(k: ObjectKind) {
  st.selected = k;
  renderSheet();
  if (!st.hasDragged) hint(`Zieh ${NAMES[k].art} an eine andere Stelle.`);
  else if (k === 'waermepumpe') hint('Tipp auf die Fassade des Nachbarhauses, um sein Fenster zu setzen.');
  else hint(null);
}

function sel<T extends string>(id: string, value: T, opts: [T, string][]) {
  return `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

function renderSheet() {
  if (!st.objs) return;
  const o = st.objs[st.selected];
  const ctl = CTL[st.selected]
    .map((s, i) => {
      const v = s.k === 'deg' ? Math.round(CMath.toDegrees(o.angle)) : (o[s.k] as number);
      return `<div class="ctl"><label for="s${i}"><span>${s.l}</span><output data-k="${s.k}" for="s${i}"></output></label><input id="s${i}" type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" data-k="${s.k}"></div>`;
    })
    .join('');
  if (st.kante || st.zeichnen) return renderEditSheet();
  const bestHtml = bestandHtml();
  const wins = st.windows;
  $('stepBody').innerHTML = `
    <div class="objects" role="tablist" aria-label="Was willst du hinstellen?">
      ${ORDER.map((k) => `<button class="obj" role="tab" type="button" data-obj="${k}"><span class="d"></span>${NAMES[k].name}</button>`).join('')}
    </div>
    <div class="controls" id="controls">${ctl}</div>
    ${st.denkmal?.length ? `<p class="warnbox">Denkmalschutz: ${st.denkmal.map((d) => `${esc(d.art)}${d.bezeichnung ? ` „${esc(d.bezeichnung)}“` : ''} (${esc(d.aktennummer)})`).join('; ')}. Hier kann auch ein kleines Nebengebäude oder eine Wärmepumpe eine denkmalrechtliche Erlaubnis brauchen (Art. 6 BayDSchG). ${tag('amtlich', 'amtlich')} <span class="attr">© BLfD</span></p>` : ''}
    ${st.wsg?.length ? `<p class="warnbox">Das Grundstück liegt in einem Trinkwasserschutzgebiet (${esc(st.wsg.join(', '))}). Dort gelten eigene Auflagen. ${tag('amtlich', 'amtlich')}</p>` : ''}
    <details ${st.bestand.length ? 'open' : ''} id="bestandBox">
      <summary>Steht hier schon etwas?</summary>
      ${bestHtml}
    </details>
    <details open>
      <summary>So haben wir geprüft</summary>
      <ul class="rows" id="rows"></ul>
    </details>
    <details>
      <summary>Deine Angaben und Annahmen</summary>
      <div class="field"><span>Gebiet ${tag(st.gebiet.provenance, st.gebiet.provenance)}</span>${sel('fGebiet', st.gebiet.value, [['rein', GEBIET_TEXT.rein], ['allgemein', GEBIET_TEXT.allgemein], ['misch', GEBIET_TEXT.misch]])}</div>
      <div class="field"><span>Lage ${tag(st.bereich.provenance, st.bereich.provenance)}</span>${sel('fBereich', st.bereich.value, [['innen', 'im Ort (Innenbereich)'], ['aussen', 'außerhalb (Außenbereich)']])}</div>
      <div class="field"><span>Gartenhaus mit Aufenthaltsraum ${tag(st.aufenthaltsraum.provenance, st.aufenthaltsraum.provenance)}</span>${sel('fAuf', st.aufenthaltsraum.value ? 'ja' : 'nein', [['nein', 'nein'], ['ja', 'ja']])}</div>
      <div class="field"><span>Gartenhaus mit Ofen ${tag(st.feuerstaette.provenance, st.feuerstaette.provenance)}</span>${sel('fOfen', st.feuerstaette.value ? 'ja' : 'nein', [['nein', 'nein'], ['ja', 'ja']])}</div>
      <div class="field"><span>Nachbarfenster</span><span>${wins.filter((w) => w.provenance !== 'Annahme').length} gesetzt, ${wins.filter((w) => w.provenance === 'Annahme').length} angenommen</span></div>
      <div class="field"><span>Bebauungsplan ${tag('offen', 'offen')}</span>${data.site.gemeinde.bauleitplanung_url ? `<a href="${esc(data.site.gemeinde.bauleitplanung_url)}" target="_blank" rel="noopener">Pläne der Stadt</a>` : 'unbekannt'}</div>
      <div class="field"><span>Trinkwasserschutzgebiet ${st.wsg == null ? tag('offen', 'offen') : tag('amtlich', 'amtlich')}</span><span>${st.wsg === undefined ? 'wird abgefragt …' : st.wsg === null ? 'nicht abfragbar' : st.wsg.length ? 'ja' : 'nein'}</span></div>
      <div class="field"><span>Denkmal ${st.denkmal == null ? tag('offen', 'offen') : tag('amtlich', 'amtlich')}</span><span>${st.denkmal === undefined ? 'wird abgefragt …' : st.denkmal === null ? 'nicht abfragbar' : st.denkmal.length ? 'ja, siehe Hinweis' : 'nein'} · <a href="https://geoportal.bayern.de/denkmalatlas/" target="_blank" rel="noopener">Denkmal-Atlas</a></span></div>
    </details>
    <div class="btnrow">
      <button class="primary" id="reportBtn" type="button" aria-haspopup="dialog">Prüfbericht ansehen</button>
      <button class="sec" id="editBtn" type="button">Grenze ändern</button>
      <button class="sec" id="newBtn" type="button">Andere Adresse</button>
    </div>`;

  document.querySelectorAll<HTMLButtonElement>('[data-obj]').forEach((b) => b.addEventListener('click', () => select(b.dataset.obj as ObjectKind)));
  document.querySelectorAll<HTMLInputElement>('#controls input').forEach((inp) =>
    inp.addEventListener('input', () => {
      const ob = st.objs![st.selected];
      const v = parseFloat(inp.value);
      if (inp.dataset.k === 'deg') ob.angle = CMath.toRadians(v);
      else (ob as unknown as Record<string, number>)[inp.dataset.k!] = v;
      update();
    }),
  );
  const onSel = (id: string, fn: (v: string) => void) => $(id).addEventListener('change', (e) => { fn((e.target as HTMLSelectElement).value); buildSite(); renderSheet(); });
  onSel('fGebiet', (v) => (st.gebiet = { value: v as Gebietsart, provenance: 'nutzerbestätigt' }));
  onSel('fBereich', (v) => (st.bereich = { value: v as 'innen' | 'aussen', provenance: 'nutzerbestätigt' }));
  onSel('fAuf', (v) => (st.aufenthaltsraum = { value: v === 'ja', provenance: 'nutzerbestätigt' }));
  onSel('fOfen', (v) => (st.feuerstaette = { value: v === 'ja', provenance: 'nutzerbestätigt' }));
  document.querySelectorAll<HTMLButtonElement>('[data-bok]').forEach((b) =>
    b.addEventListener('click', () => {
      const it = st.bestand.find((x) => x.id === b.dataset.bok)!;
      it.status = 'aktiv';
      it.provenance = 'nutzerbestätigt';
      afterContextChange();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-bno]').forEach((b) =>
    b.addEventListener('click', () => {
      st.bestand.find((x) => x.id === b.dataset.bno)!.status = 'entfernt';
      afterContextChange();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-kante]').forEach((b) =>
    b.addEventListener('click', () => {
      const it = st.bestand.find((x) => x.id === b.dataset.kante)!;
      st.kante = { id: it.id, fp: griffe(it), ref: it.footprint };
      startEdit();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-neu]').forEach((b) =>
    b.addEventListener('click', () => {
      st.zeichnen = [];
      zeichnenSeite = b.dataset.neu === '' ? null : Number(b.dataset.neu);
      startEdit();
    }),
  );
  $('reportBtn').addEventListener('click', openReport);
  $('editBtn').addEventListener('click', () => {
    st.draft = [...(st.plot ?? [])];
    st.view = 'plan';
    syncViewButtons();
    showGrenze();
    renderer.syncDraftPoints();
    plotFrame();
  });
  $('newBtn').addEventListener('click', () => showStart());
  update();
}

/** „Steht hier schon etwas?“ – je Grenze vorbefüllt aus der Garten-Erkennung, dazu die übrigen Objekte im Garten. */
function bestandHtml(): string {
  if (!st.plot || !site) return '';
  const sides = site.plot.sides;
  const { seiten, innen } = jeGrenze(st.bestand, st.plot, site.plot.segmentSide ?? sidesFromBoundary(st.plot).segmentSide, sides.length);
  const z = zaehleBestand({ ...site, bestand: st.bestand.filter((x) => x.status === 'aktiv') });
  const grund = new Map<string, string>([
    ...z.gezaehlt.map((x) => [x.id, `zählt bei der Grenzbebauung mit (${x.grund})`] as [string, string]),
    ...z.nicht.filter((x) => x.grund !== 'kein Gebäude').map((x) => [x.id, `zählt noch nicht mit: ${x.grund}`] as [string, string]),
  ]);
  const item = (b: BestandItem) => {
    const weg = b.status === 'entfernt';
    const herkunft = weg ? tag('verworfen', 'offen') : b.provenance === 'erkannt' ? tag(`erkannt ${Math.round((b.confidence ?? 0) * 100)} %`, 'erkannt') : tag(b.provenance, b.provenance);
    return `<li><span>${weg ? '<s>' : ''}${esc(beschreibung(b))}${weg ? '</s>' : ''}${!weg && grund.has(b.id) ? `<br><small class="fine">${esc(grund.get(b.id)!)}</small>` : ''}</span>
      ${herkunft}
      <span class="acts">${!weg && b.provenance === 'erkannt' ? `<button type="button" data-bok="${b.id}">Stimmt</button>` : ''}
      ${!weg ? `<button type="button" data-kante="${b.id}">Umriss nachziehen</button>` : ''}
      ${!weg ? `<button type="button" data-bno="${b.id}">Gibt es nicht</button>` : `<button type="button" data-bok="${b.id}">Doch</button>`}</span></li>`;
  };
  let h = '<p class="fine" style="text-align:left">Aus Luftbild 2023 und Laserdaten 2025 erkannt. Bestehende Gebäude an der Grenze zählen bei den 9 m und 15 m mit. Bitte prüfen.</p>';
  sides.forEach((sd, i) => {
    h += `<h3 style="font-size:14px;margin:12px 0 4px">${esc(cap(sd.grenze))}</h3>`;
    h += seiten[i].length
      ? `<ul class="rows best">${seiten[i].map((b) => item(b as BestandItem)).join('')}</ul>`
      : `<p class="fine" style="text-align:left">Nichts erkannt. <button class="link" type="button" data-neu="${i}">Doch, hier steht etwas</button></p>`;
  });
  if (innen.length) h += `<details><summary>Weitere Objekte im Garten (${innen.length})</summary><ul class="rows best">${innen.map((b) => item(b as BestandItem)).join('')}</ul></details>`;
  h += `<p class="fine" style="text-align:left"><button class="link" type="button" data-neu="">Objekt einzeichnen</button></p>`;
  return h;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function startEdit() {
  st.view = 'plan';
  syncViewButtons();
  plotFrame();
  renderer.syncContext();
  renderer.syncEdit();
  renderSheet();
}

function endEdit() {
  st.kante = null;
  st.zeichnen = null;
  zeichnenSeite = null;
  renderer.syncEdit();
  afterContextChange();
}

/** Bedienfeld beim Nachziehen oder Einzeichnen (ersetzt die Prüfansicht, bis fertig). */
function renderEditSheet() {
  const zeichnen = st.zeichnen;
  if (st.kante) {
    const it = st.bestand.find((x) => x.id === st.kante!.id)!;
    verdict('Umriss nachziehen.', `${it.kind ? KLASSE_TEXT[it.kind] : 'Kleinbau'}: Zieh die blauen Ecken auf die Kanten im Luftbild. Sie rasten an der erkannten Kante (gestrichelt), an Gebäuden und an der Grenze ein.`);
    $('stepBody').innerHTML = `<div class="btnrow">
      <button class="primary" id="eOk" type="button">Übernehmen</button>
      <button class="sec" id="eNo" type="button">Abbrechen</button></div>`;
  } else if (zeichnen) {
    const n = zeichnen.length;
    verdict('Objekt einzeichnen.', n < 4 ? `Tipp die ${['erste', 'zweite', 'dritte', 'vierte'][n]} Ecke an${zeichnenSeite != null && site ? ` (${site.plot.sides[zeichnenSeite].grenze})` : ''}. An Gebäuden und der Grenze rastet sie ein.` : 'Was steht da, und wie hoch ist die Wand?');
    const kl: GartenKlasse[] = ['gartenhaus', 'carport_garage', 'gewaechshaus', 'pool', 'terrasse', 'spielturm', 'trampolin', 'hecke', 'strauch', 'baum', 'zaun_mauer'];
    $('stepBody').innerHTML = `${n >= 4 ? `
      <div class="field"><span>Was ist es?</span>${sel('eKl', 'gartenhaus', kl.map((k) => [k, KLASSE_TEXT[k]]))}</div>
      <div class="field"><label for="eH">Mittlere Wandhöhe in m</label><input id="eH" type="number" min="0" max="8" step="0.05" value="2.50" inputmode="decimal"></div>` : ''}
      <div class="btnrow">
      ${n >= 4 ? '<button class="primary" id="eOk" type="button">Übernehmen</button>' : ''}
      <button class="sec" id="eUndo" type="button" ${n ? '' : 'disabled'}>Letzte Ecke löschen</button>
      <button class="sec" id="eNo" type="button">Abbrechen</button></div>`;
    document.getElementById('eUndo')?.addEventListener('click', () => {
      st.zeichnen!.pop();
      renderer.syncEdit();
      renderSheet();
    });
  }
  document.getElementById('eNo')?.addEventListener('click', endEdit);
  document.getElementById('eOk')?.addEventListener('click', () => {
    if (st.kante) {
      const i = st.bestand.findIndex((x) => x.id === st.kante!.id);
      st.bestand[i] = { ...nachgezogen(st.bestand[i], ccw(st.kante.fp)), status: 'aktiv' };
    } else if (st.zeichnen && st.zeichnen.length >= 4) {
      const k = ($('eKl') as HTMLSelectElement).value as GartenKlasse;
      const h = Math.max(0, parseFloat(($('eH') as HTMLInputElement).value.replace(',', '.')) || 0);
      st.bestand.push({ ...neuesObjekt(`neu-${Date.now()}`, ccw(st.zeichnen), k, h), status: 'aktiv' });
    }
    endEdit();
  });
}

/** Einrasten beim Nachziehen: erkannter Umriss, Gebäude, Grenze, übrige Objekte. */
function snapEdit(p: Vec2): Vec2 {
  const tol = Math.max(0.25, 14 * metersPerPixel(p));
  const fps = [
    ...(st.kante ? [st.kante.ref] : []),
    ...st.buildings.map((b) => b.footprint),
    ...(st.plot ? [st.plot] : []),
    ...st.bestand.filter((b) => b.id !== st.kante?.id && b.status === 'aktiv' && istGebaeude(b)).map((b) => b.footprint),
  ];
  return snap(p, fps, tol).p;
}

function afterContextChange() {
  buildSite();
  renderer.syncContext();
  renderSheet();
}

/* ---------- Nachbarfenster per Tipp ---------- */
function setWindow(c: Cartesian3) {
  const { p, h } = cartesianToLocal(c);
  const g = terrain.height(p);
  const nb = st.buildings
    .filter((b) => !b.own)
    .map((b) => ({ b, d: polygonDistance([p], b.footprint) }))
    .sort((a, b) => a.d - b.d)[0];
  if (!nb || nb.d > 1.5) {
    hint('Das war keine Fassade eines Nachbarhauses. Tipp direkt auf die Hauswand.');
    return;
  }
  // auf die Fassade projizieren
  let best = p;
  let bd = Infinity;
  for (const [a, e] of edges(nb.b.footprint)) {
    const dx = e[0] - a[0];
    const dy = e[1] - a[1];
    const L = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
    const q: Vec2 = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  st.windows = [
    ...st.windows.filter((w) => !(w.provenance === 'Annahme' && w.buildingId === nb.b.id)),
    { pos: best, z: Math.max(0.5, h - g), provenance: 'nutzerbestätigt', buildingId: nb.b.id },
  ];
  hint(`Fenster gesetzt, ${fmt(Math.max(0.5, h - g), 1)} m über Gelände.`);
  afterContextChange();
}

/* ---------- Ziehen und Tippen ---------- */
function setupInput() {
  const v = scene.viewer;
  const h = new ScreenSpaceEventHandler(v.scene.canvas);
  let drag: { k: ObjectKind; off: Vec2 } | null = null;
  let ecke: number | null = null;
  let downAt: Cartesian2 | null = null;

  h.setInputAction((e: { position: Cartesian2 }) => {
    downAt = Cartesian2.clone(e.position);
    if (st.step !== 'pruefen' || !st.objs) return;
    if (st.kante || st.zeichnen) {
      const kk = Renderer.keyOf(v.scene.pick(e.position));
      if (kk?.startsWith('ecke:') && st.kante) {
        ecke = Number(kk.slice(5));
        v.scene.screenSpaceCameraController.enableInputs = false;
      }
      return;
    }
    const key = Renderer.keyOf(v.scene.pick(e.position));
    if (!key || key.startsWith('bestand:')) return;
    const k = key as ObjectKind;
    if (k !== st.selected) select(k);
    const g = pickGround(e.position);
    if (!g) return;
    const o = st.objs[k];
    drag = { k, off: [o.center[0] - g[0], o.center[1] - g[1]] };
    v.scene.screenSpaceCameraController.enableInputs = false;
    if (!st.hasDragged) {
      st.hasDragged = true;
      hint(null);
    }
  }, ScreenSpaceEventType.LEFT_DOWN);

  h.setInputAction((e: { endPosition: Cartesian2 }) => {
    if (ecke != null && st.kante) {
      const g = pickGround(e.endPosition);
      if (g) {
        st.kante.fp[ecke] = snapEdit(g);
        renderer.syncEdit();
      }
      return;
    }
    if (!drag || !st.objs) return;
    const g = pickGround(e.endPosition);
    if (!g) return;
    const o = st.objs[drag.k];
    o.center = [Math.round((g[0] + drag.off[0]) * 20) / 20, Math.round((g[1] + drag.off[1]) * 20) / 20];
    update();
  }, ScreenSpaceEventType.MOUSE_MOVE);

  h.setInputAction((e: { position: Cartesian2 }) => {
    const wasDrag = !!drag || ecke != null;
    drag = null;
    ecke = null;
    v.scene.screenSpaceCameraController.enableInputs = true;
    // Tippen = kaum Bewegung zwischen Drücken und Loslassen
    const moved = downAt ? Cartesian2.distance(downAt, e.position) : 99;
    if (wasDrag || moved > 6) return;
    if (st.step === 'start') {
      const g = pickGround(e.position);
      if (g) goToPlot(g);
    } else if (st.step === 'grenze') {
      const g = pickGround(e.position);
      if (g) addBoundaryPoint(g);
    } else if (st.step === 'pruefen' && st.zeichnen) {
      const g = pickGround(e.position);
      if (g && st.zeichnen.length < 4) {
        st.zeichnen.push(snapEdit(g));
        renderer.syncEdit();
        renderSheet();
      }
    } else if (st.step === 'pruefen' && st.selected === 'waermepumpe') {
      const picked = v.scene.pick(e.position);
      if (picked && (picked.primitive instanceof Cesium3DTileset || picked.tileset)) {
        const c = v.scene.pickPosition(e.position);
        if (c) setWindow(c);
      }
    }
  }, ScreenSpaceEventType.LEFT_UP);

  // Tastatur: Pfeile verschieben relativ zur Blickrichtung, R dreht um 90°
  $('stage').addEventListener('keydown', (e) => {
    if (e.target !== $('stage') || st.step !== 'pruefen' || !st.objs) return;
    const o = st.objs[st.selected];
    if (e.key === 'r' || e.key === 'R') {
      o.angle = ((o.angle + Math.PI / 2 + Math.PI / 2) % Math.PI) - Math.PI / 2;
      renderSheet();
      e.preventDefault();
      return;
    }
    const m = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] } as Record<string, [number, number]>)[e.key];
    if (!m) return;
    const step = e.shiftKey ? 0.5 : 0.1;
    const hd = v.camera.heading; // 0 = Nord
    const right: Vec2 = [Math.cos(hd), -Math.sin(hd)];
    const fwd: Vec2 = [Math.sin(hd), Math.cos(hd)];
    o.center = [o.center[0] + (right[0] * m[0] + fwd[0] * m[1]) * step, o.center[1] + (right[1] * m[0] + fwd[1] * m[1]) * step];
    e.preventDefault();
    update();
  });
}

/* ---------- Ansicht ---------- */
function syncViewButtons() {
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === st.view)));
}

function setupView() {
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      st.view = b.dataset.view as '3d' | 'plan';
      syncViewButtons();
      if (st.plot || st.draft.length) plotFrame();
      else {
        const c = scene.viewer.camera;
        st.heading = c.heading;
        frame(lookCenter(), 120);
      }
    }),
  );
  $('meshBtn').addEventListener('click', async () => {
    const b = $('meshBtn');
    const want = b.getAttribute('aria-pressed') !== 'true';
    const ok = await scene.setMesh(want);
    st.mesh = want && ok;
    b.setAttribute('aria-pressed', String(st.mesh));
    if (want && !ok) hint('Das Foto-Mesh ist in dieser Ausgabe nicht enthalten.');
    renderer.syncPlot(badSegments);
    render();
  });
  $('rotBtn').addEventListener('click', () => {
    st.heading = (scene.viewer.camera.heading + Math.PI / 2) % (2 * Math.PI);
    if (st.plot || st.draft.length) plotFrame();
    else frame(lookCenter(), 120);
  });
}

function lookCenter(): Vec2 {
  const v = scene.viewer;
  const g = pickGround(new Cartesian2(v.canvas.clientWidth / 2, v.canvas.clientHeight / 2));
  return g ?? [0, 0];
}

/* ---------- Dialoge ---------- */
let lastFocus: Element | null = null;
function openModal(title: string, html: string) {
  lastFocus = document.activeElement;
  $('mTitle').textContent = title;
  $('mBody').innerHTML = html;
  $('modal').hidden = false;
  ($('mClose') as HTMLButtonElement).focus();
}
function closeModal() {
  $('modal').hidden = true;
  if (lastFocus instanceof HTMLElement) lastFocus.focus();
}

function openReport() {
  if (!st.res || !site) return;
  const today = new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  let h = `<p class="m-sub">${esc(st.address ?? `Grundstück in ${data.site.gemeinde.name}`)}, ${fmt(area(st.plot!), 0)} m², erstellt am ${esc(today)}</p>`;
  for (const k of ORDER) {
    const r: Result = st.res[k];
    h += `<div class="rep"><div class="rep-h"><span class="d ${r.status}"></span><strong>${NAMES[k].name}</strong><span class="rep-s">${WORD[r.status]}</span></div><p class="rep-t">${esc(r.head)} ${esc(r.sub)}</p></div>`;
  }
  const best = st.bestand.filter((b) => b.status === 'aktiv');
  h += `<h3>Was wir angenommen haben</h3><ul class="plain">
    <li>${plotProvenance === 'Demo' ? 'Grundstücksgrenze für die Demo nach der Flurkarte nachgezeichnet (Demo) – nicht amtlich' : 'Grundstücksgrenze von dir gesetzt (nutzerbestätigt), Flurkarte nur als Hilfslinie'}</li>
    <li>${esc(GEBIET_TEXT[st.gebiet.value])} (${esc(st.gebiet.provenance)}), ${st.bereich.value === 'innen' ? 'Innenbereich' : 'Außenbereich'} (${esc(st.bereich.provenance)})</li>
    <li>Gartenhaus ${st.aufenthaltsraum.value ? 'mit' : 'ohne'} Aufenthaltsraum und ${st.feuerstaette.value ? 'mit' : 'ohne'} Feuerstätte (${esc(st.aufenthaltsraum.provenance)})</li>
    <li>Abstandsfläche 0,4 H, mindestens 3 m; Gemeindesatzungen können abweichen</li>
    <li>Wandhöhe über dem Gelände aus DGM1 gemessen, Fußboden am höchsten Geländepunkt</li>
    ${bestandReport(best)}
    <li>Nachbarfenster: ${st.windows.filter((w) => w.provenance !== 'Annahme').length} von dir gesetzt, ${st.windows.filter((w) => w.provenance === 'Annahme').length} angenommen (Fassadenmitte, 1,6 m)</li>
    <li>Schall vereinfacht nach LAI-Leitfaden, ohne Zuschläge</li>
    <li>Denkmal: ${st.denkmal == null ? 'nicht abgefragt (offen)' : st.denkmal.length ? st.denkmal.map((d) => `${esc(d.art)} ${esc(d.aktennummer)}`).join(', ') + ' (amtlich, © BLfD)' : 'kein Denkmal am Grundstück (amtlich, © BLfD)'}</li>
    <li>Trinkwasserschutzgebiet: ${st.wsg == null ? 'nicht abgefragt (offen)' : st.wsg.length ? esc(st.wsg.join(', ')) : 'nein'}${st.wsg != null ? ' (amtlich, Datenquelle: Bayerisches Landesamt für Umwelt)' : ''}</li>
    <li>Bebauungsplan nicht geprüft${data.site.gemeinde.bauleitplanung_url ? ` – <a href="${esc(data.site.gemeinde.bauleitplanung_url)}" target="_blank" rel="noopener">Pläne der Stadt</a>` : ''}</li>
  </ul>`;
  if (!LIMITS.geprueft) h += `<p class="m-fine">Die Grenzwerte sind noch nicht von einer Fachperson geprüft.</p>`;
  h += `<p class="m-fine">Orientierung, keine Genehmigung. Verbindlich entscheidet das Bauamt.</p>`;
  h += `<p class="m-fine">Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (LoD2, Hausumringe, DGM1, DOM20, DOP20; CC BY 4.0). Quasigeoid GCG2016: © BKG (CC BY 4.0).</p>`;
  openModal('Prüfbericht', h);
}

/** Prüfbericht: welche bestehenden Objekte bei der Grenzbebauung mitgezählt wurden und welche nicht. */
function bestandReport(best: BestandItem[]): string {
  if (!site) return '';
  const z = zaehleBestand({ ...site, bestand: best });
  const name = (id: string) => esc(beschreibung(best.find((b) => b.id === id)!));
  const ja = z.gezaehlt.map((x) => `${name(x.id)} – ${esc(x.grund)}`);
  const nein = z.nicht.filter((x) => x.grund !== 'kein Gebäude').map((x) => `${name(x.id)} – ${esc(x.grund)}`);
  const verworfen = st.bestand.filter((b) => b.status === 'entfernt').length;
  return `<li>Grenzbebauung (9 m / 15 m): ${ja.length ? `mitgezählt ${ja.length} bestehende${ja.length === 1 ? 's Gebäude' : ' Gebäude'}: ${ja.join('; ')}` : 'keine bestehenden Gebäude mitgezählt'}${nein.length ? `. Nicht mitgezählt (unsicher erkannt, bitte bestätigen): ${nein.join('; ')}` : ''}${verworfen ? `. ${verworfen} erkannte${verworfen === 1 ? 's Objekt' : ' Objekte'} von dir verworfen` : ''}. Erkannt aus Luftbild 2023 und Laser 2025; Maße mit Spanne.</li>`;
}

function openInfo() {
  openModal(
    'Woher die Daten kommen',
    `<p>Gebäude, Gelände und Luftbild stammen aus den offenen Geodaten der Bayerischen Vermessungsverwaltung. Die Grundstücksgrenze setzt du selbst – die amtlichen Flurstücke sind nicht frei verfügbar.</p>
    <ul class="plain">
      <li>3D-Gebäudemodelle LoD2 und Hausumringe</li>
      <li>Digitales Geländemodell DGM1, umgerechnet mit dem Quasigeoid GCG2016 (BKG)</li>
      <li>Luftbild DOP20 und Parzellarkarte (Kartendienste)</li>
      <li>Bestehende Objekte im Garten (Gartenhäuser, Pools, Hecken …): aus DOP20, DOM20, DGM1 und Laserpunkten selbst erkannt, Umrisse mit SAM 2 (Meta, Apache 2.0)</li>
      <li>Wasserschutzgebiete: Datenquelle Bayerisches Landesamt für Umwelt, www.lfu.bayern.de (CC BY 4.0, Abfrage)</li>
      <li>Denkmäler: © BLfD (CC BY-ND 4.0, nur Abfrage, unverändert angezeigt)</li>
      <li>Adresssuche: © OpenStreetMap-Mitwirkende, Nominatim</li>
    </ul>
    <h3>So liest du die Hinweise</h3>
    <ul class="legend">
      <li><span class="tg rule">BayBO</span>Regel aus der Bauordnung</li>
      <li><span class="tg off">amtlich</span>Aus amtlichen Daten</li>
      <li><span class="tg calc">berechnet</span>An deinem Grundstück gemessen</li>
      <li><span class="tg det">erkannt</span>Automatisch erkannt, bitte prüfen</li>
      <li><span class="tg user">nutzerbestätigt</span>Von dir angegeben</li>
      <li><span class="tg assume">Annahme</span>Gilt nur, wenn es bei dir so ist</li>
      <li><span class="tg open">offen</span>Muss noch jemand prüfen</li>
    </ul>
    <h3>Offline-Demo</h3>
    <p id="offState">Prüfe …</p>
    <div class="btnrow"><button class="sec" id="offBtn" type="button" hidden></button></div>
    <p class="m-fine">Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (CC BY 4.0)</p>`,
  );
  void renderOfflineControls();
}

/* ---------- Offline-Demo ---------- */
async function renderOfflineControls() {
  const stateEl = document.getElementById('offState');
  const btn = document.getElementById('offBtn') as HTMLButtonElement | null;
  if (!stateEl || !btn) return;
  let s;
  try {
    s = await offlineStatus();
  } catch {
    stateEl.textContent = 'In dieser Umgebung nicht verfügbar (die App muss gebaut ausgeliefert werden).';
    return;
  }
  btn.hidden = false;
  if (s.ready) {
    stateEl.textContent = `Bereit: alle ${s.files} Dateien der Kachel ${data.site.name} sind auf diesem Gerät. Die App läuft ohne Internet; Luftbild und Flurkarte kommen aus gespeicherten Kacheln.`;
    btn.textContent = 'Offline-Demo beenden';
    btn.onclick = async () => {
      await endOffline();
      location.reload();
    };
  } else {
    stateEl.textContent = `Lädt Gelände, Gebäude, Luftbild und Flurkarte (≈ 45 MB) auf dieses Gerät, damit die Demo ohne Netz läuft. ${s.cached ? `${s.cached} von ${s.files} Dateien sind schon da.` : ''}`;
    btn.textContent = 'Offline-Demo vorbereiten';
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await prepareOffline((d, t) => (stateEl.textContent = `Lädt … ${d} von ${t} Dateien (${Math.round((100 * d) / t)} %)`));
        stateEl.textContent = 'Fertig. Die App startet neu im Offline-Modus.';
        setTimeout(() => location.reload(), 800);
      } catch (e) {
        stateEl.textContent = `Abgebrochen: ${(e as Error).message}. Versuch es noch einmal, schon geladene Dateien bleiben erhalten.`;
        btn.disabled = false;
      }
    };
  }
}


/* ---------- Start ---------- */
async function main() {
  registerServiceWorker();
  if (offlineMode()) $('infoBtn').lastChild!.textContent = ' Offline-Demo';
  try {
    const site = await loadSite();
    data = { site, buildings: [], bestand: [] };
    setOrigin(site.origin);
    terrain = await Terrain.load(`${DATA_URL}/terrain`);
    // Offline-Demo: Luftbild und Flurkarte aus vorab erzeugten Kacheln statt aus den WMS
    scene = createScene($('map'), terrain, DATA_URL, site.bbox, await localImagery());
  } catch (e) {
    verdict('Die Karte konnte nicht laden.', 'Lade die Seite neu, um es noch einmal zu versuchen.');
    console.error(e);
    return;
  }
  st.dark = isDark();
  scene.setTheme(st.dark);
  const onTheme = () => {
    st.dark = isDark();
    scene.setTheme(st.dark);
    renderer.syncDraftPoints();
    if (st.plot) renderer.syncPlot(badSegments);
    renderer.syncContext();
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  renderer = new Renderer(scene.viewer, terrain, () => st, $('dim'));
  setupInput();
  setupView();
  $('mClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => e.target === $('modal') && closeModal());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !$('modal').hidden && closeModal());
  $('infoBtn').addEventListener('click', openInfo);

  // Startansicht: Altstadt schräg von Süden
  frame([-150, -100], 260, '3d', false);
  // Grundrisse und Bestand erst laden, wenn die Startansicht steht (oder sobald jemand sucht/tippt),
  // damit sie auf langsamem Netz nicht mit Cesium und dem Luftbild um Bandbreite konkurrieren.
  let detailsP: Promise<unknown> | null = null;
  const startDetails = () => (detailsP ??= loadDetails().then((d) => Object.assign(data, d)));
  details = new Promise((res) => {
    const go = () => startDetails().then(res);
    const off = scene.viewer.scene.postRender.addEventListener(() => {
      if (scene.viewer.scene.globe.tilesLoaded) {
        off();
        go();
      }
    });
    setTimeout(go, 15000);
    document.addEventListener('focusin', go, { once: true });
    scene.viewer.canvas.addEventListener('pointerdown', go, { once: true });
  });
  // Ladehinweis weg, sobald die Karte das erste Bild zeigt
  const hideLoading = scene.viewer.scene.postRender.addEventListener(() => {
    $('loading').hidden = true;
    hideLoading();
  });
  showStart();

  // Test-Schnittstelle für automatisierte Durchläufe (nur mit ?debug)
  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, {
      passt: {
        st,
        goToPlot,
        startDemo: (id: string) => startDemo((data.site.demos ?? []).find((d) => d.id === id)!),
        setBoundary: async (pts: Vec2[]) => {
          st.draft = pts;
          renderer.syncDraftPoints();
          await confirmPlot();
        },
        select,
        update,
        buildings: () => data.buildings,
        tilesLoaded: () => scene.viewer.scene.globe.tilesLoaded && !!scene.tileset?.tilesLoaded,
        frame: (c: Vec2, r: number, v: '3d' | 'plan') => frame(c, r, v, false),
        setMesh: async (on: boolean) => {
          st.mesh = on && (await scene.setMesh(on));
          renderer.syncPlot(badSegments);
          return st.mesh;
        },
        meshLoaded: () => {
          const prims = scene.viewer.scene.primitives;
          for (let i = 0; i < prims.length; i++) {
            const p = prims.get(i);
            if (p !== scene.tileset && p.tilesLoaded !== undefined && p.show) return p.tilesLoaded;
          }
          return true;
        },
      },
    });
  }
}

main();
