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
  dachHoehe,
  alterText,
  bestandsPflanzen,
  HOCH_M,
  KLEIN_M,
  pflanzenText,
  pflanzZonen,
  pruefePflanze,
  type Alter,
  type Pflanze,
  type PflanzenArt,
  type SeitenAngabe,
  imSchatten,
  koerperAus,
  koerperGebaeude,
  koerperPflanze,
  MIN_HOEHE_GRAD,
  pointSegment,
  schattenAmBoden,
  signedArea,
  sonnenstand,
  sonnenstunden,
  type Koerper,
  verfahrenFuer,
  ANTRAG_LINKS,
  GERAETE_NAME,
  geraeteKlasse,
  richtwertFuer,
  standardLw,
  standardMasse,
  type GeraeteKlasse,
  bewerteVorhaben,
  eigeneGebaeude,
  fragenAnGemeinde,
  gemeindeAbschnitt,
  neuesVorhaben,
  umfeldStatistik,
  vorhabenStart,
  vorhabenModell,
  vorhabenKoerper as grKoerper,
  zufahrtPunkt,
  STICHTAGE,
  STICHTAG_NAME,
  VORHABEN_NAME,
  type BPlanTreffer,
  type GemeindeAbschnitt,
  type Pruefpunkt,
  type SchattenErgebnis,
  type Vorhaben as GVorhaben,
  type VorhabenArt,
  type VorhabenErgebnis,
  type ZufahrtErgebnis,
} from './rules';
import { ausTipp, dachWandText, wandLabelVon, beschreibung, fromRec, griffe, jeGrenze, KLASSE_TEXT, nachgezogen, neuesObjekt } from './site/bestand';
import type { TippAntwort } from './site/bestand';
import { DATA_ROOT, DATA_URL, inBbox, loadDetails, loadSite, near, type Data, type DemoAdresse } from './data';
import { cartesianToLocal, getOrigin, localToCartesian, localToLonLat, lonLatToLocal, setOrigin } from './scene/coords';
import { abgelaufen, dekodieren, kodieren, linkIdAus, neuerSchluessel, projektHash, VERSION, type Vorhaben } from './nachbar/link';
import { apiLernSpeicher, apiSpeicher, kachelAus, type LernAktion, type NachbarAntwort } from './speicher';
import { Terrain } from './scene/terrain';
import { createScene, type Scene } from './scene/viewer';
import { Renderer, type RenderState } from './scene/render';
import { assumedWindows, awayFromBoundary, ccw, classifyBuildings, initialObjects, isSimple, sidesFromBoundary, snap } from './site/plot';
import { bebauungsplaene, denkmaeler, searchAddress, wasserschutz, type Denkmal, type Place } from './ui/services';
import { VorhabenLayer, KEY_VORHABEN } from './scene/vorhaben';
import { rechne } from './scene/rechner';
import { gemeindeHtml, kennzahlenHtml, punkteHtml, rowsHtml, schattenHtml } from './ui/vorhabenSheet';
import { endOffline, localImagery, offlineMode, offlineStatus, prepareOffline, registerServiceWorker } from './offline';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ORDER: ObjectKind[] = ['gartenhaus', 'carport', 'waermepumpe'];
const WORD = { ok: 'passt', warn: 'knapp', bad: 'passt nicht' };
const TAG_CLASS: Record<string, string> = {
  rule: 'rule', berechnet: 'calc', Annahme: 'assume', offen: 'open', Demo: 'demo', amtlich: 'off', erkannt: 'det', nutzerbestätigt: 'user', 'erfasst per Tipp': 'user', geschätzt: 'assume', zertifiziert: 'off', Orientierung: 'orient',
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
  showAF: true,
  modus: 'objekt',
  pflanze: null,
  pflanzRes: null,
  ansicht: 'eigen',
  sichtbar: null,
  schatten: [],
  blick: null,
};
/** Reiter „Hecke, Baum“ (AGBGB Art. 47–52): Angaben je Grenzseite, Alter der Bestandspflanzen, Nachbarpflanzen. */
const pflSt: {
  angaben: SeitenAngabe[];
  alter: Record<string, Alter>;
  /** Bestandspflanze, deren Stamm gerade angetippt wird */
  stammTippen: string | null;
  zonen: boolean;
  /** erkannte Pflanzen jenseits der Grenze (nur für die Liste, nicht für die Grenzbebauung) */
  nachbar: BestandItem[];
  /** Reiter einmal geöffnet → im Prüfbericht */
  benutzt: boolean;
} = { angaben: [], alter: {}, stammTippen: null, zonen: true, nachbar: [], benutzt: false };
let pflanzLayer: import('./scene/zonen').ZonenLayer | null = null;
/** „Wo darf es hin?“: an/aus, letztes Ergebnis. Rechnet im Web Worker (lazy geladen). */
const zonenSt: { an: boolean; laeuft: boolean; erg: null | { beste: { p: Vec2; angle: number; farbe: number } | null; ms: number; msGesamt: number; pruefungen: number; k: ObjectKind } } = { an: false, laeuft: false, erg: null };
let zonenTimer: ReturnType<typeof setTimeout> | null = null;
let zonenLayer: import('./scene/zonen').ZonenLayer | null = null;

function zonenNeu(sofort = false) {
  if (!zonenSt.an || !site || !st.objs || st.selected === 'waermepumpe') return;
  if (zonenTimer) clearTimeout(zonenTimer);
  zonenTimer = setTimeout(async () => {
    const k = st.selected as 'gartenhaus' | 'carport';
    zonenSt.laeuft = true;
    const z = await import('./scene/zonen');
    zonenLayer ??= new z.ZonenLayer(scene.viewer);
    const r = await z.berechneZonen(site!, st.objs!, k);
    zonenSt.laeuft = false;
    if (!zonenSt.an || st.selected !== k) return;
    zonenLayer.zeige(r.feld, r.geo.nx, r.geo.ny, r.rect);
    zonenSt.erg = { beste: r.beste, ms: r.ms, msGesamt: r.msGesamt, pruefungen: r.pruefungen, k };
    zonenInfo();
    render();
  }, sofort ? 0 : 250);
}

function zonenAus() {
  zonenSt.an = false;
  zonenSt.erg = null;
  zonenLayer?.weg();
}

/** Text unter dem Knopf: Legende, beste Stelle mit Knopf „Hierhin setzen“. */
function zonenInfo() {
  const el = document.getElementById('zonenInfo');
  if (!el) return;
  const e = zonenSt.erg;
  if (!zonenSt.an) { el.innerHTML = ''; return; }
  if (!e || e.k !== st.selected) { el.innerHTML = '<p class="fine" style="text-align:left">Rechne …</p>'; return; }
  const o = st.objs![st.selected];
  const d = e.beste ? Math.hypot(e.beste.p[0] - o.center[0], e.beste.p[1] - o.center[1]) : 0;
  el.innerHTML = `<p class="fine" style="text-align:left"><span style="color:var(--ok)">■</span> passt so · <span style="color:var(--warn)">■</span> passt gedreht · <span style="color:var(--red)">■</span> geht nicht – für ${esc(NAMES[st.selected].art)} in der jetzigen Größe. ${tag('berechnet', 'berechnet')} <span style="opacity:.6">(${Math.round(e.msGesamt)} ms)</span></p>
    ${e.beste ? (d < 0.3 && e.beste.farbe === 1 ? '<p class="fine" style="text-align:left">Die jetzige Stelle passt.</p>' : `<p class="fine" style="text-align:left">Nächste passende Stelle: ${fmt(d, 1)} m entfernt${e.beste.farbe === 2 ? ', gedreht' : ''}. <button class="link" type="button" id="zonenHin">Hierhin setzen</button></p>`) : '<p class="fine" style="text-align:left">Auf diesem Grundstück passt es in dieser Größe nirgends. Mach es kleiner oder niedriger.</p>'}`;
  document.getElementById('zonenHin')?.addEventListener('click', () => {
    const b = zonenSt.erg?.beste;
    if (!b) return;
    const ob = st.objs![st.selected];
    ob.center = [b.p[0], b.p[1]];
    ob.angle = b.angle > Math.PI / 2 ? b.angle - Math.PI : b.angle;
    renderSheet();
  });
}

/** Grenzseite, für die gerade ein Objekt eingezeichnet wird (nur für den Hinweistext). */
let zeichnenSeite: number | null = null;
/** „Ein Tipp erfasst“: warten auf den Tipp → Dienst rechnet → Ergebnis prüfen (Klasse, Wandhöhe, Kanten). */
let tippSt: { phase: 'warten' | 'laeuft' | 'fertig'; antwort?: TippAntwort; id?: string; fehler?: string } | null = null;

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

let nachzeichnen = 0;
function render() {
  scene.viewer.scene.requestRender();
  // Bodenflächen (Abstandsflächen, Zonen) entstehen in Cesium asynchron: ein paar Bilder nachziehen,
  // sonst bleiben sie im requestRenderMode unsichtbar, bis sich die Kamera bewegt.
  if (!nachzeichnen) {
    nachzeichnen = 6;
    const tick = () => {
      scene.viewer.scene.requestRender();
      if (--nachzeichnen > 0) setTimeout(tick, 120);
    };
    setTimeout(tick, 120);
  } else nachzeichnen = 6;
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
  $('gbBtn').hidden = true;
  grLayer?.weg();
  if (st.modus === 'gross') st.modus = 'objekt';
  if (gbSt.an) void gartenblick(false);
  zonenAus();
  st.step = 'start';
  st.draft = [];
  scene.parzellar.show = false;
  const online = navigator.onLine && !new URLSearchParams(location.search).has('offline');
  const mess = data.site.mess;
  verdict(
    mess ? 'Mess-Adresse.' : 'Wo steht dein Haus?',
    msg ?? (mess ? 'Wähl die Mess-Adresse oder tipp auf das Grundstück in der Karte.' : online ? 'Such deine Adresse oder tipp auf dein Grundstück in der Karte.' : 'Ohne Internet gibt es keine Adresssuche. Tipp auf dein Grundstück oder wähl eine Demo-Adresse.'),
  );
  const demos = data.site.demos ?? [];
  // Mess-Adressen sind keine Demo: nur mit ?mess sichtbar, nie mit ?pitch (Vorführung), nie in den Demo-Adressen.
  const q = new URLSearchParams(location.search);
  const verweise = !mess && q.has('mess') && !q.has('pitch') ? data.site.messadressen ?? [] : [];
  const messHtml = mess
    ? `<div class="messbox" style="border:1px solid var(--line,#8886);border-radius:10px;padding:10px 12px;margin:12px 0;text-align:left">
        <strong>Mess-Adresse – keine Demo</strong>
        <p class="fine" style="margin:4px 0 8px">Hier werden Objekte vor Ort mit dem Maßband gemessen und mit der Tipp-Erfassung verglichen. Die Lage ist angenommen (Außenbereich), nicht amtlich geprüft.</p>
        <button type="button" id="messGo">${esc(mess.adresse)}</button></div>
        <p class="fine" style="text-align:left"><a href="${esc(gebietLink(null))}">Zurück zum Demo-Gebiet</a></p>`
    : verweise.length
      ? `<h3 style="font-size:14px;margin:16px 0 2px">Mess-Adressen <small class="fine">(nur zum Messen vor Ort, keine Demo)</small></h3><ul class="results">${verweise
          .map((v) => `<li><button type="button" data-gebiet="${esc(v.id)}"><strong>${esc(v.titel)}</strong><br>${esc(v.adresse)}</button></li>`)
          .join('')}</ul>`
      : '';
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
    ${messHtml}
    ${mess ? '' : demoHtml}
    <p class="fine">Daten liegen für ${esc(gebietGroesse())} in ${esc(data.site.gemeinde.name)} vor.${online ? ' Adresssuche: © OpenStreetMap-Mitwirkende (Nominatim).' : ''}</p>`;
  document.querySelectorAll<HTMLButtonElement>('[data-gebiet]').forEach((b) =>
    b.addEventListener('click', () => { location.href = gebietLink(b.dataset.gebiet!); }),
  );
  document.getElementById('messGo')?.addEventListener('click', () => {
    st.address = mess!.adresse;
    void goToPlot(mess!.start);
  });
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

/** Adresse der Seite für ein Gebiet (null = Demo-Gebiet); Parameter wie ?debug bleiben, ?mess/?gebiet werden ersetzt. */
function gebietLink(id: string | null): string {
  const u = new URL(location.href);
  u.hash = '';
  u.searchParams.delete('gebiet');
  u.searchParams.delete('mess');
  if (id) u.searchParams.set('gebiet', id);
  return u.pathname + u.search;
}

/** „2 × 2 km“ aus der Begrenzung des Gebiets */
function gebietGroesse(): string {
  const [x0, y0, x1, y1] = data.site.bbox;
  const km = (v: number) => String(Math.round(v / 100) / 10).replace('.', ',');
  return `${km(x1 - x0)} × ${km(y1 - y0)} km`;
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

/**
 * Tipp-Embeddings bei Bedarf: Der Tipp-Dienst rechnet im Hintergrund die Bildfenster für diesen Bereich plus 20 m Rand,
 * damit ein späterer Tipp nur noch den Prompt-Decoder braucht. Gesendet werden nur Umrisspunkte, keine Adresse.
 * Läuft der Dienst nicht, passiert nichts (der Tipp rechnet dann live).
 */
function tippVorbereiten(umriss: Vec2[]) {
  const o = getOrigin();
  void fetch('api/tipp/vorbereiten', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ umriss: umriss.map(([x, y]) => [x + o[0], y + o[1]]) }),
  }).catch(() => undefined);
}

async function goToPlot(p: Vec2) {
  if (!inBbox(data.site, p, 20)) {
    showStart(`Hier haben wir noch keine Daten. Das Gebiet deckt ${gebietGroesse()} rund um ${data.site.mess ? data.site.mess.adresse : 'die Altstadt'} ab.`);
    return;
  }
  // Grenze noch unbekannt: vorläufig Adresspunkt ± 30 m (typisches Grundstück); nach „Grenze bestätigen" das echte
  tippVorbereiten([[p[0] - 30, p[1] - 30], [p[0] + 30, p[1] + 30]]);
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
  zonenAus();
  const b = ccw(st.draft);
  if (b.length < 3) return;
  if (!isSimple(b)) return updateGrenzeUI('Die Grenzlinien kreuzen sich. Lösch den letzten Punkt und setz ihn neu.');
  const a = area(b);
  if (a < 40 || a > 8000) return updateGrenzeUI(`Die Fläche von ${fmt(a, 0)} m² wirkt nicht wie ein Wohngrundstück. Prüf die Punkte.`);
  st.plot = b;
  tippVorbereiten(b);
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
  pflSt.nachbar = near(data.bestand, c, 90)
    .filter((x) => (x.k === 'baum' || x.k === 'strauch' || x.k === 'hecke') && !pointInPolygon(centroid(x.fp), b) && polygonDistance(x.fp, b) <= 8)
    .map((x) => ({ ...fromRec(x), status: 'aktiv' as const }));
  pflSt.angaben = [];
  pflSt.alter = {};
  pflSt.stammTippen = null;
  pflSt.benutzt = false;
  st.pflanze = startPflanze(b);
  st.pflanzRes = null;
  st.modus = 'objekt';
  pflanzLayer?.weg();
  st.step = 'pruefen';
  st.view = '3d';
  void gartenblickPruefen();
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
  grLayer?.weg();
  Object.assign(grSt, { v: null, res: null, zufahrt: null, schatten: null, gemeinde: null, fragen: [], plaene: undefined, zonen: false, zonenErg: null, benutzt: false, offen: false });
  bebauungsplaene([c, ...b.slice(0, 7)]).then((pl) => {
    grSt.plaene = pl;
    if (st.step !== 'pruefen') return;
    buildSite();
    update();
    if (st.modus === 'gross') void grRechnen();
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
    bplan: bplanStatus(),
    aufenthaltsraum: st.aufenthaltsraum,
    feuerstaette: st.feuerstaette,
  };
}

/** Bebauungsplan laut Landesportal (nur Verweis): vorhanden, keiner im Portal oder unbekannt. */
function bplanStatus(): Site['bplan'] {
  const pl = grSt.plaene;
  if (!pl) return { status: 'unbekannt', provenance: 'offen' };
  const rk = pl.filter((x) => x.art === 'rechtskraft');
  if (!rk.length) return { status: 'keiner', provenance: 'amtlich', plaene: pl };
  return { status: 'vorhanden', name: rk[0].name, url: rk[0].planUrl, provenance: 'amtlich', plaene: pl };
}

function badSegments(): Set<number> {
  const s = new Set<number>();
  if (st.ansicht === 'nachbar') return s;
  if (st.res) for (const k of ['gartenhaus', 'carport'] as const) st.res[k].badSegments.forEach((i) => s.add(i));
  return s;
}

function update() {
  if (!site || !st.objs) return;
  st.res = evaluate(site, st.objs);
  st.pflanzRes = st.pflanze ? pruefePflanze(site, st.pflanze, pflSt.angaben) : null;
  zonenNeu();
  if (st.modus === 'gross') grNeu();
  renderer.updateDim();
  renderVerdict();
  render();
}

function renderVerdict() {
  if (st.ansicht === 'nachbar') return nachbarVerdict();
  const r = st.modus === 'pflanzen' && st.pflanzRes ? st.pflanzRes : st.res![st.selected];
  verdict(r.head, r.sub, r.status);
  document.querySelector('[data-modus="pflanzen"]')?.setAttribute('aria-selected', String(st.modus === 'pflanzen'));
  const pd = document.querySelector('[data-modus="pflanzen"] .d');
  if (pd && st.pflanzRes) pd.className = `d ${st.pflanzRes.status}`;
  ORDER.forEach((k) => {
    const b = document.querySelector<HTMLButtonElement>(`[data-obj="${k}"]`);
    if (!b) return;
    b.setAttribute('aria-selected', String(st.modus === 'objekt' && k === st.selected));
    b.querySelector('.d')!.className = `d ${st.res![k].status}`;
    b.setAttribute('aria-label', `${tabName(k)}, ${WORD[st.res![k].status]}`);
  });
  const rows = document.getElementById('rows');
  if (rows) rows.innerHTML = r.rows.map((x) => `<li><span>${esc(x.text)}</span>${tag(x.tag, x.kind)}</li>`).join('');
  document.querySelectorAll<HTMLOutputElement>('#controls output').forEach((out) => (out.textContent = valText(out.dataset.k!)));
  if (st.modus === 'pflanzen') pflanzInfo();
  document.querySelector('[data-modus="gross"]')?.setAttribute('aria-selected', String(st.modus === 'gross'));
  if (st.modus === 'gross') grVerdict();
}

const CTL: Record<ObjectKind, { k: keyof Placed | 'deg'; l: string; min: number; max: number; step: number }[]> = {
  gartenhaus: [
    { k: 'w', l: 'Breite', min: 2, max: 6, step: 0.1 },
    { k: 'd', l: 'Tiefe', min: 2, max: 6, step: 0.1 },
    { k: 'h', l: 'Wandhöhe bis Traufe', min: 2, max: 3.6, step: 0.05 },
    { k: 'neigung', l: 'Dachneigung (0 = Flachdach)', min: 0, max: 60, step: 1 },
    { k: 'deg', l: 'Drehung', min: -90, max: 90, step: 1 },
  ],
  carport: [
    { k: 'w', l: 'Breite', min: 2.5, max: 6.5, step: 0.1 },
    { k: 'd', l: 'Länge', min: 4, max: 9, step: 0.1 },
    { k: 'h', l: 'Höhe', min: 2.2, max: 3.4, step: 0.05 },
    { k: 'deg', l: 'Drehung', min: -90, max: 90, step: 1 },
  ],
  waermepumpe: [
    { k: 'lw', l: 'Schallleistung laut Datenblatt der Außeneinheit', min: 40, max: 75, step: 1 },
    { k: 'deg', l: 'Drehung', min: -90, max: 90, step: 1 },
  ],
};

function valText(k: string) {
  const o = st.objs![st.selected];
  if (k === 'lw') return `${Math.round(o.lw ?? standardLw(geraeteKlasse(o)))} dB(A)`;
  if (k === 'deg') return `${Math.round(CMath.toDegrees(o.angle))}°`;
  if (k === 'neigung') return (o.neigung ?? 0) > 0 ? `${Math.round(o.neigung!)}° · First ${fmt(o.h + dachHoehe(o), 2)} m` : 'Flachdach';
  return `${fmt(o[k as 'w'] as number, k === 'h' ? 2 : 1)} m`;
}

function select(k: ObjectKind) {
  grAus();
  st.selected = k;
  if (st.modus === 'pflanzen') {
    st.modus = 'objekt';
    pflanzLayer?.weg();
    pflSt.stammTippen = null;
  }
  if (k === 'waermepumpe') zonenAus();
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
      const v = s.k === 'deg' ? Math.round(CMath.toDegrees(o.angle)) : ((o[s.k] as number | undefined) ?? 0);
      return `<div class="ctl"><label for="s${i}"><span>${s.l}</span><output data-k="${s.k}" for="s${i}"></output></label><input id="s${i}" type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" data-k="${s.k}"></div>`;
    })
    .join('');
  if (st.ansicht === 'nachbar') return nbSt.v ? renderNachbarSheet() : undefined;
  if (st.kante || st.zeichnen || tippSt) return renderEditSheet();
  if (st.modus === 'pflanzen') return renderPflanzenSheet();
  if (st.modus === 'gross') return renderGrossSheet();
  const bestHtml = bestandHtml();
  const wins = st.windows;
  $('stepBody').innerHTML = `
    <div class="objects" role="tablist" aria-label="Was willst du hinstellen?">
      ${tabsHtml()}
    </div>
    ${st.selected === 'waermepumpe' ? geraetHtml(o) : ''}
    <div class="controls" id="controls">${ctl}</div>
    <div class="btnrow"><button class="sec" id="arBtn" type="button">In AR ansehen (1:1)</button></div>
    ${st.denkmal?.length ? `<p class="warnbox">Denkmalschutz: ${st.denkmal.map((d) => `${esc(d.art)}${d.bezeichnung ? ` „${esc(d.bezeichnung)}“` : ''} (${esc(d.aktennummer)})`).join('; ')}. Hier kann auch ein kleines Nebengebäude oder eine Wärmepumpe eine denkmalrechtliche Erlaubnis brauchen (Art. 6 BayDSchG). ${tag('amtlich', 'amtlich')} <span class="attr">© BLfD</span></p>` : ''}
    ${st.wsg?.length ? `<p class="warnbox">Das Grundstück liegt in einem Trinkwasserschutzgebiet (${esc(st.wsg.join(', '))}). Dort gelten eigene Auflagen. ${tag('amtlich', 'amtlich')}</p>` : ''}
    <details ${st.bestand.length ? 'open' : ''} id="bestandBox">
      <summary>Steht hier schon etwas?</summary>
      ${bestHtml}
    </details>
    ${st.selected !== 'waermepumpe' ? `<div class="btnrow" style="margin-top:10px"><button class="sec" id="zonenBtn" type="button" aria-pressed="${zonenSt.an}">${zonenSt.an ? 'Zonen ausblenden' : 'Wo darf es hin?'}</button></div><div id="zonenInfo"></div>
    <label class="fine" style="display:flex;gap:8px;align-items:center;text-align:left;margin:8px 0"><input type="checkbox" id="afBox" ${st.showAF ? 'checked' : ''}> Abstandsflächen am Boden zeigen (BayBO Art. 6)</label>` : ''}
    <details open>
      <summary>So haben wir geprüft</summary>
      <ul class="rows" id="rows"></ul>
    </details>
    <details>
      <summary>Deine Angaben und Annahmen</summary>
      <div class="field"><span>Gebiet ${tag(st.gebiet.provenance, st.gebiet.provenance)}</span>${sel('fGebiet', st.gebiet.value, [['rein', GEBIET_TEXT.rein], ['allgemein', GEBIET_TEXT.allgemein], ['misch', GEBIET_TEXT.misch]])}</div>
      <div class="field"><span>Lage ${tag(st.bereich.provenance, st.bereich.provenance)}</span>${sel('fBereich', st.bereich.value, [['innen', 'im Ort (Innenbereich)'], ['aussen', 'außerhalb (Außenbereich)']])}</div>
      ${data.site.lage && st.bereich.provenance === 'Annahme' ? `<p class="fine" style="text-align:left;margin:-4px 0 8px">${esc(data.site.lage.grund)} Im Außenbereich gilt Art. 57 enger: Gebäude nur bis ${LIMITS.gartenhaus.aussenbereichMaxM3.wert} m³ und ohne Aufenthaltsraum, Toilette, Feuerstätte; Garagen und Carports sind dort nicht freigestellt.</p>` : ''}
      <div class="field"><span>Gartenhaus mit Aufenthaltsraum ${tag(st.aufenthaltsraum.provenance, st.aufenthaltsraum.provenance)}</span>${sel('fAuf', st.aufenthaltsraum.value ? 'ja' : 'nein', [['nein', 'nein'], ['ja', 'ja']])}</div>
      <div class="field"><span>Gartenhaus mit Ofen ${tag(st.feuerstaette.provenance, st.feuerstaette.provenance)}</span>${sel('fOfen', st.feuerstaette.value ? 'ja' : 'nein', [['nein', 'nein'], ['ja', 'ja']])}</div>
      <div class="field"><span>Nachbarfenster</span><span>${wins.filter((w) => w.provenance !== 'Annahme').length} gesetzt, ${wins.filter((w) => w.provenance === 'Annahme').length} angenommen</span></div>
      <div class="field"><span>Bebauungsplan ${tag('offen', 'offen')}</span>${data.site.gemeinde.bauleitplanung_url ? `<a href="${esc(data.site.gemeinde.bauleitplanung_url)}" target="_blank" rel="noopener">Pläne der Stadt</a>` : 'unbekannt'}</div>
      <div class="field"><span>Trinkwasserschutzgebiet ${st.wsg == null ? tag('offen', 'offen') : tag('amtlich', 'amtlich')}</span><span>${st.wsg === undefined ? 'wird abgefragt …' : st.wsg === null ? 'nicht abfragbar' : st.wsg.length ? 'ja' : 'nein'}</span></div>
      <div class="field"><span>Denkmal ${st.denkmal == null ? tag('offen', 'offen') : tag('amtlich', 'amtlich')}</span><span>${st.denkmal === undefined ? 'wird abgefragt …' : st.denkmal === null ? 'nicht abfragbar' : st.denkmal.length ? 'ja, siehe Hinweis' : 'nein'} · <a href="https://geoportal.bayern.de/denkmalatlas/" target="_blank" rel="noopener">Denkmal-Atlas</a></span></div>
    </details>
    <div class="btnrow">
      <button class="primary" id="reportBtn" type="button" aria-haspopup="dialog">Prüfbericht ansehen</button>
      ${st.selected !== 'waermepumpe' ? `<button class="sec" id="antragBtn" type="button" aria-haspopup="dialog">${st.res?.[st.selected].status === 'bad' ? 'Was jetzt? Antrag vorbereiten' : 'Antrag-Paket'}</button>` : ''}
      <button class="sec" id="teilenBtn" type="button" aria-haspopup="dialog">Nachbarn fragen</button>
      <button class="sec" id="editBtn" type="button">Grenze ändern</button>
      <button class="sec" id="newBtn" type="button">Andere Adresse</button>
    </div>`;

  bindTabs();
  document.querySelectorAll<HTMLInputElement>('#controls input').forEach((inp) =>
    inp.addEventListener('input', () => {
      const ob = st.objs![st.selected];
      const v = parseFloat(inp.value);
      if (inp.dataset.k === 'deg') ob.angle = CMath.toRadians(v);
      else (ob as unknown as Record<string, number>)[inp.dataset.k!] = v;
      if (inp.dataset.k === 'lw') {
        const warGeraet = !!ob.geraet;
        ob.geraet = undefined; // eigener Wert statt Gerät aus der Datenbank
        ob.lwVomNutzer = true; // Label nutzerbestätigt
        if (warGeraet) {
          renderSheet();
          return;
        }
      }
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
      lernBeitrag('bestaetigt', it);
      afterContextChange();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-bno]').forEach((b) =>
    b.addEventListener('click', () => {
      const it = st.bestand.find((x) => x.id === b.dataset.bno)!;
      it.status = 'entfernt';
      lernBeitrag('verworfen', it);
      afterContextChange();
    }),
  );
  document.getElementById('lernBox')?.addEventListener('change', (e) => setLernEinwilligung((e.target as HTMLInputElement).checked));
  document.getElementById('lernInfo')?.addEventListener('click', openLernInfo);
  document.querySelectorAll<HTMLButtonElement>('[data-kante]').forEach((b) =>
    b.addEventListener('click', () => {
      const it = st.bestand.find((x) => x.id === b.dataset.kante)!;
      st.kante = { id: it.id, fp: griffe(it), ref: it.footprint };
      startEdit();
    }),
  );
  document.getElementById('tippBtn')?.addEventListener('click', () => {
    tippSt = { phase: 'warten' };
    startEdit();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-neu]').forEach((b) =>
    b.addEventListener('click', () => {
      st.zeichnen = [];
      zeichnenSeite = b.dataset.neu === '' ? null : Number(b.dataset.neu);
      startEdit();
    }),
  );
  document.getElementById('zonenBtn')?.addEventListener('click', () => {
    if (zonenSt.an) zonenAus();
    else { zonenSt.an = true; zonenSt.erg = null; zonenNeu(true); }
    renderSheet();
  });
  zonenInfo();
  geraetSuche();
  document.getElementById('afBox')?.addEventListener('change', (e) => {
    st.showAF = (e.target as HTMLInputElement).checked;
    render();
  });
  $('reportBtn').addEventListener('click', openReport);
  $('teilenBtn').addEventListener('click', openTeilen);
  $('arBtn').addEventListener('click', startAr);
  document.getElementById('antragBtn')?.addEventListener('click', openAntrag);
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

/* ---------- Großes Vorhaben (AUFTRAG_V3 Phase B): zweites Wohnhaus, Anbau, Aufstockung ---------- */
const GR_ART: [VorhabenArt, string][] = [['wohnhaus', 'Zweites Wohnhaus'], ['anbau', 'Anbau'], ['aufstockung', 'Aufstockung']];
const grSt: {
  v: GVorhaben | null;
  res: VorhabenErgebnis | null;
  zufahrt: ZufahrtErgebnis | null;
  /** Zufahrt und Schatten werden nach dem Ziehen neu gerechnet */
  offen: boolean;
  schatten: SchattenErgebnis | null;
  gemeinde: GemeindeAbschnitt | null;
  fragen: string[];
  /** Bebauungspläne laut Landesportal; undefined = wird abgefragt, null = nicht erreichbar */
  plaene: BPlanTreffer[] | null | undefined;
  zonen: boolean;
  zonenErg: null | { beste: { p: Vec2; angle: number; farbe: number } | null; msGesamt: number };
  benutzt: boolean;
  ms: { zufahrt: number; schatten: number };
} = { v: null, res: null, zufahrt: null, offen: false, schatten: null, gemeinde: null, fragen: [], plaene: undefined, zonen: false, zonenErg: null, benutzt: false, ms: { zufahrt: 0, schatten: 0 } };
let grLayer: VorhabenLayer | null = null;
let grTimer: ReturnType<typeof setTimeout> | null = null;
let grZonenTimer: ReturnType<typeof setTimeout> | null = null;
const grStrassen = (): Vec2[][] => data.strassen ?? [];
const RICHTUNG8 = ['Osten', 'Nordosten', 'Norden', 'Nordwesten', 'Westen', 'Südwesten', 'Süden', 'Südosten'];
const richtungVon = (n: Vec2) => RICHTUNG8[Math.floor((((Math.atan2(n[1], n[0]) * 180) / Math.PI + 360 + 22.5) % 360) / 45)];

function grStart() {
  if (!site) return;
  st.modus = 'gross';
  grSt.benutzt = true;
  zonenAus();
  pflanzLayer?.weg();
  pflSt.stammTippen = null;
  grSt.v ??= vorhabenStart(site, neuesVorhaben('wohnhaus', site));
  grSt.zufahrt = null;
  grSt.schatten = null;
  grSt.res = null;
  renderSheet();
  hint(st.hasDragged ? null : grSt.v.art === 'aufstockung' ? 'Wähl das Haus, das du aufstocken willst.' : 'Zieh das Haus an eine andere Stelle.');
}

function grAus() {
  if (st.modus !== 'gross') return;
  st.modus = 'objekt';
  grLayer?.weg();
  grSt.zonen = false;
  grSt.zonenErg = null;
  if (grZonenTimer) clearTimeout(grZonenTimer);
  zonenLayer?.weg();
}

function grArt(art: VorhabenArt) {
  if (!site) return;
  const alt = grSt.v;
  grSt.v = art === 'wohnhaus' ? vorhabenStart(site, neuesVorhaben(art, site)) : neuesVorhaben(art, site);
  if (alt) grSt.v.geschosshoehe = alt.geschosshoehe;
  grSt.zufahrt = null;
  grSt.schatten = null;
  grSt.zonen = false;
  zonenLayer?.weg();
  renderSheet();
}

/** Wo steht das Vorhaben? Mitte des Grundrisses (für Umfeld, Kamera). */
function grMitte(): Vec2 {
  const g = grSt.res?.grundriss;
  return g ? centroid(g.fp) : centroid(st.plot!);
}

function grBewerten() {
  if (!site || !grSt.v) return;
  const z: Pruefpunkt = grSt.zufahrt && !grSt.offen
    ? zufahrtPunkt(grSt.zufahrt)
    : { id: 'zufahrt', name: 'Zufahrt', status: null, text: 'Wird neu berechnet …' };
  grSt.res = bewerteVorhaben(site, grSt.v, z, grStrassen());
}

/** Nach jeder Änderung: sofort prüfen und zeichnen; Zufahrt, Schatten und Planungsrecht verzögert (nach dem Ziehen). */
function grNeu() {
  if (!site || !grSt.v || st.modus !== 'gross' || st.ansicht === 'nachbar') return;
  grSt.offen = true;
  grBewerten();
  grZeichnen();
  grVerdict();
  grInfo();
  if (grSt.zonen) grZonenNeu();
  if (grTimer) clearTimeout(grTimer);
  grTimer = setTimeout(() => void grRechnen(), 350);
}

/** Laufnummer: nur das Ergebnis der letzten Rechnung zählt. */
let grSeq = 0;
/** Straßen im Umkreis des Grundstücks (weniger Daten für den Worker). */
function grStrassenNah(): Vec2[][] {
  if (!st.plot) return [];
  const c = centroid(st.plot);
  const r = Math.max(...st.plot.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) + 300;
  return grStrassen().filter((s) => s.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < r));
}

/** Zufahrt und Schatten rechnet der Hintergrund-Worker; die Oberfläche bleibt bedienbar. */
async function grRechnen() {
  if (!site || !grSt.v || !grSt.res || st.modus !== 'gross' || st.ansicht === 'nachbar') return;
  const v = { ...grSt.v };
  const res = grSt.res;
  const id = ++grSeq;
  grSt.offen = true;
  const { ground: _g, ...ohne } = site;
  void _g;
  const [z, sch] = await Promise.all([
    rechne({ art: 'zufahrt', e: { site: ohne, ziel: res.grundriss.fp, ausgenommen: v.art === 'aufstockung' && v.zielId ? [v.zielId] : [], bruestung: res.kennzahlen.bruestung, strassen: grStrassenNah() } }),
    rechne({ art: 'schatten', site: ohne, v, lage: geoLage() }),
  ]);
  if (id !== grSeq || st.modus !== 'gross' || !grSt.v || !site) return; // inzwischen neu verschoben oder Reiter gewechselt
  if (z?.art === 'zufahrt') { grSt.zufahrt = z.zufahrt; grSt.ms.zufahrt = z.ms; }
  if (sch?.art === 'schatten') { grSt.schatten = sch.schatten; grSt.ms.schatten = sch.ms; }
  const umfeld = umfeldStatistik(site, grMitte(), grStrassen());
  grSt.gemeinde = gemeindeAbschnitt(site, v.art, umfeld, grSt.plaene, data.site.gemeinde.name);
  grSt.fragen = fragenAnGemeinde(v.art, site, grSt.plaene, umfeld, (grSt.res?.af.ausserhalbM2 ?? 0) > 0.05);
  grSt.offen = false;
  grBewerten();
  grZeichnen();
  grVerdict();
  grInfo();
}

function grZeichnen() {
  if (!site || !grSt.v || !grSt.res) return;
  grLayer ??= new VorhabenLayer(scene.viewer);
  const v = grSt.v;
  const g = grSt.res.grundriss;
  const ground = (p: Vec2) => terrain.heightOrCoarse(p);
  const base = v.art === 'aufstockung' ? Math.min(...g.fp.map(ground)) : v.baseElevation ?? Math.max(...g.fp.map(ground));
  const r = grSt.res;
  grLayer.zeige({
    flaechen: vorhabenModell(v, g, base),
    af: r.af.waende.map((w) => w.flaeche),
    afSchlecht: r.punkte.some((p) => (p.id === 'grenze' || p.id === 'abstandsflaechen') && p.status === 'bad'),
    status: st.ansicht === 'nachbar' ? null : r.status,
    zufahrt: grSt.offen ? null : grSt.zufahrt,
    showAF: st.showAF,
    dark: st.dark,
    mesh: st.mesh,
  });
  render();
}

function grVerdict() {
  if (st.ansicht === 'nachbar') return;
  const r = grSt.res;
  if (!r) return verdict('Wähl ein Gebäude.', 'Dann prüft Passt. das Vorhaben.');
  verdict(r.head, r.sub, r.status ?? 'none');
  const d = document.querySelector('[data-modus="gross"] .d');
  if (d) d.className = `d ${r.status ?? ''}`;
}

function grWandOptionen(v: GVorhaben): [string, string][] {
  const host = st.buildings.find((b) => b.id === v.hostId);
  if (!host) return [];
  const ccw = signedArea(host.footprint) > 0;
  return edges(host.footprint).map(([a, b], i) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n: Vec2 = ccw ? [(b[1] - a[1]) / l, -(b[0] - a[0]) / l] : [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    return [String(i), `Wand nach ${richtungVon(n)} (${fmt(l, 1)} m)`] as [string, string];
  }).filter((_, i) => {
    const [a, b] = edges(host.footprint)[i];
    return Math.hypot(b[0] - a[0], b[1] - a[1]) > 1.5;
  });
}

interface GrCtl { k: string; l: string; min: number; max: number; step: number }
function grRegler(v: GVorhaben): GrCtl[] {
  const dach: GrCtl[] = v.dachform === 'flach' ? [] : [{ k: 'neigung', l: 'Dachneigung', min: 5, max: 60, step: 1 }];
  if (v.art === 'aufstockung') return [
    { k: 'geschosse', l: 'Zusätzliche Geschosse', min: 1, max: 2, step: 1 },
    { k: 'geschosshoehe', l: 'Geschosshöhe', min: 2.4, max: 3.4, step: 0.05 },
  ];
  if (v.art === 'anbau') return [
    { k: 'w', l: 'Länge entlang der Hauswand', min: 2, max: 14, step: 0.1 },
    { k: 'd', l: 'Tiefe', min: 2, max: 10, step: 0.1 },
    { k: 'versatz', l: 'Verschiebung entlang der Wand', min: -12, max: 12, step: 0.1 },
    { k: 'geschosse', l: 'Geschosse', min: 1, max: 3, step: 1 },
    { k: 'geschosshoehe', l: 'Geschosshöhe', min: 2.4, max: 3.4, step: 0.05 },
    ...dach,
  ];
  return [
    { k: 'w', l: 'Breite', min: 4, max: 20, step: 0.1 },
    { k: 'd', l: 'Tiefe', min: 4, max: 20, step: 0.1 },
    { k: 'geschosse', l: 'Geschosse', min: 1, max: 4, step: 1 },
    { k: 'geschosshoehe', l: 'Geschosshöhe', min: 2.4, max: 3.4, step: 0.05 },
    ...dach,
    { k: 'deg', l: 'Drehung', min: -90, max: 90, step: 1 },
  ];
}

function grWert(v: GVorhaben, k: string): number {
  if (k === 'deg') return Math.round(CMath.toDegrees(v.angle));
  return (v[k as 'w'] as number | undefined) ?? 0;
}
function grText(v: GVorhaben, k: string): string {
  const x = grWert(v, k);
  if (k === 'deg') return `${x}°`;
  if (k === 'neigung') return `${Math.round(x)}°`;
  if (k === 'geschosse') return `${x}`;
  return `${fmt(x, k === 'geschosshoehe' ? 2 : 1)} m`;
}

function renderGrossSheet() {
  if (!site || !grSt.v) return;
  const v = grSt.v;
  const eigene = eigeneGebaeude(site);
  const ctl = grRegler(v).map((s, i) => `<div class="ctl"><label for="g${i}"><span>${s.l}</span><output data-gk="${s.k}" for="g${i}">${grText(v, s.k)}</output></label><input id="g${i}" type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${grWert(v, s.k)}" data-gk="${s.k}"></div>`).join('');
  const gebTxt = (b: Building) => `Haus ${fmt(area(b.footprint), 0)} m²${b.trauf != null ? `, Traufe ${fmt(b.trauf, 1)} m` : ''}`;
  const hostSel = v.art === 'anbau' || v.art === 'aufstockung'
    ? eigene.length
      ? `<div class="field"><span>${v.art === 'anbau' ? 'Woran bauen?' : 'Welches Haus?'} ${tag('amtlich', 'amtlich')}</span>${sel('gHost', (v.art === 'anbau' ? v.hostId : v.zielId) ?? eigene[0].id, eigene.map((b) => [b.id, gebTxt(b)] as [string, string]))}</div>`
      : '<p class="warnbox">Auf deinem Grundstück ist kein Haus in den Daten. Anbau und Aufstockung brauchen eines.</p>'
    : '';
  const wandSel = v.art === 'anbau' ? `<div class="field"><span>An welcher Wand?</span>${sel('gWand', String(v.hostKante ?? 0), grWandOptionen(v))}</div>` : '';
  const dachSel = v.art !== 'aufstockung'
    ? `<div class="field"><span>Dach ${tag('Annahme', 'Annahme')}</span>${sel('gDach', v.dachform, [['sattel', 'Satteldach'], ['pult', 'Pultdach'], ['flach', 'Flachdach']])}</div>
       ${v.art === 'anbau' && v.dachform === 'sattel' ? `<label class="fine" style="display:flex;gap:8px;align-items:center;text-align:left;margin:4px 0"><input type="checkbox" id="gQuer" ${v.firstQuer ? 'checked' : ''}> First quer zur Hauswand</label>` : ''}`
    : '<p class="fine" style="text-align:left">Das Dach wird nicht verändert. Passt. kennt von deinem Haus nur Trauf- und Firsthöhe (LoD2) und rechnet mit einer Neigung bis 70°.</p>';
  $('stepBody').innerHTML = `
    <div class="objects" role="tablist" aria-label="Was willst du hinstellen?">${tabsHtml()}</div>
    <p class="fine" style="text-align:left;margin:4px 0 8px">Großes Vorhaben: Ob gebaut werden darf, entscheidet die Gemeinde. Passt. prüft nur, was sich messen lässt, und zeigt, was die Gemeinde klärt.</p>
    <div class="objects" role="group" aria-label="Was baust du?">${GR_ART.map(([a, n]) => `<button class="obj" type="button" data-gart="${a}" aria-selected="${v.art === a}">${n}</button>`).join('')}</div>
    ${hostSel}${wandSel}${dachSel}
    <div class="controls" id="grControls">${ctl}</div>
    ${v.art === 'wohnhaus' ? `<label class="fine" style="display:flex;gap:8px;align-items:center;text-align:left;margin:8px 0"><input type="checkbox" id="gZonen" ${grSt.zonen ? 'checked' : ''}> Wo darf das Haus hin? Zonen zeigen</label><div id="gZonenInfo"></div>` : ''}
    <div id="grInfo"></div>`;
  bindTabs();
  document.querySelectorAll<HTMLButtonElement>('[data-gart]').forEach((b) => b.addEventListener('click', () => grArt(b.dataset.gart as VorhabenArt)));
  document.querySelectorAll<HTMLInputElement>('#grControls input').forEach((inp) =>
    inp.addEventListener('input', () => {
      const x = parseFloat(inp.value);
      const k = inp.dataset.gk!;
      if (k === 'deg') v.angle = CMath.toRadians(x);
      else (v as unknown as Record<string, number>)[k] = k === 'geschosse' ? Math.round(x) : x;
      inp.parentElement!.querySelector('output')!.textContent = grText(v, k);
      grNeu();
    }),
  );
  document.getElementById('gHost')?.addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value;
    if (v.art === 'anbau') { v.hostId = id; v.hostKante = 0; v.versatz = 0; const n = grWandOptionen(v); if (n.length) v.hostKante = Number(n[0][0]); }
    else v.zielId = id;
    grSt.zufahrt = null;
    renderSheet();
  });
  document.getElementById('gWand')?.addEventListener('change', (e) => { v.hostKante = Number((e.target as HTMLSelectElement).value); v.versatz = 0; renderSheet(); });
  document.getElementById('gDach')?.addEventListener('change', (e) => { v.dachform = (e.target as HTMLSelectElement).value as GVorhaben['dachform']; renderSheet(); });
  document.getElementById('gQuer')?.addEventListener('change', (e) => { v.firstQuer = (e.target as HTMLInputElement).checked; grNeu(); });
  document.getElementById('gZonen')?.addEventListener('change', (e) => {
    grSt.zonen = (e.target as HTMLInputElement).checked;
    if (grSt.zonen) grZonenNeu(); else { zonenLayer?.weg(); grSt.zonenErg = null; grZonenInfo(); }
  });
  grNeu();
}

function grInfo() {
  const el = document.getElementById('grInfo');
  const r = grSt.res;
  if (!el) return;
  if (!r || !grSt.v) { el.innerHTML = ''; return; }
  const v = grSt.v;
  el.innerHTML = `
    ${punkteHtml(r.punkte, tag)}
    ${kennzahlenHtml(r.kennzahlen, v.art, tag)}
    <details open><summary>So haben wir geprüft</summary><ul class="rows">${rowsHtml([...r.rows, ...(grSt.zufahrt && !grSt.offen ? grSt.zufahrt.rows : [])], tag)}</ul></details>
    <details open><summary>Schatten auf die Nachbarn</summary>${schattenHtml(grSt.schatten, grSt.offen, tag)}</details>
    ${grSt.gemeinde ? gemeindeHtml(grSt.gemeinde, tag) : '<p class="fine" style="text-align:left">Planungsrecht wird zusammengestellt …</p>'}
    <p class="fine" style="text-align:left">Orientierung, keine Genehmigung. Verbindlich entscheidet die Gemeinde bzw. das Bauamt. ${LIMITS.geprueft ? '' : 'Die Grenzwerte sind noch nicht von einer Fachperson geprüft.'}</p>
    <div class="btnrow">
      <button class="primary" id="grVoranfrage" type="button" aria-haspopup="dialog">Bauvoranfrage vorbereiten</button>
      <button class="sec" id="grTeilen" type="button" aria-haspopup="dialog">Nachbarn fragen</button>
      <button class="sec" id="grReport" type="button" aria-haspopup="dialog">Prüfbericht ansehen</button>
    </div>`;
  document.getElementById('grVoranfrage')?.addEventListener('click', () => void openVoranfrage());
  document.getElementById('grTeilen')?.addEventListener('click', openTeilen);
  document.getElementById('grReport')?.addEventListener('click', openReport);
  grZonenInfo();
}

/* ----- Zonen „Wo darf das Haus hin?“ ----- */
function grZonenNeu() {
  if (!site || !st.objs || !grSt.v || grSt.v.art !== 'wohnhaus' || !grSt.zonen) return;
  if (grZonenTimer) clearTimeout(grZonenTimer);
  grZonenTimer = setTimeout(async () => {
    const z = await import('./scene/zonen');
    zonenLayer ??= new z.ZonenLayer(scene.viewer);
    const vv = grSt.v;
    if (!vv || !site) return;
    const r = await z.berechneZonen(site, st.objs!, 'vorhaben', { ...vv });
    if (!grSt.zonen || st.modus !== 'gross') return;
    zonenLayer.zeige(r.feld, r.geo.nx, r.geo.ny, r.rect);
    grSt.zonenErg = { beste: r.beste, msGesamt: r.msGesamt };
    grZonenInfo();
    render();
  }, 250);
}

function grZonenInfo() {
  const el = document.getElementById('gZonenInfo');
  if (!el) return;
  if (!grSt.zonen) { el.innerHTML = ''; return; }
  const e = grSt.zonenErg;
  if (!e) { el.innerHTML = '<p class="fine" style="text-align:left">Rechne …</p>'; return; }
  const v = grSt.v!;
  const d = e.beste ? Math.hypot(e.beste.p[0] - v.center[0], e.beste.p[1] - v.center[1]) : 0;
  el.innerHTML = `<p class="fine" style="text-align:left"><span style="color:var(--ok)">■</span> passt so · <span style="color:var(--warn)">■</span> passt gedreht · <span style="color:var(--red)">■</span> geht nicht – für das ganze Haus in der jetzigen Größe (Abstandsflächen, Grenze, Kollisionen; ohne Zufahrt). ${tag('berechnet', 'berechnet')} <span style="opacity:.6">(${Math.round(e.msGesamt)} ms)</span></p>
    ${e.beste ? (d < 0.3 && e.beste.farbe === 1 ? '<p class="fine" style="text-align:left">Die jetzige Stelle passt.</p>' : `<p class="fine" style="text-align:left">Nächste passende Stelle: ${fmt(d, 1)} m entfernt${e.beste.farbe === 2 ? ', gedreht' : ''}. <button class="link" type="button" id="gHin">Hierhin setzen</button></p>`) : '<p class="fine" style="text-align:left">Auf diesem Grundstück passt das Haus in dieser Größe nirgends. Mach es kleiner oder niedriger.</p>'}`;
  document.getElementById('gHin')?.addEventListener('click', () => {
    const b = grSt.zonenErg?.beste;
    if (!b || !grSt.v) return;
    grSt.v.center = [b.p[0], b.p[1]];
    grSt.v.angle = b.angle > Math.PI / 2 ? b.angle - Math.PI : b.angle;
    renderSheet();
  });
}

/** Ziehen des Hauses (Wohnhaus: Mitte; Anbau: Wand und Versatz). */
function grZiehen(g: Vec2, off: Vec2) {
  const v = grSt.v;
  if (!v || !site) return;
  if (v.art === 'wohnhaus') {
    v.center = [Math.round((g[0] + off[0]) * 20) / 20, Math.round((g[1] + off[1]) * 20) / 20];
  } else if (v.art === 'anbau') {
    const host = st.buildings.find((b) => b.id === v.hostId);
    if (!host) return;
    let best = { d: Infinity, i: 0, t: 0, len: 1 };
    edges(host.footprint).forEach(([a, b], i) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1.5) return;
      const r = pointSegment(g, a, b);
      if (r.d < best.d) best = { d: r.d, i, t: Math.hypot(r.q[0] - a[0], r.q[1] - a[1]), len };
    });
    if (best.d === Infinity) return;
    const wechsel = best.i !== v.hostKante;
    v.hostKante = best.i;
    const platz = Math.max(0, best.len / 2 - v.w / 2);
    v.versatz = Math.max(-platz, Math.min(platz, Math.round((best.t - best.len / 2) * 20) / 20));
    if (wechsel) {
      const regler = document.querySelector<HTMLSelectElement>('#gWand');
      if (regler) regler.value = String(best.i);
    }
  } else return;
  const vs = document.querySelector<HTMLInputElement>('#grControls input[data-gk="versatz"]');
  if (vs) { vs.value = String(v.versatz ?? 0); vs.parentElement!.querySelector('output')!.textContent = grText(v, 'versatz'); }
  grNeu();
}

/* ----- Bauvoranfrage ----- */
async function openVoranfrage() {
  if (!site || !grSt.v || !grSt.res) return;
  if (grSt.offen) await grRechnen();
  const res = grSt.res;
  const vf = await import('./antrag/voranfrage');
  const gem = grSt.gemeinde ?? gemeindeAbschnitt(site, grSt.v.art, null, grSt.plaene, data.site.gemeinde.name);
  const p = vf.voranfrageBauen({
    site, v: grSt.v, res, zufahrt: grSt.zufahrt, schatten: grSt.schatten, gemeinde: gem,
    fragen: grSt.fragen.length ? grSt.fragen : fragenAnGemeinde(grSt.v.art, site, grSt.plaene, null, res.af.ausserhalbM2 > 0.05),
    bestand: st.bestand.filter((b) => b.status === 'aktiv'), ursprung: getOrigin(), adresse: st.address, erstellt: new Date(), links: ANTRAG_LINKS, version: APP_VERSION,
  });
  openModal('Bauvoranfrage vorbereiten', `
    <p class="warnbox">${esc(vf.HINWEIS_VORANFRAGE)}</p>
    <p>Mit einer Bauvoranfrage (Vorbescheid, Art. 71 BayBO) klärst du einzelne Fragen, <b>bevor</b> du Pläne zeichnen lässt und einen Bauantrag stellst. Passt. legt dir Lageplan-Skizze, Kubatur und die Fragen an die Gemeinde zusammen.</p>
    <h3>Kubatur</h3>
    <p>${esc(p.vorhaben.name)}: Grundfläche ${fmt(p.vorhaben.kubatur.grundflaeche, 0)} m², Wandhöhe ${fmt(p.vorhaben.kubatur.wandhoehe, 1)} m, höchster Punkt ${fmt(p.vorhaben.kubatur.firsthoehe, 1)} m, Brutto-Rauminhalt ${fmt(p.vorhaben.kubatur.rauminhalt, 0)} m³ ${tag('berechnet', 'berechnet')}</p>
    <h3>Fragen an die Gemeinde</h3>
    <ol>${p.fragen.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>
    <h3>Lageplan-Skizze</h3>
    <p class="warnbox">${esc(vf.HINWEIS_SKIZZE_V)}</p>
    <div style="overflow:auto;background:#fff;border-radius:8px">${p.zeichnungen.lageplan.svg.replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%"')}</div>
    <div class="btnrow">
      <button class="primary" id="vHtml" type="button">Voranfrage speichern (zum Drucken)</button>
      <button class="sec" id="vJson" type="button">Daten exportieren (JSON)</button>
    </div>
    <p class="m-fine">Die HTML-Datei im Browser öffnen und als PDF drucken. Welche Unterlagen die Bauaufsichtsbehörde für den Vorbescheid verlangt, steht nicht im Wortlaut, den Passt. kennt – vorher erfragen ${tag('offen', 'offen')}. Nichts davon ist eine amtliche Bauvorlage.</p>
    <p class="m-fine">Offizielle Stellen: <a href="${esc(ANTRAG_LINKS.digitalerBauantrag)}" target="_blank" rel="noopener">Digitaler Bauantrag Bayern</a> · <a href="${esc(ANTRAG_LINKS.baybo)}" target="_blank" rel="noopener">Bayerische Bauordnung</a></p>`);
  const name = `passt-bauvoranfrage-${grSt.v.art}-${new Date().toISOString().slice(0, 10)}`;
  const speichern = (inhalt: string, typ: string, datei: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([inhalt], { type: typ }));
    a.download = datei;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  document.getElementById('vHtml')?.addEventListener('click', () => speichern(vf.voranfrageHtml(p), 'text/html;charset=utf-8', `${name}.html`));
  document.getElementById('vJson')?.addEventListener('click', () => speichern(JSON.stringify(p, null, 2), 'application/json', `${name}.json`));
}

/* ---------- Hecke, Baum (AGBGB Art. 47–52) ---------- */
const PFL_ART: [PflanzenArt, string][] = [['hecke', 'Hecke'], ['baum', 'Baum'], ['strauch', 'Strauch']];

/** Beschriftung der Objektart: das Modul „Außengeräte“ heißt in der Oberfläche Außengerät (Klasse im Blatt) */
function tabName(k: ObjectKind): string {
  return k === 'waermepumpe' ? 'Außengerät' : NAMES[k].name;
}

function tabsHtml(): string {
  return `${ORDER.map((k) => `<button class="obj" role="tab" type="button" data-obj="${k}"><span class="d"></span>${tabName(k)}</button>`).join('')}
    <button class="obj" role="tab" type="button" data-modus="pflanzen"><span class="d"></span>Hecke, Baum</button>
    <button class="obj" role="tab" type="button" data-modus="gross" aria-selected="${st.modus === 'gross'}"><span class="d"></span>Großes Vorhaben</button>`;
}

function bindTabs() {
  document.querySelectorAll<HTMLButtonElement>('[data-obj]').forEach((b) => b.addEventListener('click', () => select(b.dataset.obj as ObjectKind)));
  document.querySelector<HTMLButtonElement>('[data-modus="gross"]')?.addEventListener('click', () => {
    if (st.modus === 'gross') return;
    grStart();
  });
  document.querySelector<HTMLButtonElement>('[data-modus="pflanzen"]')?.addEventListener('click', () => {
    if (st.modus === 'pflanzen') return;
    grAus();
    st.modus = 'pflanzen';
    pflSt.benutzt = true;
    zonenAus();
    renderSheet();
    hint(st.hasDragged ? null : 'Zieh die Hecke an eine andere Stelle.');
  });
}

/** Startlage: Hecke 1 m innen parallel zur längsten Grenzstrecke, 1,8 m hoch. */
function startPflanze(b: Vec2[]): Pflanze {
  let best: [Vec2, Vec2] = [b[0], b[1]];
  for (const [p, q] of edges(b)) if (Math.hypot(q[0] - p[0], q[1] - p[1]) > Math.hypot(best[1][0] - best[0][0], best[1][1] - best[0][1])) best = [p, q];
  const [p, q] = best;
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const n: Vec2 = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len]; // links = innen bei CCW
  let center: Vec2 = [(p[0] + q[0]) / 2 + n[0], (p[1] + q[1]) / 2 + n[1]];
  if (!pointInPolygon(center, b)) center = centroid(b);
  let angle = Math.atan2(q[1] - p[1], q[0] - p[0]);
  if (angle > Math.PI / 2) angle -= Math.PI; // Regler −90° … 90° (Hecke ist 180° symmetrisch)
  if (angle <= -Math.PI / 2) angle += Math.PI;
  return { art: 'hecke', center, laenge: Math.round(Math.min(6, len * 0.6)), angle, hoehe: 1.8 };
}

const PFL_CTL: { k: 'hoehe' | 'laenge' | 'deg'; l: string; min: number; max: number; step: number; nur?: PflanzenArt }[] = [
  { k: 'hoehe', l: 'Höhe, die sie erreichen soll', min: 0.5, max: 15, step: 0.1 },
  { k: 'laenge', l: 'Länge der Hecke', min: 1, max: 30, step: 0.5, nur: 'hecke' },
  { k: 'deg', l: 'Drehung', min: -90, max: 90, step: 1, nur: 'hecke' },
];

function pflValText(k: string): string {
  const p = st.pflanze!;
  if (k === 'deg') return `${Math.round(CMath.toDegrees(p.angle))}°`;
  return `${fmt(k === 'hoehe' ? p.hoehe : p.laenge, 1)} m`;
}

function seitenHtml(): string {
  if (!site) return '';
  return site.plot.sides
    .map((sd, i) => {
      const a = pflSt.angaben[i] ?? {};
      const nb = a.strasse?.value ? 'strasse' : a.wald?.value ? 'wald' : 'grundstueck';
      const prov = a.strasse || a.wald ? 'nutzerbestätigt' : 'Annahme';
      const ef = a.einfriedung?.value ?? 0;
      return `<div class="field"><span>${esc(cap(sd.grenze))} ${tag(prov, prov)}</span>${sel(`pNb${i}`, nb, [['grundstueck', 'Nachbargrundstück'], ['strasse', 'öffentliche Straße, Platz'], ['wald', 'Wald']])}</div>
        <div class="field"><span>Mauer oder dichter Zaun dort ${a.einfriedung ? tag('nutzerbestätigt', 'nutzerbestätigt') : ''}</span>${sel(`pEf${i}`, String(ef), [['0', 'keine'], ['1', '1,0 m'], ['1.5', '1,5 m'], ['1.8', '1,8 m'], ['2', '2,0 m'], ['2.5', '2,5 m']])}</div>`;
    })
    .join('');
}

function bestandPflanzenHtml(): string {
  if (!site) return '';
  const liste = bestandsPflanzen({ ...site, bestand: [...site.bestand, ...pflSt.nachbar] }, pflSt.angaben);
  if (!liste.length) return '<p class="fine" style="text-align:left">Keine Hecken, Bäume oder Sträucher bis 3 m an der Grenze erkannt.</p>';
  return `<p class="fine" style="text-align:left">Aus Luftbild 2023 und Laser 2025 erkannt. Den Stamm sehen die Laserdaten nicht – bis du ihn antippst, misst Passt. ab der Kronenmitte, mit großer Spanne.</p>
    <ul class="rows best">${liste
      .map((x) => {
        const offen = x.vergleich !== 'darueber';
        const al = pflSt.alter[x.id] ?? 'unbekannt';
        return `<li><span>${esc(pflanzenText(site!, x))}
          ${offen ? `<br><label class="fine" style="display:flex;gap:6px;align-items:center;text-align:left">Steht so seit ${sel(`pAl-${x.id}`, al, [['unbekannt', 'weiß nicht'], ['unter5', 'weniger als 5 Jahren'], ['ueber5', 'mehr als 5 Jahren']])}</label><small class="fine">${esc(alterText(al))}</small>` : ''}</span>
          ${tag(x.provenance, x.provenance)}
          <span class="acts">${x.art !== 'hecke' ? `<button type="button" data-stamm="${x.id}">${pflSt.stammTippen === x.id ? 'Tipp jetzt auf den Stamm …' : 'Stamm antippen'}</button>` : ''}</span></li>`;
      })
      .join('')}</ul>
    <p class="fine" style="text-align:left">Das ist eine Messung, keine Bewertung. Ob und wie man darüber spricht, entscheidet ihr.</p>`;
}

function renderPflanzenSheet() {
  const p = st.pflanze!;
  const ctl = PFL_CTL.filter((c) => !c.nur || c.nur === p.art)
    .map((c, i) => {
      const v = c.k === 'deg' ? Math.round(CMath.toDegrees(p.angle)) : c.k === 'hoehe' ? p.hoehe : p.laenge;
      return `<div class="ctl"><label for="p${i}"><span>${c.l}</span><output data-pk="${c.k}" for="p${i}"></output></label><input id="p${i}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${v}" data-pk="${c.k}"></div>`;
    })
    .join('');
  $('stepBody').innerHTML = `
    <div class="objects" role="tablist" aria-label="Was willst du hinstellen?">${tabsHtml()}</div>
    <div class="field"><span>Was willst du pflanzen?</span>${sel('pArt', p.art, PFL_ART)}</div>
    <div class="controls" id="controls">${ctl}</div>
    <div class="btnrow"><button class="sec" id="arBtn" type="button">In AR ansehen (1:1)</button></div>
    <label class="fine" style="display:flex;gap:8px;align-items:center;text-align:left;margin:8px 0"><input type="checkbox" id="pZonen" ${pflSt.zonen ? 'checked' : ''}> Wo darf was wachsen? Zonen zeigen</label>
    <div id="pflInfo"></div>
    <details open>
      <summary>So haben wir geprüft</summary>
      <ul class="rows" id="rows"></ul>
    </details>
    <details>
      <summary>Was liegt hinter deinen Grenzen?</summary>
      <p class="fine" style="text-align:left">Längs öffentlicher Straßen und hinter einer Mauer oder einem dichten Zaun, den die Pflanze nicht überragt, gilt Art. 47 nicht (Art. 50 Abs. 1). Neben Wald gelten nur 0,50 m (Art. 47 Abs. 2).</p>
      ${seitenHtml()}
    </details>
    <details>
      <summary>Hecken und Bäume an der Grenze</summary>
      ${bestandPflanzenHtml()}
    </details>
    <p class="fine" style="text-align:left">Grenzabstand von Pflanzen ist Nachbarrecht (AGBGB), kein Baurecht. Das Bauamt prüft ihn nicht.</p>
    <div class="btnrow">
      <button class="primary" id="reportBtn" type="button" aria-haspopup="dialog">Prüfbericht ansehen</button>
      <button class="sec" id="teilenBtn" type="button" aria-haspopup="dialog">Nachbarn fragen</button>
      <button class="sec" id="editBtn" type="button">Grenze ändern</button>
    </div>`;
  bindTabs();
  $('teilenBtn').addEventListener('click', openTeilen);
  $('arBtn').addEventListener('click', startAr);
  $('pArt').addEventListener('change', (e) => {
    const a = (e.target as HTMLSelectElement).value as PflanzenArt;
    p.art = a;
    if (a === 'baum' && p.hoehe < 3) p.hoehe = 6;
    if (a === 'strauch' && p.hoehe > 3) p.hoehe = 1.5;
    renderSheet();
  });
  document.querySelectorAll<HTMLInputElement>('#controls input').forEach((inp) =>
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      if (inp.dataset.pk === 'deg') p.angle = CMath.toRadians(v);
      else if (inp.dataset.pk === 'hoehe') p.hoehe = v;
      else p.laenge = v;
      update();
    }),
  );
  $('pZonen').addEventListener('change', (e) => {
    pflSt.zonen = (e.target as HTMLInputElement).checked;
    pflanzZonenNeu();
  });
  site?.plot.sides.forEach((_, i) => {
    $(`pNb${i}`).addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      const a = (pflSt.angaben[i] = { ...pflSt.angaben[i] });
      a.strasse = { value: v === 'strasse', provenance: 'nutzerbestätigt' };
      a.wald = { value: v === 'wald', provenance: 'nutzerbestätigt' };
      renderSheet();
      pflanzZonenNeu();
    });
    $(`pEf${i}`).addEventListener('change', (e) => {
      pflSt.angaben[i] = { ...pflSt.angaben[i], einfriedung: { value: parseFloat((e.target as HTMLSelectElement).value), provenance: 'nutzerbestätigt' } };
      renderSheet();
    });
  });
  document.querySelectorAll<HTMLSelectElement>('[id^="pAl-"]').forEach((s) =>
    s.addEventListener('change', () => {
      pflSt.alter[s.id.slice(4)] = s.value as Alter;
      renderSheet();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-stamm]').forEach((b) =>
    b.addEventListener('click', () => {
      pflSt.stammTippen = b.dataset.stamm!;
      st.view = 'plan';
      syncViewButtons();
      plotFrame();
      hint('Tipp im Luftbild auf die Stelle, an der der Stamm aus dem Boden kommt.');
      renderSheet();
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
  pflanzZonenNeu();
  update();
}

/** Text unter den Reglern: zulässige Höhe an dieser Stelle und Legende der Zonen. */
function pflanzInfo() {
  const el = document.getElementById('pflInfo');
  const r = st.pflanzRes;
  if (!el || !r) return;
  document.querySelectorAll<HTMLOutputElement>('#controls output[data-pk]').forEach((o) => (o.textContent = pflValText(o.dataset.pk!)));
  const h = r.maxHoehe === Infinity ? 'beliebig hoch (Art. 47 begrenzt die Höhe hier nicht)' : r.maxHoehe === 0 ? 'gar nicht – zu nah an der Grenze' : `bis ${fmt(r.maxHoehe, 1)} m hoch`;
  el.innerHTML = `<p class="fine" style="text-align:left">An dieser Stelle: ${esc(h)}. ${tag('berechnet', 'berechnet')}</p>
    ${pflSt.zonen ? `<p class="fine" style="text-align:left"><span style="color:var(--red)">■</span> unter ${fmt(KLEIN_M)} m: nichts pflanzen · <span style="color:var(--warn)">■</span> bis ${fmt(HOCH_M, 0)} m Abstand: bis 2 m hoch · <span style="color:var(--ok)">■</span> keine Höhengrenze</p>` : ''}`;
}

function pflanzZonenNeu() {
  if (!site || st.modus !== 'pflanzen' || !pflSt.zonen) {
    pflanzLayer?.weg();
    return;
  }
  const s = site;
  void import('./scene/zonen').then((z) => {
    if (st.modus !== 'pflanzen' || !pflSt.zonen) return;
    pflanzLayer ??= new z.ZonenLayer(scene.viewer);
    const { geo, rect } = z.geometrieFuer(s.plot.boundary);
    pflanzLayer.zeige(pflanzZonen(s, pflSt.angaben, geo), geo.nx, geo.ny, rect);
    render();
  });
}

/** Stamm einer Bestandspflanze angetippt (Art. 49: Stammmitte am Boden). */
function setStamm(g: Vec2) {
  const id = pflSt.stammTippen!;
  const it = st.bestand.find((x) => x.id === id) ?? pflSt.nachbar.find((x) => x.id === id);
  pflSt.stammTippen = null;
  if (!it) return;
  it.stamm = g;
  it.stammSpanne = 0.2;
  hint('Stamm gesetzt. Gemessen wird jetzt ab dieser Stelle.');
  buildSite();
  renderSheet();
}

/* ---------- Nachbar-Link (Phase 3.2) ---------- */
const speicher = apiSpeicher();
const APP_VERSION = '0.4.0';
interface MeinLink { l: string; s: string; bis: string; hash: string; titel: string; erstellt: string }
const LINKS_KEY = 'passt.links';
function meineLinks(): MeinLink[] {
  try { return JSON.parse(localStorage.getItem(LINKS_KEY) ?? '[]'); } catch { return []; }
}
function speichereLinks(l: MeinLink[]) {
  try { localStorage.setItem(LINKS_KEY, JSON.stringify(l)); } catch { /* privates Fenster: Link bleibt nur in dieser Sitzung */ }
}
const datumText = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const HINWEIS_LINK = 'Der Link ersetzt keine Unterschrift deines Nachbarn auf amtlichen Formularen, zum Beispiel im Bauantrag.';

function objektText(k: ObjectKind, o: Placed): string {
  if (k === 'gartenhaus') return `Gartenhaus ${fmt(o.w, 1)} × ${fmt(o.d, 1)} m, Wandhöhe ${fmt(o.h, 1)} m${(o.neigung ?? 0) > 0 ? `, Satteldach ${Math.round(o.neigung!)}°, First ${fmt(o.h + dachHoehe(o), 1)} m` : ', Flachdach'}`;
  if (k === 'carport') return `Carport ${fmt(o.w, 1)} × ${fmt(o.d, 1)} m, ${fmt(o.h, 1)} m hoch`;
  const gk = geraeteKlasse(o);
  return `${GERAETE_NAME[gk].name} (Außengerät)${o.lw ? `, Schallleistung ${Math.round(o.lw)} dB(A) ${o.lwVomNutzer || o.geraet ? 'laut Angabe' : 'angenommen'}` : ''}${gk === 'pool' && o.nurTags ? ', nur tagsüber' : ''}`;
}
function pflanzeText(p: Pflanze): string {
  return p.art === 'hecke' ? `Hecke ${fmt(p.laenge, 1)} m lang, bis ${fmt(p.hoehe, 1)} m hoch` : `${p.art === 'baum' ? 'Baum' : 'Strauch'} bis ${fmt(p.hoehe, 1)} m hoch`;
}

function grText2(g: GVorhaben): string {
  return g.art === 'aufstockung' ? `Aufstockung um ${g.geschosse} Geschoss${g.geschosse === 1 ? '' : 'e'}` : `${VORHABEN_NAME[g.art].name} ${fmt(g.w, 1)} × ${fmt(g.d, 1)} m, ${g.geschosse} Geschoss${g.geschosse === 1 ? '' : 'e'}`;
}

/** Dialog für den Ersteller: Objekte wählen, Ablauf, Link erstellen; eigene Links verwalten. */
function openTeilen() {
  if (!st.objs || !st.plot) return;
  const vor = st.modus === 'pflanzen' ? 'pflanze' : st.modus === 'gross' ? 'gross' : st.selected;
  const opts: [string, string][] = [
    ...ORDER.map((k) => [k, objektText(k, st.objs![k])] as [string, string]),
    ...(st.pflanze ? [['pflanze', pflanzeText(st.pflanze)] as [string, string]] : []),
    ...(grSt.v && grSt.benutzt ? [['gross', grText2(grSt.v)] as [string, string]] : []),
  ];
  openModal('Nachbarn fragen', `
    <p>Dein Nachbar bekommt einen Link ohne Anmeldung. Er sieht dein Vorhaben in 3D, kann von seinem Fenster oder Garten aus schauen und den Schatten über den Tag prüfen. Dann kann er antworten: „Passt für mich“ oder „Ich habe eine Frage“.</p>
    <p class="m-fine">Das Vorhaben steht nur im Link selbst – Passt. speichert es nicht. Gespeichert wird nur die Antwort: Zeitpunkt, Antwort und eine Prüfsumme des Vorhabens.</p>
    <h3>Was soll er sehen?</h3>
    <ul class="plain">${opts.map(([k, t]) => `<li><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-teil="${k}" ${k === vor ? 'checked' : ''}> ${esc(t)}</label></li>`).join('')}</ul>
    <div class="field"><span>Link gilt</span>${sel('tBis', '30', [['7', '7 Tage'], ['30', '30 Tage'], ['90', '90 Tage']])}</div>
    <div class="btnrow"><button class="primary" id="tMach" type="button">Link erstellen</button></div>
    <div id="tLink"></div>
    <p class="m-fine">${HINWEIS_LINK} Du kannst ihn jederzeit zurückziehen und die Antworten löschen.</p>
    <h3>Deine Links</h3><div id="tListe"></div>`);
  linkListe();
  $('tMach').addEventListener('click', async () => {
    const teile = [...document.querySelectorAll<HTMLInputElement>('[data-teil]')].filter((x) => x.checked).map((x) => x.dataset.teil!);
    if (!teile.length) { $('tLink').innerHTML = '<p class="fine">Wähl mindestens ein Objekt.</p>'; return; }
    const tage = Number(($('tBis') as HTMLSelectElement).value);
    const b = new Date(Date.now() + tage * 86400000);
    const bis = `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, '0')}-${String(b.getDate()).padStart(2, '0')}`;
    const s = neuerSchluessel();
    const l = await linkIdAus(s);
    const o: Vorhaben['o'] = {};
    for (const k of ORDER) if (teile.includes(k)) o[k] = { ...st.objs![k], baseElevation: undefined, geraet: undefined };
    const v: Vorhaben = { v: VERSION, u: getOrigin(), b: st.plot!, o, ...(teile.includes('pflanze') && st.pflanze ? { p: st.pflanze } : {}), ...(teile.includes('gross') && grSt.v ? { g: { ...grSt.v, baseElevation: undefined } } : {}), bis, l };
    const url = `${location.origin}${location.pathname}#n=${await kodieren(v)}`;
    const hash = await projektHash(v);
    const titel = teile.map((k) => (k === 'pflanze' ? PFL_ART.find((a) => a[0] === st.pflanze!.art)![1] : k === 'gross' ? VORHABEN_NAME[grSt.v!.art].name : NAMES[k as ObjectKind].name)).join(', ');
    speichereLinks([{ l, s, bis, hash, titel, erstellt: new Date().toISOString() }, ...meineLinks()]);
    $('tLink').innerHTML = `<div class="field"><input id="tUrl" readonly value="${esc(url)}" style="width:100%"></div>
      <div class="btnrow"><button class="sec" id="tCopy" type="button">Kopieren</button>${'share' in navigator ? '<button class="sec" id="tShare" type="button">Teilen</button>' : ''}</div>
      <p class="m-fine">Gilt bis ${esc(datumText(bis))}.</p>`;
    $('tCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); $('tCopy').textContent = 'Kopiert'; } catch { ($('tUrl') as HTMLInputElement).select(); }
    });
    document.getElementById('tShare')?.addEventListener('click', () => navigator.share({ title: 'Mein Vorhaben – Passt.', text: 'Schau dir an, was ich plane, und sag mir, ob es für dich passt.', url }).catch(() => {}));
    linkListe();
  });
}

function linkListe() {
  const el = document.getElementById('tListe');
  if (!el) return;
  const ls = meineLinks();
  el.innerHTML = ls.length
    ? `<ul class="rows best">${ls.map((x) => `<li><span>${esc(x.titel)} · bis ${esc(datumText(x.bis))}<br><small class="fine" id="tA-${x.l}"></small></span><span class="acts">
        <button type="button" data-tab="${x.l}">Antworten</button><button type="button" data-twi="${x.l}">Zurückziehen</button><button type="button" data-tlo="${x.l}">Löschen</button></span></li>`).join('')}</ul>`
    : '<p class="fine">Noch keine Links.</p>';
  const finde = (l: string) => ls.find((x) => x.l === l)!;
  const melde = (l: string, t: string) => { const e = document.getElementById(`tA-${l}`); if (e) e.textContent = t; };
  el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', async () => {
    const x = finde(b.dataset.tab!);
    try {
      const a = await speicher.abrufen(x.l, x.s);
      melde(x.l, a.length ? a.map((r) => `${new Date(r.zeit).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}: ${r.antwort === 'passt' ? 'Passt für mich' : 'Hat eine Frage'}${r.hash === x.hash ? '' : ' (anderer Stand)'}`).join(' · ') : 'Noch keine Antwort.');
    } catch (e) { melde(x.l, (e as Error).message); }
  }));
  el.querySelectorAll<HTMLButtonElement>('[data-twi]').forEach((b) => b.addEventListener('click', async () => {
    const x = finde(b.dataset.twi!);
    try { await speicher.zurueckziehen(x.l, x.s); melde(x.l, 'Zurückgezogen – keine neuen Antworten mehr.'); } catch (e) { melde(x.l, (e as Error).message); }
  }));
  el.querySelectorAll<HTMLButtonElement>('[data-tlo]').forEach((b) => b.addEventListener('click', async () => {
    const x = finde(b.dataset.tlo!);
    try {
      await speicher.allesLoeschen(x.l, x.s);
      speichereLinks(meineLinks().filter((y) => y.l !== x.l));
      linkListe();
    } catch (e) { melde(x.l, (e as Error).message); }
  }));
}

/* ----- Ansicht des Nachbarn ----- */
const nbSt: {
  v: Vorhaben | null;
  hash: string;
  datum: string;
  minuten: number;
  mit: boolean;
  tippen: 'fenster' | 'garten' | null;
  antwortId: string | null;
  gesendet: NachbarAntwort | null;
  meldung: string;
  stunden: { ohne: number; mit: number } | null;
  /** großes Vorhaben: Sonnenstunden am Blickpunkt an den festen Stichtagen */
  stichtage: { name: string; ohne: number; mit: number }[] | null;
  jetzt: string;
} = { v: null, hash: '', datum: '', minuten: 15 * 60, mit: true, tippen: null, antwortId: null, gesendet: null, meldung: '', stunden: null, stichtage: null, jetzt: '' };

const ANTWORT_KEY = (l: string) => `passt.antwort.${l}`;

function nachbarEnde(head: string, sub: string) {
  st.ansicht = 'nachbar';
  verdict(head, sub);
  $('stepBody').innerHTML = `<p class="fine" style="text-align:left">${esc(HINWEIS_LINK)}</p>`;
}

async function startNachbar(fragment: string) {
  st.ansicht = 'nachbar';
  const heute = new Date();
  nbSt.datum = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`;
  verdict('Lädt das Vorhaben …', '');
  $('stepBody').innerHTML = '';
  const v = await dekodieren(fragment);
  if (!v) return nachbarEnde('Dieser Link ist unvollständig.', 'Bitte deinen Nachbarn, ihn noch einmal zu schicken.');
  if (abgelaufen(v)) return nachbarEnde('Dieser Link ist abgelaufen.', `Er galt bis ${datumText(v.bis)}.`);
  try {
    if (await speicher.zurueckgezogen(v.l)) return nachbarEnde('Dein Nachbar hat diesen Link zurückgezogen.', 'Das Vorhaben wird nicht mehr angezeigt.');
  } catch { nbSt.meldung = 'Der Server ist gerade nicht erreichbar – anschauen geht, antworten vielleicht nicht.'; }
  nbSt.hash = await projektHash(v);
  try { nbSt.antwortId = localStorage.getItem(ANTWORT_KEY(v.l)); } catch { /* egal */ }
  // Ursprung anpassen, falls sich das Gebiet verschoben hat
  const o = getOrigin();
  const dx = v.u[0] - o[0];
  const dy = v.u[1] - o[1];
  const sh = (p: Vec2): Vec2 => [p[0] + dx, p[1] + dy];
  v.b = v.b.map(sh);
  for (const k of Object.keys(v.o) as ObjectKind[]) v.o[k]!.center = sh(v.o[k]!.center);
  if (v.p) v.p.center = sh(v.p.center);
  if (v.g) v.g.center = sh(v.g.center);
  nbSt.v = v;
  const c = centroid(v.b);
  await Promise.all([details, terrain.ensure([c[0] - 90, c[1] - 90], [c[0] + 90, c[1] + 90])]);
  st.draft = v.b;
  plotProvenance = 'nutzerbestätigt';
  await confirmPlot();
  st.ansicht = 'nachbar';
  st.showAF = false;
  for (const k of Object.keys(v.o) as ObjectKind[]) st.objs![k] = v.o[k]!;
  st.sichtbar = Object.keys(v.o) as ObjectKind[];
  st.pflanze = v.p ?? null;
  if (v.g && site) {
    // großes Vorhaben: nur ansehen (3D + Schatten), ohne Abstandsflächen
    grSt.v = v.g;
    grSt.res = bewerteVorhaben(site, v.g, null, grStrassen());
    grLayer ??= new VorhabenLayer(scene.viewer);
    st.modus = 'gross';
    grZeichnen();
  }
  // Blickpunkt: angenommenes Fenster, das dem Vorhaben am nächsten liegt
  const ziel = vorhabenMitte();
  const w = st.windows.filter((x) => !st.buildings.find((b) => b.id === x.buildingId)?.own).sort((a, b) => Math.hypot(a.pos[0] - ziel[0], a.pos[1] - ziel[1]) - Math.hypot(b.pos[0] - ziel[0], b.pos[1] - ziel[1]))[0];
  st.blick = w ? { p: w.pos, z: w.z, annahme: true } : null;
  hint(null);
  update();
  schattenNeu(true);
  renderSheet();
}

function vorhabenKoerper(): Koerper[] {
  const v = nbSt.v;
  if (!v) return [];
  const g = v.g && site ? grKoerper(site, v.g) : null;
  return [...(Object.values(v.o) as Placed[]).map((o) => koerperAus(o)), ...(v.p ? [koerperPflanze(v.p)] : []), ...(g ? [g] : [])];
}
function vorhabenMitte(): Vec2 {
  const ps = [...(Object.values(nbSt.v?.o ?? {}) as Placed[]).map((o) => o.center), ...(nbSt.v?.p ? [nbSt.v.p.center] : []), ...(nbSt.v?.g ? [nbSt.v.g.center] : [])];
  return ps.length ? [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length] : centroid(st.plot!);
}
/** Breite, Länge und Meridiankonvergenz (UTM 32, Mittelmeridian 9°) am Grundstück. */
function geoLage(): { lat: number; lon: number; konv: number } {
  const [lon, lat] = localToLonLat(centroid(st.plot!));
  const konv = (Math.atan(Math.tan((lon - 9) * (Math.PI / 180)) * Math.sin(lat * (Math.PI / 180))) * 180) / Math.PI;
  return { lat, lon, konv };
}
/** Uhrzeit am Grundstück (Europe/Berlin, mit Sommerzeit) → Zeitpunkt; unabhängig von der Zeitzone des Geräts. */
function zeitpunkt(): Date {
  const [y, m, d] = nbSt.datum.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d, Math.floor(nbSt.minuten / 60), nbSt.minuten % 60);
  const versatz = (t: number) => {
    const z = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' }).formatToParts(new Date(t)).find((x) => x.type === 'timeZoneName')?.value ?? 'GMT+1';
    const r = z.match(/GMT([+-]\d+)(?::(\d+))?/);
    return r ? (Number(r[1]) * 60 + Math.sign(Number(r[1])) * Number(r[2] ?? 0)) * 60000 : 3600000;
  };
  return new Date(utc - versatz(utc - versatz(utc)));
}

/** Schatten für Datum/Uhrzeit neu; mit tagNeu auch die Sonnenstunden des Tages am Blickpunkt. */
function schattenNeu(tagNeu = false) {
  if (!st.plot || !nbSt.v || !nbSt.datum) return;
  const { lat, lon, konv } = geoLage();
  const s = sonnenstand(zeitpunkt(), lat, lon);
  const vk = vorhabenKoerper();
  const c = centroid(st.plot);
  const hk = st.buildings.filter((b) => polygonDistance([c], b.footprint) < 70).map(koerperGebaeude).filter((k): k is Koerper => !!k);
  const polys: RenderState['schatten'] = [];
  for (const k of hk) { const f = schattenAmBoden(k, s, konv); if (f) polys.push({ poly: f, vorhaben: false }); }
  if (nbSt.mit) for (const k of vk) { const f = schattenAmBoden(k, s, konv); if (f) polys.push({ poly: f, vorhaben: true }); }
  st.schatten = polys.filter((x) => x.poly.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])));
  renderer.syncSchatten();
  render();
  if (st.blick) {
    const ids = new Set(vk.map((k) => k.id));
    const id = s.hoehe < MIN_HOEHE_GRAD ? '' : imSchatten(st.blick.p, st.blick.z, nbSt.mit ? [...vk, ...hk] : hk, s, konv);
    nbSt.jetzt = s.hoehe < MIN_HOEHE_GRAD ? 'Die Sonne steht zu tief oder ist untergegangen.' : id == null ? 'Dein Blickpunkt liegt in der Sonne.' : ids.has(id) ? 'Dein Blickpunkt liegt im Schatten des Vorhabens.' : 'Dein Blickpunkt liegt im Schatten eines Hauses.';
    if (tagNeu) {
      const tag = new Date(`${nbSt.datum}T00:00:00Z`);
      nbSt.stunden = { ohne: sonnenstunden(st.blick.p, st.blick.z, hk, tag, lat, lon, konv), mit: sonnenstunden(st.blick.p, st.blick.z, [...vk, ...hk], tag, lat, lon, konv) };
      if (nbSt.v.g) {
        const b = st.blick;
        nbSt.stichtage = STICHTAGE.map((s) => {
          const [m, d] = s.split('-').map(Number);
          const t = new Date(Date.UTC(new Date().getUTCFullYear(), m - 1, d));
          return { name: STICHTAG_NAME[s] ?? s, ohne: sonnenstunden(b.p, b.z, hk, t, lat, lon, konv), mit: sonnenstunden(b.p, b.z, [...vk, ...hk], t, lat, lon, konv) };
        });
      }
    }
  } else nbSt.jetzt = '';
  const el = document.getElementById('nbSonne');
  if (el) el.innerHTML = sonneHtml();
  const out = document.querySelector('output[for="nbZeit"]');
  if (out) out.textContent = `${String(Math.floor(nbSt.minuten / 60)).padStart(2, '0')}:${String(nbSt.minuten % 60).padStart(2, '0')} Uhr`;
}

const stdText = (h: number) => `${Math.floor(h + 1e-9)} h ${String(Math.round((h - Math.floor(h + 1e-9)) * 60)).padStart(2, '0')} min`;
function sonneHtml(): string {
  if (!st.blick) return '<p class="fine" style="text-align:left">Tipp auf dein Fenster oder in deinen Garten, dann rechnet Passt. den Schatten für diese Stelle.</p>';
  const s = nbSt.stunden;
  return `<p style="text-align:left;margin:6px 0">${esc(nbSt.jetzt)} ${tag('berechnet', 'berechnet')}</p>
    ${s ? `<p class="fine" style="text-align:left">Sonne an deinem Blickpunkt an diesem Tag: ohne Vorhaben ${stdText(s.ohne)}, mit Vorhaben ${stdText(s.mit)}${s.ohne - s.mit > 0.01 ? ` – ${stdText(s.ohne - s.mit)} weniger` : ' – kein Unterschied'}.</p>` : ''}
    ${nbSt.stichtage ? `<ul class="rows best">${nbSt.stichtage.map((x) => `<li><span><b>${esc(x.name)}</b>: ohne Vorhaben ${stdText(x.ohne)}, mit Vorhaben ${stdText(x.mit)}${x.ohne - x.mit > 0.01 ? ` – <b>${stdText(x.ohne - x.mit)} weniger Sonne</b>` : ' – kein Unterschied'}</span>${tag('berechnet', 'berechnet')}</li>`).join('')}</ul>` : ''}`;
}

function nachbarVerdict() {
  const v = nbSt.v;
  if (!v) return;
  const teile = [...(Object.entries(v.o) as [ObjectKind, Placed][]).map(([k, o]) => objektText(k, o)), ...(v.p ? [pflanzeText(v.p)] : []), ...(v.g ? [grText2(v.g)] : [])];
  verdict('Dein Nachbar zeigt dir sein Vorhaben.', teile.join(' · '));
}

function renderNachbarSheet() {
  const v = nbSt.v!;
  nachbarVerdict();
  const b = st.blick;
  const fp = [...(Object.values(v.o) as Placed[]).map((o) => footprint(o)), ...(v.p ? [koerperPflanze(v.p).fp] : []), ...(v.g && grSt.res ? [grSt.res.grundriss.fp] : [])];
  const abst = b && fp.length ? Math.min(...fp.map((f) => polygonDistance([b.p], f))) : null;
  const antwort = nbSt.gesendet ?? (nbSt.antwortId ? 'gesendet' : null);
  $('stepBody').innerHTML = `
    <h3 style="font-size:15px;margin:16px 0 6px">Von wo schaust du?</h3>
    <p class="fine" style="text-align:left">${b ? `${b.annahme ? 'Angenommen: das nächste Fenster deines Hauses, Mitte der Fassade.' : 'Dein Blickpunkt'} ${fmt(b.z, 1)} m über dem Gelände${abst != null ? `, etwa ${fmt(abst, 1)} m vom Vorhaben entfernt` : ''}.` : 'Noch kein Blickpunkt.'} ${b ? tag(b.annahme ? 'Annahme' : 'nutzerbestätigt', b.annahme ? 'Annahme' : 'nutzerbestätigt') : ''}</p>
    <div class="btnrow">
      <button class="sec" id="nbFenster" type="button" aria-pressed="${nbSt.tippen === 'fenster'}">${nbSt.tippen === 'fenster' ? 'Tipp jetzt auf dein Fenster …' : 'Mein Fenster antippen'}</button>
      <button class="sec" id="nbGarten" type="button" aria-pressed="${nbSt.tippen === 'garten'}">${nbSt.tippen === 'garten' ? 'Tipp jetzt in deinen Garten …' : 'Stelle im Garten antippen'}</button>
      ${b ? '<button class="sec" id="nbSicht" type="button">Von hier ansehen</button>' : ''}
    </div>
    <h3 style="font-size:15px;margin:16px 0 6px">Schatten</h3>
    <div class="field"><label for="nbDatum">Tag</label><input id="nbDatum" type="date" value="${esc(nbSt.datum)}"></div>
    <div class="ctl"><label for="nbZeit"><span>Uhrzeit (deutsche Zeit)</span><output for="nbZeit"></output></label><input id="nbZeit" type="range" min="300" max="1290" step="15" value="${nbSt.minuten}"></div>
    <label class="fine" style="display:flex;gap:8px;align-items:center;text-align:left;margin:8px 0"><input type="checkbox" id="nbMit" ${nbSt.mit ? 'checked' : ''}> Schatten mit Vorhaben zeigen</label>
    <div id="nbSonne">${sonneHtml()}</div>
    <p class="fine" style="text-align:left">Vereinfacht gerechnet: ebenes Gelände, Häuser als Block bis zur halben Dachhöhe, Bäume ohne Schatten. ${tag('Annahme', 'Annahme')}</p>
    <h3 style="font-size:15px;margin:16px 0 6px">Deine Antwort</h3>
    ${antwort ? `<p style="text-align:left">${antwort === 'passt' ? 'Danke – du hast „Passt für mich“ geantwortet.' : antwort === 'frage' ? 'Danke – dein Nachbar sieht, dass du eine Frage hast. Sprich ihn am besten direkt an; Passt. speichert keine Nachrichten.' : 'Du hast auf diesen Link schon geantwortet.'}</p>
      ${nbSt.antwortId ? '<div class="btnrow"><button class="sec" id="nbLoeschen" type="button">Meine Antwort löschen</button></div>' : ''}`
      : `<div class="btnrow"><button class="primary" id="nbPasst" type="button">Passt für mich</button><button class="sec" id="nbFrage" type="button">Ich habe eine Frage</button></div>`}
    ${nbSt.meldung ? `<p class="warnbox">${esc(nbSt.meldung)}</p>` : ''}
    <p class="fine" style="text-align:left">Gespeichert werden nur Zeitpunkt, deine Antwort und eine Prüfsumme des Vorhabens – kein Name, keine Adresse. ${esc(HINWEIS_LINK)} Der Link gilt bis ${esc(datumText(v.bis))}; dein Nachbar kann ihn zurückziehen, und du kannst deine Antwort jederzeit löschen.</p>`;
  const tippen = (m: 'fenster' | 'garten') => () => {
    nbSt.tippen = nbSt.tippen === m ? null : m;
    hint(nbSt.tippen === 'fenster' ? 'Tipp auf die Wand deines Hauses, dort wo dein Fenster ist.' : nbSt.tippen === 'garten' ? 'Tipp auf die Stelle in deinem Garten.' : null);
    renderSheet();
  };
  $('nbFenster').addEventListener('click', tippen('fenster'));
  $('nbGarten').addEventListener('click', tippen('garten'));
  document.getElementById('nbSicht')?.addEventListener('click', vonHierAnsehen);
  $('nbDatum').addEventListener('change', (e) => {
    const x = (e.target as HTMLInputElement).value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) { nbSt.datum = x; schattenNeu(true); }
  });
  $('nbZeit').addEventListener('input', (e) => { nbSt.minuten = Number((e.target as HTMLInputElement).value); schattenNeu(); });
  $('nbMit').addEventListener('change', (e) => { nbSt.mit = (e.target as HTMLInputElement).checked; schattenNeu(); });
  const sende = (a: NachbarAntwort) => async () => {
    try {
      nbSt.antwortId = await speicher.antworten(v.l, a, nbSt.hash, v.bis);
      nbSt.gesendet = a;
      nbSt.meldung = '';
      try { localStorage.setItem(ANTWORT_KEY(v.l), nbSt.antwortId); } catch { /* egal */ }
    } catch (e) { nbSt.meldung = `Antwort nicht gespeichert: ${(e as Error).message}`; }
    renderSheet();
  };
  document.getElementById('nbPasst')?.addEventListener('click', sende('passt'));
  document.getElementById('nbFrage')?.addEventListener('click', sende('frage'));
  document.getElementById('nbLoeschen')?.addEventListener('click', async () => {
    try {
      await speicher.antwortLoeschen(nbSt.antwortId!);
      nbSt.antwortId = null;
      nbSt.gesendet = null;
      try { localStorage.removeItem(ANTWORT_KEY(v.l)); } catch { /* egal */ }
      nbSt.meldung = 'Deine Antwort ist gelöscht.';
    } catch (e) { nbSt.meldung = (e as Error).message; }
    renderSheet();
  });
  schattenNeu();
}

/** Kamera auf Augenhöhe am Blickpunkt, Richtung Vorhaben. */
function vonHierAnsehen() {
  const b = st.blick;
  if (!b) return;
  const z = vorhabenMitte();
  const heading = Math.atan2(z[0] - b.p[0], z[1] - b.p[1]) + CMath.toRadians(geoLage().konv);
  // Augenhöhe: die Mindesthöhe der Kamera (8 m, gegen Absturz ins Gelände) hier aufheben
  scene.viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1;
  scene.viewer.camera.flyTo({
    destination: localToCartesian(b.p, terrain.heightOrCoarse(b.p) + Math.max(1.6, b.z)),
    orientation: { heading, pitch: CMath.toRadians(-6), roll: 0 },
    duration: 1.2,
  });
}

/** Tipp des Nachbarn: Fenster an der Fassade (0,3 m davor) oder Stelle im Garten (Augenhöhe 1,6 m). */
function setBlick(pos: Cartesian2) {
  const v = scene.viewer;
  if (nbSt.tippen === 'garten') {
    const g = pickGround(pos);
    if (!g) return;
    st.blick = { p: g, z: 1.6, annahme: false };
  } else {
    const c = v.scene.pickPosition(pos);
    if (!c) return;
    const { p, h } = cartesianToLocal(c);
    const nb = st.buildings.filter((b) => !b.own).map((b) => ({ b, d: polygonDistance([p], b.footprint) })).sort((a, b) => a.d - b.d)[0];
    if (!nb || nb.d > 1.5) { hint('Das war keine Hauswand. Tipp direkt auf die Wand deines Hauses.'); return; }
    let best: { q: Vec2; n: Vec2; d: number } | null = null;
    const ccwFp = signedArea(nb.b.footprint) > 0;
    for (const [a, e] of edges(nb.b.footprint)) {
      const r = pointSegment(p, a, e);
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
      const n: Vec2 = ccwFp ? [(e[1] - a[1]) / L, -(e[0] - a[0]) / L] : [-(e[1] - a[1]) / L, (e[0] - a[0]) / L];
      if (!best || r.d < best.d) best = { q: r.q, n, d: r.d };
    }
    const q: Vec2 = [best!.q[0] + best!.n[0] * 0.3, best!.q[1] + best!.n[1] * 0.3];
    st.blick = { p: q, z: Math.max(0.5, h - terrain.height(p)), annahme: false };
  }
  nbSt.tippen = null;
  hint(null);
  schattenNeu(true);
  renderSheet();
}

/* ---------- AR (Phase 3.3, lazy geladen) ---------- */
async function startAr() {
  const ar = await import('./ar');
  let p: import('./ar').ArParameter;
  let titel: string;
  if (st.modus === 'pflanzen' && st.pflanze) {
    const q = st.pflanze;
    p = { art: q.art, h: q.hoehe, ...(q.art === 'hecke' ? { l: q.laenge } : {}) };
    titel = pflanzeText(q);
  } else {
    const o = st.objs![st.selected];
    p = { art: st.selected, w: o.w, d: o.d, h: o.h, ...(st.selected === 'gartenhaus' ? { n: o.neigung ?? 0 } : {}) };
    titel = objektText(st.selected, o);
  }
  const r = await ar.zeigeAr(p, titel);
  if (r.weg !== 'download') return;
  openModal('In AR ansehen', `<p>AR startet auf dem Handy direkt: auf dem iPhone mit AR Quick Look, auf Android mit dem Scene Viewer. Das Modell steht dort in echter Größe (1:1) – ${esc(titel)}.</p>
    <p>Hier am Rechner kannst du das Modell herunterladen:</p>
    <div class="btnrow"><a class="sec" href="${r.glb}" download="passt-modell.glb">glTF (.glb)</a><a class="sec" href="${r.usdz}" download="passt-modell.usdz">USDZ (iPhone)</a></div>
    <p class="m-fine">Das Modell wird aus den Maßen erzeugt, nichts wird gespeichert. Es zeigt die Größe, nicht den Ort: Du stellst es in der AR-Ansicht selbst in deinen Garten. Der Scene Viewer auf Android lädt das Modell über eine öffentliche https-Adresse – im lokalen Netz geht AR deshalb nur auf dem iPhone.</p>`);
}

/* ---------- Vom Nein zum Antrag (Phase 4.1, Zeichnungen lazy) ---------- */
async function openAntrag() {
  if (!site || !st.res || st.selected === 'waermepumpe') return;
  const k = st.selected;
  const o = st.objs![k];
  const res = st.res[k];
  const v = verfahrenFuer(site, k, o, res);
  const pk = await import('./antrag/paket');
  const paket = pk.paketBauen({
    site, k, o: { ...o, baseElevation: undefined }, res, verfahren: v, bestand: st.bestand.filter((b) => b.status === 'aktiv'),
    ursprung: getOrigin(), adresse: st.address, erstellt: new Date(), links: ANTRAG_LINKS, version: APP_VERSION,
  });
  const NOETIG = { ja: 'nötig', wenn: 'wenn zutreffend', nein: 'in der Regel nicht' };
  const BEITRAG = { skizze: 'Skizze von Passt.', daten: 'Angaben von Passt.', nein: 'selbst besorgen' };
  openModal(v.titel, `
    ${v.gruende.length ? `<ul class="plain">${v.gruende.map((g) => `<li>${esc(g.text)} ${tag(g.quelle, 'rule')}</li>`).join('')}</ul>` : ''}
    <h3>Was jetzt?</h3>
    <ul class="plain">${v.schritte.map((x) => `<li>${esc(x.text)} ${tag(x.quelle, x.kind)}</li>`).join('')}</ul>
    ${v.entwurfsverfasser ? `<h3>Wer die Pläne erstellt</h3><p>${esc(v.entwurfsverfasser.wer)} ${tag(v.entwurfsverfasser.quelle, 'rule')}</p>${v.entwurfsverfasser.offen ? `<p class="m-fine">${esc(v.entwurfsverfasser.offen)} ${tag('offen', 'offen')}</p>` : ''}` : ''}
    ${v.checkliste.length ? `<h3>Unterlagen</h3><ul class="rows best">${v.checkliste.map((c) => `<li><span><b>${esc(c.titel)}</b> · ${NOETIG[c.noetig]}<br><small class="fine">${esc(c.hinweis)}</small></span>${tag(BEITRAG[c.passt], c.passt === 'nein' ? 'offen' : 'berechnet')}</li>`).join('')}</ul>` : ''}
    ${v.verfahren !== 'lage' && v.verfahren !== 'frei' ? `<h3>Lageplan-Skizze</h3><p class="warnbox">${esc(pk.HINWEIS_SKIZZE)}</p><div style="overflow:auto;background:#fff;border-radius:8px">${paket.zeichnungen.lageplan.svg.replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%"')}</div>` : ''}
    ${v.verfahren === 'lage' ? '' : `<div class="btnrow">
      <button class="primary" id="aHtml" type="button">Paket speichern (zum Drucken)</button>
      <button class="sec" id="aJson" type="button">Daten exportieren (JSON)</button>
    </div>`}
    <p class="m-fine">Das Paket enthält Zusammenfassung, Lageplan-Skizze, Grundriss, Schnitt, Ansichten und die Checkliste. Die HTML-Datei im Browser öffnen und als PDF drucken – in Originalgröße sind die Zeichnungen maßstäblich. Die JSON-Datei können später Anbieter oder Planer übernehmen. Nichts davon ist eine amtliche Bauvorlage.</p>
    <p class="m-fine">Offizielle Stellen: <a href="${esc(ANTRAG_LINKS.digitalerBauantrag)}" target="_blank" rel="noopener">Digitaler Bauantrag Bayern</a> · <a href="${esc(ANTRAG_LINKS.formulare)}" target="_blank" rel="noopener">Bauantragsformulare</a> · <a href="${esc(ANTRAG_LINKS.bauvorlv)}" target="_blank" rel="noopener">Bauvorlagenverordnung</a></p>`);
  const name = `passt-${k}-${new Date().toISOString().slice(0, 10)}`;
  const speichern = (inhalt: string, typ: string, datei: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([inhalt], { type: typ }));
    a.download = datei;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  document.getElementById('aHtml')?.addEventListener('click', () => speichern(pk.paketHtml(paket), 'text/html;charset=utf-8', `${name}.html`));
  document.getElementById('aJson')?.addEventListener('click', () => speichern(JSON.stringify(paket, null, 2), 'application/json', `${name}.json`));
}

/* ---------- Lernschleife (Phase 4.2): nur mit Einwilligung ---------- */
const lernSpeicher = apiLernSpeicher();
const LERN_EIN = 'passt.lernen.einwilligung';
const LERN_IDS = 'passt.lernen.ids';
function lernEinwilligung(): boolean {
  try { return localStorage.getItem(LERN_EIN) === '1'; } catch { return false; }
}
function setLernEinwilligung(an: boolean) {
  try { if (an) localStorage.setItem(LERN_EIN, '1'); else localStorage.removeItem(LERN_EIN); } catch { /* egal */ }
  hint(an ? 'Danke. Ab jetzt zählen deine Korrekturen – nur Umriss, Art und Kachel.' : 'Einwilligung zurückgenommen. Es wird nichts mehr gesendet.');
}
function lernIds(): string[] {
  try { return JSON.parse(localStorage.getItem(LERN_IDS) ?? '[]'); } catch { return []; }
}
function lernBeitrag(aktion: LernAktion, b: Bestand) {
  if (!lernEinwilligung() || b.footprint.length < 3 || b.footprint.length > 64) return;
  const u = getOrigin();
  const geometrie = b.footprint.map((p) => [Math.round((p[0] + u[0]) * 10) / 10, Math.round((p[1] + u[1]) * 10) / 10] as [number, number]);
  const eintrag = { aktion, klasse: b.kind ?? 'kleinbau', geometrie, kachel: kachelAus(geometrie[0][0], geometrie[0][1]), modell: data.modell ?? null };
  lernSpeicher.beitragen([eintrag]).then((ids) => {
    try { localStorage.setItem(LERN_IDS, JSON.stringify([...lernIds(), ...ids.filter((x): x is string => !!x)])); } catch { /* egal */ }
  }).catch(() => { /* ohne Server (statisches Hosting): still nichts senden */ });
}
function openLernInfo() {
  const n = lernIds().length;
  openModal('Erkennung verbessern', `
    <p>Passt. erkennt Gartenhäuser, Pools oder Hecken automatisch – und liegt manchmal daneben. Wenn du zustimmst, schickt Passt. bei „Stimmt“, „Gibt es nicht“, „Umriss nachziehen“ und „Objekt einzeichnen“ diese Angaben an den Passt.-Server:</p>
    <ul class="plain"><li>den Umriss des Objekts (Koordinaten, auf 10 cm gerundet)</li><li>die Art des Objekts (z. B. Gartenhaus)</li><li>die 1-km-Kachel, in der es liegt</li><li>was du getan hast (bestätigt, verworfen, nachgezogen, neu) und welche Version der Erkennung es war</li></ul>
    <p><b>Nicht</b> gesendet werden Adresse, Grundstücksgrenze und Name. Der Server speichert weder deine IP-Adresse noch den Zeitpunkt.</p>
    <p class="m-fine">Ehrlich gesagt: Über die Koordinaten lässt sich ein Umriss einem Grundstück zuordnen. Deshalb nur mit deiner Zustimmung, und du kannst deine Beiträge jederzeit löschen. Neue Versionen der Erkennung werden nur freigegeben, wenn sie auf einem festen Prüfdatensatz mindestens so gut sind wie die alte.</p>
    <div class="btnrow"><button class="sec" id="lernLoeschen" type="button" ${n ? '' : 'disabled'}>Meine Beiträge löschen (${n})</button></div>
    <p class="m-fine" id="lernMeldung"></p>`);
  document.getElementById('lernLoeschen')?.addEventListener('click', async () => {
    try {
      const weg = await lernSpeicher.loeschen(lernIds());
      try { localStorage.removeItem(LERN_IDS); } catch { /* egal */ }
      $('lernMeldung').textContent = weg === 1 ? 'Ein Beitrag gelöscht.' : `${weg} Beiträge gelöscht.`;
    } catch (e) { $('lernMeldung').textContent = (e as Error).message; }
  });
}

/* ---------- Gartenblick (Phase 5.4): KI-Visualisierung, nur Anzeige, nie für Prüfungen ---------- */
interface GbEintrag { id: string; bbox: [number, number, number, number]; herkunft: string; splats: number; erstellt: string }
const gbSt: { liste: GbEintrag[] | null; an: boolean; tileset: Cesium3DTileset | null; eintrag: GbEintrag | null } = { liste: null, an: false, tileset: null, eintrag: null };

/** Liste der vorberechneten Gartenblicke (data/gartenblick/index.json). Fehlt sie, bleibt der Knopf verborgen. */
async function gartenblickPruefen() {
  if (gbSt.liste === null) {
    try { gbSt.liste = ((await (await fetch(`${DATA_URL}/gartenblick/index.json`)).json()) as { eintraege: GbEintrag[] }).eintraege; } catch { gbSt.liste = []; }
  }
  const c = st.plot ? centroid(st.plot) : null;
  gbSt.eintrag = c ? gbSt.liste.find((e) => c[0] >= e.bbox[0] && c[0] <= e.bbox[2] && c[1] >= e.bbox[1] && c[1] <= e.bbox[3]) ?? null : null;
  $('gbBtn').hidden = !gbSt.eintrag;
  if (!gbSt.eintrag && gbSt.an) void gartenblick(false);
}

async function gartenblick(an: boolean) {
  const e = gbSt.eintrag;
  if (an && !e) return;
  gbSt.an = an;
  $('gbBtn').setAttribute('aria-pressed', String(an));
  $('kiBand').hidden = !an;
  if (an && e) {
    $('kiHerkunft').textContent = `· ${e.herkunft}`;
    if (!gbSt.tileset || gbSt.tileset.resource?.url?.indexOf(`/gartenblick/${e.id}/`) === -1) {
      if (gbSt.tileset) scene.viewer.scene.primitives.remove(gbSt.tileset);
      gbSt.tileset = await Cesium3DTileset.fromUrl(`${DATA_URL}/gartenblick/${e.id}/tileset.json`);
      scene.viewer.scene.primitives.add(gbSt.tileset);
    }
    gbSt.tileset.show = true;
    if (scene.tileset) scene.tileset.show = false;
    hint('Gartenblick ist eine KI-Visualisierung. Sie zeigt, wie es aussehen könnte – gemessen und geprüft wird nur mit den amtlichen Daten.');
  } else {
    if (gbSt.tileset) gbSt.tileset.show = false;
    if (scene.tileset) scene.tileset.show = !st.mesh;
  }
  render();
}

/* ---------- Außengeräte: Geräteklasse und Gerätesuche über alle Klassen (lazy geladen) ---------- */
type GeraetRow = [string, string, number, string, number | null];
type GeraeteListe = { klasse: GeraeteKlasse; quelle: string; geraete: GeraetRow[] };
/** Gerätelisten je Klasse. Fehlt die Datei (Klimageräte, Pool-Wärmepumpen: noch keine Datenquelle), ist die Liste leer. */
const GERAETE_DATEIEN: [GeraeteKlasse, string][] = [['lwwp', 'waermepumpen.json'], ['klima', 'klimageraete.json'], ['pool', 'poolwaermepumpen.json']];
let geraete: Promise<GeraeteListe[]> | null = null;
const ladeGeraete = () =>
  (geraete ??= Promise.all(
    GERAETE_DATEIEN.map(async ([klasse, datei]): Promise<GeraeteListe> => {
      try {
        const r = await fetch(`${DATA_ROOT}/${datei}`);
        const j = r.ok && (r.headers.get('content-type') ?? '').includes('json') ? ((await r.json()) as { quelle: string; geraete: GeraetRow[] }) : null;
        return { klasse, quelle: j?.quelle ?? '', geraete: j?.geraete ?? [] };
      } catch {
        return { klasse, quelle: '', geraete: [] };
      }
    }),
  ));

/** Klasse wechseln: Platzhalter-Schallleistung und übliche Maße der Klasse, Gerät und Nutzerwert zurücksetzen. */
function setzeGeraeteklasse(k: GeraeteKlasse) {
  const ob = st.objs!.waermepumpe;
  const m = standardMasse(k);
  Object.assign(ob, { geraeteklasse: k, lw: standardLw(k), geraet: undefined, lwVomNutzer: false, nurTags: false, w: m.w, d: m.d, h: m.h });
}

function geraetHtml(o: Placed): string {
  const k = geraeteKlasse(o);
  const labelLw = o.geraet ? tag('zertifiziert', 'zertifiziert') : o.lwVomNutzer ? tag('nutzerbestätigt', 'nutzerbestätigt') : tag('Annahme', 'Annahme');
  const rw = richtwertFuer(o, st.gebiet.value);
  return `<div class="field" style="display:block">
    <label for="gKlasse" style="display:block;margin-bottom:4px">Art des Außengeräts</label>
    ${sel('gKlasse', k, (Object.keys(GERAETE_NAME) as GeraeteKlasse[]).map((c) => [c, GERAETE_NAME[c].name]))}
    ${k === 'pool' ? `<label class="fine" style="display:flex;gap:8px;align-items:center;text-align:left;margin:8px 0"><input type="checkbox" id="gTags" ${o.nurTags ? 'checked' : ''}> Läuft nur tagsüber (06–22 Uhr) – dann gelten die Tagwerte</label>` : ''}
    <p class="fine" style="text-align:left">Richtwert am Nachbarfenster: ${rw.limit} dB(A) ${rw.zeit.toLowerCase()} (TA Lärm Nr. 6.1) ${tag('TA Lärm', 'rule')} · Schallleistung ${labelLw}</p>
    ${k === 'klima' ? '<p class="fine" style="text-align:left">Klimageräte laufen vor allem im Sommer und oft auch nachts. Dann sind Fenster häufiger offen – Passt. rechnet deshalb nachts.</p>' : ''}
    <label for="gSuche" style="display:block;margin:8px 0 4px">Gerät suchen (Hersteller, Modell) – alle Klassen</label>
    <input id="gSuche" type="search" autocomplete="off" placeholder="z. B. Vaillant VWL 105 oder Daikin EDLA" value="${o.geraet ? esc(`${o.geraet.hersteller} ${o.geraet.modell}`) : ''}" style="width:100%">
    <ul class="rows" id="gTreffer" style="margin-top:6px"></ul>
    <p class="fine" style="text-align:left">Luft-Wasser-Wärmepumpen: Schallleistung im Nennbetrieb nach EN 12102 aus Heat Pump KEYMARK (über hplib, Datenblätter 2016–2021). Für <b>Klimageräte</b> und <b>Pool-Wärmepumpen</b> gibt es noch keine Gerätedatenbank (EPREL braucht einen Schlüssel, KEYMARK enthält nur Wasser-Wärmepumpen): Schallleistung der Außeneinheit aus dem Datenblatt mit dem Regler einstellen. Nachts im Silent-Modus oft leiser.</p>
  </div>`;
}

function geraetSuche() {
  const kl = document.getElementById('gKlasse') as HTMLSelectElement | null;
  kl?.addEventListener('change', () => { setzeGeraeteklasse(kl.value as GeraeteKlasse); renderSheet(); update(); });
  document.getElementById('gTags')?.addEventListener('change', (e) => { st.objs!.waermepumpe.nurTags = (e.target as HTMLInputElement).checked; renderSheet(); update(); });
  const inp = document.getElementById('gSuche') as HTMLInputElement | null;
  if (!inp) return;
  const liste = $('gTreffer');
  inp.addEventListener('input', async () => {
    const q = inp.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!q.length) { liste.innerHTML = ''; return; }
    const alle = await ladeGeraete();
    const treffer = alle.flatMap((l) => l.geraete.map((g) => ({ klasse: l.klasse, g }))).filter(({ g: [h, m] }) => q.every((w) => `${h} ${m}`.toLowerCase().includes(w))).slice(0, 8);
    liste.innerHTML = treffer.length
      ? treffer.map(({ klasse, g: [h, m, lw, datum, kw] }, i) => `<li><span>${esc(h)} ${esc(m)}${kw ? ` · ${fmt(kw, 1)} kW` : ''}<br><small class="fine">${esc(GERAETE_NAME[klasse].name)} · ${fmt(lw, 0)} dB(A) · Datenblatt ${esc(datum)}</small></span><span class="acts"><button type="button" data-g="${i}">Übernehmen</button></span></li>`).join('')
      : `<li><span class="fine">Kein Gerät gefunden.${alle.some((l) => l.klasse !== 'lwwp' && l.geraete.length) ? '' : ' Für Klimageräte und Pool-Wärmepumpen gibt es noch keine Gerätedatenbank.'} Wert aus dem Datenblatt mit dem Regler einstellen.</span></li>`;
    liste.querySelectorAll<HTMLButtonElement>('[data-g]').forEach((b) =>
      b.addEventListener('click', () => {
        const { klasse, g: [h, m, lw, datum] } = treffer[Number(b.dataset.g)];
        setzeGeraeteklasse(klasse);
        const ob = st.objs!.waermepumpe;
        ob.lw = lw;
        ob.geraet = { hersteller: h, modell: m, datum };
        renderSheet();
        update();
      }),
    );
  });
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
    const hinweis = !weg && b.provenance === 'erkannt';
    const herkunft = weg ? tag('verworfen', 'offen') : hinweis ? tag('Hinweis, nicht geprüft', 'erkannt') : tag(b.provenance, b.provenance);
    const dw = !weg ? dachWandText(b) : null;
    return `<li><span>${hinweis ? '<small class="fine">Hier scheint noch etwas zu stehen:</small><br>' : ''}${weg ? '<s>' : ''}${esc(beschreibung(b))}${weg ? '</s>' : ''}${dw ? `<br><small class="fine">${esc(dw)}</small>` : ''}${!weg && grund.has(b.id) ? `<br><small class="fine">${esc(grund.get(b.id)!)}</small>` : ''}</span>
      ${herkunft}
      <span class="acts">${!weg && b.provenance === 'erkannt' ? `<button type="button" data-bok="${b.id}">Stimmt</button>` : ''}
      ${!weg ? `<button type="button" data-kante="${b.id}">Umriss nachziehen</button>` : ''}
      ${!weg ? `<button type="button" data-bno="${b.id}">Gibt es nicht</button>` : `<button type="button" data-bok="${b.id}">Doch</button>`}</span></li>`;
  };
  let h = '<p class="fine" style="text-align:left">Bestehende Gebäude an der Grenze zählen bei den 9 m und 15 m mit – aber nur, was du bestätigt, per Tipp erfasst oder eingezeichnet hast. „Hier scheint noch etwas zu stehen“ ist ein automatischer Hinweis aus Luftbild 2023 und Laser 2025, nicht geprüft und nie Grundlage der Prüfung.</p>';
  h += `<label class="fine" style="display:flex;gap:8px;align-items:flex-start;text-align:left;margin:6px 0"><input type="checkbox" id="lernBox" ${lernEinwilligung() ? 'checked' : ''}> <span>Meine Korrekturen dürfen die Erkennung verbessern: nur Umriss, Art des Objekts und 1-km-Kachel, ohne Adresse und Grenze. <button class="link" type="button" id="lernInfo">Was genau?</button></span></label>`;
  sides.forEach((sd, i) => {
    h += `<h3 style="font-size:14px;margin:12px 0 4px">${esc(cap(sd.grenze))}</h3>`;
    h += seiten[i].length
      ? `<ul class="rows best">${seiten[i].map((b) => item(b as BestandItem)).join('')}</ul>`
      : `<p class="fine" style="text-align:left">Nichts erkannt. <button class="link" type="button" data-neu="${i}">Doch, hier steht etwas</button></p>`;
  });
  if (innen.length) h += `<details><summary>Weitere Objekte im Garten (${innen.length})</summary><ul class="rows best">${innen.map((b) => item(b as BestandItem)).join('')}</ul></details>`;
  h += `<div class="btnrow" style="margin-top:8px"><button class="sec" type="button" id="tippBtn">Ein Tipp erfasst</button><button class="link" type="button" data-neu="">Objekt einzeichnen</button></div>
    <p class="fine" style="text-align:left">Tipp im Luftbild auf ein Gartenhaus, einen Pool oder Carport: Passt. zeichnet den Umriss (SAM 2) und misst die Höhe (Laser). Du prüfst Art und Kanten.</p>`;
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
  tippSt = null;
  zeichnenSeite = null;
  renderer.syncEdit();
  afterContextChange();
}

/** Bedienfeld beim Nachziehen oder Einzeichnen (ersetzt die Prüfansicht, bis fertig). */
function renderEditSheet() {
  const zeichnen = st.zeichnen;
  if (tippSt) return renderTippSheet();
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
      lernBeitrag('nachgezogen', st.bestand[i]);
    } else if (st.zeichnen && st.zeichnen.length >= 4) {
      const k = ($('eKl') as HTMLSelectElement).value as GartenKlasse;
      const h = Math.max(0, parseFloat(($('eH') as HTMLInputElement).value.replace(',', '.')) || 0);
      st.bestand.push({ ...neuesObjekt(`neu-${Date.now()}`, ccw(st.zeichnen), k, h), status: 'aktiv' });
      lernBeitrag('neu', st.bestand[st.bestand.length - 1]);
    }
    endEdit();
  });
}

/** „Ein Tipp erfasst“: Dienst fragen (/api/tipp), Ergebnis als Vorschau in den Bestand. */
async function tippAusfuehren(g: Vec2) {
  if (!tippSt) return;
  tippSt = { phase: 'laeuft' };
  renderSheet();
  const o = getOrigin();
  try {
    const r = await fetch('api/tipp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: g[0] + o[0], y: g[1] + o[1] }) });
    const a = (await r.json()) as TippAntwort;
    if (!tippSt) return; // abgebrochen
    if (!a.ok) {
      tippSt = { phase: 'warten', fehler: a.grund ?? 'Kein Umriss gefunden.' };
    } else {
      const id = `tipp-${Date.now()}`;
      st.bestand.push({ ...ausTipp(id, a, o), status: 'aktiv' });
      tippSt = { phase: 'fertig', antwort: a, id };
      afterContextChange();
      return;
    }
  } catch {
    if (!tippSt) return;
    tippSt = { phase: 'warten', fehler: 'Der Tipp-Dienst ist nicht erreichbar. Du kannst das Objekt einzeichnen.' };
  }
  renderSheet();
}

function renderTippSheet() {
  const t = tippSt!;
  if (t.phase !== 'fertig') {
    verdict(t.phase === 'laeuft' ? 'Passt. zeichnet den Umriss …' : 'Ein Tipp erfasst.',
      t.phase === 'laeuft' ? 'Umriss aus dem Luftbild (SAM 2), Höhe aus dem Laser. Das dauert ein paar Sekunden.'
        : t.fehler ?? 'Tipp im Luftbild mitten auf das Objekt – Gartenhaus, Pool, Carport, Gewächshaus.');
    $('stepBody').innerHTML = `<div class="btnrow"><button class="sec" id="eNo" type="button">Abbrechen</button>${t.fehler ? '<button class="link" type="button" id="tZeichnen">Lieber einzeichnen</button>' : ''}</div>`;
    document.getElementById('eNo')?.addEventListener('click', endEdit);
    document.getElementById('tZeichnen')?.addEventListener('click', () => { tippSt = null; st.zeichnen = []; renderer.syncEdit(); renderSheet(); });
    return;
  }
  const it = st.bestand.find((x) => x.id === t.id)!;
  const a = t.antwort!;
  const vor = a.vorschlag?.[0];
  const dw = dachWandText(it);
  verdict('Stimmt der Umriss?', `${beschreibung(it)}. Erfasst per Tipp: Der Umriss im Luftbild 2023 ist das Dach, die Wand liegt um den Dachüberstand weiter innen. Geprüft wird mit der Wand. Höhe aus dem Laser 2025, Maße mit Spanne.`);
  const u0 = it.ueberstand ? it.ueberstand.werte.reduce((a, b) => a + b, 0) / it.ueberstand.werte.length : 0;
  const kl: GartenKlasse[] = ['gartenhaus', 'carport_garage', 'gewaechshaus', 'pool', 'trampolin', 'spielturm', 'terrasse', 'teich', 'hecke', 'baum', 'strauch', 'waermepumpe'];
  const h = it.height;
  $('stepBody').innerHTML = `
    <div class="field"><span>Was ist es? ${vor ? tag(`Vorschlag: ${KLASSE_TEXT[vor.klasse]}`, 'erkannt') : ''}</span>${sel('tKl', it.kind ?? 'gartenhaus', kl.map((k) => [k, KLASSE_TEXT[k]]))}</div>
    <div class="field"><label for="tH">Mittlere Wandhöhe in m ${tag('Laser 2025', 'berechnet')}</label><input id="tH" type="number" min="0" max="8" step="0.05" value="${h.toFixed(2)}" inputmode="decimal"></div>
    ${dw ? `<p class="fine" style="text-align:left">${esc(dw)} ${tag(wandLabelVon(it)!, wandLabelVon(it)!)}</p>
    <div class="field"><label for="tU">Dachüberstand in m (rundum)</label><input id="tU" type="number" min="0" max="1.5" step="0.05" value="${u0.toFixed(2)}" inputmode="decimal"></div>` : ''}
    <div class="btnrow"><button class="primary" id="tOk" type="button">Übernehmen</button>
      <button class="sec" id="tKante" type="button">Kanten nachziehen</button>
      <button class="sec" id="tNo" type="button">Verwerfen</button></div>
    <p class="fine" style="text-align:left">${esc(a.quelle ?? '')}</p>`;
  const uebernehmen = () => {
    const k = ($('tKl') as HTMLSelectElement).value as GartenKlasse;
    const hw = Math.max(0, parseFloat(($('tH') as HTMLInputElement).value.replace(',', '.')) || 0);
    const i = st.bestand.findIndex((x) => x.id === t.id);
    const geaendert = Math.abs(hw - h) > 0.01 ? hw : undefined;
    const uIn = document.getElementById('tU') as HTMLInputElement | null;
    const uNeu = uIn ? Math.max(0, parseFloat(uIn.value.replace(',', '.')) || 0) : undefined;
    const uGeaendert = uNeu != null && Math.abs(uNeu - u0) > 0.01 ? uNeu : undefined;
    st.bestand[i] = { ...ausTipp(t.id!, a, getOrigin(), k, geaendert, uGeaendert), status: 'aktiv' };
    lernBeitrag('neu', st.bestand[i]);
    return st.bestand[i];
  };
  document.getElementById('tOk')?.addEventListener('click', () => { uebernehmen(); endEdit(); });
  document.getElementById('tKante')?.addEventListener('click', () => {
    const b = uebernehmen();
    tippSt = null;
    st.kante = { id: b.id, fp: griffe(b), ref: b.footprint };
    renderer.syncEdit();
    renderSheet();
  });
  document.getElementById('tNo')?.addEventListener('click', () => {
    st.bestand = st.bestand.filter((x) => x.id !== t.id);
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
  let pDrag: Vec2 | null = null;
  let gDrag: Vec2 | null = null;
  let ecke: number | null = null;
  let downAt: Cartesian2 | null = null;

  h.setInputAction((e: { position: Cartesian2 }) => {
    downAt = Cartesian2.clone(e.position);
    if (st.step !== 'pruefen' || !st.objs || st.ansicht === 'nachbar') return;
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
    if (key === KEY_VORHABEN && st.modus === 'gross' && grSt.v && grSt.v.art !== 'aufstockung') {
      const g = pickGround(e.position);
      if (!g) return;
      gDrag = grSt.v.art === 'wohnhaus' ? [grSt.v.center[0] - g[0], grSt.v.center[1] - g[1]] : [0, 0];
      v.scene.screenSpaceCameraController.enableInputs = false;
      st.hasDragged = true;
      hint(null);
      return;
    }
    if (key === 'pflanze' && st.pflanze) {
      const g = pickGround(e.position);
      if (!g) return;
      pDrag = [st.pflanze.center[0] - g[0], st.pflanze.center[1] - g[1]];
      v.scene.screenSpaceCameraController.enableInputs = false;
      st.hasDragged = true;
      hint(null);
      return;
    }
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
    if (gDrag) {
      const g = pickGround(e.endPosition);
      if (g) grZiehen(g, gDrag);
      return;
    }
    if (pDrag && st.pflanze) {
      const g = pickGround(e.endPosition);
      if (!g) return;
      st.pflanze.center = [Math.round((g[0] + pDrag[0]) * 20) / 20, Math.round((g[1] + pDrag[1]) * 20) / 20];
      update();
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
    const wasDrag = !!drag || ecke != null || !!pDrag || !!gDrag;
    drag = null;
    pDrag = null;
    gDrag = null;
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
    } else if (st.step === 'pruefen' && tippSt?.phase === 'warten') {
      const g = pickGround(e.position);
      if (g) void tippAusfuehren(g);
    } else if (st.step === 'pruefen' && st.zeichnen) {
      const g = pickGround(e.position);
      if (g && st.zeichnen.length < 4) {
        st.zeichnen.push(snapEdit(g));
        renderer.syncEdit();
        renderSheet();
      }
    } else if (st.step === 'pruefen' && st.ansicht === 'nachbar') {
      if (nbSt.tippen) setBlick(e.position);
    } else if (st.step === 'pruefen' && st.modus === 'pflanzen' && pflSt.stammTippen) {
      const g = pickGround(e.position);
      if (g) setStamm(g);
    } else if (st.step === 'pruefen' && st.modus === 'objekt' && st.selected === 'waermepumpe') {
      const picked = v.scene.pick(e.position);
      if (picked && (picked.primitive instanceof Cesium3DTileset || picked.tileset)) {
        const c = v.scene.pickPosition(e.position);
        if (c) setWindow(c);
      }
    }
  }, ScreenSpaceEventType.LEFT_UP);

  // Tastatur: Pfeile verschieben relativ zur Blickrichtung, R dreht um 90°
  $('stage').addEventListener('keydown', (e) => {
    if (e.target !== $('stage') || st.step !== 'pruefen' || !st.objs || st.ansicht === 'nachbar') return;
    if (st.modus === 'gross') {
      const gv = grSt.v;
      if (!gv || gv.art !== 'wohnhaus') return;
      if (e.key === 'r' || e.key === 'R') { gv.angle = ((gv.angle + Math.PI / 2 + Math.PI / 2) % Math.PI) - Math.PI / 2; renderSheet(); e.preventDefault(); return; }
      const mg = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] } as Record<string, [number, number]>)[e.key];
      if (!mg) return;
      const sg = e.shiftKey ? 0.5 : 0.1;
      const hg = v.camera.heading;
      gv.center = [gv.center[0] + (Math.cos(hg) * mg[0] + Math.sin(hg) * mg[1]) * sg, gv.center[1] + (-Math.sin(hg) * mg[0] + Math.cos(hg) * mg[1]) * sg];
      e.preventDefault();
      grNeu();
      return;
    }
    const o: { center: Vec2; angle: number } = st.modus === 'pflanzen' && st.pflanze ? st.pflanze : st.objs[st.selected];
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
  $('gbBtn').addEventListener('click', () => void gartenblick(!gbSt.an));
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
    h += `<div class="rep"><div class="rep-h"><span class="d ${r.status}"></span><strong>${tabName(k)}</strong><span class="rep-s">${WORD[r.status]}</span></div><p class="rep-t">${esc(r.head)} ${esc(r.sub)}</p></div>`;
  }
  if (pflSt.benutzt && st.pflanzRes && st.pflanze) {
    const r = st.pflanzRes;
    const nb = bestandsPflanzen({ ...site, bestand: [...site.bestand, ...pflSt.nachbar] }, pflSt.angaben);
    h += `<div class="rep"><div class="rep-h"><span class="d ${r.status}"></span><strong>${esc(PFL_ART.find((a) => a[0] === st.pflanze!.art)![1])} (Nachbarrecht)</strong><span class="rep-s">${WORD[r.status]}</span></div><p class="rep-t">${esc(r.head)} ${esc(r.sub)}</p>
      <ul class="plain">${r.rows.map((x) => `<li>${esc(x.text)} (${esc(x.tag)})</li>`).join('')}</ul>
      ${nb.length ? `<p class="rep-t">Pflanzen an der Grenze (Messung, keine Bewertung):</p><ul class="plain">${nb.map((x) => `<li>${esc(pflanzenText(site!, x))} (${esc(x.provenance)})</li>`).join('')}</ul>` : ''}
      <p class="m-fine">Wortlaut AGBGB Art. 47–52 aus gesetze.legal und GVBl 1982 verglichen, nicht von einer Fachperson geprüft.</p></div>`;
  }
  if (grSt.benutzt && grSt.res && grSt.v) h += grossReport();
  const best = st.bestand.filter((b) => b.status === 'aktiv');
  h += `<h3>Was wir angenommen haben</h3><ul class="plain">
    <li>${plotProvenance === 'Demo' ? 'Grundstücksgrenze für die Demo nach der Flurkarte nachgezeichnet (Demo) – nicht amtlich' : 'Grundstücksgrenze von dir gesetzt (nutzerbestätigt), Flurkarte nur als Hilfslinie'}</li>
    <li>${esc(GEBIET_TEXT[st.gebiet.value])} (${esc(st.gebiet.provenance)}), ${st.bereich.value === 'innen' ? 'Innenbereich' : 'Außenbereich'} (${esc(st.bereich.provenance)})</li>
    ${data.site.lage && st.bereich.provenance === 'Annahme' ? `<li>Lage-Annahme: ${esc(data.site.lage.grund)} Im Außenbereich gilt Art. 57 enger: ${LIMITS.gartenhaus.aussenbereichMaxM3.wert} m³ statt ${LIMITS.gartenhaus.maxBruttoRauminhaltM3.wert} m³ und keine Garagen-Freistellung (Annahme)</li>` : ''}
    ${data.site.mess ? '<li>Mess-Adresse, keine Demo: Objekte werden vor Ort mit dem Maßband gemessen</li>' : ''}
    <li>Gartenhaus ${st.aufenthaltsraum.value ? 'mit' : 'ohne'} Aufenthaltsraum und ${st.feuerstaette.value ? 'mit' : 'ohne'} Feuerstätte (${esc(st.aufenthaltsraum.provenance)})</li>
    <li>Abstandsfläche 0,4 H, mindestens 3 m; Gemeindesatzungen können abweichen</li>
    <li>Wandhöhe über dem Gelände aus DGM1 gemessen, Fußboden am höchsten Geländepunkt</li>
    ${bestandReport(best)}
    <li>Nachbarfenster: ${st.windows.filter((w) => w.provenance !== 'Annahme').length} von dir gesetzt, ${st.windows.filter((w) => w.provenance === 'Annahme').length} angenommen (Fassadenmitte, 1,6 m)</li>
    <li>Schall vereinfacht nach LAI-Leitfaden, ohne Zuschläge</li>
    <li>Denkmal: ${st.denkmal == null ? 'nicht abgefragt (offen)' : st.denkmal.length ? st.denkmal.map((d) => `${esc(d.art)} ${esc(d.aktennummer)}`).join(', ') + ' (amtlich, © BLfD)' : 'kein Denkmal am Grundstück (amtlich, © BLfD)'}</li>
    <li>Trinkwasserschutzgebiet: ${st.wsg == null ? 'nicht abgefragt (offen)' : st.wsg.length ? esc(st.wsg.join(', ')) : 'nein'}${st.wsg != null ? ' (amtlich, Datenquelle: Bayerisches Landesamt für Umwelt)' : ''}</li>
    <li>Bebauungsplan: ${bplanReport()}${data.site.gemeinde.bauleitplanung_url ? ` – <a href="${esc(data.site.gemeinde.bauleitplanung_url)}" target="_blank" rel="noopener">Pläne der Stadt</a>` : ''}</li>
  </ul>`;
  if (!LIMITS.geprueft) h += `<p class="m-fine">Die Grenzwerte sind noch nicht von einer Fachperson geprüft.</p>`;
  h += `<p class="m-fine">Orientierung, keine Genehmigung. Verbindlich entscheidet das Bauamt.</p>`;
  h += `<p class="m-fine">Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (LoD2, Hausumringe, DGM1, DOM20, DOP20; CC BY 4.0). Quasigeoid GCG2016: © BKG (CC BY 4.0).</p>`;
  openModal('Prüfbericht', h);
}

function bplanReport(): string {
  const pl = grSt.plaene;
  if (pl === undefined) return 'nicht abgefragt (offen)';
  if (pl === null) return 'Landesportal nicht erreichbar (offen)';
  const rk = pl.filter((x) => x.art === 'rechtskraft');
  if (!rk.length) return 'laut Landesportal keiner (das Portal ist nicht flächendeckend; amtlich, Bauleitplanung Bayern). Inhalt wird nie ausgelesen';
  return `${rk.map((x) => `„${esc(x.name)}“${x.planUrl ? ` (<a href="${esc(x.planUrl)}" target="_blank" rel="noopener">Plan</a>)` : ''}`).join(', ')} laut Landesportal (amtlich, nur Verweis – Festsetzungen nicht geprüft)`;
}

/** Prüfbericht: Abschnitt „Großes Vorhaben“ (Ampel nur für Messbares, Planungsrecht als Wegweiser). */
function grossReport(): string {
  const r = grSt.res!;
  const v = grSt.v!;
  const g = grSt.gemeinde;
  return `<div class="rep"><div class="rep-h"><span class="d ${r.status ?? ''}"></span><strong>${esc(VORHABEN_NAME[v.art].name)} (Stockwerk 3)</strong><span class="rep-s">${r.status ? WORD[r.status] : 'offen'}</span></div><p class="rep-t">${esc(r.head)} ${esc(r.sub)}</p>
    ${punkteHtml(r.punkte, tag)}
    ${kennzahlenHtml(r.kennzahlen, v.art, tag)}
    <ul class="plain">${r.rows.map((x) => `<li>${esc(x.text)} (${esc(x.tag)})</li>`).join('')}</ul>
    ${schattenHtml(grSt.schatten, false, tag)}
    ${g ? gemeindeHtml(g, tag) : ''}</div>`;
}

/** Prüfbericht: welche bestehenden Objekte bei der Grenzbebauung mitgezählt wurden und welche nicht. */
function bestandReport(best: BestandItem[]): string {
  if (!site) return '';
  const z = zaehleBestand({ ...site, bestand: best });
  const name = (id: string) => esc(beschreibung(best.find((b) => b.id === id)!));
  const ja = z.gezaehlt.map((x) => `${name(x.id)} – ${esc(x.grund)}`);
  const nein = z.nicht.filter((x) => x.grund !== 'kein Gebäude').map((x) => `${name(x.id)} – ${esc(x.grund)}`);
  const verworfen = st.bestand.filter((b) => b.status === 'entfernt').length;
  return `<li>Grenzbebauung (9 m / 15 m): ${ja.length ? `mitgezählt ${ja.length} bestehende${ja.length === 1 ? 's Gebäude' : ' Gebäude'}: ${ja.join('; ')}` : 'keine bestehenden Gebäude mitgezählt'}${nein.length ? `. Nicht mitgezählt (nur automatischer Hinweis, nicht geprüft): ${nein.join('; ')}` : ''}${verworfen ? `. ${verworfen} Hinweis${verworfen === 1 ? '' : 'e'} von dir verworfen` : ''}. Gezählt wird nur, was du bestätigt, per Tipp erfasst oder eingezeichnet hast; Maße mit Spanne.</li>`;
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
      <li><span class="tg det">erkannt</span>Automatischer Hinweis, nicht geprüft – nie Grundlage der Prüfung</li>
      <li><span class="tg user">erfasst per Tipp</span>Du hast getippt, Passt. hat Umriss (SAM 2) und Höhe (Laser) gemessen</li>
      <li><span class="tg assume">geschätzt</span>Wandumriss = Dachumriss minus Dachüberstand (aus Laser oder angenommen 0,3 m)</li>
      <li><span class="tg user">nutzerbestätigt</span>Von dir angegeben – auch sobald du bei „erfasst per Tipp“ oder „geschätzt“ eine Kante nachziehst oder einen Wert änderst</li>
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
    // Lage-Annahme des Gebiets (Mess-Adresse im Außenbereich): Label Annahme, im Formular änderbar
    if (site.lage) st.bereich = { value: site.lage.bereich, provenance: 'Annahme' };
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

  // Startansicht: Altstadt (Demo) bzw. Mess-Adresse schräg von Süden
  frame(data.site.mess?.start ?? [-150, -100], 260, '3d', false);
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
  if (location.hash.startsWith('#n=')) void startNachbar(location.hash.slice(3));
  else showStart();

  // Test-Schnittstelle für automatisierte Durchläufe (nur mit ?debug)
  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, {
      passt: {
        st,
        zonen: zonenSt,
        pflSt,
        nbSt,
        gr: grSt,
        grStart,
        grArt,
        grRechnen: () => grRechnen(),
        rechne,
        grNeu,
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
        tilesLoaded: () => {
          scene.viewer.scene.requestRender();
          return scene.viewer.scene.globe.tilesLoaded && (!scene.tileset?.show || !!scene.tileset?.tilesLoaded);
        },
        frame: (c: Vec2, r: number, v: '3d' | 'plan') => frame(c, r, v, false),
        /** „Ein Tipp erfasst“ ohne Bildschirm-Tipp (Test): Tipp-Modus öffnen und auf lokale Position tippen. */
        tipp: async (p: Vec2) => {
          tippSt = { phase: 'warten' };
          startEdit();
          await tippAusfuehren(p);
          return tippSt;
        },
        setMesh: async (on: boolean) => {
          st.mesh = on && (await scene.setMesh(on));
          renderer.syncPlot(badSegments);
          return st.mesh;
        },
        /** Gartenblick-Daten (Phase 5.2): Kamera auf lokale Position (x, y, Ellipsoidhöhe) mit Blick auf ein Ziel. */
        kamera: (p: [number, number, number], ziel: [number, number, number], fovGrad: number) => {
          const v = scene.viewer;
          v.scene.screenSpaceCameraController.minimumZoomDistance = 0.5;
          v.scene.screenSpaceCameraController.enableCollisionDetection = false;
          const pos = localToCartesian([p[0], p[1]], p[2]);
          const z = localToCartesian([ziel[0], ziel[1]], ziel[2]);
          const dir = Cartesian3.normalize(Cartesian3.subtract(z, pos, new Cartesian3()), new Cartesian3());
          const oben = Cartesian3.normalize(pos, new Cartesian3());
          const rechts = Cartesian3.normalize(Cartesian3.cross(dir, oben, new Cartesian3()), new Cartesian3());
          const up = Cartesian3.normalize(Cartesian3.cross(rechts, dir, new Cartesian3()), new Cartesian3());
          (v.camera.frustum as unknown as { fov: number }).fov = CMath.toRadians(fovGrad);
          v.camera.setView({ destination: pos, orientation: { direction: dir, up } });
          v.scene.requestRender();
        },
        /** Kamera in lokalen Koordinaten: Position, Punkt 1 m voraus, Punkt 1 m oben; Bildgröße und Öffnungswinkel. */
        kameraInfo: () => {
          const c = scene.viewer.camera;
          const loc = (x: Cartesian3) => { const r = cartesianToLocal(x); return [r.p[0], r.p[1], r.h]; };
          const vor = Cartesian3.add(c.positionWC, c.directionWC, new Cartesian3());
          const auf = Cartesian3.add(c.positionWC, c.upWC, new Cartesian3());
          const cv = scene.viewer.canvas;
          return { pos: loc(c.positionWC), vor: loc(vor), auf: loc(auf), fov: (c.frustum as unknown as { fov: number }).fov, w: cv.width, h: cv.height };
        },
        /** Geländehöhe (Ellipsoid) an einem lokalen Punkt */
        boden: (p: [number, number]) => terrain.heightOrCoarse(p),
        /** Nur Mesh und Gelände zeigen (keine Linien, Objekte, Beschriftungen). */
        nurMesh: async () => {
          await scene.setMesh(true);
          st.mesh = true;
          (scene.viewer as unknown as { entities: { show: boolean } }).entities.show = false;
          // feinste Detailstufe für die Aufnahmen (langsamer, aber scharf)
          const prims = scene.viewer.scene.primitives;
          for (let i = 0; i < prims.length; i++) {
            const t = prims.get(i);
            if (t !== scene.tileset && t.maximumScreenSpaceError !== undefined) t.maximumScreenSpaceError = 2;
          }
          scene.viewer.scene.globe.maximumScreenSpaceError = 2;
          zonenLayer?.weg();
          pflanzLayer?.weg();
          const css = document.createElement('style');
          css.textContent = '.bar,.sheet,.viewctl,.hint,.dim,.loading{display:none!important}.app,.stage{display:block!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important}#map{position:absolute!important;inset:0!important}';
          document.head.appendChild(css);
          window.dispatchEvent(new Event('resize'));
          scene.viewer.scene.requestRender();
        },
        meshLoaded: () => {
          scene.viewer.scene.requestRender(); // requestRenderMode: ohne neue Bilder lädt Cesium keine Kacheln nach
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
