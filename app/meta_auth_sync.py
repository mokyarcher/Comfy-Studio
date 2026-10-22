"""GPU plane: resolve unknown API keys against cloud Meta users.db."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.user_store import ApiUser, UserStore

logger = logging.getLogger(__name__)


def fetch_user_from_meta(
    *,
    base_url: str,
    sync_secret: str,
    api_key: str,
    timeout: float = 8.0,
) -> dict[str, Any] | None:
    """POST Meta /v1/internal/auth/resolve. Returns user payload or None."""
    root = (base_url or "").strip().rstrip("/")
    secret = (sync_secret or "").strip()
    if not root or not secret or not api_key:
        return None
    url = f"{root}/v1/internal/auth/resolve"
    try:
        with httpx.Client(timeout=timeout) as client:
            res = client.post(
                url,
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "X-Meta-Sync-Key": secret,
                },
                json={"api_key": api_key},
            )
    except httpx.HTTPError as exc:
        logger.warning("meta auth sync network error: %s", exc)
        return None
    if res.status_code == 404:
        return None
    if res.status_code != 200:
        logger.warning(
            "meta auth sync http=%s body=%s",
            res.status_code,
            (res.text or "")[:200],
        )
        return None
    try:
        data = res.json()
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def upsert_user_from_meta_payload(store: UserStore, data: dict[str, Any]) -> ApiUser | None:
    """Write Meta user row into local GPU users.db (id is stable)."""
    try:
        return store.upsert_synced_user(
            user_id=str(data["id"]),
            name=str(data.get("name") or ""),
            username=str(data.get("username") or ""),
            password_hash=str(data.get("password_hash") or ""),
            status=str(data.get("status") or "active"),
            api_key_hash=str(data["api_key_hash"]),
            api_key_prefix=str(data.get("api_key_prefix") or ""),
            api_key_secret=str(data.get("api_key_secret") or ""),
            enabled=bool(data.get("enabled", True)),
            is_admin=bool(data.get("is_admin", False)),
            daily_generate_limit=int(data.get("daily_generate_limit") or 0),
            daily_polish_limit=int(data.get("daily_polish_limit") or 0),
            note=str(data.get("note") or ""),
            created_at=str(data.get("created_at") or ""),
            last_seen_at=data.get("last_seen_at"),
            email=str(data.get("email") or ""),
        )
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning("meta auth sync bad payload: %s", exc)
        return None
