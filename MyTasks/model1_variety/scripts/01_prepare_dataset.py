"""Turn a folder of raw images into an Ultralytics classification dataset.

    python scripts/01_prepare_dataset.py --config configs/dataset.toml

Input:   data/raw/<Class_Name>/<fruit_id>_v<n>.jpg
Output:  data/dataset/{train,val,test}/<Class_Name>/*.jpg

Splits by physical fruit, never by image. See mango_variety/dataset.py for
why that distinction decides whether your accuracy numbers mean anything.

Stdlib only - runs anywhere, including local Python 3.14.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tomllib
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mango_variety.classes import CLASSES, to_dirname  # noqa: E402
from mango_variety.dataset import (  # noqa: E402
    assert_no_leakage,
    group_by_fruit,
    split_groups,
)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SPLITS = ("train", "val", "test")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/dataset.toml")
    parser.add_argument(
        "--dry-run", action="store_true", help="report the plan without copying"
    )
    args = parser.parse_args(argv)

    config = tomllib.loads(Path(args.config).read_text(encoding="utf-8"))
    raw_dir = Path(config["paths"]["raw_dir"])
    out_dir = Path(config["paths"]["dataset_dir"])
    ratios = tuple(config["split"]["ratios"])
    seed = int(config["split"]["seed"])
    pattern = config["split"]["fruit_pattern"]

    if not raw_dir.is_dir():
        print(f"error: {raw_dir} does not exist", file=sys.stderr)
        return 1

    if out_dir.exists() and not args.dry_run:
        shutil.rmtree(out_dir)

    totals: Counter[str] = Counter()
    problems: list[str] = []

    for label in CLASSES:
        class_dir = raw_dir / to_dirname(label)
        if not class_dir.is_dir():
            problems.append(f"missing class directory: {class_dir}")
            continue

        files = sorted(
            p.name
            for p in class_dir.iterdir()
            if p.suffix.lower() in IMAGE_SUFFIXES
        )
        if not files:
            problems.append(f"no images in {class_dir}")
            continue

        groups = group_by_fruit(files, pattern)
        if len(groups) < 3:
            problems.append(
                f"{label}: only {len(groups)} distinct fruits - need at least 3"
            )
            continue

        assignment = split_groups(groups, ratios=ratios, seed=seed)
        assert_no_leakage(assignment)

        print(
            f"{label:<14} {len(files):>5} images  {len(groups):>4} fruits  "
            f"train/val/test = "
            f"{len(assignment['train'])}/{len(assignment['val'])}/"
            f"{len(assignment['test'])}"
        )

        for split in SPLITS:
            target = out_dir / split / to_dirname(label)
            if not args.dry_run:
                target.mkdir(parents=True, exist_ok=True)
            for fruit_id in assignment[split]:
                for filename in groups[fruit_id]:
                    totals[split] += 1
                    if not args.dry_run:
                        shutil.copy2(class_dir / filename, target / filename)

    print()
    for split in SPLITS:
        print(f"{split:<6} {totals[split]:>6} images")

    if problems:
        print("\nProblems:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    # Sanity check: no filename may appear in more than one split.
    if not args.dry_run:
        seen: dict[str, str] = {}
        for split in SPLITS:
            for path in (out_dir / split).rglob("*"):
                if path.is_file():
                    if path.name in seen:
                        print(
                            f"LEAKAGE: {path.name} in both {seen[path.name]} "
                            f"and {split}",
                            file=sys.stderr,
                        )
                        return 1
                    seen[path.name] = split
        print(f"\nOK - {len(seen)} images written to {out_dir}, no leakage.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
