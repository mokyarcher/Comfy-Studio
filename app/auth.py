from __future__ import annotations

import secrets
from dataclasses import dataclass

from fastapi import Header, HTTPException, Request, status

from app.config import get_settings
from app.sms_auth import COOKIE_NAME
from app.user_store import ApiUser, UserStore


@dataclass
class AuthContext:
    user: ApiUser
    api_key: str
    via_sms_session: bool = False


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


def _first_admin_user(store: UserStore) -> ApiUser | None:
    for u in store.list_users():
        if u.is_admin and u.enabled:
            return u
    return None


def require_admin_access(
    request: Request,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> AuthContext:
    """Admin via X-API-Key (Electron Gateway) or admin_session cookie (SMS web)."""
    store = get_user_store(request)
    settings = get_settings()
    store.ensure_bootstrap_admin(settings.api_key)

    sms_store = getattr(request.app.state, "sms_auth", None)
    if sms_store is None:
        from app.main import state

        sms_store = getattr(state, "sms_auth", None)

    if sms_store is not None:
        token = request.cookies.get(COOKIE_NAME)
        session = sms_store.validate_session(token)
        if session is not None:
            admin_phone = normalize_admin_phone(settings.admin_phone)
            # totp sessions use subject "admin"; sms sessions use ADMIN_PHONE
            allowed = {"admin"}
            if admin_phone:
                allowed.add(admin_phone)
            if session.phone in allowed:
                admin = _first_admin_user(store)
                if admin is not None:
                    store.touch_seen(admin.id)
                    return AuthContext(
                        user=admin, api_key="", via_sms_session=True
                    )

    if x_api_key:
        auth = require_auth(request, x_api_key)
        return require_admin(auth)

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Admin login required",
    )


def normalize_admin_phone(raw: str) -> str | None:
    from app.sms_auth import normalize_cn_phone

    return normalize_cn_phone(raw or "")


def generate_api_key() -> str:
    return secrets.token_urlsafe(32)
