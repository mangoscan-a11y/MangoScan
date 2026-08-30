# Model 1 (Variety Classification) + Model 5 (Decision Fusion) — Design Spec

Date: 2026-08-23
Status: Approved
Scope: Model 1 and Model 5 only. Models 2–4 belong to teammates.

## 1. Background

MangoScan is an automated mango sorting machine: an ESP32 rig captures **five
images per mango** (`scan_images.angle_sequence` 1–5), four models classify the
fruit along four dimensions, and a fifth stage fuses those outputs into a
physical routing command. Results are written to Supabase, where the existing
WebApp reads them.

Mangoes are **manually pre-sorted by variety** before entering the machine. An
operator declares the batch variety; the machine processes one variety at a time.

| Model | Dimension | Owner |
|---|---|---|
| 1 | Variety (Carabao, Apple Mango, Indian, Chupadera, Wani, Kabayo) | **this spec** |
| 2 | Disease (Healthy, Anthracnose, Mango Scab) | teammate |
| 3 | Bruise (boolean + confidence) | teammate |
| 4 | Color (Green / Yellow) and Size (Small / Medium / Large) | teammate |
| 5 | Decision fusion → bin, verdict, servo commands | **this spec** |

## 2. Hardware routing target

The machine has **8 physical bins**:

| Bin | Contents |
|---|---|
| 1 | Green · Small |
| 2 | Green · Medium |
| 3 | Green · Large |
| 4 | Yellow · Small |
| 5 | Yellow · Medium |
| 6 | Yellow · Large |
| 7 | Diseased (Anthracnose or Mango Scab) |
| 8 | Bruised |

Bins 1–6 are `quality_verdict = 'passed'`. Bins 7–8 are `'rejected'`.

There is no overripe bin and no manual-review chute. **Consequence: the Color
dimension is binary — Green or Yellow. Overripe is dropped from the taxonomy.**

## 3. Decisions

| Question | Decision | Rationale |
|---|---|---|
| Model 1 architecture | `yolov8n-cls` at 224px | Matches the pipeline's existing YOLOv8 stack; ~3M params; exports to ONNX/TFLite for edge inference |
| Multi-view handling | Train on individual images; aggregate 5 views at inference by **mean of softmax** | 5× training data for free; preserves the confidence signal Model 5 gates on; degrades gracefully when fewer than 5 views are usable |
| Training environment | Google Colab (T4) | Local GPU is an RTX 3050 Laptop with 4 GB VRAM, and local Python is 3.14.4 — too new for stable PyTorch/Ultralytics wheels |
| Model 1's role in fusion | **QC verification of the manual pre-sort.** Never changes the bin. | Variety does not appear in the 8-bin map. Comparing the prediction against the operator's declared batch variety gives Model 1 a real operational purpose |
| Model 5 approach | Rule-based deterministic engine, config-driven | Auditable and explainable for defense; needs no fusion training data; matches how production sorting lines actually work |
| Precedence | Disease → Bruise → Color+Size | Quality rejects short-circuit before grading — standard food-sorting practice |
| Color taxonomy | Green / Yellow only | Forced by the 8-bin map (see §2) |
| Models 2–4 integration | Strict JSON contract + mock implementations | Lets Model 5 be built, tested, and demonstrated before teammates deliver |
| Model 5 language | Python | Shares the inference host with Model 1; runs on local Python 3.14 with no ML dependencies |

## 4. Model 1 — Variety Classifier

### 4.1 Classes

Six classes, named to match `mango_varieties.variety_name` in the database
exactly:

`Carabao`, `Apple Mango`, `Indian`, `Chupadera`, `Wani`, `Kabayo`

Note the repository spells it **Wani**, not "Wanni". The training pipeline and
the fusion contract both use the database spelling; any mismatch is a wiring
bug waiting to happen.

### 4.2 Architecture and inference topology

```
              ┌─ view 1 ─┐
              ├─ view 2 ─┤
mango  ──────►├─ view 3 ─┤──► yolov8n-cls ──► 5 softmax vectors
              ├─ view 4 ─┤     (shared)              │
              └─ view 5 ─┘                           ▼
                                              mean over views
                                                     │
                                        ┌────────────┴────────────┐
                                        ▼                         ▼
                                  argmax = variety        max prob = confidence
```

Training operates on single images. Aggregation is an inference-time concern
only, implemented in `05_predict_multiview.py`.

Rationale for mean-of-softmax over majority vote: majority vote discards
per-view certainty and produces a coarse confidence (k/5) that is useless as
input to Model 5's threshold gate. Mean-of-softmax yields a continuous,
calibratable score and handles the common case of 4 confident views plus 1
blurred view correctly.

### 4.3 Dataset requirements

| Property | Requirement |
|---|---|
| Minimum per class | 300 images |
| Target per class | 500+ images |
| Split | 70 / 15 / 15 train / val / test |
| **Split unit** | **Physical fruit, not image** |
| Resolution | ≥ 224×224 after crop |
| Format | `dataset/<split>/<Class Name>/*.jpg` (Ultralytics classification layout) |

**The split unit is the single most important correctness constraint in this
spec.** Five images of one mango placed across train and test leaks the answer
and inflates reported accuracy by a wide margin. The preparation script must
group by fruit ID and assign whole groups to a split.

Availability assessment (revised 2026-08-23 after searching Kaggle, Mendeley
Data, Roboflow Universe, and the published dataset literature): **none of the
six classes have usable public fruit-image data.** The large mango variety
datasets that exist — MangoImageBD (15 varieties), MangoClassify-12, the
Kaggle Pakistani 8-variety set — cover Bangladeshi and Pakistani cultivars
with zero overlap with this list. Philippine variety research exists but is
leaf-based, not fruit-based. Wani is *Mangifera caesia*, a distinct species,
and returns nothing at all.

**Self-capture is therefore mandatory for all six classes**, not just the
three rare ones as originally assumed. This is less costly than it appears:
images shot on the machine's own rig match deployment lighting, background,
and camera geometry, and outperform scraped web images regardless of volume.
Details and the full source table are in `01-dataset-sourcing-guide.md`.

### 4.4 Training configuration

Baseline, to be tuned:

| Parameter | Value |
|---|---|
| Model | `yolov8n-cls.pt` (pretrained) |
| Image size | 224 |
| Epochs | 100, early stopping patience 20 |
| Batch | 64 on Colab T4; 16 on a 4 GB local GPU |
| Optimizer | `auto` (Ultralytics selects AdamW or SGD) |
| Augmentation | flips, ±15° rotation, HSV jitter, random resized crop |
| Class imbalance | Report per-class recall; if a class trails badly, oversample rather than reweight |

Augmentation caveat: **hue jitter must be kept conservative.** Model 4
classifies color, and while Model 1 is a separate network, variety and skin
color are correlated in this domain — aggressive hue augmentation can destroy
a genuinely useful variety cue.

### 4.5 Evaluation

Required outputs, all written to `runs/<name>/`:

- Top-1 and top-3 accuracy on the held-out test split
- Per-class precision / recall / F1, plus macro and weighted averages
- Confusion matrix (absolute and row-normalized)
- **Per-view accuracy vs. 5-view aggregated accuracy** — quantifies what
  multi-view fusion buys, and is a reportable result in its own right
- **Confidence calibration**: reliability diagram and Expected Calibration
  Error. Model 5 gates on Model 1's confidence, so a miscalibrated,
  overconfident model directly causes wrong routing decisions. Temperature
  scaling is fitted on the validation split and applied at inference if it
  improves ECE.
- Inference latency: per image and per 5-view mango

### 4.6 Export

ONNX (opset 12) as the primary deployment artifact; TFLite as a secondary
target for constrained hosts. Export parity is verified by running both the
PyTorch and exported models over the test split and asserting predictions agree
within tolerance.

## 5. Model 5 — Decision Fusion

### 5.1 Input contract

Model 5 consumes one JSON object per mango. This is the interface teammates
must satisfy.

```jsonc
{
  "scan_id": "uuid",
  "captured_at": "2026-08-23T10:15:00+08:00",
  "declared_variety": "Carabao",        // operator's batch declaration
  "models": {
    "variety": {                         // Model 1
      "label": "Carabao",
      "confidence": 0.94,
      "probabilities": { "Carabao": 0.94, "Apple Mango": 0.02 },
      "per_view": [
        { "angle_sequence": 1, "label": "Carabao", "confidence": 0.96 }
      ]
    },
    "disease": { "label": "Healthy",      "confidence": 0.97 },   // Model 2
    "bruise":  { "is_bruised": false,     "confidence": 0.88 },   // Model 3
    "color":   { "label": "Green",        "confidence": 0.91 },   // Model 4
    "size":    { "label": "Medium", "grams": 220.5, "confidence": 0.85 }
  }
}
```

Field rules:

- `probabilities` and `per_view` are optional; the engine only requires
  `label` + `confidence`.
- For `size`, **`grams` is authoritative when present** — the engine derives
  the label from the configured gram ranges, which mirror
  `size_grades.min_grams` / `max_grams`. The `size_grades` table carrying gram
  ranges implies a load cell rather than a vision model; both paths are
  supported.
- Any dimension may be `null` (model unavailable). A missing **routing**
  dimension is treated as a confidence-gate failure.
- Labels are validated against the configured vocabulary. An unrecognized
  label is an error, not a silent pass-through.

### 5.2 Decision algorithm

```
INPUT: model outputs + declared_variety

1. CONFIDENCE GATE
   For each routing dimension (disease, bruise, color, size):
       skip size if size.grams is present    // load cell, not a model
       if missing OR confidence < threshold[dimension]:
           → bin = low_confidence_bin, verdict = rejected
           → reason = LOW_CONFIDENCE, alert = LOW_CONFIDENCE_<DIM>
           → STOP

2. DISEASE
   if disease.label in {Anthracnose, Mango Scab}:
       → bin 7, verdict = rejected, reason = DISEASE_DETECTED
       → STOP

3. BRUISE
   if bruise.is_bruised:
       → bin 8, verdict = rejected, reason = BRUISE_DETECTED
       → STOP

4. GRADE
   bin = grid[color.label][size.label]        // bins 1-6
   verdict = passed, reason = ROUTED_BY_COLOR_SIZE

5. VARIETY CHECK  (always runs; never changes the bin)
   if declared_variety is null:  variety_match = null, skip the check
   else:
       variety_match = (variety.label == declared_variety)
       if not variety_match:        alert VARIETY_MISMATCH
       if variety.confidence < t:   alert LOW_CONFIDENCE_VARIETY
```

Step 5 is deliberately outside the routing path and is evaluated even when
steps 1–4 short-circuit, so a mis-sorted batch is still detected on rejected
fruit.

`low_confidence_bin` defaults to bin 7. This shares a physical bin with
diseased fruit, but `reason_code` distinguishes them in the database, so the
two are never conflated in reporting. If the machine later gains a
manual-review chute, this is a one-line config change.

### 5.3 Output contract

```jsonc
{
  "scan_id": "uuid",
  "bin_index": 2,
  "bin_name": "GREEN_MEDIUM",
  "quality_verdict": "passed",           // matches the DB enum
  "reason_code": "ROUTED_BY_COLOR_SIZE",
  "servo1_action": "hold",
  "servo2_action": "divert_b",
  "detected_variety": "Carabao",
  "declared_variety": "Carabao",
  "variety_match": true,
  "alerts": [],
  "decision_trace": [
    { "step": "confidence_gate", "result": "pass",  "detail": "all dimensions above threshold" },
    { "step": "disease",         "result": "pass",  "detail": "Healthy" },
    { "step": "bruise",          "result": "pass",  "detail": "not bruised" },
    { "step": "grade",           "result": "bin 2", "detail": "Green x Medium" }
  ],
  "engine_version": "1.0.0",
  "config_version": "routing.toml@sha256:..."
}
```

`decision_trace` records every rule evaluation. It is the artifact that makes a
"why did this mango go there?" question answerable during hardware debugging
and during a thesis defense.

Reason codes: `LOW_CONFIDENCE`, `DISEASE_DETECTED`, `BRUISE_DETECTED`,
`ROUTED_BY_COLOR_SIZE`.

Alerts: `VARIETY_MISMATCH`, `LOW_CONFIDENCE_VARIETY`, `LOW_CONFIDENCE_DISEASE`,
`LOW_CONFIDENCE_BRUISE`, `LOW_CONFIDENCE_COLOR`, `LOW_CONFIDENCE_SIZE`.

### 5.4 Configuration

`config/routing.toml` owns everything tunable (TOML, parsed by the stdlib
`tomllib` — this keeps Model 5 free of any third-party dependency): the 8-bin map, per-dimension
confidence thresholds, the disease reject list, size gram ranges, servo actions
per bin, and `low_confidence_bin`. No routing constant is hardcoded in Python.

Default thresholds — starting points to be tuned against real test runs:

| Dimension | Threshold | Note |
|---|---|---|
| disease | 0.60 | routing |
| bruise | 0.60 | routing |
| color | 0.60 | routing |
| size | 0.60 | routing; bypassed when `grams` is supplied |
| variety | 0.50 | alert-only, so a miss is cheap |

**Servo actions are placeholders.** Two servos cannot address 8 bins by any
obvious scheme, so the actual mechanism (gate tree, indexed rotating arm,
timed diverter) is unknown to this spec. Values are opaque strings the hardware
team fills in; the engine never interprets them. See §9.

### 5.5 Testing

Model 5 is a pure function over a small finite domain, so it is tested
exhaustively rather than by sampling:

- **All 216 combinations** of variety(6) × disease(3) × bruise(2) × color(2) ×
  size(3) at full confidence — every one asserted against the bin map
- Confidence-gate boundaries at, just below, and just above each threshold
- Missing / null dimensions
- Invalid labels rejected loudly
- `grams` → size-label derivation, including exact range boundaries
- Variety mismatch alerting on both passed and rejected fruit
- Precedence: diseased **and** bruised → bin 7, not bin 8

Development is test-first.

## 6. Deliverables

```
MyTasks/
  README.md                            your manual steps, in order
  docs/
    00-design-spec.md                  this file
    01-dataset-sourcing-guide.md       real links + on-rig capture protocol
    02-model1-training-guide.md        Colab walkthrough
    03-model5-fusion-spec.md           contract sheet to hand to teammates
    04-integration-guide.md            Supabase / ESP32 wiring + schema deltas
  model1_variety/
    configs/dataset.yaml
    scripts/
      01_prepare_dataset.py            ingest → fruit-grouped split → integrity check
      02_train.py                      YOLOv8-cls training
      03_evaluate.py                   metrics, confusion matrix, calibration
      04_export.py                     ONNX / TFLite + parity check
      05_predict_multiview.py          5-view aggregation → Model 1 contract JSON
    notebooks/MangoScan_Model1_Colab.ipynb
    requirements.txt
  model5_fusion/
    fusion/{__init__,contracts,config,engine,cli}.py
    config/routing.toml
    tests/{test_engine,test_contracts,test_config}.py
    stubs/mock_models.py               fake models 2-4 for end-to-end demo
    requirements.txt
  tools/
    capture_protocol.md
    label_sheet_template.csv
```

Doc `03` is the hand-off artifact for teammates.

## 7. Sequencing

Model 5 has no dependency on Model 1's weights — it consumes a JSON contract.
It is therefore built **first**, test-first, and is fully demonstrable with
mock models before any mango is photographed. Model 1's pipeline is built
next and is runnable the moment a dataset exists.

## 8. Out of scope

- Training Models 2, 3, and 4 (teammates'). The pipeline is not generalized
  for them; only the contract is defined.
- WebApp changes of any kind.
- ESP32 firmware and servo control code.
- Physical dataset collection (manual work; documented, not performed).
- A learned/meta-classifier fusion model — explicitly decided against.

## 9. Known gaps and risks

| # | Item | Impact | Status |
|---|---|---|---|
| 1 | `ripeness_levels` holds Green/Turning/Ripe/Overripe; the machine now needs **Green/Yellow only** | WebApp writes/reads break on the new taxonomy | Documented in doc 04. WebApp fix is out of scope. |
| 2 | `bin_assigned` is `varchar(30)` with no defined 8-bin vocabulary | Bin names are unconstrained; typos will not be caught | Doc 04 proposes the canonical vocabulary |
| 3 | Two servos cannot obviously address 8 bins | Servo action values are guesses | Config placeholders; **hardware team must supply the real mapping** |
| 4 | **All six classes** have zero usable public fruit images (confirmed by search, 2026-08-23) — not just the three rare ones | Model 1 blocked until self-capture of ~600 fruits is done | Capture protocol in doc 01 and `tools/capture_protocol.md`; this is the critical path |
| 5 | Model 5 gates on confidences produced by four independently-trained models with unknown calibration | Thresholds may misroute until tuned | Calibration is measured for Model 1 (§4.5); teammates should do the same. Thresholds are config, tuned on real runs. |
| 6 | Local Python is 3.14.4 | Ultralytics/PyTorch wheels likely unavailable | Model 1 trains on Colab. Model 5 has no ML dependencies and runs on 3.14 locally. |
| 7 | `declared_variety` has no source in the current system | Model 1's QC role has no input | Doc 04 specifies it as an operator-set field on the batch/session; interim default is `null` (check skipped) |
