from __future__ import annotations

import copy
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

MAPPABLE_FIELDS = (
    "positive_prompt",
    "negative_prompt",
    "width",
    "height",
    "steps",
    "seed",
)

# Optional slots (image_edit / image_to_video)
OPTIONAL_FIELDS = (
    "custom_size",
    "length",
    *(f"image_{i}" for i in range(1, 11)),
)

WorkflowMode = str  # "txt2img" | "image_edit" | "image_to_video"


@dataclass(frozen=True)
class FieldMapping:
    node_id: str
    input_name: str


@dataclass
class WorkflowBundle:
    workflow: dict[str, Any]
    mappings: dict[str, FieldMapping | None]
    path: Path
    mapping_path: Path
    mode: WorkflowMode = "txt2img"


@dataclass
class WorkflowRegistry:
    """Holds one or more named workflow bundles (txt2img, image_edit, ...)."""

    bundles: dict[str, WorkflowBundle] = field(default_factory=dict)

    def get(self, mode: str) -> WorkflowBundle:
        bundle = self.bundles.get(mode)
        if bundle is None:
            available = ", ".join(sorted(self.bundles)) or "(none)"
            raise WorkflowError(
                f"Workflow mode {mode!r} is not configured. Available: {available}"
            )
        return bundle

    def has(self, mode: str) -> bool:
        return mode in self.bundles

    @property
    def modes(self) -> list[str]:
        return sorted(self.bundles.keys())


class WorkflowError(Exception):
    """Invalid workflow or mapping configuration."""


def _load_json(path: Path) -> Any:
    if not path.exists():
        raise WorkflowError(f"File not found: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkflowError(f"Invalid JSON in {path}: {exc}") from exc


def _ensure_api_format(data: Any, path: Path) -> dict[str, Any]:
    if not isinstance(data, dict) or not data:
        raise WorkflowError(f"Workflow must be a non-empty object: {path}")

    # UI / workspace format uses a nodes array instead of node-id keys.
    if isinstance(data.get("nodes"), list):
        raise WorkflowError(
            f"{path} looks like a ComfyUI UI/workspace workflow, not API format. "
            "Use File → Export (API) in ComfyUI, or run "
            "scripts/convert_image_edit_ui_to_api.py for the edit workflow."
        )

    node_items = {
        key: value
        for key, value in data.items()
        if isinstance(value, dict) and ("class_type" in value or "inputs" in value)
    }
    if not node_items:
        raise WorkflowError(
            f"{path} contains no API nodes with class_type/inputs. "
            "Export API format from ComfyUI before starting the service."
        )

    for node_id, node in node_items.items():
        if "class_type" not in node:
            raise WorkflowError(
                f"Node {node_id!r} missing class_type in {path}. "
                "This file is not a ComfyUI API-format workflow."
            )
        if "inputs" not in node or not isinstance(node["inputs"], dict):
            raise WorkflowError(f"Node {node_id!r} missing inputs object in {path}")
    return data


def _parse_mapping_entry(field: str, value: Any) -> FieldMapping | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise WorkflowError(f"Mapping for {field} must be an object or null")
    node_id = value.get("node_id")
    input_name = value.get("input")
    if not node_id or not input_name:
        raise WorkflowError(f"Mapping for {field} requires node_id and input")
    return FieldMapping(node_id=str(node_id), input_name=str(input_name))


def load_workflow_bundle(
    workflow_path: Path,
    mapping_path: Path,
    *,
    mode: WorkflowMode = "txt2img",
) -> WorkflowBundle:
    workflow = _ensure_api_format(_load_json(workflow_path), workflow_path)
    raw_mapping = _load_json(mapping_path)
    if not isinstance(raw_mapping, dict):
        raise WorkflowError(f"Mapping file must be a JSON object: {mapping_path}")

    mappings: dict[str, FieldMapping | None] = {}
    for field_name in MAPPABLE_FIELDS:
        if field_name not in raw_mapping:
            raise WorkflowError(f"Mapping missing required field: {field_name}")
        mappings[field_name] = _parse_mapping_entry(field_name, raw_mapping[field_name])

    for field_name in OPTIONAL_FIELDS:
        if field_name in raw_mapping:
            mappings[field_name] = _parse_mapping_entry(field_name, raw_mapping[field_name])

    if mode in ("image_edit", "image_to_video") and mappings.get("image_1") is None:
        raise WorkflowError(
            f"{mode} mapping must define image_1 (LoadImage): {mapping_path}"
        )

    validate_mappings(workflow, mappings)
    logger.info(
        "Loaded workflow mode=%s file=%s mapping=%s",
        mode,
        workflow_path.name,
        mapping_path.name,
    )
    return WorkflowBundle(
        workflow=workflow,
        mappings=mappings,
        path=workflow_path,
        mapping_path=mapping_path,
        mode=mode,
    )


def load_workflow_registry(
    *,
    txt2img_workflow: Path,
    txt2img_mapping: Path,
    image_edit_workflow: Path | None = None,
    image_edit_mapping: Path | None = None,
    image_to_video_workflow: Path | None = None,
    image_to_video_mapping: Path | None = None,
) -> WorkflowRegistry:
    bundles: dict[str, WorkflowBundle] = {
        "txt2img": load_workflow_bundle(
            txt2img_workflow, txt2img_mapping, mode="txt2img"
        )
    }
    if image_edit_workflow is not None and image_edit_mapping is not None:
        if image_edit_workflow.exists() and image_edit_mapping.exists():
            bundles["image_edit"] = load_workflow_bundle(
                image_edit_workflow, image_edit_mapping, mode="image_edit"
            )
        else:
            missing = [
                str(p)
                for p in (image_edit_workflow, image_edit_mapping)
                if not p.exists()
            ]
            logger.warning(
                "image_edit workflow not loaded (missing: %s); txt2img only",
                ", ".join(missing),
            )
    if image_to_video_workflow is not None and image_to_video_mapping is not None:
        if image_to_video_workflow.exists() and image_to_video_mapping.exists():
            bundles["image_to_video"] = load_workflow_bundle(
                image_to_video_workflow,
                image_to_video_mapping,
                mode="image_to_video",
            )
        else:
            missing = [
                str(p)
                for p in (image_to_video_workflow, image_to_video_mapping)
                if not p.exists()
            ]
            logger.warning(
                "image_to_video workflow not loaded (missing: %s)",
                ", ".join(missing),
            )
    return WorkflowRegistry(bundles=bundles)


def validate_mappings(
    workflow: dict[str, Any],
    mappings: dict[str, FieldMapping | None],
) -> None:
    for field_name, mapping in mappings.items():
        if mapping is None:
            if field_name in ("negative_prompt", "custom_size", "length") or field_name.startswith(
                "image_"
            ):
                continue
            raise WorkflowError(f"Mapping for {field_name} cannot be null")
        node = workflow.get(mapping.node_id)
        if node is None:
            raise WorkflowError(
                f"Mapping {field_name}: node_id {mapping.node_id!r} not found in workflow"
            )
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            raise WorkflowError(
                f"Mapping {field_name}: node {mapping.node_id!r} has invalid inputs"
            )
        if mapping.input_name not in inputs:
            available = ", ".join(sorted(inputs.keys())) or "(none)"
            raise WorkflowError(
                f"Mapping {field_name}: input {mapping.input_name!r} not found on node "
                f"{mapping.node_id!r} ({node.get('class_type')}). Available: {available}"
            )


def _prune_unused_edit_images(
    workflow: dict[str, Any],
    bundle: WorkflowBundle,
    *,
    provided_count: int,
) -> None:
    """Drop optional LoadImage slots that were not uploaded (avoids Comfy 400)."""
    for index in range(provided_count + 1, 11):
        field_name = f"image_{index}"
        mapping = bundle.mappings.get(field_name)
        if mapping is None:
            continue
        load_id = mapping.node_id
        workflow.pop(load_id, None)
        image_key = f"images.image_{index}"
        for node in workflow.values():
            if not isinstance(node, dict):
                continue
            inputs = node.get("inputs")
            if not isinstance(inputs, dict):
                continue
            if image_key in inputs:
                del inputs[image_key]
            for key, value in list(inputs.items()):
                if (
                    isinstance(value, list)
                    and value
                    and str(value[0]) == load_id
                    and str(key).startswith("images.")
                ):
                    del inputs[key]


def apply_parameters(
    bundle: WorkflowBundle,
    *,
    prompt: str,
    negative_prompt: str | None,
    width: int | None,
    height: int | None,
    steps: int | None,
    seed: int,
    images: list[str] | None = None,
    length: int | None = None,
) -> dict[str, Any]:
    workflow = copy.deepcopy(bundle.workflow)

    def set_field(field_name: str, value: Any) -> None:
        mapping = bundle.mappings.get(field_name)
        if mapping is None:
            if field_name in ("negative_prompt", "custom_size", "length") or field_name.startswith(
                "image_"
            ):
                return
            raise WorkflowError(f"No mapping configured for {field_name}")
        workflow[mapping.node_id]["inputs"][mapping.input_name] = value

    set_field("positive_prompt", prompt)
    if negative_prompt is not None:
        set_field("negative_prompt", negative_prompt)
    if width is not None:
        set_field("width", width)
    if height is not None:
        set_field("height", height)
    if steps is not None:
        set_field("steps", steps)
    set_field("seed", seed)
    if length is not None:
        set_field("length", length)

    # Optional custom canvas for edit workflows (EmptyLatentImage + switch)
    if (width is not None or height is not None) and bundle.mappings.get("custom_size"):
        set_field("custom_size", True)

    provided = list(images or [])
    if provided:
        for index, filename in enumerate(provided, start=1):
            field_name = f"image_{index}"
            mapping = bundle.mappings.get(field_name)
            if mapping is None:
                if index == 1:
                    raise WorkflowError(
                        f"Workflow mode {bundle.mode!r} has no image_1 mapping"
                    )
                raise WorkflowError(
                    f"Too many images: slot {field_name} is not mapped "
                    f"(max mapped slot before this)"
                )
            set_field(field_name, filename)

    if bundle.mode == "image_edit":
        _prune_unused_edit_images(workflow, bundle, provided_count=len(provided))

    return workflow


def inspect_workflow(workflow_path: Path) -> list[dict[str, Any]]:
    data = _load_json(workflow_path)
    if isinstance(data, dict) and isinstance(data.get("nodes"), list):
        rows = []
        for node in data["nodes"]:
            if not isinstance(node, dict):
                continue
            wvn = node.get("widgets_values_named") or {}
            rows.append(
                {
                    "id": str(node.get("id")),
                    "class_type": node.get("type"),
                    "title": node.get("title"),
                    "format": "ui",
                    "widget_inputs": list(wvn.keys()) if isinstance(wvn, dict) else [],
                }
            )
        return rows

    workflow = _ensure_api_format(data, workflow_path)
    rows = []
    for node_id, node in workflow.items():
        if not isinstance(node, dict) or "class_type" not in node:
            continue
        inputs = node.get("inputs") or {}
        rows.append(
            {
                "id": str(node_id),
                "class_type": node.get("class_type"),
                "title": (node.get("_meta") or {}).get("title"),
                "format": "api",
                "inputs": sorted(inputs.keys()),
            }
        )
    return rows
