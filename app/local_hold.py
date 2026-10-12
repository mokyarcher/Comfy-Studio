"""In-memory local GPU hold: admin reserves ComfyUI for desktop use."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class LocalHoldSnapshot:
    held: bool
    message: str
    expires_at: datetime | None
    set_by: str | None
    updated_at: datetime | None

    def to_public_dict(self) -> dict:
        return {
            "held": self.held,
            "message": self.message,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class LocalHoldStore:
    DEFAULT_MESSAGE = "本机占用中，服务端正在本地使用 ComfyUI，请稍后再试"

    def __init__(self) -> None:
        self._lock = Lock()
        self._held = False
        self._message = ""
        self._expires_at: datetime | None = None
        self._set_by: str | None = None
        self._updated_at: datetime | None = None

    def clear(self) -> None:
        """Reset to idle (used on API process start / tests)."""
        with self._lock:
            self._held = False
            self._message = ""
            self._expires_at = None
            self._set_by = None
            self._updated_at = None

    def _expire_locked(self) -> None:
        if self._held and self._expires_at is not None and _utcnow() >= self._expires_at:
            self._held = False
            self._message = ""
            self._expires_at = None
            self._set_by = None
            self._updated_at = _utcnow()

    def is_held(self) -> bool:
        with self._lock:
            self._expire_locked()
            return self._held

    def snapshot(self) -> LocalHoldSnapshot:
        with self._lock:
            self._expire_locked()
            return LocalHoldSnapshot(
                held=self._held,
                message=self._message if self._held else "",
                expires_at=self._expires_at if self._held else None,
                set_by=self._set_by if self._held else None,
                updated_at=self._updated_at,
            )

    def set(
        self,
        *,
        held: bool,
        ttl_seconds: int | None = None,
        message: str | None = None,
        set_by: str | None = None,
    ) -> LocalHoldSnapshot:
        with self._lock:
            now = _utcnow()
            if not held:
                self._held = False
                self._message = ""
                self._expires_at = None
                self._set_by = set_by
                self._updated_at = now
            else:
                text = (message or "").strip() or self.DEFAULT_MESSAGE
                self._held = True
                self._message = text
                self._expires_at = (
                    now + timedelta(seconds=int(ttl_seconds)) if ttl_seconds and ttl_seconds > 0 else None
                )
                self._set_by = set_by
                self._updated_at = now
            return LocalHoldSnapshot(
                held=self._held,
                message=self._message if self._held else "",
                expires_at=self._expires_at if self._held else None,
                set_by=self._set_by,
                updated_at=self._updated_at,
            )

    def reject_detail(self) -> dict:
        snap = self.snapshot()
        return {
            "code": "local_hold",
            "message": snap.message or self.DEFAULT_MESSAGE,
            "expires_at": snap.expires_at.isoformat() if snap.expires_at else None,
        }


local_hold = LocalHoldStore()
