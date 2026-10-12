from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app


@pytest.mark.asyncio
async def test_missing_api_key_returns_401(test_settings, monkeypatch):
    # Recreate app after settings env is applied
    from app.config import get_settings

    get_settings.cache_clear()
    app = create_app()

    # Avoid real lifespan worker needing Comfy during auth-only checks:
    # hit endpoint with dependency only via TestClient lifespan disabled is hard;
    # instead call route after mounting a minimal override by using transport with lifespan off.
    transport = ASGITransport(app=app, raise_app_exceptions=True)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # lifespan not started -> state may be empty; auth runs before handler body for Depends
        # FastAPI still executes dependencies. For generate, body validation also runs.
        # Without lifespan, handler may crash after auth. So we only assert auth on a
        # dependency-protected route by mocking lifespan state lightly.
        pass

    # Use Starlette TestClient pattern via httpx with lifespan context
    from app.comfy_client import ComfyClient
    from app.database import Database
    from app.main import state
    from app.task_service import TaskService
    from app.user_store import UserStore
    from app.workflow import WorkflowRegistry, load_workflow_bundle
    from app.worker import TaskWorker

    settings = test_settings
    state.settings = settings
    state.db = Database(settings.database_path)
    state.comfy = ComfyClient(settings)
    state.registry = WorkflowRegistry(
        {
            "txt2img": load_workflow_bundle(
                settings.workflow_path, settings.workflow_mapping_path, mode="txt2img"
            )
        }
    )
    state.task_service = TaskService(settings, state.db, state.registry, state.comfy)
    state.worker = TaskWorker(state.db, state.task_service)
    state.user_store = UserStore(settings.users_db_path)
    state.user_store.ensure_bootstrap_admin(settings.api_key)
    app.state.user_store = state.user_store

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/v1/images/generate", json={"prompt": "a cat"})
        assert r.status_code == 401

        r = await client.post(
            "/v1/images/generate",
            json={"prompt": "a cat"},
            headers={"X-API-Key": "wrong"},
        )
        assert r.status_code == 401

        r = await client.post(
            "/v1/images/generate",
            json={"prompt": "a cat"},
            headers={"X-API-Key": "test-secret-key"},
        )
        assert r.status_code == 202
        assert "task_id" in r.json()

    await state.comfy.aclose()
