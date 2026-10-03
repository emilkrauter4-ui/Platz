/**
 * UTM Zone 32N auf dem GRS80-Ellipsoid (ETRS89), Krüger-Reihen 6. Ordnung (nach Karney 2011).
 * Ersetzt proj4 im Bundle (–105 kB). Genauigkeit im Gebiet deutlich unter 1 mm (Test gegen proj4).
 */
const a = 6378137;
const f = 1 / 298.257222101; // GRS80
const k0 = 0.9996;
const lon0 = (9 * Math.PI) / 180;
const FE = 500000;

const n = f / (2 - f);
const n2 = n * n;
const n3 = n2 * n;
const n4 = n3 * n;
const n5 = n4 * n;
const n6 = n5 * n;
const A = (a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
const e = Math.sqrt(f * (2 - f));

const alpha = [
  0,
  n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
  (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
  (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
  (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
  (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
  (212378941 * n6) / 319334400,
];
const beta = [
  0,
  n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512 + (96199 * n6) / 604800,
  n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105 - (1118711 * n6) / 3870720,
  (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480 + (5569 * n6) / 90720,
  (4397 * n4) / 161280 - (11 * n5) / 504 - (830251 * n6) / 7257600,
  (4583 * n5) / 161280 - (108847 * n6) / 3991680,
  (20648693 * n6) / 638668800,
];

/** Längen/Breite in Grad → [Rechtswert, Hochwert] in Metern. */
export function forward(lonDeg: number, latDeg: number): [number, number] {
  const phi = (latDeg * Math.PI) / 180;
  const lam = (lonDeg * Math.PI) / 180 - lon0;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi1 = Math.atan2(t, Math.cos(lam));
  const eta1 = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let xi = xi1;
  let eta = eta1;
  for (let j = 1; j <= 6; j++) {
    xi += alpha[j] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1);
    eta += alpha[j] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1);
  }
  return [FE + k0 * A * eta, k0 * A * xi];
}

/** [Rechtswert, Hochwert] → [Länge, Breite] in Grad. */
export function inverse(E: number, N: number): [number, number] {
  const xi = N / (k0 * A);
  const eta = (E - FE) / (k0 * A);
  let xi1 = xi;
  let eta1 = eta;
  for (let j = 1; j <= 6; j++) {
    xi1 -= beta[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta1 -= beta[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  const lam = Math.atan2(Math.sinh(eta1), Math.cos(xi1));
  // konforme Breite → geographische Breite (Newton)
  const tau1 = Math.tan(chi);
  let tau = tau1;
  for (let i = 0; i < 6; i++) {
    const sig = Math.sinh(e * Math.atanh((e * tau) / Math.sqrt(1 + tau * tau)));
    const tau1i = tau * Math.sqrt(1 + sig * sig) - sig * Math.sqrt(1 + tau * tau);
    const dtau = ((tau1 - tau1i) / Math.sqrt(1 + tau1i * tau1i)) * ((1 + (1 - e * e) * tau * tau) / ((1 - e * e) * Math.sqrt(1 + tau * tau)));
    tau += dtau;
    if (Math.abs(dtau) < 1e-14) break;
  }
  return [((lam + lon0) * 180) / Math.PI, (Math.atan(tau) * 180) / Math.PI];
}
