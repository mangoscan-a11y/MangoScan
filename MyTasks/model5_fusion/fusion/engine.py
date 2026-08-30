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
