from __future__ import annotations

import json
from pathlib import Path

import pytest
import respx
from httpx import Response

from app.comfy_client import ComfyClient
from app.database import Database
from app.privacy_cleanup import delete_under, resolve_under
from app.schemas import GenerateImageRequest
from app.task_service import TaskService
from app.workflow import WorkflowRegistry, load_workflow_bundle


def _registry(settings) -> WorkflowRegistry:
    return WorkflowRegistry.from_flat(
        {
            "txt2img": load_workflow_bundle(
                settings.workflow_path, settings.workflow_mapping_path, mode="txt2img"
            )
        }
    )


def test_resolve_under_rejects_traversal(tmp_path: Path):
    root = tmp_path / "input"
    root.mkdir()
    assert resolve_under(root, filename="ok.png") == (root / "ok.png").resolve()
    assert resolve_under(root, filename="../secret.png") is None
    assert resolve_under(root, filename="a/b.png") is None
    assert resolve_under(root, filename="x.png", subfolder="..") is None


def test_delete_under_safe(tmp_path: Path):
    root = tmp_path / "out"
    root.mkdir()
    f = root / "a.png"
    f.write_bytes(b"x")
    assert delete_under(root, filename="a.png") is True
    assert not f.exists()
    assert delete_under(root, filename="missing.png") is True
    assert delete_under(None, filename="a.png") is False


@pytest.mark.asyncio
@respx.mock
async def test_purge_task_scrubs_api_side(test_settings, tmp_path: Path, monkeypatch):
    settings = test_settings
    comfy_in = tmp_path / "comfy_in"
    comfy_out = tmp_path / "comfy_out"
    comfy_in.mkdir()
    comfy_out.mkdir()
    (comfy_in / "up.png").write_bytes(b"in")
    (comfy_out / "gen.png").write_bytes(b"out")

    monkeypatch.setattr(settings, "comfy_input_dir", comfy_in)
    monkeypatch.setattr(settings, "comfy_output_dir", comfy_out)

    db = Database(settings.database_path)
    comfy = ComfyClient(settings)
    svc = TaskService(settings, db, _registry(settings), comfy)

    respx.post(f"{settings.comfyui_url}/history").mock(return_value=Response(200, json={}))

    task = svc.submit(GenerateImageRequest(prompt="secret prompt", mode="txt2img"))
    # Simulate succeeded task with purge checklist
    task_dir = settings.image_output_dir / task.task_id
    task_dir.mkdir(parents=True)
    (task_dir / "0.png").write_bytes(b"img")
    db.add_image(
        task_id=task.task_id,
        image_index=0,
        filename="0.png",
        relative_path=f"{task.task_id}/0.png",
        content_type="image/png",
    )
    payload = task.request
    payload["comfy_inputs"] = ["up.png"]
    payload["comfy_outputs"] = [{"filename": "gen.png", "subfolder": "", "type": "output"}]
    payload["comfy_prompt_id"] = "pid-purge"
    db.update_request(task.task_id, payload)
    db.set_prompt_id(task.task_id, "pid-purge")
    db.mark_succeeded(task.task_id)

    result = await svc.purge_task(task.task_id)
    assert result is not None
    assert result.status.value == "purged"
    assert result.deleted_api_images == 1
    assert result.deleted_comfy_inputs == 1
    assert result.deleted_comfy_outputs == 1
    assert not (comfy_in / "up.png").exists()
    assert not (comfy_out / "gen.png").exists()
    assert not task_dir.exists()

    purged = db.get_task(task.task_id)
    assert purged is not None
    assert purged.status == "purged"
    body = json.loads(purged.request_json)
    assert body.get("purged") is True
    assert "secret prompt" not in purged.request_json
    assert db.list_images(task.task_id) == []

    # idempotent
    again = await svc.purge_task(task.task_id)
    assert again is not None
    assert again.message == "already_purged"

    await comfy.aclose()


@pytest.mark.asyncio
async def test_purge_without_comfy_dirs_still_clears_api(test_settings):
    settings = test_settings
    db = Database(settings.database_path)
    comfy = ComfyClient(settings)
    svc = TaskService(settings, db, _registry(settings), comfy)

    task = svc.submit(GenerateImageRequest(prompt="keep quiet"))
    task_dir = settings.image_output_dir / task.task_id
    task_dir.mkdir(parents=True)
    (task_dir / "0.png").write_bytes(b"img")
    db.add_image(
        task_id=task.task_id,
        image_index=0,
        filename="0.png",
        relative_path=f"{task.task_id}/0.png",
        content_type="image/png",
    )
    db.mark_succeeded(task.task_id)

    result = await svc.purge_task(task.task_id)
    assert result is not None
    assert result.deleted_api_images == 1
    assert result.comfy_dirs_configured is False
    assert not task_dir.exists()
    await comfy.aclose()
