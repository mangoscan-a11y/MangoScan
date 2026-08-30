"""Train the YOLO mango/stem detector.

    python scripts/02_train.py --config configs/detector.toml

Expects data/detector_dataset/data.yaml, produced by
`tools/prepare_detector_dataset.py`. Requires ultralytics; intended for
Colab, see notebooks/.
"""

from __future__ import annotations

import argparse
import sys
import tomllib
from pathlib import Path

CLASSES = ("mango", "stem")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/detector.toml")
    parser.add_argument("--epochs", type=int, default=None)
    parser.add_argument("--batch", type=int, default=None)
    parser.add_argument("--device", default=None)
    parser.add_argument("--data", default=None, help="override the data.yaml path")
    args = parser.parse_args(argv)

    config = tomllib.loads(Path(args.config).read_text(encoding="utf-8"))
    train_cfg = config["train"]
    aug_cfg = config["augment"]

    data_yaml = Path(args.data) if args.data else (
        Path(config["paths"]["dataset_dir"]) / "data.yaml"
    )
    if not data_yaml.is_file():
        print(f"error: {data_yaml} not found.\n"
              "Run tools/prepare_detector_dataset.py first.", file=sys.stderr)
        return 1

    try:
        from ultralytics import YOLO
    except ModuleNotFoundError:
        print("error: ultralytics is not installed. This script runs on the "
              "training host (Colab), not on local Python 3.14.", file=sys.stderr)
        return 1

    device = args.device if args.device is not None else train_cfg["device"]
    if isinstance(device, str) and device.isdigit():
        device = int(device)

    print(f"data    {data_yaml.resolve()}")
    print(f"model   {train_cfg['model']}")
    print(f"classes {', '.join(CLASSES)}\n")

    model = YOLO(train_cfg["model"])
    model.train(
        data=str(data_yaml.resolve()),
        imgsz=train_cfg["imgsz"],
        epochs=args.epochs if args.epochs is not None else train_cfg["epochs"],
        patience=train_cfg["patience"],
        batch=args.batch if args.batch is not None else train_cfg["batch"],
        device=device,
        workers=train_cfg["workers"],
        project=train_cfg["project"],
        name=train_cfg["name"],
        exist_ok=True,
        **aug_cfg,
    )

    weights = Path(train_cfg["project"]) / train_cfg["name"] / "weights" / "best.pt"
    print(f"\nbest weights: {weights}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
