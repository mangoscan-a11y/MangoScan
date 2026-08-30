"""Move a folder of downloaded images into a class directory, renamed.

    python tools/import_batch.py --from "C:/Users/.../Downloads/carabao_q1" \
        --label Carabao --batch bing01 --raw data/raw

Browser extensions and crawlers write `000001.jpg`, `image (3).jpg`,
`download.png`. This renames each batch to `carabao_bing01_001.jpg` on the
way in, so that when one search term turns out to have returned the wrong
variety you can delete exactly that batch instead of re-curating the class.

Skips anything already present in the destination, by content hash, so
re-running is safe and cross-batch duplicates never accumulate.

No `_v<n>` marker is added on purpose: the pipeline then treats each image
as its own single-view fruit, which is correct for web images.

Stdlib only - runs on Python 3.14.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
from pathlib import Path

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

MAGIC = (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"BM", b"RIFF")

MIN_BYTES = 8_000


def is_image(path: Path) -> bool:
    return path.read_bytes()[:16].startswith(MAGIC)


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="source", required=True)
    parser.add_argument("--label", required=True, help="e.g. Carabao, Apple Mango")
    parser.add_argument("--batch", required=True, help="e.g. bing01, google02")
    parser.add_argument("--raw", default="data/raw")
    parser.add_argument("--min-bytes", type=int, default=MIN_BYTES)
    parser.add_argument(
        "--move", action="store_true", help="move instead of copy (frees disk)"
    )
    parser.add_argument("--apply", action="store_true", help="default is a dry run")
    args = parser.parse_args(argv)

    source = Path(args.source)
    if not source.is_dir():
        print(f"error: {source} is not a directory", file=sys.stderr)
        return 1

    slug = args.label.lower().replace(" ", "_")
    dest = Path(args.raw) / args.label.replace(" ", "_")

    existing: set[str] = set()
    if dest.is_dir():
        existing = {
            digest(p) for p in dest.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES
        }

    candidates = sorted(
        p for p in source.rglob("*") if p.suffix.lower() in IMAGE_SUFFIXES
    )
    if not candidates:
        print(f"error: no images under {source}", file=sys.stderr)
        return 1

    imported = 0
    skipped_dupe = 0
    skipped_junk = 0
    seen = set(existing)
    index = 1

    if args.apply:
        dest.mkdir(parents=True, exist_ok=True)

    for path in candidates:
        if not is_image(path) or path.stat().st_size < args.min_bytes:
            skipped_junk += 1
            continue

        checksum = digest(path)
        if checksum in seen:
            skipped_dupe += 1
            continue
        seen.add(checksum)

        # Find a free index; earlier runs of the same batch may have used some.
        while True:
            target = dest / f"{slug}_{args.batch}_{index:03d}{path.suffix.lower()}"
            index += 1
            if not target.exists():
                break

        if args.apply:
            if args.move:
                shutil.move(str(path), target)
            else:
                shutil.copy2(path, target)
        imported += 1

    print(f"{source}  ->  {dest}")
    print(f"  imported        {imported:>5}  as {slug}_{args.batch}_NNN")
    print(f"  duplicates      {skipped_dupe:>5}  (already in the class)")
    print(f"  junk / too small{skipped_junk:>5}")
    print(f"  class total     {len(seen):>5}")

    if not args.apply:
        print("\ndry run - re-run with --apply")
    elif len(seen) < 60:
        print(
            f"\nwarning: {len(seen)} images is below the 60-per-class floor.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
