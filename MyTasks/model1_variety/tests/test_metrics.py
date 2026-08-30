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
