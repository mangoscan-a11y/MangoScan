"""Train the YOLOv8-cls variety classifier.

    python scripts/02_train.py --config configs/dataset.toml

Requires ultralytics. Intended for Colab; see notebooks/.
"""

from __future__ import annotations

import argparse
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mango_variety.classes import CLASSES  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/dataset.toml")
    parser.add_argument("--epochs", type=int, default=None)
    parser.add_argument("--batch", type=int, default=None)
    parser.add_argument("--device", default=None)
    args = parser.parse_args(argv)

    config = tomllib.loads(Path(args.config).read_text(encoding="utf-8"))
    train_cfg = config["train"]
    aug_cfg = config["augment"]
    dataset_dir = Path(config["paths"]["dataset_dir"]).resolve()

    for split in ("train", "val", "test"):
        if not (dataset_dir / split).is_dir():
            print(
                f"error: {dataset_dir / split} missing - run "
                f"01_prepare_dataset.py first",
                file=sys.stderr,
            )
            return 1

    found = sorted(p.name for p in (dataset_dir / "train").iterdir() if p.is_dir())
    expected = sorted(c.replace(" ", "_") for c in CLASSES)
    if found != expected:
        print(f"error: expected classes {expected}, found {found}", file=sys.stderr)
        return 1

    from ultralytics import YOLO

    model = YOLO(train_cfg["model"])
    model.train(
        data=str(dataset_dir),
        imgsz=int(train_cfg["imgsz"]),
        epochs=int(args.epochs or train_cfg["epochs"]),
        patience=int(train_cfg["patience"]),
        batch=int(args.batch or train_cfg["batch"]),
        device=args.device if args.device is not None else train_cfg["device"],
        project=train_cfg["project"],
        name=train_cfg["name"],
        exist_ok=True,
        fliplr=float(aug_cfg["fliplr"]),
        flipud=float(aug_cfg["flipud"]),
        degrees=float(aug_cfg["degrees"]),
        hsv_h=float(aug_cfg["hsv_h"]),
        hsv_s=float(aug_cfg["hsv_s"]),
        hsv_v=float(aug_cfg["hsv_v"]),
    )

    weights = Path(train_cfg["project"]) / train_cfg["name"] / "weights" / "best.pt"
    print(f"\nBest weights: {weights}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
