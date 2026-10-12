from __future__ import annotations

import secrets
from dataclasses import dataclass

from fastapi import Header, HTTPException, Request, status

from app.config import get_settings
from app.user_store import ApiUser, UserStore


@dataclass
class AuthContext:
    user: ApiUser
    api_key: str


def get_user_store(request: Request) -> UserStore:
    store = getattr(request.app.state, "user_store", None)
    if store is None:
        # Fallback during tests that set module-level state
        from app.main import state

        store = state.user_store
    return store


def resolve_user(store: UserStore, api_key: str | None) -> ApiUser:
    settings = get_settings()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )

    # Ensure bootstrap admin exists (idempotent if users already present)
    store.ensure_bootstrap_admin(settings.api_key)

    user = store.find_by_api_key(api_key)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )
    if not user.enabled or user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API key disabled",
        )
    store.touch_seen(user.id)
    return user


def verify_api_key(
    request: Request,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    store = get_user_store(request)
    resolve_user(store, x_api_key)


def require_auth(
    request: Request,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> AuthContext:
    store = get_user_store(request)
    user = resolve_user(store, x_api_key)
    assert x_api_key is not None
    return AuthContext(user=user, api_key=x_api_key)


def require_admin(auth: AuthContext) -> AuthContext:
    if not auth.user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin only",
        )
    return auth


def generate_api_key() -> str:
    return secrets.token_urlsafe(32)
