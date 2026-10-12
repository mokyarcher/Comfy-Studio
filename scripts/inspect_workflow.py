#!/usr/bin/env python3
"""Print node IDs / class_type / inputs to help fill workflow_mapping.json."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.workflow import WorkflowError, inspect_workflow  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect ComfyUI workflow JSON")
    parser.add_argument(
        "path",
        nargs="?",
        default=str(ROOT / "llm_workflow" / "workflow_api.json"),
        help="Path to workflow JSON (API or UI format)",
    )
    args = parser.parse_args()
    path = Path(args.path)
    try:
        rows = inspect_workflow(path)
    except WorkflowError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(rows, ensure_ascii=False, indent=2))
    print("\nSuggested mapping fields: positive_prompt, negative_prompt, width, height, steps, seed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
