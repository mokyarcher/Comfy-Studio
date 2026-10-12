from __future__ import annotations

import json

import pytest
import respx
from httpx import Response
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture
def polish_client(test_settings, tmp_path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLISH_ENABLED", "true")
    monkeypatch.setenv("POLISH_AI_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("POLISH_AI_API_KEY", "upstream-secret")
    monkeypatch.setenv("POLISH_AI_MODEL", "deepseek-chat")
    monkeypatch.setenv("POLISH_DAILY_LIMIT", "5")
    monkeypatch.setenv("POLISH_RATE_PER_MINUTE", "3")
    monkeypatch.setenv("POLISH_QUOTA_DB_PATH", str(tmp_path / "polish_quota.db"))
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as client:
        yield client
    get_settings.cache_clear()


def _headers():
    return {"X-API-Key": "test-secret-key", "Content-Type": "application/json"}


def test_polish_requires_auth(polish_client: TestClient):
    res = polish_client.post("/v1/prompt/polish", json={"prompt": "一只猫"})
    assert res.status_code == 401


def test_polish_status(polish_client: TestClient):
    res = polish_client.get("/v1/prompt/polish/status", headers=_headers())
    assert res.status_code == 200
    body = res.json()
    assert body["enabled"] is True
    assert body["configured"] is True
    # Bootstrap admin inherits high polish limit from ensure_bootstrap_admin
    assert body["quota"]["daily_limit"] >= 1


@respx.mock
def test_polish_proxy_success(polish_client: TestClient):
    upstream = {
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        {
                            "enhanced_prompt": "一只黑猫坐在窗边，毛发质感清楚",
                            "added_details": ["毛发质感清楚"],
                            "preserved_constraints": ["一只", "黑猫"],
                            "assumptions": [],
                            "conflicts": [],
                            "matched_categories": ["animal"],
                        },
                        ensure_ascii=False,
                    )
                }
            }
        ]
    }
    respx.post("https://api.deepseek.com/chat/completions").mock(
        return_value=Response(200, json=upstream)
    )
    res = polish_client.post(
        "/v1/prompt/polish",
        headers=_headers(),
        json={"prompt": "一只黑猫", "detail": "standard", "model_profile": "unknown"},
    )
    assert res.status_code == 200
    body = res.json()
    assert "黑猫" in body["enhanced_prompt"]
    assert body["provider"] == "gateway"
    assert body["quota"]["daily_used"] == 1
    # Upstream Authorization must not appear in response
    assert "upstream-secret" not in res.text


@respx.mock
def test_polish_rate_limit(polish_client: TestClient):
    from app.main import state

    state.settings.polish_rate_per_minute = 3
    upstream = {
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        {
                            "enhanced_prompt": "猫",
                            "added_details": [],
                            "preserved_constraints": [],
                            "assumptions": [],
                            "conflicts": [],
                        }
                    )
                }
            }
        ]
    }
    respx.post("https://api.deepseek.com/chat/completions").mock(
        return_value=Response(200, json=upstream)
    )
    for _ in range(3):
        assert (
            polish_client.post(
                "/v1/prompt/polish", headers=_headers(), json={"prompt": "猫"}
            ).status_code
            == 200
        )
    limited = polish_client.post(
        "/v1/prompt/polish", headers=_headers(), json={"prompt": "猫"}
    )
    assert limited.status_code == 429
    assert limited.json()["detail"]["code"] == "rate_limited"
