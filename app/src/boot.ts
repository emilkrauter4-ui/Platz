/**
 * Einstieg: zeigt sofort die Startfrage, lädt Cesium und die Szene danach (eigener Chunk).
 * So ist die Seite auf langsamem Netz nach Sekunden lesbar, nicht erst nach dem 3D-Bundle.
 */
import './style.css';
import { HAENDLER, HAENDLER_TEXT } from './haendler';

if (HAENDLER) {
  document.body.classList.add('haendler');
  document.title = HAENDLER_TEXT.titel;
  document.querySelector('.brand .word')!.textContent = HAENDLER_TEXT.wort;
  document.querySelector('.brand .tagline')!.textContent = HAENDLER_TEXT.tagline;
}

const head = document.getElementById('vHead');
const sub = document.getElementById('vSub');
if (head && sub) {
  head.textContent = HAENDLER ? 'Lädt das Mustergrundstück …' : 'Wo steht dein Haus?';
  sub.textContent = HAENDLER ? HAENDLER_TEXT.tagline : 'Such deine Adresse oder tipp auf dein Grundstück in der Karte.';
  const dot = document.getElementById('vDot');
  if (dot) dot.style.visibility = 'hidden';
  if (HAENDLER) document.getElementById('stepBody')!.innerHTML = '<p class="fine">Die 3D-Karte lädt …</p>';
  else document.getElementById('stepBody')!.innerHTML = `
    <form class="search" role="search" onsubmit="return false">
      <input id="q" name="q" type="search" autocomplete="street-address" placeholder="Straße und Hausnummer">
      <button type="submit" disabled>Suchen</button>
    </form>
    <p class="fine">Die 3D-Karte lädt …</p>`;
}

import('./main').catch((e) => {
  console.error(e);
  if (head && sub) {
    head.textContent = 'Die Karte konnte nicht laden.';
    sub.textContent = 'Lade die Seite neu, um es noch einmal zu versuchen.';
  }
});
