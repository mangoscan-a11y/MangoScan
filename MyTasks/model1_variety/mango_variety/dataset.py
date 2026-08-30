"""Splitting images into train/val/test by *physical fruit*.

This is the single most important correctness constraint in the whole
pipeline. The rig shoots five views of every mango. Splitting by image
puts views 1-3 of a fruit in train and views 4-5 in test, so the model
is graded on mangoes it has already memorised. Reported accuracy climbs,
real-world accuracy does not, and the error is invisible in every metric
you would normally look at.

So: fruits are grouped first, and whole groups move together.
"""

from __future__ import annotations

import random
import re
from collections import defaultdict
from collections.abc import Mapping, Sequence

#: Captures everything before a trailing `_v<digits>` view marker.
#: `carabao_001_v3.jpg` -> `carabao_001`
DEFAULT_FRUIT_PATTERN = r"^(?P<fruit>.+?)_v\d+$"

SPLIT_NAMES = ("train", "val", "test")


class LeakageError(AssertionError):
    """The same physical fruit landed in more than one split."""


def fruit_id_for(filename: str, pattern: str = DEFAULT_FRUIT_PATTERN) -> str:
    """Derive a fruit id from a filename.

    A filename with no view marker is treated as its own single-view
    fruit, which is the right behaviour for scraped web images.
    """
    stem = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    stem = stem.rsplit(".", 1)[0]
    match = re.match(pattern, stem)
    if match:
        return match.group("fruit")
    return stem


def group_by_fruit(
    filenames: Sequence[str], pattern: str = DEFAULT_FRUIT_PATTERN
) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = defaultdict(list)
    for name in filenames:
        groups[fruit_id_for(name, pattern)].append(name)
    return {k: sorted(v) for k, v in sorted(groups.items())}


def split_groups(
    groups: Mapping[str, list[str]],
    ratios: tuple[float, float, float] = (0.7, 0.15, 0.15),
    seed: int = 42,
) -> dict[str, list[str]]:
    """Assign fruit ids to train/val/test. Returns ids, not filenames."""
    if abs(sum(ratios) - 1.0) > 1e-9:
        raise ValueError(f"ratios must sum to 1, got {sum(ratios)}")

    fruit_ids = sorted(groups)
    total = len(fruit_ids)
    if total < 3:
        raise ValueError(
            f"need at least 3 fruits to populate three splits, got {total}"
        )

    rng = random.Random(seed)
    shuffled = fruit_ids[:]
    rng.shuffle(shuffled)

    n_val = max(1, round(total * ratios[1]))
    n_test = max(1, round(total * ratios[2]))
    if n_val + n_test >= total:
        n_val = n_test = 1
    n_train = total - n_val - n_test

    return {
        "train": sorted(shuffled[:n_train]),
        "val": sorted(shuffled[n_train : n_train + n_val]),
        "test": sorted(shuffled[n_train + n_val :]),
    }


def assert_no_leakage(assignment: Mapping[str, Sequence[str]]) -> None:
    seen: dict[str, str] = {}
    for split in SPLIT_NAMES:
        for fruit_id in assignment.get(split, ()):
            if fruit_id in seen:
                raise LeakageError(
                    f"fruit {fruit_id!r} appears in both "
                    f"{seen[fruit_id]!r} and {split!r}"
                )
            seen[fruit_id] = split
