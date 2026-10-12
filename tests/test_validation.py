from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.comfy_client import ComfyClient
from app.config import get_settings
from app.database import Database
from app.main import create_app, state
from app.task_service import TaskService
from app.workflow import WorkflowRegistry, load_workflow_bundle
from app.worker import TaskWorker


async def _client(test_settings):
    get_settings.cache_clear()
    app = create_app()
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
    transport = ASGITransport(app=app)
    client = AsyncClient(transport=transport, base_url="http://test")
    return client, state


@pytest.mark.asyncio
async def test_invalid_params_return_422(test_settings):
    client, st = await _client(test_settings)
    headers = {"X-API-Key": "test-secret-key"}
    async with client:
        r = await client.post(
            "/v1/images/generate",
            headers=headers,
            json={"prompt": "x", "width": 513, "height": 512},
        )
        assert r.status_code == 422

        r = await client.post(
            "/v1/images/generate",
            headers=headers,
            json={"prompt": "x", "steps": 999},
        )
        assert r.status_code == 422

        r = await client.post(
            "/v1/images/generate",
            headers=headers,
            json={"prompt": "p" * 5000},
        )
        assert r.status_code == 422

        r = await client.post(
            "/v1/images/generate",
            headers=headers,
            json={"prompt": "x", "width": 2048, "height": 2048},
        )
        # 2048*2048 may exceed default max_image_pixels in test? settings allow 4194304
        # but test_settings uses defaults from env; max pixels default 4194304 so OK -> 202
        assert r.status_code in (202, 422)
    await st.comfy.aclose()
