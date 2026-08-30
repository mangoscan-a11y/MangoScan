"""Fold another YOLO detection dataset into data/detector_dataset.

    python tools/merge_detector_dataset.py \
        --src ~/Downloads/some-roboflow-export \
        --map "0=mango,3=stem" \
        --dry-run

Every YOLO dataset numbers its own classes. Yours is `0=mango, 1=stem`; the
next one might be `0=ripe, 1=unripe, 2=mango`. Copying label files across
without remapping silently relabels boxes - "unripe" becomes "stem" and
nothing in the training logs will tell you. `--map` is therefore required,
and any source class you do not name is dropped rather than guessed at.

Read `--map` as `<source id>=<your class>`. Inspect the source's `data.yaml`
or `classes.txt` first to learn its ordering; `--inspect` prints it for you.

## New images go to `train` only, by design

`--split train` is the default and you should think hard before changing it.
Your val and test splits define what "the detector works" means, and they
are drawn from the rig's own domain. Letting orchard photos or someone
else's studio shots into them changes the question the metric answers, and
your numbers stop being comparable to the run before. Extra data belongs in
train, where it can only help the model generalise; the yardstick stays
fixed.

Duplicates are rejected by SHA-256 against **every** split, not just the
destination. A source image that already exists in your test set would
otherwise be trained on and then scored against - the leak that makes a
detector look excellent and behave badly.

Requires Pillow. Everything else is stdlib. Runs on Python 3.14.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from collections import Counter
from pathlib import Path

try:
    from PIL import Image
except ModuleNotFoundError:
    print("error: this script needs Pillow -> python -m pip install Pillow",
          file=sys.stderr)
    raise SystemExit(1)

SPLITS = ("train", "val", "test")
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

#: Your scheme. Anything merged in must land on one of these.
TARGET_CLASSES = {"mango": 0, "stem": 1}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def find_pairs(src: Path) -> list[tuple[Path, Path]]:
    """Locate (image, label) pairs under any of the common YOLO layouts.

    Roboflow exports `train/images/`, `valid/images/`, `test/images/`.
    Ultralytics and the MangoScan prepare script write `images/train/`.
    Some dumps are a flat pair of directories. All three appear in the wild.
    """
    label_dirs: list[Path] = []
    for candidate in src.rglob("*"):
        if candidate.is_dir() and candidate.name == "labels":
            label_dirs.append(candidate)
    if not label_dirs:
        return []

    pairs: list[tuple[Path, Path]] = []
    for lbl_dir in sorted(label_dirs):
        img_dir = lbl_dir.parent / "images"
        if not img_dir.is_dir():
            continue
        images = {
            p.stem: p for p in img_dir.iterdir()
            if p.suffix.lower() in IMAGE_SUFFIXES
        }
        for lbl in sorted(lbl_dir.glob("*.txt")):
            if lbl.stem == "classes":
                continue
            img = images.get(lbl.stem)
            if img is not None:
                pairs.append((img, lbl))
    return pairs


def inspect(src: Path) -> int:
    """Print the source's class vocabulary and id histogram, then stop.

    You cannot write a correct --map without this.
    """
    for name in ("data.yaml", "data.yml", "classes.txt"):
        for found in src.rglob(name):
            print(f"--- {found} ---")
            print(found.read_text(encoding="utf-8", errors="replace").strip())
            print()
            break

    pairs = find_pairs(src)
    if not pairs:
        print(f"error: no images/labels pairs found under {src}", file=sys.stderr)
        return 1

    histogram: Counter[int] = Counter()
    for _, lbl in pairs:
        for line in lbl.read_text(encoding="utf-8", errors="replace").splitlines():
            parts = line.split()
            if len(parts) == 5 and parts[0].lstrip("-").isdigit():
                histogram[int(parts[0])] += 1

    print(f"{len(pairs)} image/label pairs")
    print("\nboxes by source class id:")
    for class_id, count in sorted(histogram.items()):
        print(f"  id {class_id}: {count}")
    print("\nNow write --map, e.g. --map \"0=mango,2=stem\".")
    print("Unnamed ids are dropped.")
    return 0


def parse_map(text: str) -> dict[int, int]:
    mapping: dict[int, int] = {}
    for piece in text.split(","):
        piece = piece.strip()
        if not piece:
            continue
        if "=" not in piece:
            raise ValueError(f"bad --map entry {piece!r}, expected <id>=<class>")
        raw_id, name = (part.strip() for part in piece.split("=", 1))
        if name not in TARGET_CLASSES:
            raise ValueError(
                f"{name!r} is not one of {sorted(TARGET_CLASSES)} - "
                "merging can only produce your existing two classes"
            )
        mapping[int(raw_id)] = TARGET_CLASSES[name]
    if not mapping:
        raise ValueError("--map is empty")
    return mapping


def existing_hashes(dest: Path) -> dict[str, str]:
    """Hash every image already in the dataset, across all splits."""
    seen: dict[str, str] = {}
    for split in SPLITS:
        img_dir = dest / "images" / split
        if not img_dir.is_dir():
            continue
        for p in sorted(img_dir.iterdir()):
            if p.suffix.lower() in IMAGE_SUFFIXES:
                seen[sha256(p)] = f"{split}/{p.name}"
    return seen


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", required=True, help="the dataset to merge in")
    parser.add_argument("--dest", default="data/detector_dataset")
    parser.add_argument("--map", help='e.g. "0=mango,1=stem"; required unless --inspect')
    parser.add_argument("--split", default="train", choices=SPLITS,
                        help="destination split (default: train - read the docstring)")
    parser.add_argument("--prefix", default=None,
                        help="filename prefix for merged images "
                             "(default: the source directory name)")
    parser.add_argument("--max-side", type=int, default=1280)
    parser.add_argument("--quality", type=int, default=88)
    parser.add_argument("--inspect", action="store_true",
                        help="print the source's classes and box counts, then exit")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    src, dest = Path(args.src).expanduser(), Path(args.dest)
    if not src.is_dir():
        print(f"error: {src} does not exist", file=sys.stderr)
        return 1

    if args.inspect:
        return inspect(src)

    if not args.map:
        print("error: --map is required (run with --inspect first)", file=sys.stderr)
        return 1
    try:
        mapping = parse_map(args.map)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if not (dest / "images" / args.split).is_dir():
        print(f"error: {dest}/images/{args.split} not found - is --dest right?",
              file=sys.stderr)
        return 1

    if args.split != "train":
        print(f"WARNING: merging into '{args.split}' changes what your metrics "
              "measure and breaks comparison with earlier runs. See the "
              "docstring.\n")

    pairs = find_pairs(src)
    if not pairs:
        print(f"error: no images/labels pairs found under {src}", file=sys.stderr)
        return 1

    prefix = args.prefix or src.name.replace(" ", "_")[:40]
    print(f"source      {src}")
    print(f"pairs found {len(pairs)}")
    print(f"mapping     " + ", ".join(
        f"{k}->{v}" for k, v in sorted(mapping.items())))
    print(f"destination {dest}/images/{args.split}")
    print(f"prefix      {prefix}_\n")

    print("hashing existing images to reject duplicates...", flush=True)
    seen = existing_hashes(dest)
    print(f"  {len(seen)} already in the dataset\n")

    added = 0
    boxes: Counter[str] = Counter()
    dropped_ids: Counter[int] = Counter()
    duplicates: list[str] = []
    no_boxes: list[str] = []
    failures: list[str] = []
    inv = {v: k for k, v in TARGET_CLASSES.items()}

    for img_path, lbl_path in pairs:
        digest = sha256(img_path)
        if digest in seen:
            duplicates.append(f"{img_path.name} == {seen[digest]}")
            continue

        lines: list[str] = []
        for raw in lbl_path.read_text(encoding="utf-8", errors="replace").splitlines():
            parts = raw.split()
            if len(parts) != 5:
                continue
            try:
                src_id = int(parts[0])
                coords = [float(v) for v in parts[1:]]
            except ValueError:
                continue
            if src_id not in mapping:
                dropped_ids[src_id] += 1
                continue
            if not all(0.0 <= v <= 1.0 for v in coords):
                continue
            new_id = mapping[src_id]
            boxes[inv[new_id]] += 1
            lines.append(f"{new_id} " + " ".join(f"{v:.6f}" for v in coords))

        if not lines:
            no_boxes.append(img_path.name)
            continue

        stem = f"{prefix}_{img_path.stem}"
        if args.dry_run:
            seen[digest] = f"{args.split}/{stem}.jpg"
            added += 1
            continue

        try:
            with Image.open(img_path) as im:
                im.draft("RGB", (args.max_side, args.max_side))
                width, height = im.size
                out_img = dest / "images" / args.split / f"{stem}.jpg"
                if max(width, height) <= args.max_side and img_path.suffix.lower() in {".jpg", ".jpeg"}:
                    out_img.write_bytes(img_path.read_bytes())
                else:
                    scale = min(1.0, args.max_side / max(width, height))
                    size = (max(1, round(width * scale)), max(1, round(height * scale)))
                    im.convert("RGB").resize(size, Image.LANCZOS).save(
                        out_img, "JPEG", quality=args.quality, optimize=True)
        except OSError as exc:
            failures.append(f"{img_path.name}: {exc}")
            continue

        (dest / "labels" / args.split / f"{stem}.txt").write_text(
            "\n".join(lines) + "\n", encoding="utf-8")
        seen[digest] = f"{args.split}/{stem}.jpg"
        added += 1

    print("=" * 62)
    print(f"{'would add' if args.dry_run else 'added':<12}{added:>6} images to {args.split}")
    for name in sorted(boxes):
        print(f"  {name:<10}{boxes[name]:>6} boxes")

    def show(title: str, items: list[str], limit: int = 5) -> None:
        if not items:
            return
        print(f"\n{title} ({len(items)})")
        for item in items[:limit]:
            print(f"  {item}")
        if len(items) > limit:
            print(f"  ... and {len(items) - limit} more")

    show("skipped: already in the dataset", duplicates)
    show("skipped: no mapped box survived", no_boxes)
    show("skipped: unreadable", failures)

    if dropped_ids:
        print("\ndropped boxes by unmapped source id")
        for src_id, count in sorted(dropped_ids.items()):
            print(f"  id {src_id}: {count}   (add it to --map if this is wrong)")

    if not args.dry_run and added:
        total = len(list((dest / "images" / args.split).glob("*.jpg")))
        print(f"\n{args.split} split now holds {total} images")
        print("Re-zip and re-upload to Kaggle to use it.")
    print("=" * 62)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
