# Gartenblick (Phase 5.1) – Lizenzprüfung Skyfall-GS

Geprüft am 4. Oktober 2026 an der Quelle (LICENSE-Dateien der Repositories, Lizenzfeld und Lizenztext der Modelle
auf Hugging Face). Skyfall-GS: github.com/jayin92/skyfall-gs (Stand `main`, 04.10.2026).

## Ergebnis in einem Satz

**Skyfall-GS ist in der veröffentlichten Form nicht kommerziell nutzbar** – nicht wegen des eigenen Codes
(Apache 2.0), sondern wegen zweier Bausteine: dem Gaussian-Splatting-Code von Inria und dem Bildmodell FLUX.1 [dev].

## Bausteine im Einzelnen

| Baustein | Lizenz | Kommerziell? | Anmerkung |
|---|---|---|---|
| Skyfall-GS (eigener Code) | Apache 2.0 (`LICENSE`) | ja | Repo enthält zusätzlich `LICENSE_inria.md`: Teile (Training, `scene/`, `gaussian_renderer/`) stammen aus Inrias gaussian-splatting |
| gaussian-splatting / diff-gaussian-rasterization (Fork `jayin92/diff-gaussian-rasterization`) | Inria/MPII „Gaussian-Splatting License“ | **nein** | „may be used non-commercially, i.e., for research and/or evaluation purposes only“; jede andere Nutzung nur mit Zustimmung |
| simple-knn (Fork `camenduru/simple-knn`) | keine Lizenzdatei im Fork; Original von Inria (gaussian-splatting) | **nein / unklar** | wie Inria zu behandeln |
| FLUX.1 [dev] (`black-forest-labs/FLUX.1-dev`, im Code fest eingestellt) | FLUX.1 [dev] Non-Commercial License v1.1.1 | **nein** | nur „non-commercial and non-production use“; ausdrücklich keine Nutzung „in direct interactions with or that has impact on end users“. Erlaubt: Test und Evaluation durch Unternehmen in einer Nicht-Produktionsumgebung. Erzeugte Bilder (Outputs) dürfen kommerziell genutzt werden, aber nur, wenn das Modell selbst erlaubt genutzt wurde |
| Stable Diffusion 3 Medium (Alternative im Code) | stabilityai-nc-research-community | **nein** | |
| FLUX.1 [schnell] (im Code auskommentiert) | Apache 2.0 | **ja** | Hinweis: Ausgaben ggf. schwächer als [dev], muss getestet werden |
| MoGe (Microsoft, Tiefenschätzung) | MIT | ja | |
| FlowEdit | MIT | ja | ruft FLUX/SD3 auf, Lizenz des Modells gilt |
| fused-ssim | MIT | ja | |
| gsplat (nerfstudio, Alternative zum Inria-Rasterizer) | Apache 2.0 | ja | Standard-Backend ist eigener Code; nur der optionale `rasterization_inria_wrapper` nutzt Inria – nicht verwenden |

## Was das für Passt. heißt

1. **Mit Skyfall-GS wie veröffentlicht:** nur interne Forschung und Evaluation (kein öffentliches Zeigen, keine
   Kunden-Demo – FLUX.1 [dev] verbietet Nutzung mit Wirkung auf Endnutzer, Inria erlaubt nur Forschung/Evaluation).
   Ergebnisse müssen dauerhaft als „Forschung, nicht kommerziell“ gekennzeichnet sein und dürfen **nicht** in die
   ausgelieferte App.
2. **Freie Variante (Empfehlung für später):** Skyfall-Ablauf mit freien Bausteinen nachbauen
   - Rasterizer und Training: **gsplat** (Apache 2.0) statt Inria-Code
   - Bildmodell: **FLUX.1 [schnell]** (Apache 2.0) statt [dev]
   - Tiefen: MoGe (MIT)
   - Den Inria-abgeleiteten Teil von Skyfall (Trainingsschleife) neu schreiben, nur die Apache-Teile (IDU-Logik,
     Kamerapfade) übernehmen.
   Aufwand: mittel; die Qualität mit [schnell] ist unbekannt und muss gemessen werden.
3. **Noch einfacher und am ehrlichsten:** Wir haben bereits ein **amtliches, texturiertes DOM-Mesh** (CC BY 4.0).
   Ein 3DGS nur aus gerenderten Ansichten dieses Meshes (ohne Diffusionsmodell) verbessert die Darstellung
   (weichere Kanten, Vegetation), erfindet aber keine Details. Ohne Diffusion entfällt die FLUX-Frage ganz.
   Mit gsplat ist diese Variante vollständig kommerziell nutzbar. Siehe `docs/gartenblick/anleitung_gpu.md`.

## Offene Punkte

- Commercial License von Black Forest Labs für FLUX.1 [dev] (bfl.ai) – nur falls die [schnell]-Qualität nicht reicht.
- Inria bietet kommerzielle Lizenzen auf Anfrage an – nur relevant, wenn man bei Inria-Code bleiben will.
- Vor Veröffentlichung juristisch bestätigen lassen (Emil).
