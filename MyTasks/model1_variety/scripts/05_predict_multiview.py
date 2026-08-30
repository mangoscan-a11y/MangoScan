"""Run Model 1 over one mango's five views and emit a Model 5 payload.

    python scripts/05_predict_multiview.py \
        --weights runs/model1_variety/weights/best.pt \
        --images v1.jpg v2.jpg v3.jpg v4.jpg v5.jpg \
        --scan-id scan-0001 --declared-variety Carabao

Prints JSON that fusion's CLI accepts directly:

    python scripts/05_predict_multiview.py ... > scan.json
    python -m fusion.cli scan.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mango_variety.aggregate import aggregate_views, to_contract  # noqa: E402
from mango_variety.classes import CLASSES, from_dirname  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", required=True)
    parser.add_argument("--images", nargs="+", required=True)
    parser.add_argument("--scan-id", required=True)
    parser.add_argument("--declared-variety", default=None)
    parser.add_argument("--captured-at", default=None)
    args = parser.parse_args(argv)

    if len(args.images) > 5:
        print("error: at most 5 views per mango", file=sys.stderr)
        return 1

    from ultralytics import YOLO

    model = YOLO(args.weights)
    class_order = [from_dirname(model.names[i]) for i in range(len(model.names))]

    vectors: list[list[float]] = []
    per_view: list[tuple[int, str, float]] = []

    for angle, result in enumerate(
        model.predict(source=args.images, verbose=False), start=1
    ):
        raw = [float(x) for x in result.probs.data.tolist()]
        probs = {class_order[i]: raw[i] for i in range(len(class_order))}
        vectors.append([probs[c] for c in CLASSES])
        best = max(probs, key=probs.get)
        per_view.append((angle, best, probs[best]))

    label, confidence, probabilities = aggregate_views(vectors)
    payload = to_contract(
        scan_id=args.scan_id,
        label=label,
        confidence=confidence,
        probabilities=probabilities,
        per_view=per_view,
        declared_variety=args.declared_variety,
        captured_at=args.captured_at,
    )
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
