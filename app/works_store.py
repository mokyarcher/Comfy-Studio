"""Unified per-user work records (metadata; media may live in cloud_gallery)."""

from __future__ import annotations

import sqlite3
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class WorkRecord:
    id: str
    owner_user_id: str
    prompt: str
    negative_prompt: str
    mode: str
    width: int
    height: int
    steps: int
    seed: int | None
    remote_task_id: str | None
    cloud_gallery_id: str | None
    mime_type: str | None
    created_at: str

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
            "remote_task_id": self.remote_task_id,
            "cloud_gallery_id": self.cloud_gallery_id,
            "mime_type": self.mime_type,
            "created_at": self.created_at,
            "image_url": (
                f"/v1/cloud-gallery/{self.cloud_gallery_id}/image"
                if self.cloud_gallery_id
                else None
            ),
            "thumb_url": (
                f"/v1/cloud-gallery/{self.cloud_gallery_id}/thumb"
                if self.cloud_gallery_id
                else None
            ),
        }


class WorksStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS works (
                    id TEXT PRIMARY KEY,
                    owner_user_id TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    negative_prompt TEXT NOT NULL DEFAULT '',
                    mode TEXT NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    steps INTEGER NOT NULL,
                    seed INTEGER,
                    remote_task_id TEXT,
                    cloud_gallery_id TEXT,
                    mime_type TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_works_owner_created "
                "ON works(owner_user_id, created_at DESC)"
            )
            conn.commit()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def create(
        self,
        *,
        owner_user_id: str,
        prompt: str,
        negative_prompt: str = "",
        mode: str = "txt2img",
        width: int = 0,
        height: int = 0,
        steps: int = 0,
        seed: int | None = None,
        remote_task_id: str | None = None,
        cloud_gallery_id: str | None = None,
        mime_type: str | None = None,
    ) -> WorkRecord:
        item = WorkRecord(
            id=str(uuid.uuid4()),
            owner_user_id=owner_user_id,
            prompt=prompt,
            negative_prompt=negative_prompt or "",
            mode=mode,
            width=width,
            height=height,
            steps=steps,
            seed=seed,
            remote_task_id=remote_task_id,
            cloud_gallery_id=cloud_gallery_id,
            mime_type=mime_type,
            created_at=utcnow(),
        )
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                INSERT INTO works (
                    id, owner_user_id, prompt, negative_prompt, mode,
                    width, height, steps, seed, remote_task_id,
                    cloud_gallery_id, mime_type, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item.id,
                    item.owner_user_id,
                    item.prompt,
                    item.negative_prompt,
                    item.mode,
                    item.width,
                    item.height,
                    item.steps,
                    item.seed,
                    item.remote_task_id,
                    item.cloud_gallery_id,
                    item.mime_type,
                    item.created_at,
                ),
            )
            conn.commit()
        return item

    def list_by_owner(self, owner_user_id: str, *, limit: int = 100) -> list[WorkRecord]:
        limit = max(1, min(int(limit), 500))
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM works
                WHERE owner_user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (owner_user_id, limit),
            ).fetchall()
        return [self._row(r) for r in rows]

    def get(self, work_id: str) -> WorkRecord | None:
        with self._lock, self.connect() as conn:
            row = conn.execute("SELECT * FROM works WHERE id = ?", (work_id,)).fetchone()
        return self._row(row) if row else None

    def link_gallery(self, work_id: str, owner_user_id: str, gallery_id: str) -> bool:
        with self._lock, self.connect() as conn:
            cur = conn.execute(
                """
                UPDATE works SET cloud_gallery_id = ?
                WHERE id = ? AND owner_user_id = ?
                """,
                (gallery_id, work_id, owner_user_id),
            )
            conn.commit()
            return cur.rowcount > 0

    def delete(self, work_id: str, owner_user_id: str) -> bool:
        with self._lock, self.connect() as conn:
            cur = conn.execute(
                "DELETE FROM works WHERE id = ? AND owner_user_id = ?",
                (work_id, owner_user_id),
            )
            conn.commit()
            return cur.rowcount > 0

    def delete_by_owner(self, owner_user_id: str) -> int:
        with self._lock, self.connect() as conn:
            cur = conn.execute(
                "DELETE FROM works WHERE owner_user_id = ?",
                (owner_user_id,),
            )
            conn.commit()
            return int(cur.rowcount)

    @staticmethod
    def _row(row: sqlite3.Row) -> WorkRecord:
        return WorkRecord(
            id=row["id"],
            owner_user_id=row["owner_user_id"],
            prompt=row["prompt"],
            negative_prompt=row["negative_prompt"] or "",
            mode=row["mode"],
            width=int(row["width"]),
            height=int(row["height"]),
            steps=int(row["steps"]),
            seed=row["seed"],
            remote_task_id=row["remote_task_id"],
            cloud_gallery_id=row["cloud_gallery_id"],
            mime_type=row["mime_type"],
            created_at=row["created_at"],
        )
