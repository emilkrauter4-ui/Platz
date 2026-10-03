/**
 * Demo-Grundstück aus design/prototyp.html, umgerechnet auf x = Osten, y = Norden
 * (der Prototyp nutzt z = Süden, also y = −z). Alles hier ist erfunden (Label „Demo").
 */
import type { Building, NeighborWindow, Objects, Site, Vec2 } from './index';

const rect = (x1: number, x2: number, z1: number, z2: number): Vec2[] => [
  [x1, -z1], [x2, -z1], [x2, -z2], [x1, -z2],
];

export const DEMO_NEIGHBORS = [
  { x1: 25, x2: 35, z1: 4, z2: 14, axis: 'x', at: 25, pos: [6.5, 11] },
  { x1: -14, x2: -4, z1: 6, z2: 16, axis: 'x', at: -4, pos: [8.5, 13.5] },
  { x1: 4, x2: 14, z1: 36, z2: 46, axis: 'z', at: 36, pos: [6.5, 11.5] },
] as const;

export function demoSite(): Site {
  const buildings: Building[] = [
    { id: 'haus', footprint: rect(4, 14, 5, 16), provenance: 'Demo', own: true },
    ...DEMO_NEIGHBORS.map((n, i) => ({ id: `nachbar${i}`, footprint: rect(n.x1, n.x2, n.z1, n.z2), provenance: 'Demo' as const })),
  ];
  const windows: NeighborWindow[] = [];
  for (const n of DEMO_NEIGHBORS) {
    for (const p of n.pos) {
      for (const z of [1.6, 4.4]) {
        windows.push({ pos: n.axis === 'x' ? [n.at, -p] : [p, -n.at], z, provenance: 'Demo' });
      }
    }
  }
  return {
    plot: {
      boundary: [[0, 0], [20, 0], [21, -28], [0, -28]],
      sides: [
        { name: 'zur Straße', grenze: 'an der Straßengrenze' },
        { name: 'zum Nachbarn Ost', grenze: 'an der Grenze zum Nachbarn Ost' },
        { name: 'nach hinten', grenze: 'an der hinteren Grenze' },
        { name: 'zum Nachbarn West', grenze: 'an der Grenze zum Nachbarn West' },
      ],
      provenance: 'Demo',
    },
    buildings,
    bestand: [],
    windows,
    gebiet: { value: 'allgemein', provenance: 'Annahme' },
    bereich: { value: 'innen', provenance: 'Annahme' },
    bplan: { status: 'unbekannt', provenance: 'offen' },
    aufenthaltsraum: { value: false, provenance: 'Annahme' },
    feuerstaette: { value: false, provenance: 'Annahme' },
    demo: true,
  };
}

export function demoObjects(): Objects {
  return {
    gartenhaus: { kind: 'gartenhaus', center: [17.5, -24.5], w: 3, d: 3, h: 2.5, angle: 0 },
    carport: { kind: 'carport', center: [17, -6.25], w: 3, d: 5.5, h: 2.5, angle: 0 },
    waermepumpe: { kind: 'waermepumpe', center: [14.33, -12.5], w: 0.45, d: 1, h: 0.9, angle: 0, lw: 58 },
  };
}
