"""Remove duplicate and unusable images from a scraped class directory.

    python tools/dedupe_images.py data/raw/Carabao --apply

Scraped sets are full of the same photo re-hosted on a dozen sites. A
duplicate that lands in both train and test is the *same leak* this
project's fruit-grouping logic exists to prevent - the model is graded on
an image it memorised - except grouping cannot catch it, because the two
copies have different filenames and so become two different "fruits".

Run this before `01_prepare_dataset.py`, every time you add images.

Also drops files that are not decodable images (search engines serve
plenty of HTML error pages with a .jpg name) and anything too small to
carry detail at 224px.

Defaults to a dry run. Stdlib only - runs on Python 3.14.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from collections import defaultdict
from pathlib import Path

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

#: Leading bytes for the formats Ultralytics can actually read.
MAGIC = {
    b"\xff\xd8\xff": "jpeg",
    b"\x89PNG\r\n\x1a\n": "png",
    b"BM": "bmp",
    b"RIFF": "webp",
}

#: Below this, an image cannot hold useful detail once resized to 224px.
MIN_BYTES = 8_000


def sniff(path: Path) -> str | None:
    head = path.read_bytes()[:16]
    for magic, kind in MAGIC.items():
        if head.startswith(magic):
            return kind
    return None


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory")
    parser.add_argument(
        "--apply", action="store_true", help="actually delete (default: report only)"
    )
    parser.add_argument("--min-bytes", type=int, default=MIN_BYTES)
    args = parser.parse_args(argv)

    root = Path(args.directory)
    if not root.is_dir():
        print(f"error: {root} is not a directory", file=sys.stderr)
        return 1

    files = sorted(p for p in root.rglob("*") if p.suffix.lower() in IMAGE_SUFFIXES)
    if not files:
        print(f"error: no images under {root}", file=sys.stderr)
        return 1

    by_hash: dict[str, list[Path]] = defaultdict(list)
    not_images: list[Path] = []
    too_small: list[Path] = []

    for path in files:
        if sniff(path) is None:
            not_images.append(path)
            continue
        if path.stat().st_size < args.min_bytes:
            too_small.append(path)
            continue
        by_hash[digest(path)].append(path)

    # Keep the first of each duplicate group, drop the rest.
    duplicates = [p for paths in by_hash.values() for p in paths[1:]]
    doomed = not_images + too_small + duplicates
    survivors = len(files) - len(doomed)

    print(f"{root}")
    print(f"  scanned         {len(files):>5}")
    print(f"  not images      {len(not_images):>5}")
    print(f"  too small       {len(too_small):>5}  (< {args.min_bytes} bytes)")
    print(f"  exact duplicates{len(duplicates):>5}")
    print(f"  would keep      {survivors:>5}")

    if duplicates:
        print("\n  duplicate groups (keeping the first of each):")
        shown = 0
        for paths in by_hash.values():
            if len(paths) > 1 and shown < 5:
                print(f"    {paths[0].name}")
                for path in paths[1:]:
                    print(f"      = {path.name}")
                shown += 1
        if shown == 5:
            print("    ...")

    if args.apply:
        for path in doomed:
            path.unlink()
        print(f"\ndeleted {len(doomed)} files, {survivors} remain")
    elif doomed:
        print(f"\ndry run - re-run with --apply to delete {len(doomed)} files")

    if survivors < 60:
        print(
            f"\nwarning: {survivors} images is below the 60-per-class floor.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
