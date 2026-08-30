"""Export Model 1 to ONNX (and optionally TFLite), then verify parity.

    python scripts/04_export.py --weights runs/model1_variety/weights/best.pt

Parity matters: a silently-diverging export means the model you validated
is not the model that sorts fruit.
"""

from __future__ import annotations

import argparse
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/dataset.toml")
    parser.add_argument("--weights", required=True)
    parser.add_argument("--tflite", action="store_true", help="also export TFLite")
    parser.add_argument("--parity-samples", type=int, default=50)
    args = parser.parse_args(argv)

    config = tomllib.loads(Path(args.config).read_text(encoding="utf-8"))
    imgsz = int(config["train"]["imgsz"])
    test_dir = Path(config["paths"]["dataset_dir"]) / "test"

    from ultralytics import YOLO

    model = YOLO(args.weights)
    onnx_path = model.export(format="onnx", imgsz=imgsz, opset=12)
    print(f"ONNX: {onnx_path}")

    if args.tflite:
        tflite_path = model.export(format="tflite", imgsz=imgsz)
        print(f"TFLite: {tflite_path}")

    samples = sorted(
        p for p in test_dir.rglob("*") if p.suffix.lower() in IMAGE_SUFFIXES
    )[: args.parity_samples]
    if not samples:
        print("warning: no test images found, skipping parity check", file=sys.stderr)
        return 0

    exported = YOLO(str(onnx_path))
    sources = [str(p) for p in samples]
    torch_results = model.predict(source=sources, verbose=False)
    onnx_results = exported.predict(source=sources, verbose=False)

    mismatches = [
        Path(t.path).name
        for t, o in zip(torch_results, onnx_results)
        if int(t.probs.top1) != int(o.probs.top1)
    ]

    print(f"\nParity: {len(samples) - len(mismatches)}/{len(samples)} agree")
    if mismatches:
        print(f"MISMATCHES: {mismatches}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
