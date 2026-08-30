"""Download CC-licensed fruit photos from iNaturalist for one taxon.

    python tools/fetch_inaturalist.py --taxon-id 359080 --label Wani \
        --out data/raw/Wani --max 200

iNaturalist is the only source in this project that gives *verified*
species labels: every research-grade observation has been confirmed by
two or more identifiers. That makes it the right source for the classes
that are distinct species (Wani, and probably Kabayo). It is useless for
telling Carabao from Apple Mango, which are both Mangifera indica.

Writes an attribution CSV alongside the images. Keep it: CC-BY and
CC-BY-NC both require credit, and a thesis appendix is exactly where a
reviewer will look for it.

Stdlib only - runs on Python 3.14.
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

API = "https://api.inaturalist.org/v1/observations"

#: Photo licences we are willing to redistribute in an academic dataset.
#: `all rights reserved` photos are deliberately excluded.
OPEN_LICENSES = ("cc0", "cc-by", "cc-by-nc", "cc-by-sa", "cc-by-nc-sa")

USER_AGENT = "MangoScan-dataset-builder/1.0 (academic use)"

#: iNaturalist serves several sizes; `large` is ~1024px on the long edge,
#: which is plenty for a 224px classifier and kinder to their bandwidth
#: than `original`.
PHOTO_SIZE = "large"


def _get(url: str, retries: int = 3) -> bytes:
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            print(f"  retry in {wait}s ({exc})", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def fetch_page(
    taxon_id: int, page: int, research_only: bool, place_id: int | None = None
) -> dict:
    params = {
        "taxon_id": taxon_id,
        "photos": "true",
        "per_page": 200,
        "page": page,
        "photo_license": ",".join(OPEN_LICENSES),
        "order_by": "votes",
    }
    if research_only:
        params["quality_grade"] = "research"
    if place_id:
        params["place_id"] = place_id
    return json.loads(_get(f"{API}?{urllib.parse.urlencode(params)}"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--taxon-id", type=int, required=True)
    parser.add_argument("--label", required=True, help="class name, for filenames")
    parser.add_argument("--out", required=True)
    parser.add_argument("--max", type=int, default=300)
    parser.add_argument(
        "--all-grades",
        action="store_true",
        help="include needs-id observations (more images, weaker labels)",
    )
    parser.add_argument(
        "--place-id",
        type=int,
        default=None,
        help="restrict to an iNaturalist place (6873 = Philippines)",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    out_dir = Path(args.out)
    slug = args.label.lower().replace(" ", "_")

    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict[str, str]] = []
    downloaded = 0
    page = 1

    while downloaded < args.max:
        payload = fetch_page(
            args.taxon_id, page, not args.all_grades, args.place_id
        )
        results = payload.get("results", [])
        if not results:
            break

        print(
            f"page {page}: {len(results)} observations "
            f"(of {payload.get('total_results', '?')} total)"
        )

        for observation in results:
            for photo in observation.get("photos", []):
                if downloaded >= args.max:
                    break

                url = photo.get("url", "").replace("square", PHOTO_SIZE)
                if not url:
                    continue

                suffix = Path(urllib.parse.urlparse(url).path).suffix.lower() or ".jpg"
                # No `_v<n>` marker: the pipeline treats each of these as its
                # own single-view fruit, which is correct for web images.
                name = f"{slug}_inat{observation['id']}_{photo['id']}{suffix}"
                target = out_dir / name

                rows.append(
                    {
                        "filename": name,
                        "observation": f"https://www.inaturalist.org/observations/{observation['id']}",
                        "photo_license": photo.get("license_code") or "",
                        "attribution": photo.get("attribution") or "",
                        "observed_on": observation.get("observed_on") or "",
                        "place": observation.get("place_guess") or "",
                        "quality_grade": observation.get("quality_grade") or "",
                    }
                )

                if args.dry_run:
                    downloaded += 1
                    continue

                if target.exists():
                    downloaded += 1
                    continue

                try:
                    target.write_bytes(_get(url))
                except Exception as exc:  # noqa: BLE001 - one bad photo is not fatal
                    print(f"  skipped {name}: {exc}", file=sys.stderr)
                    continue

                downloaded += 1
                # iNaturalist asks for <= 60 requests/minute. This is well under.
                time.sleep(0.4)

        if len(results) < 200:
            break
        page += 1

    if rows and not args.dry_run:
        credits = out_dir / f"ATTRIBUTION_{slug}.csv"
        with credits.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        print(f"\nwrote {credits}")

    verb = "would download" if args.dry_run else "downloaded"
    print(f"{verb} {downloaded} photos to {out_dir}")

    if downloaded < 60:
        print(
            f"\nwarning: {downloaded} images is below the 60-fruit floor for a "
            f"class. Supplement from the other sources in the guide.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
