"""Evaluate the detector on the held-out test split.

    python scripts/03_evaluate.py --weights runs/model0_detector/weights/best.pt

Writes report.json next to the weights.

Two numbers matter, and they are not the headline mAP:

  * **mango recall** - a mango the detector misses never reaches Models 1-4,
    so it is never routed at all. That is a dropped fruit on the conveyor,
    which is worse than a misrouted one.
  * **mango mAP50-95** - box tightness. Loose boxes mean crops with conveyor
    background in them, and Model 4 reads colour off those pixels.

Stem numbers will be lower. The stem is small, often occluded, and it is not
on the routing path - it only supplies orientation. Do not tune against it.
"""

from __future__ import annotations

import argparse
import json
import sys
import tomllib
from pathlib import Path

CLASSES = ("mango", "stem")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/detector.toml")
    parser.add_argument("--weights", default="runs/model0_detector/weights/best.pt")
    parser.add_argument("--split", default="test", choices=("train", "val", "test"))
    parser.add_argument("--data", default=None, help="override the data.yaml path")
    args = parser.parse_args(argv)

    config = tomllib.loads(Path(args.config).read_text(encoding="utf-8"))
    data_yaml = Path(args.data) if args.data else (
        Path(config["paths"]["dataset_dir"]) / "data.yaml"
    )

    weights = Path(args.weights)
    if not weights.is_file():
        print(f"error: {weights} not found. Train first.", file=sys.stderr)
        return 1

    try:
        from ultralytics import YOLO
    except ModuleNotFoundError:
        print("error: ultralytics is not installed.", file=sys.stderr)
        return 1

    model = YOLO(str(weights))
    results = model.val(
        data=str(data_yaml.resolve()),
        split=args.split,
        imgsz=config["train"]["imgsz"],
        device=config["train"]["device"],
        project=config["train"]["project"],
        name=f"{config['train']['name']}_eval_{args.split}",
        exist_ok=True,
    )

    box = results.box
    per_class = {}
    for i, name in enumerate(CLASSES):
        try:
            precision, recall, ap50, ap = box.class_result(i)
        except (IndexError, TypeError):
            continue
        per_class[name] = {
            "precision": round(float(precision), 4),
            "recall": round(float(recall), 4),
            "mAP50": round(float(ap50), 4),
            "mAP50-95": round(float(ap), 4),
        }

    report = {
        "weights": str(weights),
        "split": args.split,
        "overall": {
            "mAP50": round(float(box.map50), 4),
            "mAP50-95": round(float(box.map), 4),
            "precision": round(float(box.mp), 4),
            "recall": round(float(box.mr), 4),
        },
        "per_class": per_class,
    }

    out = weights.parent / f"detector_report_{args.split}.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print(f"\n{'class':<10}{'P':>9}{'R':>9}{'mAP50':>9}{'mAP50-95':>11}")
    for name, m in per_class.items():
        print(f"{name:<10}{m['precision']:>9.3f}{m['recall']:>9.3f}"
              f"{m['mAP50']:>9.3f}{m['mAP50-95']:>11.3f}")
    o = report["overall"]
    print(f"{'all':<10}{o['precision']:>9.3f}{o['recall']:>9.3f}"
          f"{o['mAP50']:>9.3f}{o['mAP50-95']:>11.3f}")

    mango = per_class.get("mango", {})
    if mango:
        print()
        if mango["recall"] < 0.95:
            print(f"WARNING: mango recall {mango['recall']:.3f} < 0.95 - "
                  f"roughly {(1 - mango['recall']) * 100:.1f}% of fruit would "
                  "never reach Models 1-4.")
        else:
            print(f"mango recall {mango['recall']:.3f} - good.")

    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
