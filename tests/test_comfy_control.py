from __future__ import annotations

import json

import httpx
import pytest

from app.comfy_client import ComfyClient, ComfyClientError
from app.config import Settings


@pytest.mark.asyncio
async def test_comfy_interrupt_clear_free() -> None:
    calls: list[tuple[str, dict | None]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode()) if request.content else None
        calls.append((request.url.path, body))
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport, base_url="http://comfy.test")
    comfy = ComfyClient(Settings(comfyui_url="http://comfy.test"), client=client)

    await comfy.interrupt()
    await comfy.clear_queue()
    await comfy.free_memory(unload_models=True, free_memory=True)

    assert calls[0] == ("/interrupt", None)
    assert ("/queue", {"clear": True}) in calls
    assert ("/free", {"unload_models": True, "free_memory": True}) in calls

    with pytest.raises(ComfyClientError):
        await comfy.free_memory(unload_models=False, free_memory=False)

    await comfy.aclose()
