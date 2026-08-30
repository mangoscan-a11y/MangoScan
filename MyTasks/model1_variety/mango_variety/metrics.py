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
