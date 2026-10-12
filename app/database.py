from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class TaskRecord:
    task_id: str
    status: str
    request_json: str
    comfy_prompt_id: str | None
    seed: int | None
    error_code: str | None
    error_message: str | None
    created_at: str
    started_at: str | None
    finished_at: str | None

    @property
    def request(self) -> dict[str, Any]:
        return json.loads(self.request_json)


@dataclass
class TaskImageRecord:
    id: int
    task_id: str
    image_index: int
    filename: str
    relative_path: str
    content_type: str
    created_at: str


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_schema()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, check_same_thread=False)
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
                CREATE TABLE IF NOT EXISTS tasks (
                    task_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    request_json TEXT NOT NULL,
                    comfy_prompt_id TEXT,
                    seed INTEGER,
                    error_code TEXT,
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT
                );

                CREATE TABLE IF NOT EXISTS task_images (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    image_index INTEGER NOT NULL,
                    filename TEXT NOT NULL,
                    relative_path TEXT NOT NULL,
                    content_type TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(task_id, image_index),
                    FOREIGN KEY(task_id) REFERENCES tasks(task_id)
                );

                CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
                CREATE INDEX IF NOT EXISTS idx_task_images_task_id ON task_images(task_id);
                """
            )

    def create_task(
        self,
        task_id: str,
        request: dict[str, Any],
        seed: int,
        status: str = "queued",
    ) -> TaskRecord:
        now = utcnow()
        payload = json.dumps(request, ensure_ascii=False)
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                INSERT INTO tasks (
                    task_id, status, request_json, comfy_prompt_id, seed,
                    error_code, error_message, created_at, started_at, finished_at
                ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, NULL, NULL)
                """,
                (task_id, status, payload, seed, now),
            )
        return self.get_task(task_id)  # type: ignore[return-value]

    def get_task(self, task_id: str) -> TaskRecord | None:
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM tasks WHERE task_id = ?",
                (task_id,),
            ).fetchone()
        return self._row_to_task(row) if row else None

    def count_open_tasks(self) -> int:
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS c FROM tasks WHERE status IN ('queued', 'running')"
            ).fetchone()
        return int(row["c"]) if row else 0

    def count_running_tasks(self) -> int:
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS c FROM tasks WHERE status = 'running'"
            ).fetchone()
        return int(row["c"]) if row else 0

    def queue_info(self, task_id: str) -> dict[str, int]:
        """FIFO position among open tasks. position 1 = currently running or next up."""
        running = self.list_tasks_by_status("running")
        queued = self.list_tasks_by_status("queued")  # already created_at ASC
        ordered = running + queued
        position = 0
        for i, t in enumerate(ordered, start=1):
            if t.task_id == task_id:
                position = i
                break
        ahead = max(0, position - 1) if position else len(ordered)
        return {
            "queue_position": position,
            "queue_ahead": ahead,
            "queue_size": len(ordered),
        }

    def list_tasks_by_status(self, *statuses: str) -> list[TaskRecord]:
        if not statuses:
            return []
        placeholders = ",".join("?" for _ in statuses)
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM tasks WHERE status IN ({placeholders}) ORDER BY created_at ASC",
                statuses,
            ).fetchall()
        return [self._row_to_task(row) for row in rows]

    def mark_running(self, task_id: str, comfy_prompt_id: str | None = None) -> None:
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                UPDATE tasks
                SET status = 'running',
                    started_at = COALESCE(started_at, ?),
                    comfy_prompt_id = COALESCE(?, comfy_prompt_id)
                WHERE task_id = ?
                """,
                (utcnow(), comfy_prompt_id, task_id),
            )

    def set_prompt_id(self, task_id: str, comfy_prompt_id: str) -> None:
        with self._lock, self.connect() as conn:
            conn.execute(
                "UPDATE tasks SET comfy_prompt_id = ? WHERE task_id = ?",
                (comfy_prompt_id, task_id),
            )

    def mark_succeeded(self, task_id: str) -> None:
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                UPDATE tasks
                SET status = 'succeeded', finished_at = ?
                WHERE task_id = ?
                """,
                (utcnow(), task_id),
            )

    def mark_failed(self, task_id: str, error_code: str, error_message: str) -> None:
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                UPDATE tasks
                SET status = 'failed',
                    error_code = ?,
                    error_message = ?,
                    finished_at = ?
                WHERE task_id = ?
                """,
                (error_code, error_message, utcnow(), task_id),
            )

    def update_request(self, task_id: str, request: dict[str, Any]) -> None:
        payload = json.dumps(request, ensure_ascii=False)
        with self._lock, self.connect() as conn:
            conn.execute(
                "UPDATE tasks SET request_json = ? WHERE task_id = ?",
                (payload, task_id),
            )

    def mark_purged(self, task_id: str, scrubbed_request: dict[str, Any]) -> None:
        payload = json.dumps(scrubbed_request, ensure_ascii=False)
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                UPDATE tasks
                SET status = 'purged',
                    request_json = ?,
                    error_code = NULL,
                    error_message = NULL,
                    finished_at = COALESCE(finished_at, ?)
                WHERE task_id = ?
                """,
                (payload, utcnow(), task_id),
            )

    def delete_task_images(self, task_id: str) -> None:
        with self._lock, self.connect() as conn:
            conn.execute("DELETE FROM task_images WHERE task_id = ?", (task_id,))

    def list_stale_succeeded_tasks(self, older_than_iso: str) -> list[TaskRecord]:
        """Succeeded tasks finished before cutoff (candidates for orphan purge)."""
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM tasks
                WHERE status = 'succeeded'
                  AND finished_at IS NOT NULL
                  AND finished_at < ?
                ORDER BY finished_at ASC
                """,
                (older_than_iso,),
            ).fetchall()
        return [self._row_to_task(row) for row in rows]

    def add_image(
        self,
        task_id: str,
        image_index: int,
        filename: str,
        relative_path: str,
        content_type: str,
    ) -> TaskImageRecord:
        now = utcnow()
        with self._lock, self.connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO task_images (
                    task_id, image_index, filename, relative_path, content_type, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (task_id, image_index, filename, relative_path, content_type, now),
            )
            image_id = int(cur.lastrowid)
        return TaskImageRecord(
            id=image_id,
            task_id=task_id,
            image_index=image_index,
            filename=filename,
            relative_path=relative_path,
            content_type=content_type,
            created_at=now,
        )

    def list_images(self, task_id: str) -> list[TaskImageRecord]:
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM task_images
                WHERE task_id = ?
                ORDER BY image_index ASC
                """,
                (task_id,),
            ).fetchall()
        return [self._row_to_image(row) for row in rows]

    def get_image(self, task_id: str, image_index: int) -> TaskImageRecord | None:
        with self._lock, self.connect() as conn:
            row = conn.execute(
                """
                SELECT * FROM task_images
                WHERE task_id = ? AND image_index = ?
                """,
                (task_id, image_index),
            ).fetchone()
        return self._row_to_image(row) if row else None

    @staticmethod
    def _row_to_task(row: sqlite3.Row) -> TaskRecord:
        return TaskRecord(
            task_id=row["task_id"],
            status=row["status"],
            request_json=row["request_json"],
            comfy_prompt_id=row["comfy_prompt_id"],
            seed=row["seed"],
            error_code=row["error_code"],
            error_message=row["error_message"],
            created_at=row["created_at"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
        )

    @staticmethod
    def _row_to_image(row: sqlite3.Row) -> TaskImageRecord:
        return TaskImageRecord(
            id=row["id"],
            task_id=row["task_id"],
            image_index=row["image_index"],
            filename=row["filename"],
            relative_path=row["relative_path"],
            content_type=row["content_type"],
            created_at=row["created_at"],
        )
