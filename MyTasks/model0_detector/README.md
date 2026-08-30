# Model 0 — Mango/Stem Detector

Finds the mangoes in a raw camera frame and crops them, so Models 1–4 receive
a single centred fruit instead of a whole conveyor.

This model was not in the original design. It exists because the dataset in
`data/mango_dataset/` turned out to be a **detection** corpus (mango + stem
bounding boxes) with no variety, disease, bruise, colour, or size labels —
useless for Model 1, but exactly right for a stage the pipeline was missing.
Every downstream model assumes a cropped, centred fruit. Model 0 is what makes
that assumption true.

---

## Status

| | |
|---|---|
| Dataset | ✅ prepared — `data/detector_dataset/`, 2,146 images, 2 classes |
| Training | ⬜ not run — needs Colab |
| Integration into the pipeline | ⬜ not started |

---

## The data

Prepared from `data/mango_dataset/` by `tools/prepare_detector_dataset.py`.
The source dump was not trainable as delivered:

| Defect | Fix |
|---|---|
| `classes.txt` held 17 labels, 15 of them labelImg defaults (`dog`, `tv`, `meatballs`…) | remapped to `0=mango, 1=stem`; junk ids dropped, not renumbered |
| `test/mango_1.jpg` had no label; `test/IMG20230722152808.txt` had no image | both dropped, reported |
| no `data.yaml` | generated |
| 17 GB of ~8 MB phone originals | resized to a 1280 px long edge |

Result:

| split | images |
|---|---|
| train | 1,719 |
| val | 214 |
| test | 213 |
| **total** | **2,146** |

5,500 mango boxes and 5,005 stem boxes — about 2.56 mangoes per image, so
these are multi-fruit frames, not single-fruit portraits. That is fortunate:
it matches a conveyor far better than a studio shot would.

The source tree is never modified. Re-run the tool with a different `--out`
to try other resize settings.

---

## Run it

**1. Prepare** (local, ~10 min, needs Pillow):

```bash
cd MyTasks
python tools/prepare_detector_dataset.py --dry-run   # inspect first
python tools/prepare_detector_dataset.py
```

**2. Upload** `data/detector_dataset/` to Google Drive at
`MyDrive/MangoScan/data/detector_dataset/`.

**3. Train** — open `notebooks/MangoScan_Detector_Colab.ipynb` in Colab, set
Runtime → T4 GPU, run all.

---

## Reading the metrics

**mango recall is the number to defend.** A mango the detector misses never
reaches Models 1–4 and never gets routed at all — a fruit that falls off the
end of the conveyor. That is strictly worse than a fruit routed to the wrong
bin, which at least lands somewhere countable. Target ≥ 0.95.

**mango mAP50-95 measures box tightness.** Loose boxes produce crops with
conveyor background in them, and Model 4 reads colour off exactly those
pixels. A detector with great mAP50 and poor mAP50-95 will quietly degrade
the colour model.

**Stem numbers will be lower, and that is fine.** The stem is small, often
occluded, and supplies orientation only — it is not on the routing path. Do
not trade mango recall for stem mAP.

---

## Layout

```
model0_detector/
  configs/detector.toml       model, imgsz, epochs, augmentation - all tunable
  scripts/
    02_train.py               numbering matches model1_variety; 01 is the
                              shared tools/prepare_detector_dataset.py
    03_evaluate.py            writes detector_report_<split>.json
  notebooks/
    MangoScan_Detector_Colab.ipynb
```

---

## Next, once it trains

Model 0 has no consumer yet. Wiring it in means a crop step between the
cameras and Models 1–4:

```
frame -> Model 0 -> N crops -> each crop -> Models 1-4 -> Model 5 -> bin
```

Two open questions that need answering before that code is worth writing:

1. **One fruit per frame, or many?** The rig implies one mango at a time
   under five cameras. This dataset averages 2.56 per frame. If the rig is
   genuinely single-fruit, Model 0 should return the highest-confidence box
   only, and multi-fruit frames are just free training variety. If the
   conveyor carries several at once, Model 5's `scan_id` contract needs one
   scan per detected fruit, which is a real change.
2. **Does the stem earn its keep?** Stem position gives fruit orientation,
   which could normalise crops before Models 1–4 see them. Worth it only if
   stem recall comes in high enough to rely on.
