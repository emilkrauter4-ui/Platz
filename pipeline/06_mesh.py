#!/usr/bin/env python3
"""DOM-Mesh (SLPK/I3S, Los 123028_1) → 3D Tiles für das Gebiet, ohne die 49-GB-Datei zu laden.

Warum eigene Umwandlung statt I3SDataProvider oder tile-converter:
- Das Mesh liegt in ETRS89/UTM32 mit DHHN2016-Höhen (wkid 25832, vcs 7837).
- Cesium I3SDataProvider lehnt alles außer wkid 4326 ab (I3SLayer.load: „Unsupported spatial reference").
- loaders.gl (Grundlage des tile-converter) rechnet OBB und Positionen fest als Länge/Breite um
  (Ellipsoid.WGS84.cartographicToCartesian in parse-i3s.js / parse-i3s-tile-content.js).
Deshalb: Knoten per HTTP-Range aus dem SLPK lesen, Draco dekodieren, über GCG2016 nach ECEF rechnen
und als 3D Tiles 1.1 (GLB mit JPEG-Textur) schreiben – derselbe Weg wie bei LoD2.

Stufen: python3 06_mesh.py baum    → Knotenbaum im Gebiet, Statistik je Ebene
        python3 06_mesh.py kacheln [max_ebene]
"""
from __future__ import annotations

import json
import struct
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import DracoPy
import numpy as np

from common import app_data_dir, cfg, raw_dir
from geoid import to_ecef, to_geographic3d
from slpk_remote import RemoteSlpk

URL = "https://download1.bayernwolke.de/p/dom-mesh-slpk/123028_1/DSM_Mesh.slpk"
PER_PAGE = 64


def quat_matrix(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def obb_aabb(obb):
    r = np.abs(quat_matrix(obb["quaternion"])) @ np.array(obb["halfSize"])
    c = np.array(obb["center"])
    return c - r, c + r


class Tree:
    def __init__(self, slpk: RemoteSlpk, cache: Path):
        self.s, self.cache, self.pages = slpk, cache, {}

    def node(self, i: int) -> dict:
        p = i // PER_PAGE
        if p not in self.pages:
            f = self.cache / f"page_{p}.json"
            if f.exists():
                self.pages[p] = json.loads(f.read_text())
            else:
                self.pages[p] = self.s.json(f"nodepages/{p}.json")
                f.write_text(json.dumps(self.pages[p]))
        return self.pages[p]["nodes"][i - p * PER_PAGE]

    def area_nodes(self, bbox, margin=0.0):
        x0, y0, x1, y1 = bbox
        out, stack = [], [(0, 0)]
        while stack:
            i, lvl = stack.pop()
            n = self.node(i)
            lo, hi = obb_aabb(n["obb"])
            if hi[0] < x0 - margin or lo[0] > x1 + margin or hi[1] < y0 - margin or lo[1] > y1 + margin:
                continue
            out.append((i, lvl, n))
            stack.extend((c, lvl + 1) for c in n.get("children", []))
        return out


def baum():
    s = RemoteSlpk(URL, raw_dir() / "mesh" / "123028_1")
    t = Tree(s, raw_dir() / "mesh" / "123028_1")
    nodes = t.area_nodes(cfg()["gebiet"]["bbox"])
    by_lvl = Counter(l for _, l, n in nodes if "mesh" in n)
    print("Knoten im Gebiet:", len(nodes))
    for lvl in sorted(by_lvl):
        sel = [n for _, l, n in nodes if l == lvl and "mesh" in n]
        size = np.mean([2 * max(n["obb"]["halfSize"][:2]) for n in sel])
        sizes = []
        for n in sel[:5]:
            r = n["mesh"]["geometry"]["resource"]
            sizes.append(sum(s.entries.get(f"nodes/{r}/{k}", (0, 0, 0))[1] for k in ("geometries/1.bin.gz", "textures/0.jpg")))
        est = np.mean(sizes) * len(sel) / 1e6 if sizes else 0
        print(f"  Ebene {lvl:2}: {by_lvl[lvl]:5} Knoten, ~{size:6.0f} m Kante, Schwelle {np.median([n['lodThreshold'] for n in sel]):10.0f}, "
              f"≈ {est:6.1f} MB (Draco+JPEG)")
    (raw_dir() / "mesh" / "area_nodes.json").write_text(json.dumps([[i, l] for i, l, _ in nodes]))


def read_node(s: RemoteSlpk, n: dict):
    """Unkomprimierte I3S-Geometrie (Positionen relativ zur OBB-Mitte, UTM-Meter + DHHN2016) und JPEG-Textur."""
    r = n["mesh"]["geometry"]["resource"]
    name = f"nodes/{r}/geometries/0.bin.gz" if f"nodes/{r}/geometries/0.bin.gz" in s.entries else f"nodes/{r}/geometries/0.bin"
    g = s.read(name)
    vc, _fc = struct.unpack("<II", g[:8])
    pos = np.frombuffer(g, dtype="<f4", count=vc * 3, offset=8).reshape(-1, 3).astype(np.float64)
    uv = np.frombuffer(g, dtype="<f4", count=vc * 2, offset=8 + vc * 12).reshape(-1, 2).astype(np.float64)
    R = quat_matrix(n["obb"]["quaternion"])
    utm = pos @ R.T + np.array(n["obb"]["center"])
    tex = s.read(f"nodes/{r}/textures/0.jpg")
    return utm, uv, tex


def glb_textured(draco: bytes, n_vert: int, n_idx: int, pmin, pmax, tex: bytes) -> bytes:
    """GLB mit Draco-Geometrie (KHR_draco_mesh_compression) und eingebetteter JPEG-Textur, unbeleuchtet (Foto)."""
    parts, views, off = [], [], 0
    for blob in (draco, tex):
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(blob)})
        parts.append(blob)
        off += len(blob)
        pad = (-off) % 4
        parts.append(b"\0" * pad)
        off += pad
    binary = b"".join(parts)
    gltf = {
        "asset": {"version": "2.0", "generator": "passt-pipeline", "copyright": "Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (CC BY 4.0)"},
        "extensionsUsed": ["KHR_draco_mesh_compression", "KHR_materials_unlit"],
        "extensionsRequired": ["KHR_draco_mesh_compression"],
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{
            "attributes": {"POSITION": 0, "TEXCOORD_0": 1}, "indices": 2, "material": 0, "mode": 4,
            "extensions": {"KHR_draco_mesh_compression": {"bufferView": 0, "attributes": {"POSITION": 1, "TEXCOORD_0": 0}}},
        }]}],
        "accessors": [
            {"componentType": 5126, "count": n_vert, "type": "VEC3", "min": list(map(float, pmin)), "max": list(map(float, pmax))},
            {"componentType": 5126, "count": n_vert, "type": "VEC2"},
            {"componentType": 5125, "count": n_idx, "type": "SCALAR"},
        ],
        "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 1},
                       "doubleSided": True, "extensions": {"KHR_materials_unlit": {}}}],
        "textures": [{"source": 0, "sampler": 0}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "images": [{"bufferView": 1, "mimeType": "image/jpeg"}],
        "bufferViews": views, "buffers": [{"byteLength": len(binary)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    return (struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js
            + struct.pack("<II", len(binary), 0x004E4942) + binary)


def convert(s: RemoteSlpk, n: dict, out: Path):
    utm, uv, tex = read_node(s, n)
    # doppelte Eckpunkte zusammenführen (I3S speichert jedes Dreieck mit eigenen Ecken)
    key = np.round(np.c_[utm, uv * 4096], 3)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    first = np.zeros(len(uniq), np.int64)
    first[inv[::-1]] = np.arange(len(inv))[::-1]
    utm_u, uv_u = utm[first], uv[first]
    faces = inv.reshape(-1, 3)
    lon, lat, h = to_geographic3d().transform(utm_u[:, 0], utm_u[:, 1], utm_u[:, 2])
    X, Y, Z = to_ecef().transform(lon, lat, h)
    xyz = np.c_[X, Y, Z]
    center = xyz.mean(axis=0)
    rel = (xyz - center)[:, [0, 2, 1]] * [1, 1, -1]  # ECEF → glTF y-up
    # glTF-UV: Ursprung oben links (I3S ebenso)
    draco = DracoPy.encode(rel, faces, quantization_bits=14, compression_level=7, tex_coord=uv_u)
    dec = DracoPy.decode(draco)
    pts = np.asarray(dec.points)
    out.write_bytes(glb_textured(draco, len(pts), int(np.asarray(dec.faces).size), pts.min(0), pts.max(0), tex))
    lonr, latr = np.radians(lon), np.radians(lat)
    region = [float(lonr.min()), float(latr.min()), float(lonr.max()), float(latr.max()), float(h.min()), float(h.max())]
    return center, region, len(faces)


def kacheln(min_lvl: int = 9, max_lvl: int = 99):
    s = RemoteSlpk(URL, raw_dir() / "mesh" / "123028_1")
    t = Tree(s, raw_dir() / "mesh" / "123028_1")
    nodes = {i: (l, t.node(i)) for i, l in json.loads((raw_dir() / "mesh" / "area_nodes.json").read_text())}
    sel = {i: (l, n) for i, (l, n) in nodes.items() if min_lvl <= l <= max_lvl and "mesh" in n}
    out = app_data_dir() / "mesh"
    out.mkdir(exist_ok=True)

    def job(i):
        f = out / f"n{i}.glb"
        meta = raw_dir() / "mesh" / "konvertiert" / f"n{i}.json"
        meta.parent.mkdir(exist_ok=True)
        if meta.exists() and f.exists():
            return i, json.loads(meta.read_text())
        center, region, tris = convert(s, sel[i][1], f)
        m = {"center": center.tolist(), "region": region, "tris": tris}
        meta.write_text(json.dumps(m))
        return i, m

    done = {}
    with ThreadPoolExecutor(8) as ex:
        for k, (i, m) in enumerate(ex.map(job, sel)):
            done[i] = m
            if k % 25 == 0:
                print(f"  {k + 1}/{len(sel)} Knoten")

    def tile(i):
        lvl, n = sel[i]
        kids = [c for c in n.get("children", []) if c in sel]
        hs = n["obb"]["halfSize"]
        diag = 2 * float(np.linalg.norm(hs))
        # I3S „maxScreenThresholdSQ": verfeinern, wenn (Bildschirmdurchmesser)² > Schwelle.
        # 3D Tiles: verfeinern, wenn geometricError · k > 16 px (maximumScreenSpaceError).
        err = diag * 16 / np.sqrt(max(n["lodThreshold"], 1.0)) if kids else 0.0
        m = done[i]
        return {
            "boundingVolume": {"region": m["region"]},
            "geometricError": round(float(err), 3),
            "refine": "REPLACE",
            "transform": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, *m["center"], 1],
            "content": {"uri": f"n{i}.glb"},
            **({"children": [tile(c) for c in kids]} if kids else {}),
        }

    roots = [i for i, (l, _) in sel.items() if l == min_lvl]
    children = [tile(i) for i in roots]
    regs = np.array([done[i]["region"] for i in sel])
    tileset = {
        "asset": {"version": "1.1", "generator": "passt-pipeline"},
        "geometricError": 5000,
        "root": {"boundingVolume": {"region": [regs[:, 0].min(), regs[:, 1].min(), regs[:, 2].max(), regs[:, 3].max(), regs[:, 4].min(), regs[:, 5].max()]},
                 "geometricError": 1000, "refine": "REPLACE", "children": children},
        "extras": {"quelle": "DOM-Mesh, Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (CC BY 4.0)", "los": "123028_1", "label": "amtlich"},
    }
    (out / "tileset.json").write_text(json.dumps(tileset), encoding="utf-8")
    size = sum(p.stat().st_size for p in out.glob("*.glb"))
    print(f"DOM-Mesh: {len(sel)} Knoten (Ebene {min_lvl}–{max(l for l, _ in sel.values())}), {sum(d['tris'] for d in done.values())} Dreiecke, {size / 1e6:.1f} MB")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "baum"
    if cmd == "baum":
        baum()
    elif cmd == "kacheln":
        kacheln(*(int(v) for v in sys.argv[2:4]))
