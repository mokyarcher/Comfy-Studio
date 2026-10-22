"""Meta plane: /v1/admin/stats must not 500 when state.db is None."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture
def meta_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("API_KEY", "test-secret-key")
    monkeypatch.setenv("ENABLE_GENERATION", "false")
    monkeypatch.setenv("ENABLE_DOCS", "false")
    monkeypatch.setenv("INSTANCE_ID", "meta-test")
    monkeypatch.setenv("USERS_DB_PATH", str(tmp_path / "users.db"))
    monkeypatch.setenv("POLISH_QUOTA_DB_PATH", str(tmp_path / "polish_quota.db"))
    monkeypatch.setenv("SHOWCASE_DB_PATH", str(tmp_path / "showcase.db"))
    monkeypatch.setenv("SHOWCASE_FILES_DIR", str(tmp_path / "showcase"))
    monkeypatch.setenv("PROMPT_LIBRARY_PATH", str(tmp_path / "prompt_library.json"))
    monkeypatch.setenv("SHARED_PROMPTS_DB_PATH", str(tmp_path / "shared_prompts.db"))
    monkeypatch.setenv("TRANSLATE_CACHE_DB_PATH", str(tmp_path / "translate_cache.db"))
    monkeypatch.setenv("WORKS_DB_PATH", str(tmp_path / "works.db"))
    monkeypatch.setenv("CLOUD_GALLERY_DB_PATH", str(tmp_path / "cloud_gallery.db"))
    monkeypatch.setenv("CLOUD_GALLERY_FILES_DIR", str(tmp_path / "cloud_gallery"))
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def test_admin_stats_ok_without_task_db(meta_client: TestClient):
    res = meta_client.get("/v1/admin/stats", headers={"X-API-Key": "test-secret-key"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["queue_queued"] == 0
    assert body["queue_running"] == 0
    assert body["queue_open"] == 0
    assert "pending_users" in body
    assert "users_total" in body
