"""Move legacy data/* runtime files into data/instances/{INSTANCE_ID}/.

Usage (PowerShell):
  .\\.venv\\Scripts\\python.exe scripts\\migrate_data_to_instance.py
  .\\.venv\\Scripts\\python.exe scripts\\migrate_data_to_instance.py --instance qwen-image
  .\\.venv\\Scripts\\python.exe scripts\\migrate_data_to_instance.py --dry-run

Does not move llm_workflow or anything outside the known runtime filenames.
Skips files already under data/instances/.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

RUNTIME_NAMES = (
    "tasks.db",
    "images",
    "showcase.db",
    "showcase",
    "cloud_gallery.db",
    "cloud_gallery",
    "prompt_library.json",
    "shared_prompts.db",
    "translate_cache.db",
    "polish_quota.db",
    "users.db",
    "admin_sms.db",
    "email_reset.db",
    "works.db",
)


def sanitize(raw: str) -> str:
    import re

    s = re.sub(r"[^a-zA-Z0-9._-]+", "-", (raw or "default").strip())
    s = s.strip(".-")[:64]
    return s or "default"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--instance",
        default=os.environ.get("INSTANCE_ID", "default"),
        help="Target INSTANCE_ID (default: env INSTANCE_ID or 'default')",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned moves only",
    )
    args = parser.parse_args()
    instance = sanitize(args.instance)
    dest_root = DATA / "instances" / instance

    if not DATA.is_dir():
        print(f"No data dir at {DATA}")
        return 0

    planned: list[tuple[Path, Path]] = []
    for name in RUNTIME_NAMES:
        src = DATA / name
        if not src.exists():
            continue
        dest = dest_root / name
        if dest.exists():
            print(f"skip (exists): {dest.relative_to(ROOT)}")
            continue
        planned.append((src, dest))

    if not planned:
        print(f"Nothing to migrate → {dest_root.relative_to(ROOT)}")
        return 0

    print(f"Target instance: {instance}")
    for src, dest in planned:
        print(f"  {src.relative_to(ROOT)} → {dest.relative_to(ROOT)}")

    if args.dry_run:
        print("dry-run: no files moved")
        return 0

    dest_root.mkdir(parents=True, exist_ok=True)
    for src, dest in planned:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dest))
        print(f"moved {src.name}")

    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
