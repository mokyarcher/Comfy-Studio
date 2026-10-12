from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture
def client(test_settings, monkeypatch: pytest.MonkeyPatch, tmp_path):
    get_settings.cache_clear()
    monkeypatch.setenv("SHARED_PROMPTS_DB_PATH", str(tmp_path / "shared_prompts.db"))
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def _admin():
    return {"X-API-Key": "test-secret-key"}


def _approve_user(client: TestClient, username: str, password: str = "secret12") -> str:
    created = client.post(
        "/v1/auth/register",
        json={"username": username, "password": password, "display_name": username},
    )
    assert created.status_code == 200
    user_id = created.json()["user_id"]
    assert client.post(f"/v1/admin/users/{user_id}/approve", headers=_admin()).status_code == 200
    login = client.post("/v1/auth/login", json={"username": username, "password": password})
    assert login.status_code == 200
    return login.json()["api_key"]


def test_share_list_and_author_delete(client: TestClient):
    key_a = _approve_user(client, "share_a")
    key_b = _approve_user(client, "share_b")

    created = client.post(
        "/v1/prompt-library/shared",
        headers={"X-API-Key": key_a},
        json={
            "title": "赛博夜景",
            "prompt": "cyberpunk street at night",
            "negative_prompt": "blurry",
            "tags": ["场景"],
        },
    )
    assert created.status_code == 201, created.text
    item = created.json()
    assert item["title"] == "赛博夜景"
    assert item["author_username"] == "share_a"
    assert item["mine"] is True
    item_id = item["id"]

    listed = client.get("/v1/prompt-library/shared", headers={"X-API-Key": key_b})
    assert listed.status_code == 200
    body = listed.json()
    assert body["count"] >= 1
    found = next(i for i in body["items"] if i["id"] == item_id)
    assert found["mine"] is False
    assert found["author_name"]

    denied = client.delete(
        f"/v1/prompt-library/shared/{item_id}",
        headers={"X-API-Key": key_b},
    )
    assert denied.status_code == 403

    deleted = client.delete(
        f"/v1/prompt-library/shared/{item_id}",
        headers={"X-API-Key": key_a},
    )
    assert deleted.status_code == 200
    empty = client.get("/v1/prompt-library/shared", headers={"X-API-Key": key_a})
    assert all(i["id"] != item_id for i in empty.json()["items"])


def test_admin_can_delete_any_shared(client: TestClient):
    key = _approve_user(client, "share_c")
    created = client.post(
        "/v1/prompt-library/shared",
        headers={"X-API-Key": key},
        json={"title": "水彩", "prompt": "watercolor lake"},
    )
    assert created.status_code == 201
    item_id = created.json()["id"]

    admin_list = client.get("/v1/admin/prompt-library/shared", headers=_admin())
    assert admin_list.status_code == 200
    assert any(i["id"] == item_id for i in admin_list.json()["items"])

    deleted = client.delete(
        f"/v1/admin/prompt-library/shared/{item_id}",
        headers=_admin(),
    )
    assert deleted.status_code == 200
    listed = client.get("/v1/prompt-library/shared", headers={"X-API-Key": key})
    assert all(i["id"] != item_id for i in listed.json()["items"])


def test_shared_requires_auth(client: TestClient):
    assert client.get("/v1/prompt-library/shared").status_code == 401
