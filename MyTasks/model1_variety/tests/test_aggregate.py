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
    with pytest.raises(AggregationError, match=r"sum to .*expected 1"):
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
