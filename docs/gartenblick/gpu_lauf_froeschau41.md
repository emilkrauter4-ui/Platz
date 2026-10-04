# Gartenblick – EIN GPU-Lauf für Fröschau 41 (Demo „grenze“)

Stand 4. Oktober 2026. Genau ein Lauf, danach wird **nichts weiter** am Gartenblick gebaut, bis Emil das Ergebnis
bewertet hat. Ergebnis ist eine **KI-Visualisierung, nicht gemessen** – nie für Prüfungen.

Gewählt: **gsplat** (Apache 2.0, kommerziell nutzbar), **ohne** Diffusionsmodell. Skyfall-GS/FLUX ist nicht Teil
dieses Laufs (Lizenz, siehe `lizenzen.md`; Kosten ≈ 10×).

## Vorab hier geprüft (ohne GPU)

- Datensatz `data/build/gartenblick/grenze/` (30 MB): 89 Bilder 1024 × 768 (77 Training, 12 Test), Kameraposen exakt
  aus Cesium, 243 582 Startpunkte aus Laser 2025 + DOP20, COLMAP-Format in `sparse/0/`.
- Mit dem **echten Datenlader von gsplat** (Commit `512d366`, `examples/datasets/colmap.py`, CPU) eingelesen:
  89 Bilder, 1 Kamera (PINHOLE, f = 886,8 px), 243 582 Punkte, Kameras in −45 … +45 m (Meter bleiben erhalten),
  77 Trainingsbilder ladbar. 36 % der Startpunkte fallen ins erste Bild – plausibel bei 60 m Radius.
- Nicht geprüft: das Training selbst (keine GPU im Container). Laufzeiten unten sind **Schätzungen**.

## Was du brauchst

| | |
|---|---|
| GPU | **RTX 4090 (24 GB)** – reicht sicher; Alternative RTX A6000 / L40S (48 GB) |
| Speicher | erwartet 6–12 GB VRAM, 32 GB RAM, 40 GB Platte (Pakete ≈ 15 GB) |
| System | Vorlage „PyTorch“ mit CUDA 12.8, Ubuntu 22.04/24.04, Python 3.10–3.12 |
| Anbieter (Beispiel) | RunPod: RTX 4090 ab 0,34 $/h (Community), ≈ 0,69 $/h (Secure Cloud, im EU-Rechenzentrum wählbar); A6000 ≈ 0,49 $/h, L40S ≈ 0,79 $/h (Preise Juli 2026, sekundengenau) |
| Datensatz | `gartenblick_grenze.zip` (von mir geschickt) oder selbst erzeugen, siehe `anleitung_gpu.md` |

## Ablauf (Befehle zum Kopieren)

### 1. Maschine starten (≈ 5 min)

RunPod → Pods → Deploy → GPU „RTX 4090“ → Vorlage „RunPod PyTorch 2.x“ (CUDA 12.8) → Container Disk 40 GB →
Deploy. Dann „Connect“ → „Web Terminal“ (oder SSH).

### 2. Daten hochladen (≈ 1 min)

Im Web-Terminal per Jupyter-Upload oder vom Laptop per `scp -P <port> gartenblick_grenze.zip root@<ip>:/workspace/`:

```bash
cd /workspace && unzip -q gartenblick_grenze.zip -d daten   # ergibt /workspace/daten/grenze/{images,sparse,…}
ls daten/grenze/images | wc -l                              # muss 89 ergeben
nvidia-smi                                                  # GPU sichtbar?
```

### 3. gsplat installieren (≈ 15–25 min, meist Kompilieren)

```bash
cd /workspace
git clone https://github.com/nerfstudio-project/gsplat.git && cd gsplat
git checkout 512d366b67073d77ca099ede742683c165dfc23b       # genau der Stand, mit dem ich geprüft habe
pip install torch==2.9.1 torchvision==0.24.1 --index-url https://download.pytorch.org/whl/cu128
pip install ninja && pip install --no-build-isolation -e .                       # kompiliert die CUDA-Kerne
pip install -r examples/requirements.txt
python -c "import gsplat, torch; print(gsplat.__version__, torch.cuda.is_available())"   # → True
```

Falls `pip install -r` an einem optionalen Paket scheitert (`ppisp`, `fused-bilagrid`, `nvidia-ncore`): die werden
für diesen Lauf nicht gebraucht. Dann stattdessen:

```bash
pip install pycolmap viser imageio[ffmpeg] scipy scikit-learn tqdm torchmetrics==1.8.2 opencv-python-headless \
  "tyro>=0.8.8" Pillow piexif tensorboard pyyaml matplotlib splines \
  git+https://github.com/nerfstudio-project/nerfview@4538024fe0d15fd1a0e4d760f3695fc44ca72787 \
  git+https://github.com/rahul-goel/fused-ssim@a7c48d6dd7ac6dc39a7958c7c4452e0b10418f38
```

### 4. Training (≈ 15–30 min auf RTX 4090, Schätzung)

```bash
cd /workspace/gsplat/examples
python simple_trainer.py default \
  --data_dir /workspace/daten/grenze --data_factor 1 \
  --result_dir /workspace/ergebnis/grenze \
  --no-normalize-world-space \
  --save-ply --disable-viewer \
  --max-steps 30000 2>&1 | tee /workspace/ergebnis/training.log
```

Die Schreibweise der Flags habe ich mit gsplats eigenem Kommandozeilen-Aufbau (`tyro.extras.overridable_config_cli`,
tyro 1.0.16) geprüft. **Nicht** `--no-normalize-world-space` weglassen:
sonst liegt die PLY nicht mehr in Metern und passt nicht zum amtlichen Gelände.

Fortschritt steht in der Fortschrittsleiste. Nach 7 000 Schritten entsteht eine Zwischen-PLY – wenn die schon schlecht
aussieht, kann man abbrechen und Geld sparen.

### 5. Ergebnis sichern (≈ 2 min), dann Maschine **sofort löschen**

```bash
cd /workspace/ergebnis && ls grenze/ply grenze/stats
tar czf gartenblick_grenze_ergebnis.tgz grenze/ply/point_cloud_29999.ply grenze/stats training.log
```

Herunterladen (Jupyter → Rechtsklick → Download, oder `scp`). Dann in RunPod **Terminate** (nicht nur Stop – ein
gestoppter Pod kostet weiter Speicher).

Erwartete Größe der PLY: 50–300 MB (≈ 0,2–1,2 Mio. Splats). In `stats/val_step29999.json` stehen PSNR/SSIM/LPIPS
auf den 12 Testbildern.

## Zeit und Kosten (Schätzung)

| Schritt | Zeit |
|---|---|
| Start, Upload | 5–10 min |
| Installation | 15–25 min |
| Training 30 000 Schritte | 15–30 min |
| Sichern, Download | 5 min |
| **Summe** | **≈ 45–70 min** |

| GPU | Preis/h | Kosten für den Lauf |
|---|---|---|
| RTX 4090 Community | 0,34 $ | **≈ 0,30–0,40 $** |
| RTX 4090 Secure (EU) | ≈ 0,69 $ | ≈ 0,55–0,80 $ |
| RTX A6000 | 0,49 $ | ≈ 0,40–0,60 $ (Training etwas langsamer) |

Puffer für einen zweiten Versuch eingerechnet: **unter 2 $**. RunPod verlangt eine Mindestaufladung (derzeit 10 $),
der Rest bleibt als Guthaben. Grundlage der Laufzeit: gsplat braucht für 30 000 Schritte auf Mip-NeRF-360-Szenen
(≈ 1,5 Mio. Splats) rund 20 min auf einer Rechenzentrums-GPU; unsere Bilder sind kleiner (0,8 MP), es sind nur 77.

## Zurück in die App (hier auf dem Laptop, ≈ 2 min)

```bash
tar xzf gartenblick_grenze_ergebnis.tgz
python3 pipeline/14_gartenblick_tiles.py geometrie grenze/ply/point_cloud_29999.ply data/build/gartenblick/grenze
python3 pipeline/14_gartenblick_tiles.py ply grenze/ply/point_cloud_29999.ply data/build/gartenblick/grenze app/public/data/gartenblick/grenze
```

Dann `app/public/data/gartenblick/index.json` anlegen (bbox aus `meta.json`, wie in `anleitung_gpu.md`), App neu
starten, Fröschau 41 öffnen, Auge-Knopf „Gartenblick“.

## Woran du das Ergebnis bewertest

1. **Lage:** `geometrie.json` – Median-Abstand Splat ↔ Laser. Unter 0,3 m: gut. Über 1 m: etwas stimmt nicht.
2. **Optik aus 25–45 m Abstand:** sollte dem DOM-Mesh entsprechen, flüssiger, ohne Löcher.
3. **Optik aus Gartenhöhe:** wird unscharf sein – das Eingangsmaterial (DOM-Mesh, 20 cm) ist es auch. gsplat erfindet
   keine Details.
4. **Ladezeit/Flüssigkeit auf dem iPhone:** Größe der `.spz`-Kacheln notieren.

Ehrliche Erwartung: Punkt 3 wird enttäuschen. Ob sich der Gartenblick lohnt, entscheidet sich an Punkt 2 und 4.
