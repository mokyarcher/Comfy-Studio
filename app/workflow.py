from __future__ import annotations

import copy
import json
import logging
import re
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

_WORKFLOW_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")


@dataclass(frozen=True)
class FieldMapping:
    node_id: str
    input_name: str


@dataclass(frozen=True)
class WorkflowListItem:
    id: str
    display_name: str
    description: str
    default: bool
    mode: WorkflowMode


@dataclass
class WorkflowBundle:
    workflow: dict[str, Any]
    mappings: dict[str, FieldMapping | None]
    path: Path
    mapping_path: Path
    mode: WorkflowMode = "txt2img"
    workflow_id: str = "default"
    display_name: str = ""
    description: str = ""


@dataclass
class WorkflowRegistry:
    """mode → { workflow_id → bundle }; each mode has one default id."""

    by_mode: dict[str, dict[str, WorkflowBundle]] = field(default_factory=dict)
    default_ids: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_flat(cls, bundles: dict[str, WorkflowBundle]) -> WorkflowRegistry:
        """Compat: one bundle per mode (tests / simple setups)."""
        by_mode: dict[str, dict[str, WorkflowBundle]] = {}
        default_ids: dict[str, str] = {}
        for mode, bundle in bundles.items():
            wid = bundle.workflow_id or "default"
            by_mode[mode] = {wid: bundle}
            default_ids[mode] = wid
        return cls(by_mode=by_mode, default_ids=default_ids)

    def get(self, mode: str, workflow_id: str | None = None) -> WorkflowBundle:
        mode_map = self.by_mode.get(mode)
        if not mode_map:
            available = ", ".join(sorted(self.by_mode)) or "(none)"
            raise WorkflowError(
                f"Workflow mode {mode!r} is not configured. Available: {available}"
            )
        wid = (workflow_id or "").strip() or self.default_ids.get(mode)
        if not wid or wid not in mode_map:
            ids = ", ".join(sorted(mode_map)) or "(none)"
            raise UnknownWorkflowError(
                f"workflow_id={workflow_id!r} is not available for mode={mode!r} "
                f"(loaded: {ids})"
            )
        return mode_map[wid]

    def has(self, mode: str) -> bool:
        return bool(self.by_mode.get(mode))

    def has_workflow(self, mode: str, workflow_id: str) -> bool:
        return workflow_id in self.by_mode.get(mode, {})

    def default_id(self, mode: str) -> str | None:
        return self.default_ids.get(mode)

    @property
    def modes(self) -> list[str]:
        return sorted(self.by_mode.keys())

    def list_workflows(self, mode: str | None = None) -> list[WorkflowListItem]:
        modes = [mode] if mode else self.modes
        items: list[WorkflowListItem] = []
        for m in modes:
            mode_map = self.by_mode.get(m) or {}
            default = self.default_ids.get(m)
            for wid in sorted(mode_map):
                b = mode_map[wid]
                items.append(
                    WorkflowListItem(
                        id=wid,
                        display_name=b.display_name or wid,
                        description=b.description or "",
                        default=wid == default,
                        mode=m,
                    )
                )
        return items


class WorkflowError(Exception):
    """Invalid workflow or mapping configuration."""


class UnknownWorkflowError(WorkflowError):
    """Requested workflow_id is not registered for the mode."""


def validate_workflow_id(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if not _WORKFLOW_ID_RE.match(cleaned):
        raise ValueError(
            "workflow_id must be 1–64 chars: letters, digits, . _ - "
            "(must start with alphanumeric)"
        )
    return cleaned


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
    workflow_id: str = "default",
    display_name: str = "",
    description: str = "",
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
        "Loaded workflow mode=%s id=%s file=%s mapping=%s",
        mode,
        workflow_id,
        workflow_path.name,
        mapping_path.name,
    )
    return WorkflowBundle(
        workflow=workflow,
        mappings=mappings,
        path=workflow_path,
        mapping_path=mapping_path,
        mode=mode,
        workflow_id=workflow_id,
        display_name=display_name or workflow_id,
        description=description,
    )


def _read_meta(dir_path: Path) -> dict[str, Any]:
    meta_path = dir_path / "meta.json"
    if not meta_path.exists():
        return {}
    data = _load_json(meta_path)
    if not isinstance(data, dict):
        raise WorkflowError(f"meta.json must be an object: {meta_path}")
    return data


def scan_mode_workflows(root: Path, *, mode: WorkflowMode) -> tuple[dict[str, WorkflowBundle], str] | None:
    """Scan ``root/<id>/workflow_api.json`` + mapping (+ optional meta.json)."""
    if not root.is_dir():
        return None
    bundles: dict[str, WorkflowBundle] = {}
    preferred_default: str | None = None
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        wf = child / "workflow_api.json"
        mp = child / "workflow_mapping.json"
        if not wf.is_file() or not mp.is_file():
            continue
        meta = _read_meta(child)
        raw_id = str(meta.get("id") or child.name).strip()
        try:
            wid = validate_workflow_id(raw_id)
        except ValueError as exc:
            raise WorkflowError(f"Invalid workflow id in {child}: {exc}") from exc
        if not wid:
            continue
        if wid in bundles:
            raise WorkflowError(f"Duplicate workflow_id {wid!r} under {root}")
        display = str(meta.get("display_name") or wid).strip() or wid
        desc = str(meta.get("description") or "").strip()
        bundles[wid] = load_workflow_bundle(
            wf,
            mp,
            mode=mode,
            workflow_id=wid,
            display_name=display,
            description=desc,
        )
        if meta.get("default") is True:
            preferred_default = wid
    if not bundles:
        return None
    default_id = preferred_default or next(iter(sorted(bundles)))
    return bundles, default_id


def load_workflow_registry(
    *,
    txt2img_workflow: Path,
    txt2img_mapping: Path,
    image_edit_workflow: Path | None = None,
    image_edit_mapping: Path | None = None,
    image_to_video_workflow: Path | None = None,
    image_to_video_mapping: Path | None = None,
    txt2img_dir: Path | None = None,
) -> WorkflowRegistry:
    by_mode: dict[str, dict[str, WorkflowBundle]] = {}
    default_ids: dict[str, str] = {}

    scan_root = txt2img_dir
    if scan_root is None:
        # Prefer sibling of legacy flat files: llm_workflow/txt2img/
        scan_root = txt2img_workflow.resolve().parent / "txt2img"

    scanned = scan_mode_workflows(scan_root, mode="txt2img") if scan_root else None
    if scanned:
        by_mode["txt2img"], default_ids["txt2img"] = scanned
    else:
        bundle = load_workflow_bundle(
            txt2img_workflow,
            txt2img_mapping,
            mode="txt2img",
            workflow_id="qwen-default",
            display_name="Qwen 文生图",
            description="默认文生图管线",
        )
        by_mode["txt2img"] = {"qwen-default": bundle}
        default_ids["txt2img"] = "qwen-default"

    if image_edit_workflow is not None and image_edit_mapping is not None:
        if image_edit_workflow.exists() and image_edit_mapping.exists():
            by_mode["image_edit"] = {
                "default": load_workflow_bundle(
                    image_edit_workflow,
                    image_edit_mapping,
                    mode="image_edit",
                    workflow_id="default",
                    display_name="图编辑",
                )
            }
            default_ids["image_edit"] = "default"
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
            by_mode["image_to_video"] = {
                "default": load_workflow_bundle(
                    image_to_video_workflow,
                    image_to_video_mapping,
                    mode="image_to_video",
                    workflow_id="default",
                    display_name="图生视频",
                )
            }
            default_ids["image_to_video"] = "default"
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
    return WorkflowRegistry(by_mode=by_mode, default_ids=default_ids)


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
