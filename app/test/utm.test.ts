import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import { forward, inverse } from '../src/scene/utm';

const conv = proj4('EPSG:4326', '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs');

describe('UTM 32 (eigene Umrechnung statt proj4)', () => {
  it('stimmt im Gebiet und in ganz Bayern auf < 1 mm mit proj4 überein', () => {
    for (let lon = 9; lon <= 13.9; lon += 0.37) {
      for (let lat = 47.3; lat <= 50.6; lat += 0.29) {
        const [e, n] = forward(lon, lat);
        const [pe, pn] = conv.forward([lon, lat]);
        expect(Math.abs(e - pe)).toBeLessThan(0.001);
        expect(Math.abs(n - pn)).toBeLessThan(0.001);
        const [l2, b2] = inverse(e, n);
        expect(Math.abs(l2 - lon) * 111000 * Math.cos((lat * Math.PI) / 180)).toBeLessThan(0.001);
        expect(Math.abs(b2 - lat) * 111000).toBeLessThan(0.001);
      }
    }
  });
});
