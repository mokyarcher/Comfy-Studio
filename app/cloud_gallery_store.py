"""Private per-user cloud gallery on the Gateway host (not public showcase)."""

from __future__ import annotations

import shutil
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from app.showcase_store import THUMB_FILENAME, make_thumbnail_jpeg

_ALLOWED_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm"}


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _normalize_suffix(raw: str | None, *, mime: str | None = None) -> str:
    s = (raw or "").strip()
    if not s and mime:
        if "mp4" in mime:
            s = ".mp4"
        elif "webm" in mime:
            s = ".webm"
        elif "jpeg" in mime or "jpg" in mime:
            s = ".jpg"
        elif "webp" in mime:
            s = ".webp"
        else:
            s = ".png"
    if not s.startswith("."):
        s = f".{s}"
    s = s.lower()
    return s if s in _ALLOWED_SUFFIXES else ".png"


@dataclass
class CloudGalleryItem:
    id: str
    owner_user_id: str
    prompt: str
    negative_prompt: str
    mode: str
    width: int
    height: int
    steps: int
    seed: int | None
    result_filename: str
    mime_type: str
    created_at: str
    updated_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "prompt": self.prompt,
            "negative_prompt": self.negative_prompt or None,
            "mode": self.mode,
            "width": self.width,
            "height": self.height,
            "steps": self.steps,
            "seed": self.seed,
            "mime_type": self.mime_type,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "image_url": f"/v1/cloud-gallery/{self.id}/image",
            "thumb_url": f"/v1/cloud-gallery/{self.id}/thumb",
        }


class CloudGalleryStore:
    def __init__(self, db_path: Path, files_dir: Path) -> None:
        self.db_path = Path(db_path)
        self.files_dir = Path(files_dir)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.files_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_schema()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._lock, self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS cloud_gallery_items (
                    id TEXT PRIMARY KEY,
                    owner_user_id TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    negative_prompt TEXT NOT NULL DEFAULT '',
                    mode TEXT NOT NULL DEFAULT 'txt2img',
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    steps INTEGER NOT NULL,
                    seed INTEGER,
                    result_filename TEXT NOT NULL,
                    mime_type TEXT NOT NULL DEFAULT 'image/png',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_cloud_gallery_owner
                    ON cloud_gallery_items(owner_user_id, created_at DESC);
                """
            )

    def item_dir(self, item_id: str) -> Path:
        return self.files_dir / item_id

    def create(
        self,
        *,
        owner_user_id: str,
        prompt: str,
        negative_prompt: str,
        mode: str,
        width: int,
        height: int,
        steps: int,
        seed: int | None,
        result_bytes: bytes,
        result_suffix: str,
        mime_type: str,
    ) -> CloudGalleryItem:
        item_id = str(uuid.uuid4())
        now = utcnow()
        suffix = _normalize_suffix(result_suffix, mime=mime_type)
        result_filename = f"result{suffix}"
        directory = self.item_dir(item_id)
        directory.mkdir(parents=True, exist_ok=False)
        try:
            (directory / result_filename).write_bytes(result_bytes)
            if not mime_type.startswith("video/"):
                try:
                    (directory / THUMB_FILENAME).write_bytes(make_thumbnail_jpeg(result_bytes))
                except Exception:
                    pass
            with self._lock, self.connect() as conn:
                conn.execute(
                    """
                    INSERT INTO cloud_gallery_items (
                        id, owner_user_id, prompt, negative_prompt, mode,
                        width, height, steps, seed, result_filename, mime_type,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item_id,
                        owner_user_id,
                        prompt,
                        negative_prompt or "",
                        mode or "txt2img",
                        width,
                        height,
                        steps,
                        seed,
                        result_filename,
                        mime_type or "image/png",
                        now,
                        now,
                    ),
                )
        except Exception:
            if directory.exists():
                shutil.rmtree(directory, ignore_errors=True)
            raise
        item = self.get(item_id)
        assert item is not None
        return item

    def get(self, item_id: str) -> CloudGalleryItem | None:
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM cloud_gallery_items WHERE id = ?", (item_id,)
            ).fetchone()
        return self._row(row) if row else None

    def list_by_owner(self, owner_user_id: str, *, limit: int = 100) -> list[CloudGalleryItem]:
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM cloud_gallery_items
                WHERE owner_user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (owner_user_id, max(1, min(limit, 200))),
            ).fetchall()
        return [self._row(r) for r in rows]

    def delete(self, item_id: str, owner_user_id: str) -> bool:
        item = self.get(item_id)
        if item is None:
            return False
        if item.owner_user_id != owner_user_id:
            raise PermissionError("only owner can delete")
        with self._lock, self.connect() as conn:
            conn.execute("DELETE FROM cloud_gallery_items WHERE id = ?", (item_id,))
        directory = self.item_dir(item_id)
        if directory.exists():
            shutil.rmtree(directory, ignore_errors=True)
        return True

    def resolve_result_path(self, item: CloudGalleryItem) -> Path | None:
        base = self.item_dir(item.id).resolve()
        path = (base / item.result_filename).resolve()
        try:
            path.relative_to(base)
        except ValueError:
            return None
        return path if path.is_file() else None

    def resolve_thumb_path(self, item: CloudGalleryItem) -> Path | None:
        if item.mime_type.startswith("video/"):
            return None
        directory = self.item_dir(item.id)
        base = directory.resolve()
        thumb = (directory / THUMB_FILENAME).resolve()
        try:
            thumb.relative_to(base)
        except ValueError:
            return None
        if thumb.is_file():
            return thumb
        result = self.resolve_result_path(item)
        if result is None:
            return None
        try:
            thumb.write_bytes(make_thumbnail_jpeg(result.read_bytes()))
        except Exception:
            return None
        return thumb if thumb.is_file() else None

    @staticmethod
    def _row(row: sqlite3.Row) -> CloudGalleryItem:
        return CloudGalleryItem(
            id=row["id"],
            owner_user_id=row["owner_user_id"],
            prompt=row["prompt"],
            negative_prompt=row["negative_prompt"] or "",
            mode=row["mode"] or "txt2img",
            width=int(row["width"]),
            height=int(row["height"]),
            steps=int(row["steps"]),
            seed=row["seed"],
            result_filename=row["result_filename"],
            mime_type=row["mime_type"] or "image/png",
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
