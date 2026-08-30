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
