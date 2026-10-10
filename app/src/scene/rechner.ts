/**
 * Client für den Rechen-Worker (Zufahrt, Schatten): Aufträge laufen nacheinander im Worker; kommt während einer Rechnung
 * ein neuer Auftrag derselben Art, ersetzt er den wartenden (nur der letzte Stand zählt, Veraltetes wird verworfen).
 * Der Oberflächen-Thread rechnet nichts.
 */
import type { Anfrage, Antwort } from '../rules/rechner';

type OhneId<T> = T extends { id: number } ? Omit<T, 'id'> : never;
type Auftrag = OhneId<Anfrage>;

let worker: Worker | null = null;
let naechste = 0;
let laeuft = false;
const warten = new Map<Auftrag['art'], { a: Anfrage; res: (r: Antwort | null) => void }>();
let aktiv: { id: number; res: (r: Antwort | null) => void } | null = null;

function holeWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../rules/rechner.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Antwort>) => {
      const a = aktiv;
      aktiv = null;
      laeuft = false;
      if (a && a.id === e.data.id) a.res(e.data);
      weiter();
    };
    worker.onerror = () => {
      const a = aktiv;
      aktiv = null;
      laeuft = false;
      a?.res(null);
      weiter();
    };
  }
  return worker;
}

function weiter() {
  if (laeuft) return;
  const art = (['huelle', 'zufahrt', 'schatten'] as const).find((k) => warten.has(k));
  if (!art) return;
  const n = warten.get(art)!;
  warten.delete(art);
  laeuft = true;
  aktiv = { id: n.a.id, res: n.res };
  holeWorker().postMessage(n.a);
}

/** Auftrag an den Worker. Ergebnis null = durch einen neueren Auftrag ersetzt oder Worker-Fehler. */
export function rechne(a: Auftrag): Promise<Antwort | null> {
  return new Promise((res) => {
    const alt = warten.get(a.art);
    alt?.res(null);
    warten.set(a.art, { a: { ...a, id: ++naechste } as Anfrage, res });
    weiter();
  });
}
