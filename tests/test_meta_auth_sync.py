"""GPU misses local key → pull from Meta internal resolve → upsert."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from app.meta_auth_sync import upsert_user_from_meta_payload
from app.user_store import UserStore, hash_api_key, new_api_key


@pytest.fixture
def twin_stores(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    meta_db = tmp_path / "meta_users.db"
    gpu_db = tmp_path / "gpu_users.db"
    monkeypatch.setenv("API_KEY", "shared-sync-secret-key-32chars-xx")
    monkeypatch.setenv("ENABLE_GENERATION", "false")
    monkeypatch.setenv("ENABLE_DOCS", "false")
    monkeypatch.setenv("INSTANCE_ID", "sync-test")
    monkeypatch.setenv("USERS_DB_PATH", str(meta_db))
    monkeypatch.setenv("POLISH_QUOTA_DB_PATH", str(tmp_path / "polish.db"))
    monkeypatch.setenv("SHOWCASE_DB_PATH", str(tmp_path / "showcase.db"))
    monkeypatch.setenv("SHOWCASE_FILES_DIR", str(tmp_path / "showcase"))
    monkeypatch.setenv("PROMPT_LIBRARY_PATH", str(tmp_path / "prompts.json"))
    monkeypatch.setenv("SHARED_PROMPTS_DB_PATH", str(tmp_path / "shared.db"))
    monkeypatch.setenv("TRANSLATE_CACHE_DB_PATH", str(tmp_path / "tr.db"))
    monkeypatch.setenv("WORKS_DB_PATH", str(tmp_path / "works.db"))
    monkeypatch.setenv("CLOUD_GALLERY_DB_PATH", str(tmp_path / "cg.db"))
    monkeypatch.setenv("CLOUD_GALLERY_FILES_DIR", str(tmp_path / "cg"))
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as meta_client:
        yield meta_client, meta_db, gpu_db
    get_settings.cache_clear()


def test_internal_resolve_and_upsert(twin_stores):
    meta_client, meta_db, gpu_db = twin_stores
    meta = UserStore(meta_db)
    user = meta.register_user(
        "newpad", "secret12", display_name="Pad", email="pad@example.com"
    )
    approved, plain = meta.approve_user(user.id, max_approved=20)
    assert approved.status == "active"
    assert plain

    bad = meta_client.post(
        "/v1/internal/auth/resolve",
        json={"api_key": plain},
        headers={"X-Meta-Sync-Key": "wrong"},
    )
    assert bad.status_code == 401

    ok = meta_client.post(
        "/v1/internal/auth/resolve",
        json={"api_key": plain},
        headers={"X-Meta-Sync-Key": "shared-sync-secret-key-32chars-xx"},
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["username"] == "newpad"
    assert body["api_key_secret"] == plain
    assert body["api_key_hash"] == hash_api_key(plain)

    gpu = UserStore(gpu_db)
    assert gpu.find_by_api_key(plain) is None
    synced = upsert_user_from_meta_payload(gpu, body)
    assert synced is not None
    assert gpu.find_by_api_key(plain) is not None
    assert gpu.find_by_api_key(plain).username == "newpad"


def test_upsert_idempotent(tmp_path: Path):
    store = UserStore(tmp_path / "u.db")
    plain = new_api_key()
    payload = {
        "id": "abc123",
        "name": "N",
        "username": "u1",
        "password_hash": "x",
        "status": "active",
        "api_key_hash": hash_api_key(plain),
        "api_key_prefix": plain[:4],
        "api_key_secret": plain,
        "enabled": True,
        "is_admin": False,
        "daily_generate_limit": 10,
        "daily_polish_limit": 20,
        "note": "",
        "created_at": "2026-01-01T00:00:00+00:00",
        "last_seen_at": None,
        "email": "a@b.c",
    }
    a = upsert_user_from_meta_payload(store, payload)
    payload["name"] = "N2"
    b = upsert_user_from_meta_payload(store, payload)
    assert a is not None and b is not None
    assert b.name == "N2"
    assert store.find_by_api_key(plain).id == "abc123"
