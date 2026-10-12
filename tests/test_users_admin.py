from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture
def client(test_settings, monkeypatch: pytest.MonkeyPatch):
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def _h():
    return {"X-API-Key": "test-secret-key"}


def test_bootstrap_admin_and_stats(client: TestClient):
    res = client.get("/v1/admin/stats", headers=_h())
    assert res.status_code == 200
    body = res.json()
    assert body["users_total"] >= 1
    assert "max_queue_size" in body
    assert "pool_remaining" in body
    assert "max_approved_users" in body


def test_approve_user_and_disable(client: TestClient):
    created = client.post(
        "/v1/auth/register",
        json={
            "username": "limituser",
            "password": "secret12",
            "display_name": "限额用户",
        },
    )
    assert created.status_code == 200
    user_id = created.json()["user_id"]

    approved = client.post(f"/v1/admin/users/{user_id}/approve", headers=_h())
    assert approved.status_code == 200
    login = client.post(
        "/v1/auth/login",
        json={"username": "limituser", "password": "secret12"},
    )
    assert login.status_code == 200
    user_key = login.json()["api_key"]

    denied = client.get("/v1/admin/users", headers={"X-API-Key": user_key})
    assert denied.status_code == 403

    patched = client.patch(
        f"/v1/admin/users/{user_id}",
        headers=_h(),
        json={"enabled": False},
    )
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False

    banned = client.get(
        "/v1/tasks/does-not-matter",
        headers={"X-API-Key": user_key},
    )
    assert banned.status_code == 403
