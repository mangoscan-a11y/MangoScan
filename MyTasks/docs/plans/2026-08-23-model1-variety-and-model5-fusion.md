# Model 1 (Variety Classification) + Model 5 (Decision Fusion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a trainable 6-class mango variety classifier (Model 1) and a fully-tested rule-based 8-bin routing engine (Model 5), plus the documentation the user needs to collect a dataset and hand a contract to teammates.

**Architecture:** Model 5 is a pure, dependency-free Python function over a TOML config — built first, tested exhaustively, demonstrable with mock models before any mango is photographed. Model 1 splits into a **pure-stdlib core** (`mango_variety/`: class vocabulary, fruit-grouped dataset splitting, multi-view softmax aggregation, metrics/calibration) that is unit-testable on the user's Python 3.14, and **thin ML script wrappers** (`scripts/`) that import Ultralytics and only ever run on Colab.

**Tech Stack:** Python 3.11+ stdlib (`tomllib`, `dataclasses`), pytest for tests, Ultralytics YOLOv8-cls + PyTorch on Colab only.

**Spec:** `MyTasks/docs/00-design-spec.md`

## Global Constraints

- **Class names are exact, and match `mango_varieties.variety_name` in Supabase:** `Carabao`, `Apple Mango`, `Indian`, `Chupadera`, `Wani`, `Kabayo`. It is **`Wani`**, not "Wanni".
- **Disease labels:** `Healthy`, `Anthracnose`, `Mango Scab`. **Color labels:** `Green`, `Yellow` (Overripe is dropped). **Size labels:** `Small`, `Medium`, `Large`.
- **`quality_verdict` is exactly `"passed"` or `"rejected"`** — it maps onto a Postgres enum. Bins 1–6 are `passed`; bins 7–8 are `rejected`.
- **Model 5 has zero third-party runtime dependencies.** Stdlib only (`tomllib`, `dataclasses`, `json`). pytest is a test-only dependency.
- **`MyTasks/model1_variety/mango_variety/` must not import any third-party package.** Its tests run on the user's local Python 3.14.4, where PyTorch/Ultralytics wheels do not exist. No numpy.
- **`MyTasks/model1_variety/scripts/` may import `ultralytics`/`torch`.** No test file may import from `scripts/`.
- Routing precedence is fixed: **confidence gate → disease → bruise → color+size.** Variety never changes the bin.
- All new files live under `MyTasks/`. **Do not modify anything under `WebApp/`.**
- Directory names on disk use underscores (`Apple_Mango`); the canonical label uses a space (`Apple Mango`). Conversion goes through `mango_variety.classes`.

---

## File Structure

```
MyTasks/
  README.md                                  Task 10
  docs/
    00-design-spec.md                        (exists)
    01-dataset-sourcing-guide.md             Task 9
    02-model1-training-guide.md              Task 10
    03-model5-fusion-contract.md             Task 10
    04-integration-guide.md                  Task 10
  model5_fusion/
    pyproject.toml                           Task 1
    config/routing.toml                      Task 1
    fusion/
      __init__.py                            Task 1
      vocab.py            canonical labels   Task 1
      config.py           TOML loader        Task 1
      contracts.py        dataclasses + I/O  Task 2
      engine.py           decide()           Task 3
      cli.py              command line       Task 4
    stubs/mock_models.py  fake models 2-4    Task 4
    tests/
      test_config.py                         Task 1
      test_contracts.py                      Task 2
      test_engine.py                         Task 3
      test_cli.py                            Task 4
  model1_variety/
    pyproject.toml                           Task 5
    requirements.txt                         Task 7
    configs/dataset.toml                     Task 7
    mango_variety/
      __init__.py                            Task 5
      classes.py          label vocabulary   Task 5
      dataset.py          fruit-grouped split Task 5
      aggregate.py        mean-of-softmax    Task 6
      metrics.py          P/R/F1, CM, ECE    Task 6
    scripts/
      01_prepare_dataset.py                  Task 7
      02_train.py                            Task 7
      03_evaluate.py                         Task 7
      04_export.py                           Task 7
      05_predict_multiview.py                Task 7
    notebooks/MangoScan_Model1_Colab.ipynb   Task 8
    tests/
      test_classes.py                        Task 5
      test_dataset.py                        Task 5
      test_aggregate.py                      Task 6
      test_metrics.py                        Task 6
  tools/
    capture_protocol.md                      Task 9
    label_sheet_template.csv                 Task 9
```

**Order:** Tasks 1–4 build Model 5 end-to-end (independently shippable and demoable). Tasks 5–8 build Model 1. Tasks 9–10 are the user-facing documentation.

---

## Task 1: Model 5 scaffold, vocabulary, and routing config

**Files:**
- Create: `MyTasks/model5_fusion/pyproject.toml`
- Create: `MyTasks/model5_fusion/fusion/__init__.py`
- Create: `MyTasks/model5_fusion/fusion/vocab.py`
- Create: `MyTasks/model5_fusion/config/routing.toml`
- Create: `MyTasks/model5_fusion/fusion/config.py`
- Test: `MyTasks/model5_fusion/tests/test_config.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `fusion.vocab`: `VARIETIES`, `DISEASES`, `COLORS`, `SIZES`, `ROUTING_DIMENSIONS` — all `tuple[str, ...]`.
  - `fusion.config.BinSpec(index:int, name:str, verdict:str, color:str|None, size:str|None, servo1_action:str, servo2_action:str)` — frozen dataclass.
  - `fusion.config.SizeGrade(name:str, min_grams:float, max_grams:float)` — frozen dataclass.
  - `fusion.config.RoutingConfig` — frozen dataclass with fields `engine_version:str`, `thresholds:dict[str,float]`, `disease_reject_labels:tuple[str,...]`, `low_confidence_bin:int`, `size_grades:tuple[SizeGrade,...]`, `bins:tuple[BinSpec,...]`, `config_version:str`.
  - `RoutingConfig.load(path: str | Path) -> RoutingConfig` (classmethod)
  - `RoutingConfig.bin_for(color: str, size: str) -> BinSpec`
  - `RoutingConfig.bin_by_index(index: int) -> BinSpec`
  - `RoutingConfig.grade_for_grams(grams: float) -> str`
  - `fusion.config.ConfigError(ValueError)`

- [ ] **Step 1: Create the package scaffold**

`MyTasks/model5_fusion/pyproject.toml`:

```toml
[project]
name = "mangoscan-fusion"
version = "1.0.0"
description = "MangoScan Model 5 - rule-based decision fusion and bin routing"
requires-python = ">=3.11"
dependencies = []

[project.optional-dependencies]
dev = ["pytest>=7.0"]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

`MyTasks/model5_fusion/fusion/__init__.py`:

```python
"""MangoScan Model 5 - decision fusion.

Stdlib only. No third-party runtime dependencies, by design: this module
runs on the inference host next to the sorting machine, where installing
a dependency tree is a liability.
"""

__version__ = "1.0.0"
```

`MyTasks/model5_fusion/fusion/vocab.py`:

```python
"""Canonical label vocabulary.

These strings must match the reference tables in Supabase exactly. A
mismatch here surfaces as a foreign-key failure at insert time, long
after the misclassification actually happened.
"""

VARIETIES: tuple[str, ...] = (
    "Carabao",
    "Apple Mango",
    "Indian",
    "Chupadera",
    "Wani",
    "Kabayo",
)

DISEASES: tuple[str, ...] = ("Healthy", "Anthracnose", "Mango Scab")

COLORS: tuple[str, ...] = ("Green", "Yellow")

SIZES: tuple[str, ...] = ("Small", "Medium", "Large")

#: Dimensions that determine the physical bin. Variety is deliberately
#: absent - it is a QC check, never a routing input.
ROUTING_DIMENSIONS: tuple[str, ...] = ("disease", "bruise", "color", "size")

ALL_DIMENSIONS: tuple[str, ...] = ("variety",) + ROUTING_DIMENSIONS
```

- [ ] **Step 2: Write the routing config**

`MyTasks/model5_fusion/config/routing.toml`:

```toml
# MangoScan Model 5 - routing configuration.
#
# Everything tunable lives here. No routing constant is hardcoded in Python.
#
# SERVO ADDRESSING (proposal - hardware team must confirm):
#   servo1 selects the group  : green | yellow | diseased | bruised
#   servo2 selects the slot   : small | medium | large | park
# Four group positions x three size slots addresses all 8 bins with two
# servos. Reject bins park servo2 because size is irrelevant there.

schema_version = 1
engine_version = "1.0.0"

# Minimum confidence for a dimension to be trusted. Routing dimensions
# below their threshold send the mango to `low_confidence.bin_index`.
# `variety` is alert-only and never gates routing.
[thresholds]
variety = 0.50
disease = 0.60
bruise  = 0.60
color   = 0.60
size    = 0.60

[disease]
reject_labels = ["Anthracnose", "Mango Scab"]

[low_confidence]
# Shares the physical bin with diseased fruit. `reason_code` keeps the two
# distinguishable in the database. Change this one line if the machine
# ever gains a manual-review chute.
bin_index = 7

# Gram ranges are [min_grams, max_grams). These MUST match the
# `size_grades` table in Supabase.
[[size_grades]]
name = "Small"
min_grams = 0.0
max_grams = 200.0

[[size_grades]]
name = "Medium"
min_grams = 200.0
max_grams = 350.0

[[size_grades]]
name = "Large"
min_grams = 350.0
max_grams = 100000.0

[[bins]]
index = 1
name = "GREEN_SMALL"
verdict = "passed"
color = "Green"
size = "Small"
servo1_action = "group_green"
servo2_action = "slot_small"

[[bins]]
index = 2
name = "GREEN_MEDIUM"
verdict = "passed"
color = "Green"
size = "Medium"
servo1_action = "group_green"
servo2_action = "slot_medium"

[[bins]]
index = 3
name = "GREEN_LARGE"
verdict = "passed"
color = "Green"
size = "Large"
servo1_action = "group_green"
servo2_action = "slot_large"

[[bins]]
index = 4
name = "YELLOW_SMALL"
verdict = "passed"
color = "Yellow"
size = "Small"
servo1_action = "group_yellow"
servo2_action = "slot_small"

[[bins]]
index = 5
name = "YELLOW_MEDIUM"
verdict = "passed"
color = "Yellow"
size = "Medium"
servo1_action = "group_yellow"
servo2_action = "slot_medium"

[[bins]]
index = 6
name = "YELLOW_LARGE"
verdict = "passed"
color = "Yellow"
size = "Large"
servo1_action = "group_yellow"
servo2_action = "slot_large"

[[bins]]
index = 7
name = "REJECT_DISEASED"
verdict = "rejected"
servo1_action = "group_diseased"
servo2_action = "slot_park"

[[bins]]
index = 8
name = "REJECT_BRUISED"
verdict = "rejected"
servo1_action = "group_bruised"
servo2_action = "slot_park"
```

- [ ] **Step 3: Write the failing config tests**

`MyTasks/model5_fusion/tests/test_config.py`:

```python
import textwrap
from pathlib import Path

import pytest

from fusion.config import ConfigError, RoutingConfig
from fusion.vocab import COLORS, SIZES

CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "routing.toml"


@pytest.fixture
def config() -> RoutingConfig:
    return RoutingConfig.load(CONFIG_PATH)


def test_loads_shipped_config(config):
    assert config.engine_version == "1.0.0"
    assert len(config.bins) == 8


def test_config_version_is_content_hash(config):
    assert config.config_version.startswith("routing.toml@sha256:")


def test_every_color_size_pair_maps_to_a_passed_bin(config):
    seen = set()
    for color in COLORS:
        for size in SIZES:
            spec = config.bin_for(color, size)
            assert spec.verdict == "passed"
            assert 1 <= spec.index <= 6
            seen.add(spec.index)
    assert seen == {1, 2, 3, 4, 5, 6}


def test_reject_bins_are_rejected(config):
    assert config.bin_by_index(7).verdict == "rejected"
    assert config.bin_by_index(8).verdict == "rejected"


def test_thresholds_present_for_every_dimension(config):
    for dim in ("variety", "disease", "bruise", "color", "size"):
        assert 0.0 <= config.thresholds[dim] <= 1.0


@pytest.mark.parametrize(
    "grams,expected",
    [
        (0.0, "Small"),
        (199.9, "Small"),
        (200.0, "Medium"),   # min inclusive
        (349.9, "Medium"),
        (350.0, "Large"),    # max exclusive
        (900.0, "Large"),
    ],
)
def test_grade_for_grams_boundaries(config, grams, expected):
    assert config.grade_for_grams(grams) == expected


def test_grade_for_grams_rejects_negative(config):
    with pytest.raises(ConfigError):
        config.grade_for_grams(-1.0)


def test_missing_color_size_pair_is_rejected(tmp_path):
    bad = tmp_path / "bad.toml"
    bad.write_text(
        textwrap.dedent(
            """
            schema_version = 1
            engine_version = "x"
            [thresholds]
            variety = 0.5
            disease = 0.6
            bruise = 0.6
            color = 0.6
            size = 0.6
            [disease]
            reject_labels = ["Anthracnose"]
            [low_confidence]
            bin_index = 7
            [[size_grades]]
            name = "Small"
            min_grams = 0.0
            max_grams = 1.0
            [[bins]]
            index = 7
            name = "REJECT_DISEASED"
            verdict = "rejected"
            servo1_action = "a"
            servo2_action = "b"
            """
        ),
        encoding="utf-8",
    )
    with pytest.raises(ConfigError, match="no bin for"):
        RoutingConfig.load(bad)
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd MyTasks/model5_fusion && python -m pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'fusion.config'`

- [ ] **Step 5: Implement the config loader**

`MyTasks/model5_fusion/fusion/config.py`:

```python
"""Loads and validates `routing.toml`.

Validation is strict and happens at load time. A config that cannot route
every legal color/size pair is a config that will strand a mango on the
belt at 3am, so it fails here instead.
"""

from __future__ import annotations

import hashlib
import tomllib
from dataclasses import dataclass
from pathlib import Path

from fusion.vocab import ALL_DIMENSIONS, COLORS, SIZES


class ConfigError(ValueError):
    """The routing config is missing, malformed, or internally inconsistent."""


@dataclass(frozen=True)
class BinSpec:
    index: int
    name: str
    verdict: str
    servo1_action: str
    servo2_action: str
    color: str | None = None
    size: str | None = None


@dataclass(frozen=True)
class SizeGrade:
    name: str
    min_grams: float
    max_grams: float


@dataclass(frozen=True)
class RoutingConfig:
    engine_version: str
    thresholds: dict[str, float]
    disease_reject_labels: tuple[str, ...]
    low_confidence_bin: int
    size_grades: tuple[SizeGrade, ...]
    bins: tuple[BinSpec, ...]
    config_version: str

    @classmethod
    def load(cls, path: str | Path) -> RoutingConfig:
        path = Path(path)
        try:
            raw_bytes = path.read_bytes()
        except OSError as exc:
            raise ConfigError(f"cannot read routing config at {path}: {exc}") from exc

        try:
            data = tomllib.loads(raw_bytes.decode("utf-8"))
        except (tomllib.TOMLDecodeError, UnicodeDecodeError) as exc:
            raise ConfigError(f"{path} is not valid TOML: {exc}") from exc

        digest = hashlib.sha256(raw_bytes).hexdigest()
        config_version = f"{path.name}@sha256:{digest[:16]}"

        thresholds = cls._parse_thresholds(data)
        bins = cls._parse_bins(data)
        grades = cls._parse_size_grades(data)

        low_conf_bin = int(data.get("low_confidence", {}).get("bin_index", 0))
        if not any(b.index == low_conf_bin for b in bins):
            raise ConfigError(
                f"low_confidence.bin_index={low_conf_bin} is not a defined bin"
            )

        reject_labels = tuple(data.get("disease", {}).get("reject_labels", ()))
        if not reject_labels:
            raise ConfigError("disease.reject_labels must list at least one label")

        config = cls(
            engine_version=str(data.get("engine_version", "unknown")),
            thresholds=thresholds,
            disease_reject_labels=reject_labels,
            low_confidence_bin=low_conf_bin,
            size_grades=grades,
            bins=bins,
            config_version=config_version,
        )
        config._validate_grid()
        return config

    @staticmethod
    def _parse_thresholds(data: dict) -> dict[str, float]:
        raw = data.get("thresholds", {})
        thresholds: dict[str, float] = {}
        for dim in ALL_DIMENSIONS:
            if dim not in raw:
                raise ConfigError(f"thresholds.{dim} is missing")
            value = float(raw[dim])
            if not 0.0 <= value <= 1.0:
                raise ConfigError(f"thresholds.{dim}={value} is outside [0, 1]")
            thresholds[dim] = value
        return thresholds

    @staticmethod
    def _parse_bins(data: dict) -> tuple[BinSpec, ...]:
        entries = data.get("bins", [])
        if not entries:
            raise ConfigError("config defines no bins")
        bins: list[BinSpec] = []
        seen: set[int] = set()
        for entry in entries:
            index = int(entry["index"])
            if index in seen:
                raise ConfigError(f"duplicate bin index {index}")
            seen.add(index)
            verdict = str(entry["verdict"])
            if verdict not in ("passed", "rejected"):
                raise ConfigError(
                    f"bin {index}: verdict must be 'passed' or 'rejected', got {verdict!r}"
                )
            bins.append(
                BinSpec(
                    index=index,
                    name=str(entry["name"]),
                    verdict=verdict,
                    servo1_action=str(entry["servo1_action"]),
                    servo2_action=str(entry["servo2_action"]),
                    color=entry.get("color"),
                    size=entry.get("size"),
                )
            )
        return tuple(bins)

    @staticmethod
    def _parse_size_grades(data: dict) -> tuple[SizeGrade, ...]:
        entries = data.get("size_grades", [])
        if not entries:
            raise ConfigError("config defines no size_grades")
        grades = tuple(
            SizeGrade(
                name=str(e["name"]),
                min_grams=float(e["min_grams"]),
                max_grams=float(e["max_grams"]),
            )
            for e in entries
        )
        for grade in grades:
            if grade.min_grams >= grade.max_grams:
                raise ConfigError(
                    f"size grade {grade.name}: min_grams must be below max_grams"
                )
        return grades

    def _validate_grid(self) -> None:
        for color in COLORS:
            for size in SIZES:
                if not any(
                    b.color == color and b.size == size for b in self.bins
                ):
                    raise ConfigError(f"no bin for {color} x {size}")

    def bin_for(self, color: str, size: str) -> BinSpec:
        for spec in self.bins:
            if spec.color == color and spec.size == size:
                return spec
        raise ConfigError(f"no bin for {color} x {size}")

    def bin_by_index(self, index: int) -> BinSpec:
        for spec in self.bins:
            if spec.index == index:
                return spec
        raise ConfigError(f"no bin with index {index}")

    def grade_for_grams(self, grams: float) -> str:
        for grade in self.size_grades:
            if grade.min_grams <= grams < grade.max_grams:
                return grade.name
        raise ConfigError(f"{grams}g falls outside every configured size grade")
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd MyTasks/model5_fusion && python -m pytest tests/test_config.py -v`
Expected: PASS — all 11 tests green.

- [ ] **Step 7: Commit**

```bash
git add MyTasks/model5_fusion
git commit -m "feat(model5): routing config loader with strict validation"
```

---

## Task 2: Model 5 input/output contracts

**Files:**
- Create: `MyTasks/model5_fusion/fusion/contracts.py`
- Test: `MyTasks/model5_fusion/tests/test_contracts.py`

**Interfaces:**
- Consumes: `fusion.vocab` (Task 1).
- Produces:
  - `fusion.contracts.ContractError(ValueError)`
  - `ViewPrediction(angle_sequence:int, label:str, confidence:float)`
  - `VarietyOutput(label:str, confidence:float, probabilities:dict[str,float]|None, per_view:tuple[ViewPrediction,...])`
  - `DiseaseOutput(label:str, confidence:float)`
  - `BruiseOutput(is_bruised:bool, confidence:float)`
  - `ColorOutput(label:str, confidence:float)`
  - `SizeOutput(confidence:float, label:str|None, grams:float|None)`
  - `ScanInput(scan_id:str, captured_at:str|None, declared_variety:str|None, variety:VarietyOutput|None, disease:DiseaseOutput|None, bruise:BruiseOutput|None, color:ColorOutput|None, size:SizeOutput|None)` with `ScanInput.from_dict(data: dict) -> ScanInput`
  - `TraceStep(step:str, result:str, detail:str)`
  - `FusionDecision(...)` with `.to_dict() -> dict`

  All dataclasses are frozen. `from_dict` performs **structural** validation only (presence, types, numeric ranges). **Vocabulary** validation belongs to the engine (Task 3), which is the only component holding the config.

- [ ] **Step 1: Write the failing contract tests**

`MyTasks/model5_fusion/tests/test_contracts.py`:

```python
import pytest

from fusion.contracts import (
    ContractError,
    FusionDecision,
    ScanInput,
    TraceStep,
)


def minimal_payload(**overrides) -> dict:
    payload = {
        "scan_id": "abc-123",
        "captured_at": "2026-08-23T10:15:00+08:00",
        "declared_variety": "Carabao",
        "models": {
            "variety": {"label": "Carabao", "confidence": 0.94},
            "disease": {"label": "Healthy", "confidence": 0.97},
            "bruise": {"is_bruised": False, "confidence": 0.88},
            "color": {"label": "Green", "confidence": 0.91},
            "size": {"label": "Medium", "confidence": 0.85},
        },
    }
    payload.update(overrides)
    return payload


def test_parses_minimal_payload():
    scan = ScanInput.from_dict(minimal_payload())
    assert scan.scan_id == "abc-123"
    assert scan.variety.label == "Carabao"
    assert scan.bruise.is_bruised is False
    assert scan.size.grams is None


def test_parses_optional_variety_detail():
    payload = minimal_payload()
    payload["models"]["variety"]["probabilities"] = {"Carabao": 0.94, "Indian": 0.06}
    payload["models"]["variety"]["per_view"] = [
        {"angle_sequence": 1, "label": "Carabao", "confidence": 0.96},
        {"angle_sequence": 2, "label": "Carabao", "confidence": 0.92},
    ]
    scan = ScanInput.from_dict(payload)
    assert len(scan.per_view_or_empty()) == 2
    assert scan.variety.per_view[0].angle_sequence == 1
    assert scan.variety.probabilities["Indian"] == pytest.approx(0.06)


def test_size_accepts_grams_without_label():
    payload = minimal_payload()
    payload["models"]["size"] = {"grams": 220.5, "confidence": 0.85}
    scan = ScanInput.from_dict(payload)
    assert scan.size.grams == pytest.approx(220.5)
    assert scan.size.label is None


def test_missing_dimension_becomes_none():
    payload = minimal_payload()
    payload["models"]["color"] = None
    scan = ScanInput.from_dict(payload)
    assert scan.color is None


def test_absent_dimension_key_becomes_none():
    payload = minimal_payload()
    del payload["models"]["disease"]
    scan = ScanInput.from_dict(payload)
    assert scan.disease is None


def test_declared_variety_may_be_absent():
    payload = minimal_payload()
    del payload["declared_variety"]
    scan = ScanInput.from_dict(payload)
    assert scan.declared_variety is None


def test_missing_scan_id_is_an_error():
    payload = minimal_payload()
    del payload["scan_id"]
    with pytest.raises(ContractError, match="scan_id"):
        ScanInput.from_dict(payload)


@pytest.mark.parametrize("bad", [-0.01, 1.01, 2.0])
def test_confidence_out_of_range_is_an_error(bad):
    payload = minimal_payload()
    payload["models"]["disease"]["confidence"] = bad
    with pytest.raises(ContractError, match="confidence"):
        ScanInput.from_dict(payload)


def test_confidence_must_be_numeric():
    payload = minimal_payload()
    payload["models"]["color"]["confidence"] = "high"
    with pytest.raises(ContractError, match="confidence"):
        ScanInput.from_dict(payload)


def test_size_without_label_or_grams_is_an_error():
    payload = minimal_payload()
    payload["models"]["size"] = {"confidence": 0.9}
    with pytest.raises(ContractError, match="label.*grams|grams.*label"):
        ScanInput.from_dict(payload)


def test_negative_grams_is_an_error():
    payload = minimal_payload()
    payload["models"]["size"] = {"grams": -5.0, "confidence": 0.9}
    with pytest.raises(ContractError, match="grams"):
        ScanInput.from_dict(payload)


def test_bruise_requires_boolean_flag():
    payload = minimal_payload()
    payload["models"]["bruise"]["is_bruised"] = "yes"
    with pytest.raises(ContractError, match="is_bruised"):
        ScanInput.from_dict(payload)


def test_models_block_must_be_a_mapping():
    with pytest.raises(ContractError, match="models"):
        ScanInput.from_dict({"scan_id": "x", "models": []})


def test_decision_round_trips_to_dict():
    decision = FusionDecision(
        scan_id="abc-123",
        bin_index=2,
        bin_name="GREEN_MEDIUM",
        quality_verdict="passed",
        reason_code="ROUTED_BY_COLOR_SIZE",
        servo1_action="group_green",
        servo2_action="slot_medium",
        detected_variety="Carabao",
        declared_variety="Carabao",
        variety_match=True,
        alerts=(),
        decision_trace=(TraceStep("grade", "bin 2", "Green x Medium"),),
        engine_version="1.0.0",
        config_version="routing.toml@sha256:deadbeef",
    )
    as_dict = decision.to_dict()
    assert as_dict["bin_index"] == 2
    assert as_dict["alerts"] == []
    assert as_dict["decision_trace"] == [
        {"step": "grade", "result": "bin 2", "detail": "Green x Medium"}
    ]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd MyTasks/model5_fusion && python -m pytest tests/test_contracts.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'fusion.contracts'`

- [ ] **Step 3: Implement the contracts**

`MyTasks/model5_fusion/fusion/contracts.py`:

```python
"""The JSON interface between Models 1-4, Model 5, and the database.

`from_dict` validates *structure* - field presence, types, numeric
ranges. It deliberately does not validate label vocabulary, because that
lives in the routing config and only the engine holds one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


class ContractError(ValueError):
    """A model output does not satisfy the documented contract."""


def _require_confidence(block: dict, dimension: str) -> float:
    if "confidence" not in block:
        raise ContractError(f"{dimension}: confidence is required")
    value = block["confidence"]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ContractError(f"{dimension}: confidence must be a number, got {value!r}")
    value = float(value)
    if not 0.0 <= value <= 1.0:
        raise ContractError(f"{dimension}: confidence {value} is outside [0, 1]")
    return value


def _require_label(block: dict, dimension: str) -> str:
    label = block.get("label")
    if not isinstance(label, str) or not label:
        raise ContractError(f"{dimension}: label must be a non-empty string")
    return label


def _block(models: dict, dimension: str) -> dict | None:
    raw = models.get(dimension)
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ContractError(f"{dimension}: expected an object, got {type(raw).__name__}")
    return raw


@dataclass(frozen=True)
class ViewPrediction:
    angle_sequence: int
    label: str
    confidence: float


@dataclass(frozen=True)
class VarietyOutput:
    label: str
    confidence: float
    probabilities: dict[str, float] | None = None
    per_view: tuple[ViewPrediction, ...] = ()


@dataclass(frozen=True)
class DiseaseOutput:
    label: str
    confidence: float


@dataclass(frozen=True)
class BruiseOutput:
    is_bruised: bool
    confidence: float


@dataclass(frozen=True)
class ColorOutput:
    label: str
    confidence: float


@dataclass(frozen=True)
class SizeOutput:
    confidence: float
    label: str | None = None
    grams: float | None = None


@dataclass(frozen=True)
class ScanInput:
    scan_id: str
    captured_at: str | None = None
    declared_variety: str | None = None
    variety: VarietyOutput | None = None
    disease: DiseaseOutput | None = None
    bruise: BruiseOutput | None = None
    color: ColorOutput | None = None
    size: SizeOutput | None = None

    def per_view_or_empty(self) -> tuple[ViewPrediction, ...]:
        return self.variety.per_view if self.variety else ()

    @classmethod
    def from_dict(cls, data: Any) -> ScanInput:
        if not isinstance(data, dict):
            raise ContractError(f"expected an object, got {type(data).__name__}")

        scan_id = data.get("scan_id")
        if not isinstance(scan_id, str) or not scan_id:
            raise ContractError("scan_id is required and must be a non-empty string")

        models = data.get("models", {})
        if not isinstance(models, dict):
            raise ContractError("models must be an object")

        return cls(
            scan_id=scan_id,
            captured_at=data.get("captured_at"),
            declared_variety=data.get("declared_variety"),
            variety=cls._parse_variety(_block(models, "variety")),
            disease=cls._parse_disease(_block(models, "disease")),
            bruise=cls._parse_bruise(_block(models, "bruise")),
            color=cls._parse_color(_block(models, "color")),
            size=cls._parse_size(_block(models, "size")),
        )

    @staticmethod
    def _parse_variety(block: dict | None) -> VarietyOutput | None:
        if block is None:
            return None
        views = []
        for raw in block.get("per_view", ()) or ():
            if not isinstance(raw, dict):
                raise ContractError("variety.per_view entries must be objects")
            views.append(
                ViewPrediction(
                    angle_sequence=int(raw.get("angle_sequence", 0)),
                    label=_require_label(raw, "variety.per_view"),
                    confidence=_require_confidence(raw, "variety.per_view"),
                )
            )
        probabilities = block.get("probabilities")
        if probabilities is not None and not isinstance(probabilities, dict):
            raise ContractError("variety.probabilities must be an object")
        return VarietyOutput(
            label=_require_label(block, "variety"),
            confidence=_require_confidence(block, "variety"),
            probabilities={k: float(v) for k, v in probabilities.items()}
            if probabilities
            else None,
            per_view=tuple(views),
        )

    @staticmethod
    def _parse_disease(block: dict | None) -> DiseaseOutput | None:
        if block is None:
            return None
        return DiseaseOutput(
            label=_require_label(block, "disease"),
            confidence=_require_confidence(block, "disease"),
        )

    @staticmethod
    def _parse_bruise(block: dict | None) -> BruiseOutput | None:
        if block is None:
            return None
        flag = block.get("is_bruised")
        if not isinstance(flag, bool):
            raise ContractError("bruise: is_bruised must be a boolean")
        return BruiseOutput(
            is_bruised=flag,
            confidence=_require_confidence(block, "bruise"),
        )

    @staticmethod
    def _parse_color(block: dict | None) -> ColorOutput | None:
        if block is None:
            return None
        return ColorOutput(
            label=_require_label(block, "color"),
            confidence=_require_confidence(block, "color"),
        )

    @staticmethod
    def _parse_size(block: dict | None) -> SizeOutput | None:
        if block is None:
            return None
        confidence = _require_confidence(block, "size")
        label = block.get("label")
        grams = block.get("grams")

        if label is None and grams is None:
            raise ContractError("size: one of label or grams is required")
        if label is not None and (not isinstance(label, str) or not label):
            raise ContractError("size: label must be a non-empty string")
        if grams is not None:
            if isinstance(grams, bool) or not isinstance(grams, (int, float)):
                raise ContractError("size: grams must be a number")
            grams = float(grams)
            if grams < 0:
                raise ContractError(f"size: grams {grams} must not be negative")
        return SizeOutput(confidence=confidence, label=label, grams=grams)


@dataclass(frozen=True)
class TraceStep:
    step: str
    result: str
    detail: str


@dataclass(frozen=True)
class FusionDecision:
    scan_id: str
    bin_index: int
    bin_name: str
    quality_verdict: str
    reason_code: str
    servo1_action: str
    servo2_action: str
    detected_variety: str | None
    declared_variety: str | None
    variety_match: bool | None
    alerts: tuple[str, ...]
    decision_trace: tuple[TraceStep, ...]
    engine_version: str
    config_version: str

    def to_dict(self) -> dict:
        return {
            "scan_id": self.scan_id,
            "bin_index": self.bin_index,
            "bin_name": self.bin_name,
            "quality_verdict": self.quality_verdict,
            "reason_code": self.reason_code,
            "servo1_action": self.servo1_action,
            "servo2_action": self.servo2_action,
            "detected_variety": self.detected_variety,
            "declared_variety": self.declared_variety,
            "variety_match": self.variety_match,
            "alerts": list(self.alerts),
            "decision_trace": [
                {"step": s.step, "result": s.result, "detail": s.detail}
                for s in self.decision_trace
            ],
            "engine_version": self.engine_version,
            "config_version": self.config_version,
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd MyTasks/model5_fusion && python -m pytest tests/test_contracts.py -v`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add MyTasks/model5_fusion/fusion/contracts.py MyTasks/model5_fusion/tests/test_contracts.py
git commit -m "feat(model5): input/output contracts with structural validation"
```

---

## Task 3: Model 5 decision engine

**Files:**
- Create: `MyTasks/model5_fusion/fusion/engine.py`
- Test: `MyTasks/model5_fusion/tests/test_engine.py`

**Interfaces:**
- Consumes: `fusion.config.RoutingConfig` (Task 1), `fusion.contracts.*` (Task 2), `fusion.vocab` (Task 1).
- Produces:
  - `fusion.engine.decide(scan: ScanInput, config: RoutingConfig) -> FusionDecision`
  - `fusion.engine.ENGINE_VERSION: str`
  - Reason codes `LOW_CONFIDENCE`, `DISEASE_DETECTED`, `BRUISE_DETECTED`, `ROUTED_BY_COLOR_SIZE`.
  - Alerts `VARIETY_MISMATCH`, `LOW_CONFIDENCE_VARIETY`, `LOW_CONFIDENCE_<DIM>` for each routing dimension.

- [ ] **Step 1: Write the exhaustive failing test suite**

`MyTasks/model5_fusion/tests/test_engine.py`:

```python
import itertools
from pathlib import Path

import pytest

from fusion.config import RoutingConfig
from fusion.contracts import ContractError, ScanInput
from fusion.engine import decide
from fusion.vocab import COLORS, DISEASES, SIZES, VARIETIES

CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "routing.toml"

EXPECTED_GRID = {
    ("Green", "Small"): 1,
    ("Green", "Medium"): 2,
    ("Green", "Large"): 3,
    ("Yellow", "Small"): 4,
    ("Yellow", "Medium"): 5,
    ("Yellow", "Large"): 6,
}


@pytest.fixture(scope="module")
def config() -> RoutingConfig:
    return RoutingConfig.load(CONFIG_PATH)


def build(
    variety="Carabao",
    disease="Healthy",
    bruised=False,
    color="Green",
    size="Medium",
    declared="Carabao",
    conf=0.99,
    variety_conf=None,
    grams=None,
) -> ScanInput:
    size_block = {"confidence": conf}
    if grams is None:
        size_block["label"] = size
    else:
        size_block["grams"] = grams
    return ScanInput.from_dict(
        {
            "scan_id": "test-scan",
            "declared_variety": declared,
            "models": {
                "variety": {
                    "label": variety,
                    "confidence": variety_conf if variety_conf is not None else conf,
                },
                "disease": {"label": disease, "confidence": conf},
                "bruise": {"is_bruised": bruised, "confidence": conf},
                "color": {"label": color, "confidence": conf},
                "size": size_block,
            },
        }
    )


# --- Exhaustive sweep: 6 x 3 x 2 x 2 x 3 = 216 combinations -------------

@pytest.mark.parametrize(
    "variety,disease,bruised,color,size",
    list(itertools.product(VARIETIES, DISEASES, (False, True), COLORS, SIZES)),
)
def test_exhaustive_routing(config, variety, disease, bruised, color, size):
    decision = decide(build(variety, disease, bruised, color, size), config)

    if disease in ("Anthracnose", "Mango Scab"):
        expected_bin, expected_reason = 7, "DISEASE_DETECTED"
    elif bruised:
        expected_bin, expected_reason = 8, "BRUISE_DETECTED"
    else:
        expected_bin = EXPECTED_GRID[(color, size)]
        expected_reason = "ROUTED_BY_COLOR_SIZE"

    assert decision.bin_index == expected_bin
    assert decision.reason_code == expected_reason
    assert decision.quality_verdict == (
        "passed" if expected_bin <= 6 else "rejected"
    )
    # Variety never influences the bin.
    assert decision.detected_variety == variety


def test_exhaustive_sweep_covers_216_cases():
    cases = list(itertools.product(VARIETIES, DISEASES, (False, True), COLORS, SIZES))
    assert len(cases) == 216


# --- Precedence ---------------------------------------------------------

def test_diseased_and_bruised_goes_to_disease_bin(config):
    decision = decide(build(disease="Anthracnose", bruised=True), config)
    assert decision.bin_index == 7
    assert decision.reason_code == "DISEASE_DETECTED"


def test_low_confidence_beats_disease(config):
    """The gate runs first: an unreliable read is not a disease diagnosis."""
    decision = decide(build(disease="Anthracnose", conf=0.10), config)
    assert decision.reason_code == "LOW_CONFIDENCE"


# --- Confidence gate ----------------------------------------------------

@pytest.mark.parametrize("dimension", ["disease", "bruise", "color", "size"])
def test_below_threshold_routes_to_low_confidence_bin(config, dimension):
    payload = build()
    models = {
        "variety": {"label": "Carabao", "confidence": 0.99},
        "disease": {"label": "Healthy", "confidence": 0.99},
        "bruise": {"is_bruised": False, "confidence": 0.99},
        "color": {"label": "Green", "confidence": 0.99},
        "size": {"label": "Medium", "confidence": 0.99},
    }
    models[dimension]["confidence"] = 0.10
    scan = ScanInput.from_dict(
        {"scan_id": "s", "declared_variety": "Carabao", "models": models}
    )
    decision = decide(scan, config)
    assert decision.bin_index == config.low_confidence_bin
    assert decision.reason_code == "LOW_CONFIDENCE"
    assert f"LOW_CONFIDENCE_{dimension.upper()}" in decision.alerts


@pytest.mark.parametrize(
    "confidence,should_gate",
    [(0.5999, True), (0.60, False), (0.6001, False)],
)
def test_threshold_boundary_is_inclusive(config, confidence, should_gate):
    """A confidence exactly equal to the threshold passes."""
    decision = decide(build(conf=confidence), config)
    gated = decision.reason_code == "LOW_CONFIDENCE"
    assert gated is should_gate


def test_missing_routing_dimension_gates(config):
    scan = ScanInput.from_dict(
        {
            "scan_id": "s",
            "declared_variety": "Carabao",
            "models": {
                "variety": {"label": "Carabao", "confidence": 0.99},
                "disease": None,
                "bruise": {"is_bruised": False, "confidence": 0.99},
                "color": {"label": "Green", "confidence": 0.99},
                "size": {"label": "Medium", "confidence": 0.99},
            },
        }
    )
    decision = decide(scan, config)
    assert decision.reason_code == "LOW_CONFIDENCE"
    assert "LOW_CONFIDENCE_DISEASE" in decision.alerts


def test_low_variety_confidence_does_not_gate_routing(config):
    """Variety is alert-only. A bad variety read still gets sorted."""
    decision = decide(build(variety_conf=0.05), config)
    assert decision.bin_index == 2
    assert decision.reason_code == "ROUTED_BY_COLOR_SIZE"
    assert "LOW_CONFIDENCE_VARIETY" in decision.alerts


# --- Size from grams ----------------------------------------------------

@pytest.mark.parametrize(
    "grams,expected_bin",
    [(150.0, 1), (200.0, 2), (275.0, 2), (350.0, 3), (600.0, 3)],
)
def test_grams_derive_the_size_bin(config, grams, expected_bin):
    decision = decide(build(color="Green", grams=grams), config)
    assert decision.bin_index == expected_bin


def test_grams_bypass_the_size_confidence_gate(config):
    """A load cell has no softmax. Low `confidence` must not gate it."""
    decision = decide(build(color="Green", grams=275.0, conf=0.99), config)
    assert decision.bin_index == 2
    scan = ScanInput.from_dict(
        {
            "scan_id": "s",
            "declared_variety": "Carabao",
            "models": {
                "variety": {"label": "Carabao", "confidence": 0.99},
                "disease": {"label": "Healthy", "confidence": 0.99},
                "bruise": {"is_bruised": False, "confidence": 0.99},
                "color": {"label": "Green", "confidence": 0.99},
                "size": {"grams": 275.0, "confidence": 0.01},
            },
        }
    )
    assert decide(scan, config).bin_index == 2


def test_grams_win_over_a_contradicting_label(config):
    scan = ScanInput.from_dict(
        {
            "scan_id": "s",
            "declared_variety": "Carabao",
            "models": {
                "variety": {"label": "Carabao", "confidence": 0.99},
                "disease": {"label": "Healthy", "confidence": 0.99},
                "bruise": {"is_bruised": False, "confidence": 0.99},
                "color": {"label": "Green", "confidence": 0.99},
                "size": {"label": "Large", "grams": 150.0, "confidence": 0.99},
            },
        }
    )
    assert decide(scan, config).bin_index == 1  # grams say Small


# --- Variety QC ---------------------------------------------------------

def test_variety_mismatch_alerts_without_changing_the_bin(config):
    decision = decide(build(variety="Indian", declared="Carabao"), config)
    assert decision.bin_index == 2
    assert decision.variety_match is False
    assert "VARIETY_MISMATCH" in decision.alerts


def test_variety_check_runs_on_rejected_fruit_too(config):
    decision = decide(
        build(variety="Indian", declared="Carabao", disease="Anthracnose"), config
    )
    assert decision.bin_index == 7
    assert "VARIETY_MISMATCH" in decision.alerts


def test_null_declared_variety_skips_the_check(config):
    decision = decide(build(variety="Indian", declared=None), config)
    assert decision.variety_match is None
    assert "VARIETY_MISMATCH" not in decision.alerts


def test_matching_variety_produces_no_alert(config):
    decision = decide(build(), config)
    assert decision.variety_match is True
    assert decision.alerts == ()


# --- Vocabulary validation ----------------------------------------------

def test_unknown_color_is_an_error(config):
    with pytest.raises(ContractError, match="color"):
        decide(build(color="Purple"), config)


def test_unknown_disease_is_an_error(config):
    with pytest.raises(ContractError, match="disease"):
        decide(build(disease="Scurvy"), config)


def test_unknown_variety_is_an_error(config):
    with pytest.raises(ContractError, match="variety"):
        decide(build(variety="Alphonso"), config)


def test_unknown_size_label_is_an_error(config):
    with pytest.raises(ContractError, match="size"):
        decide(build(size="Jumbo"), config)


# --- Output shape -------------------------------------------------------

def test_decision_carries_servo_actions_and_versions(config):
    decision = decide(build(color="Yellow", size="Large"), config)
    assert decision.bin_name == "YELLOW_LARGE"
    assert decision.servo1_action == "group_yellow"
    assert decision.servo2_action == "slot_large"
    assert decision.engine_version == config.engine_version
    assert decision.config_version == config.config_version


def test_trace_records_every_step_on_a_clean_pass(config):
    decision = decide(build(), config)
    steps = [s.step for s in decision.decision_trace]
    assert steps == ["confidence_gate", "disease", "bruise", "grade", "variety_check"]


def test_trace_short_circuits_after_disease(config):
    decision = decide(build(disease="Mango Scab"), config)
    steps = [s.step for s in decision.decision_trace]
    assert steps == ["confidence_gate", "disease", "variety_check"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd MyTasks/model5_fusion && python -m pytest tests/test_engine.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'fusion.engine'`

- [ ] **Step 3: Implement the engine**

`MyTasks/model5_fusion/fusion/engine.py`:

```python
"""Model 5 - the fusion decision.

A pure function: same inputs, same config, same bin, every time. The
`decision_trace` it emits is what makes "why did this mango go there?"
answerable after the fact.

Precedence is fixed and deliberate:
    confidence gate -> disease -> bruise -> color x size
An unreliable read is caught before it can masquerade as a diagnosis.
"""

from __future__ import annotations

from fusion.config import RoutingConfig
from fusion.contracts import (
    ContractError,
    FusionDecision,
    ScanInput,
    TraceStep,
)
from fusion.vocab import COLORS, DISEASES, ROUTING_DIMENSIONS, SIZES, VARIETIES

ENGINE_VERSION = "1.0.0"

REASON_LOW_CONFIDENCE = "LOW_CONFIDENCE"
REASON_DISEASE = "DISEASE_DETECTED"
REASON_BRUISE = "BRUISE_DETECTED"
REASON_GRADE = "ROUTED_BY_COLOR_SIZE"


def _validate_vocabulary(scan: ScanInput) -> None:
    if scan.variety and scan.variety.label not in VARIETIES:
        raise ContractError(f"variety: unknown label {scan.variety.label!r}")
    if scan.disease and scan.disease.label not in DISEASES:
        raise ContractError(f"disease: unknown label {scan.disease.label!r}")
    if scan.color and scan.color.label not in COLORS:
        raise ContractError(f"color: unknown label {scan.color.label!r}")
    if scan.size and scan.size.label is not None and scan.size.label not in SIZES:
        raise ContractError(f"size: unknown label {scan.size.label!r}")


def _gate(scan: ScanInput, config: RoutingConfig) -> str | None:
    """Return the first routing dimension that cannot be trusted, if any."""
    for dimension in ROUTING_DIMENSIONS:
        block = getattr(scan, dimension)
        if block is None:
            return dimension
        # A load cell reports grams, not a softmax. Confidence is meaningless
        # there, so grams bypass the gate entirely.
        if dimension == "size" and scan.size.grams is not None:
            continue
        if block.confidence < config.thresholds[dimension]:
            return dimension
    return None


def _resolve_size(scan: ScanInput, config: RoutingConfig) -> str:
    if scan.size.grams is not None:
        return config.grade_for_grams(scan.size.grams)
    return scan.size.label


def _variety_check(
    scan: ScanInput, config: RoutingConfig, alerts: list[str]
) -> tuple[bool | None, TraceStep]:
    if scan.variety is None:
        return None, TraceStep("variety_check", "skipped", "no variety output")
    if scan.declared_variety is None:
        return None, TraceStep(
            "variety_check", "skipped", "no declared_variety supplied"
        )

    if scan.variety.confidence < config.thresholds["variety"]:
        alerts.append("LOW_CONFIDENCE_VARIETY")

    match = scan.variety.label == scan.declared_variety
    if not match:
        alerts.append("VARIETY_MISMATCH")
        detail = f"detected {scan.variety.label!r}, declared {scan.declared_variety!r}"
        return False, TraceStep("variety_check", "mismatch", detail)
    return True, TraceStep("variety_check", "match", scan.variety.label)


def decide(scan: ScanInput, config: RoutingConfig) -> FusionDecision:
    """Fuse Models 1-4 into a bin, a verdict, and two servo commands."""
    _validate_vocabulary(scan)

    alerts: list[str] = []
    trace: list[TraceStep] = []

    def finish(bin_index: int, reason: str) -> FusionDecision:
        spec = config.bin_by_index(bin_index)
        detected = scan.variety.label if scan.variety else None
        match, variety_step = _variety_check(scan, config, alerts)
        trace.append(variety_step)
        return FusionDecision(
            scan_id=scan.scan_id,
            bin_index=spec.index,
            bin_name=spec.name,
            quality_verdict=spec.verdict,
            reason_code=reason,
            servo1_action=spec.servo1_action,
            servo2_action=spec.servo2_action,
            detected_variety=detected,
            declared_variety=scan.declared_variety,
            variety_match=match,
            alerts=tuple(alerts),
            decision_trace=tuple(trace),
            engine_version=config.engine_version,
            config_version=config.config_version,
        )

    # 1. Confidence gate
    failed = _gate(scan, config)
    if failed is not None:
        alerts.append(f"LOW_CONFIDENCE_{failed.upper()}")
        trace.append(
            TraceStep("confidence_gate", "fail", f"{failed} below threshold or missing")
        )
        return finish(config.low_confidence_bin, REASON_LOW_CONFIDENCE)
    trace.append(
        TraceStep("confidence_gate", "pass", "all routing dimensions trusted")
    )

    # 2. Disease
    if scan.disease.label in config.disease_reject_labels:
        trace.append(TraceStep("disease", "reject", scan.disease.label))
        return finish(7, REASON_DISEASE)
    trace.append(TraceStep("disease", "pass", scan.disease.label))

    # 3. Bruise
    if scan.bruise.is_bruised:
        trace.append(TraceStep("bruise", "reject", "bruised"))
        return finish(8, REASON_BRUISE)
    trace.append(TraceStep("bruise", "pass", "not bruised"))

    # 4. Grade
    size_label = _resolve_size(scan, config)
    spec = config.bin_for(scan.color.label, size_label)
    trace.append(
        TraceStep(
            "grade",
            f"bin {spec.index}",
            f"{scan.color.label} x {size_label}",
        )
    )
    return finish(spec.index, REASON_GRADE)
```

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `cd MyTasks/model5_fusion && python -m pytest -q`
Expected: PASS — 250+ tests green, including all 216 exhaustive routing cases.

- [ ] **Step 5: Commit**

```bash
git add MyTasks/model5_fusion/fusion/engine.py MyTasks/model5_fusion/tests/test_engine.py
git commit -m "feat(model5): rule-based 8-bin decision engine with exhaustive tests"
```

---

## Task 4: Model 5 CLI and mock Models 2–4

**Files:**
- Create: `MyTasks/model5_fusion/fusion/cli.py`
- Create: `MyTasks/model5_fusion/stubs/__init__.py`
- Create: `MyTasks/model5_fusion/stubs/mock_models.py`
- Test: `MyTasks/model5_fusion/tests/test_cli.py`

**Interfaces:**
- Consumes: `fusion.engine.decide`, `fusion.config.RoutingConfig`, `fusion.contracts.ScanInput`.
- Produces:
  - `fusion.cli.main(argv: list[str] | None = None) -> int`
  - `stubs.mock_models.generate_scan(seed: int, declared_variety: str = "Carabao") -> dict`
  - `stubs.mock_models.generate_batch(count: int, seed: int = 42, declared_variety: str = "Carabao") -> list[dict]`

- [ ] **Step 1: Write the failing CLI tests**

`MyTasks/model5_fusion/tests/test_cli.py`:

```python
import json
from pathlib import Path

import pytest

from fusion.cli import main
from stubs.mock_models import generate_batch, generate_scan

CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "routing.toml"


def test_mock_scan_is_deterministic():
    assert generate_scan(7) == generate_scan(7)


def test_mock_scans_differ_across_seeds():
    assert generate_scan(1) != generate_scan(2)


def test_mock_batch_parses_and_routes():
    from fusion.config import RoutingConfig
    from fusion.contracts import ScanInput
    from fusion.engine import decide

    config = RoutingConfig.load(CONFIG_PATH)
    for payload in generate_batch(50):
        decision = decide(ScanInput.from_dict(payload), config)
        assert 1 <= decision.bin_index <= 8


def test_cli_routes_a_single_scan(tmp_path, capsys):
    infile = tmp_path / "scan.json"
    infile.write_text(json.dumps(generate_scan(3)), encoding="utf-8")

    exit_code = main(["--config", str(CONFIG_PATH), str(infile)])
    assert exit_code == 0

    out = json.loads(capsys.readouterr().out)
    assert out["scan_id"]
    assert 1 <= out["bin_index"] <= 8


def test_cli_routes_a_json_array(tmp_path, capsys):
    infile = tmp_path / "scans.json"
    infile.write_text(json.dumps(generate_batch(5)), encoding="utf-8")

    assert main(["--config", str(CONFIG_PATH), str(infile)]) == 0
    out = json.loads(capsys.readouterr().out)
    assert isinstance(out, list) and len(out) == 5


def test_cli_reads_stdin(monkeypatch, capsys):
    import io

    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(generate_scan(11))))
    assert main(["--config", str(CONFIG_PATH), "-"]) == 0
    assert json.loads(capsys.readouterr().out)["bin_index"] >= 1


def test_cli_reports_a_bad_payload(tmp_path, capsys):
    infile = tmp_path / "bad.json"
    infile.write_text('{"models": {}}', encoding="utf-8")

    assert main(["--config", str(CONFIG_PATH), str(infile)]) == 1
    assert "scan_id" in capsys.readouterr().err


def test_cli_reports_a_missing_config(tmp_path, capsys):
    infile = tmp_path / "scan.json"
    infile.write_text(json.dumps(generate_scan(1)), encoding="utf-8")

    assert main(["--config", str(tmp_path / "nope.toml"), str(infile)]) == 2
    assert "cannot read" in capsys.readouterr().err


def test_cli_explain_prints_the_trace(tmp_path, capsys):
    infile = tmp_path / "scan.json"
    infile.write_text(json.dumps(generate_scan(3)), encoding="utf-8")

    assert main(["--config", str(CONFIG_PATH), "--explain", str(infile)]) == 0
    err = capsys.readouterr().err
    assert "confidence_gate" in err
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd MyTasks/model5_fusion && python -m pytest tests/test_cli.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'fusion.cli'`

- [ ] **Step 3: Implement the mock models**

`MyTasks/model5_fusion/stubs/__init__.py`:

```python
"""Stand-ins for Models 2-4 while teammates finish them."""
```

`MyTasks/model5_fusion/stubs/mock_models.py`:

```python
"""Fake Models 1-4 that emit contract-valid payloads.

Lets the whole fusion path be demonstrated end to end before a single
mango is photographed. Deterministic per seed so tests can rely on it.
"""

from __future__ import annotations

import argparse
import json
import random
import sys

from fusion.vocab import COLORS, DISEASES, SIZES, VARIETIES


def generate_scan(seed: int, declared_variety: str = "Carabao") -> dict:
    rng = random.Random(seed)

    # Mostly healthy, unbruised fruit - roughly what a real line sees.
    disease = rng.choices(DISEASES, weights=[80, 12, 8])[0]
    is_bruised = rng.random() < 0.15
    # The declared variety dominates, with occasional mis-sorts to exercise
    # the QC alert path.
    variety = declared_variety if rng.random() < 0.9 else rng.choice(VARIETIES)

    def confidence() -> float:
        return round(rng.uniform(0.55, 0.99), 4)

    return {
        "scan_id": f"mock-{seed:06d}",
        "captured_at": "2026-08-23T10:15:00+08:00",
        "declared_variety": declared_variety,
        "models": {
            "variety": {"label": variety, "confidence": confidence()},
            "disease": {"label": disease, "confidence": confidence()},
            "bruise": {"is_bruised": is_bruised, "confidence": confidence()},
            "color": {"label": rng.choice(COLORS), "confidence": confidence()},
            "size": {
                "label": rng.choice(SIZES),
                "grams": round(rng.uniform(120.0, 520.0), 1),
                "confidence": confidence(),
            },
        },
    }


def generate_batch(
    count: int, seed: int = 42, declared_variety: str = "Carabao"
) -> list[dict]:
    return [generate_scan(seed + i, declared_variety) for i in range(count)]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Emit contract-valid mock scans for Models 1-4."
    )
    parser.add_argument("--count", type=int, default=10)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--declared-variety", default="Carabao")
    args = parser.parse_args(argv)

    json.dump(
        generate_batch(args.count, args.seed, args.declared_variety),
        sys.stdout,
        indent=2,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Implement the CLI**

`MyTasks/model5_fusion/fusion/cli.py`:

```python
"""Run the fusion engine over a JSON file or stdin.

    python -m stubs.mock_models --count 20 | python -m fusion.cli -

Exit codes: 0 routed, 1 bad payload, 2 bad config.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from fusion.config import ConfigError, RoutingConfig
from fusion.contracts import ContractError, ScanInput
from fusion.engine import decide

DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / "config" / "routing.toml"


def _read(source: str) -> str:
    if source == "-":
        return sys.stdin.read()
    return Path(source).read_text(encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="MangoScan Model 5 - fuse model outputs into a bin assignment."
    )
    parser.add_argument("input", help="JSON file with one scan or an array of scans; '-' for stdin")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument(
        "--explain",
        action="store_true",
        help="print the decision trace to stderr",
    )
    args = parser.parse_args(argv)

    try:
        config = RoutingConfig.load(args.config)
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2

    try:
        raw = _read(args.input)
    except OSError as exc:
        print(f"cannot read input: {exc}", file=sys.stderr)
        return 1

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"input is not valid JSON: {exc}", file=sys.stderr)
        return 1

    payloads = payload if isinstance(payload, list) else [payload]
    decisions = []
    try:
        for item in payloads:
            decision = decide(ScanInput.from_dict(item), config)
            decisions.append(decision)
            if args.explain:
                print(f"--- {decision.scan_id} -> bin {decision.bin_index} "
                      f"({decision.bin_name})", file=sys.stderr)
                for step in decision.decision_trace:
                    print(f"    {step.step:<16} {step.result:<8} {step.detail}",
                          file=sys.stderr)
                if decision.alerts:
                    print(f"    alerts: {', '.join(decision.alerts)}", file=sys.stderr)
    except ContractError as exc:
        print(f"contract error: {exc}", file=sys.stderr)
        return 1
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2

    out = [d.to_dict() for d in decisions]
    json.dump(out if isinstance(payload, list) else out[0], sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Run the full suite to verify it passes**

Run: `cd MyTasks/model5_fusion && python -m pytest -q`
Expected: PASS — every test green.

- [ ] **Step 6: Verify the end-to-end demo works**

Run: `cd MyTasks/model5_fusion && python -m stubs.mock_models --count 20 | python -m fusion.cli --explain -`
Expected: 20 decisions on stdout, traces on stderr, exit 0. **Model 5 is now complete and demonstrable.**

- [ ] **Step 7: Commit**

```bash
git add MyTasks/model5_fusion
git commit -m "feat(model5): CLI and mock models 2-4 for end-to-end demo"
```

---

## Task 5: Model 1 pure core — class vocabulary and fruit-grouped dataset split

**Files:**
- Create: `MyTasks/model1_variety/pyproject.toml`
- Create: `MyTasks/model1_variety/mango_variety/__init__.py`
- Create: `MyTasks/model1_variety/mango_variety/classes.py`
- Create: `MyTasks/model1_variety/mango_variety/dataset.py`
- Test: `MyTasks/model1_variety/tests/test_classes.py`
- Test: `MyTasks/model1_variety/tests/test_dataset.py`

**Interfaces:**
- Consumes: nothing (must not import third-party packages).
- Produces:
  - `mango_variety.classes.CLASSES: tuple[str, ...]` — the 6 canonical labels
  - `mango_variety.classes.to_dirname(label: str) -> str` / `from_dirname(name: str) -> str`
  - `mango_variety.classes.class_index(label: str) -> int`
  - `mango_variety.classes.UnknownClassError(ValueError)`
  - `mango_variety.dataset.DEFAULT_FRUIT_PATTERN: str`
  - `mango_variety.dataset.fruit_id_for(filename: str, pattern: str = DEFAULT_FRUIT_PATTERN) -> str`
  - `mango_variety.dataset.group_by_fruit(filenames: Sequence[str], pattern: str = ...) -> dict[str, list[str]]`
  - `mango_variety.dataset.split_groups(groups: Mapping[str, list[str]], ratios=(0.7,0.15,0.15), seed=42) -> dict[str, list[str]]` returning `{"train": [...], "val": [...], "test": [...]}` of **fruit ids**
  - `mango_variety.dataset.assert_no_leakage(assignment: Mapping[str, Sequence[str]]) -> None`
  - `mango_variety.dataset.LeakageError(AssertionError)`

- [ ] **Step 1: Create the scaffold**

`MyTasks/model1_variety/pyproject.toml`:

```toml
[project]
name = "mangoscan-model1"
version = "1.0.0"
description = "MangoScan Model 1 - mango variety classification"
requires-python = ">=3.11"
dependencies = []

[project.optional-dependencies]
dev = ["pytest>=7.0"]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

`MyTasks/model1_variety/mango_variety/__init__.py`:

```python
"""Model 1 pure core.

Nothing in this package may import a third-party module. It runs on the
developer's local Python 3.14, where PyTorch and Ultralytics wheels do
not exist - that is the whole point of the split. Anything needing a GPU
lives in `scripts/`, which only ever runs on Colab.
"""

__version__ = "1.0.0"
```

- [ ] **Step 2: Write the failing class-vocabulary tests**

`MyTasks/model1_variety/tests/test_classes.py`:

```python
import pytest

from mango_variety.classes import (
    CLASSES,
    UnknownClassError,
    class_index,
    from_dirname,
    to_dirname,
)


def test_six_canonical_classes_in_a_fixed_order():
    assert CLASSES == (
        "Carabao",
        "Apple Mango",
        "Indian",
        "Chupadera",
        "Wani",
        "Kabayo",
    )


def test_it_is_wani_not_wanni():
    """Guards the DB spelling. A rename here breaks the Supabase FK."""
    assert "Wani" in CLASSES
    assert "Wanni" not in CLASSES


@pytest.mark.parametrize("label", CLASSES)
def test_dirname_round_trip(label):
    assert from_dirname(to_dirname(label)) == label


def test_spaces_become_underscores():
    assert to_dirname("Apple Mango") == "Apple_Mango"


def test_class_index_matches_position():
    assert class_index("Carabao") == 0
    assert class_index("Kabayo") == 5


def test_unknown_label_raises():
    with pytest.raises(UnknownClassError):
        class_index("Alphonso")


def test_unknown_dirname_raises():
    with pytest.raises(UnknownClassError):
        from_dirname("Alphonso")
```

- [ ] **Step 3: Run to verify failure**

Run: `cd MyTasks/model1_variety && python -m pytest tests/test_classes.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'mango_variety.classes'`

- [ ] **Step 4: Implement `classes.py`**

`MyTasks/model1_variety/mango_variety/classes.py`:

```python
"""The six variety labels, and the on-disk directory names they map to.

Order is significant: it defines the class index the trained model emits,
so reordering this tuple silently invalidates every existing checkpoint.
"""

from __future__ import annotations


class UnknownClassError(ValueError):
    """A label or directory name is not one of the six known varieties."""


#: Must match `mango_varieties.variety_name` in Supabase, exactly.
CLASSES: tuple[str, ...] = (
    "Carabao",
    "Apple Mango",
    "Indian",
    "Chupadera",
    "Wani",
    "Kabayo",
)


def to_dirname(label: str) -> str:
    """`'Apple Mango'` -> `'Apple_Mango'`. Spaces in paths invite quoting bugs."""
    if label not in CLASSES:
        raise UnknownClassError(f"{label!r} is not a known variety")
    return label.replace(" ", "_")


def from_dirname(name: str) -> str:
    """`'Apple_Mango'` -> `'Apple Mango'`."""
    label = name.replace("_", " ")
    if label not in CLASSES:
        raise UnknownClassError(f"directory {name!r} is not a known variety")
    return label


def class_index(label: str) -> int:
    try:
        return CLASSES.index(label)
    except ValueError as exc:
        raise UnknownClassError(f"{label!r} is not a known variety") from exc
```

- [ ] **Step 5: Write the failing dataset-split tests**

`MyTasks/model1_variety/tests/test_dataset.py`:

```python
import pytest

from mango_variety.dataset import (
    LeakageError,
    assert_no_leakage,
    fruit_id_for,
    group_by_fruit,
    split_groups,
)


@pytest.mark.parametrize(
    "filename,expected",
    [
        ("carabao_001_v1.jpg", "carabao_001"),
        ("carabao_001_v5.jpg", "carabao_001"),
        ("wani_042_v3.png", "wani_042"),
        ("apple_mango_007_v2.jpeg", "apple_mango_007"),
    ],
)
def test_fruit_id_strips_the_view_suffix(filename, expected):
    assert fruit_id_for(filename) == expected


def test_filename_without_a_view_suffix_is_its_own_fruit():
    assert fruit_id_for("scraped_image_88.jpg") == "scraped_image_88"


def test_group_by_fruit_collects_all_views():
    files = [
        "carabao_001_v1.jpg",
        "carabao_001_v2.jpg",
        "carabao_001_v3.jpg",
        "carabao_002_v1.jpg",
    ]
    groups = group_by_fruit(files)
    assert set(groups) == {"carabao_001", "carabao_002"}
    assert len(groups["carabao_001"]) == 3


def test_split_is_deterministic_for_a_seed():
    groups = {f"fruit_{i:03d}": [f"fruit_{i:03d}_v1.jpg"] for i in range(100)}
    assert split_groups(groups, seed=7) == split_groups(groups, seed=7)


def test_split_differs_across_seeds():
    groups = {f"fruit_{i:03d}": [f"fruit_{i:03d}_v1.jpg"] for i in range(100)}
    assert split_groups(groups, seed=1) != split_groups(groups, seed=2)


def test_split_respects_ratios():
    groups = {f"fruit_{i:03d}": [] for i in range(100)}
    result = split_groups(groups, ratios=(0.7, 0.15, 0.15), seed=42)
    assert len(result["train"]) == 70
    assert len(result["val"]) == 15
    assert len(result["test"]) == 15


def test_split_assigns_every_fruit_exactly_once():
    groups = {f"fruit_{i:03d}": [] for i in range(37)}
    result = split_groups(groups, seed=3)
    everything = result["train"] + result["val"] + result["test"]
    assert sorted(everything) == sorted(groups)
    assert len(everything) == len(set(everything))


def test_no_fruit_appears_in_two_splits():
    """The leakage guard. Five views of one mango across train and test
    inflate accuracy dramatically and invalidate the whole evaluation."""
    groups = {f"fruit_{i:03d}": [] for i in range(60)}
    result = split_groups(groups, seed=11)
    assert_no_leakage(result)  # must not raise


def test_leakage_is_detected():
    bad = {"train": ["fruit_a", "fruit_b"], "val": ["fruit_b"], "test": ["fruit_c"]}
    with pytest.raises(LeakageError, match="fruit_b"):
        assert_no_leakage(bad)


def test_tiny_dataset_still_populates_val_and_test():
    """With 5 fruits, naive rounding gives val/test zero. That silently
    produces an unmeasurable model, so each split gets at least one."""
    groups = {f"fruit_{i}": [] for i in range(5)}
    result = split_groups(groups, seed=1)
    assert len(result["val"]) >= 1
    assert len(result["test"]) >= 1
    assert len(result["train"]) >= 1


def test_ratios_must_sum_to_one():
    with pytest.raises(ValueError, match="sum to 1"):
        split_groups({"a": []}, ratios=(0.5, 0.2, 0.2))


def test_fewer_than_three_fruits_is_an_error():
    with pytest.raises(ValueError, match="at least 3"):
        split_groups({"a": [], "b": []}, seed=1)
```

- [ ] **Step 6: Run to verify failure**

Run: `cd MyTasks/model1_variety && python -m pytest tests/test_dataset.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'mango_variety.dataset'`

- [ ] **Step 7: Implement `dataset.py`**

`MyTasks/model1_variety/mango_variety/dataset.py`:

```python
"""Splitting images into train/val/test by *physical fruit*.

This is the single most important correctness constraint in the whole
pipeline. The rig shoots five views of every mango. Splitting by image
puts views 1-3 of a fruit in train and views 4-5 in test, so the model
is graded on mangoes it has already memorised. Reported accuracy climbs,
real-world accuracy does not, and the error is invisible in every metric
you would normally look at.

So: fruits are grouped first, and whole groups move together.
"""

from __future__ import annotations

import random
import re
from collections import defaultdict
from collections.abc import Mapping, Sequence

#: Captures everything before a trailing `_v<digits>` view marker.
#: `carabao_001_v3.jpg` -> `carabao_001`
DEFAULT_FRUIT_PATTERN = r"^(?P<fruit>.+?)_v\d+$"

SPLIT_NAMES = ("train", "val", "test")


class LeakageError(AssertionError):
    """The same physical fruit landed in more than one split."""


def fruit_id_for(filename: str, pattern: str = DEFAULT_FRUIT_PATTERN) -> str:
    """Derive a fruit id from a filename.

    A filename with no view marker is treated as its own single-view
    fruit, which is the right behaviour for scraped web images.
    """
    stem = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    stem = stem.rsplit(".", 1)[0]
    match = re.match(pattern, stem)
    if match:
        return match.group("fruit")
    return stem


def group_by_fruit(
    filenames: Sequence[str], pattern: str = DEFAULT_FRUIT_PATTERN
) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = defaultdict(list)
    for name in filenames:
        groups[fruit_id_for(name, pattern)].append(name)
    return {k: sorted(v) for k, v in sorted(groups.items())}


def split_groups(
    groups: Mapping[str, list[str]],
    ratios: tuple[float, float, float] = (0.7, 0.15, 0.15),
    seed: int = 42,
) -> dict[str, list[str]]:
    """Assign fruit ids to train/val/test. Returns ids, not filenames."""
    if abs(sum(ratios) - 1.0) > 1e-9:
        raise ValueError(f"ratios must sum to 1, got {sum(ratios)}")

    fruit_ids = sorted(groups)
    total = len(fruit_ids)
    if total < 3:
        raise ValueError(
            f"need at least 3 fruits to populate three splits, got {total}"
        )

    rng = random.Random(seed)
    shuffled = fruit_ids[:]
    rng.shuffle(shuffled)

    n_val = max(1, round(total * ratios[1]))
    n_test = max(1, round(total * ratios[2]))
    if n_val + n_test >= total:
        n_val = n_test = 1
    n_train = total - n_val - n_test

    return {
        "train": sorted(shuffled[:n_train]),
        "val": sorted(shuffled[n_train : n_train + n_val]),
        "test": sorted(shuffled[n_train + n_val :]),
    }


def assert_no_leakage(assignment: Mapping[str, Sequence[str]]) -> None:
    seen: dict[str, str] = {}
    for split in SPLIT_NAMES:
        for fruit_id in assignment.get(split, ()):
            if fruit_id in seen:
                raise LeakageError(
                    f"fruit {fruit_id!r} appears in both "
                    f"{seen[fruit_id]!r} and {split!r}"
                )
            seen[fruit_id] = split
```

- [ ] **Step 8: Run to verify passing**

Run: `cd MyTasks/model1_variety && python -m pytest -q`
Expected: PASS — all class and dataset tests green.

- [ ] **Step 9: Commit**

```bash
git add MyTasks/model1_variety
git commit -m "feat(model1): class vocabulary and leak-proof fruit-grouped dataset split"
```

---

## Task 6: Model 1 pure core — multi-view aggregation and metrics

**Files:**
- Create: `MyTasks/model1_variety/mango_variety/aggregate.py`
- Create: `MyTasks/model1_variety/mango_variety/metrics.py`
- Test: `MyTasks/model1_variety/tests/test_aggregate.py`
- Test: `MyTasks/model1_variety/tests/test_metrics.py`

**Interfaces:**
- Consumes: `mango_variety.classes.CLASSES` (Task 5).
- Produces:
  - `mango_variety.aggregate.AggregationError(ValueError)`
  - `mango_variety.aggregate.mean_softmax(views: Sequence[Sequence[float]]) -> list[float]`
  - `mango_variety.aggregate.aggregate_views(views, classes=CLASSES) -> tuple[str, float, dict[str, float]]` returning `(label, confidence, probabilities)`
  - `mango_variety.aggregate.to_contract(scan_id, label, confidence, probabilities, per_view, declared_variety=None) -> dict` — a Model 1 payload matching Task 2's `ScanInput` contract
  - `mango_variety.metrics.confusion_matrix(y_true, y_pred, classes) -> list[list[int]]`
  - `mango_variety.metrics.per_class_report(cm, classes) -> dict[str, dict[str, float]]`
  - `mango_variety.metrics.macro_average(report) -> dict[str, float]`
  - `mango_variety.metrics.weighted_average(report) -> dict[str, float]`
  - `mango_variety.metrics.top_k_accuracy(probabilities, y_true, classes, k) -> float`
  - `mango_variety.metrics.expected_calibration_error(confidences, correct, n_bins=10) -> float`
  - `mango_variety.metrics.reliability_bins(confidences, correct, n_bins=10) -> list[dict]`

- [ ] **Step 1: Write the failing aggregation tests**

`MyTasks/model1_variety/tests/test_aggregate.py`:

```python
import pytest

from mango_variety.aggregate import (
    AggregationError,
    aggregate_views,
    mean_softmax,
    to_contract,
)
from mango_variety.classes import CLASSES


def test_mean_of_identical_views_is_that_view():
    view = [0.7, 0.1, 0.1, 0.05, 0.03, 0.02]
    assert mean_softmax([view, view, view]) == pytest.approx(view)


def test_mean_averages_elementwise():
    a = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    b = [0.0, 1.0, 0.0, 0.0, 0.0, 0.0]
    assert mean_softmax([a, b]) == pytest.approx([0.5, 0.5, 0.0, 0.0, 0.0, 0.0])


def test_result_sums_to_one():
    views = [
        [0.5, 0.2, 0.1, 0.1, 0.05, 0.05],
        [0.1, 0.6, 0.1, 0.1, 0.05, 0.05],
    ]
    assert sum(mean_softmax(views)) == pytest.approx(1.0)


def test_one_confident_dissenter_does_not_flip_four_agreeing_views():
    """The case majority vote gets wrong in the other direction, and the
    reason mean-of-softmax was chosen over voting."""
    carabao = [0.80, 0.05, 0.05, 0.04, 0.03, 0.03]
    indian = [0.05, 0.05, 0.80, 0.04, 0.03, 0.03]
    label, confidence, _ = aggregate_views([carabao] * 4 + [indian])
    assert label == "Carabao"
    assert 0.6 < confidence < 0.7


def test_aggregate_returns_label_confidence_and_probabilities():
    views = [[0.9, 0.02, 0.02, 0.02, 0.02, 0.02]]
    label, confidence, probabilities = aggregate_views(views)
    assert label == "Carabao"
    assert confidence == pytest.approx(0.9)
    assert set(probabilities) == set(CLASSES)


def test_works_with_fewer_than_five_views():
    """Blurred or dropped frames must degrade gracefully, not crash."""
    views = [[0.9, 0.02, 0.02, 0.02, 0.02, 0.02]] * 3
    label, _, _ = aggregate_views(views)
    assert label == "Carabao"


def test_empty_views_is_an_error():
    with pytest.raises(AggregationError, match="at least one"):
        aggregate_views([])


def test_ragged_views_are_an_error():
    with pytest.raises(AggregationError, match="same length"):
        mean_softmax([[0.5, 0.5], [0.3, 0.3, 0.4]])


def test_view_length_must_match_class_count():
    with pytest.raises(AggregationError, match="6 classes"):
        aggregate_views([[0.5, 0.5]])


def test_view_not_summing_to_one_is_an_error():
    with pytest.raises(AggregationError, match="sum to 1"):
        aggregate_views([[0.5, 0.1, 0.1, 0.1, 0.1, 0.0]])


def test_negative_probability_is_an_error():
    with pytest.raises(AggregationError, match="negative"):
        aggregate_views([[-0.1, 0.3, 0.3, 0.2, 0.2, 0.1]])


def test_to_contract_matches_the_model5_input_shape():
    views = [[0.9, 0.02, 0.02, 0.02, 0.02, 0.02]] * 5
    label, confidence, probabilities = aggregate_views(views)
    payload = to_contract(
        scan_id="scan-1",
        label=label,
        confidence=confidence,
        probabilities=probabilities,
        per_view=[(i + 1, "Carabao", 0.9) for i in range(5)],
        declared_variety="Carabao",
    )
    assert payload["scan_id"] == "scan-1"
    assert payload["declared_variety"] == "Carabao"
    variety = payload["models"]["variety"]
    assert variety["label"] == "Carabao"
    assert len(variety["per_view"]) == 5
    assert variety["per_view"][0] == {
        "angle_sequence": 1,
        "label": "Carabao",
        "confidence": 0.9,
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cd MyTasks/model1_variety && python -m pytest tests/test_aggregate.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'mango_variety.aggregate'`

- [ ] **Step 3: Implement `aggregate.py`**

`MyTasks/model1_variety/mango_variety/aggregate.py`:

```python
"""Fusing five camera views of one mango into a single prediction.

Mean-of-softmax, not majority vote. Voting throws away per-view certainty
and yields a confidence quantised to k/5, which is useless as input to
Model 5's threshold gate. Averaging the distributions keeps a continuous,
calibratable score and handles the common "four sharp views plus one
blurred one" case correctly.
"""

from __future__ import annotations

from collections.abc import Sequence

from mango_variety.classes import CLASSES

#: Softmax vectors rarely sum to exactly 1.0 in float32.
_SUM_TOLERANCE = 1e-3


class AggregationError(ValueError):
    """The per-view probability vectors are malformed."""


def mean_softmax(views: Sequence[Sequence[float]]) -> list[float]:
    if not views:
        raise AggregationError("need at least one view to aggregate")
    width = len(views[0])
    if any(len(v) != width for v in views):
        raise AggregationError("all views must have the same length")
    return [sum(v[i] for v in views) / len(views) for i in range(width)]


def aggregate_views(
    views: Sequence[Sequence[float]],
    classes: Sequence[str] = CLASSES,
) -> tuple[str, float, dict[str, float]]:
    """Return `(label, confidence, probabilities)` for one mango."""
    if not views:
        raise AggregationError("need at least one view to aggregate")

    for index, view in enumerate(views):
        if len(view) != len(classes):
            raise AggregationError(
                f"view {index} has {len(view)} entries, expected "
                f"{len(classes)} classes"
            )
        if any(p < 0 for p in view):
            raise AggregationError(f"view {index} contains a negative probability")
        if abs(sum(view) - 1.0) > _SUM_TOLERANCE:
            raise AggregationError(
                f"view {index} probabilities sum to {sum(view)}, expected 1"
            )

    averaged = mean_softmax(views)
    best = max(range(len(averaged)), key=averaged.__getitem__)
    probabilities = {classes[i]: averaged[i] for i in range(len(classes))}
    return classes[best], averaged[best], probabilities


def to_contract(
    scan_id: str,
    label: str,
    confidence: float,
    probabilities: dict[str, float],
    per_view: Sequence[tuple[int, str, float]],
    declared_variety: str | None = None,
    captured_at: str | None = None,
) -> dict:
    """Emit a Model 1 payload in the shape Model 5 consumes.

    `per_view` entries are `(angle_sequence, label, confidence)`.
    """
    return {
        "scan_id": scan_id,
        "captured_at": captured_at,
        "declared_variety": declared_variety,
        "models": {
            "variety": {
                "label": label,
                "confidence": round(float(confidence), 6),
                "probabilities": {
                    k: round(float(v), 6) for k, v in probabilities.items()
                },
                "per_view": [
                    {
                        "angle_sequence": int(angle),
                        "label": view_label,
                        "confidence": round(float(view_conf), 6),
                    }
                    for angle, view_label, view_conf in per_view
                ],
            }
        },
    }
```

- [ ] **Step 4: Write the failing metrics tests**

`MyTasks/model1_variety/tests/test_metrics.py`:

```python
import pytest

from mango_variety.metrics import (
    confusion_matrix,
    expected_calibration_error,
    macro_average,
    per_class_report,
    reliability_bins,
    top_k_accuracy,
    weighted_average,
)

CLASSES = ["A", "B", "C"]


def test_perfect_predictions_give_a_diagonal_matrix():
    cm = confusion_matrix(["A", "B", "C"], ["A", "B", "C"], CLASSES)
    assert cm == [[1, 0, 0], [0, 1, 0], [0, 0, 1]]


def test_confusion_matrix_rows_are_truth():
    cm = confusion_matrix(["A", "A"], ["A", "B"], CLASSES)
    assert cm[0] == [1, 1, 0]


def test_mismatched_lengths_are_an_error():
    with pytest.raises(ValueError, match="same length"):
        confusion_matrix(["A"], ["A", "B"], CLASSES)


def test_per_class_report_on_a_perfect_matrix():
    cm = [[2, 0, 0], [0, 2, 0], [0, 0, 2]]
    report = per_class_report(cm, CLASSES)
    for label in CLASSES:
        assert report[label]["precision"] == 1.0
        assert report[label]["recall"] == 1.0
        assert report[label]["f1"] == 1.0
        assert report[label]["support"] == 2


def test_per_class_report_handles_a_never_predicted_class():
    """Precision is 0/0 for a class the model never predicts. It must be
    reported as 0.0, not raise."""
    cm = [[2, 0, 0], [2, 0, 0], [0, 0, 2]]
    report = per_class_report(cm, CLASSES)
    assert report["B"]["precision"] == 0.0
    assert report["B"]["recall"] == 0.0
    assert report["B"]["f1"] == 0.0


def test_macro_average_ignores_support():
    cm = [[10, 0, 0], [0, 1, 0], [0, 0, 1]]
    macro = macro_average(per_class_report(cm, CLASSES))
    assert macro["f1"] == pytest.approx(1.0)


def test_weighted_average_respects_support():
    cm = [[8, 2, 0], [0, 1, 0], [0, 0, 1]]
    report = per_class_report(cm, CLASSES)
    weighted = weighted_average(report)
    macro = macro_average(report)
    assert weighted["recall"] != macro["recall"]


def test_top_k_accuracy():
    probabilities = [
        {"A": 0.5, "B": 0.3, "C": 0.2},   # true C, rank 3
        {"A": 0.2, "B": 0.5, "C": 0.3},   # true C, rank 2
    ]
    assert top_k_accuracy(probabilities, ["C", "C"], CLASSES, k=1) == 0.0
    assert top_k_accuracy(probabilities, ["C", "C"], CLASSES, k=2) == 0.5
    assert top_k_accuracy(probabilities, ["C", "C"], CLASSES, k=3) == 1.0


def test_perfectly_calibrated_model_has_zero_ece():
    confidences = [1.0] * 10
    correct = [True] * 10
    assert expected_calibration_error(confidences, correct) == pytest.approx(0.0)


def test_overconfident_model_has_high_ece():
    """Claims 100% certainty, is right half the time."""
    confidences = [1.0] * 10
    correct = [True] * 5 + [False] * 5
    assert expected_calibration_error(confidences, correct) == pytest.approx(0.5)


def test_ece_is_between_zero_and_one():
    confidences = [0.1, 0.4, 0.55, 0.7, 0.9, 0.95]
    correct = [False, True, False, True, True, True]
    assert 0.0 <= expected_calibration_error(confidences, correct) <= 1.0


def test_ece_rejects_mismatched_inputs():
    with pytest.raises(ValueError, match="same length"):
        expected_calibration_error([0.5], [True, False])


def test_reliability_bins_cover_the_unit_interval():
    bins = reliability_bins([0.05, 0.5, 0.95], [True, False, True], n_bins=10)
    assert len(bins) == 10
    assert bins[0]["lower"] == pytest.approx(0.0)
    assert bins[-1]["upper"] == pytest.approx(1.0)
    assert sum(b["count"] for b in bins) == 3


def test_empty_bins_report_zero_count():
    bins = reliability_bins([0.95], [True], n_bins=10)
    assert bins[0]["count"] == 0
    assert bins[9]["count"] == 1
```

- [ ] **Step 5: Run to verify failure**

Run: `cd MyTasks/model1_variety && python -m pytest tests/test_metrics.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'mango_variety.metrics'`

- [ ] **Step 6: Implement `metrics.py`**

`MyTasks/model1_variety/mango_variety/metrics.py`:

```python
"""Classification metrics, in stdlib.

Reimplemented rather than pulled from scikit-learn for one reason: this
package has to run on the developer's local Python 3.14, where the
scientific stack has no wheels. The formulas are the standard ones.

Calibration matters more here than in a typical classifier. Model 5 gates
on Model 1's confidence, so an overconfident model does not merely report
a wrong number - it routes fruit into the wrong bin.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence


def confusion_matrix(
    y_true: Sequence[str], y_pred: Sequence[str], classes: Sequence[str]
) -> list[list[int]]:
    """Rows are ground truth, columns are predictions."""
    if len(y_true) != len(y_pred):
        raise ValueError("y_true and y_pred must have the same length")
    index = {label: i for i, label in enumerate(classes)}
    size = len(classes)
    matrix = [[0] * size for _ in range(size)]
    for truth, prediction in zip(y_true, y_pred):
        if truth not in index:
            raise ValueError(f"unknown true label {truth!r}")
        if prediction not in index:
            raise ValueError(f"unknown predicted label {prediction!r}")
        matrix[index[truth]][index[prediction]] += 1
    return matrix


def per_class_report(
    cm: Sequence[Sequence[int]], classes: Sequence[str]
) -> dict[str, dict[str, float]]:
    report: dict[str, dict[str, float]] = {}
    for i, label in enumerate(classes):
        true_positive = cm[i][i]
        predicted = sum(cm[r][i] for r in range(len(classes)))
        actual = sum(cm[i])
        precision = true_positive / predicted if predicted else 0.0
        recall = true_positive / actual if actual else 0.0
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall)
            else 0.0
        )
        report[label] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "support": actual,
        }
    return report


def macro_average(report: Mapping[str, Mapping[str, float]]) -> dict[str, float]:
    n = len(report) or 1
    return {
        metric: sum(row[metric] for row in report.values()) / n
        for metric in ("precision", "recall", "f1")
    }


def weighted_average(report: Mapping[str, Mapping[str, float]]) -> dict[str, float]:
    total = sum(row["support"] for row in report.values())
    if not total:
        return {"precision": 0.0, "recall": 0.0, "f1": 0.0}
    return {
        metric: sum(row[metric] * row["support"] for row in report.values()) / total
        for metric in ("precision", "recall", "f1")
    }


def top_k_accuracy(
    probabilities: Sequence[Mapping[str, float]],
    y_true: Sequence[str],
    classes: Sequence[str],
    k: int,
) -> float:
    if len(probabilities) != len(y_true):
        raise ValueError("probabilities and y_true must have the same length")
    if not y_true:
        return 0.0
    hits = 0
    for row, truth in zip(probabilities, y_true):
        ranked = sorted(classes, key=lambda c: row.get(c, 0.0), reverse=True)
        if truth in ranked[:k]:
            hits += 1
    return hits / len(y_true)


def reliability_bins(
    confidences: Sequence[float], correct: Sequence[bool], n_bins: int = 10
) -> list[dict]:
    """Equal-width confidence bins with observed accuracy in each."""
    if len(confidences) != len(correct):
        raise ValueError("confidences and correct must have the same length")
    if n_bins < 1:
        raise ValueError("n_bins must be at least 1")

    bins = [
        {
            "lower": i / n_bins,
            "upper": (i + 1) / n_bins,
            "count": 0,
            "accuracy": 0.0,
            "avg_confidence": 0.0,
        }
        for i in range(n_bins)
    ]
    hits = [0] * n_bins
    sums = [0.0] * n_bins

    for confidence, is_correct in zip(confidences, correct):
        # A confidence of exactly 1.0 belongs in the final bin, not a
        # nonexistent (n_bins + 1)th one.
        slot = min(int(confidence * n_bins), n_bins - 1)
        bins[slot]["count"] += 1
        hits[slot] += 1 if is_correct else 0
        sums[slot] += confidence

    for i, entry in enumerate(bins):
        if entry["count"]:
            entry["accuracy"] = hits[i] / entry["count"]
            entry["avg_confidence"] = sums[i] / entry["count"]
    return bins


def expected_calibration_error(
    confidences: Sequence[float], correct: Sequence[bool], n_bins: int = 10
) -> float:
    """Support-weighted mean gap between confidence and observed accuracy."""
    if len(confidences) != len(correct):
        raise ValueError("confidences and correct must have the same length")
    total = len(confidences)
    if not total:
        return 0.0
    return sum(
        (entry["count"] / total) * abs(entry["accuracy"] - entry["avg_confidence"])
        for entry in reliability_bins(confidences, correct, n_bins)
        if entry["count"]
    )
```

- [ ] **Step 7: Run the full suite to verify it passes**

Run: `cd MyTasks/model1_variety && python -m pytest -q`
Expected: PASS — all class, dataset, aggregation, and metrics tests green.

- [ ] **Step 8: Verify the pure core imports nothing third-party**

Run: `cd MyTasks/model1_variety && python -c "import ast,pathlib,sys; bad=[(p.name,n.module or n.names[0].name) for p in pathlib.Path('mango_variety').glob('*.py') for n in ast.walk(ast.parse(p.read_text(encoding='utf-8'))) if isinstance(n,(ast.Import,ast.ImportFrom)) for m in [(n.module or n.names[0].name).split('.')[0]] if m not in sys.stdlib_module_names and m != 'mango_variety']; print(bad or 'CLEAN')"`
Expected: `CLEAN`

- [ ] **Step 8b: Add that check as a permanent test**

Append to `MyTasks/model1_variety/tests/test_classes.py`:

```python
def test_pure_core_has_no_third_party_imports():
    """The core must keep running on local Python 3.14, where PyTorch and
    Ultralytics have no wheels. A stray `import numpy` breaks that."""
    import ast
    import pathlib
    import sys

    offenders = []
    for path in (pathlib.Path(__file__).resolve().parents[1] / "mango_variety").glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                name = node.module if isinstance(node, ast.ImportFrom) else node.names[0].name
                root = (name or "").split(".")[0]
                if root and root not in sys.stdlib_module_names and root != "mango_variety":
                    offenders.append((path.name, root))
    assert offenders == []
```

- [ ] **Step 9: Run the suite once more and commit**

Run: `cd MyTasks/model1_variety && python -m pytest -q`
Expected: PASS

```bash
git add MyTasks/model1_variety
git commit -m "feat(model1): multi-view softmax aggregation and stdlib metrics with calibration"
```

---

## Task 7: Model 1 training scripts

**Files:**
- Create: `MyTasks/model1_variety/requirements.txt`
- Create: `MyTasks/model1_variety/configs/dataset.toml`
- Create: `MyTasks/model1_variety/scripts/01_prepare_dataset.py`
- Create: `MyTasks/model1_variety/scripts/02_train.py`
- Create: `MyTasks/model1_variety/scripts/03_evaluate.py`
- Create: `MyTasks/model1_variety/scripts/04_export.py`
- Create: `MyTasks/model1_variety/scripts/05_predict_multiview.py`

**Interfaces:**
- Consumes: `mango_variety.classes`, `mango_variety.dataset`, `mango_variety.aggregate`, `mango_variety.metrics` (Tasks 5–6).
- Produces: five CLI entry points. No test file imports these — they require `ultralytics`, which only exists on Colab.

**Note on testing:** these scripts are thin wrappers; every piece of logic worth testing already lives in the pure core and is covered by Tasks 5–6. Step 7 below verifies `01_prepare_dataset.py` end-to-end against generated fixture images, which needs no ML dependency.

- [ ] **Step 1: Write the dependency and dataset config files**

`MyTasks/model1_variety/requirements.txt`:

```
# Colab / training-host only. Do NOT install these locally on Python 3.14 -
# there are no wheels. The `mango_variety` package deliberately needs none
# of this.
ultralytics>=8.3.0
torch>=2.2.0
torchvision>=0.17.0
onnx>=1.16.0
onnxruntime>=1.18.0
matplotlib>=3.8.0
```

`MyTasks/model1_variety/configs/dataset.toml`:

```toml
# Model 1 dataset + training configuration.

[paths]
# Your raw images, one directory per variety:
#   raw/Carabao/carabao_001_v1.jpg
#   raw/Apple_Mango/apple_mango_014_v3.jpg
raw_dir = "data/raw"
# Where 01_prepare_dataset.py writes the Ultralytics-layout dataset.
dataset_dir = "data/dataset"

[split]
ratios = [0.7, 0.15, 0.15]
seed = 42
# Captures the fruit id from a filename, stripping the `_v<n>` view marker.
# Every view of one physical mango MUST share a fruit id, or the split
# leaks and your accuracy numbers become fiction.
fruit_pattern = "^(?P<fruit>.+?)_v\\d+$"

[train]
model = "yolov8n-cls.pt"
imgsz = 224
epochs = 100
patience = 20
batch = 64          # drop to 16 on a 4GB local GPU
device = 0          # "cpu" if no GPU
project = "runs"
name = "model1_variety"

[augment]
fliplr = 0.5
flipud = 0.0        # mangoes are photographed upright on the rig
degrees = 15.0
# Hue jitter stays low on purpose: skin colour carries real variety signal
# in this domain, and washing it out costs accuracy.
hsv_h = 0.015
hsv_s = 0.4
hsv_v = 0.4
```

- [ ] **Step 2: Implement `01_prepare_dataset.py`**

`MyTasks/model1_variety/scripts/01_prepare_dataset.py`:

```python
"""Turn a folder of raw images into an Ultralytics classification dataset.

    python scripts/01_prepare_dataset.py --config configs/dataset.toml

Input:   data/raw/<Class_Name>/<fruit_id>_v<n>.jpg
Output:  data/dataset/{train,val,test}/<Class_Name>/*.jpg

Splits by physical fruit, never by image. See mango_variety/dataset.py for
why that distinction decides whether your accuracy numbers mean anything.

Stdlib only - runs anywhere, including local Python 3.14.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tomllib
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mango_variety.classes import CLASSES, from_dirname, to_dirname  # noqa: E402
from mango_variety.dataset import (  # noqa: E402
    assert_no_leakage,
    group_by_fruit,
    split_groups,
)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SPLITS = ("train", "val", "test")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/dataset.toml")
    parser.add_argument(
        "--dry-run", action="store_true", help="report the plan without copying"
    )
    args = parser.parse_args(argv)

    config = tomllib.loads(Path(args.config).read_text(encoding="utf-8"))
    raw_dir = Path(config["paths"]["raw_dir"])
    out_dir = Path(config["paths"]["dataset_dir"])
    ratios = tuple(config["split"]["ratios"])
    seed = int(config["split"]["seed"])
    pattern = config["split"]["fruit_pattern"]

    if not raw_dir.is_dir():
        print(f"error: {raw_dir} does not exist", file=sys.stderr)
        return 1

    if out_dir.exists() and not args.dry_run:
        shutil.rmtree(out_dir)

    totals: Counter[str] = Counter()
    problems: list[str] = []

    for label in CLASSES:
        class_dir = raw_dir / to_dirname(label)
        if not class_dir.is_dir():
            problems.append(f"missing class directory: {class_dir}")
            continue

        files = sorted(
            p.name for p in class_dir.iterdir()
            if p.suffix.lower() in IMAGE_SUFFIXES
        )
        if not files:
            problems.append(f"no images in {class_dir}")
            continue

        groups = group_by_fruit(files, pattern)
        if len(groups) < 3:
            problems.append(
                f"{label}: only {len(groups)} distinct fruits - need at least 3"
            )
            continue

        assignment = split_groups(groups, ratios=ratios, seed=seed)
        assert_no_leakage(assignment)

        print(
            f"{label:<14} {len(files):>5} images  {len(groups):>4} fruits  "
            f"train/val/test = "
            f"{len(assignment['train'])}/{len(assignment['val'])}/{len(assignment['test'])}"
        )

        for split in SPLITS:
            target = out_dir / split / to_dirname(label)
            if not args.dry_run:
                target.mkdir(parents=True, exist_ok=True)
            for fruit_id in assignment[split]:
                for filename in groups[fruit_id]:
                    totals[split] += 1
                    if not args.dry_run:
                        shutil.copy2(class_dir / filename, target / filename)

    print()
    for split in SPLITS:
        print(f"{split:<6} {totals[split]:>6} images")

    if problems:
        print("\nProblems:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    # Sanity check: no filename may appear in more than one split.
    if not args.dry_run:
        seen: dict[str, str] = {}
        for split in SPLITS:
            for path in (out_dir / split).rglob("*"):
                if path.is_file():
                    if path.name in seen:
                        print(
                            f"LEAKAGE: {path.name} in both {seen[path.name]} "
                            f"and {split}",
                            file=sys.stderr,
                        )
                        return 1
                    seen[path.name] = split
        print(f"\nOK - {len(seen)} images written to {out_dir}, no leakage.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 3: Implement `02_train.py`**

`MyTasks/model1_variety/scripts/02_train.py`:

```python
"""Train the YOLOv8-cls variety classifier.

    python scripts/02_train.py --config configs/dataset.toml

Requires ultralytics. Intended for Colab; see notebooks/.
"""

from __future__ import annotations

import argparse
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mango_variety.classes import CLASSES  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/dataset.toml")
    parser.add_argument("--epochs", type=int, default=None)
    parser.add_argument("--batch", type=int, default=None)
    parser.add_argument("--device", default=None)
    args = parser.parse_args(argv)

    config = tomllib.loads(Path(args.config).read_text(encoding="utf-8"))
    train_cfg = config["train"]
    aug_cfg = config["augment"]
    dataset_dir = Path(config["paths"]["dataset_dir"]).resolve()

    for split in ("train", "val", "test"):
        if not (dataset_dir / split).is_dir():
            print(
                f"error: {dataset_dir / split} missing - run "
                f"01_prepare_dataset.py first",
                file=sys.stderr,
            )
            return 1

    found = sorted(p.name for p in (dataset_dir / "train").iterdir() if p.is_dir())
    expected = sorted(c.replace(" ", "_") for c in CLASSES)
    if found != expected:
        print(f"error: expected classes {expected}, found {found}", file=sys.stderr)
        return 1

    from ultralytics import YOLO

    model = YOLO(train_cfg["model"])
    model.train(
        data=str(dataset_dir),
        imgsz=int(train_cfg["imgsz"]),
        epochs=int(args.epochs or train_cfg["epochs"]),
        patience=int(train_cfg["patience"]),
        batch=int(args.batch or train_cfg["batch"]),
        device=args.device if args.device is not None else train_cfg["device"],
        project=train_cfg["project"],
        name=train_cfg["name"],
        exist_ok=True,
        fliplr=float(aug_cfg["fliplr"]),
        flipud=float(aug_cfg["flipud"]),
        degrees=float(aug_cfg["degrees"]),
        hsv_h=float(aug_cfg["hsv_h"]),
        hsv_s=float(aug_cfg["hsv_s"]),
        hsv_v=float(aug_cfg["hsv_v"]),
    )

    weights = Path(train_cfg["project"]) / train_cfg["name"] / "weights" / "best.pt"
    print(f"\nBest weights: {weights}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Implement `03_evaluate.py`**

`MyTasks/model1_variety/scripts/03_evaluate.py`:

```python
"""Evaluate Model 1 on the held-out test split.

    python scripts/03_evaluate.py --weights runs/model1_variety/weights/best.pt

Writes report.json, confusion_matrix.csv, and reliability.csv next to the
weights. Reports single-view accuracy alongside 5-view aggregated
accuracy, and the calibration error Model 5's confidence gate depends on.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import tomllib
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mango_variety.aggregate import aggregate_views  # noqa: E402
from mango_variety.classes import CLASSES, from_dirname  # noqa: E402
from mango_variety.dataset import fruit_id_for  # noqa: E402
from mango_variety.metrics import (  # noqa: E402
    confusion_matrix,
    expected_calibration_error,
    macro_average,
    per_class_report,
    reliability_bins,
    top_k_accuracy,
    weighted_average,
)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/dataset.toml")
    parser.add_argument("--weights", required=True)
    parser.add_argument("--split", default="test")
    args = parser.parse_args(argv)

    config = tomllib.loads(Path(args.config).read_text(encoding="utf-8"))
    split_dir = Path(config["paths"]["dataset_dir"]) / args.split
    pattern = config["split"]["fruit_pattern"]
    out_dir = Path(args.weights).resolve().parent

    from ultralytics import YOLO

    model = YOLO(args.weights)
    model_names = [model.names[i] for i in range(len(model.names))]
    class_order = [from_dirname(n) for n in model_names]

    per_image_true: list[str] = []
    per_image_pred: list[str] = []
    per_image_probs: list[dict[str, float]] = []
    per_image_conf: list[float] = []

    # fruit_id -> (true label, [softmax vectors])
    fruits: dict[str, tuple[str, list[list[float]]]] = {}

    for class_dir in sorted(p for p in split_dir.iterdir() if p.is_dir()):
        truth = from_dirname(class_dir.name)
        images = sorted(
            p for p in class_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES
        )
        if not images:
            continue

        for result in model.predict(source=[str(p) for p in images], verbose=False):
            vector = [float(x) for x in result.probs.data.tolist()]
            probs = {class_order[i]: vector[i] for i in range(len(class_order))}
            best = max(probs, key=probs.get)
            per_image_true.append(truth)
            per_image_pred.append(best)
            per_image_probs.append(probs)
            per_image_conf.append(probs[best])

            fruit = fruit_id_for(Path(result.path).name, pattern)
            key = f"{class_dir.name}/{fruit}"
            fruits.setdefault(key, (truth, []))[1].append(
                [probs[c] for c in CLASSES]
            )

    if not per_image_true:
        print(f"error: no images found under {split_dir}", file=sys.stderr)
        return 1

    # Per-image
    image_cm = confusion_matrix(per_image_true, per_image_pred, list(CLASSES))
    image_report = per_class_report(image_cm, list(CLASSES))
    image_acc = sum(t == p for t, p in zip(per_image_true, per_image_pred)) / len(
        per_image_true
    )

    # 5-view aggregated
    fruit_true: list[str] = []
    fruit_pred: list[str] = []
    fruit_conf: list[float] = []
    fruit_probs: list[dict[str, float]] = []
    for truth, vectors in fruits.values():
        label, confidence, probabilities = aggregate_views(vectors)
        fruit_true.append(truth)
        fruit_pred.append(label)
        fruit_conf.append(confidence)
        fruit_probs.append(probabilities)

    fruit_cm = confusion_matrix(fruit_true, fruit_pred, list(CLASSES))
    fruit_report = per_class_report(fruit_cm, list(CLASSES))
    fruit_acc = sum(t == p for t, p in zip(fruit_true, fruit_pred)) / len(fruit_true)

    report = {
        "weights": str(args.weights),
        "split": args.split,
        "classes": list(CLASSES),
        "per_image": {
            "n": len(per_image_true),
            "top1_accuracy": image_acc,
            "top3_accuracy": top_k_accuracy(
                per_image_probs, per_image_true, list(CLASSES), k=3
            ),
            "per_class": image_report,
            "macro_avg": macro_average(image_report),
            "weighted_avg": weighted_average(image_report),
            "ece": expected_calibration_error(
                per_image_conf, [t == p for t, p in zip(per_image_true, per_image_pred)]
            ),
        },
        "multiview": {
            "n_fruits": len(fruit_true),
            "top1_accuracy": fruit_acc,
            "top3_accuracy": top_k_accuracy(
                fruit_probs, fruit_true, list(CLASSES), k=3
            ),
            "per_class": fruit_report,
            "macro_avg": macro_average(fruit_report),
            "weighted_avg": weighted_average(fruit_report),
            "ece": expected_calibration_error(
                fruit_conf, [t == p for t, p in zip(fruit_true, fruit_pred)]
            ),
        },
        "multiview_gain": fruit_acc - image_acc,
    }

    (out_dir / "report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )

    with (out_dir / "confusion_matrix.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["true\\pred", *CLASSES])
        for label, row in zip(CLASSES, fruit_cm):
            writer.writerow([label, *row])

    with (out_dir / "reliability.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["lower", "upper", "count", "accuracy", "avg_confidence"])
        for entry in reliability_bins(
            fruit_conf, [t == p for t, p in zip(fruit_true, fruit_pred)]
        ):
            writer.writerow(
                [
                    entry["lower"],
                    entry["upper"],
                    entry["count"],
                    entry["accuracy"],
                    entry["avg_confidence"],
                ]
            )

    print(f"per-image  top-1: {image_acc:.4f}   ECE: {report['per_image']['ece']:.4f}")
    print(f"multi-view top-1: {fruit_acc:.4f}   ECE: {report['multiview']['ece']:.4f}")
    print(f"multi-view gain : {report['multiview_gain']:+.4f}")
    print(f"\nWrote report.json, confusion_matrix.csv, reliability.csv to {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Implement `04_export.py`**

`MyTasks/model1_variety/scripts/04_export.py`:

```python
"""Export Model 1 to ONNX (and optionally TFLite), then verify parity.

    python scripts/04_export.py --weights runs/model1_variety/weights/best.pt

Parity matters: a silently-diverging export means the model you validated
is not the model that sorts fruit.
"""

from __future__ import annotations

import argparse
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/dataset.toml")
    parser.add_argument("--weights", required=True)
    parser.add_argument("--tflite", action="store_true", help="also export TFLite")
    parser.add_argument("--parity-samples", type=int, default=50)
    args = parser.parse_args(argv)

    config = tomllib.loads(Path(args.config).read_text(encoding="utf-8"))
    imgsz = int(config["train"]["imgsz"])
    test_dir = Path(config["paths"]["dataset_dir"]) / "test"

    from ultralytics import YOLO

    model = YOLO(args.weights)
    onnx_path = model.export(format="onnx", imgsz=imgsz, opset=12)
    print(f"ONNX: {onnx_path}")

    if args.tflite:
        tflite_path = model.export(format="tflite", imgsz=imgsz)
        print(f"TFLite: {tflite_path}")

    samples = sorted(
        p for p in test_dir.rglob("*") if p.suffix.lower() in IMAGE_SUFFIXES
    )[: args.parity_samples]
    if not samples:
        print("warning: no test images found, skipping parity check", file=sys.stderr)
        return 0

    exported = YOLO(str(onnx_path))
    sources = [str(p) for p in samples]
    torch_results = model.predict(source=sources, verbose=False)
    onnx_results = exported.predict(source=sources, verbose=False)

    mismatches = [
        Path(t.path).name
        for t, o in zip(torch_results, onnx_results)
        if int(t.probs.top1) != int(o.probs.top1)
    ]

    print(f"\nParity: {len(samples) - len(mismatches)}/{len(samples)} agree")
    if mismatches:
        print(f"MISMATCHES: {mismatches}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 6: Implement `05_predict_multiview.py`**

`MyTasks/model1_variety/scripts/05_predict_multiview.py`:

```python
"""Run Model 1 over one mango's five views and emit a Model 5 payload.

    python scripts/05_predict_multiview.py \
        --weights runs/model1_variety/weights/best.pt \
        --images v1.jpg v2.jpg v3.jpg v4.jpg v5.jpg \
        --scan-id scan-0001 --declared-variety Carabao

Prints JSON that fusion's CLI accepts directly:

    python scripts/05_predict_multiview.py ... > scan.json
    python -m fusion.cli scan.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mango_variety.aggregate import aggregate_views, to_contract  # noqa: E402
from mango_variety.classes import CLASSES, from_dirname  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", required=True)
    parser.add_argument("--images", nargs="+", required=True)
    parser.add_argument("--scan-id", required=True)
    parser.add_argument("--declared-variety", default=None)
    parser.add_argument("--captured-at", default=None)
    args = parser.parse_args(argv)

    if len(args.images) > 5:
        print("error: at most 5 views per mango", file=sys.stderr)
        return 1

    from ultralytics import YOLO

    model = YOLO(args.weights)
    class_order = [from_dirname(model.names[i]) for i in range(len(model.names))]

    vectors: list[list[float]] = []
    per_view: list[tuple[int, str, float]] = []

    for angle, result in enumerate(
        model.predict(source=args.images, verbose=False), start=1
    ):
        raw = [float(x) for x in result.probs.data.tolist()]
        probs = {class_order[i]: raw[i] for i in range(len(class_order))}
        vectors.append([probs[c] for c in CLASSES])
        best = max(probs, key=probs.get)
        per_view.append((angle, best, probs[best]))

    label, confidence, probabilities = aggregate_views(vectors)
    payload = to_contract(
        scan_id=args.scan_id,
        label=label,
        confidence=confidence,
        probabilities=probabilities,
        per_view=per_view,
        declared_variety=args.declared_variety,
        captured_at=args.captured_at,
    )
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 7: Verify `01_prepare_dataset.py` end-to-end on fixture images**

This needs no ML dependency. Run from `MyTasks/model1_variety`:

```bash
python - <<'PY'
from pathlib import Path
# 1x1 PNG, enough for a copy/split smoke test.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)
classes = ["Carabao", "Apple_Mango", "Indian", "Chupadera", "Wani", "Kabayo"]
for cls in classes:
    d = Path("data/raw") / cls
    d.mkdir(parents=True, exist_ok=True)
    for fruit in range(10):
        for view in range(1, 6):
            (d / f"{cls.lower()}_{fruit:03d}_v{view}.png").write_bytes(PNG)
print("fixtures written")
PY
python scripts/01_prepare_dataset.py --config configs/dataset.toml
```

Expected: a per-class table showing `50 images  10 fruits  train/val/test = 8/1/1`, then `train 240 / val 30 / test 30`, then `OK - 300 images written to data/dataset, no leakage.` Exit code 0.

- [ ] **Step 8: Clean up the fixtures and commit**

```bash
rm -rf data/
printf 'data/\nruns/\n*.onnx\n*.tflite\n__pycache__/\n' > .gitignore
git add MyTasks/model1_variety
git commit -m "feat(model1): dataset prep, training, evaluation, export, and multiview inference scripts"
```

---

## Task 8: Colab notebook

**Files:**
- Create: `MyTasks/model1_variety/notebooks/MangoScan_Model1_Colab.ipynb`

**Interfaces:**
- Consumes: the `scripts/` CLIs from Task 7.
- Produces: a runnable notebook. No code depends on it.

- [ ] **Step 1: Generate the notebook**

Write `MyTasks/model1_variety/notebooks/MangoScan_Model1_Colab.ipynb` as a JSON notebook (`nbformat: 4`, `nbformat_minor: 0`, empty `metadata.accelerator: "GPU"`) with these cells in order. Every code cell body is given verbatim; markdown cells carry the heading text shown.

1. **markdown** — `# MangoScan Model 1 — Variety Classifier\n\nTrains a 6-class YOLOv8-cls model on Colab.\n\n**Before you start:** set Runtime → Change runtime type → **T4 GPU**.\n\nYour dataset must be in Google Drive at `MyDrive/MangoScan/data/raw/<Class_Name>/<fruit_id>_v<n>.jpg`. See `docs/01-dataset-sourcing-guide.md`.`

2. **code** — verify the GPU:
```python
!nvidia-smi
```

3. **code** — mount Drive:
```python
from google.colab import drive
drive.mount('/content/drive')

import pathlib
RAW = pathlib.Path('/content/drive/MyDrive/MangoScan/data/raw')
assert RAW.is_dir(), f'Not found: {RAW}. Upload your dataset there first.'
for d in sorted(RAW.iterdir()):
    if d.is_dir():
        print(f'{d.name:<14} {len(list(d.glob("*")))} files')
```

4. **code** — install and fetch the code:
```python
!pip install -q ultralytics
!git clone -q https://github.com/mangoscan-a11y/MangoScan.git /content/MangoScan || true
%cd /content/MangoScan/MyTasks/model1_variety
!ls
```

5. **markdown** — `## 1. Prepare the dataset\n\nSplits by **physical fruit**, never by image — five views of one mango always land in the same split. Splitting by image would inflate your accuracy and invalidate the whole evaluation.`

6. **code** — point the config at Drive, then prepare:
```python
import tomllib, pathlib, re

cfg_path = pathlib.Path('configs/dataset.toml')
text = cfg_path.read_text()
text = text.replace('raw_dir = "data/raw"',
                    'raw_dir = "/content/drive/MyDrive/MangoScan/data/raw"')
text = text.replace('dataset_dir = "data/dataset"',
                    'dataset_dir = "/content/dataset"')
cfg_path.write_text(text)
print(text)
```

7. **code**:
```python
!python scripts/01_prepare_dataset.py --config configs/dataset.toml
```

8. **markdown** — `## 2. Train\n\n~100 epochs on a T4 takes roughly 15–40 minutes for a few thousand images. Watch \`val/top1_acc\`; early stopping fires after 20 epochs without improvement.`

9. **code**:
```python
!python scripts/02_train.py --config configs/dataset.toml
```

10. **markdown** — `## 3. Evaluate\n\nReports per-image accuracy, 5-view aggregated accuracy, the gain from multi-view fusion, and Expected Calibration Error. **ECE is the one to watch** — Model 5 gates routing on this model's confidence, so an overconfident classifier misroutes fruit.`

11. **code**:
```python
!python scripts/03_evaluate.py --config configs/dataset.toml \
    --weights runs/model1_variety/weights/best.pt
```

12. **code** — plot the confusion matrix and reliability diagram:
```python
import csv, json, pathlib
import matplotlib.pyplot as plt

out = pathlib.Path('runs/model1_variety/weights')
report = json.loads((out / 'report.json').read_text())
classes = report['classes']

rows = list(csv.reader((out / 'confusion_matrix.csv').open()))
matrix = [[int(v) for v in r[1:]] for r in rows[1:]]

fig, ax = plt.subplots(figsize=(7, 6))
ax.imshow(matrix, cmap='Blues')
ax.set_xticks(range(len(classes)), classes, rotation=45, ha='right')
ax.set_yticks(range(len(classes)), classes)
ax.set_xlabel('predicted'); ax.set_ylabel('true')
ax.set_title(f"Multi-view confusion — top-1 {report['multiview']['top1_accuracy']:.3f}")
for i in range(len(classes)):
    for j in range(len(classes)):
        ax.text(j, i, matrix[i][j], ha='center', va='center', fontsize=9)
plt.tight_layout(); plt.savefig(out / 'confusion_matrix.png', dpi=150); plt.show()

bins = list(csv.DictReader((out / 'reliability.csv').open()))
xs = [float(b['avg_confidence']) for b in bins if int(b['count'])]
ys = [float(b['accuracy']) for b in bins if int(b['count'])]
fig, ax = plt.subplots(figsize=(5, 5))
ax.plot([0, 1], [0, 1], '--', color='grey', label='perfect calibration')
ax.plot(xs, ys, 'o-', label='model')
ax.set_xlabel('confidence'); ax.set_ylabel('accuracy')
ax.set_title(f"Reliability — ECE {report['multiview']['ece']:.4f}")
ax.legend(); plt.tight_layout()
plt.savefig(out / 'reliability.png', dpi=150); plt.show()
```

13. **markdown** — `## 4. Export`

14. **code**:
```python
!python scripts/04_export.py --config configs/dataset.toml \
    --weights runs/model1_variety/weights/best.pt
```

15. **markdown** — `## 5. Save results back to Drive`

16. **code**:
```python
!mkdir -p /content/drive/MyDrive/MangoScan/runs
!cp -r runs/model1_variety /content/drive/MyDrive/MangoScan/runs/
print('Saved to MyDrive/MangoScan/runs/model1_variety')
```

- [ ] **Step 2: Validate the notebook is well-formed JSON**

Run: `cd MyTasks/model1_variety && python -c "import json; nb=json.load(open('notebooks/MangoScan_Model1_Colab.ipynb', encoding='utf-8')); print(nb['nbformat'], len(nb['cells']), 'cells')"`
Expected: `4 16 cells`

- [ ] **Step 3: Commit**

```bash
git add MyTasks/model1_variety/notebooks
git commit -m "feat(model1): Colab training notebook"
```

---

## Task 9: Dataset sourcing guide and capture protocol

**Files:**
- Create: `MyTasks/docs/01-dataset-sourcing-guide.md`
- Create: `MyTasks/tools/capture_protocol.md`
- Create: `MyTasks/tools/label_sheet_template.csv`

**Interfaces:**
- Consumes: the naming convention from `mango_variety.dataset.DEFAULT_FRUIT_PATTERN` (Task 5) — the guide must instruct the user to name files `<class>_<fruit>_v<n>.jpg`.
- Produces: documentation only.

- [ ] **Step 1: Research real dataset sources**

Use WebSearch to find currently-available mango image datasets. Search at minimum:
- `mango variety classification dataset Kaggle`
- `Philippine mango dataset Carabao image classification`
- `mango leaf disease dataset Mendeley` (some carry fruit images too)
- `Roboflow Universe mango classification`
- `Mangifera caesia Wani image dataset`

Record for each hit: name, URL, licence, class list, approximate image count, and **which of the six classes it actually covers**. Do not list a source without confirming it exists and is reachable. If a search returns nothing usable for Chupadera / Wani / Kabayo, say so plainly in the guide — a false lead costs the user more time than an honest gap.

- [ ] **Step 2: Write the sourcing guide**

`MyTasks/docs/01-dataset-sourcing-guide.md` must contain, in order:

1. **The blunt summary** — which of the six classes have public data and which do not, based on Step 1's findings.
2. **Public sources table** — the verified rows from Step 1: Source | URL | Licence | Classes covered | Approx. count | Notes. Include a warning that licence terms govern academic reuse and must be checked per source.
3. **Target counts** — 300 images/class minimum, 500+ ideal, and a note that a class trailing badly should be oversampled rather than reweighted.
4. **The naming convention**, stated as a hard requirement:
   ```
   data/raw/<Class_Name>/<class>_<fruit_id>_v<view>.jpg

   data/raw/Carabao/carabao_001_v1.jpg      ← fruit 001, view 1
   data/raw/Carabao/carabao_001_v2.jpg      ← same physical mango
   data/raw/Apple_Mango/apple_mango_014_v3.jpg
   ```
   with an explicit warning: **every view of one physical mango must share the `<fruit_id>`.** If two different mangoes get the same id they will be treated as one fruit; if one mango's views get different ids the split leaks and the accuracy numbers become fiction.
5. **Directory names use underscores** (`Apple_Mango`), labels use spaces (`Apple Mango`). Six directories, spelled exactly: `Carabao`, `Apple_Mango`, `Indian`, `Chupadera`, `Wani`, `Kabayo`.
6. **Web images vs rig images** — rig images match deployment lighting, background, and camera geometry, and are worth more per image. Web images are supplementary. Scraped images have no view marker, so each becomes its own single-view fruit, which is correct.
7. **A pre-flight checklist** ending with the dry-run command:
   ```bash
   cd MyTasks/model1_variety
   python scripts/01_prepare_dataset.py --config configs/dataset.toml --dry-run
   ```
   and what healthy output looks like.

- [ ] **Step 3: Write the capture protocol**

`MyTasks/tools/capture_protocol.md` must cover:

- **Five angles**, matching `scan_images.angle_sequence` 1–5: (1) stem end, (2) blossom end, (3) cheek A, (4) cheek B rotated 180°, (5) top-down. State that whatever the rig actually uses takes precedence — consistency across every mango matters more than the specific angles.
- **Lighting** — use the machine's own lighting. Shoot at the same time of day if ambient light leaks in. Never mix a phone flash with rig lighting in one class.
- **Background** — the machine's conveyor surface. A class shot on a different background teaches the model the background, and it will score beautifully in validation and fail on the line.
- **Per-class variation** — vary ripeness, size, and individual fruit. 60+ distinct physical mangoes per class × 5 views ≈ 300 images.
- **Fruit numbering** — assign each physical mango an id before shooting it, and write it on the label sheet. Reusing an id across two mangoes silently corrupts the split.
- **What to exclude** — blurred frames, frames with two mangoes, frames where the fruit is cut off. Note that Model 1 tolerates fewer than five views per fruit, so dropping a bad frame is safe.
- **Quality check** — after each class, run the dry-run command from the sourcing guide and confirm the fruit count matches how many mangoes were actually photographed.

- [ ] **Step 4: Write the label sheet template**

`MyTasks/tools/label_sheet_template.csv`:

```csv
fruit_id,variety,date_captured,views_captured,ripeness_note,size_note,defect_note,captured_by
carabao_001,Carabao,2026-08-23,5,green,medium,none,
carabao_002,Carabao,2026-08-23,5,yellow,large,minor bruise,
apple_mango_001,Apple Mango,2026-08-23,4,green,small,view 3 blurred - dropped,
```

- [ ] **Step 5: Commit**

```bash
git add MyTasks/docs/01-dataset-sourcing-guide.md MyTasks/tools
git commit -m "docs: dataset sourcing guide, capture protocol, and label sheet"
```

---

## Task 10: Training guide, teammate contract, integration guide, and README

**Files:**
- Create: `MyTasks/docs/02-model1-training-guide.md`
- Create: `MyTasks/docs/03-model5-fusion-contract.md`
- Create: `MyTasks/docs/04-integration-guide.md`
- Create: `MyTasks/README.md`

**Interfaces:**
- Consumes: everything from Tasks 1–9.
- Produces: documentation only.

- [ ] **Step 1: Write the training guide**

`MyTasks/docs/02-model1-training-guide.md` covers:

- **Why Colab, not local** — the machine has an RTX 3050 Laptop with 4 GB VRAM and Python 3.14.4, for which PyTorch and Ultralytics have no wheels. State this as the reason, so it is obvious when the constraint stops applying.
- **Upload step** — dataset to `MyDrive/MangoScan/data/raw/`, matching the layout in doc 01.
- **Notebook walkthrough** — open `notebooks/MangoScan_Model1_Colab.ipynb`, set Runtime → T4 GPU, run cells top to bottom. What each section does and roughly how long it takes.
- **Reading the results** — what `report.json` contains; that `multiview_gain` should be positive (if it is negative, the fruit ids are probably wrong and views of different mangoes are being averaged together); that ECE below ~0.05 is good and above ~0.15 means Model 5's thresholds need retuning against this model specifically.
- **Local fallback**, with exact commands, for when Colab is unavailable:
  ```bash
  py -3.12 -m venv .venv312
  .venv312\Scripts\activate
  pip install -r requirements.txt
  python scripts/02_train.py --config configs/dataset.toml --batch 16
  ```
  Note that Python 3.12 must be installed separately, and that batch 16 is the ceiling for 4 GB VRAM.
- **Troubleshooting table**: CUDA out of memory → lower `batch`; `no images in <dir>` → check directory spelling and underscores; `only N distinct fruits` → check the `_v<n>` naming; validation accuracy near 1.00 on the first epoch → almost certainly a leaked split, re-check fruit ids.

- [ ] **Step 2: Write the teammate contract sheet**

`MyTasks/docs/03-model5-fusion-contract.md` is the document handed to whoever builds Models 2–4. It must be self-contained — assume the reader has not read the spec. Include:

- **One-paragraph framing**: Model 5 consumes one JSON object per mango and returns a bin. Here is exactly what your model must emit.
- **The full input JSON**, copied verbatim from spec §5.1, with every field annotated: which are required, which optional, types, and ranges.
- **Per-model sections** — for Model 2 the exact strings `Healthy` / `Anthracnose` / `Mango Scab`; for Model 3 that `is_bruised` is a real boolean, not a string or 0/1; for Model 4 that colour is only `Green` or `Yellow` (**Overripe is gone** — the machine has no bin for it) and that size may be a label or `grams`, with grams winning when both are present.
- **Confidence must be a calibrated probability in [0, 1]**, and why: Model 5 rejects any routing dimension below its threshold, so an overconfident model routes bad fruit into the sellable stream. Point them at the ECE computation in `mango_variety/metrics.py` as a ready-made check.
- **The output JSON** they will get back, from spec §5.3.
- **The bin table** and precedence order, so they can predict what their outputs cause.
- **How to test against Model 5 today**:
  ```bash
  cd MyTasks/model5_fusion
  python -m stubs.mock_models --count 5 > sample.json    # see the expected shape
  python -m fusion.cli --explain sample.json             # see what it produces
  echo '<your model output>' | python -m fusion.cli --explain -
  ```
- **Failure modes**: an unknown label is a hard error, not a silent pass; a missing routing dimension sends the mango to the low-confidence bin.

- [ ] **Step 3: Write the integration guide**

`MyTasks/docs/04-integration-guide.md` covers:

- **Where Model 5 sits** — on the inference host between the four models and the Supabase insert. Zero dependencies, so `fusion/` can be copied next to whatever runs inference.
- **Wiring**, with the concrete command chain:
  ```bash
  python scripts/05_predict_multiview.py --weights best.pt \
      --images v1.jpg v2.jpg v3.jpg v4.jpg v5.jpg \
      --scan-id "$SCAN_ID" --declared-variety Carabao > variety.json
  # merge in models 2-4 outputs, then:
  python -m fusion.cli scan.json
  ```
- **Mapping the decision onto the database**, field by field:

  | Decision field | Destination |
  |---|---|
  | `quality_verdict` | `scan_sessions.quality_verdict` |
  | `bin_name` | `scan_sessions.bin_assigned` |
  | `servo1_action` / `servo2_action` | `sorting_logs.servo1_action` / `servo2_action` |
  | `detected_variety` | resolve to `mango_varieties.variety_id` → `scan_sessions.variety_id` |
  | per-dimension label + confidence | one `detection_result` row each (`class_type` = variety/disease/bruise/color/size) |
  | `reason_code`, `alerts`, `decision_trace` | no column exists yet — see below |

- **Required schema deltas**, flagged clearly as **WebApp work, out of scope for this task**:
  1. `ripeness_levels` currently holds Green / Turning / Ripe / Overripe. The machine now needs **Green and Yellow only**. Until this is fixed, colour writes will not resolve to a `ripeness_id`.
  2. `bin_assigned` is an unconstrained `varchar(30)`. Proposed canonical vocabulary: `GREEN_SMALL`, `GREEN_MEDIUM`, `GREEN_LARGE`, `YELLOW_SMALL`, `YELLOW_MEDIUM`, `YELLOW_LARGE`, `REJECT_DISEASED`, `REJECT_BRUISED`. A check constraint or lookup table would catch typos.
  3. No column stores `reason_code` or `alerts`. Without one, a low-confidence reject is indistinguishable from a diseased reject in the database, since both land in bin 7. Recommend adding `scan_sessions.reason_code varchar(32)` and `alerts text[]`.
  4. `declared_variety` has no source. Model 1's QC check needs an operator-set batch variety. Until it exists, pass `null` and the check is skipped — no error, but no QC either.
- **Servo addressing** — state the proposal encoded in `routing.toml` (servo1 selects group: green/yellow/diseased/bruised; servo2 selects slot: small/medium/large/park) and that **the hardware team must confirm or replace it**. The engine treats these as opaque strings, so correcting them is a config edit with no code change.

- [ ] **Step 4: Write the README**

`MyTasks/README.md` is the entry point. It must contain:

- **What this is** — Model 1 and Model 5 for MangoScan, in two sentences.
- **Status table**:

  | Component | Status | Blocked on |
  |---|---|---|
  | Model 5 fusion engine | Complete and tested | nothing |
  | Model 1 pipeline | Complete, untrained | dataset collection |
  | Models 2–4 | Not started | teammates |

- **What you can run right now**, verbatim:
  ```bash
  cd MyTasks/model5_fusion
  python -m pytest -q
  python -m stubs.mock_models --count 20 | python -m fusion.cli --explain -
  ```
  with a note that this needs no pip install — stdlib only, works on Python 3.14.
- **Your manual steps, in order**, each linking to the relevant doc:
  1. Collect the dataset → `docs/01-dataset-sourcing-guide.md` + `tools/capture_protocol.md`. **This is the critical path.**
  2. Upload to Google Drive → `docs/02-model1-training-guide.md`
  3. Run the Colab notebook → `docs/02-model1-training-guide.md`
  4. Send `docs/03-model5-fusion-contract.md` to whoever is building Models 2–4
  5. Confirm the servo mapping with the hardware team → `docs/04-integration-guide.md`
- **The 8-bin table** and the precedence order, for quick reference.
- **Repo layout**, matching the File Structure section of this plan.
- **Known gaps**, summarising spec §9 in a short table.

- [ ] **Step 5: Verify every referenced path exists**

Run from the repo root:

```bash
cd "MyTasks" && for f in \
  docs/00-design-spec.md docs/01-dataset-sourcing-guide.md \
  docs/02-model1-training-guide.md docs/03-model5-fusion-contract.md \
  docs/04-integration-guide.md README.md \
  tools/capture_protocol.md tools/label_sheet_template.csv \
  model5_fusion/config/routing.toml model5_fusion/fusion/engine.py \
  model5_fusion/stubs/mock_models.py \
  model1_variety/configs/dataset.toml \
  model1_variety/mango_variety/aggregate.py \
  model1_variety/scripts/01_prepare_dataset.py \
  model1_variety/scripts/05_predict_multiview.py \
  model1_variety/notebooks/MangoScan_Model1_Colab.ipynb \
; do [ -f "$f" ] && echo "OK   $f" || echo "MISS $f"; done
```

Expected: every line reads `OK`.

- [ ] **Step 6: Run both test suites one final time**

Run: `cd MyTasks/model5_fusion && python -m pytest -q && cd ../model1_variety && python -m pytest -q`
Expected: PASS in both.

- [ ] **Step 7: Commit**

```bash
git add MyTasks
git commit -m "docs: training guide, teammate contract, integration guide, and README"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §2 8-bin routing target | Task 1 (`routing.toml`), Task 3 (exhaustive tests) |
| §4.1 Six classes, "Wani" spelling | Task 5 (`classes.py` + a test guarding the spelling) |
| §4.2 Multi-view mean-of-softmax | Task 6 (`aggregate.py`) |
| §4.3 Dataset requirements, fruit-grouped split | Task 5 (`dataset.py`), Task 7 (`01_prepare_dataset.py`), Task 9 (guide) |
| §4.4 Training configuration | Task 7 (`dataset.toml`, `02_train.py`) |
| §4.5 Evaluation incl. calibration and multi-view gain | Task 6 (`metrics.py`), Task 7 (`03_evaluate.py`), Task 8 (plots) |
| §4.6 Export with parity check | Task 7 (`04_export.py`) |
| §5.1 Input contract | Task 2 |
| §5.2 Decision algorithm | Task 3 |
| §5.3 Output contract + trace | Task 2 (`FusionDecision`), Task 3 (trace assembly) |
| §5.4 Configuration | Task 1 |
| §5.5 Exhaustive testing | Task 3 |
| §6 Deliverables | all tasks; verified in Task 10 Step 5 |
| §9 Known gaps | Task 10 (integration guide + README) |

**Deviation from the spec, deliberate:** the spec says `routing.yaml`; the plan uses `routing.toml` parsed by stdlib `tomllib`. This removes Model 5's only third-party dependency, so it runs on the user's Python 3.14 with no install. The spec should be updated to match during Task 1.

**Resolved from spec §9:** risk 3 (two servos cannot address 8 bins) now has a concrete proposal — servo1 selects one of four groups, servo2 one of three size slots plus park. Documented as requiring hardware confirmation, and it is config, not code.

**Type consistency check:** `ScanInput` field names (`variety`, `disease`, `bruise`, `color`, `size`) match `vocab.ROUTING_DIMENSIONS` strings exactly, which `engine._gate` relies on via `getattr`. `BinSpec.index` is used as `bin_index` throughout. `aggregate_views` returns `(label, confidence, probabilities)` and every caller — the tests, `03_evaluate.py`, `05_predict_multiview.py` — unpacks three values. `to_contract` emits the `models.variety` shape that `ScanInput.from_dict` parses; Task 6's `test_to_contract_matches_the_model5_input_shape` and Task 4's `test_mock_batch_parses_and_routes` both hold that seam.
