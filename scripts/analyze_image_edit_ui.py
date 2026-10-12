#!/usr/bin/env python3
"""Summarize a ComfyUI UI/workspace image-edit workflow (not API format)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    path = Path(
        sys.argv[1]
        if len(sys.argv) > 1
        else ROOT / "llm_workflow" / "image_qwen_image_2_1_image_edit.json"
    )
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data.get("nodes"), list):
        print("This looks like API format already (no top-level nodes[]).")
        print("You can run: python scripts/inspect_workflow.py", path)
        return 0

    print(f"File: {path.name}")
    print("Format: UI / workspace (CANNOT be loaded by FastAPI yet)")
    print()
    print("Top-level nodes:")
    for n in data["nodes"]:
        nid = n.get("id")
        ntype = n.get("type")
        title = (n.get("title") or n.get("properties", {}).get("Node name for S&R") or "")
        print(f"  id={nid:<6} type={ntype}  {title}")

    print()
    print("LoadImage nodes (edit target / references):")
    for n in data["nodes"]:
        if n.get("type") != "LoadImage":
            continue
        named = n.get("widgets_values_named") or {}
        values = n.get("widgets_values") or []
        image = named.get("image") or (values[0] if values else None)
        print(f"  id={n.get('id')}  image={image!r}")

    print()
    print("IMPORTANT next step:")
    print("  In ComfyUI: open this workflow → File → Export (API)")
    print("  Save as: llm_workflow/workflow_image_edit_api.json")
    print("  Then run: python scripts/inspect_workflow.py llm_workflow/workflow_image_edit_api.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
