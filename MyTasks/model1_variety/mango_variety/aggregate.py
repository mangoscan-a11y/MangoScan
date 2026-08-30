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
