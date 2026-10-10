import { describe, expect, it } from 'vitest';
import { tippAnfrage, vorbereitenAnfrage } from '../scripts/tipp-proxy.mjs';

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
  it('vorbereiten: nur Umrisspunkte, gerundet, höchstens 400 m Ausdehnung', () => {
    expect(vorbereitenAnfrage({ umriss: [[699000.123, 5487000.456], [699030, 5487025]], adresse: 'geheim' })).toEqual({ umriss: [[699000.12, 5487000.46], [699030, 5487025]] });
    expect(vorbereitenAnfrage({ umriss: [[699000, 5487000], [699500, 5487000]] })).toBeNull();
    expect(vorbereitenAnfrage({ umriss: [] })).toBeNull();
    expect(vorbereitenAnfrage({ umriss: [[1, 2]] })).toBeNull();
    expect(vorbereitenAnfrage({ umriss: [[699000, 'x']] })).toBeNull();
  });
});
