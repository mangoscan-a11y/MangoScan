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
