from __future__ import annotations

import logging
import mimetypes
import secrets
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.comfy_client import ComfyClient, ComfyClientError
from app.config import Settings
from app.database import Database, TaskImageRecord, TaskRecord
from app.logging_config import truncate_for_log
from app.privacy_cleanup import delete_under
from app.schemas import (
    GenerateImageRequest,
    ImageMeta,
    PurgeTaskResponse,
    TaskResultResponse,
    TaskStatus,
    TaskStatusResponse,
)
from app.workflow import WorkflowError, WorkflowRegistry, apply_parameters

logger = logging.getLogger(__name__)


class QueueFullError(Exception):
    pass


class UnsupportedModeError(Exception):
    pass


class TaskService:
    def __init__(
        self,
        settings: Settings,
        db: Database,
        registry: WorkflowRegistry,
        comfy: ComfyClient,
    ) -> None:
        self.settings = settings
        self.db = db
        self.registry = registry
        self.comfy = comfy
        self.settings.image_output_dir.mkdir(parents=True, exist_ok=True)

    def submit(self, request: GenerateImageRequest) -> TaskRecord:
        if not self.registry.has(request.mode):
            raise UnsupportedModeError(
                f"mode={request.mode!r} is not available "
                f"(loaded: {', '.join(self.registry.modes)})"
            )

        open_count = self.db.count_open_tasks()
        if open_count >= self.settings.max_queue_size:
            raise QueueFullError(
                f"Queue is full ({self.settings.max_queue_size} open tasks)"
            )

        seed = request.seed if request.seed is not None else secrets.randbits(63)
        task_id = str(uuid.uuid4())
        payload = request.model_dump()
        payload["seed"] = seed
        record = self.db.create_task(task_id, payload, seed=seed, status="queued")
        q = self.db.queue_info(task_id)
        logger.info(
            "Queued task_id=%s mode=%s seed=%s position=%s ahead=%s prompt=%s",
            task_id,
            request.mode,
            seed,
            q["queue_position"],
            q["queue_ahead"],
            truncate_for_log(request.prompt),
        )
        return record

    def get_status(self, task_id: str) -> TaskStatusResponse | None:
        task = self.db.get_task(task_id)
        if task is None:
            return None
        q: dict[str, int] = {"queue_position": 0, "queue_ahead": 0, "queue_size": 0}
        if task.status in ("queued", "running"):
            q = self.db.queue_info(task_id)
        return TaskStatusResponse(
            task_id=task.task_id,
            status=TaskStatus(task.status),
            created_at=task.created_at,
            started_at=task.started_at,
            finished_at=task.finished_at,
            seed=task.seed,
            error_code=task.error_code,
            error_message=task.error_message,
            queue_position=q["queue_position"] or None,
            queue_ahead=q["queue_ahead"] if task.status in ("queued", "running") else None,
            queue_size=q["queue_size"] or None,
            max_queue_size=self.settings.max_queue_size,
        )

    def get_result(self, task_id: str) -> TaskResultResponse | None:
        task = self.db.get_task(task_id)
        if task is None:
            return None
        images = [
            ImageMeta(
                index=img.image_index,
                filename=img.filename,
                content_type=img.content_type,
                url=f"/v1/tasks/{task_id}/images/{img.image_index}",
            )
            for img in self.db.list_images(task_id)
        ]
        return TaskResultResponse(
            task_id=task.task_id,
            status=TaskStatus(task.status),
            seed=task.seed,
            images=images if task.status == TaskStatus.succeeded.value else [],
            error_code=task.error_code,
            error_message=task.error_message,
        )

    def resolve_image_path(self, task_id: str, image_index: int) -> tuple[Path, TaskImageRecord] | None:
        record = self.db.get_image(task_id, image_index)
        if record is None:
            return None
        base = self.settings.image_output_dir.resolve()
        candidate = (base / record.relative_path).resolve()
        try:
            candidate.relative_to(base)
        except ValueError:
            logger.error("Rejected path traversal for task_id=%s", task_id)
            return None
        if not candidate.is_file():
            return None
        return candidate, record

    async def process_task(self, task: TaskRecord) -> None:
        self.db.mark_running(task.task_id)
        request = task.request
        try:
            mode = str(request.get("mode") or "txt2img")
            bundle = self.registry.get(mode)
            workflow = apply_parameters(
                bundle,
                prompt=request["prompt"],
                negative_prompt=request.get("negative_prompt"),
                width=request.get("width"),
                height=request.get("height"),
                steps=request.get("steps"),
                seed=int(request["seed"]),
                images=request.get("images"),
                length=request.get("length"),
            )
            prompt_id = await self.comfy.submit_prompt(workflow)
            self.db.set_prompt_id(task.task_id, prompt_id)
            job_timeout = None
            if mode == "image_to_video":
                job_timeout = float(self.settings.comfyui_video_job_timeout_seconds)
            history = await self.comfy.wait_for_completion(
                prompt_id, timeout_seconds=job_timeout
            )
            await self._persist_images(task.task_id, history, request=request)
            self.db.mark_succeeded(task.task_id)
            logger.info("Task succeeded task_id=%s prompt_id=%s", task.task_id, prompt_id)
        except WorkflowError as exc:
            self.db.mark_failed(task.task_id, "workflow_error", str(exc))
            logger.exception("Workflow error task_id=%s", task.task_id)
        except ComfyClientError as exc:
            self.db.mark_failed(task.task_id, exc.code, str(exc))
            logger.error("Comfy error task_id=%s code=%s", task.task_id, exc.code)
        except Exception as exc:  # noqa: BLE001
            self.db.mark_failed(task.task_id, "internal_error", "Unexpected processing error")
            logger.exception("Unexpected error task_id=%s: %s", task.task_id, exc)

    async def recover_running_tasks(self) -> None:
        running = self.db.list_tasks_by_status("running")
        for task in running:
            if not task.comfy_prompt_id:
                self.db.mark_failed(
                    task.task_id,
                    "interrupted",
                    "服务重启时任务状态无法确认",
                )
                continue
            try:
                history = await self.comfy.get_history(task.comfy_prompt_id)
                if history and (history.get("outputs") or (history.get("status") or {}).get("completed")):
                    await self._persist_images(task.task_id, history, request=task.request)
                    self.db.mark_succeeded(task.task_id)
                    logger.info("Recovered succeeded task_id=%s", task.task_id)
                else:
                    self.db.mark_failed(
                        task.task_id,
                        "interrupted",
                        "服务重启时任务状态无法确认",
                    )
            except Exception:  # noqa: BLE001
                self.db.mark_failed(
                    task.task_id,
                    "interrupted",
                    "服务重启时任务状态无法确认",
                )
                logger.exception("Failed to recover task_id=%s", task.task_id)

    async def _persist_images(
        self,
        task_id: str,
        history: dict[str, Any],
        *,
        request: dict[str, Any] | None = None,
    ) -> None:
        existing = self.db.list_images(task_id)
        if existing:
            return
        mode = str((request or {}).get("mode") or "txt2img")
        if mode == "image_to_video":
            refs = self.comfy.extract_media(history, kinds=("videos", "gifs", "images"))
            empty_code = "no_videos"
            empty_msg = "ComfyUI finished without video outputs"
        else:
            refs = self.comfy.extract_images(history)
            empty_code = "no_images"
            empty_msg = "ComfyUI finished without image outputs"
        if not refs:
            raise ComfyClientError(empty_msg, code=empty_code)

        task_dir = self.settings.image_output_dir / task_id
        task_dir.mkdir(parents=True, exist_ok=True)

        for index, ref in enumerate(refs):
            content, content_type = await self.comfy.download_image(ref)
            suffix = Path(ref.filename).suffix or mimetypes.guess_extension(content_type)
            if not suffix:
                suffix = ".mp4" if mode == "image_to_video" else ".png"
            if mode == "image_to_video" and not content_type.startswith("video/"):
                lower = suffix.lower()
                if lower in (".mp4", ".webm", ".mov"):
                    content_type = {
                        ".mp4": "video/mp4",
                        ".webm": "video/webm",
                        ".mov": "video/quicktime",
                    }.get(lower, "video/mp4")
            filename = f"{index}{suffix}"
            absolute = task_dir / filename
            absolute.write_bytes(content)
            relative = f"{task_id}/{filename}"
            self.db.add_image(
                task_id=task_id,
                image_index=index,
                filename=filename,
                relative_path=relative,
                content_type=content_type or ("video/mp4" if mode == "image_to_video" else "image/png"),
            )

        # Store purge checklist on the task request payload
        task = self.db.get_task(task_id)
        payload = dict(request or (task.request if task else {}))
        inputs = payload.get("images") or []
        if isinstance(inputs, list):
            payload["comfy_inputs"] = [str(x) for x in inputs if x]
        else:
            payload["comfy_inputs"] = []
        payload["comfy_outputs"] = [
            {
                "filename": ref.filename,
                "subfolder": ref.subfolder,
                "type": ref.image_type,
            }
            for ref in refs
        ]
        if task and task.comfy_prompt_id:
            payload["comfy_prompt_id"] = task.comfy_prompt_id
        self.db.update_request(task_id, payload)

    async def purge_task(self, task_id: str) -> PurgeTaskResponse | None:
        task = self.db.get_task(task_id)
        if task is None:
            return None

        if task.status == TaskStatus.purged.value:
            return PurgeTaskResponse(
                task_id=task_id,
                status=TaskStatus.purged,
                message="already_purged",
                comfy_dirs_configured=bool(
                    self.settings.comfy_input_dir or self.settings.comfy_output_dir
                ),
            )

        if task.status not in (TaskStatus.succeeded.value, TaskStatus.failed.value):
            raise ValueError(f"task status {task.status!r} cannot be purged yet")

        payload = task.request
        comfy_inputs = list(payload.get("comfy_inputs") or payload.get("images") or [])
        comfy_outputs = list(payload.get("comfy_outputs") or [])
        prompt_id = str(payload.get("comfy_prompt_id") or task.comfy_prompt_id or "")

        deleted_inputs = 0
        deleted_outputs = 0
        dirs_configured = bool(
            self.settings.comfy_input_dir or self.settings.comfy_output_dir
        )

        if self.settings.comfy_input_dir:
            for name in comfy_inputs:
                if isinstance(name, str) and delete_under(
                    self.settings.comfy_input_dir, filename=name
                ):
                    deleted_inputs += 1
        elif comfy_inputs:
            logger.warning(
                "COMFY_INPUT_DIR not set; skip deleting %s input file(s) for %s",
                len(comfy_inputs),
                task_id,
            )

        if self.settings.comfy_output_dir:
            for item in comfy_outputs:
                if not isinstance(item, dict):
                    continue
                fname = str(item.get("filename") or "")
                sub = str(item.get("subfolder") or "")
                # Only delete from output/temp trees we manage
                itype = str(item.get("type") or "output")
                root = self.settings.comfy_output_dir
                if itype == "temp":
                    # temp often lives next to output; try output dir first
                    pass
                if delete_under(root, filename=fname, subfolder=sub):
                    deleted_outputs += 1
        elif comfy_outputs:
            logger.warning(
                "COMFY_OUTPUT_DIR not set; skip deleting %s output file(s) for %s",
                len(comfy_outputs),
                task_id,
            )

        history_cleared = False
        if prompt_id:
            history_cleared = await self.comfy.delete_history(prompt_id)

        deleted_api = self._delete_api_image_dir(task_id)
        self.db.delete_task_images(task_id)

        scrubbed = {
            "mode": payload.get("mode") or "txt2img",
            "purged": True,
            "purged_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        }
        self.db.mark_purged(task_id, scrubbed)

        logger.info(
            "Purged task_id=%s api_images=%s comfy_in=%s comfy_out=%s history=%s",
            task_id,
            deleted_api,
            deleted_inputs,
            deleted_outputs,
            history_cleared,
        )
        return PurgeTaskResponse(
            task_id=task_id,
            status=TaskStatus.purged,
            deleted_api_images=deleted_api,
            deleted_comfy_inputs=deleted_inputs,
            deleted_comfy_outputs=deleted_outputs,
            history_cleared=history_cleared,
            comfy_dirs_configured=dirs_configured,
            message="purged",
        )

    def _delete_api_image_dir(self, task_id: str) -> int:
        base = self.settings.image_output_dir.resolve()
        task_dir = (base / task_id).resolve()
        try:
            task_dir.relative_to(base)
        except ValueError:
            logger.error("Rejected API image dir traversal for %s", task_id)
            return 0
        if not task_dir.exists():
            return 0
        count = sum(1 for p in task_dir.rglob("*") if p.is_file())
        shutil.rmtree(task_dir, ignore_errors=True)
        return count

    async def purge_stale_tasks(self) -> int:
        days = self.settings.image_retention_days
        if days <= 0:
            return 0
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        cutoff_iso = cutoff.replace(microsecond=0).isoformat()
        stale = self.db.list_stale_succeeded_tasks(cutoff_iso)
        purged = 0
        for task in stale:
            try:
                result = await self.purge_task(task.task_id)
                if result and result.message in ("purged", "already_purged"):
                    purged += 1
            except Exception:  # noqa: BLE001
                logger.exception("Orphan purge failed task_id=%s", task.task_id)
        if purged:
            logger.info("Orphan retention purged %s task(s)", purged)
        return purged
