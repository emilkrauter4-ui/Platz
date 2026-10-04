/**
 * AR im Maßstab 1:1 (AUFTRAG_V2 Phase 3.3): iOS AR Quick Look (USDZ), Android Scene Viewer (glTF/GLB).
 * Die Modelle erzeugt scripts/ar-modell.mjs – auf dem Server zustandslos aus den Maßen in der URL (Quick Look und
 * Scene Viewer brauchen eine echte Adresse), am Rechner direkt im Browser als Download. Nichts wird gespeichert.
 * Lazy geladen: erst beim Tippen auf „In AR ansehen“.
 */
export interface ArParameter {
  art: 'gartenhaus' | 'carport' | 'waermepumpe' | 'hecke' | 'baum' | 'strauch';
  w?: number;
  d?: number;
  h: number;
  /** Dachneigung in Grad (Gartenhaus) */
  n?: number;
  /** Heckenlänge */
  l?: number;
}

const r2 = (v: number) => String(Math.round(v * 100) / 100);

export function arQuery(p: ArParameter): string {
  const q = new URLSearchParams({ art: p.art, h: r2(p.h) });
  if (p.w != null) q.set('w', r2(p.w));
  if (p.d != null) q.set('d', r2(p.d));
  if (p.n) q.set('n', r2(p.n));
  if (p.l != null) q.set('l', r2(p.l));
  return q.toString();
}

export type ArWeg = 'quicklook' | 'sceneviewer' | 'download';

export function arWeg(ua = navigator.userAgent): ArWeg {
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && document.createElement('a').relList.supports?.('ar')) return 'quicklook';
  if (/Android/.test(ua)) return 'sceneviewer';
  return 'download';
}

const basis = () => `${location.origin}${import.meta.env.BASE_URL ?? '/'}api/ar/modell`;

/** Startet AR (Handy) oder liefert Downloads (Rechner). */
export async function zeigeAr(p: ArParameter, titel: string): Promise<{ weg: ArWeg; glb?: string; usdz?: string }> {
  const weg = arWeg();
  const q = arQuery(p);
  if (weg === 'quicklook') {
    // 1:1: Skalieren in Quick Look abschalten
    const a = document.createElement('a');
    a.rel = 'ar';
    a.href = `${basis()}.usdz?${q}#allowsContentScaling=0`;
    a.appendChild(document.createElement('img'));
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { weg };
  }
  if (weg === 'sceneviewer') {
    const datei = `${basis()}.glb?${q}`;
    const sv = `https://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(datei)}&mode=ar_preferred&resizable=false&title=${encodeURIComponent(titel)}`;
    location.href = `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(datei)}&mode=ar_preferred&resizable=false&title=${encodeURIComponent(titel)}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(sv)};end;`;
    return { weg };
  }
  // Rechner: Dateien im Browser erzeugen (geht auch offline)
  const m = await import('../scripts/ar-modell.mjs');
  const t = m.teileAus(Object.fromEntries(new URLSearchParams(q)));
  const url = (d: Uint8Array, typ: string) => URL.createObjectURL(new Blob([d as BlobPart], { type: typ }));
  return { weg, glb: url(m.glb(t), 'model/gltf-binary'), usdz: url(m.usdz(t), 'model/vnd.usdz+zip') };
}
