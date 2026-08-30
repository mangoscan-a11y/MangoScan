"""Evaluate Model 1 on the held-out test split.

    python scripts/03_evaluate.py --weights runs/model1_variety/weights/best.pt

Writes report.json, confusion_matrix.csv, and reliability.csv next to the
weights. Reports single-view accuracy alongside 5-view aggregated
accuracy, and the calibration error Model 5's confidence gate depends on.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mango_variety.aggregate import aggregate_views  # noqa: E402
from mango_variety.classes import CLASSES, from_dirname  # noqa: E402
from mango_variety.dataset import fruit_id_for  # noqa: E402
from mango_variety.metrics import (  # noqa: E402
    confusion_matrix,
    expected_calibration_error,
    macro_average,
    per_class_report,
    reliability_bins,
    top_k_accuracy,
    weighted_average,
)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/dataset.toml")
    parser.add_argument("--weights", required=True)
    parser.add_argument("--split", default="test")
    args = parser.parse_args(argv)

    config = tomllib.loads(Path(args.config).read_text(encoding="utf-8"))
    split_dir = Path(config["paths"]["dataset_dir"]) / args.split
    pattern = config["split"]["fruit_pattern"]
    out_dir = Path(args.weights).resolve().parent

    from ultralytics import YOLO

    model = YOLO(args.weights)
    model_names = [model.names[i] for i in range(len(model.names))]
    class_order = [from_dirname(n) for n in model_names]

    per_image_true: list[str] = []
    per_image_pred: list[str] = []
    per_image_probs: list[dict[str, float]] = []
    per_image_conf: list[float] = []

    # fruit key -> (true label, [softmax vectors])
    fruits: dict[str, tuple[str, list[list[float]]]] = {}

    for class_dir in sorted(p for p in split_dir.iterdir() if p.is_dir()):
        truth = from_dirname(class_dir.name)
        images = sorted(
            p for p in class_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES
        )
        if not images:
            continue

        for result in model.predict(source=[str(p) for p in images], verbose=False):
            vector = [float(x) for x in result.probs.data.tolist()]
            probs = {class_order[i]: vector[i] for i in range(len(class_order))}
            best = max(probs, key=probs.get)
            per_image_true.append(truth)
            per_image_pred.append(best)
            per_image_probs.append(probs)
            per_image_conf.append(probs[best])

            fruit = fruit_id_for(Path(result.path).name, pattern)
            key = f"{class_dir.name}/{fruit}"
            fruits.setdefault(key, (truth, []))[1].append(
                [probs[c] for c in CLASSES]
            )

    if not per_image_true:
        print(f"error: no images found under {split_dir}", file=sys.stderr)
        return 1

    # Per-image
    image_cm = confusion_matrix(per_image_true, per_image_pred, list(CLASSES))
    image_report = per_class_report(image_cm, list(CLASSES))
    image_acc = sum(t == p for t, p in zip(per_image_true, per_image_pred)) / len(
        per_image_true
    )

    # 5-view aggregated
    fruit_true: list[str] = []
    fruit_pred: list[str] = []
    fruit_conf: list[float] = []
    fruit_probs: list[dict[str, float]] = []
    for truth, vectors in fruits.values():
        label, confidence, probabilities = aggregate_views(vectors)
        fruit_true.append(truth)
        fruit_pred.append(label)
        fruit_conf.append(confidence)
        fruit_probs.append(probabilities)

    fruit_cm = confusion_matrix(fruit_true, fruit_pred, list(CLASSES))
    fruit_report = per_class_report(fruit_cm, list(CLASSES))
    fruit_acc = sum(t == p for t, p in zip(fruit_true, fruit_pred)) / len(fruit_true)

    report = {
        "weights": str(args.weights),
        "split": args.split,
        "classes": list(CLASSES),
        "per_image": {
            "n": len(per_image_true),
            "top1_accuracy": image_acc,
            "top3_accuracy": top_k_accuracy(
                per_image_probs, per_image_true, list(CLASSES), k=3
            ),
            "per_class": image_report,
            "macro_avg": macro_average(image_report),
            "weighted_avg": weighted_average(image_report),
            "ece": expected_calibration_error(
                per_image_conf,
                [t == p for t, p in zip(per_image_true, per_image_pred)],
            ),
        },
        "multiview": {
            "n_fruits": len(fruit_true),
            "top1_accuracy": fruit_acc,
            "top3_accuracy": top_k_accuracy(
                fruit_probs, fruit_true, list(CLASSES), k=3
            ),
            "per_class": fruit_report,
            "macro_avg": macro_average(fruit_report),
            "weighted_avg": weighted_average(fruit_report),
            "ece": expected_calibration_error(
                fruit_conf, [t == p for t, p in zip(fruit_true, fruit_pred)]
            ),
        },
        "multiview_gain": fruit_acc - image_acc,
    }

    (out_dir / "report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )

    with (out_dir / "confusion_matrix.csv").open(
        "w", newline="", encoding="utf-8"
    ) as fh:
        writer = csv.writer(fh)
        writer.writerow(["true\\pred", *CLASSES])
        for label, row in zip(CLASSES, fruit_cm):
            writer.writerow([label, *row])

    with (out_dir / "reliability.csv").open(
        "w", newline="", encoding="utf-8"
    ) as fh:
        writer = csv.writer(fh)
        writer.writerow(["lower", "upper", "count", "accuracy", "avg_confidence"])
        for entry in reliability_bins(
            fruit_conf, [t == p for t, p in zip(fruit_true, fruit_pred)]
        ):
            writer.writerow(
                [
                    entry["lower"],
                    entry["upper"],
                    entry["count"],
                    entry["accuracy"],
                    entry["avg_confidence"],
                ]
            )

    print(f"per-image  top-1: {image_acc:.4f}   ECE: {report['per_image']['ece']:.4f}")
    print(f"multi-view top-1: {fruit_acc:.4f}   ECE: {report['multiview']['ece']:.4f}")
    print(f"multi-view gain : {report['multiview_gain']:+.4f}")
    print(f"\nWrote report.json, confusion_matrix.csv, reliability.csv to {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
