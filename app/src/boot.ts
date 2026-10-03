/**
 * Einstieg: zeigt sofort die Startfrage, lädt Cesium und die Szene danach (eigener Chunk).
 * So ist die Seite auf langsamem Netz nach Sekunden lesbar, nicht erst nach dem 3D-Bundle.
 */
import './style.css';

const head = document.getElementById('vHead');
const sub = document.getElementById('vSub');
if (head && sub) {
  head.textContent = 'Wo steht dein Haus?';
  sub.textContent = 'Such deine Adresse oder tipp auf dein Grundstück in der Karte.';
  const dot = document.getElementById('vDot');
  if (dot) dot.style.visibility = 'hidden';
  document.getElementById('stepBody')!.innerHTML = `
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
