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
