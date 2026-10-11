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


def main() -> int:
    AUS.mkdir(parents=True, exist_ok=True)
    for datei, kind, seed in (("haus_satteldach", "satteldach", 11), ("haus_l_flachdach", "flach", 12)):
        (AUS / f"{datei}.ifc").write_text(haus(datei, seed, kind), encoding="utf-8")
        print("→", AUS / f"{datei}.ifc")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
