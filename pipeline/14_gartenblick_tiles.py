#!/usr/bin/env python3
"""Gartenblick (AUFTRAG_V2 Phase 5.4): Gaussian Splats → 3D Tiles für CesiumJS (KHR_gaussian_splatting +
KHR_gaussian_splatting_compression_spz_2, wie Cesium 1.13x/engine 26 sie lädt – dort als „experimental“ markiert).

Eingabe:
  - trainierte 3DGS-PLY (Felder x y z, f_dc_0..2, opacity, scale_0..2, rot_0..3; Inria-/gsplat-Format) im lokalen
    System von gartenblick_render.mjs (x = UTM-Ost, y = UTM-Nord, z = Ellipsoidhöhe, Ursprung aus meta.json), oder
  - `synthetisch`: aus points3D.txt (eingefärbte Laserpunkte) runde Splats bauen – nur zum Prüfen des Weges ohne GPU.

Ausgabe: <ziel>/tileset.json + <ziel>/splats.glb (ein Tile, Transform ENU → ECEF).

SPZ (Niantic, MIT) Version 2, selbst geschrieben: Kopf (magic NGSP, Version, Anzahl, SH-Grad, Nachkommabits, Flags)
und gzip-komprimiert Positionen (24 Bit Festkomma), Deckkraft (uint8 nach Sigmoid), Farbe (uint8, Skala 0,15),
Skalen (uint8, (log s + 10)·16), Rotation (uint8 xyz, w ≥ 0). Geprüft mit Cesiums Decoder (@spz-loader/core) in
`app/scripts/spz-pruefen.mjs`.

Aufruf:
  python3 14_gartenblick_tiles.py synthetisch data/build/gartenblick/grenze app/public/data/gartenblick/grenze
  python3 14_gartenblick_tiles.py ply <punkte.ply> data/build/gartenblick/grenze app/public/data/gartenblick/grenze
  python3 14_gartenblick_tiles.py geometrie <punkte.ply> data/build/gartenblick/grenze   (Abweichung zum Laser)
"""
from __future__ import annotations

import gzip
import json
import struct
import sys
import time
from pathlib import Path

import numpy as np
import pyproj

from geoid import to_ecef

SH_C0 = 0.28209479177387814
FRAKTION = 12


# ---------- Eingabe ----------

def ply_lesen(pfad: Path) -> dict[str, np.ndarray]:
    roh = pfad.read_bytes()
    ende = roh.index(b"end_header\n") + len(b"end_header\n")
    kopf = roh[:ende].decode("ascii").splitlines()
    if "format binary_little_endian 1.0" not in kopf:
        raise SystemExit("nur binary_little_endian-PLY")
    n = int(next(z for z in kopf if z.startswith("element vertex")).split()[-1])
    typen = {"float": "<f4", "double": "<f8", "uchar": "u1", "int": "<i4", "uint": "<u4", "short": "<i2", "ushort": "<u2"}
    felder = [(z.split()[2], typen[z.split()[1]]) for z in kopf if z.startswith("property ")]
    d = np.frombuffer(roh, dtype=np.dtype(felder), count=n, offset=ende)
    return {
        "pos": np.stack([d["x"], d["y"], d["z"]], 1).astype(np.float64),
        "f_dc": np.stack([d["f_dc_0"], d["f_dc_1"], d["f_dc_2"]], 1).astype(np.float32),
        "opacity": d["opacity"].astype(np.float32),  # Logit
        "scale": np.stack([d["scale_0"], d["scale_1"], d["scale_2"]], 1).astype(np.float32),  # log
        "rot": np.stack([d["rot_0"], d["rot_1"], d["rot_2"], d["rot_3"]], 1).astype(np.float32),  # w x y z
    }


def synthetisch(ordner: Path, radius_m: float = 0.09) -> dict[str, np.ndarray]:
    """Runde Splats aus points3D.txt (Laser + DOP-Farbe): Prüfdaten ohne Training."""
    a = np.loadtxt(ordner / "points3D.txt", comments="#", usecols=(1, 2, 3, 4, 5, 6))
    n = len(a)
    rgb = a[:, 3:6] / 255.0
    return {
        "pos": a[:, :3],
        "f_dc": ((rgb - 0.5) / SH_C0).astype(np.float32),
        "opacity": np.full(n, np.log(0.9 / 0.1), np.float32),
        "scale": np.full((n, 3), np.log(radius_m), np.float32),
        "rot": np.tile(np.array([1, 0, 0, 0], np.float32), (n, 1)),
    }


# ---------- Koordinaten ----------

def quat_mul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Hamilton-Produkt, Reihenfolge w x y z."""
    aw, ax, ay, az = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bw, bx, by, bz = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([aw * bw - ax * bx - ay * by - az * bz, aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw], -1)


def gitter_zu_gltf(g: dict[str, np.ndarray], gamma_rad: float, k: float) -> dict[str, np.ndarray]:
    """Lokales UTM-Gitter (x Ost, y Nord, z oben) → wahres ENU (Meridiankonvergenz γ, Maßstab k) → glTF (y oben):
    glTF = (e, u, −n)."""
    x, y, z = g["pos"][:, 0], g["pos"][:, 1], g["pos"][:, 2]
    c, s = np.cos(gamma_rad), np.sin(gamma_rad)
    e = (x * c + y * s) / k
    nn = (-x * s + y * c) / k
    pos = np.stack([e, z, -nn], 1)
    # gleiche Drehung für die Orientierung: erst um z (−γ, Gitter → ENU), dann um x (−90°, z oben → y oben)
    qz = np.array([np.cos(-gamma_rad / 2), 0, 0, np.sin(-gamma_rad / 2)])
    qx = np.array([np.cos(-np.pi / 4), np.sin(-np.pi / 4), 0, 0])
    q = g["rot"] / np.linalg.norm(g["rot"], axis=1, keepdims=True)
    q = quat_mul(np.broadcast_to(quat_mul(qx, qz), q.shape), q)
    return {**g, "pos": pos, "rot": q.astype(np.float32), "scale": (g["scale"] - np.log(k)).astype(np.float32)}


def enu_zu_ecef(lon: float, lat: float, h: float) -> list[float]:
    X, Y, Z = to_ecef().transform(lon, lat, h)
    lo, la = np.radians(lon), np.radians(lat)
    e = [-np.sin(lo), np.cos(lo), 0.0]
    n = [-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)]
    u = [np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)]
    # 3D Tiles: Spaltenweise 4×4
    return [*e, 0, *n, 0, *u, 0, X, Y, Z, 1]


# ---------- SPZ ----------

def spz(g: dict[str, np.ndarray]) -> bytes:
    n = len(g["pos"])
    kopf = struct.pack("<IIIBBBB", 0x5053474E, 2, n, 0, FRAKTION, 0, 0)
    fest = np.round(g["pos"] * (1 << FRAKTION)).astype(np.int64)
    if np.abs(fest).max() >= (1 << 23):
        raise SystemExit("Positionen außerhalb ±2048 m – Ursprung prüfen")
    fest &= 0xFFFFFF
    pos = np.stack([fest & 0xFF, (fest >> 8) & 0xFF, (fest >> 16) & 0xFF], -1).astype(np.uint8).reshape(n, 9)
    u8 = lambda v: np.clip(np.round(v), 0, 255).astype(np.uint8)
    alpha = u8(1 / (1 + np.exp(-g["opacity"])) * 255)
    farbe = u8(g["f_dc"] * (0.15 * 255) + 0.5 * 255)
    skala = u8((g["scale"] + 10) * 16)
    q = g["rot"] / np.linalg.norm(g["rot"], axis=1, keepdims=True)
    q = np.where(q[:, :1] < 0, -q, q)  # w ≥ 0
    rot = u8(q[:, 1:4] * 127.5 + 127.5)  # x y z
    daten = kopf + pos.tobytes() + alpha.tobytes() + farbe.tobytes() + skala.tobytes() + rot.tobytes()
    return gzip.compress(daten, compresslevel=9, mtime=0)


# ---------- glTF / 3D Tiles ----------

def glb(g: dict[str, np.ndarray], spz_bytes: bytes) -> bytes:
    n = len(g["pos"])
    mn, mx = g["pos"].min(0).tolist(), g["pos"].max(0).tolist()
    acc = lambda typ, **kw: {"componentType": 5126, "count": n, "type": typ, **kw}
    js = {
        "asset": {"version": "2.0", "generator": "Passt. 14_gartenblick_tiles.py"},
        "extensionsUsed": ["KHR_gaussian_splatting", "KHR_gaussian_splatting_compression_spz_2"],
        "extensionsRequired": ["KHR_gaussian_splatting", "KHR_gaussian_splatting_compression_spz_2"],
        "buffers": [{"byteLength": len(spz_bytes)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(spz_bytes)}],
        # COLOR_0: Cesium baut daraus RGBA als uint8 (GltfVertexBufferLoader) – der Accessor muss dazu passen
        "accessors": [acc("VEC3", min=mn, max=mx), {**acc("VEC4"), "componentType": 5121, "normalized": True},
                      acc("VEC3"), acc("VEC4"), acc("SCALAR")],
        "meshes": [{"primitives": [{
            "mode": 0,
            "attributes": {"POSITION": 0, "COLOR_0": 1, "KHR_gaussian_splatting:SCALE": 2,
                           "KHR_gaussian_splatting:ROTATION": 3, "KHR_gaussian_splatting:OPACITY": 4},
            "extensions": {"KHR_gaussian_splatting": {
                "kernel": "ellipse", "colorSpace": "srgb_rec709_display",
                "extensions": {"KHR_gaussian_splatting_compression_spz_2": {"bufferView": 0}}}},
        }]}],
        "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
    }
    j = json.dumps(js, separators=(",", ":")).encode()
    j += b" " * ((4 - len(j) % 4) % 4)
    b = spz_bytes + b"\0" * ((4 - len(spz_bytes) % 4) % 4)
    gesamt = 12 + 8 + len(j) + 8 + len(b)
    return struct.pack("<III", 0x46546C67, 2, gesamt) + struct.pack("<II", len(j), 0x4E4F534A) + j + struct.pack("<II", len(b), 0x004E4942) + b


def schreiben(g: dict[str, np.ndarray], ordner: Path, ziel: Path, herkunft: str) -> int:
    meta = json.loads((ordner / "meta.json").read_text(encoding="utf-8"))
    site = json.loads((Path(__file__).resolve().parent.parent / "app" / "public" / "data" / "site.json").read_text(encoding="utf-8"))
    E0 = site["origin"][0] + meta["ursprung_lokal"][0]
    N0 = site["origin"][1] + meta["ursprung_lokal"][1]
    H0 = meta["ursprung_lokal"][2]
    utm = pyproj.Proj("EPSG:25832")
    lon, lat = utm(E0, N0, inverse=True)
    f = utm.get_factors(lon, lat)
    gamma = np.radians(f.meridian_convergence)
    k = f.meridional_scale
    t = gitter_zu_gltf(g, gamma, k)
    s = spz(t)
    ziel.mkdir(parents=True, exist_ok=True)
    (ziel / "splats.glb").write_bytes(glb(t, s))
    r = float(np.percentile(np.linalg.norm(t["pos"], axis=1), 99.5)) + 5
    tileset = {
        "asset": {"version": "1.1", "generator": "Passt."},
        "extensionsUsed": ["3DTILES_content_gltf"],
        "extensions": {"3DTILES_content_gltf": {
            "extensionsUsed": ["KHR_gaussian_splatting", "KHR_gaussian_splatting_compression_spz_2"],
            "extensionsRequired": ["KHR_gaussian_splatting", "KHR_gaussian_splatting_compression_spz_2"]}},
        "geometricError": 50,
        "root": {"boundingVolume": {"sphere": [0, 0, 0, r]}, "geometricError": 0, "refine": "ADD",
                 "transform": enu_zu_ecef(lon, lat, H0), "content": {"uri": "splats.glb"}},
        "properties": {},
    }
    (ziel / "tileset.json").write_text(json.dumps(tileset, indent=1), encoding="utf-8")
    info = {"demo": meta["demo"], "herkunft": herkunft, "splats": len(t["pos"]), "erstellt": time.strftime("%Y-%m-%d"),
            "kennzeichnung": "KI-Visualisierung, nicht gemessen", "konvergenz_grad": round(float(np.degrees(gamma)), 4),
            "massstab": round(float(k), 6), "quelle": meta["quelle"]}
    (ziel / "info.json").write_text(json.dumps(info, indent=1, ensure_ascii=False), encoding="utf-8")
    # Stichprobe mit Sollwerten für app/scripts/spz-pruefen.mjs (Decoder von Cesium)
    idx = np.linspace(0, len(t["pos"]) - 1, min(200, len(t["pos"]))).astype(int)
    stich = [{"i": int(i), "pos": t["pos"][i].tolist(), "farbe": t["f_dc"][i].tolist(), "skala": t["scale"][i].tolist(),
              "deckkraft": float(1 / (1 + np.exp(-t["opacity"][i]))), "rot": (t["rot"][i] / np.linalg.norm(t["rot"][i])).tolist()} for i in idx]
    (ordner / "spz_soll.json").write_text(json.dumps({"stichprobe": stich}), encoding="utf-8")
    print(f"{len(t['pos'])} Splats, SPZ {len(s) / 1e6:.1f} MB → {ziel} (γ {np.degrees(gamma):.3f}°, k {k:.6f})")
    return 0


def geometrie(ply: Path, ordner: Path) -> int:
    """Phase 5.4: Splat-Geometrie gegen den Laser. Abstand jeder deutlich sichtbaren Splat-Mitte (Deckkraft > 0,5)
    zum nächsten Laserpunkt und umgekehrt (Vollständigkeit), nur im Umkreis von 40 m. Ergebnis → geometrie.json."""
    from scipy.spatial import cKDTree
    g = ply_lesen(ply)
    laser = np.loadtxt(ordner / "points3D.txt", comments="#", usecols=(1, 2, 3))
    sichtbar = 1 / (1 + np.exp(-g["opacity"])) > 0.5
    s = g["pos"][sichtbar]
    s = s[np.hypot(s[:, 0], s[:, 1]) < 40]
    lz = laser[np.hypot(laser[:, 0], laser[:, 1]) < 40]
    d_s = cKDTree(lz).query(s)[0]
    d_l = cKDTree(s).query(lz)[0]
    erg = {"splats_sichtbar": int(len(s)), "laserpunkte": int(len(lz)),
           "splat_zu_laser_median_m": round(float(np.median(d_s)), 3), "splat_zu_laser_p90_m": round(float(np.percentile(d_s, 90)), 3),
           "laser_zu_splat_median_m": round(float(np.median(d_l)), 3), "laser_zu_splat_p90_m": round(float(np.percentile(d_l, 90)), 3),
           "hinweis": "Laser März 2025, Mesh/Bilder 2023: Abweichungen bei Bäumen und Umbauten sind echt"}
    (ordner / "geometrie.json").write_text(json.dumps(erg, indent=1, ensure_ascii=False), encoding="utf-8")
    print(erg)
    return 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) >= 3 and a[0] == "geometrie":
        sys.exit(geometrie(Path(a[1]), Path(a[2])))
    if len(a) >= 3 and a[0] == "synthetisch":
        sys.exit(schreiben(synthetisch(Path(a[1])), Path(a[1]), Path(a[2]), "synthetisch aus Laserpunkten (Prüfdaten, kein Training)"))
    if len(a) >= 4 and a[0] == "ply":
        sys.exit(schreiben(ply_lesen(Path(a[1])), Path(a[2]), Path(a[3]), f"3DGS-Training: {Path(a[1]).name}"))
    print(__doc__)
