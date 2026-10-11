#!/usr/bin/env python3
"""Zwei eigene Beispiel-IFC-Dateien für Passt. (AUFTRAG_V4 C2) → docs/beispiele/ifc/.

Selbst erzeugt, kein Herstellerplan, kein Katalogplan: Die Dateien sind eigene Arbeit von Passt. und dürfen frei verwendet werden
(CC0 1.0). IFC4, SI-Einheiten (Meter), je Haus Wände, Bodenplatte, Dach, Fenster mit Position und Größe, Räume (IfcSpace).

  haus_satteldach.ifc   10 × 8 m, zwei Geschosse à 2,80 m, Satteldach 35° (First in Ost-West-Richtung), 9 Fenster, 8 Räume
  haus_l_flachdach.ifc  L-förmig (12 × 10 m mit 6 × 4 m Einschnitt), zwei Geschosse, Flachdach, 7 Fenster, 4 Räume

Die Kennzahlen stehen in docs/beispiele/ifc/README.md und werden von app/test/hausplan.test.ts nachgerechnet.
"""
from __future__ import annotations

import math
import random
from pathlib import Path

AUS = Path(__file__).resolve().parent.parent / "docs" / "beispiele" / "ifc"
ALPHA = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"


def esc(t: str) -> str:
    """Nicht-ASCII-Zeichen nach ISO 10303-21 als \\X2\\hex\\X0\\ schreiben (so erwartet es jeder IFC-Leser)."""
    return "".join(c if ord(c) < 128 else f"\\X2\\{ord(c):04X}\\X0\\" for c in t)


class Ifc:
    def __init__(self, seed: int):
        self.z: list[str] = []
        self.rnd = random.Random(seed)

    def add(self, text: str) -> str:
        self.z.append(text)
        return f"#{len(self.z)}"

    def guid(self) -> str:
        return "'" + self.rnd.choice("0123") + "".join(self.rnd.choice(ALPHA) for _ in range(21)) + "'"

    def pt(self, *c: float) -> str:
        return self.add(f"IFCCARTESIANPOINT(({','.join(f'{v:.5f}' for v in c)}))")

    def dir(self, *c: float) -> str:
        return self.add(f"IFCDIRECTION(({','.join(f'{v:.6f}' for v in c)}))")

    def axis3(self, o=(0, 0, 0), z=(0, 0, 1), x=(1, 0, 0)) -> str:
        return self.add(f"IFCAXIS2PLACEMENT3D({self.pt(*o)},{self.dir(*z)},{self.dir(*x)})")

    def place(self, rel: str | None, o=(0, 0, 0), z=(0, 0, 1), x=(1, 0, 0)) -> str:
        return self.add(f"IFCLOCALPLACEMENT({rel or '$'},{self.axis3(o, z, x)})")

    def rect_profile(self, xd: float, yd: float, cx: float, cy: float) -> str:
        p2 = self.add(f"IFCAXIS2PLACEMENT2D({self.add(f'IFCCARTESIANPOINT(({cx:.5f},{cy:.5f}))')},$)")
        return self.add(f"IFCRECTANGLEPROFILEDEF(.AREA.,$,{p2},{xd:.5f},{yd:.5f})")

    def poly_profile(self, pts: list[tuple[float, float]]) -> str:
        ids = [self.add(f"IFCCARTESIANPOINT(({x:.5f},{y:.5f}))") for x, y in pts + [pts[0]]]
        pl = self.add(f"IFCPOLYLINE(({','.join(ids)}))")
        return self.add(f"IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,{pl})")

    def solid(self, profile: str, depth: float, pos: str | None = None) -> str:
        return self.add(f"IFCEXTRUDEDAREASOLID({profile},{pos or self.axis3()},{self.dir(0, 0, 1)},{depth:.5f})")

    def shape(self, ctx: str, solid: str) -> str:
        rep = self.add(f"IFCSHAPEREPRESENTATION({ctx},'Body','SweptSolid',({solid}))")
        return self.add(f"IFCPRODUCTDEFINITIONSHAPE($,$,({rep}))")


def haus(name: str, seed: int, kind: str) -> str:
    f = Ifc(seed)
    org = f.pt(0, 0, 0)
    ax = f.add(f"IFCAXIS2PLACEMENT3D({org},{f.dir(0, 0, 1)},{f.dir(1, 0, 0)})")
    ctx = f.add(f"IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,{ax},$)")
    body = f.add(f"IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,{ctx},$,.MODEL_VIEW.,$)")
    units = f.add("IFCUNITASSIGNMENT((" + ",".join([
        f.add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)"), f.add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"),
        f.add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)"), f.add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)")]) + "))")
    prj = f.add(f"IFCPROJECT({f.guid()},$,'{name}',$,$,$,$,({ctx}),{units})")
    pl_site = f.place(None)
    site = f.add(f"IFCSITE({f.guid()},$,'Grundst\\X2\\00FC\\X0\\ck',$,$,{pl_site},$,$,.ELEMENT.,$,$,$,$,$)")
    pl_bld = f.place(pl_site)
    bld = f.add(f"IFCBUILDING({f.guid()},$,'{name}',$,$,{pl_bld},$,$,.ELEMENT.,$,$,$)")
    f.add(f"IFCRELAGGREGATES({f.guid()},$,$,$,{prj},({site}))")
    f.add(f"IFCRELAGGREGATES({f.guid()},$,$,$,{site},({bld}))")
    GH, T = 2.8, 0.3
    storeys = []
    for i, nm in enumerate(["Erdgeschoss", "Obergeschoss"]):
        pl = f.place(pl_bld, (0, 0, i * GH))
        st = f.add(f"IFCBUILDINGSTOREY({f.guid()},$,'{nm}',$,$,{pl},$,$,.ELEMENT.,{i * GH:.3f})")
        storeys.append((st, pl))
    f.add(f"IFCRELAGGREGATES({f.guid()},$,$,$,{bld},({','.join(s for s, _ in storeys)}))")

    if kind == "satteldach":
        pts = [(0, 0), (10, 0), (10, 8), (0, 8)]
        fenster = {  # (wand-index, position entlang der Wand, breite, brüstung) je Geschoss
            0: [(0, 2.0, 1.5, 0.9), (0, 5.0, 1.5, 0.9), (0, 8.0, 1.2, 0.9), (2, 3.0, 1.2, 0.9), (2, 7.0, 0.8, 1.3), (1, 2.0, 1.2, 0.9)],
            1: [(0, 2.0, 1.5, 0.9), (0, 5.0, 1.5, 0.9), (0, 8.0, 1.2, 0.9), (2, 3.0, 1.2, 0.9), (2, 7.0, 0.8, 1.3), (1, 2.0, 1.2, 0.9)],
        }
        raeume = [
            [("Wohnen", [(0.15, 0.15), (6.0, 0.15), (6.0, 4.0), (0.15, 4.0)]), ("Küche", [(6.0, 0.15), (9.85, 0.15), (9.85, 4.0), (6.0, 4.0)]),
             ("Arbeiten", [(0.15, 4.0), (5.0, 4.0), (5.0, 7.85), (0.15, 7.85)]), ("Bad", [(5.0, 4.0), (9.85, 4.0), (9.85, 7.85), (5.0, 7.85)])],
            [("Schlafen", [(0.15, 0.15), (6.0, 0.15), (6.0, 4.0), (0.15, 4.0)]), ("Kind", [(6.0, 0.15), (9.85, 0.15), (9.85, 4.0), (6.0, 4.0)]),
             ("Kind 2", [(0.15, 4.0), (5.0, 4.0), (5.0, 7.85), (0.15, 7.85)]), ("Bad OG", [(5.0, 4.0), (9.85, 4.0), (9.85, 7.85), (5.0, 7.85)])],
        ]
    else:
        pts = [(0, 0), (12, 0), (12, 6), (6, 6), (6, 10), (0, 10)]
        fenster = {0: [(0, 3.0, 1.5, 0.9), (0, 9.0, 1.5, 0.9), (1, 3.0, 1.2, 0.9), (4, 5.0, 1.2, 0.9)],
                   1: [(0, 3.0, 1.5, 0.9), (0, 9.0, 1.5, 0.9), (4, 5.0, 1.2, 0.9)]}
        raeume = [[("Wohnen", [(0.15, 0.15), (11.85, 0.15), (11.85, 5.85), (0.15, 5.85)]), ("Arbeiten", [(0.15, 5.85), (5.85, 5.85), (5.85, 9.85), (0.15, 9.85)])],
                  [("Schlafen", [(0.15, 0.15), (11.85, 0.15), (11.85, 5.85), (0.15, 5.85)]), ("Kind", [(0.15, 5.85), (5.85, 5.85), (5.85, 9.85), (0.15, 9.85)])]]

    kanten = list(zip(pts, pts[1:] + pts[:1]))
    # Bodenplatte
    sl = f.add(f"IFCSLAB({f.guid()},$,'Bodenplatte',$,$,{f.place(pl_bld, (0, 0, -0.2))},{f.shape(body, f.solid(f.poly_profile(pts), 0.2))},$,.BASESLAB.)")
    elem = {0: [sl], 1: []}
    for gi, (st, pl) in enumerate(storeys):
        for wi, ((x0, y0), (x1, y1)) in enumerate(kanten):
            L = math.hypot(x1 - x0, y1 - y0)
            d = ((x1 - x0) / L, (y1 - y0) / L)
            wpl = f.place(pl, (x0, y0, 0), (0, 0, 1), (d[0], d[1], 0))
            w = f.add(f"IFCWALL({f.guid()},$,'Wand {wi + 1} G{gi}',$,$,{wpl},{f.shape(body, f.solid(f.rect_profile(L, T, L / 2, 0), GH))},$,.STANDARD.)")
            elem[gi].append(w)
        # Fenster
        for k, (wi, s, b, sill) in enumerate(fenster[gi]):
            (x0, y0), (x1, y1) = kanten[wi]
            L = math.hypot(x1 - x0, y1 - y0)
            d = ((x1 - x0) / L, (y1 - y0) / L)
            hgt = 1.35 if sill < 1.0 else 0.9
            wpl = f.place(pl, (x0 + d[0] * s, y0 + d[1] * s, sill), (0, 0, 1), (d[0], d[1], 0))
            fe = f.add(f"IFCWINDOW({f.guid()},$,'F{wi + 1}-G{gi}-{k + 1}',$,$,{wpl},{f.shape(body, f.solid(f.rect_profile(b, T + 0.04, 0, 0), hgt))},$,{hgt:.3f},{b:.3f},.WINDOW.,.NOTDEFINED.,$)")
            elem[gi].append(fe)
        # Räume
        for nm, poly in raeume[gi]:
            rp = f.add(f"IFCSPACE({f.guid()},$,'{esc(nm)}',$,$,{f.place(pl, (0, 0, 0))},{f.shape(body, f.solid(f.poly_profile(poly), GH))},'{esc(nm)}',.ELEMENT.,.INTERNAL.,$)")
            elem[gi].append(rp)
    # Dach
    top = 2 * GH
    if kind == "satteldach":
        ov, neig = 0.4, math.radians(35)
        W = 8.0
        rise = (W / 2 + ov) * math.tan(neig)
        prof = f.poly_profile([(-ov, 0), (W + ov, 0), (W / 2, rise)])
        # lokale Z-Achse = globales X (Extrusion entlang des Firstes), lokale X-Achse = globales Y
        pos = f.place(pl_bld, (-ov, 0, top), (1, 0, 0), (0, 1, 0))
        solid = f.solid(prof, 10 + 2 * ov, f.axis3((0, 0, 0)))
        roof = f.add(f"IFCROOF({f.guid()},$,'Satteldach',$,$,{pos},{f.shape(body, solid)},$,.GABLE_ROOF.)")
    else:
        prof = f.poly_profile([(x - 0.2, y - 0.2) for x, y in [(0, 0), (12.4, 0), (12.4, 6.4), (6.4, 6.4), (6.4, 10.4), (0, 10.4)]])
        roof = f.add(f"IFCROOF({f.guid()},$,'Flachdach',$,$,{f.place(pl_bld, (0, 0, top))},{f.shape(body, f.solid(prof, 0.3))},$,.FLAT_ROOF.)")
    elem[1].append(roof)
    for gi, (st, _) in enumerate(storeys):
        f.add(f"IFCRELCONTAINEDINSPATIALSTRUCTURE({f.guid()},$,$,$,({','.join(elem[gi])}),{st})")
    kopf = ("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\n"
            f"FILE_NAME('{name}.ifc','2026-10-11T00:00:00',('Passt.'),('Passt.'),'Passt. Beispielgenerator','Passt.','');\n"
            "FILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n")
    return kopf + "\n".join(f"#{i + 1}={z};" for i, z in enumerate(f.z)) + "\nENDSEC;\nEND-ISO-10303-21;\n"


def tess(f: Ifc, ctx: str, pts: list[tuple[float, float, float]], tris: list[tuple[int, int, int]]) -> str:
    """Dreiecksnetz (IFC4 IfcTriangulatedFaceSet), Punktnummern ab 1; Koordinaten relativ zum Platzierungsursprung des Bauteils."""
    cl = f.add("IFCCARTESIANPOINTLIST3D((" + ",".join(f"({x:.4f},{y:.4f},{z:.4f})" for x, y, z in pts) + "))")
    ts = f.add(f"IFCTRIANGULATEDFACESET({cl},$,.T.,(" + ",".join(f"({a},{b},{c})" for a, b, c in tris) + "),$)")
    rep = f.add(f"IFCSHAPEREPRESENTATION({ctx},'Body','Tessellation',({ts}))")
    return f.add(f"IFCPRODUCTDEFINITIONSHAPE($,$,({rep}))")


def pyramide(basis: list[tuple[float, float]], z: float, spitze: tuple[float, float, float]):
    """Pyramidendach über einem gegen den Uhrzeigersinn umlaufenen Grundriss: Eckpunkte, Dreiecke (Seiten nach außen, Boden nach unten)."""
    pts = [(x, y, z) for x, y in basis] + [spitze]
    a = len(basis) + 1
    tris = [(i + 1, (i + 1) % len(basis) + 1, a) for i in range(len(basis))]
    tris += [(1, i + 2, i + 1) for i in range(1, len(basis) - 1)]
    return pts, tris


def villa(name: str, seed: int) -> str:
    """Hochkomplexe Villa: Keller, EG, OG, Dachgeschoss, Turm, Erker, Westflügel, Garage mit Dachterrasse, Vorbau mit Balkon, Gauben,
    Schornstein, Treppen, Innenwände, Türen, rund 50 Fenster, rund 30 Räume, vier Dachformen. Gesamtmaße ca. 33 × 18 m."""
    f = Ifc(seed)
    org = f.pt(0, 0, 0)
    ax = f.add(f"IFCAXIS2PLACEMENT3D({org},{f.dir(0, 0, 1)},{f.dir(1, 0, 0)})")
    ctx = f.add(f"IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,{ax},$)")
    body = f.add(f"IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,{ctx},$,.MODEL_VIEW.,$)")
    units = f.add("IFCUNITASSIGNMENT((" + ",".join([
        f.add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)"), f.add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"),
        f.add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)"), f.add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)")]) + "))")
    prj = f.add(f"IFCPROJECT({f.guid()},$,'Villa',$,$,$,$,({ctx}),{units})")
    pl_site = f.place(None)
    site = f.add(f"IFCSITE({f.guid()},$,'Grundst\\X2\\00FC\\X0\\ck',$,$,{pl_site},$,$,.ELEMENT.,$,$,$,$,$)")
    pl_bld = f.place(pl_site)
    bld = f.add(f"IFCBUILDING({f.guid()},$,'Villa',$,$,{pl_bld},$,$,.ELEMENT.,$,$,$)")
    f.add(f"IFCRELAGGREGATES({f.guid()},$,$,$,{prj},({site}))")
    f.add(f"IFCRELAGGREGATES({f.guid()},$,$,$,{site},({bld}))")

    T = 0.3
    GESCHOSSE = [("Untergeschoss", -3.0, 3.0), ("Erdgeschoss", 0.0, 3.0), ("Obergeschoss", 3.0, 2.9), ("Dachgeschoss", 5.9, 2.6)]
    storeys = []
    for nm, el, _ in GESCHOSSE:
        pl = f.place(pl_bld, (0, 0, el))
        st = f.add(f"IFCBUILDINGSTOREY({f.guid()},$,'{esc(nm)}',$,$,{pl},$,$,.ELEMENT.,{el:.3f})")
        storeys.append((st, pl))
    f.add(f"IFCRELAGGREGATES({f.guid()},$,$,$,{bld},({','.join(s for s, _ in storeys)}))")
    elem: dict[int, list[str]] = {i: [] for i in range(4)}
    S = 0.7071

    def wand(gi: int, p0, p1, h: float, dicke: float = T, nm: str = "Wand", z0: float = 0.0):
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        d = ((p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L)
        pl = f.place(storeys[gi][1], (p0[0], p0[1], z0), (0, 0, 1), (d[0], d[1], 0))
        elem[gi].append(f.add(f"IFCWALL({f.guid()},$,'{esc(nm)}',$,$,{pl},{f.shape(body, f.solid(f.rect_profile(L, dicke, L / 2, 0), h))},$,.STANDARD.)"))

    def platte(gi: int, pts, dick: float, z: float, nm: str, typ: str = "FLOOR"):
        pl = f.place(storeys[gi][1], (0, 0, z))
        elem[gi].append(f.add(f"IFCSLAB({f.guid()},$,'{esc(nm)}',$,$,{pl},{f.shape(body, f.solid(f.poly_profile(pts), dick))},$,.{typ}.)"))

    def oeffnung(gi: int, art: str, mx: float, my: float, d, b: float, sill: float, h: float, nm: str):
        pl = f.place(storeys[gi][1], (mx, my, sill), (0, 0, 1), (d[0], d[1], 0))
        t = "WINDOW" if art == "fenster" else "DOOR"
        elem[gi].append(f.add(f"IFC{t}({f.guid()},$,'{esc(nm)}',$,$,{pl},{f.shape(body, f.solid(f.rect_profile(b, T + 0.04, 0, 0), h))},$,{h:.3f},{b:.3f},.{t}.,.NOTDEFINED.,$)"))

    def raum(gi: int, nm: str, r):
        x0, y0, x1, y1 = r
        poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        elem[gi].append(f.add(f"IFCSPACE({f.guid()},$,'{esc(nm)}',$,$,{f.place(storeys[gi][1])},{f.shape(body, f.solid(f.poly_profile(poly), GESCHOSSE[gi][2]))},'{esc(nm)}',.ELEMENT.,.INTERNAL.,$)"))

    def kasten(gi: int, typ: str, nm: str, x0, y0, z0, dx, dy, dz, extra: str = "$"):
        pl = f.place(storeys[gi][1], (x0 + dx / 2, y0 + dy / 2, z0))
        sh = f.shape(body, f.solid(f.rect_profile(dx, dy, 0, 0), dz))
        tail = {"IFCCOLUMN": ".COLUMN.", "IFCBUILDINGELEMENTPROXY": ".NOTDEFINED."}[typ]
        elem[gi].append(f.add(f"{typ}({f.guid()},$,'{esc(nm)}',$,$,{pl},{sh},$,{tail})"))

    # --- Grundrisse (gegen den Uhrzeigersinn, x = Ost, y = Nord)
    EG = [(0, 0), (26, 0), (26, 7), (18, 7), (18, 14), (14, 14), (14, 10), (12, 10), (13, 11.5), (11.5, 13), (7.5, 13), (6, 11.5), (7, 10), (0, 10), (0, 8), (-7, 8), (-7, 2), (0, 2)]
    OG = [(0, 0), (18, 0), (18, 14), (14, 14), (14, 10), (12, 10), (13, 11.5), (11.5, 13), (7.5, 13), (6, 11.5), (7, 10), (0, 10), (0, 8), (-7, 8), (-7, 2), (0, 2)]
    DG = [(0, 0), (18, 0), (18, 10), (18, 14), (14, 14), (14, 10), (0, 10)]
    UG = [(0, 0), (18, 0), (18, 10), (0, 10)]

    def umlauf(gi: int, pts, hoehen=None, nm="Außenwand"):
        for i, (a, b) in enumerate(zip(pts, pts[1:] + pts[:1])):
            h = hoehen[i] if hoehen else GESCHOSSE[gi][2]
            wand(gi, a, b, h, nm=f"{nm} {i + 1}")

    # Untergeschoss
    umlauf(0, UG, nm="Kellerwand")
    platte(0, UG, 0.3, -0.3, "Bodenplatte", "BASESLAB")
    wand(0, (6, 0), (6, 10), 3.0, 0.2, "Kellerinnenwand 1")
    wand(0, (12, 0), (12, 10), 3.0, 0.2, "Kellerinnenwand 2")
    for nm, r in (("Heizraum", (0.15, 0.15, 6, 10)), ("Weinkeller", (6, 0.15, 12, 4.5)), ("Fitness", (6, 4.5, 12, 9.85)), ("Wellness", (12, 0.15, 17.85, 9.85))):
        raum(0, nm, r)
    for k, x in enumerate((2.0, 9.0, 15.0)):
        oeffnung(0, "fenster", x, 0, (1, 0), 0.8, 2.3, 0.5, f"Lichtschacht {k + 1}")
    # Erdgeschoss
    umlauf(1, EG)
    platte(1, EG, 0.25, -0.25, "Decke Keller")
    for a, b in (((6, 0.0), (6, 10)), ((12, 0.0), (12, 10)), ((12, 5), (18, 5)), ((0, 6), (6, 6)), ((12, 7), (14, 7))):
        wand(1, a, b, 3.0, 0.15, "Innenwand")
    for k, (x, y, d, b, sill, h, nm) in enumerate([
        (2.5, 0, (1, 0), 1.2, 0.0, 2.2, "S1"), (4.5, 0, (1, 0), 1.2, 0.0, 2.2, "S2"), (14.5, 0, (1, 0), 2.4, 0.9, 1.4, "S3"),
        (-3.5, 2, (1, 0), 1.5, 0.9, 1.35, "S4"), (26, 3.5, (0, 1), 0.9, 1.4, 0.8, "O1"), (18, 8.5, (0, 1), 1.2, 0.9, 1.35, "O2"),
        (18, 12, (0, 1), 1.0, 0.9, 1.35, "O3"), (16, 14, (1, 0), 1.2, 0.9, 1.35, "N1"), (14, 12, (0, 1), 1.0, 0.9, 1.35, "W1"),
        (9.5, 13, (1, 0), 2.0, 0.0, 2.4, "N2"), (12.25, 12.25, (-S, S), 1.2, 0.9, 1.35, "N3"), (6.75, 12.25, (-S, -S), 1.2, 0.9, 1.35, "N4"),
        (3.0, 10, (1, 0), 1.5, 0.9, 1.35, "N5"), (-7, 4, (0, 1), 1.2, 0.9, 1.35, "W2"), (-7, 6, (0, 1), 1.2, 0.9, 1.35, "W3"),
        (-3.5, 8, (1, 0), 1.2, 0.9, 1.35, "N6")]):
        oeffnung(1, "fenster", x, y, d, b, sill, h, f"{nm}-EG")
    oeffnung(1, "tuer", 9.0, 0, (1, 0), 1.4, 0.0, 2.4, "Haustuer")
    oeffnung(1, "tuer", 22.0, 0, (1, 0), 4.5, 0.0, 2.2, "Garagentor")
    for k, (x, y, d) in enumerate(((6, 3, (0, 1)), (6, 8, (0, 1)), (12, 2.5, (0, 1)), (12, 8.5, (0, 1)), (3, 6, (1, 0)))):
        oeffnung(1, "tuer", x, y, d, 0.9, 0.0, 2.1, f"Innentuer {k + 1}")
    for nm, r in (("Wohnen", (0.15, 0.15, 6, 6.0)), ("Bibliothek", (0.15, 6.0, 6, 9.85)), ("Foyer", (6, 0.15, 12, 4.0)), ("Halle", (6, 4.0, 12, 9.85)),
                  ("Esszimmer", (12, 0.15, 17.85, 5.0)), ("Küche", (12, 5.0, 17.85, 9.85)), ("Wintergarten", (7.5, 10.15, 11.5, 12.85)),
                  ("Lesezimmer", (14.15, 10.15, 17.85, 13.85)), ("Garage", (18.15, 0.15, 25.85, 6.85)), ("Gästesuite", (-6.85, 2.15, -0.15, 7.85))):
        raum(1, nm, r)
    # Vorbau (Säulen) und Treppen
    kasten(1, "IFCCOLUMN", "Säule 1", 6.15, -2.35, 0, 0.3, 0.3, 3.0)
    kasten(1, "IFCCOLUMN", "Säule 2", 11.55, -2.35, 0, 0.3, 0.3, 3.0)
    f_treppe = lambda gi, nm, x0, y0, steps, rise: elem[gi].append(f.add(
        f"IFCSTAIR({f.guid()},$,'{esc(nm)}',$,$,{f.place(storeys[gi][1])},"
        + f.add(f"IFCPRODUCTDEFINITIONSHAPE($,$,({f.add(f'IFCSHAPEREPRESENTATION({body},' + chr(39) + 'Body' + chr(39) + ',' + chr(39) + 'SweptSolid' + chr(39) + ',(' + ','.join(f.solid(f.rect_profile(1.2, 0.3, x0 + 0.6, y0 + 0.15 + i * 0.3), (i + 1) * rise) for i in range(steps)) + '))')}))")
        + ",$,.STRAIGHT_RUN_STAIR.)"))
    f_treppe(1, "Treppe EG-OG", 7.0, 4.5, 16, 3.0 / 16)
    # Obergeschoss
    umlauf(2, OG)
    platte(2, OG, 0.25, -0.25, "Decke EG")
    platte(2, [(18, 0), (26, 0), (26, 7), (18, 7)], 0.25, -0.25, "Dachterrasse Garage")
    for a, b in (((26, 0), (26, 7)), ((26, 7), (18, 7)), ((18, 0), (26, 0))):
        wand(2, a, b, 1.0, 0.15, "Brüstung Terrasse", 0.0)
    platte(2, [(6, -2.5), (12, -2.5), (12, 0), (6, 0)], 0.25, -0.25, "Balkon über Vorbau", "BALCONY")
    wand(2, (6, -2.5), (12, -2.5), 1.0, 0.1, "Brüstung Balkon")
    for a, b in (((6, 0.0), (6, 10)), ((12, 0.0), (12, 10)), ((12, 5), (18, 5)), ((9, 0), (9, 4)), ((0, 6), (6, 6))):
        wand(2, a, b, 2.9, 0.15, "Innenwand")
    for k, (x, y, d, b, sill, h, nm) in enumerate([
        (3.0, 0, (1, 0), 1.5, 0.9, 1.35, "S1"), (9.0, 0, (1, 0), 2.4, 0.0, 2.3, "S2"), (15.0, 0, (1, 0), 1.5, 0.9, 1.35, "S3"),
        (-3.5, 2, (1, 0), 1.5, 0.9, 1.35, "S4"), (18, 3.5, (0, 1), 1.2, 0.0, 2.2, "O1"), (18, 8.5, (0, 1), 1.2, 0.9, 1.35, "O2"),
        (18, 12, (0, 1), 1.0, 0.9, 1.35, "O3"), (16, 14, (1, 0), 1.2, 0.9, 1.35, "N1"), (14, 12, (0, 1), 1.0, 0.9, 1.35, "W1"),
        (12.25, 12.25, (-S, S), 1.2, 0.9, 1.35, "N3"), (9.5, 13, (1, 0), 1.6, 0.9, 1.35, "N2"), (6.75, 12.25, (-S, -S), 1.2, 0.9, 1.35, "N4"),
        (3.0, 10, (1, 0), 1.5, 0.9, 1.35, "N5"), (-7, 4, (0, 1), 1.2, 0.9, 1.35, "W2"), (-7, 6, (0, 1), 1.2, 0.9, 1.35, "W3")]):
        oeffnung(2, "fenster", x, y, d, b, sill, h, f"{nm}-OG")
    for nm, r in (("Hauptschlafzimmer", (0.15, 0.15, 6, 6.0)), ("Ankleide", (0.15, 6.0, 6, 9.85)), ("Bad en suite", (6, 0.15, 9, 4.0)),
                  ("Balkonzimmer", (9, 0.15, 12, 4.0)), ("Galerie", (6, 4.0, 12, 9.85)), ("Kinderzimmer 1", (12, 0.15, 17.85, 5.0)),
                  ("Kinderzimmer 2", (12, 5.0, 17.85, 9.85)), ("Erkersalon", (7.5, 10.15, 11.5, 12.85)), ("Turmzimmer", (14.15, 10.15, 17.85, 13.85)),
                  ("Gästesuite OG", (-6.85, 2.15, -0.15, 7.85))):
        raum(2, nm, r)
    f_treppe(2, "Treppe OG-DG", 7.0, 4.5, 15, 2.9 / 15)
    # Dachgeschoss
    umlauf(3, DG, [0.8, 0.8, 2.6, 2.6, 2.6, 2.6, 0.8])
    platte(3, DG, 0.25, -0.25, "Decke OG")
    for k, (x, y, d, b, sill, h, nm) in enumerate([(4.0, 1.2, (1, 0), 1.2, 1.3, 1.5, "Gaube1"), (13.0, 1.2, (1, 0), 1.2, 1.3, 1.5, "Gaube2"),
                                                  (16, 14, (1, 0), 1.2, 0.9, 1.35, "N1"), (18, 12, (0, 1), 1.0, 0.9, 1.35, "O3"),
                                                  (14, 12, (0, 1), 1.0, 0.9, 1.35, "W1"), (9.0, 10, (1, 0), 1.0, 1.6, 0.6, "N5")]):
        oeffnung(3, "fenster", x, y, d, b, sill, h, f"{nm}-DG")
    for nm, r in (("Studio", (0.15, 0.15, 9, 9.85)), ("Galerie DG", (9, 0.15, 17.85, 9.85)), ("Gästebad", (14.15, 10.15, 17.85, 13.85))):
        raum(3, nm, r)
    kasten(3, "IFCBUILDINGELEMENTPROXY", "Gaube 1", 3.0, 1.2, 1.0, 2.2, 1.8, 2.4)
    kasten(3, "IFCBUILDINGELEMENTPROXY", "Gaube 2", 12.0, 1.2, 1.0, 2.2, 1.8, 2.4)
    kasten(3, "IFCBUILDINGELEMENTPROXY", "Schornstein", 2.7, 4.7, 0.0, 0.7, 0.7, 5.5)

    # --- Dächer
    neig = math.radians(38)
    ov = 0.5
    rise = (5 + ov) * math.tan(neig)
    prof = f.poly_profile([(-ov, 0), (10 + ov, 0), (5, rise)])
    pos = f.place(pl_bld, (-ov, 0, 5.9), (1, 0, 0), (0, 1, 0))
    elem[3].append(f.add(f"IFCROOF({f.guid()},$,'Satteldach Haupthaus',$,$,{pos},{f.shape(body, f.solid(prof, 18 + 2 * ov, f.axis3((0, 0, 0))))},$,.GABLE_ROOF.)"))
    prof = f.poly_profile([(-0.4, 0), (7.4, 0), (-0.4, 2.6)])
    pos = f.place(pl_bld, (0, 1.6, 5.9), (0, 1, 0), (-1, 0, 0))
    elem[3].append(f.add(f"IFCROOF({f.guid()},$,'Pultdach Westfl\\X2\\00FC\\X0\\gel',$,$,{pos},{f.shape(body, f.solid(prof, 6.8, f.axis3((0, 0, 0))))},$,.SHED_ROOF.)"))
    for nm, basis, z, spitze in (("Turmdach", [(13.7, 9.7), (18.3, 9.7), (18.3, 14.3), (13.7, 14.3)], 8.5, (16, 12, 11.6)),
                                 ("Erkerdach", [(12.2, 10), (13.2, 11.5), (11.6, 13.2), (7.4, 13.2), (5.8, 11.5), (6.8, 10)], 5.9, (9.5, 11.7, 8.4))):
        pts, tris = pyramide(basis, z, spitze)
        elem[3].append(f.add(f"IFCROOF({f.guid()},$,'{nm}',$,$,{pl_bld},{tess(f, body, pts, tris)},$,.HIP_ROOF.)"))
    for gi, (st, _) in enumerate(storeys):
        f.add(f"IFCRELCONTAINEDINSPATIALSTRUCTURE({f.guid()},$,$,$,({','.join(elem[gi])}),{st})")
    kopf = ("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\n"
            f"FILE_NAME('{name}.ifc','2026-10-11T00:00:00',('Passt.'),('Passt.'),'Passt. Beispielgenerator','Passt.','');\n"
            "FILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n")
    return kopf + "\n".join(f"#{i + 1}={z};" for i, z in enumerate(f.z)) + "\nENDSEC;\nEND-ISO-10303-21;\n"


def main() -> int:
    AUS.mkdir(parents=True, exist_ok=True)
    for datei, kind, seed in (("haus_satteldach", "satteldach", 11), ("haus_l_flachdach", "flach", 12)):
        (AUS / f"{datei}.ifc").write_text(haus(datei, seed, kind), encoding="utf-8")
        print("→", AUS / f"{datei}.ifc")
    (AUS / "villa_hochkomplex.ifc").write_text(villa("villa_hochkomplex", 13), encoding="utf-8")
    print("→", AUS / "villa_hochkomplex.ifc")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
