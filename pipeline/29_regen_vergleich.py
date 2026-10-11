#!/usr/bin/env python3
"""Plausibilität der Starkregen-Simulation (AUFTRAG_V4 C3, Punkt 6): Ergebnis neben die Hinweiskarte Oberflächenabfluss und Sturzflut des
Landesamts für Umwelt legen (WMS, CC BY 4.0, Datenquelle: Bayerisches Landesamt für Umwelt) und die Abweichungen dokumentieren.

Eingabe: data/build/regen_vergleich/*.json (aus app/test/regen_vergleich.test.ts: `PASST_VERGLEICH=1 npx vitest run test/regen_vergleich.test.ts`)
Ausgabe: docs/starkregen_vergleich.md, docs/screenshots/C3-vergleich-<ort>.png
Die LfU-Karte ist rein topografisch und ohne bestimmtes Regenereignis; sie wird nur verglichen, nicht übernommen oder umgewandelt.
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation

from common import build_dir

WMS = "https://www.lfu.bayern.de/gdi/wms/wasser/oberflaechenabfluss"
ROOT = Path(__file__).resolve().parent.parent
PX = 100  # 240 m / 100 = 2,4 m je Pixel → Maßstab 1:8 571, im Darstellungsbereich des Dienstes (1:8 504 bis 1:23 623)


def holen(layer: str, e0: float, n0: float, kante: float) -> np.ndarray:
    q = {"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": layer, "STYLES": "", "CRS": "EPSG:25832",
         "BBOX": f"{e0},{n0},{e0 + kante},{n0 + kante}", "WIDTH": PX, "HEIGHT": PX, "FORMAT": "image/png", "TRANSPARENT": "TRUE"}
    with urlopen(f"{WMS}?{urlencode(q)}", timeout=60) as r:
        return np.array(Image.open(io.BytesIO(r.read())).convert("RGBA"))


def auf_gitter(img: np.ndarray, nx: int) -> np.ndarray:
    """PX × PX (Nord oben) auf nx × nx (Zeile 0 = Süden) mit nächstem Nachbarn."""
    idx = np.minimum((np.arange(nx) * PX / nx).astype(int), PX - 1)
    sub = img[idx][:, idx]
    return sub[::-1]


def nahe(maske: np.ndarray, zellen: int) -> np.ndarray:
    return binary_dilation(maske, iterations=zellen) if maske.any() else maske


def anteil(a: np.ndarray, in_b: np.ndarray) -> float:
    return float((a & in_b).sum() / a.sum()) if a.sum() else float("nan")


def main() -> int:
    dateien = sorted(f for f in (build_dir() / "regen_vergleich").glob("*.json") if f.stem != "kennzahlen")
    if not dateien:
        raise SystemExit("Zuerst: cd app && PASST_VERGLEICH=1 npx vitest run test/regen_vergleich.test.ts")
    zeilen = []
    out_png = ROOT / "docs" / "screenshots"
    for f in dateien:
        d = json.loads(f.read_text(encoding="utf-8"))
        nx, res = d["nx"], d["res"]
        e0, n0 = d["origin"][0] + d["x0"], d["origin"][1] + d["y0"]
        kante = nx * res
        fl = auf_gitter(holen("fliesswege", e0, n0, kante), nx)
        se = auf_gitter(holen("senken_aufstau", e0, n0, kante), nx)
        F = fl[..., 3] > 0
        S = se[..., 3] > 0
        geb = np.array(d["gebaeude"]).reshape(nx, nx).astype(bool)
        maxmm = np.array(d["maxMm"]).reshape(nx, nx)
        senke = np.array(d["senke"]).reshape(nx, nx)
        zufl = np.array(d["zufluss"]).reshape(nx, nx)
        nass = (maxmm >= 20) & ~geb
        nass_hoch = (maxmm >= 50) & ~geb
        SF = (zufl >= 400) & ~geb
        SS = (senke >= 0.05) & ~geb
        n3 = 3  # 6 m
        z = {
            "ort": d["name"], "id": d["id"], "regen": f'{d["regenMm"]:.1f} mm / {d["regenMin"]} min',
            "F_zellen": int(F.sum()), "S_zellen": int(S.sum()), "nass_zellen": int(nass.sum()), "SF_zellen": int(SF.sum()), "SS_zellen": int(SS.sum()),
            "F_in_nass": anteil(F, nahe(maxmm >= 10, 1)),
            "nass_an_F": anteil(nass, nahe(F, n3)),
            "nass_hoch_an_F": anteil(nass_hoch, nahe(F, n3)),
            "SF_an_F": anteil(SF, nahe(F, n3)),
            "F_an_SF": anteil(F, nahe(SF, n3)),
            "S_an_SS": anteil(S, nahe(SS, 2)),
            "SS_an_S": anteil(SS, nahe(S, 2)),
            "ms": d["ms"],
        }
        zeilen.append(z)
        fig, ax = plt.subplots(1, 3, figsize=(15, 5.2))
        ext = [0, kante, 0, kante]
        grau = np.where(geb, 0.55, np.nan)
        for a in ax:
            a.set_facecolor("#f4f4f0")
            a.imshow(grau, origin="lower", extent=ext, cmap="gray", vmin=0, vmax=1)
            a.set_xticks([]); a.set_yticks([])
        ax[0].imshow(np.where(S, 1.0, np.nan), origin="lower", extent=ext, cmap="Purples", vmin=0, vmax=1.4, alpha=0.8)
        rgb = fl.copy(); rgb[..., 3] = np.where(F, 255, 0)
        ax[0].imshow(rgb[::1], origin="lower", extent=ext)
        ax[0].set_title("LfU-Hinweiskarte (Fließwege, Senken)\nDatenquelle: Bayerisches Landesamt für Umwelt, CC BY 4.0", fontsize=9)
        im = ax[1].imshow(np.where(maxmm > 5, maxmm / 10.0, np.nan), origin="lower", extent=ext, cmap="Blues", vmin=0, vmax=30)
        ax[1].set_title(f"Simulation: höchste Wassertiefe in cm\n{z['regen']}, Blockregen, ohne Kanal – Label Simulation", fontsize=9)
        fig.colorbar(im, ax=ax[1], fraction=0.046, pad=0.02)
        ax[2].imshow(np.where(SS, 1.0, np.nan), origin="lower", extent=ext, cmap="Purples", vmin=0, vmax=1.4, alpha=0.8)
        ax[2].imshow(np.where(SF, np.clip(zufl / 3000, 0.3, 1), np.nan), origin="lower", extent=ext, cmap="Blues", vmin=0, vmax=1)
        ax[2].imshow(np.where(F, 1.0, np.nan), origin="lower", extent=ext, cmap="YlOrBr", vmin=0, vmax=3, alpha=0.35, zorder=0)
        ax[2].set_title("Nur Gelände (Passt.): Senken, Fließwege ≥ 400 m²\nhellgelb unterlegt: LfU-Fließwege", fontsize=9)
        fig.suptitle(f"{d['name']} – Ausschnitt 240 × 240 m, Norden oben", fontsize=11)
        fig.tight_layout()
        fig.savefig(out_png / f"C3-vergleich-{d['id']}.png", dpi=110)
        plt.close(fig)
        print(d["id"], {k: (round(v, 2) if isinstance(v, float) else v) for k, v in z.items() if k not in ("ort",)})
    p = lambda v: "–" if v != v else f"{100 * v:.0f} %"
    md = ["# Starkregen: Vergleich mit der Hinweiskarte des Landesamts für Umwelt", "",
          "Die Simulation (`rules/regen.ts`) wurde für vier Orte neben die **Hinweiskarte Oberflächenabfluss und Sturzflut** des LfU gelegt (WMS, "
          "Ebenen „potentielle Fließwege bei Starkregen“ und „Geländesenken und potentielle Aufstaubereiche“, Lizenz CC BY 4.0, Datenquelle: "
          "Bayerisches Landesamt für Umwelt). Die LfU-Karte ist **rein topografisch** (bayernweit einheitlicher Ansatz, TU München) und hat laut ihrer Beschreibung "
          "Hinweischarakter; sie nimmt **kein bestimmtes Regenereignis** an. Verglichen wird deshalb nur, ob dieselben Stellen auffallen – nicht die Höhe des Wassers.", "",
          "Aufruf: `cd app && PASST_VERGLEICH=1 npx vitest run test/regen_vergleich.test.ts`, dann `python pipeline/29_regen_vergleich.py`. Bilder: `docs/screenshots/C3-vergleich-*.png`.", "",
          "Szenario der Simulation: 100-jährliches Ereignis, 60 min (KOSTRA-DWD-2020, 46,6 mm), Blockregen, 30 min Nachlauf, 2-m-Zellen, Umkreis 120 m, Annahmen aus `limits.json → starkregen`.", "",
          "## Kennzahlen", "",
          "| Ort | LfU-Fließwege (Zellen) | LfU-Senken | Simulation nass (≥ 2 cm) | LfU-Fließweg trifft nasse Zelle (≤ 2 m) | nasse Zellen ≤ 6 m an LfU-Fließweg | davon ≥ 5 cm | eigene Fließwege ≤ 6 m an LfU | LfU-Fließwege ≤ 6 m an eigenen | LfU-Senken an eigenen Senken (≤ 4 m) | eigene Senken an LfU-Senken (≤ 4 m) |",
          "|---|---|---|---|---|---|---|---|---|---|---|"]
    for z in zeilen:
        md.append(f"| {z['ort']} | {z['F_zellen']} | {z['S_zellen']} | {z['nass_zellen']} | {p(z['F_in_nass'])} | {p(z['nass_an_F'])} | {p(z['nass_hoch_an_F'])} | {p(z['SF_an_F'])} | {p(z['F_an_SF'])} | {p(z['S_an_SS'])} | {p(z['SS_an_S'])} |")
    md += ["", "(Zellen zu 4 m²; „eigene Fließwege“ = Zuflussfläche ≥ 400 m² aus dem Gelände allein; „eigene Senken“ = Senkentiefe ≥ 5 cm.)", ""]
    def spanne(k):
        v = [z[k] for z in zeilen if z[k] == z[k]]
        return f"{100 * min(v):.0f}–{100 * max(v):.0f} %" if v else "–"
    md += ["## Befund", "",
           f"- **Hauptfließwege stimmen überein.** {spanne('F_an_SF')} der LfU-Fließwegzellen liegen höchstens 6 m neben den Fließwegen, die Passt. allein aus dem Gelände rechnet (Zuflussfläche ≥ 400 m²). "
           f"Umgekehrt zeigt Passt. mehr Linien: nur {spanne('SF_an_F')} der eigenen Fließwegzellen liegen ≤ 6 m an einem LfU-Fließweg (die Schwelle 400 m² ist eine Wahl von Passt., der LfU zeigt nur größere Einzugsgebiete in drei Stufen).",
           f"- **Die Simulation bildet die LfU-Fließwege ab, ist aber flächiger.** {spanne('F_in_nass')} der LfU-Fließwegzellen haben in der Simulation (≤ 2 m daneben) mindestens 1 cm Wasser. Nur {spanne('nass_an_F')} der nassen Zellen (≥ 2 cm) liegen ≤ 6 m an einem LfU-Fließweg: "
           "In der Simulation regnet es auf jede Fläche, versiegelte Straßen und Höfe führen dünn Wasser ab; die LfU-Karte zeigt nur Konzentrationsbahnen.",
           f"- **Senken stimmen schlecht überein** (LfU-Senken an eigenen Senken: {spanne('S_an_SS')}; eigene an LfU-Senken: {spanne('SS_an_S')}). "
           "Mögliche Gründe (vermutet, nicht geprüft): Passt. nimmt Gebäude als Hindernisse und rechnet auf 2-m-Zellen; dadurch können Senken an Gebäuderändern und in Hofecken entstehen, die der LfU nicht zeigt. Welche Geländedaten, Auflösung und Mindestgrößen der LfU für Senken nutzt, steht in der Dienstbeschreibung nicht. "
           "**Senken-Aussagen von Passt. sind deshalb nur ein Hinweis**; die Simulation selbst zeigt, wo Wasser tatsächlich zusammenläuft (nasse Zellen).", "",
           "## Mögliche Gründe für Abweichungen", "",
           "- **Grundlage:** Der LfU nutzt laut Dienstbeschreibung einen bayernweit einheitlichen, rein topografischen Ansatz (TU München); die verwendeten Geländedaten und Mindestgrößen sind hier nicht bekannt. Passt. rechnet auf dem DGM1 (1 m) in 2-m-Zellen, Gebäude aus LoD2 als Hindernisse.",
           "- **Regenereignis:** Der LfU zeigt „potentielle“ Fließwege ohne bestimmten Regen, Passt. ein 100-jährliches 60-Minuten-Ereignis (Blockregen) mit Versickerung und Anfangsverlust.",
           "- **Kanal:** Passt. berücksichtigt das Kanalnetz nicht; der LfU-Ansatz ist rein topografisch, also vermutlich ebenfalls ohne Kanal. In Wirklichkeit nimmt der Kanal einen Teil des Wassers auf.",
           "- **Bauwerke und Durchlässe:** Mauern, Bordsteine, Durchlässe und Brücken kennt Passt. nicht (1-m-Gelände). Der LfU weist laut Dienstbeschreibung Bereiche oberhalb von Durchlässen und kleinen Brücken an Gewässern 3. Ordnung als mögliche Aufstaubereiche aus.",
           "- **Rand:** Passt. rechnet im Umkreis von 120 m; Wasser von weiter oben fehlt, am Rand fließt es ab.", "",
           "## Folgerung", "",
           "Die Simulation zeigt dieselben Hauptwege wie die amtliche Hinweiskarte und gibt zusätzlich Zeit und Tiefe an. Sie ersetzt keine Starkregen-Gefahrenkarte; sie ist eine Orientierung (Label `Simulation`). Wo die Simulation Wasser an einer angetippten Stelle zeigt, die LfU-Karte aber keinen Fließweg, ist das ein Hinweis auf Flächenabfluss oder eine Geländeform, die vor Ort geprüft werden muss.", ""]
    (ROOT / "docs" / "starkregen_vergleich.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    (build_dir() / "regen_vergleich" / "kennzahlen.json").write_text(json.dumps(zeilen, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
