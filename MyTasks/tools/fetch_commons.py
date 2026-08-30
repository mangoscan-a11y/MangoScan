"""Download images from a Wikimedia Commons category.

    python tools/fetch_commons.py --category "Mangifera caesia" \
        --label Wani --out data/raw/Wani

Small pools (10-20 files per species category) but every file is
freely licensed and the identification is usually sound. Worth running
for the species classes, where 15 clean images is a real contribution.

Writes an attribution CSV. Stdlib only - runs on Python 3.14.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://commons.wikimedia.org/w/api.php"

#: Wikimedia's user-agent policy asks for a descriptive agent with a way to
#: contact whoever is running the script. Putting your own email in here
#: makes throttling noticeably less aggressive.
USER_AGENT = (
    "MangoScan-dataset-builder/1.0 "
    "(academic thesis dataset; contact: add-your-email-here)"
)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}

#: Commons returns HTTP 429 quickly for back-to-back anonymous requests.
#: One second between requests keeps it happy; the backoff handles the rest.
REQUEST_INTERVAL = 1.0

_last_request = 0.0


def _get(url: str, retries: int = 5) -> bytes:
    global _last_request

    for attempt in range(retries):
        gap = time.monotonic() - _last_request
        if gap < REQUEST_INTERVAL:
            time.sleep(REQUEST_INTERVAL - gap)

        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            _last_request = time.monotonic()
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == retries - 1:
                raise
            wait = 2 ** (attempt + 1)
            print(f"  rate limited, waiting {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def _api(**params: object) -> dict:
    params.setdefault("format", "json")
    return json.loads(_get(f"{API}?{urllib.parse.urlencode(params)}"))


def list_files(category: str) -> list[str]:
    payload = _api(
        action="query",
        list="categorymembers",
        cmtitle=f"Category:{category}",
        cmtype="file",
        cmlimit=500,
    )
    members = payload.get("query", {}).get("categorymembers", [])
    return [m["title"] for m in members]


def file_info(titles: list[str]) -> dict[str, dict]:
    """Resolve download URLs and licence metadata, 50 titles at a time."""
    info: dict[str, dict] = {}
    for start in range(0, len(titles), 50):
        payload = _api(
            action="query",
            titles="|".join(titles[start : start + 50]),
            prop="imageinfo",
            iiprop="url|extmetadata",
        )
        for page in payload.get("query", {}).get("pages", {}).values():
            images = page.get("imageinfo")
            if images:
                info[page["title"]] = images[0]
    return info


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--category", required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    titles = list_files(args.category)
    if not titles:
        print(
            f"error: category {args.category!r} has no files (does it exist?)",
            file=sys.stderr,
        )
        return 1

    print(f"Category:{args.category} - {len(titles)} files")

    out_dir = Path(args.out)
    slug = args.label.lower().replace(" ", "_")
    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict[str, str]] = []
    saved = 0

    for title, info in file_info(titles).items():
        url = info.get("url", "")
        stem = title.removeprefix("File:")
        suffix = Path(stem).suffix.lower()
        if suffix not in IMAGE_SUFFIXES:
            continue

        meta = info.get("extmetadata", {})
        # No `_v<n>` marker - each becomes its own single-view fruit.
        safe = "".join(c if c.isalnum() else "_" for c in Path(stem).stem)[:60]
        name = f"{slug}_wc_{safe}{suffix}"

        rows.append(
            {
                "filename": name,
                "source": f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(title)}",
                "license": meta.get("LicenseShortName", {}).get("value", ""),
                "artist": meta.get("Artist", {}).get("value", "")[:200],
            }
        )

        if args.dry_run:
            saved += 1
            continue

        target = out_dir / name
        if target.exists():
            saved += 1
            continue
        try:
            target.write_bytes(_get(url))
        except Exception as exc:  # noqa: BLE001 - one bad file is not fatal
            print(f"  skipped {name}: {exc}", file=sys.stderr)
            continue
        saved += 1

    if rows and not args.dry_run:
        credits = out_dir / f"ATTRIBUTION_{slug}_commons.csv"
        with credits.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        print(f"wrote {credits}")

    verb = "would download" if args.dry_run else "downloaded"
    print(f"{verb} {saved} images to {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
