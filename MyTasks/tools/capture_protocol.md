# Capture Protocol — Model 1 Dataset

How to photograph mangoes so the resulting model works on the machine rather
than only in the notebook.

The governing principle: **the training images should be indistinguishable
from what the machine will see at run time.** Every deviation from that is
a gap the model has to generalise across, and small datasets generalise badly.

---

## 1. Use the machine's own rig

Shoot on the sorting machine itself if it is assembled. Its cameras, its
lighting, its conveyor surface. This single decision is worth more than
doubling the dataset size.

If the rig is not ready, replicate it as closely as you can and keep every
setting **identical across all six classes**. A setup that drifts between
classes teaches the model to recognise the setup, not the mango.

---

## 2. The five angles

Match `scan_images.angle_sequence` 1–5:

| View | Angle |
|---|---|
| `v1` | Stem end (peduncle) |
| `v2` | Blossom end |
| `v3` | Cheek A — the flatter face |
| `v4` | Cheek B — rotate 180° from v3 |
| `v5` | Top-down |

**If the rig uses different angles, the rig wins.** What matters is that the
same five angles are used for every mango in every class. Consistency beats
any particular choice.

---

## 3. Lighting

- Use the machine's lighting. Turn it on and leave it alone.
- If ambient light leaks into the enclosure, shoot every class at the same
  time of day, or block the leak.
- **Never mix a phone flash with rig lighting inside one class.** Flash
  changes skin specularity dramatically, and skin appearance is exactly the
  signal Model 1 is learning.
- Do not adjust exposure or white balance between classes.

---

## 4. Background

The machine's conveyor surface, always.

A class shot on a different background is the classic way to get a model that
scores 99% in validation and fails on the line — it learned the background,
not the fruit. If you must change surfaces partway through, re-shoot the
earlier classes rather than leaving the mismatch in.

---

## 5. Variation within each class

Aim for **60+ distinct physical mangoes per class**, and vary:

- **Ripeness** — green through yellow, across the range the machine will see
- **Size** — small, medium, large
- **Individual fruit** — different trees, different harvest days if possible

60 mangoes × 5 views = 300 images, the per-class minimum.

Photographing the same 10 mangoes 30 times each gives you 300 images and a
model that has seen 10 mangoes. The fruit count is what matters, not the
image count.

---

## 6. Fruit numbering

**Assign each physical mango an id before you photograph it**, and write it on
the label sheet as you go.

```
carabao_001  →  carabao_001_v1.jpg ... carabao_001_v5.jpg
carabao_002  →  carabao_002_v1.jpg ... carabao_002_v5.jpg
```

Reusing an id across two different mangoes silently corrupts the train/test
split. Numbering after the fact, from memory, is how that happens. Number
first, shoot second.

Ids only need to be unique within their class — `carabao_001` and
`wani_001` are fine together.

---

## 7. What to exclude

Delete, do not "fix":

- Blurred or motion-smeared frames
- Frames containing two mangoes
- Frames where the fruit is cut off at the edge
- Frames where the fruit is obscured by a hand or tool

Model 1 aggregates whatever views it gets and handles fewer than five
gracefully, so **dropping a bad frame is free.** Keeping it is not — one
blurred frame in training is noise, and one in test is a wrong answer you
will spend an afternoon investigating.

Note the drop in the label sheet's `views_captured` column so the counts
still reconcile.

---

## 8. Quality check after each class

Do not wait until all six classes are shot.

```bash
cd MyTasks/model1_variety
python scripts/01_prepare_dataset.py --config configs/dataset.toml --dry-run
```

Check the **fruits** column against your label sheet:

```
Carabao          312 images    63 fruits  train/val/test = 44/9/10
```

63 fruits should match the 63 rows you wrote down. If the numbers disagree:

| Symptom | Cause |
|---|---|
| fruits == images | `_v<n>` suffix missing or malformed — **this is the leak** |
| fruits > label sheet rows | an id got mistyped, splitting one mango into two |
| fruits < label sheet rows | two mangoes share an id |

Fix filenames now, while you still remember which mango was which. Catching
this after training means retraining.
