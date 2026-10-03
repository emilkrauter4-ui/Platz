/**
 * Lokale Meter (x = Ost, y = Nord, relativ zur Gebietsmitte in UTM 32N) ↔ geographisch ↔ Cesium.
 * ETRS89 wird für die Darstellung mit WGS84 gleichgesetzt (alle Ebenen nutzen denselben Rahmen).
 */
import proj4 from 'proj4';
import { Cartesian3, Cartographic, Math as CMath } from 'cesium';
import type { Vec2 } from '../rules';

const UTM32 = '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const conv = proj4('EPSG:4326', UTM32);

let origin: Vec2 = [0, 0];
export function setOrigin(o: Vec2) {
  origin = o;
}
export const getOrigin = () => origin;

export function lonLatToLocal(lon: number, lat: number): Vec2 {
  const [e, n] = conv.forward([lon, lat]);
  return [e - origin[0], n - origin[1]];
}

export function localToLonLat(p: Vec2): [number, number] {
  const [lon, lat] = conv.inverse([p[0] + origin[0], p[1] + origin[1]]);
  return [lon, lat];
}

export function localToCartesian(p: Vec2, h: number): Cartesian3 {
  const [lon, lat] = localToLonLat(p);
  return Cartesian3.fromDegrees(lon, lat, h);
}

export function cartesianToLocal(c: Cartesian3): { p: Vec2; h: number } {
  const g = Cartographic.fromCartesian(c);
  return { p: lonLatToLocal(CMath.toDegrees(g.longitude), CMath.toDegrees(g.latitude)), h: g.height };
}

export const utmToLocal = (e: number, n: number): Vec2 => [e - origin[0], n - origin[1]];
