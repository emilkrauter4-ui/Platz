import { describe, expect, it } from 'vitest';
import { parseBplan, parseWsg } from '../src/ui/services';

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

describe('Bauleitplanung-WMS (Bebauungsplan)', () => {
  const gml = `<wfs:FeatureCollection xmlns:bplan="gdi.bayern.de/bplan"><gml:featureMember><bplan:bp_plan_rechtskraft fid="bp_plan_rechtskraft.1"><gml:boundedBy/><bplan:planname>Pantzerhöhe</bplan:planname><bplan:nummer>036_000</bplan:nummer><bplan:stadt>Sulzbach-Rosenberg</bplan:stadt><bplan:scanurl>https://gis.amberg-sulzbach.de/web_daten/x_Rasterbild.pdf</bplan:scanurl><bplan:texturl>https://gis.amberg-sulzbach.de/web_daten/x_Festsetzungen.pdf</bplan:texturl></bplan:bp_plan_rechtskraft></gml:featureMember><gml:featureMember><bplan:bp_plan_im_verfahren fid="v.2"><bplan:planname>Am &amp; Hang</bplan:planname></bplan:bp_plan_im_verfahren></gml:featureMember></wfs:FeatureCollection>`;
  it('liest Plan, Verweise und Art (Antwort des Landesportals, Oktober 2026)', () => {
    const t = parseBplan(gml);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ art: 'rechtskraft', name: 'Pantzerhöhe', nummer: '036_000', gemeinde: 'Sulzbach-Rosenberg' });
    expect(t[0].planUrl).toMatch(/Rasterbild\.pdf$/);
    expect(t[0].textUrl).toMatch(/Festsetzungen\.pdf$/);
    expect(t[1]).toMatchObject({ art: 'im_verfahren', name: 'Am & Hang' });
  });
  it('leere Antwort: kein Plan im Portal', () => {
    expect(parseBplan('<wfs:FeatureCollection><gml:boundedBy><gml:null>unknown</gml:null></gml:boundedBy></wfs:FeatureCollection>')).toEqual([]);
  });
});
