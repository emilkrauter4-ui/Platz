#!/usr/bin/env python3
"""LoD2-Flächen (aus 01_buildings) → 3D Tiles 1.1 (glTF/GLB-Inhalt), ohne Drittwerkzeug.

Warum selbst geschrieben: Py3DTilers bzw. 3DCityDB sind für eine 2×2-km-Kachel schwergewichtig;
das Format ist einfach (tileset.json + GLB). Die Flächen werden unverändert übernommen
(CC BY 4.0 erlaubt Bearbeitung), nur trianguliert und nach ECEF umgerechnet.

Kacheln: 250 m × 250 m, refine ADD. Positionen relativ zur Kachelmitte (RTC über tile.transform),
glTF ist y-up: gespeichert wird (X, Z, −Y), Cesium dreht beim Laden zurück.
"""
from __future__ import annotations

import json
import pickle
import struct
import sys
from collections import defaultdict

import mapbox_earcut as earcut
import numpy as np

from common import app_data_dir, cfg, gebiet_build_dir
from geoid import to_ecef, to_geographic3d

TILE_M = 250
COLORS = {"roof": [0.80, 0.80, 0.78, 1.0], "wall": [0.98, 0.98, 0.97, 1.0]}


def triangulate(ring: np.ndarray) -> np.ndarray | None:
    """Ebenes 3D-Polygon triangulieren; Rückgabe Indexliste (k×3) oder None."""
    p = ring - ring.mean(axis=0)
    # Normale nach Newell
    nx = ny = nz = 0.0
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    n = np.array([nx, ny, nz])
    if np.linalg.norm(n) < 1e-9:
        return None
    drop = int(np.argmax(np.abs(n)))
    keep = [i for i in range(3) if i != drop]
    xy = p[:, keep].astype(np.float64)
    idx = earcut.triangulate_float64(xy, np.array([len(xy)], dtype=np.uint32))
    if len(idx) == 0:
        return None
    return np.asarray(idx, dtype=np.uint32).reshape(-1, 3)


def glb(positions: dict[str, np.ndarray], normals: dict[str, np.ndarray]) -> bytes:
    """GLB mit je einer Primitive pro Flächenart (nicht indiziert, flache Normalen).

    KHR_mesh_quantization: Positionen als normierte int16 (Knoten-Skalierung = Ausdehnung,
    Auflösung < 1 cm), Normalen als normierte int8. Halbiert die Kachelgröße gegenüber float32.
    """
    bin_parts, views, accessors, prims, mats = [], [], [], [], []
    offset = 0
    allpos = np.vstack([p for p in positions.values() if len(p)])
    scale = float(np.abs(allpos).max()) or 1.0

    def add(data: bytes, stride: int) -> int:
        nonlocal offset
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data), "byteStride": stride, "target": 34962})
        bin_parts.append(data)
        offset += len(data)
        pad = (-offset) % 4
        if pad:
            bin_parts.append(b"\0" * pad)
            offset += pad
        return len(views) - 1

    for kind, pos in positions.items():
        if not len(pos):
            continue
        q = np.round(pos / scale * 32767).astype("<i2")
        qp = np.zeros((len(q), 4), "<i2")  # 8-Byte-Schritt (Ausrichtung auf 4 Byte)
        qp[:, :3] = q
        pv = add(qp.tobytes(), 8)
        accessors.append({"bufferView": pv, "componentType": 5122, "normalized": True, "count": len(pos), "type": "VEC3",
                          "min": (q.min(axis=0) / 32767).tolist(), "max": (q.max(axis=0) / 32767).tolist()})
        pa = len(accessors) - 1
        qn = np.zeros((len(pos), 4), "<i1")
        qn[:, :3] = np.round(normals[kind] * 127).astype("<i1")
        nv = add(qn.tobytes(), 4)
        accessors.append({"bufferView": nv, "componentType": 5120, "normalized": True, "count": len(pos), "type": "VEC3"})
        na = len(accessors) - 1
        mats.append({"name": kind, "pbrMetallicRoughness": {"baseColorFactor": COLORS[kind], "metallicFactor": 0, "roughnessFactor": 1}})
        prims.append({"attributes": {"POSITION": pa, "NORMAL": na}, "material": len(mats) - 1, "mode": 4})

    binary = b"".join(bin_parts)
    gltf = {
        "asset": {"version": "2.0", "generator": "passt-pipeline", "copyright": "Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (CC BY 4.0)"},
        "extensionsUsed": ["KHR_mesh_quantization"], "extensionsRequired": ["KHR_mesh_quantization"],
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "scale": [scale, scale, scale]}],
        "meshes": [{"primitives": prims}], "materials": mats,
        "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(binary)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    return (struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js
            + struct.pack("<II", len(binary), 0x004E4942) + binary)


def main() -> int:
    x0, y0, x1, y1 = cfg()["gebiet"]["bbox"]
    surfaces = pickle.load(open(gebiet_build_dir() / "surfaces.pkl", "rb"))
    out = app_data_dir() / "tiles"
    out.mkdir(parents=True, exist_ok=True)
    geo, ecef = to_geographic3d(), to_ecef()

    # Gebäude nach Kachel ihres ersten Punkts gruppieren
    per_tile: dict[tuple[int, int], list] = defaultdict(list)
    for bid, s in surfaces.items():
        pts = np.vstack(s["roof"] + s["wall"]) if (s["roof"] or s["wall"]) else None
        if pts is None:
            continue
        cx, cy = pts[:, 0].mean(), pts[:, 1].mean()
        tx, ty = int((cx - x0) // TILE_M), int((cy - y0) // TILE_M)
        per_tile[(max(0, min(tx, 7)), max(0, min(ty, 7)))].append(s)

    children, n_tri = [], 0
    for (tx, ty), blds in sorted(per_tile.items()):
        tris: dict[str, list[np.ndarray]] = {"roof": [], "wall": []}
        for s in blds:
            for kind in ("roof", "wall"):
                for ring in s[kind]:
                    idx = triangulate(ring)
                    if idx is not None:
                        tris[kind].append(ring[idx].reshape(-1, 3))
        allpts = np.vstack([np.vstack(v) for v in tris.values() if v])
        lon, lat, h = geo.transform(allpts[:, 0], allpts[:, 1], allpts[:, 2])
        X, Y, Z = ecef.transform(lon, lat, h)
        XYZ = np.c_[X, Y, Z]
        center = XYZ.mean(axis=0)
        positions, normals, k = {}, {}, 0
        for kind in ("roof", "wall"):
            cnt = sum(len(t) for t in tris[kind])
            rel = XYZ[k:k + cnt] - center
            k += cnt
            if not cnt:
                positions[kind] = np.zeros((0, 3))
                continue
            a, b, c = rel[0::3], rel[1::3], rel[2::3]
            nrm = np.cross(b - a, c - a)
            nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
            nrm = np.repeat(nrm, 3, axis=0)
            # ECEF → glTF y-up: (X, Z, −Y)
            positions[kind] = rel[:, [0, 2, 1]] * [1, 1, -1]
            normals[kind] = nrm[:, [0, 2, 1]] * [1, 1, -1]
            n_tri += cnt // 3
        name = f"b_{tx}_{ty}.glb"
        (out / name).write_bytes(glb(positions, normals))
        lonr, latr = np.radians(lon), np.radians(lat)
        children.append({
            "boundingVolume": {"region": [float(lonr.min()), float(latr.min()), float(lonr.max()), float(latr.max()), float(h.min()), float(h.max())]},
            "geometricError": 0,
            "transform": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, *center.tolist(), 1],
            "content": {"uri": name},
        })

    regions = np.array([c["boundingVolume"]["region"] for c in children])
    root_region = [regions[:, 0].min(), regions[:, 1].min(), regions[:, 2].max(), regions[:, 3].max(), regions[:, 4].min(), regions[:, 5].max()]
    tileset = {
        "asset": {"version": "1.1", "generator": "passt-pipeline"},
        "geometricError": 2000,
        "root": {"boundingVolume": {"region": [float(v) for v in root_region]}, "geometricError": 400, "refine": "ADD", "children": children},
        "extras": {"quelle": "3D-Gebäudemodelle LoD2, Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (CC BY 4.0)", "label": "amtlich"},
    }
    (out / "tileset.json").write_text(json.dumps(tileset), encoding="utf-8")
    size = sum(p.stat().st_size for p in out.glob("*.glb"))
    print(f"3D Tiles: {len(children)} Kacheln, {n_tri} Dreiecke, {size / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
