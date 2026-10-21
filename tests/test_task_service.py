from __future__ import annotations

import pytest
import respx
from httpx import ASGITransport, AsyncClient, Response

from app.comfy_client import ComfyClient, ComfyClientError
from app.config import get_settings
from app.database import Database
from app.main import create_app, state
from app.schemas import GenerateImageRequest
from app.task_service import QueueFullError, TaskService
from app.workflow import WorkflowRegistry, load_workflow_bundle
from app.worker import TaskWorker


def _registry(settings) -> WorkflowRegistry:
    return WorkflowRegistry.from_flat(
        {
            "txt2img": load_workflow_bundle(
                settings.workflow_path, settings.workflow_mapping_path, mode="txt2img"
            )
        }
    )


def _svc(test_settings) -> TaskService:
    settings = test_settings
    db = Database(settings.database_path)
    comfy = ComfyClient(settings)
    return TaskService(settings, db, _registry(settings), comfy)


@pytest.mark.asyncio
async def test_queue_full(test_settings):
    svc = _svc(test_settings)
    await svc.comfy.aclose()
    # reopen for sync submit only
    svc = _svc(test_settings)
    req = GenerateImageRequest(prompt="one")
    svc.submit(req)
    svc.submit(GenerateImageRequest(prompt="two"))
    with pytest.raises(QueueFullError):
        svc.submit(GenerateImageRequest(prompt="three"))
    await svc.comfy.aclose()


@pytest.mark.asyncio
async def test_path_traversal_blocked(test_settings, tmp_path):
    svc = _svc(test_settings)
    task = svc.submit(GenerateImageRequest(prompt="img"))
    # craft malicious relative path outside image dir
    outside = tmp_path / "secret.txt"
    outside.write_text("nope", encoding="utf-8")
    svc.db.mark_succeeded(task.task_id)
    svc.db.add_image(
        task_id=task.task_id,
        image_index=0,
        filename="x.png",
        relative_path="../secret.txt",
        content_type="image/png",
    )
    assert svc.resolve_image_path(task.task_id, 0) is None
    await svc.comfy.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_comfy_failure_marks_failed_without_api_key(test_settings):
    settings = test_settings
    db = Database(settings.database_path)
    comfy = ComfyClient(settings)
    svc = TaskService(settings, db, _registry(settings), comfy)

    respx.post(f"{settings.comfyui_url}/prompt").mock(
        return_value=Response(500, text="boom api_key=should-not-leak")
    )

    task = svc.submit(GenerateImageRequest(prompt="fail me"))
    await svc.process_task(db.get_task(task.task_id))
    failed = db.get_task(task.task_id)
    assert failed is not None
    assert failed.status == "failed"
    assert failed.error_code == "comfy_prompt_rejected"
    assert "test-secret-key" not in (failed.error_message or "")
    await comfy.aclose()


@pytest.mark.asyncio
async def test_restart_running_without_prompt_id_fails(test_settings):
    svc = _svc(test_settings)
    task = svc.submit(GenerateImageRequest(prompt="running"))
    svc.db.mark_running(task.task_id, comfy_prompt_id=None)
    await svc.recover_running_tasks()
    recovered = svc.db.get_task(task.task_id)
    assert recovered is not None
    assert recovered.status == "failed"
    assert "无法确认" in (recovered.error_message or "")
    await svc.comfy.aclose()


@pytest.mark.asyncio
async def test_status_includes_sampler_progress(test_settings):
    svc = _svc(test_settings)
    task = svc.submit(GenerateImageRequest(prompt="progress"))
    svc.db.mark_running(task.task_id)
    svc.set_progress(task.task_id, 9, 20)
    status = svc.get_status(task.task_id)
    assert status is not None
    assert status.progress is not None
    assert status.progress.value == 9
    assert status.progress.max == 20
    assert status.progress.percent == 45.0
    svc.clear_progress(task.task_id)
    assert svc.get_status(task.task_id).progress is None
    await svc.comfy.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_process_success_saves_image(test_settings):
    settings = test_settings
    db = Database(settings.database_path)
    comfy = ComfyClient(settings)
    svc = TaskService(settings, db, _registry(settings), comfy)

    respx.post(f"{settings.comfyui_url}/prompt").mock(
        return_value=Response(200, json={"prompt_id": "pid-1", "node_errors": {}})
    )
    respx.get(f"{settings.comfyui_url}/history/pid-1").mock(
        return_value=Response(
            200,
            json={
                "pid-1": {
                    "status": {"completed": True, "status_str": "success"},
                    "outputs": {
                        "14": {
                            "images": [
                                {
                                    "filename": "out.png",
                                    "subfolder": "",
                                    "type": "output",
                                }
                            ]
                        }
                    },
                }
            },
        )
    )
    respx.get(f"{settings.comfyui_url}/view").mock(
        return_value=Response(200, content=b"fakepng", headers={"content-type": "image/png"})
    )

    task = svc.submit(GenerateImageRequest(prompt="ok", width=512, height=512, steps=10))
    await svc.process_task(db.get_task(task.task_id))
    done = db.get_task(task.task_id)
    assert done is not None
    assert done.status == "succeeded"
    images = db.list_images(task.task_id)
    assert len(images) == 1
    path = settings.image_output_dir / images[0].relative_path
    assert path.read_bytes() == b"fakepng"
    await comfy.aclose()


@pytest.mark.asyncio
async def test_api_queue_full_http(test_settings):
    from app.user_store import UserStore

    get_settings.cache_clear()
    app = create_app()
    settings = test_settings
    state.settings = settings
    state.db = Database(settings.database_path)
    state.comfy = ComfyClient(settings)
    state.registry = _registry(settings)
    state.task_service = TaskService(settings, state.db, state.registry, state.comfy)
    state.worker = TaskWorker(state.db, state.task_service)
    state.user_store = UserStore(settings.users_db_path)
    state.user_store.ensure_bootstrap_admin(settings.api_key)
    app.state.user_store = state.user_store
    app.state.settings = settings

    headers = {"X-API-Key": "test-secret-key"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.post("/v1/images/generate", headers=headers, json={"prompt": "a"})).status_code == 202
        assert (await client.post("/v1/images/generate", headers=headers, json={"prompt": "b"})).status_code == 202
        r = await client.post("/v1/images/generate", headers=headers, json={"prompt": "c"})
        assert r.status_code == 429
    await state.comfy.aclose()
