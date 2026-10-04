# Gartenblick – Anleitung für die gemietete GPU (Phase 5.3)

Stand 4. Oktober 2026. Nur **vorberechnen**, nur für die drei Demo-Grundstücke – nichts davon läuft live.
Das Ergebnis ist eine **KI-Visualisierung, nicht gemessen** und wird **nie** für Prüfungen verwendet.

## Was schon fertig ist (ohne GPU, hier im Container erzeugt)

Je Demo-Grundstück ein Ordner `data/build/gartenblick/<demo>/` (≈ 60 MB, nicht im Git):

| Datei | Inhalt |
|---|---|
| `images/*.jpg` | 89 gerenderte Ansichten des amtlichen DOM-Meshes (1024 × 768, 60° Öffnung): 3 Ringe (12/25/45 m Abstand, 4/12/30 m Höhe), 9 Draufsichten aus 60 m, 32 Ansichten aus Augenhöhe (1,6 m) an 4 Gartenstellen |
| `transforms_train.json`, `transforms_test.json` | exakte Kameraposen (c2w, OpenCV-Konvention), fl_x/fl_y/cx/cy – Format „Satellite“ von Skyfall-GS; jede 8. Ansicht ist Test |
| `points3D.txt` | Startpunktwolke: ≈ 240 000 Laserpunkte (2025) im Umkreis von 60 m, eingefärbt mit DOP20 |
| `sparse/0/` | dasselbe im COLMAP-Textformat (für gsplat) |
| `meta.json` | Ursprung (lokal + Ellipsoidhöhe), Quelle, Kennzeichnung |

Koordinaten: Meter, x = Ost (UTM 32N), y = Nord, z = Ellipsoidhöhe; Ursprung = Grundstücksmitte am Boden.
Lage geprüft: Laserpunkte über 4 m liegen in der Draufsicht auf den Dächern und Kronen des Meshes.

Neu erzeugen (auf dem Laptop, App muss laufen): `node pipeline/gartenblick_render.mjs <demo>`, dann
`python3 pipeline/13_gartenblick_punkte.py data/build/gartenblick/<demo>` und
`python3 pipeline/15_gartenblick_colmap.py data/build/gartenblick/<demo>`.

## Welche GPU

| Weg | GPU | Speicher | Zeit je Grundstück (Schätzung) |
|---|---|---|---|
| A: gsplat, ohne Diffusionsmodell (**empfohlen, kommerziell nutzbar**) | ab 16 GB (z. B. RTX 4090, A10, L4) | 8–12 GB VRAM, 32 GB RAM | 20–40 min (30 000 Schritte) |
| B: Skyfall-GS mit FLUX.1 [dev] (**nur Forschung, nicht zeigen**) | 48 GB (RTX A6000, L40S, A100) | ≈ 40 GB VRAM, 64 GB RAM, 60 GB Platte für Modelle | laut Paper ≈ 6¾ h (1½ h Rekonstruktion + 5 h Synthese) auf RTX A6000; unser Ausschnitt ist kleiner |

Für Weg B braucht es einen Hugging-Face-Zugang mit akzeptierter FLUX.1-[dev]-Lizenz (Modell ist „gated“).
Für eine Lösung mit Server in Deutschland: GPU-Anbieter mit Rechenzentrum in der EU wählen.

## Weg A – gsplat (Apache 2.0)

```bash
# Ubuntu 22.04, CUDA 12.x, Python 3.10
git clone https://github.com/nerfstudio-project/gsplat.git && cd gsplat
pip install -e . && pip install -r examples/requirements.txt
# Datensatz hochladen: data/build/gartenblick/grenze → ~/daten/grenze
python examples/simple_trainer.py default \
    --data_dir ~/daten/grenze --data_factor 1 \
    --result_dir ~/ergebnis/grenze \
    --no-normalize-world-space \
    --save-ply --max-steps 30000
# Ergebnis: ~/ergebnis/grenze/ply/point_cloud_29999.ply
```

Wichtig: `--no-normalize-world-space`, damit die PLY in unseren Metern bleibt. Nicht den optionalen
Inria-Rasterizer (`rasterization_inria_wrapper`) verwenden – der ist nicht kommerziell lizenziert.
Flag-Namen bitte mit `python examples/simple_trainer.py default --help` gegenprüfen (gsplat ändert sie gelegentlich).

## Weg B – Skyfall-GS (nur intern, nicht kommerziell)

```bash
git clone --recurse-submodules https://github.com/jayin92/Skyfall-GS.git && cd Skyfall-GS
conda create -y -n skyfall-gs python=3.10 && conda activate skyfall-gs
conda install cuda-toolkit=12.8 cuda-nvcc=12.8 -c nvidia
pip install -r requirements.txt
pip install --force-reinstall torch torchvision torchaudio
pip install submodules/diff-gaussian-rasterization-depth submodules/simple-knn submodules/fused-ssim
huggingface-cli login        # FLUX.1-dev-Lizenz vorher auf huggingface.co akzeptieren

# Stufe 1: Rekonstruktion (unser Ordner hat das „Satellite“-Format: transforms_*.json + points3D.txt)
python train.py -s ~/daten/grenze -m ~/out/grenze --eval --kernel_size 0.1 --resolution 1 --sh_degree 1 \
  --appearance_enabled --lambda_depth 0 --lambda_opacity 10 --densify_until_iter 21000 \
  --densify_grad_threshold 0.0001 --lambda_pseudo_depth 0.5 --start_sample_pseudo 1000 \
  --end_sample_pseudo 21000 --size_threshold 20 --scaling_lr 0.001 --rotation_lr 0.001 \
  --opacity_reset_interval 3000 --sample_pseudo_interval 10
# Stufe 2: Synthese mit FLUX (IDU), wie im Skyfall-README, mit -s ~/daten/grenze
#          --start_checkpoint ~/out/grenze/chkpnt30000.pth -m ~/out/grenze_idu
python create_fused_ply.py -m ~/out/grenze_idu --output_ply ~/out/grenze_fused.ply --iteration 80000 --load_from_checkpoints
```

Hinweis: Da unsere `transforms_*.json` keine Felder `R`/`T` haben, normalisiert Skyfall-GS die Szene nicht – die PLY
bleibt in Metern. Ergebnis aus Weg B **nicht** in die App übernehmen, die gezeigt wird (Lizenz, siehe `lizenzen.md`).

## Zurück in die App

PLY herunterladen und hier ausführen:

```bash
python3 pipeline/14_gartenblick_tiles.py geometrie ~/Downloads/point_cloud_29999.ply data/build/gartenblick/grenze
python3 pipeline/14_gartenblick_tiles.py ply ~/Downloads/point_cloud_29999.ply data/build/gartenblick/grenze app/public/data/gartenblick/grenze
```

Dann in `app/public/data/gartenblick/index.json` eintragen (bbox in lokalen App-Koordinaten, wie in `meta.json`):

```json
{"eintraege": [{"id": "grenze", "bbox": [x0, y0, x1, y1], "herkunft": "gsplat aus DOM-Mesh-Ansichten", "splats": 0, "erstellt": "2026-10-xx"}]}
```

Die App zeigt den Knopf „Gartenblick“ (Auge) nur, wenn für das Grundstück ein Eintrag existiert. Solange er an ist,
steht oben dauerhaft „KI-Visualisierung, nicht gemessen“. Prüfungen rechnen weiterhin nur mit den amtlichen Daten.

## Was man erwarten kann (ehrlich)

- Das DOM-Mesh ist eine 2,5D-Oberfläche mit ≈ 20 cm Textur: Fassaden sind verschmiert, unter Bäumen fehlt der Boden.
  Aus Gartenhöhe sehen die gerenderten Eingabebilder deshalb unscharf aus (siehe `images/*_garten.jpg`).
- Weg A macht daraus eine flüssige, drehbare Ansicht, erfindet aber keine Details – aus Gartenhöhe bleibt es unscharf.
- Weg B ergänzt Details mit dem Bildmodell (FLUX) – das sind erfundene Details. Genau deshalb die Kennzeichnung.
- Geometrie gegen Laser: `geometrie.json` (Median-Abstand Splat ↔ Laser). Bäume haben sich zwischen 2023 (Mesh) und
  2025 (Laser) verändert – dort sind Abweichungen echt.
