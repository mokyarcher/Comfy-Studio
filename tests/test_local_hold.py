from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.local_hold import local_hold
from app.main import create_app


@pytest.fixture
def client(test_settings, monkeypatch: pytest.MonkeyPatch):
    get_settings.cache_clear()
    local_hold.clear()
    app = create_app()
    with TestClient(app) as c:
        yield c
    local_hold.clear()
    get_settings.cache_clear()


def _admin():
    return {"X-API-Key": "test-secret-key"}


def test_admin_set_and_clear_local_hold(client: TestClient):
    off = client.get("/v1/admin/local-hold", headers=_admin())
    assert off.status_code == 200
    assert off.json()["held"] is False

    on = client.post(
        "/v1/admin/local-hold",
        headers=_admin(),
        json={"held": True, "ttl_seconds": 1800, "message": "本机调试中"},
    )
    assert on.status_code == 200
    body = on.json()
    assert body["held"] is True
    assert body["message"] == "本机调试中"
    assert body["expires_at"]

    stats = client.get("/v1/admin/stats", headers=_admin())
    assert stats.status_code == 200
    assert stats.json()["local_hold"] is True

    clear = client.post("/v1/admin/local-hold", headers=_admin(), json={"held": False})
    assert clear.status_code == 200
    assert clear.json()["held"] is False


def test_generate_rejected_while_held(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    # Avoid needing a real ComfyUI / workflow submit path: hold rejects first.
    held = client.post(
        "/v1/admin/local-hold",
        headers=_admin(),
        json={"held": True},
    )
    assert held.status_code == 200

    res = client.post(
        "/v1/images/generate",
        headers=_admin(),
        json={"prompt": "a cat", "mode": "txt2img"},
    )
    assert res.status_code == 503
    detail = res.json()["detail"]
    assert detail["code"] == "local_hold"
    assert "占用" in detail["message"] or "本机" in detail["message"]


def test_non_admin_cannot_set_hold(client: TestClient):
    created = client.post(
        "/v1/auth/register",
        json={"username": "holduser", "password": "secret12", "display_name": "占用测试"},
    )
    assert created.status_code == 200
    user_id = created.json()["user_id"]
    assert client.post(f"/v1/admin/users/{user_id}/approve", headers=_admin()).status_code == 200
    login = client.post(
        "/v1/auth/login",
        json={"username": "holduser", "password": "secret12"},
    )
    assert login.status_code == 200
    user_key = login.json()["api_key"]

    denied = client.post(
        "/v1/admin/local-hold",
        headers={"X-API-Key": user_key},
        json={"held": True},
    )
    assert denied.status_code == 403

    readable = client.get("/v1/local-hold", headers={"X-API-Key": user_key})
    assert readable.status_code == 200
    assert readable.json()["held"] is False
