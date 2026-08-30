# Dataset Sourcing Guide — Model 1 (Variety)

This is the critical path. Model 1's pipeline is finished and tested; it is
waiting on images. Nothing else about Model 1 can proceed until this is done.

---

## 1. The blunt summary

**None of your six varieties have usable public fruit-image data.** I searched
Kaggle, Mendeley Data, Roboflow Universe, and the published dataset literature
(August 2026). The overlap between what exists publicly and what you need is
**zero classes**.

| Your class | Public fruit images? | Notes |
|---|---|---|
| Carabao | ✗ | Philippine research exists but is **leaf-based**, not fruit |
| Apple Mango | ✗ | Name collides with several unrelated cultivars; nothing matching |
| Indian | ✗ | "Indian" is a Philippine local name, not the Indian cultivars in public sets |
| Chupadera | ✗ | Nothing, in any repository |
| Wani | ✗ | Nothing. Wani is *Mangifera caesia* — a different species entirely |
| Kabayo | ✗ | Nothing, in any repository |

The large, well-built mango variety datasets that do exist are all
**Bangladeshi or Pakistani cultivars**, and none of their classes are yours:

| Dataset | Varieties | Overlap with you |
|---|---|---|
| [MangoImageBD](https://data.mendeley.com/datasets/hp2cdckpdr/2) — 28,515 images | Amrapali, Ashshina, Banana Mango, Bari-4, Bari-11, Fazli, Gourmoti, Harivanga, Himsagor, Katimon, Langra, Rupali, Shada (15) | none |
| [MangoClassify-12](https://www.sciencedirect.com/science/article/pii/S2352340925007590) — 3,900 images | Amrapali, Banana, Bari-4, Fazli, Gopalbhog, Gobindobhog, Harivanga, Himsagar, Khirsapat, Langra, Ranibhog, Sundari (12) | none |
| [Mango Varieties Classification and Grading](https://www.kaggle.com/datasets/saurabhshahane/mango-varieties-classification/data) | 8 Pakistani varieties | none |
| [BDMANGO](https://www.sciencedirect.com/science/article/pii/S2352340924012034) | Bangladeshi — **leaves, not fruit** | none |

**So: you are capturing all six classes yourself.** Plan for that from day one
rather than losing a week hunting for a shortcut that does not exist.

### Why this is less bad than it sounds

Your deployment environment is a fixed rig — controlled lighting, a known
conveyor background, five fixed camera angles. Images captured *on that rig*
outperform scraped web images regardless of volume, because they match
deployment conditions exactly. A model trained on someone else's studio
photos of a different cultivar under different light would have needed heavy
domain adaptation anyway.

You are not missing a shortcut. You are skipping a detour.

### Worth passing to your teammates

These do not help Model 1, but they are directly useful for **Model 2 (Disease)**:

- **MangoFruitDDS** (Kaggle) — ~1,700 mango **fruit** disease images:
  Alternaria, Anthracnose, Black Mould Rot, Stem and Rot. Anthracnose is one
  of your two reject classes.
- **[MangoLeafBD](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9932726/)** —
  diseased vs. healthy mango leaves. Leaf-based, so less directly applicable.

Check each source's licence before using it in published academic work.

---

## 2. Target counts

| | Per class |
|---|---|
| Absolute minimum | 300 images (≈ 60 fruits × 5 views) |
| Target | 500+ images (≈ 100 fruits × 5 views) |
| Six classes at target | ~600 fruits, ~3,000 images |

Keep the classes roughly balanced. If one lags badly, capture more of it —
oversampling beats class-weighting here, because the shortfall is real
information, not a sampling artifact.

---

## 3. The naming convention — read this twice

```
data/raw/<Class_Name>/<class>_<fruit_id>_v<view>.jpg
```

```
data/raw/Carabao/carabao_001_v1.jpg      ← fruit 001, view 1
data/raw/Carabao/carabao_001_v2.jpg      ← the SAME physical mango
data/raw/Carabao/carabao_001_v5.jpg      ← still the same mango
data/raw/Carabao/carabao_002_v1.jpg      ← a DIFFERENT mango
data/raw/Apple_Mango/apple_mango_014_v3.jpg
```

**Every view of one physical mango must share the same `<fruit_id>`.**

This is not a stylistic preference. The pipeline splits train/val/test by
*fruit*, using this id. Get it wrong in either direction and you break the
evaluation:

- **Two different mangoes sharing an id** → they are treated as one fruit and
  always land in the same split. Mild loss of split precision.
- **One mango's views getting different ids** → its views scatter across train
  and test. The model is then graded on mangoes it memorised during training.
  Reported accuracy climbs, real accuracy does not, and **every metric you
  would normally check still looks fine.** This is the failure mode that
  silently invalidates a whole thesis chapter.

### Directory names

Six directories, spelled exactly — underscores in paths, spaces in labels:

```
data/raw/Carabao/
data/raw/Apple_Mango/
data/raw/Indian/
data/raw/Chupadera/
data/raw/Wani/          ← "Wani", not "Wanni"
data/raw/Kabayo/
```

These map to the database's `mango_varieties.variety_name` values. A typo here
becomes a foreign-key failure at insert time, long after the fact.

---

## 4. Rig images vs. web images

If you do end up supplementing with scraped images, know what you are getting:

| | Rig images | Web images |
|---|---|---|
| Matches deployment lighting | yes | no |
| Matches conveyor background | yes | no |
| Matches camera geometry | yes | no |
| Views per fruit | 5 | 1 |
| Value per image | high | low |

Scraped images have no `_v<n>` marker, so each is treated as its own
single-view fruit. That is the correct behaviour — no special handling needed.
Put them in the same class directory and the pipeline handles it.

Do not let web images dominate a class. A class that is 80% studio photos and
20% rig photos will learn "studio photo" as a feature.

---

## 5. Pre-flight checklist

Before you upload anything to Drive:

- [ ] Six directories exist, spelled exactly as above
- [ ] Every file matches `<class>_<fruit_id>_v<view>.<ext>`
- [ ] Each `fruit_id` is unique *within its class* and shared by all its views
- [ ] At least 60 distinct fruits per class (300+ images)
- [ ] Blurred / double-mango / cut-off frames deleted
- [ ] The label sheet (`tools/label_sheet_template.csv`) is filled in

Then run the dry run — it copies nothing and tells you exactly what the split
will look like:

```bash
cd MyTasks/model1_variety
python scripts/01_prepare_dataset.py --config configs/dataset.toml --dry-run
```

Healthy output looks like this:

```
Carabao          312 images    63 fruits  train/val/test = 44/9/10
Apple Mango      295 images    59 fruits  train/val/test = 41/9/9
...
train    1247 images
val       267 images
test      271 images
```

**Check the fruits column against your label sheet.** If Carabao says
`312 images  312 fruits`, your `_v<n>` suffixes are missing or malformed and
every image is being treated as its own fruit. Fix the filenames before
training — this is exactly the leak described in section 3.

Problems are reported explicitly and exit non-zero:

```
Problems:
  - missing class directory: data/raw/Chupadera
  - Wani: only 2 distinct fruits - need at least 3
```

---

## 6. Next step

Once the dry run is clean → `docs/02-model1-training-guide.md`.
For how to actually shoot the images → `tools/capture_protocol.md`.
