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
