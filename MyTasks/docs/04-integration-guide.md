# Integration Guide — Wiring Model 5 into the Machine

How the fusion engine connects to the four models on one side and Supabase +
the ESP32 on the other, and what still has to change before that works
end to end.

---

## 1. Where Model 5 sits

```
  5 camera views
        │
        ▼
  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
  │  Model 1  │  │  Model 2  │  │  Model 3  │  │  Model 4  │
  │  Variety  │  │  Disease  │  │  Bruise   │  │Color/Size │
  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
        └──────────────┴───────┬──────┴──────────────┘
                               ▼
                       ┌───────────────┐
                       │    Model 5    │  bin + verdict + servo commands
                       │    fusion     │
                       └───────┬───────┘
                    ┌──────────┴──────────┐
                    ▼                     ▼
              Supabase insert        ESP32 servos
```

Model 5 runs on the inference host, between the models and the database. It
has **zero third-party dependencies** — stdlib Python 3.11+ — so the `fusion/`
package can simply be copied next to whatever runs inference. No pip install,
no version conflicts with the ML stack.

---

## 2. Wiring it up

Model 1 emits its half of the payload directly:

```bash
python scripts/05_predict_multiview.py \
    --weights best.pt \
    --images v1.jpg v2.jpg v3.jpg v4.jpg v5.jpg \
    --scan-id "$SCAN_ID" \
    --declared-variety "$BATCH_VARIETY" > variety.json
```

Merge in the `models.disease`, `models.bruise`, `models.color`, and
`models.size` blocks from Models 2–4 (see `03-model5-fusion-contract.md` for
the exact shapes), then route:

```bash
python -m fusion.cli scan.json          # decision JSON on stdout
python -m fusion.cli --explain scan.json  # plus the rule trace on stderr
```

For a long-running process, skip the subprocess and import it:

```python
from fusion.config import RoutingConfig
from fusion.contracts import ScanInput
from fusion.engine import decide

config = RoutingConfig.load("config/routing.toml")   # load once at startup
decision = decide(ScanInput.from_dict(payload), config)

print(decision.bin_index, decision.quality_verdict)
supabase_row = decision.to_dict()
```

`decide()` is pure and holds no state, so it is safe to call from any thread.
Load the config once — it hashes the file to produce `config_version`.

---

## 3. Mapping the decision onto the database

| Decision field | Destination |
|---|---|
| `quality_verdict` | `scan_sessions.quality_verdict` (enum: `passed`/`rejected`) |
| `bin_name` | `scan_sessions.bin_assigned` |
| `servo1_action` / `servo2_action` | `sorting_logs.servo1_action` / `servo2_action` |
| `detected_variety` | resolve to `mango_varieties.variety_id` → `scan_sessions.variety_id` |
| disease label | resolve to `diseases.disease_id` → `scan_sessions.disease_id` |
| bruise | `scan_sessions.is_bruised` + `bruise_confidence` |
| color label | resolve to `ripeness_levels.ripeness_id` → `scan_sessions.ripeness_id` ⚠️ see §4.1 |
| size label | resolve to `size_grades.size_id` → `scan_sessions.size_id` |
| each dimension's label + confidence | one `detection_result` row per dimension (`class_type` = `variety`/`disease`/`bruise`/`color`/`size`) |
| `reason_code`, `alerts`, `decision_trace` | **no column exists** — see §4.3 |

Because the engine emits the label strings the reference tables already use,
resolution is a straight lookup. Cache the tables at startup; they change
about never.

---

## 4. Required schema changes

**These are WebApp work and out of scope for this task.** They are listed here
so nothing fails silently once the hardware is live.

### 4.1 `ripeness_levels` still has four rows — blocking

The table holds `Green`, `Turning`, `Ripe`, `Overripe`. The machine now needs
**`Green` and `Yellow` only**, because bin 8 was reassigned from Overripe to
Bruised and there is nowhere to send overripe fruit.

Until this is fixed, **a `Yellow` color result will not resolve to a
`ripeness_id`** and the insert fails or writes null.

Suggested migration:

```sql
-- Green stays; Turning/Ripe/Overripe collapse into Yellow.
update ripeness_levels set ripeness_name = 'Yellow', sort_order = 2
  where ripeness_name = 'Ripe';
delete from ripeness_levels where ripeness_name in ('Turning', 'Overripe');
```

Existing `scan_sessions` rows pointing at the deleted levels must be
repointed first, or the FK will block the delete.

### 4.2 `bin_assigned` has no defined vocabulary

It is an unconstrained `varchar(30)`. Proposed canonical values, matching what
the engine emits:

```
GREEN_SMALL   GREEN_MEDIUM   GREEN_LARGE
YELLOW_SMALL  YELLOW_MEDIUM  YELLOW_LARGE
REJECT_DISEASED
REJECT_BRUISED
```

A check constraint or a small lookup table would catch typos. Without one, a
single misspelling silently splits your analytics into two bins.

### 4.3 Nothing stores `reason_code` or `alerts`

This one has a real cost. **Low-confidence rejects and diseased rejects both
land in bin 7.** The engine distinguishes them by `reason_code`, but with no
column to write it to, they become indistinguishable in the database — and
"how often is the machine rejecting fruit because it could not see properly?"
becomes unanswerable.

Suggested:

```sql
alter table scan_sessions
  add column reason_code varchar(32),
  add column alerts text[] default '{}';
```

`decision_trace` is verbose; store it as `jsonb` only if you want per-scan
forensics, otherwise leave it to logs.

### 4.4 `declared_variety` has no source

Model 1's QC role compares its prediction against the operator's declared
batch variety. Nothing in the current system captures that declaration.

Until it exists, pass `null` — the check is skipped cleanly and
`variety_match` comes back `null`. **No error, but also no QC.** Model 1's
output is recorded and nothing verifies the manual pre-sort.

The lightest fix is an operator-set field on the batch or session, surfaced in
the web app and passed through to `05_predict_multiview.py --declared-variety`.

---

## 5. Servo addressing

`routing.toml` ships this scheme:

| Servo | Positions |
|---|---|
| `servo1` | `group_green`, `group_yellow`, `group_diseased`, `group_bruised` |
| `servo2` | `slot_small`, `slot_medium`, `slot_large`, `slot_park` |

Four group positions × three size slots addresses all 8 bins with two servos.
Reject bins park servo2, since size is irrelevant there.

**This is a proposal, not a specification.** The actual mechanism — gate tree,
indexed rotating arm, timed diverter — is a hardware question, and the
hardware team must confirm or replace it.

Correcting it is a config edit, not a code change. The engine treats these
values as opaque strings and never interprets them:

```toml
[[bins]]
index = 1
name = "GREEN_SMALL"
verdict = "passed"
color = "Green"
size = "Small"
servo1_action = "whatever_your_firmware_expects"
servo2_action = "angle_37"
```

---

## 6. Tuning against real runs

Everything below is config, changeable without redeploying code:

- **`[thresholds]`** — per-dimension confidence gates. Raise a threshold if a
  model is letting bad reads through; lower it if too much good fruit is
  landing in bin 7 with `reason_code: LOW_CONFIDENCE`. Tune against measured
  calibration (see `03-model5-fusion-contract.md` §5), not intuition.
- **`[[size_grades]]`** — gram ranges. Must stay in sync with the
  `size_grades` table.
- **`[disease] reject_labels`** — which diseases reject.
- **`[low_confidence] bin_index`** — currently 7. Point it at a manual-review
  chute the day one exists.

After any change, rerun the suite — the exhaustive tests will catch a config
that no longer routes every color/size pair:

```bash
cd MyTasks/model5_fusion && python -m pytest -q
```

`config_version` in every decision is a hash of the config file, so you can
always tell which version produced a given routing decision.
