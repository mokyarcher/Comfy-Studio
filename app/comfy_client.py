from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx
import websockets

from app.config import Settings
from app.logging_config import truncate_for_log

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[int, int], None]


class ComfyClientError(Exception):
    def __init__(self, message: str, *, code: str = "comfy_error") -> None:
        super().__init__(message)
        self.code = code


@dataclass
class ComfyImageRef:
    filename: str
    subfolder: str
    image_type: str


def comfy_ws_url(http_base: str, client_id: str) -> str:
    """Build ComfyUI progress WebSocket URL from HTTP base."""
    parsed = urlparse(http_base.rstrip("/"))
    scheme = "wss" if parsed.scheme == "https" else "ws"
    netloc = parsed.netloc or parsed.path
    return f"{scheme}://{netloc}/ws?clientId={client_id}"


class ComfyClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self._settings = settings
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            base_url=settings.comfyui_url,
            timeout=httpx.Timeout(settings.comfyui_timeout_seconds),
        )

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def ping(self) -> bool:
        try:
            response = await self._client.get("/system_stats")
            return response.status_code == 200
        except httpx.HTTPError:
            return False

    async def submit_prompt(
        self, workflow: dict[str, Any], *, client_id: str | None = None
    ) -> str:
        cid = client_id or str(uuid.uuid4())
        payload = {"prompt": workflow, "client_id": cid}
        try:
            response = await self._client.post("/prompt", json=payload)
        except httpx.HTTPError as exc:
            raise ComfyClientError(
                f"Failed to reach ComfyUI /prompt: {exc}",
                code="comfy_unreachable",
            ) from exc

        if response.status_code >= 400:
            detail = truncate_for_log(response.text, 200)
            raise ComfyClientError(
                f"ComfyUI rejected prompt ({response.status_code}): {detail}",
                code="comfy_prompt_rejected",
            )

        data = response.json()
        prompt_id = data.get("prompt_id")
        if not prompt_id:
            raise ComfyClientError("ComfyUI response missing prompt_id", code="comfy_bad_response")
        node_errors = data.get("node_errors") or {}
        if node_errors:
            raise ComfyClientError(
                f"ComfyUI node errors: {truncate_for_log(str(node_errors), 200)}",
                code="comfy_node_errors",
            )
        logger.info("Submitted prompt_id=%s client_id=%s", prompt_id, cid)
        return str(prompt_id)

    async def get_history(self, prompt_id: str) -> dict[str, Any] | None:
        try:
            response = await self._client.get(f"/history/{prompt_id}")
        except httpx.HTTPError as exc:
            raise ComfyClientError(
                f"Failed to query ComfyUI history: {exc}",
                code="comfy_unreachable",
            ) from exc
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise ComfyClientError(
                f"ComfyUI history error ({response.status_code})",
                code="comfy_history_error",
            )
        data = response.json()
        if not data:
            return None
        return data.get(prompt_id) or next(iter(data.values()), None)

    async def _progress_listener(
        self,
        *,
        client_id: str,
        prompt_id: str,
        on_progress: ProgressCallback,
        stop: asyncio.Event,
    ) -> None:
        """Listen for ComfyUI WS `progress` (value/max). Best-effort; never raises out."""
        uri = comfy_ws_url(self._settings.comfyui_url, client_id)
        try:
            async with websockets.connect(
                uri,
                open_timeout=5,
                close_timeout=2,
                max_size=8 * 1024 * 1024,
            ) as ws:
                while not stop.is_set():
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                    except asyncio.TimeoutError:
                        continue
                    if isinstance(raw, (bytes, bytearray)):
                        continue
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if msg.get("type") != "progress":
                        continue
                    data = msg.get("data") or {}
                    pid = data.get("prompt_id")
                    if pid is not None and str(pid) != str(prompt_id):
                        continue
                    try:
                        value = int(data.get("value") or 0)
                        max_v = int(data.get("max") or 0)
                    except (TypeError, ValueError):
                        continue
                    if max_v <= 0:
                        continue
                    try:
                        on_progress(value, max_v)
                    except Exception:  # noqa: BLE001
                        logger.exception("on_progress callback failed")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.debug("ComfyUI progress WS ended: %s", exc)

    async def wait_for_completion(
        self,
        prompt_id: str,
        *,
        timeout_seconds: float | None = None,
        client_id: str | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> dict[str, Any]:
        limit = (
            float(timeout_seconds)
            if timeout_seconds is not None
            else float(self._settings.comfyui_job_timeout_seconds)
        )
        deadline = asyncio.get_running_loop().time() + limit
        stop = asyncio.Event()
        listener: asyncio.Task[None] | None = None
        if client_id and on_progress is not None:
            listener = asyncio.create_task(
                self._progress_listener(
                    client_id=client_id,
                    prompt_id=prompt_id,
                    on_progress=on_progress,
                    stop=stop,
                )
            )
        try:
            while True:
                history = await self.get_history(prompt_id)
                if history is not None:
                    status = history.get("status") or {}
                    if status.get("status_str") == "error" or status.get("completed") is False:
                        messages = status.get("messages") or []
                        raise ComfyClientError(
                            f"ComfyUI job failed: {truncate_for_log(str(messages), 200)}",
                            code="comfy_job_failed",
                        )
                    outputs = history.get("outputs") or {}
                    if outputs or status.get("completed") is True:
                        return history

                if asyncio.get_running_loop().time() >= deadline:
                    raise ComfyClientError(
                        f"ComfyUI job timed out after {limit}s",
                        code="comfy_timeout",
                    )
                await asyncio.sleep(self._settings.comfyui_poll_interval_seconds)
        finally:
            stop.set()
            if listener is not None:
                listener.cancel()
                try:
                    await listener
                except asyncio.CancelledError:
                    pass
                except Exception:  # noqa: BLE001
                    logger.debug("Progress listener cleanup error", exc_info=True)

    def extract_images(self, history: dict[str, Any]) -> list[ComfyImageRef]:
        return self.extract_media(history, kinds=("images",))

    def extract_media(
        self,
        history: dict[str, Any],
        *,
        kinds: tuple[str, ...] = ("images", "gifs", "videos"),
    ) -> list[ComfyImageRef]:
        """Collect ComfyUI output file refs (images and/or SaveVideo outputs)."""
        media: list[ComfyImageRef] = []
        outputs = history.get("outputs") or {}
        for _node_id, node_output in outputs.items():
            if not isinstance(node_output, dict):
                continue
            for kind in kinds:
                for item in node_output.get(kind) or []:
                    if not isinstance(item, dict):
                        continue
                    filename = item.get("filename")
                    if not filename:
                        continue
                    media.append(
                        ComfyImageRef(
                            filename=str(filename),
                            subfolder=str(item.get("subfolder") or ""),
                            image_type=str(item.get("type") or "output"),
                        )
                    )
        return media

    async def download_image(self, ref: ComfyImageRef) -> tuple[bytes, str]:
        params = {
            "filename": ref.filename,
            "subfolder": ref.subfolder,
            "type": ref.image_type,
        }
        try:
            response = await self._client.get("/view", params=params)
        except httpx.HTTPError as exc:
            raise ComfyClientError(
                f"Failed to download image from ComfyUI: {exc}",
                code="comfy_download_failed",
            ) from exc
        if response.status_code >= 400:
            raise ComfyClientError(
                f"ComfyUI /view failed ({response.status_code})",
                code="comfy_download_failed",
            )
        content_type = response.headers.get("content-type") or "application/octet-stream"
        return response.content, content_type

    async def upload_image(
        self,
        data: bytes,
        filename: str,
        *,
        overwrite: bool = True,
        content_type: str = "application/octet-stream",
    ) -> ComfyImageRef:
        """Upload an image into ComfyUI's input folder (for LoadImage nodes)."""
        files = {"image": (filename, data, content_type)}
        form = {"overwrite": "true" if overwrite else "false"}
        try:
            response = await self._client.post("/upload/image", files=files, data=form)
        except httpx.HTTPError as exc:
            raise ComfyClientError(
                f"Failed to reach ComfyUI /upload/image: {exc}",
                code="comfy_unreachable",
            ) from exc
        if response.status_code >= 400:
            detail = truncate_for_log(response.text, 200)
            raise ComfyClientError(
                f"ComfyUI upload rejected ({response.status_code}): {detail}",
                code="comfy_upload_rejected",
            )
        payload = response.json()
        name = payload.get("name") or filename
        return ComfyImageRef(
            filename=str(name),
            subfolder=str(payload.get("subfolder") or ""),
            image_type=str(payload.get("type") or "input"),
        )

    async def delete_history(self, prompt_id: str) -> bool:
        """Remove one prompt from ComfyUI history (best-effort)."""
        if not prompt_id:
            return False
        try:
            response = await self._client.post(
                "/history",
                json={"delete": [prompt_id]},
            )
        except httpx.HTTPError as exc:
            logger.warning("ComfyUI history delete failed: %s", exc)
            return False
        if response.status_code >= 400:
            logger.warning(
                "ComfyUI history delete rejected (%s): %s",
                response.status_code,
                truncate_for_log(response.text, 120),
            )
            return False
        return True

    async def interrupt(self) -> None:
        """Stop the currently executing workflow (POST /interrupt)."""
        try:
            response = await self._client.post("/interrupt")
        except httpx.HTTPError as exc:
            raise ComfyClientError(
                f"Failed to reach ComfyUI /interrupt: {exc}",
                code="comfy_unreachable",
            ) from exc
        if response.status_code >= 400:
            raise ComfyClientError(
                f"ComfyUI /interrupt failed ({response.status_code})",
                code="comfy_interrupt_failed",
            )

    async def clear_queue(self) -> None:
        """Clear pending prompts in ComfyUI (POST /queue {clear:true})."""
        try:
            response = await self._client.post("/queue", json={"clear": True})
        except httpx.HTTPError as exc:
            raise ComfyClientError(
                f"Failed to reach ComfyUI /queue: {exc}",
                code="comfy_unreachable",
            ) from exc
        if response.status_code >= 400:
            raise ComfyClientError(
                f"ComfyUI /queue clear failed ({response.status_code})",
                code="comfy_queue_clear_failed",
            )

    async def free_memory(
        self, *, unload_models: bool = True, free_memory: bool = True
    ) -> None:
        """Unload models and/or clear execution cache (POST /free)."""
        if not unload_models and not free_memory:
            raise ComfyClientError(
                "unload_models or free_memory required",
                code="comfy_free_noop",
            )
        payload = {"unload_models": unload_models, "free_memory": free_memory}
        try:
            response = await self._client.post("/free", json=payload)
        except httpx.HTTPError as exc:
            raise ComfyClientError(
                f"Failed to reach ComfyUI /free: {exc}",
                code="comfy_unreachable",
            ) from exc
        if response.status_code >= 400:
            raise ComfyClientError(
                f"ComfyUI /free failed ({response.status_code})",
                code="comfy_free_failed",
            )
