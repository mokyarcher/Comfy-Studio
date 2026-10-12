from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.workflow import WorkflowError, apply_parameters, load_workflow_bundle


def test_invalid_json_fails(tmp_path: Path):
    wf = tmp_path / "workflow_api.json"
    mp = tmp_path / "workflow_mapping.json"
    wf.write_text("{not-json", encoding="utf-8")
    mp.write_text("{}", encoding="utf-8")
    with pytest.raises(WorkflowError, match="Invalid JSON"):
        load_workflow_bundle(wf, mp)


def test_missing_node_mapping_fails(workflow_files, sample_mapping):
    wf, mp = workflow_files
    bad = dict(sample_mapping)
    bad["seed"] = {"node_id": "999", "input": "seed"}
    mp.write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(WorkflowError, match="node_id '999'"):
        load_workflow_bundle(wf, mp)


def test_missing_input_mapping_fails(workflow_files, sample_mapping):
    wf, mp = workflow_files
    bad = dict(sample_mapping)
    bad["steps"] = {"node_id": "13", "input": "not_a_field"}
    mp.write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(WorkflowError, match="input 'not_a_field'"):
        load_workflow_bundle(wf, mp)


def test_apply_parameters_writes_only_mapped_fields(bundle):
    original_cfg = bundle.workflow["13"]["inputs"]["cfg"]
    result = apply_parameters(
        bundle,
        prompt="hello cat",
        negative_prompt="blurry",
        width=768,
        height=512,
        steps=30,
        seed=42,
    )
    assert result["10"]["inputs"]["text"] == "hello cat"
    assert result["11"]["inputs"]["text"] == "blurry"
    assert result["12"]["inputs"]["width"] == 768
    assert result["12"]["inputs"]["height"] == 512
    assert result["13"]["inputs"]["steps"] == 30
    assert result["13"]["inputs"]["seed"] == 42
    assert result["13"]["inputs"]["cfg"] == original_cfg
    assert result["14"]["inputs"]["filename_prefix"] == "ComfyUI"
    # original bundle unchanged
    assert bundle.workflow["10"]["inputs"]["text"] == "default positive"


def test_ui_workflow_rejected(tmp_path: Path, sample_mapping):
    wf = tmp_path / "workflow_api.json"
    mp = tmp_path / "workflow_mapping.json"
    wf.write_text(
        json.dumps({"id": "x", "nodes": [{"id": 1, "type": "KSampler"}], "links": []}),
        encoding="utf-8",
    )
    mp.write_text(json.dumps(sample_mapping), encoding="utf-8")
    with pytest.raises(WorkflowError, match="UI/workspace"):
        load_workflow_bundle(wf, mp)


def test_project_workflow_and_mapping_load():
    root = Path(__file__).resolve().parent.parent
    bundle = load_workflow_bundle(
        root / "llm_workflow" / "workflow_api.json",
        root / "llm_workflow" / "workflow_mapping.json",
    )
    assert bundle.mappings["positive_prompt"].node_id == "452"
    assert bundle.mappings["seed"].input_name == "seed"


def test_image_edit_workflow_and_mapping_load():
    root = Path(__file__).resolve().parent.parent
    bundle = load_workflow_bundle(
        root / "llm_workflow" / "workflow_image_edit_api.json",
        root / "llm_workflow" / "workflow_image_edit_mapping.json",
        mode="image_edit",
    )
    assert bundle.mode == "image_edit"
    assert bundle.mappings["image_1"].node_id == "470"
    assert bundle.mappings["image_2"].node_id == "475"
    assert bundle.mappings["positive_prompt"].node_id == "459:474"
    result = apply_parameters(
        bundle,
        prompt="edit <image1> with <image2>",
        negative_prompt="",
        width=1024,
        height=1024,
        steps=20,
        seed=7,
        images=["a.png", "b.png"],
    )
    assert result["459:474"]["inputs"]["prompt"] == "edit <image1> with <image2>"
    assert result["470"]["inputs"]["image"] == "a.png"
    assert result["475"]["inputs"]["image"] == "b.png"
    assert result["459:468"]["inputs"]["switch"] is True
    assert result["461"]["inputs"]["format.bit_depth"] == "8-bit"

    only_one = apply_parameters(
        bundle,
        prompt="edit only <image1>",
        negative_prompt=None,
        width=None,
        height=None,
        steps=None,
        seed=1,
        images=["solo.png"],
    )
    assert only_one["470"]["inputs"]["image"] == "solo.png"
    assert "475" not in only_one
    assert "images.image_2" not in only_one["459:474"]["inputs"]
    assert only_one["459:474"]["inputs"]["images.image_1"] == ["470", 0]


def test_image_to_video_workflow_and_mapping_load():
    root = Path(__file__).resolve().parent.parent
    bundle = load_workflow_bundle(
        root / "llm_workflow" / "workflow_image_to_video_api.json",
        root / "llm_workflow" / "workflow_image_to_video_mapping.json",
        mode="image_to_video",
    )
    assert bundle.mode == "image_to_video"
    assert bundle.mappings["image_1"].node_id == "56"
    assert bundle.mappings["length"].node_id == "55"
    result = apply_parameters(
        bundle,
        prompt="camera pans right",
        negative_prompt="static",
        width=832,
        height=480,
        steps=20,
        seed=42,
        images=["start.png"],
        length=81,
    )
    assert result["6"]["inputs"]["text"] == "camera pans right"
    assert result["56"]["inputs"]["image"] == "start.png"
    assert result["55"]["inputs"]["width"] == 832
    assert result["55"]["inputs"]["length"] == 81
    assert result["55"]["inputs"]["start_image"] == ["56", 0]
    assert result["58"]["class_type"] == "SaveVideo"


def test_load_workflow_registry_both_modes():
    from app.workflow import load_workflow_registry

    root = Path(__file__).resolve().parent.parent
    wf = root / "llm_workflow"
    registry = load_workflow_registry(
        txt2img_workflow=wf / "workflow_api.json",
        txt2img_mapping=wf / "workflow_mapping.json",
        image_edit_workflow=wf / "workflow_image_edit_api.json",
        image_edit_mapping=wf / "workflow_image_edit_mapping.json",
        image_to_video_workflow=wf / "workflow_image_to_video_api.json",
        image_to_video_mapping=wf / "workflow_image_to_video_mapping.json",
    )
    assert registry.modes == ["image_edit", "image_to_video", "txt2img"]
    assert registry.has("image_edit")
    assert registry.has("image_to_video")
