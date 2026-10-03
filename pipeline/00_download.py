#!/usr/bin/env python3
"""Lädt die amtlichen Rohdaten für das Gebiet aus config.yaml nach data/raw.

Alle Datensätze: Bayerische Vermessungsverwaltung, CC BY 4.0.
Bereits vorhandene Dateien werden übersprungen.
"""
from __future__ import annotations

import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from common import cfg, raw_dir

UA = {"User-Agent": "passt-mvp-pipeline/0.1"}


def fetch(url: str, dest: Path, data: bytes | None = None) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  vorhanden  {dest.name}")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, data=data, headers=UA)
    print(f"  lade       {dest.name}")
    with urllib.request.urlopen(req, timeout=600) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.rename(dest)
    return dest


def km_tiles(bbox, step_km: int):
    x0, y0, x1, y1 = (int(v // 1000) for v in bbox)
    x0 -= x0 % step_km
    y0 -= y0 % step_km
    for x in range(x0, x1 if x1 > x0 else x0 + 1, step_km):
        for y in range(y0, y1 if y1 > y0 else y0 + 1, step_km):
            yield x, y


def main() -> int:
    c = cfg()
    q = c["quellen"]
    bbox = c["gebiet"]["bbox"]
    raw = raw_dir()

    print("LoD2 (CityGML, 2-km-Kacheln)")
    for x, y in km_tiles(bbox, 2):
        fetch(q["lod2"].format(x=x, y=y), raw / "lod2" / f"{x}_{y}.gml")

    for key in ("dgm1", "dom20", "dop20"):
        print(f"{key.upper()} (1-km-Kacheln)")
        for x, y in km_tiles(bbox, 1):
            fetch(q[key].format(x=x, y=y), raw / key / f"{x}_{y}.tif")

    print("DOP20 CIR (über poly2metalink)")
    x0, y0, x1, y1 = bbox
    wkt = f"SRID=25832;MULTIPOLYGON((({x0+1} {y0+1},{x1-1} {y0+1},{x1-1} {y1-1},{x0+1} {y1-1},{x0+1} {y0+1})))"
    req = urllib.request.Request(q["dop20cir_metalink"], data=wkt.encode(), headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        meta = ET.fromstring(r.read())
    ns = {"m": "urn:ietf:params:xml:ns:metalink"}
    for f in meta.findall("m:file", ns):
        name = f.get("name")
        url = f.find("m:url", ns).text
        ex, ny = (int(v) // 1000 for v in Path(name).stem.split("_"))
        fetch(url, raw / "dop20cir" / f"{ex}_{ny}.tif")

    print("Hausumringe (Regierungsbezirk Oberpfalz)")
    z = fetch(q["hausumringe"], raw / "hausumringe" / "093_Oberpfalz_Hausumringe.zip")
    out = raw / "hausumringe" / "shp"
    if not out.exists():
        with zipfile.ZipFile(z) as zf:
            zf.extractall(out)
    print("fertig")
    return 0


if __name__ == "__main__":
    sys.exit(main())
