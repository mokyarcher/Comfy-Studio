#!/usr/bin/env python3
"""Convert video_wan2_2_5B_ti2v.json (UI) → flat ComfyUI API workflow for image_to_video."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent

# ComfyUI UI widget order → API input names (core nodes used by this workflow)
WIDGET_MAP: dict[str, list[str]] = {
    "UNETLoader": ["unet_name", "weight_dtype"],
    "CLIPLoader": ["clip_name", "type", "device"],
    "VAELoader": ["vae_name"],
    "CLIPTextEncode": ["text"],
    "KSampler": ["seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"],
    "ModelSamplingSD3": ["shift"],
    "Wan22ImageToVideoLatent": ["width", "height", "length", "batch_size"],
    "CreateVideo": ["fps"],
    "SaveVideo": ["filename_prefix", "format", "codec"],
    "LoadImage": ["image"],
}

SKIP_TYPES = {"MarkdownNote", "Note", "Reroute"}


def convert(ui: dict[str, Any], *, enable_load_image: bool = True) -> dict[str, Any]:
    nodes = {n["id"]: n for n in ui.get("nodes") or [] if isinstance(n, dict)}
    # link_id → (from_id, from_slot, to_id, to_slot)
    links: dict[int, tuple[int, int, int, int]] = {}
    for link in ui.get("links") or []:
        if not isinstance(link, list) or len(link) < 5:
            continue
        lid, from_id, from_slot, to_id, to_slot = link[:5]
        links[int(lid)] = (int(from_id), int(from_slot), int(to_id), int(to_slot))

    api: dict[str, Any] = {}
    for node_id, node in nodes.items():
        class_type = str(node.get("type") or "")
        if class_type in SKIP_TYPES:
            continue
        # mode 4 = bypassed in UI; for i2v we force-enable LoadImage
        mode = int(node.get("mode") or 0)
        if mode == 4 and not (enable_load_image and class_type == "LoadImage"):
            continue

        inputs: dict[str, Any] = {}
        widget_names = WIDGET_MAP.get(class_type, [])
        values = list(node.get("widgets_values") or [])
        # KSampler UI inserts control_after_generate after seed
        if class_type == "KSampler" and len(values) >= 2 and isinstance(values[1], str):
            values = [values[0], *values[2:]]
        # LoadImage may have upload type as second widget
        if class_type == "LoadImage" and values:
            values = [values[0]]

        for i, name in enumerate(widget_names):
            if i < len(values):
                inputs[name] = values[i]

        for inp in node.get("inputs") or []:
            if not isinstance(inp, dict):
                continue
            name = inp.get("name")
            link_id = inp.get("link")
            if not name or link_id is None:
                continue
            link = links.get(int(link_id))
            if not link:
                continue
            from_id, from_slot, _to_id, _to_slot = link
            inputs[name] = [str(from_id), int(from_slot)]

        api[str(node_id)] = {
            "class_type": class_type,
            "inputs": inputs,
            "_meta": {"title": node.get("title") or class_type},
        }

    # Ensure i2v start_image is wired even if LoadImage was bypassed in UI
    if enable_load_image and "56" in api and "55" in api:
        api["55"]["inputs"]["start_image"] = ["56", 0]

    return api


def main() -> int:
    src = Path(
        sys.argv[1] if len(sys.argv) > 1 else ROOT / "llm_workflow" / "video_wan2_2_5B_ti2v.json"
    )
    dst = Path(
        sys.argv[2]
        if len(sys.argv) > 2
        else ROOT / "llm_workflow" / "workflow_image_to_video_api.json"
    )
    ui = json.loads(src.read_text(encoding="utf-8"))
    api = convert(ui, enable_load_image=True)
    dst.write_text(json.dumps(api, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {dst} ({len(api)} nodes)")
    for nid, node in sorted(api.items(), key=lambda x: int(x[0]) if x[0].isdigit() else x[0]):
        print(f"  {nid}: {node['class_type']} inputs={sorted(node['inputs'].keys())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
