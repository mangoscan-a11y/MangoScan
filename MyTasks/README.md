# MangoScan — Model 1 (Variety) and Model 5 (Decision Fusion)

**Model 1** classifies a mango's variety from the rig's five camera views.
**Model 5** fuses the outputs of Models 1–4 into a physical routing decision:
which of eight bins, pass or reject, and two servo commands.

Models 2 (Disease), 3 (Bruise), and 4 (Color/Size) belong to teammates. This
folder defines the contract they must satisfy and ships mock versions so the
full pipeline can be demonstrated before they deliver.

---

## Status

| Component | Status | Blocked on |
|---|---|---|
| **Model 5** — fusion engine | ✅ Complete, 284 tests passing | nothing |
| **Model 1** — training pipeline | ✅ Complete, untrained | dataset collection |
| **Models 2–4** | Not started | teammates |
| Schema changes for the 8-bin scheme | Not started | web app work — see doc 04 |

---

## Run it right now

No `pip install` — Model 5 is stdlib-only and works on your Python 3.14.
(`pytest` is the one dev dependency, for the tests.)

```bash
cd MyTasks/model5_fusion
python -m pytest -q
python -m stubs.mock_models --count 20 | python -m fusion.cli --explain -
```

You will see 20 mangoes routed, with the rule trace for each:

```
--- mock-000043 -> bin 4 (YELLOW_SMALL)
    confidence_gate  pass     all routing dimensions trusted
    disease          pass     Healthy
    bruise           pass     not bruised
    grade            bin 4    Yellow x Small
    variety_check    match    Carabao
```

A fair number land in bin 7 with `LOW_CONFIDENCE`. That is the mock, not a
bug — it draws confidences uniformly from [0.55, 0.99] against a 0.60
threshold, which deliberately exercises the gate. Real models sit well above it.

Model 1's pure core is testable locally too:

```bash
cd MyTasks/model1_variety && python -m pytest -q
```

---

## Your manual steps, in order

### 1. Collect the dataset ← **the critical path**

📄 `docs/01-dataset-sourcing-guide.md` · `tools/capture_protocol.md`

I searched Kaggle, Mendeley, Roboflow, and the dataset literature. **None of
your six varieties have usable public fruit images** — the good mango datasets
are all Bangladeshi and Pakistani cultivars with zero overlap. You are
photographing all six classes yourself: roughly 600 mangoes, 5 views each.

Read the naming convention section twice. Getting fruit ids wrong silently
invalidates the entire evaluation in a way no metric will reveal.

### 2. Upload to Google Drive
📄 `docs/02-model1-training-guide.md`

### 3. Run the Colab notebook
📄 `docs/02-model1-training-guide.md` → `model1_variety/notebooks/MangoScan_Model1_Colab.ipynb`

Colab rather than your laptop because Python 3.14 has no PyTorch wheels — not
because of the GPU.

### 4. Send the contract to your teammates
📄 `docs/03-model5-fusion-contract.md`

Self-contained. The important parts: **Color is `Green`/`Yellow` only —
Overripe is gone**, `is_bruised` is a real boolean, and confidences must be
calibrated because Model 5 gates on them.

### 5. Confirm the servo mapping with the hardware team
📄 `docs/04-integration-guide.md` §5

Two servos addressing 8 bins: servo1 picks the group, servo2 the size slot.
That is my proposal, not a specification — it needs confirming. It is config,
so changing it is a one-line edit.

---

## The 8 bins

|  | Small | Medium | Large |
|---|---|---|---|
| **Green** | Bin 1 | Bin 2 | Bin 3 |
| **Yellow** | Bin 4 | Bin 5 | Bin 6 |

Bin 7 = Diseased (Anthracnose, Mango Scab) · Bin 8 = Bruised
Bins 1–6 → `passed`, bins 7–8 → `rejected`.

```
1. Confidence gate   any routing dimension untrusted or missing  -> bin 7
2. Disease           Anthracnose or Mango Scab                   -> bin 7
3. Bruise            is_bruised == true                          -> bin 8
4. Grade             color x size                                -> bins 1-6
5. Variety check     always runs, never changes the bin          -> alert only
```

First match wins. Diseased **and** bruised goes to bin 7 — disease is checked
first.

**Variety never routes.** Mangoes are pre-sorted by variety before entering the
machine, so Model 1 verifies that pre-sort: a disagreement with the operator's
declared batch variety raises `VARIETY_MISMATCH` and the mango routes normally.

---

## Layout

```
MyTasks/
  README.md                          you are here
  docs/
    00-design-spec.md                the approved design
    01-dataset-sourcing-guide.md     where to get images, how to name them
    02-model1-training-guide.md      Colab walkthrough, reading the metrics
    03-model5-fusion-contract.md     hand this to your teammates
    04-integration-guide.md          Supabase / ESP32 wiring, schema deltas
    plans/                           the implementation plan this was built from

  model5_fusion/                     Model 5 - stdlib only, zero dependencies
    fusion/     vocab, config, contracts, engine, cli
    config/routing.toml              bins, thresholds, servo actions - all tunable
    stubs/mock_models.py             fake Models 2-4
    tests/                           284 tests, incl. all 216 routing combinations

  model1_variety/                    Model 1
    mango_variety/                   pure core - stdlib only, runs on Python 3.14
      classes.py    the six labels
      dataset.py    fruit-grouped splitting (the anti-leak logic)
      aggregate.py  5-view mean-of-softmax
      metrics.py    P/R/F1, confusion matrix, ECE
    scripts/                         01_prepare -> 02_train -> 03_evaluate
                                     -> 04_export -> 05_predict_multiview
    notebooks/                       the Colab notebook
    tests/                           54 tests

  tools/
    capture_protocol.md              how to photograph the mangoes
    label_sheet_template.csv         track fruit ids as you shoot
```

The split between `mango_variety/` (stdlib) and `scripts/` (Ultralytics) is
deliberate: everything worth unit-testing runs on your machine, and only the
GPU work needs Colab.

---

## Known gaps

| # | Gap | Impact |
|---|---|---|
| 1 | `ripeness_levels` still holds Green/Turning/Ripe/Overripe; needs **Green/Yellow only** | A `Yellow` result will not resolve to a `ripeness_id`. **Blocking** once hardware is live. Doc 04 §4.1 |
| 2 | `bin_assigned` has no constrained vocabulary | Typos silently split analytics. Doc 04 §4.2 |
| 3 | No column stores `reason_code` / `alerts` | Low-confidence and diseased rejects share bin 7 and become indistinguishable in the data. Doc 04 §4.3 |
| 4 | `declared_variety` has no source in the system | Model 1's QC check is skipped. No error, no QC. Doc 04 §4.4 |
| 5 | Two-servo addressing is a proposal | Hardware team must confirm. Config-only fix. Doc 04 §5 |
| 6 | Confidence thresholds are untuned defaults (0.60) | Retune against measured calibration once real models exist. Doc 04 §6 |
| 7 | No public data for any of the six varieties | ~600 mangoes to photograph. **The critical path.** Doc 01 |

Gaps 1–4 are web app schema work, deliberately out of scope here.
