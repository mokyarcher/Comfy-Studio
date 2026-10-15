"""Player-shared prompt templates (separate from official prompt library)."""

from __future__ import annotations

import json
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
class SharedPromptItem:
    id: str
    title: str
    prompt: str
    negative_prompt: str
    tags: list[str]
    author_user_id: str
    author_name: str
    author_username: str
    created_at: str

    def to_public_dict(self, *, viewer_user_id: str | None = None) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "prompt": self.prompt,
            "negative_prompt": self.negative_prompt or None,
            "tags": list(self.tags),
            "author_name": self.author_name or self.author_username,
            "author_username": self.author_username,
            "created_at": self.created_at,
            "mine": bool(viewer_user_id and viewer_user_id == self.author_user_id),
        }


class SharedPromptStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
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
                CREATE TABLE IF NOT EXISTS shared_prompts (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    negative_prompt TEXT NOT NULL DEFAULT '',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    author_user_id TEXT NOT NULL,
                    author_name TEXT NOT NULL,
                    author_username TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_shared_prompts_created
                    ON shared_prompts(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_shared_prompts_author
                    ON shared_prompts(author_user_id, created_at DESC);
                """
            )

    def create(
        self,
        *,
        title: str,
        prompt: str,
        negative_prompt: str,
        tags: list[str],
        author_user_id: str,
        author_name: str,
        author_username: str,
    ) -> SharedPromptItem:
        item_id = str(uuid.uuid4())
        now = utcnow()
        clean_tags = [t.strip() for t in tags if t and str(t).strip()]
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                INSERT INTO shared_prompts (
                    id, title, prompt, negative_prompt, tags_json,
                    author_user_id, author_name, author_username, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item_id,
                    title,
                    prompt,
                    negative_prompt or "",
                    json.dumps(clean_tags, ensure_ascii=False),
                    author_user_id,
                    author_name,
                    author_username,
                    now,
                ),
            )
        item = self.get(item_id)
        assert item is not None
        return item

    def get(self, item_id: str) -> SharedPromptItem | None:
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM shared_prompts WHERE id = ?", (item_id,)
            ).fetchone()
        return self._row(row) if row else None

    def list_all(self, *, limit: int = 100, offset: int = 0) -> list[SharedPromptItem]:
        limit = max(1, min(limit, 200))
        offset = max(0, offset)
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM shared_prompts
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ).fetchall()
        return [self._row(r) for r in rows]

    def delete(self, item_id: str) -> bool:
        with self._lock, self.connect() as conn:
            cur = conn.execute("DELETE FROM shared_prompts WHERE id = ?", (item_id,))
            return cur.rowcount > 0

    def delete_all_by_author(self, author_user_id: str) -> int:
        with self._lock, self.connect() as conn:
            cur = conn.execute(
                "DELETE FROM shared_prompts WHERE author_user_id = ?",
                (author_user_id,),
            )
            return int(cur.rowcount or 0)

    @staticmethod
    def _row(row: sqlite3.Row) -> SharedPromptItem:
        try:
            tags = json.loads(row["tags_json"] or "[]")
        except json.JSONDecodeError:
            tags = []
        if not isinstance(tags, list):
            tags = []
        return SharedPromptItem(
            id=row["id"],
            title=row["title"],
            prompt=row["prompt"],
            negative_prompt=row["negative_prompt"] or "",
            tags=[str(t) for t in tags],
            author_user_id=row["author_user_id"],
            author_name=row["author_name"],
            author_username=row["author_username"],
            created_at=row["created_at"],
        )
