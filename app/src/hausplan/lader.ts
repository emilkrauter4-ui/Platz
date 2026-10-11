/**
 * Lader für Hausplan-Dateien im Browser (AUFTRAG_V4 C2). Alles läuft lokal; die Datei verlässt das Gerät nicht
 * und wird nicht gespeichert. Die schweren Bibliotheken (web-ifc, pdfjs-dist) werden erst beim Import nachgeladen.
 */
import type { HausPlan } from './typen';
import type { Bild } from './bild';

export async function ladeIfc(daten: Uint8Array, name: string): Promise<HausPlan> {
  const [{ leseIfc }, WebIFC, wasm] = await Promise.all([
    import('./ifc'),
    import('web-ifc'),
    import('web-ifc/web-ifc.wasm?url'),
  ]);
  const api = new WebIFC.IfcAPI();
  const wasmUrl = new URL(wasm.default, location.href);
  // locateFile: web-ifc sucht „web-ifc.wasm“ relativ zu seinem Skript; wir geben die gehashte Datei des Builds an
  await api.Init((pfad: string) => (pfad.endsWith('.wasm') ? wasmUrl.href : pfad));
  return leseIfc(api as never, WebIFC as never, daten, name);
}

/** PDF: erste Seite als Bild (max. 2000 px an der langen Seite). */
export async function ladePdfSeite(daten: Uint8Array, seite = 1): Promise<{ bild: Bild; seiten: number }> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: daten.slice() }).promise;
  const n = doc.numPages;
  const page = await doc.getPage(Math.min(Math.max(1, seite), n));
  const v0 = page.getViewport({ scale: 1 });
  const scale = 2000 / Math.max(v0.width, v0.height);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width);
  c.height = Math.round(vp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const id = ctx.getImageData(0, 0, c.width, c.height);
  void doc.destroy();
  return { bild: { width: id.width, height: id.height, data: id.data }, seiten: n };
}

/** Foto oder Bilddatei (JPEG/PNG), auf höchstens 2000 px an der langen Seite verkleinert. */
export async function ladeFoto(datei: Blob): Promise<Bild> {
  const bmp = await createImageBitmap(datei);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const id = ctx.getImageData(0, 0, c.width, c.height);
  return { width: id.width, height: id.height, data: id.data };
}
