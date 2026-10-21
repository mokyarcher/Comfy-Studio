"""Short-lived step-up auth for destructive admin actions (host services).

After a successful TOTP (login or action re-auth), the same admin session may
skip TOTP for HOST_ACTION_STEP_UP_SECONDS (default 5 minutes).
"""

from __future__ import annotations

import hashlib
import threading
import time

_lock = threading.Lock()
# key -> unix expires_at
_elevated: dict[str, float] = {}


def _key_from_token(token: str) -> str:
    return hashlib.sha256(f"stepup:{token}".encode("utf-8")).hexdigest()[:40]


def _key_from_user(user_id: str) -> str:
    return hashlib.sha256(f"stepup-user:{user_id}".encode("utf-8")).hexdigest()[:40]


def elevation_key(*, session_token: str | None, user_id: str | None) -> str | None:
    if session_token:
        return _key_from_token(session_token)
    if user_id:
        return _key_from_user(user_id)
    return None


def mark_elevated(key: str | None, *, ttl_seconds: int) -> int:
    """Grant step-up; returns remaining seconds."""
    if not key:
        return 0
    ttl = max(30, int(ttl_seconds))
    expires = time.time() + ttl
    with _lock:
        _purge_locked()
        _elevated[key] = expires
    return ttl


def remaining_seconds(key: str | None) -> int:
    if not key:
        return 0
    now = time.time()
    with _lock:
        _purge_locked()
        exp = _elevated.get(key)
        if exp is None or exp <= now:
            return 0
        return max(0, int(exp - now))


def is_elevated(key: str | None) -> bool:
    return remaining_seconds(key) > 0


def clear_elevated(key: str | None) -> None:
    if not key:
        return
    with _lock:
        _elevated.pop(key, None)


def _purge_locked() -> None:
    now = time.time()
    dead = [k for k, exp in _elevated.items() if exp <= now]
    for k in dead:
        del _elevated[k]
