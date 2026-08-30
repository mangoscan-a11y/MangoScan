"""Run the fusion engine over a JSON file or stdin.

    python -m stubs.mock_models --count 20 | python -m fusion.cli -

Exit codes: 0 routed, 1 bad payload, 2 bad config.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from fusion.config import ConfigError, RoutingConfig
from fusion.contracts import ContractError, ScanInput
from fusion.engine import decide

DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / "config" / "routing.toml"


def _read(source: str) -> str:
    if source == "-":
        return sys.stdin.read()
    return Path(source).read_text(encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="MangoScan Model 5 - fuse model outputs into a bin assignment."
    )
    parser.add_argument(
        "input",
        help="JSON file with one scan or an array of scans; '-' for stdin",
    )
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument(
        "--explain",
        action="store_true",
        help="print the decision trace to stderr",
    )
    args = parser.parse_args(argv)

    try:
        config = RoutingConfig.load(args.config)
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2

    try:
        raw = _read(args.input)
    except OSError as exc:
        print(f"cannot read input: {exc}", file=sys.stderr)
        return 1

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"input is not valid JSON: {exc}", file=sys.stderr)
        return 1

    payloads = payload if isinstance(payload, list) else [payload]
    decisions = []
    try:
        for item in payloads:
            decision = decide(ScanInput.from_dict(item), config)
            decisions.append(decision)
            if args.explain:
                print(
                    f"--- {decision.scan_id} -> bin {decision.bin_index} "
                    f"({decision.bin_name})",
                    file=sys.stderr,
                )
                for step in decision.decision_trace:
                    print(
                        f"    {step.step:<16} {step.result:<8} {step.detail}",
                        file=sys.stderr,
                    )
                if decision.alerts:
                    print(f"    alerts: {', '.join(decision.alerts)}", file=sys.stderr)
    except ContractError as exc:
        print(f"contract error: {exc}", file=sys.stderr)
        return 1
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2

    out = [d.to_dict() for d in decisions]
    json.dump(out if isinstance(payload, list) else out[0], sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
