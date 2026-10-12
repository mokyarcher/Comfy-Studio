from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import get_settings
from app.local_hold import local_hold
from app.main import create_app


def _admin():
    return {"X-API-Key": "test-secret-key"}


def test_gpu_status_idle_and_busy_on_hold(test_settings, monkeypatch):
    get_settings.cache_clear()
    local_hold.clear()
    app = create_app()
    with TestClient(app) as client:
        idle = client.get("/v1/system/gpu", headers=_admin())
        assert idle.status_code == 200
        body = idle.json()
        assert body["state"] == "idle"
        assert body["queue_running"] == 0
        assert body["queue_queued"] == 0
        assert body["local_hold"] is False

        client.post(
            "/v1/admin/local-hold",
            headers=_admin(),
            json={"held": True, "ttl_seconds": 600},
        )
        busy = client.get("/v1/system/gpu", headers=_admin())
        assert busy.status_code == 200
        held_body = busy.json()
        assert held_body["state"] == "busy"
        assert held_body["local_hold"] is True

        missing = client.get("/v1/system/gpu")
        assert missing.status_code == 401
    local_hold.clear()
    get_settings.cache_clear()
