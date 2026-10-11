/**
 * Import-Panel „Haus aus deinem Plan“ (AUFTRAG_V4 C2): IFC (Weg A) oder PDF/Foto (Weg B).
 *
 * Datenschutz: Die Datei wird nur im Arbeitsspeicher dieser Sitzung gelesen, nicht hochgeladen und nicht gespeichert.
 * Weg B ist klassische Bildverarbeitung (keine KI): Passt. findet die Außenkontur; den Maßstab bestätigt der Nutzer
 * („Diese Wand ist … m lang“), die Ecken sind nachziehbar, Fenster tippt der Nutzer selbst.
 */
import { bildKontur, planAusBild, type Bild } from '../hausplan/bild';
import type { HausPlan } from '../hausplan/typen';
import type { Vec2 } from '../rules/types';
import { fmt } from '../rules/evaluate';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface PanelHooks {
  /** Label-Chip als HTML */
  tag: (text: string, kind: string) => string;
  /** fertiger Plan */
  onPlan: (plan: HausPlan) => void;
  /** Beispieldateien (URL relativ zur App) */
  beispiele: { name: string; url: string }[];
}

type Modus = 'ziehen' | 'plus' | 'minus' | 'wand' | 'fenster';

/** Zeichenfläche: Bild, Umriss, Ecken, Bezugswand, Fenster. Alle Koordinaten in Bildpixeln. */
class BildEditor {
  px: Vec2[];
  wand: number | null = null;
  fenster: { px: Vec2; geschoss: number }[] = [];
  modus: Modus = 'ziehen';
  fensterGeschoss = 0;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hintergrund: HTMLCanvasElement;
  private s = 1;
  private zieh: number | null = null;

  constructor(host: HTMLElement, private bild: Bild, px: Vec2[], private onChange: () => void) {
    this.px = px.map((p): Vec2 => [p[0], p[1]]);
    this.hintergrund = document.createElement('canvas');
    this.hintergrund.width = bild.width;
    this.hintergrund.height = bild.height;
    this.hintergrund.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(bild.data), bild.width, bild.height), 0, 0);
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;touch-action:none;border-radius:10px;background:#fff;box-shadow:inset 0 0 0 1px var(--line);display:block';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    const breite = Math.max(280, Math.min(host.clientWidth || 340, 640));
    this.s = breite / bild.width;
    this.canvas.width = Math.round(breite * (window.devicePixelRatio || 1));
    this.canvas.height = Math.round(bild.height * this.s * (window.devicePixelRatio || 1));
    this.canvas.style.aspectRatio = `${bild.width} / ${bild.height}`;
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
    this.zeichne();
  }

  private pos(e: PointerEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * this.bild.width, ((e.clientY - r.top) / r.height) * this.bild.height];
  }
  private tol() {
    // 14 CSS-Pixel Trefferfläche, in Bildpixeln
    const r = this.canvas.getBoundingClientRect();
    return (14 / r.width) * this.bild.width;
  }
  private naechsteEcke(p: Vec2): number {
    let best = -1;
    let d = this.tol();
    this.px.forEach((q, i) => {
      const x = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (x < d) { d = x; best = i; }
    });
    return best;
  }
  private naechsteKante(p: Vec2): { i: number; d: number; q: Vec2 } {
    let best = { i: -1, d: Infinity, q: p };
    this.px.forEach((a, i) => {
      const b = this.px[(i + 1) % this.px.length];
      const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2));
      const q: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < best.d) best = { i, d, q };
    });
    return best;
  }

  private down(e: PointerEvent) {
    const p = this.pos(e);
    if (this.modus === 'ziehen') {
      const i = this.naechsteEcke(p);
      if (i >= 0) { this.zieh = i; this.canvas.setPointerCapture(e.pointerId); }
    } else if (this.modus === 'plus') {
      const k = this.naechsteKante(p);
      if (k.i >= 0 && k.d < this.tol() * 2) { this.px.splice(k.i + 1, 0, k.q); this.zieh = k.i + 1; this.modus = 'ziehen'; this.canvas.setPointerCapture(e.pointerId); }
    } else if (this.modus === 'minus') {
      const i = this.naechsteEcke(p);
      if (i >= 0 && this.px.length > 3) this.px.splice(i, 1);
    } else if (this.modus === 'wand') {
      const k = this.naechsteKante(p);
      if (k.i >= 0 && k.d < this.tol() * 3) this.wand = k.i;
    } else if (this.modus === 'fenster') {
      const nahe = this.fenster.findIndex((f) => Math.hypot(f.px[0] - p[0], f.px[1] - p[1]) < this.tol());
      if (nahe >= 0) this.fenster.splice(nahe, 1);
      else {
        const k = this.naechsteKante(p);
        if (k.i >= 0 && k.d < this.tol() * 4) this.fenster.push({ px: k.q, geschoss: this.fensterGeschoss });
      }
    }
    this.zeichne();
    this.onChange();
  }
  private move(e: PointerEvent) {
    if (this.zieh == null) return;
    const p = this.pos(e);
    this.px[this.zieh] = [Math.max(0, Math.min(this.bild.width, p[0])), Math.max(0, Math.min(this.bild.height, p[1]))];
    this.zeichne();
    this.onChange();
  }
  private up(e: PointerEvent) {
    if (this.zieh == null) return;
    this.zieh = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* schon losgelassen */ }
  }

  zeichne() {
    const c = this.ctx;
    const k = this.canvas.width / this.bild.width;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.hintergrund, 0, 0, this.canvas.width, this.canvas.height);
    c.lineJoin = 'round';
    c.beginPath();
    this.px.forEach((p, i) => (i ? c.lineTo(p[0] * k, p[1] * k) : c.moveTo(p[0] * k, p[1] * k)));
    c.closePath();
    c.fillStyle = 'rgba(46,125,91,0.16)';
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = '#2E7D5B';
    c.stroke();
    if (this.wand != null) {
      const a = this.px[this.wand];
      const b = this.px[(this.wand + 1) % this.px.length];
      c.beginPath();
      c.moveTo(a[0] * k, a[1] * k);
      c.lineTo(b[0] * k, b[1] * k);
      c.lineWidth = 6;
      c.strokeStyle = '#2B59C3';
      c.stroke();
    }
    for (const p of this.px) {
      c.beginPath();
      c.arc(p[0] * k, p[1] * k, 7, 0, Math.PI * 2);
      c.fillStyle = '#fff';
      c.fill();
      c.lineWidth = 2.5;
      c.strokeStyle = '#1D2321';
      c.stroke();
    }
    for (const f of this.fenster) {
      c.fillStyle = f.geschoss === 0 ? '#2B8CE0' : '#A06410';
      c.fillRect(f.px[0] * k - 6, f.px[1] * k - 6, 12, 12);
      c.fillStyle = '#fff';
      c.font = '600 9px sans-serif';
      c.textAlign = 'center';
      c.fillText(String(f.geschoss), f.px[0] * k, f.px[1] * k + 3);
    }
  }
}

/** Zufälligen Ausgangsumriss, wenn nichts erkannt wurde: ein Rechteck in der Bildmitte zum Zurechtziehen. */
const startRechteck = (b: Bild): Vec2[] => [
  [b.width * 0.25, b.height * 0.25],
  [b.width * 0.75, b.height * 0.25],
  [b.width * 0.75, b.height * 0.75],
  [b.width * 0.25, b.height * 0.75],
];

export function mountImport(el: HTMLElement, h: PanelHooks) {
  let editor: BildEditor | null = null;
  let bild: Bild | null = null;
  let pdfDaten: Uint8Array | null = null;
  let seiten = 1;
  let seite = 1;
  const eing = { laenge: 0, geschosse: 2, geschosshoehe: 2.8, dach: 'sattel' as 'flach' | 'sattel' | 'pult', neigung: 35, name: 'Plan' };

  const grundHtml = () => `
    <p class="fine" style="text-align:left;margin:4px 0 8px">Lade den Plan deines Hauses und stell es auf dein Grundstück. Du kannst eine <b>IFC-Datei</b> nehmen (Passt. liest Wände, Geschosse, Dach, Fenster und Räume) oder einen <b>Grundriss als PDF oder Foto</b> (Passt. findet den Umriss, du bestätigst den Maßstab). Keine Herstellerpläne aus Katalogen verwenden.</p>
    <p class="fine" style="text-align:left">Datenschutz: Dein Plan wird nur hier in deinem Browser gelesen. Er wird nicht hochgeladen und nicht gespeichert.</p>
    <div class="btnrow">
      <label class="sec" style="display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:10px 14px"><input type="file" id="hpIfc" accept=".ifc" style="display:none">IFC-Datei wählen</label>
      <label class="sec" style="display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:10px 14px"><input type="file" id="hpBild" accept=".pdf,application/pdf,image/*" style="display:none">PDF oder Foto wählen</label>
    </div>
    <p class="fine" style="text-align:left;margin-top:10px">Zum Ausprobieren: ${h.beispiele.map((b, i) => `<button class="link" type="button" data-hpbsp="${i}">${esc(b.name)}</button>`).join(' · ')}</p>
    <div id="hpStatus" aria-live="polite"></div>
    <div id="hpEditor"></div>`;

  const status = (html: string, warn = false) => {
    const s = el.querySelector('#hpStatus');
    if (s) s.innerHTML = html ? `<p class="${warn ? 'warnbox' : 'fine'}" style="text-align:left">${html}</p>` : '';
  };

  async function ifcLaden(daten: Uint8Array, name: string) {
    status('Lese das IFC-Modell …');
    try {
      const { ladeIfc } = await import('../hausplan/lader');
      const plan = await ladeIfc(daten, name);
      h.onPlan(plan);
    } catch (e) {
      status(`Die IFC-Datei konnte nicht gelesen werden: ${esc((e as Error).message)}`, true);
    }
  }

  async function bildLaden(datei: File | Blob, name: string) {
    status('Lese den Plan …');
    try {
      const { ladeFoto, ladePdfSeite } = await import('../hausplan/lader');
      if (name.toLowerCase().endsWith('.pdf') || (datei as File).type === 'application/pdf') {
        pdfDaten = new Uint8Array(await datei.arrayBuffer());
        const r = await ladePdfSeite(pdfDaten, 1);
        bild = r.bild;
        seiten = r.seiten;
        seite = 1;
      } else {
        pdfDaten = null;
        seiten = 1;
        bild = await ladeFoto(datei);
      }
      eing.name = name;
      bildStarten();
    } catch (e) {
      status(`Der Plan konnte nicht gelesen werden: ${esc((e as Error).message)}`, true);
    }
  }

  function bildStarten() {
    if (!bild) return;
    const k = bildKontur(bild);
    const px = k ? k.px : startRechteck(bild);
    status(
      k
        ? `Umriss erkannt (klassische Bildverarbeitung, keine KI). ${h.tag('erkannt', 'erkannt')} Prüf ihn und zieh die Ecken, wo er nicht stimmt.`
        : 'Passt. hat keinen Gebäudeumriss gefunden. Zieh das grüne Rechteck auf die Außenwände deines Hauses (Ecken ziehen, Ecken hinzufügen).',
      !k,
    );
    eing.laenge = 0;
    const host = el.querySelector<HTMLElement>('#hpEditor')!;
    host.innerHTML = `
      ${seiten > 1 ? `<div class="field"><span>PDF-Seite (${seiten} Seiten)</span><select id="hpSeite">${Array.from({ length: seiten }, (_, i) => `<option value="${i + 1}" ${i + 1 === seite ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>` : ''}
      <div class="objects" role="group" aria-label="Was willst du tun?" id="hpModi">
        <button class="obj" type="button" data-m="ziehen" aria-selected="true">Ecken ziehen</button>
        <button class="obj" type="button" data-m="plus" aria-selected="false">Ecke dazu</button>
        <button class="obj" type="button" data-m="minus" aria-selected="false">Ecke weg</button>
        <button class="obj" type="button" data-m="wand" aria-selected="false">Maßstab</button>
        <button class="obj" type="button" data-m="fenster" aria-selected="false">Fenster</button>
      </div>
      <div id="hpHinweis" class="fine" style="text-align:left;margin:6px 0"></div>
      <div id="hpCanvas"></div>
      <div id="hpFelder"></div>`;
    editor = new BildEditor(host.querySelector<HTMLElement>('#hpCanvas')!, bild, px, felder);
    host.querySelectorAll<HTMLButtonElement>('#hpModi .obj').forEach((b) =>
      b.addEventListener('click', () => {
        editor!.modus = b.dataset.m as Modus;
        host.querySelectorAll<HTMLButtonElement>('#hpModi .obj').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        hinweis();
      }),
    );
    host.querySelector('#hpSeite')?.addEventListener('change', async (e) => {
      if (!pdfDaten) return;
      seite = Number((e.target as HTMLSelectElement).value);
      const { ladePdfSeite } = await import('../hausplan/lader');
      bild = (await ladePdfSeite(pdfDaten, seite)).bild;
      bildStarten();
    });
    hinweis();
    felder();
  }

  function hinweis() {
    const t = el.querySelector('#hpHinweis');
    if (!t || !editor) return;
    t.textContent = {
      ziehen: 'Zieh die weißen Punkte auf die Außenkanten der Wände.',
      plus: 'Tipp auf eine Kante, um dort eine Ecke einzufügen.',
      minus: 'Tipp auf eine Ecke, um sie zu entfernen.',
      wand: 'Tipp auf eine Wand, deren Länge du kennst (blau). Dann trägst du die Länge unten ein. Ohne bestätigten Maßstab rechnet Passt. nicht.',
      fenster: 'Tipp auf die Wand, wo ein Fenster sitzt. Tipp auf ein Fenster, um es zu löschen.',
    }[editor.modus];
  }

  function felder() {
    const f = el.querySelector<HTMLElement>('#hpFelder');
    if (!f || !editor || !bild) return;
    const w = editor.wand;
    let mpp = 0;
    let wandPx = 0;
    if (w != null && eing.laenge > 0) {
      const a = editor.px[w];
      const b = editor.px[(w + 1) % editor.px.length];
      wandPx = Math.hypot(b[0] - a[0], b[1] - a[1]);
      mpp = eing.laenge / wandPx;
    }
    // Eingabefelder nur einmal aufbauen (sonst verliert das Textfeld beim Ziehen den Fokus)
    if (!f.dataset.gebaut) {
      f.dataset.gebaut = '1';
      f.innerHTML = `
        <div class="field"><span>Länge der blauen Wand (m) ${h.tag('nutzerbestätigt', 'nutzerbestätigt')}</span><input id="hpLaenge" type="number" inputmode="decimal" min="0.5" max="60" step="0.01" style="width:90px;font:inherit;padding:6px 8px;border-radius:9px;border:0;box-shadow:inset 0 0 0 1px var(--line);background:var(--bg);color:var(--ink)"></div>
        <div class="field"><span>Geschosse</span><select id="hpGes">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === eing.geschosse ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><span>Geschosshöhe ${h.tag('Annahme', 'Annahme')}</span><select id="hpGh">${[2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.2].map((n) => `<option value="${n}" ${n === eing.geschosshoehe ? 'selected' : ''}>${fmt(n, 1)} m</option>`).join('')}</select></div>
        <div class="field"><span>Dach</span><select id="hpDach"><option value="sattel">Satteldach</option><option value="pult">Pultdach</option><option value="flach">Flachdach</option></select></div>
        <div class="field"><span>Dachneigung</span><select id="hpNeig">${[15, 20, 25, 30, 35, 40, 45].map((n) => `<option value="${n}" ${n === eing.neigung ? 'selected' : ''}>${n}°</option>`).join('')}</select></div>
        <div class="field" id="hpFgRow" style="display:none"><span>Fenster setzen im Geschoss</span><select id="hpFg"></select></div>
        <div id="hpErg"></div>
        <div class="btnrow"><button class="primary" id="hpOk" type="button" disabled>Haus auf mein Grundstück stellen</button></div>`;
      const num = (id: string, fn: (v: number) => void) => f.querySelector(`#${id}`)!.addEventListener('input', (e) => { fn(parseFloat((e.target as HTMLInputElement).value.replace(',', '.'))); felder(); });
      num('hpLaenge', (v) => (eing.laenge = v > 0 ? v : 0));
      num('hpGes', (v) => { eing.geschosse = v; fgOptionen(); });
      num('hpGh', (v) => (eing.geschosshoehe = v));
      num('hpNeig', (v) => (eing.neigung = v));
      f.querySelector('#hpDach')!.addEventListener('change', (e) => { eing.dach = (e.target as HTMLSelectElement).value as typeof eing.dach; felder(); });
      f.querySelector('#hpFg')!.addEventListener('change', (e) => { editor!.fensterGeschoss = Number((e.target as HTMLSelectElement).value); });
      fgOptionen();
      f.querySelector('#hpOk')!.addEventListener('click', fertig);
    }
    (f.querySelector('#hpFgRow') as HTMLElement).style.display = editor.modus === 'fenster' ? '' : 'none';
    (f.querySelector('#hpNeig') as HTMLSelectElement).disabled = eing.dach === 'flach';
    const erg = f.querySelector('#hpErg')!;
    const ok = f.querySelector('#hpOk') as HTMLButtonElement;
    if (mpp > 0) {
      const p = planAusBild(angaben(mpp));
      const xs = p.fussabdruck.map((q) => q[0]);
      const ys = p.fussabdruck.map((q) => q[1]);
      erg.innerHTML = `<p class="fine" style="text-align:left">Das Haus ist dann ${fmt(Math.max(...xs) - Math.min(...xs), 1)} × ${fmt(Math.max(...ys) - Math.min(...ys), 1)} m groß (Maßstab: 1 Pixel = ${fmt(mpp * 100, 1)} cm, ${fmt(wandPx, 0)} Pixel = ${fmt(eing.laenge, 2)} m) ${h.tag('aus Plan erfasst', 'aus Plan erfasst')}. Traufe ${fmt(p.traufe, 1)} m, First ${fmt(p.first, 1)} m.</p>`;
      ok.disabled = false;
    } else {
      erg.innerHTML = '<p class="fine" style="text-align:left">Noch kein Maßstab: Wähle oben „Maßstab“, tippe eine Wand an und trage ihre Länge ein.</p>';
      ok.disabled = true;
    }
  }

  function fgOptionen() {
    const s = el.querySelector<HTMLSelectElement>('#hpFg');
    if (!s) return;
    s.innerHTML = Array.from({ length: eing.geschosse }, (_, i) => `<option value="${i}">${i === 0 ? 'Erdgeschoss' : `${i}. Obergeschoss`}</option>`).join('');
    if (editor) editor.fensterGeschoss = 0;
  }

  const angaben = (mpp: number) => ({
    name: eing.name, px: editor!.px, mProPx: mpp, geschosse: eing.geschosse, geschosshoehe: eing.geschosshoehe, dach: eing.dach, neigung: eing.neigung,
    fenster: editor!.fenster.map((f) => ({ px: f.px, geschoss: Math.min(f.geschoss, eing.geschosse - 1) })),
  });

  function fertig() {
    if (!editor || editor.wand == null || !(eing.laenge > 0)) return;
    const a = editor.px[editor.wand];
    const b = editor.px[(editor.wand + 1) % editor.px.length];
    const mpp = eing.laenge / Math.hypot(b[0] - a[0], b[1] - a[1]);
    h.onPlan(planAusBild(angaben(mpp)));
  }

  el.innerHTML = grundHtml();
  el.querySelector<HTMLInputElement>('#hpIfc')!.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void ifcLaden(new Uint8Array(await f.arrayBuffer()), f.name);
  });
  el.querySelector<HTMLInputElement>('#hpBild')!.addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void bildLaden(f, f.name);
  });
  el.querySelectorAll<HTMLButtonElement>('[data-hpbsp]').forEach((b) =>
    b.addEventListener('click', async () => {
      const bsp = h.beispiele[Number(b.dataset.hpbsp)];
      try {
        const r = await fetch(bsp.url);
        if (!r.ok) throw new Error(`Beispiel nicht gefunden (${r.status})`);
        void ifcLaden(new Uint8Array(await r.arrayBuffer()), bsp.name);
      } catch (e) {
        status(esc((e as Error).message), true);
      }
    }),
  );
}
