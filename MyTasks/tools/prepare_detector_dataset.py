"""Turn the raw scraped detection dump into a trainable YOLO dataset.

    python tools/prepare_detector_dataset.py \
        --src data/mango_dataset --out data/detector_dataset

The dump in `data/mango_dataset` is not loadable by Ultralytics as it stands:

  1. `classes.txt` carries 17 labels, 15 of which are labelImg's default list
     (`dog`, `person`, `tv`, `meatballs`, ...). Only ids 15 and 16 are ever
     used, for `mango` and `stem`. Left alone, a `nc: 17` model wastes most of
     its head on classes that have no examples, and every confusion matrix you
     read is 17x17 with two populated rows.
  2. Two files in `test/` are orphans - one image with no label, one label
     with no image.
  3. There is no `data.yaml`, so there is nothing to point `model.train()` at.
  4. 17 GB of ~8 MB phone originals. Training at imgsz=640 reads none of that
     detail; it costs hours of upload and a slow dataloader for nothing.

This writes a clean copy - the source is never modified. Ids are remapped to
`0=mango, 1=stem`, orphans are dropped with a report, images are resized to a
1280px long edge, and `data.yaml` is generated.

Requires Pillow. Everything else is stdlib. Runs on Python 3.14.
"""

from __future__ import annotations

import argparse
import shutil
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

#: Source class id -> (new id, name). Every other id in the source is junk
#: from labelImg's default list and is dropped.
CLASS_MAP: dict[int, tuple[int, str]] = {
    15: (0, "mango"),
    16: (1, "stem"),
}
NAMES = [name for _, name in sorted(CLASS_MAP.values())]

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


class Report:
    """Everything the run wants to tell you at the end, in one place."""

    def __init__(self) -> None:
        self.kept: Counter[str] = Counter()
        self.boxes: Counter[str] = Counter()
        self.orphan_images: list[str] = []
        self.orphan_labels: list[str] = []
        self.dropped_classes: Counter[int] = Counter()
        self.bad_lines: list[str] = []
        self.empty_labels: list[str] = []
        self.unreadable: list[str] = []
        self.src_bytes = 0
        self.out_bytes = 0


def remap_label(text: str, rel: str, report: Report) -> str | None:
    """Rewrite one YOLO label file's class ids. `None` means nothing survived.

    A box whose class is not in CLASS_MAP is dropped, not renumbered - the
    alternative silently turns a `tv` annotation into a mango.
    """
    lines: list[str] = []
    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 5:
            report.bad_lines.append(f"{rel}:{lineno} expected 5 fields, got {len(parts)}")
            continue
        try:
            src_id = int(parts[0])
            coords = [float(v) for v in parts[1:]]
        except ValueError:
            report.bad_lines.append(f"{rel}:{lineno} non-numeric field")
            continue
        if src_id not in CLASS_MAP:
            report.dropped_classes[src_id] += 1
            continue
        if not all(0.0 <= v <= 1.0 for v in coords):
            report.bad_lines.append(f"{rel}:{lineno} coords outside [0,1]")
            continue
        new_id, name = CLASS_MAP[src_id]
        report.boxes[name] += 1
        lines.append(f"{new_id} " + " ".join(f"{v:.6f}" for v in coords))
    return "\n".join(lines) + "\n" if lines else None


def convert_image(src: Path, dst: Path, max_side: int, quality: int) -> int:
    """Resize onto the long edge and re-encode. Returns bytes written.

    Images already under `max_side` are copied verbatim rather than re-encoded,
    so a second pass over an already-prepared tree is lossless.
    """
    with Image.open(src) as im:
        im.draft("RGB", (max_side, max_side))  # cheap JPEG-native downscale
        width, height = im.size
        if max(width, height) <= max_side:
            shutil.copy2(src, dst)
            return dst.stat().st_size
        scale = max_side / max(width, height)
        size = (max(1, round(width * scale)), max(1, round(height * scale)))
        im = im.convert("RGB").resize(size, Image.LANCZOS)
        im.save(dst, "JPEG", quality=quality, optimize=True)
    return dst.stat().st_size


def process_split(
    split: str, src: Path, out: Path, max_side: int, quality: int, report: Report
) -> None:
    img_src = src / "images" / split
    lbl_src = src / "labels" / split
    if not img_src.is_dir():
        print(f"  {split}: no images/{split} directory, skipping")
        return

    img_out = out / "images" / split
    lbl_out = out / "labels" / split
    img_out.mkdir(parents=True, exist_ok=True)
    lbl_out.mkdir(parents=True, exist_ok=True)

    images = {
        p.stem: p
        for p in sorted(img_src.iterdir())
        if p.suffix.lower() in IMAGE_SUFFIXES
    }
    labels = {
        p.stem: p
        for p in sorted(lbl_src.iterdir())
        if p.suffix.lower() == ".txt" and p.stem != "classes"
    }

    for stem in sorted(set(images) - set(labels)):
        report.orphan_images.append(f"{split}/{images[stem].name}")
    for stem in sorted(set(labels) - set(images)):
        report.orphan_labels.append(f"{split}/{labels[stem].name}")

    for i, stem in enumerate(sorted(set(images) & set(labels)), start=1):
        img_path, lbl_path = images[stem], labels[stem]
        body = remap_label(
            lbl_path.read_text(encoding="utf-8", errors="replace"),
            f"{split}/{lbl_path.name}",
            report,
        )
        if body is None:
            # No surviving box. Ultralytics treats an image with an empty label
            # as a background negative, which is useful - but an image whose
            # only boxes were junk classes is more likely a mislabel than a
            # deliberate negative, so it is excluded and reported.
            report.empty_labels.append(f"{split}/{lbl_path.name}")
            continue
        report.src_bytes += img_path.stat().st_size
        try:
            report.out_bytes += convert_image(
                img_path, img_out / f"{stem}.jpg", max_side, quality
            )
        except OSError as exc:
            report.unreadable.append(f"{split}/{img_path.name}: {exc}")
            continue
        (lbl_out / f"{stem}.txt").write_text(body, encoding="utf-8")
        report.kept[split] += 1
        if i % 200 == 0:
            print(f"  {split}: {i} processed...", flush=True)


def write_data_yaml(out: Path) -> Path:
    """Ultralytics resolves `path` relative to its own settings, so absolute
    is the only form that behaves the same locally and on Colab."""
    path = out / "data.yaml"
    names = "\n".join(f"  {i}: {n}" for i, n in enumerate(NAMES))
    path.write_text(
        "# Generated by tools/prepare_detector_dataset.py - do not hand-edit.\n"
        "# `path` is rewritten on the training host; see the Colab notebook.\n"
        f"path: {out.resolve().as_posix()}\n"
        "train: images/train\n"
        "val: images/val\n"
        "test: images/test\n"
        f"nc: {len(NAMES)}\n"
        f"names:\n{names}\n",
        encoding="utf-8",
    )
    return path


def human(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


def print_report(report: Report, out: Path, yaml_path: Path) -> None:
    print("\n" + "=" * 62)
    print("kept per split")
    for split in SPLITS:
        print(f"  {split:<6} {report.kept[split]:>5} images")
    total = sum(report.kept.values())
    print(f"  {'total':<6} {total:>5} images")

    print("\nboxes")
    for name in NAMES:
        print(f"  {name:<6} {report.boxes[name]:>5}")
    if total:
        print(f"  mango boxes per image: {report.boxes['mango'] / total:.2f}")

    if report.src_bytes:
        pct = 100 * (1 - report.out_bytes / report.src_bytes)
        print(f"\nsize  {human(report.src_bytes)} -> {human(report.out_bytes)}"
              f"  ({pct:.1f}% smaller)")

    def show(title: str, items: list[str], limit: int = 10) -> None:
        if not items:
            return
        print(f"\n{title} ({len(items)})")
        for item in items[:limit]:
            print(f"  {item}")
        if len(items) > limit:
            print(f"  ... and {len(items) - limit} more")

    show("dropped: image with no label", report.orphan_images)
    show("dropped: label with no image", report.orphan_labels)
    show("dropped: no box survived remapping", report.empty_labels)
    show("malformed label lines", report.bad_lines)
    show("unreadable images", report.unreadable)

    if report.dropped_classes:
        print("\ndropped boxes by source class id")
        for src_id, count in sorted(report.dropped_classes.items()):
            print(f"  id {src_id}: {count}")

    print(f"\nwrote {yaml_path}")
    print(f"ready: {out}")
    print("=" * 62)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", default="data/mango_dataset")
    parser.add_argument("--out", default="data/detector_dataset")
    parser.add_argument(
        "--max-side", type=int, default=1280,
        help="long-edge pixels; 1280 leaves headroom over imgsz=640 (default: 1280)",
    )
    parser.add_argument("--quality", type=int, default=88, help="JPEG quality (default: 88)")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="report what would change without writing anything",
    )
    args = parser.parse_args(argv)

    src, out = Path(args.src), Path(args.out)
    if not src.is_dir():
        print(f"error: {src} does not exist", file=sys.stderr)
        return 1

    if args.dry_run:
        print(f"dry run - inspecting {src}, writing nothing\n")
        report = Report()
        for split in SPLITS:
            img_src, lbl_src = src / "images" / split, src / "labels" / split
            if not img_src.is_dir():
                continue
            images = {p.stem for p in img_src.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES}
            labels = {
                p.stem for p in lbl_src.iterdir()
                if p.suffix.lower() == ".txt" and p.stem != "classes"
            } if lbl_src.is_dir() else set()
            for stem in sorted(images - labels):
                report.orphan_images.append(f"{split}/{stem}")
            for stem in sorted(labels - images):
                report.orphan_labels.append(f"{split}/{stem}")
            report.kept[split] = len(images & labels)
            for stem in sorted(images & labels):
                remap_label(
                    (lbl_src / f"{stem}.txt").read_text(encoding="utf-8", errors="replace"),
                    f"{split}/{stem}.txt", report,
                )
        print_report(report, out, out / "data.yaml")
        return 0

    if out.exists():
        print(f"error: {out} already exists - remove it or pass a different --out",
              file=sys.stderr)
        return 1

    print(f"reading  {src}")
    print(f"writing  {out}")
    print(f"resizing to {args.max_side}px long edge, quality {args.quality}\n")
    report = Report()
    for split in SPLITS:
        process_split(split, src, out, args.max_side, args.quality, report)
    yaml_path = write_data_yaml(out)
    print_report(report, out, yaml_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
