#!/usr/bin/env python3
"""Convert image_qwen_image_2_1_image_edit.json (UI) → flat ComfyUI API workflow."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent

# Outer LoadImage node id → TextEncode images.* input name
OUTER_IMAGE_MAP = {
    470: "images.image_1",
    475: "images.image_2",
}


def _wvn(node: dict[str, Any]) -> dict[str, Any]:
    named = node.get("widgets_values_named")
    if isinstance(named, dict) and named:
        return named
    return {}


def _slot_index(node: dict[str, Any], input_name: str) -> int | None:
    for i, inp in enumerate(node.get("inputs") or []):
        if inp.get("name") == input_name:
            return i
    return None


def convert(ui: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(ui.get("nodes"), list):
        raise SystemExit("Expected UI/workspace format with nodes[]")

    subgraphs = (ui.get("definitions") or {}).get("subgraphs") or []
    if not subgraphs:
        raise SystemExit("No definitions.subgraphs found")
    sg = subgraphs[0]

    # Index outer nodes
    outer = {n["id"]: n for n in ui["nodes"] if isinstance(n, dict)}
    # Subgraph internal nodes
    inner = {n["id"]: n for n in sg["nodes"] if isinstance(n, dict)}

    # Subgraph links by id
    links = {lnk["id"]: lnk for lnk in (sg.get("links") or []) if isinstance(lnk, dict)}

    # Subgraph input name → origin for boundary (-10)
    # When origin is -10, value comes from outer subgraph instance widgets/links
    n459 = outer[459]
    n459_wvn = _wvn(n459)

    # Map subgraph input slot (origin_slot on -10) → input definition
    sg_inputs = list(sg.get("inputs") or [])
    # origin_slot on links from -10 matches index in sg inputs list
    # From probe: image_1 origin_slot 14 → sg_inputs[14]

    def resolve_boundary_value(origin_slot: int) -> Any:
        """Widget/default value for a subgraph input slot on node 459."""
        if origin_slot < 0 or origin_slot >= len(sg_inputs):
            return None
        inp_def = sg_inputs[origin_slot]
        name = inp_def.get("name")
        # Prefer named widgets on the subgraph instance
        if name in n459_wvn:
            return n459_wvn[name]
        # Also try label
        label = inp_def.get("label")
        if label and label in n459_wvn:
            return n459_wvn[label]
        return None

    # Outer image sources: LoadImage nodes linked into 459
    # Top links: [id, from_id, from_slot, to_id, to_slot, type]
    outer_links = ui.get("links") or []
    # 459 input slot index → outer LoadImage node id
    image_slot_to_load: dict[int, int] = {}
    for link in outer_links:
        if not isinstance(link, list) or len(link) < 5:
            continue
        _lid, from_id, from_slot, to_id, to_slot = link[:5]
        if to_id != 459:
            continue
        if from_id in OUTER_IMAGE_MAP:
            image_slot_to_load[to_slot] = from_id

    # Also map by name from 459 inputs
    load_by_input_name: dict[str, int] = {}
    for i, inp in enumerate(n459.get("inputs") or []):
        name = inp.get("name")
        link_id = inp.get("link")
        if not name or not str(name).startswith("images."):
            continue
        if link_id is None:
            continue
        # find outer link
        for link in outer_links:
            if isinstance(link, list) and link[0] == link_id:
                load_by_input_name[name] = link[1]
                break

    api: dict[str, Any] = {}

    # 1) Outer LoadImage nodes used as edit inputs
    for load_id, input_name in OUTER_IMAGE_MAP.items():
        node = outer.get(load_id)
        if not node:
            continue
        wvn = _wvn(node)
        image_name = wvn.get("image")
        if not image_name:
            vals = node.get("widgets_values") or []
            image_name = vals[0] if vals else "example.png"
        api[str(load_id)] = {
            "class_type": "LoadImage",
            "inputs": {"image": image_name},
            "_meta": {"title": f"LoadImage ({input_name})"},
        }

    # 2) Flatten subgraph compute nodes (skip virtual -10/-20)
    for node_id, node in inner.items():
        class_type = node["type"]
        inputs: dict[str, Any] = {}

        # Start with widget defaults
        wvn = _wvn(node)
        for key, val in wvn.items():
            if key == "control_after_generate":
                continue
            inputs[key] = val

        # Apply linked inputs
        for slot, inp in enumerate(node.get("inputs") or []):
            name = inp.get("name")
            if not name:
                continue
            link_id = inp.get("link")
            if link_id is None:
                # keep widget value if any; optional IMAGE can be omitted
                if name.startswith("images.") and name in inputs:
                    # shouldn't be in widgets
                    inputs.pop(name, None)
                continue

            link = links.get(link_id)
            if not link:
                continue
            origin_id = link["origin_id"]
            origin_slot = link["origin_slot"]

            if origin_id == -10:
                # Boundary: either outer LoadImage or widget on 459
                # Find which sg input this slot is
                if origin_slot < len(sg_inputs):
                    bname = sg_inputs[origin_slot].get("name")
                else:
                    bname = name

                if bname and str(bname).startswith("images."):
                    load_id = load_by_input_name.get(bname)
                    if load_id is not None:
                        inputs[name] = [str(load_id), 0]
                    else:
                        # optional unused image — omit
                        inputs.pop(name, None)
                else:
                    # primitive from subgraph widgets
                    # Prefer matching by input name on the target node
                    val = None
                    if bname and bname in n459_wvn:
                        val = n459_wvn[bname]
                    elif name in n459_wvn:
                        val = n459_wvn[name]
                    else:
                        val = resolve_boundary_value(origin_slot)
                    if val is not None:
                        inputs[name] = val
                    # else keep inner widget default
            else:
                inputs[name] = [str(origin_id), origin_slot]

        api[str(node_id)] = {
            "class_type": class_type,
            "inputs": inputs,
            "_meta": {"title": node.get("title") or class_type},
        }

    # 3) Wire ResolutionSelector → width/height on EmptyLatentImage if custom_size
    # Outer ResolutionSelector 13 feeds 459 width/height; store defaults from it
    res = outer.get(13)
    if res:
        rw = _wvn(res)
        # ResolutionSelector often has width/height in widgets_values_named
        width = rw.get("width")
        height = rw.get("height")
        if width is not None and "456" in api:
            # Only override EmptyLatentImage defaults; switch=false uses encode latent
            api["456"]["inputs"]["width"] = width
        if height is not None and "456" in api:
            api["456"]["inputs"]["height"] = height

    # 4) Always use built-in SaveImage for API (SaveImageAdvanced needs extra
    # format.bit_depth / color_space widgets that break prompt validation).
    save = outer.get(461)
    prefix = "qwen_image_edit"
    if save:
        sw = _wvn(save)
        prefix = sw.get("filename_prefix") or sw.get("prefix") or prefix
    api["461"] = {
        "class_type": "SaveImage",
        "inputs": {"filename_prefix": prefix, "images": ["457", 0]},
        "_meta": {"title": "SaveImage"},
    }

    # Ensure TextEncode has prompt from 459 widgets if empty
    if "474" in api:
        for key in ("prompt", "negative_prompt", "resolution"):
            if key in n459_wvn and (
                key not in api["474"]["inputs"]
                or api["474"]["inputs"].get(key) in ("", None)
            ):
                api["474"]["inputs"][key] = n459_wvn[key]
        # Ensure image_1 linked
        if "images.image_1" not in api["474"]["inputs"] and "470" in api:
            api["474"]["inputs"]["images.image_1"] = ["470", 0]
        if "images.image_2" not in api["474"]["inputs"] and "475" in api:
            api["474"]["inputs"]["images.image_2"] = ["475", 0]

    # KSampler seed/steps from 459 if present
    if "458" in api:
        for key in ("seed", "steps", "cfg", "sampler_name", "scheduler"):
            # 459 uses scheduler for sampler_name and scheduler_1 for scheduler
            if key == "sampler_name" and "scheduler" in n459_wvn:
                api["458"]["inputs"]["sampler_name"] = n459_wvn["scheduler"]
            elif key == "scheduler" and "scheduler_1" in n459_wvn:
                api["458"]["inputs"]["scheduler"] = n459_wvn["scheduler_1"]
            elif key in n459_wvn:
                api["458"]["inputs"][key] = n459_wvn[key]

    return api


def main() -> int:
    src = Path(
        sys.argv[1]
        if len(sys.argv) > 1
        else ROOT / "llm_workflow" / "image_qwen_image_2_1_image_edit.json"
    )
    dst = Path(
        sys.argv[2]
        if len(sys.argv) > 2
        else ROOT / "llm_workflow" / "workflow_image_edit_api.json"
    )
    ui = json.loads(src.read_text(encoding="utf-8"))
    api = convert(ui)
    dst.write_text(json.dumps(api, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {dst} ({len(api)} nodes)")
    for nid, node in sorted(api.items(), key=lambda x: int(x[0]) if x[0].isdigit() else x[0]):
        keys = sorted(node["inputs"].keys())
        print(f"  {nid}: {node['class_type']} inputs={keys}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
