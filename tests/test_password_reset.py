from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture
def client(test_settings):
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def _admin():
    return {"X-API-Key": "test-secret-key"}


def test_admin_reset_and_user_change_password(client: TestClient):
    reg = client.post(
        "/v1/auth/register",
        json={"username": "pwduser", "password": "oldpass1"},
    )
    assert reg.status_code == 200
    uid = reg.json()["user_id"]
    assert client.post(f"/v1/admin/users/{uid}/approve", headers=_admin()).status_code == 200

    reset = client.post(f"/v1/admin/users/{uid}/reset-password", headers=_admin(), json={})
    assert reset.status_code == 200
    temp = reset.json()["temporary_password"]
    assert len(temp) >= 6

    bad = client.post(
        "/v1/auth/login",
        json={"username": "pwduser", "password": "oldpass1"},
    )
    assert bad.status_code == 401

    login = client.post(
        "/v1/auth/login",
        json={"username": "pwduser", "password": temp},
    )
    assert login.status_code == 200
    key = login.json()["api_key"]

    changed = client.post(
        "/v1/auth/change-password",
        headers={"X-API-Key": key},
        json={"old_password": temp, "new_password": "newpass9"},
    )
    assert changed.status_code == 200

    again = client.post(
        "/v1/auth/login",
        json={"username": "pwduser", "password": "newpass9"},
    )
    assert again.status_code == 200
