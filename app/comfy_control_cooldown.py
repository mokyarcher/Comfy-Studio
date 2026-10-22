"""Shared ComfyUI control cooldowns (interrupt / clear queue / free) across all users.

In-memory on the GPU API process — one CD clock for the whole host.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Literal

ComfyControlAction = Literal["interrupt", "clear_queue", "free"]

ACTIONS: tuple[ComfyControlAction, ...] = ("interrupt", "clear_queue", "free")

_lock = threading.Lock()
# action -> monotonic deadline (time.monotonic)
_until: dict[str, float] = {}


def _iso_from_mono(deadline_mono: float) -> str:
    wall = time.time() + (deadline_mono - time.monotonic())
    return datetime.fromtimestamp(wall, tz=timezone.utc).isoformat()


def remaining_seconds(action: ComfyControlAction) -> int:
    with _lock:
        deadline = _until.get(action, 0.0)
        left = deadline - time.monotonic()
        if left <= 0:
            _until.pop(action, None)
            return 0
        return int(left + 0.999)  # ceil


def cooldown_until_iso(action: ComfyControlAction) -> str | None:
    with _lock:
        deadline = _until.get(action, 0.0)
        if deadline <= time.monotonic():
            _until.pop(action, None)
            return None
        return _iso_from_mono(deadline)


def check_allowed(action: ComfyControlAction) -> tuple[bool, int, str | None]:
    """Return (allowed, remaining_seconds, until_iso)."""
    left = remaining_seconds(action)
    if left > 0:
        return False, left, cooldown_until_iso(action)
    return True, 0, None


def mark_used(action: ComfyControlAction, seconds: int) -> tuple[int, str]:
    """Start / refresh shared CD. Returns (remaining, until_iso)."""
    sec = max(0, int(seconds))
    with _lock:
        deadline = time.monotonic() + sec
        _until[action] = deadline
        until = _iso_from_mono(deadline)
    return sec, until


def status_snapshot(default_seconds: int) -> dict:
    actions: dict[str, dict] = {}
    for action in ACTIONS:
        left = remaining_seconds(action)
        actions[action] = {
            "remaining_seconds": left,
            "cooldown_until": cooldown_until_iso(action) if left > 0 else None,
        }
    return {
        "cooldown_seconds": max(0, int(default_seconds)),
        "actions": actions,
        "server_time": datetime.now(tz=timezone.utc).isoformat(),
    }


def reset_for_tests() -> None:
    with _lock:
        _until.clear()
