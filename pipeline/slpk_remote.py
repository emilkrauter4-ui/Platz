"""Einzelne Dateien aus einem entfernten SLPK (ZIP64) per HTTP-Range lesen, ohne die 49 GB zu laden."""
from __future__ import annotations

import gzip
import json
import pickle
import struct
import time
import urllib.request
import zlib
from pathlib import Path


class RemoteSlpk:
    def __init__(self, url: str, cache: Path):
        self.url = url
        self.cache = cache
        cache.mkdir(parents=True, exist_ok=True)
        self.size = int(urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60).headers["Content-Length"])
        self.entries = self._directory()

    def _range(self, a: int, b: int) -> bytes:
        for attempt in range(5):
            try:
                req = urllib.request.Request(self.url, headers={"Range": f"bytes={a}-{b}"})
                with urllib.request.urlopen(req, timeout=180) as r:
                    data = r.read()
                if len(data) == b - a + 1:
                    return data
            except Exception:  # noqa: BLE001 – Netzfehler: erneut versuchen
                pass
            time.sleep(2 ** attempt)
        raise IOError(f"Range {a}-{b} nicht lesbar")

    def _directory(self) -> dict[str, tuple[int, int, int]]:
        cf = self.cache / "central_directory.pkl"
        if cf.exists():
            return pickle.loads(cf.read_bytes())
        tail = self._range(self.size - 65536, self.size - 1)
        j = tail.rfind(b"PK\x06\x07")
        _, _, z64off, _ = struct.unpack("<IIQI", tail[j:j + 20])
        z = self._range(z64off, z64off + 55)
        n_entries, cd_size, cd_off = struct.unpack("<IQHHIIQQQQ", z)[7:10]
        cd = self._range(cd_off, cd_off + cd_size - 1)
        entries, p = {}, 0
        for _ in range(n_entries):
            (sig, _vm, _vn, _fl, method, _t, _d, _crc, csize, usize, nlen, xlen, clen, _ds, _ia, _ea, lho) = struct.unpack("<IHHHHHHIIIHHHHHII", cd[p:p + 46])
            assert sig == 0x02014B50
            name = cd[p + 46:p + 46 + nlen].decode("utf-8")
            extra = cd[p + 46 + nlen:p + 46 + nlen + xlen]
            # ZIP64-Zusatzfeld: echte Größen/Offsets
            q = 0
            while q + 4 <= len(extra):
                hid, hlen = struct.unpack("<HH", extra[q:q + 4])
                if hid == 1:
                    vals = list(struct.unpack("<" + "Q" * (hlen // 8), extra[q + 4:q + 4 + (hlen // 8) * 8]))
                    if usize == 0xFFFFFFFF:
                        usize = vals.pop(0)
                    if csize == 0xFFFFFFFF:
                        csize = vals.pop(0)
                    if lho == 0xFFFFFFFF:
                        lho = vals.pop(0)
                q += 4 + hlen
            entries[name.replace("\\", "/")] = (lho, csize, method)
            p += 46 + nlen + xlen + clen
        cf.write_bytes(pickle.dumps(entries))
        return entries

    def read(self, name: str) -> bytes:
        """Dateiinhalt (bei .gz entpackt)."""
        lho, csize, method = self.entries[name]
        head = self._range(lho, lho + 29)
        nlen, xlen = struct.unpack("<HH", head[26:30])
        start = lho + 30 + nlen + xlen
        data = self._range(start, start + csize - 1) if csize else b""
        if method == 8:
            data = zlib.decompress(data, -15)
        if name.endswith(".gz"):
            data = gzip.decompress(data)
        return data

    def json(self, name: str):
        for n in (name, name + ".gz"):
            if n in self.entries:
                return json.loads(self.read(n))
        raise KeyError(name)
