from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture
def client(test_settings, monkeypatch: pytest.MonkeyPatch, tmp_path):
    get_settings.cache_clear()
    monkeypatch.setenv("PROMPT_LIBRARY_PATH", str(tmp_path / "prompt_library.json"))
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def _admin():
    return {"X-API-Key": "test-secret-key"}


def test_get_seeded_prompt_library(client: TestClient):
    res = client.get("/v1/prompt-library", headers=_admin())
    assert res.status_code == 200
    body = res.json()
    assert body["version"] >= 1
    assert len(body["templates"]) >= 1
    assert len(body["phrases"]) >= 1
    assert "title" in body["templates"][0]
    assert "text" in body["phrases"][0]


def test_admin_replace_prompt_library(client: TestClient):
    before = client.get("/v1/admin/prompt-library", headers=_admin())
    assert before.status_code == 200
    ver = before.json()["version"]

    put = client.put(
        "/v1/admin/prompt-library",
        headers=_admin(),
        json={
            "templates": [
                {
                    "id": "t1",
                    "title": "测试模板",
                    "prompt": "a red fox in snow",
                    "negative_prompt": "blurry",
                    "tags": ["动物"],
                }
            ],
            "phrases": [{"id": "p1", "text": "soft light", "category": "光线"}],
        },
    )
    assert put.status_code == 200
    body = put.json()
    assert body["version"] == ver + 1
    assert len(body["templates"]) == 1
    assert body["templates"][0]["title"] == "测试模板"
    assert body["phrases"][0]["text"] == "soft light"

    got = client.get("/v1/prompt-library", headers=_admin())
    assert got.json()["templates"][0]["prompt"] == "a red fox in snow"


def test_non_admin_cannot_replace(client: TestClient):
    created = client.post(
        "/v1/auth/register",
        json={
            "username": "libuser",
            "password": "secret12",
            "display_name": "库用户",
            "email": "libuser@example.com",
        },
    )
    assert created.status_code == 200
    user_id = created.json()["user_id"]
    assert client.post(f"/v1/admin/users/{user_id}/approve", headers=_admin()).status_code == 200
    login = client.post(
        "/v1/auth/login",
        json={"username": "libuser", "password": "secret12"},
    )
    key = login.json()["api_key"]
    denied = client.put(
        "/v1/admin/prompt-library",
        headers={"X-API-Key": key},
        json={"templates": [], "phrases": []},
    )
    assert denied.status_code == 403
