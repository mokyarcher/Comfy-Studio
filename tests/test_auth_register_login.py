from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture
def client(test_settings, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MAX_APPROVED_USERS", "2")
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def _admin():
    return {"X-API-Key": "test-secret-key"}


def test_register_pending_login_then_approve(client: TestClient):
    reg = client.post(
        "/v1/auth/register",
        json={
            "username": "alice",
            "password": "secret12",
            "display_name": "爱丽丝",
            "email": "alice@example.com",
        },
    )
    assert reg.status_code == 200
    body = reg.json()
    assert body["status"] == "pending"
    user_id = body["user_id"]

    denied = client.post(
        "/v1/auth/login",
        json={"username": "alice", "password": "secret12"},
    )
    assert denied.status_code == 403
    assert "审核" in denied.json()["detail"]

    approved = client.post(f"/v1/admin/users/{user_id}/approve", headers=_admin())
    assert approved.status_code == 200
    assert approved.json()["status"] == "active"
    assert approved.json()["username"] == "alice"

    login = client.post(
        "/v1/auth/login",
        json={"username": "alice", "password": "secret12"},
    )
    assert login.status_code == 200
    key = login.json()["api_key"]
    assert key
    assert login.json().get("email") == "alice@example.com"

    # Key works for authenticated routes
    task = client.get("/v1/tasks/does-not-exist", headers={"X-API-Key": key})
    assert task.status_code == 404  # auth ok, task missing


def test_reject_and_pool_limit(client: TestClient):
    a = client.post(
        "/v1/auth/register",
        json={"username": "bob", "password": "secret12", "email": "bob@example.com"},
    ).json()
    b = client.post(
        "/v1/auth/register",
        json={"username": "carol", "password": "secret12", "email": "carol@example.com"},
    ).json()
    c = client.post(
        "/v1/auth/register",
        json={"username": "dave", "password": "secret12", "email": "dave@example.com"},
    ).json()

    assert client.post(f"/v1/admin/users/{a['user_id']}/approve", headers=_admin()).status_code == 200
    assert client.post(f"/v1/admin/users/{b['user_id']}/approve", headers=_admin()).status_code == 200
    full = client.post(f"/v1/admin/users/{c['user_id']}/approve", headers=_admin())
    assert full.status_code == 400
    assert "名额" in full.json()["detail"]

    rej = client.post(f"/v1/admin/users/{c['user_id']}/reject", headers=_admin())
    assert rej.status_code == 200
    assert rej.json()["status"] == "rejected"

    stats = client.get("/v1/admin/stats", headers=_admin())
    assert stats.status_code == 200
    body = stats.json()
    assert body["max_approved_users"] == 2
    assert body["approved_users"] == 2
    assert body["pool_remaining"] == 0


def test_duplicate_username(client: TestClient):
    assert (
        client.post(
            "/v1/auth/register",
            json={
                "username": "dupuser",
                "password": "secret12",
                "email": "dupuser@example.com",
            },
        ).status_code
        == 200
    )
    again = client.post(
        "/v1/auth/register",
        json={
            "username": "dupuser",
            "password": "secret99",
            "email": "dupuser2@example.com",
        },
    )
    assert again.status_code == 400
