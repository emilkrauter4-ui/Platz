import { describe, expect, it } from 'vitest';
import { parseWsg } from '../src/ui/services';

describe('LfU-Wasserschutz-Antwort', () => {
  it('liest die (ungültige) ArcGIS-JSON-Antwort mit überzähligem Komma', () => {
    const text = `{ "type": "FeatureCollection", "features": [ { "type": "Feature", "geometry": null, "properties": {
      "Gebietsname": "Sulzbach-Rosenberg", "Status": "festgesetzt", "Festsetzungsdatum": "13.05.2002", "Shape": "Polygon",
    }, "layerName": "twsg" } ] }`;
    expect(parseWsg(text)).toEqual(['Sulzbach-Rosenberg (festgesetzt am 13.05.2002)']);
  });
  it('leere Antwort: kein Schutzgebiet', () => {
    expect(parseWsg('{ "type": "FeatureCollection", "features": [ ] }')).toEqual([]);
  });
});
