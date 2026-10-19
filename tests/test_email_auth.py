from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture
def client(test_settings, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MAIL_DRY_RUN", "true")
    monkeypatch.setenv("EMAIL_RESET_DB_PATH", str(test_settings.users_db_path.parent / "email_reset.db"))
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def _h():
    return {"X-API-Key": "test-secret-key"}


def _register_and_approve(client: TestClient, username: str, email: str) -> str:
    created = client.post(
        "/v1/auth/register",
        json={
            "username": username,
            "password": "secret12",
            "display_name": username,
            "email": email,
        },
    )
    assert created.status_code == 200, created.text
    user_id = created.json()["user_id"]
    approved = client.post(f"/v1/admin/users/{user_id}/approve", headers=_h())
    assert approved.status_code == 200, approved.text
    login = client.post(
        "/v1/auth/login",
        json={"username": username, "password": "secret12"},
    )
    assert login.status_code == 200
    body = login.json()
    assert body.get("email") == email
    return body["api_key"]


def test_register_requires_email(client: TestClient):
    res = client.post(
        "/v1/auth/register",
        json={"username": "noemail", "password": "secret12"},
    )
    assert res.status_code == 422


def test_bind_email_and_profile(client: TestClient):
    key = _register_and_approve(client, "mailuser", "mailuser@example.com")
    headers = {"X-API-Key": key}

    profile = client.get("/v1/auth/profile", headers=headers)
    assert profile.status_code == 200
    assert profile.json()["email"] == "mailuser@example.com"

    bad = client.post(
        "/v1/auth/email",
        headers=headers,
        json={"password": "wrong-pass", "email": "new@example.com"},
    )
    assert bad.status_code == 400

    ok = client.post(
        "/v1/auth/email",
        headers=headers,
        json={"password": "secret12", "email": "new@example.com"},
    )
    assert ok.status_code == 200
    assert ok.json()["email"] == "new@example.com"

    profile2 = client.get("/v1/auth/profile", headers=headers)
    assert profile2.json()["email"] == "new@example.com"


def test_password_reset_flow(client: TestClient, caplog: pytest.LogCaptureFixture):
    key = _register_and_approve(client, "resetme", "resetme@example.com")
    _ = key

    send = client.post(
        "/v1/auth/password-reset/send",
        json={"email": "resetme@example.com"},
    )
    assert send.status_code == 200
    assert send.json()["cooldown_seconds"] >= 1

    # Pull code from dry-run log
    code = None
    for rec in caplog.records:
        msg = rec.getMessage()
        if "MAIL dry-run" in msg and "code=" in msg:
            code = msg.split("code=")[-1].split()[0]
            break
    assert code and len(code) == 6

    reset = client.post(
        "/v1/auth/password-reset",
        json={
            "email": "resetme@example.com",
            "code": code,
            "new_password": "newpass99",
            "confirm_password": "newpass99",
        },
    )
    assert reset.status_code == 200

    old = client.post(
        "/v1/auth/login",
        json={"username": "resetme", "password": "secret12"},
    )
    assert old.status_code == 401

    new = client.post(
        "/v1/auth/login",
        json={"username": "resetme", "password": "newpass99"},
    )
    assert new.status_code == 200


def test_password_reset_unknown_email(client: TestClient):
    res = client.post(
        "/v1/auth/password-reset/send",
        json={"email": "nobody@example.com"},
    )
    assert res.status_code == 404
