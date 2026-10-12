from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.config import Settings, get_settings
from app.workflow import load_workflow_bundle


@pytest.fixture
def sample_workflow() -> dict:
    return {
        "10": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "default positive", "clip": ["4", 1]},
        },
        "11": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "default negative", "clip": ["4", 1]},
        },
        "12": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 512, "height": 512, "batch_size": 1},
        },
        "13": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 1,
                "steps": 20,
                "cfg": 7,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1,
                "model": ["4", 0],
                "positive": ["10", 0],
                "negative": ["11", 0],
                "latent_image": ["12", 0],
            },
        },
        "14": {
            "class_type": "SaveImage",
            "inputs": {"images": ["9", 0], "filename_prefix": "ComfyUI"},
        },
    }


@pytest.fixture
def sample_mapping() -> dict:
    return {
        "positive_prompt": {"node_id": "10", "input": "text"},
        "negative_prompt": {"node_id": "11", "input": "text"},
        "width": {"node_id": "12", "input": "width"},
        "height": {"node_id": "12", "input": "height"},
        "steps": {"node_id": "13", "input": "steps"},
        "seed": {"node_id": "13", "input": "seed"},
    }


@pytest.fixture
def workflow_files(tmp_path: Path, sample_workflow: dict, sample_mapping: dict):
    wf = tmp_path / "workflow_api.json"
    mp = tmp_path / "workflow_mapping.json"
    wf.write_text(json.dumps(sample_workflow), encoding="utf-8")
    mp.write_text(json.dumps(sample_mapping), encoding="utf-8")
    return wf, mp


@pytest.fixture
def test_settings(tmp_path: Path, workflow_files, monkeypatch: pytest.MonkeyPatch) -> Settings:
    wf, mp = workflow_files
    db = tmp_path / "tasks.db"
    images = tmp_path / "images"
    images.mkdir()
    monkeypatch.setenv("API_KEY", "test-secret-key")
    monkeypatch.setenv("DATABASE_PATH", str(db))
    monkeypatch.setenv("IMAGE_OUTPUT_DIR", str(images))
    monkeypatch.setenv("WORKFLOW_PATH", str(wf))
    monkeypatch.setenv("WORKFLOW_MAPPING_PATH", str(mp))
    monkeypatch.setenv("COMFYUI_URL", "http://127.0.0.1:8188")
    monkeypatch.setenv("ENABLE_DOCS", "false")
    monkeypatch.setenv("MAX_QUEUE_SIZE", "2")
    monkeypatch.setenv("USERS_DB_PATH", str(tmp_path / "users.db"))
    monkeypatch.setenv("POLISH_QUOTA_DB_PATH", str(tmp_path / "polish_quota.db"))
    monkeypatch.setenv("SHOWCASE_DB_PATH", str(tmp_path / "showcase.db"))
    monkeypatch.setenv("SHOWCASE_FILES_DIR", str(tmp_path / "showcase"))
    monkeypatch.setenv("PROMPT_LIBRARY_PATH", str(tmp_path / "prompt_library.json"))
    monkeypatch.setenv("SHARED_PROMPTS_DB_PATH", str(tmp_path / "shared_prompts.db"))
    monkeypatch.setenv("TRANSLATE_CACHE_DB_PATH", str(tmp_path / "translate_cache.db"))
    monkeypatch.setenv("MAX_APPROVED_USERS", "20")
    get_settings.cache_clear()
    settings = get_settings()
    yield settings
    get_settings.cache_clear()


@pytest.fixture
def bundle(workflow_files):
    wf, mp = workflow_files
    return load_workflow_bundle(wf, mp)
