import { describe, expect, it } from 'vitest';
import { tippAnfrage } from '../scripts/tipp-proxy.mjs';

describe('Tipp-Proxy', () => {
  it('reicht nur x, y und erlaubte Klasse weiter', () => {
    expect(tippAnfrage({ x: 699000.5, y: 5487000.2, klasse: 'pool', adresse: 'geheim' })).toEqual({ x: 699000.5, y: 5487000.2, klasse: 'pool' });
    expect(tippAnfrage({ x: 699000, y: 5487000 })).toEqual({ x: 699000, y: 5487000 });
  });
  it('lehnt Unsinn ab', () => {
    expect(tippAnfrage({ x: 'a', y: 1 })).toBeNull();
    expect(tippAnfrage({ x: 12, y: 48 })).toBeNull();
    expect(tippAnfrage({ x: 699000, y: 5487000, klasse: 'rakete' })).toBeNull();
  });
});
