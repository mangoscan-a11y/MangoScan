# Model 5 Fusion Contract — for Models 2, 3, and 4

**Read this before you finish your model.** It defines exactly what your model
must output so the fusion stage can route the mango.

Model 5 takes one JSON object per mango — carrying the outputs of Models 1–4 —
and returns a bin number, a pass/reject verdict, and two servo commands. It is
already built and tested. You can run your model's output through it today.

Nothing here assumes you have read the design spec.

---

## 1. The input you must produce

```jsonc
{
  "scan_id": "uuid",                          // REQUIRED, non-empty string
  "captured_at": "2026-08-23T10:15:00+08:00", // optional
  "declared_variety": "Carabao",              // optional; operator's batch declaration

  "models": {
    "variety": {                              // Model 1 - already built
      "label": "Carabao",                     // REQUIRED
      "confidence": 0.94,                     // REQUIRED, float in [0, 1]
      "probabilities": { "Carabao": 0.94 },   // optional
      "per_view": [                           // optional
        { "angle_sequence": 1, "label": "Carabao", "confidence": 0.96 }
      ]
    },

    "disease": {                              // Model 2 - YOURS
      "label": "Healthy",                     // REQUIRED
      "confidence": 0.97                      // REQUIRED, float in [0, 1]
    },

    "bruise": {                               // Model 3 - YOURS
      "is_bruised": false,                    // REQUIRED, real JSON boolean
      "confidence": 0.88                      // REQUIRED, float in [0, 1]
    },

    "color": {                                // Model 4 - YOURS
      "label": "Green",                       // REQUIRED
      "confidence": 0.91                      // REQUIRED, float in [0, 1]
    },

    "size": {                                 // Model 4 or load cell - YOURS
      "label": "Medium",                      // one of label/grams REQUIRED
      "grams": 220.5,                         // preferred if you have a load cell
      "confidence": 0.85                      // REQUIRED, float in [0, 1]
    }
  }
}
```

Any dimension may be `null` or omitted if that model is unavailable. See §5 for
what happens then.

---

## 2. Model 2 — Disease

`label` must be **exactly** one of:

```
Healthy
Anthracnose
Mango Scab
```

Case and spacing matter — `"mango scab"` and `"Mango_Scab"` are both rejected.
These strings match the `diseases` reference table in Supabase.

`Anthracnose` and `Mango Scab` both route to **bin 7 (reject)**.

---

## 3. Model 3 — Bruise

```jsonc
"bruise": { "is_bruised": false, "confidence": 0.88 }
```

`is_bruised` must be a **real JSON boolean** — `true` or `false`.

Not `"true"`, not `1`, not `0`, not `"yes"`. Anything else is a hard error.
`0` and `1` are rejected deliberately: a silent int-to-bool coercion is exactly
how a `0`-means-bruised convention slips through and inverts your model's
meaning across the whole line.

`true` routes to **bin 8 (reject)**.

---

## 4. Model 4 — Color and Size

### Color is binary

```
Green
Yellow
```

**That is the whole vocabulary. `Overripe` no longer exists** — the machine's
bin 8 was reassigned to Bruised, so there is nowhere to send overripe fruit.
If your training data has four ripeness levels, collapse them: Green stays
Green, everything riper maps to Yellow. Do not emit `Turning`, `Ripe`, or
`Overripe`; they are hard errors.

(Note: Supabase's `ripeness_levels` table still lists four levels. That is a
known pending fix on the web app side, not a reason to emit four labels.)

### Size — label or grams

```
Small   Medium   Large
```

If you have a load cell, **send `grams` instead of, or alongside, `label`.**
When `grams` is present it wins, and the size confidence gate is skipped
entirely — a load cell has no softmax, so its `confidence` is meaningless.

Default gram ranges, `[min, max)`:

| Grade | Grams |
|---|---|
| Small | 0 – 200 |
| Medium | 200 – 350 |
| Large | 350+ |

These live in `model5_fusion/config/routing.toml` and must match the
`size_grades` table in Supabase. Tell whoever owns the config if your ranges
differ.

---

## 5. Confidence must be a calibrated probability

`confidence` is a float in `[0, 1]`, and Model 5 treats it as a real
probability, not a score.

**Before routing anything, Model 5 rejects any mango whose disease, bruise, or
color confidence falls below its threshold** (default 0.60). A missing or null
dimension is treated the same way.

So an overconfident model is not just reporting a bad number — it pushes
unreliable reads *through* the gate and into the sellable stream. A
model that says 0.95 and is right 70% of the time will misroute fruit.

Check your calibration. There is a ready-made implementation you can import:

```python
from mango_variety.metrics import expected_calibration_error, reliability_bins

ece = expected_calibration_error(confidences, correct)   # want < 0.05
```

(`MyTasks/model1_variety/mango_variety/metrics.py` — stdlib only, no
dependencies, runs anywhere.)

If your ECE is above ~0.15, either apply temperature scaling or say so, and
your dimension's threshold gets retuned for you.

---

## 6. What you get back

```jsonc
{
  "scan_id": "uuid",
  "bin_index": 2,
  "bin_name": "GREEN_MEDIUM",
  "quality_verdict": "passed",             // "passed" | "rejected"
  "reason_code": "ROUTED_BY_COLOR_SIZE",
  "servo1_action": "group_green",
  "servo2_action": "slot_medium",
  "detected_variety": "Carabao",
  "declared_variety": "Carabao",
  "variety_match": true,
  "alerts": [],
  "decision_trace": [
    { "step": "confidence_gate", "result": "pass",  "detail": "all routing dimensions trusted" },
    { "step": "disease",         "result": "pass",  "detail": "Healthy" },
    { "step": "bruise",          "result": "pass",  "detail": "not bruised" },
    { "step": "grade",           "result": "bin 2", "detail": "Green x Medium" },
    { "step": "variety_check",   "result": "match", "detail": "Carabao" }
  ],
  "engine_version": "1.0.0",
  "config_version": "routing.toml@sha256:..."
}
```

`decision_trace` records every rule that fired. When a mango lands somewhere
surprising, that array is the answer.

**Reason codes:** `LOW_CONFIDENCE`, `DISEASE_DETECTED`, `BRUISE_DETECTED`,
`ROUTED_BY_COLOR_SIZE`.

**Alerts:** `VARIETY_MISMATCH`, `LOW_CONFIDENCE_VARIETY`,
`LOW_CONFIDENCE_DISEASE`, `LOW_CONFIDENCE_BRUISE`, `LOW_CONFIDENCE_COLOR`,
`LOW_CONFIDENCE_SIZE`.

---

## 7. The bins and the order rules fire in

|  | Small | Medium | Large |
|---|---|---|---|
| **Green** | Bin 1 | Bin 2 | Bin 3 |
| **Yellow** | Bin 4 | Bin 5 | Bin 6 |

Bin 7 = Diseased · Bin 8 = Bruised. Bins 1–6 are `passed`; 7–8 are `rejected`.

```
1. Confidence gate   any routing dimension below threshold, or missing  -> bin 7, LOW_CONFIDENCE
2. Disease           Anthracnose or Mango Scab                          -> bin 7
3. Bruise            is_bruised == true                                 -> bin 8
4. Grade             color x size                                       -> bins 1-6
5. Variety check     runs always, never changes the bin                 -> alert only
```

First match wins. A mango that is both diseased and bruised goes to bin 7, not
bin 8 — disease is checked first.

**Variety never changes the bin.** Mangoes are pre-sorted by variety before
they enter the machine, so Model 1 exists to verify that pre-sort: if its
prediction disagrees with the operator's declared batch variety, you get a
`VARIETY_MISMATCH` alert and the mango is still routed normally.

Note that low-confidence rejects share bin 7 with diseased fruit. They are
distinguishable by `reason_code`, never conflated in the data.

---

## 8. Test against Model 5 right now

No install needed — it is stdlib-only Python 3.11+.

```bash
cd MyTasks/model5_fusion

# See exactly what a valid payload looks like
python -m stubs.mock_models --count 5 > sample.json

# See what Model 5 does with it, rules and all
python -m fusion.cli --explain sample.json

# Now try your own model's output
python -m fusion.cli --explain your_output.json
```

`--explain` prints the decision trace to stderr, so you can watch which rule
fired and why.

Exit codes: `0` routed, `1` your payload is invalid, `2` the config is broken.

---

## 9. Failure modes

| What you send | What happens |
|---|---|
| An unrecognised label (`"Overripe"`, `"mango scab"`) | **Hard error**, exit 1. Never silently passed through. |
| `confidence` outside [0, 1], or a string | Hard error, exit 1. |
| `is_bruised` as `"true"`, `1`, or `0` | Hard error, exit 1. |
| A routing dimension `null` or omitted | Bin 7, `LOW_CONFIDENCE`, plus a `LOW_CONFIDENCE_<DIM>` alert. Not an error. |
| `size` with neither `label` nor `grams` | Hard error, exit 1. |
| Negative `grams` | Hard error, exit 1. |
| `declared_variety` omitted | Variety check is skipped, `variety_match: null`. Not an error. |

Errors are loud on purpose. A mislabelled mango that routes silently is worse
than a batch that stops.

---

## 10. Questions

The routing table, thresholds, gram ranges, and servo actions all live in
`model5_fusion/config/routing.toml` and can be changed without touching code.
If something in this contract does not fit your model, raise it — the config
is the negotiable part; the label vocabulary is not, because it is pinned to
the database.
