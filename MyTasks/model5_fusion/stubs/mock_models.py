"""Fake Models 1-4 that emit contract-valid payloads.

Lets the whole fusion path be demonstrated end to end before a single
mango is photographed. Deterministic per seed so tests can rely on it.
"""

from __future__ import annotations

import argparse
import json
import random
import sys

from fusion.vocab import COLORS, DISEASES, SIZES, VARIETIES


def generate_scan(seed: int, declared_variety: str = "Carabao") -> dict:
    rng = random.Random(seed)

    # Mostly healthy, unbruised fruit - roughly what a real line sees.
    disease = rng.choices(DISEASES, weights=[80, 12, 8])[0]
    is_bruised = rng.random() < 0.15
    # The declared variety dominates, with occasional mis-sorts to exercise
    # the QC alert path.
    variety = declared_variety if rng.random() < 0.9 else rng.choice(VARIETIES)

    def confidence() -> float:
        return round(rng.uniform(0.55, 0.99), 4)

    return {
        "scan_id": f"mock-{seed:06d}",
        "captured_at": "2026-08-23T10:15:00+08:00",
        "declared_variety": declared_variety,
        "models": {
            "variety": {"label": variety, "confidence": confidence()},
            "disease": {"label": disease, "confidence": confidence()},
            "bruise": {"is_bruised": is_bruised, "confidence": confidence()},
            "color": {"label": rng.choice(COLORS), "confidence": confidence()},
            "size": {
                "label": rng.choice(SIZES),
                "grams": round(rng.uniform(120.0, 520.0), 1),
                "confidence": confidence(),
            },
        },
    }


def generate_batch(
    count: int, seed: int = 42, declared_variety: str = "Carabao"
) -> list[dict]:
    return [generate_scan(seed + i, declared_variety) for i in range(count)]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Emit contract-valid mock scans for Models 1-4."
    )
    parser.add_argument("--count", type=int, default=10)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--declared-variety", default="Carabao")
    args = parser.parse_args(argv)

    json.dump(
        generate_batch(args.count, args.seed, args.declared_variety),
        sys.stdout,
        indent=2,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
