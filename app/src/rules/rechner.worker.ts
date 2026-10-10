/// <reference lib="webworker" />
/** Web Worker für Zufahrt und Schatten des großen Vorhabens: rechnet abseits des Oberflächen-Threads. */
import { bearbeite, type Anfrage } from './rechner';

self.onmessage = (e: MessageEvent<Anfrage>) => {
  (self as unknown as Worker).postMessage(bearbeite(e.data));
};
