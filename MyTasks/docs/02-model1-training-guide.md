# Model 1 Training Guide

Prerequisite: a clean dry run from `01-dataset-sourcing-guide.md`. If the
fruit counts do not match your label sheet, stop and fix that first — no
amount of training fixes a leaked split.

---

## 1. Why Colab and not your laptop

Your machine has an **RTX 3050 Laptop (4 GB VRAM)** running **Python 3.14.4**.

The blocker is the Python version, not the GPU. PyTorch and Ultralytics have
no wheels for 3.14, so `pip install ultralytics` fails outright. Colab's T4
gives you 15 GB of VRAM on a supported Python for free, which also lets you
use the full batch size.

This constraint disappears the moment PyTorch ships 3.14 wheels or you install
a second Python — see §5 for the local path.

Model 5 has no such problem. It is stdlib-only and runs on your 3.14 today.

---

## 2. Upload the dataset

Put your prepared `raw/` tree in Drive at exactly:

```
MyDrive/MangoScan/data/raw/Carabao/carabao_001_v1.jpg
MyDrive/MangoScan/data/raw/Apple_Mango/...
MyDrive/MangoScan/data/raw/Indian/...
MyDrive/MangoScan/data/raw/Chupadera/...
MyDrive/MangoScan/data/raw/Wani/...
MyDrive/MangoScan/data/raw/Kabayo/...
```

Upload the folder, not a zip — the notebook reads it directly. A few thousand
JPEGs takes a while; start it and go do something else.

---

## 3. Run the notebook

Open `model1_variety/notebooks/MangoScan_Model1_Colab.ipynb` in Colab, then
**Runtime → Change runtime type → T4 GPU**. Miss this step and training falls
back to CPU and takes hours instead of minutes.

Run the cells top to bottom.

| Section | What it does | Roughly |
|---|---|---|
| GPU check + Drive mount | Confirms the T4 and lists your class folders | seconds |
| Install + clone | `pip install ultralytics`, clones this repo | 1–2 min |
| 1. Prepare | Fruit-grouped split into `/content/dataset` | < 1 min |
| 2. Train | 100 epochs, early stopping at 20 | 15–40 min |
| 3. Evaluate | Metrics, confusion matrix, calibration, plots | 1–2 min |
| 4. Export | ONNX + parity check | 1–2 min |
| 5. Save | Copies `runs/` back to Drive | 1 min |

The prepare cell rewrites `configs/dataset.toml` to point at Drive. That edit
is local to the Colab checkout and does not touch your repo.

---

## 4. Reading the results

`runs/model1_variety/weights/report.json` holds everything. Three numbers
matter most.

### `multiview.top1_accuracy`

The headline. Accuracy per *mango*, after averaging its five views — this is
what the machine actually achieves.

### `multiview_gain`

`multiview.top1_accuracy − per_image.top1_accuracy`. How much five-view
fusion buys you over a single photo. It is a genuine result worth reporting.

**It should be positive.** A negative gain almost always means the fruit ids
are wrong and views of *different* mangoes are being averaged together —
go back to §8 of `tools/capture_protocol.md`.

### `multiview.ece` — Expected Calibration Error

The gap between the confidence the model claims and the accuracy it delivers.

This matters more here than in an ordinary classifier, because **Model 5 gates
routing on Model 1's confidence.** An overconfident model does not merely
report a wrong number — it lets bad reads through the gate.

| ECE | Reading |
|---|---|
| < 0.05 | Good. Model 5's default thresholds are sound. |
| 0.05 – 0.15 | Acceptable. Watch it. |
| > 0.15 | Overconfident. Retune Model 5's `thresholds.variety` in `routing.toml` against this model specifically, or fit temperature scaling on the validation split. |

`reliability.csv` and the plotted reliability diagram show *where* the
miscalibration sits — usually the top confidence bin.

### Also in the report

- `per_class` precision / recall / F1 — find the class that is dragging
- `macro_avg` vs `weighted_avg` — a big gap means class imbalance
- `top3_accuracy` — if top-1 is poor but top-3 is high, the model is confusing
  a specific pair of varieties; check the confusion matrix for which

---

## 5. Local fallback

If Colab is unavailable, install a second Python (3.12 recommended — download
from python.org; it coexists with 3.14 fine) and run:

```bash
cd MyTasks/model1_variety
py -3.12 -m venv .venv312
.venv312\Scripts\activate
pip install -r requirements.txt
python scripts/01_prepare_dataset.py --config configs/dataset.toml
python scripts/02_train.py --config configs/dataset.toml --batch 16
```

**`--batch 16` is not optional on 4 GB.** The config's default of 64 is sized
for a T4 and will OOM immediately on your card.

Expect training to take several times longer than on Colab.

---

## 6. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `CUDA out of memory` | Lower `--batch` (try 16, then 8). Restart the runtime first — a dead process may still hold VRAM. |
| `no images in data/raw/<X>` | Directory name wrong. Underscores, not spaces: `Apple_Mango`. And it is `Wani`, not `Wanni`. |
| `<class>: only N distinct fruits` | The `_v<n>` suffix is missing or malformed, so grouping failed. See `tools/capture_protocol.md` §8. |
| `fruits` count equals `images` count | Same cause as above. **This is the leak.** Fix before training. |
| Val accuracy ≈ 1.00 in the first epoch | Near-certain split leak. Do not celebrate — re-check fruit ids. |
| `multiview_gain` is negative | Views of different mangoes are being averaged. Fruit ids are wrong. |
| `expected classes [...], found [...]` | A class directory is missing or misspelled in the prepared dataset. |
| Training starts but is very slow | Runtime is on CPU. Runtime → Change runtime type → T4 GPU. |
| Parity check reports mismatches | The ONNX export diverges from the PyTorch model. Re-export; if it persists, deploy the `.pt` and raise it. |

---

## 7. After training

1. Weights land in `MyDrive/MangoScan/runs/model1_variety/weights/best.pt`
2. Produce a Model 5 payload from five images:

   ```bash
   python scripts/05_predict_multiview.py \
       --weights best.pt \
       --images v1.jpg v2.jpg v3.jpg v4.jpg v5.jpg \
       --scan-id scan-0001 --declared-variety Carabao > scan.json
   ```

3. Feed it to the fusion engine — see `04-integration-guide.md`.
