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
