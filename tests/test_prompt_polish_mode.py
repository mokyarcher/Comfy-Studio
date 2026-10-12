from __future__ import annotations

import json

import pytest
import respx
from httpx import Response
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from app.prompt_polish_prompt import (
    AI_POLISH_SYSTEM_PROMPT,
    AI_VIDEO_I2V_POLISH_SYSTEM_PROMPT,
    select_polish_system_prompt,
)
from app.prompt_polish_service import parse_model_payload
from app.schemas import PromptPolishRequest


def test_select_polish_system_prompt_routes_by_mode():
    assert select_polish_system_prompt("txt2img") == AI_POLISH_SYSTEM_PROMPT
    assert select_polish_system_prompt("image_edit") == AI_POLISH_SYSTEM_PROMPT
    assert select_polish_system_prompt("image_to_video") == AI_VIDEO_I2V_POLISH_SYSTEM_PROMPT
    assert "图生视频" in select_polish_system_prompt("image_to_video")


def test_parse_accepts_positive_prompt_alias():
    req = PromptPolishRequest(prompt="女孩眨眼", generation_mode="image_to_video")
    out = parse_model_payload(
        {
            "positive_prompt": "女孩轻微眨眼，fixed camera",
            "negative_prompt": "identity drift",
            "scene_type": "portrait_micro_motion",
            "consistency_constraints": ["面部特征稳定"],
            "risk_notes": ["微表情仍可能漂移"],
            "added_details": ["fixed camera"],
            "conflicts": [],
        },
        req,
    )
    assert "眨眼" in out.enhanced_prompt
    assert out.enhanced_negative_prompt == "identity drift"
    assert "portrait_micro_motion" in out.matched_categories
    assert "面部特征稳定" in out.preserved_constraints


@pytest.fixture
def polish_client(test_settings, tmp_path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLISH_ENABLED", "true")
    monkeypatch.setenv("POLISH_AI_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("POLISH_AI_API_KEY", "upstream-secret")
    monkeypatch.setenv("POLISH_AI_MODEL", "deepseek-chat")
    monkeypatch.setenv("POLISH_QUOTA_DB_PATH", str(tmp_path / "polish_quota.db"))
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as client:
        yield client
    get_settings.cache_clear()


@respx.mock
def test_polish_image_to_video_uses_director_system_prompt(polish_client: TestClient):
    route = respx.post("https://api.deepseek.com/chat/completions").mock(
        return_value=Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "enhanced_prompt": "人物缓慢眨眼，镜头固定",
                                    "enhanced_negative_prompt": "face morphing, flicker",
                                    "added_details": ["固定镜头"],
                                    "preserved_constraints": ["同一人物"],
                                    "assumptions": [],
                                    "conflicts": [],
                                    "matched_categories": ["portrait_micro_motion"],
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ]
            },
        )
    )
    res = polish_client.post(
        "/v1/prompt/polish",
        headers={"X-API-Key": "test-secret-key", "Content-Type": "application/json"},
        json={
            "prompt": "她眨眨眼",
            "generation_mode": "image_to_video",
            "model_profile": "wan",
            "detail": "standard",
        },
    )
    assert res.status_code == 200
    assert route.called
    sent = route.calls[0].request
    body = json.loads(sent.content.decode("utf-8"))
    system = body["messages"][0]["content"]
    assert "图生视频" in system
    assert "文生图提示词编辑器" not in system
    assert "眨眼" in res.json()["enhanced_prompt"]
