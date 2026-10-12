"""Persistent cache for display-only prompt translations (shared across users)."""

from __future__ import annotations

import hashlib
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def text_hash(text: str, direction: str = "en2zh") -> str:
    """SHA-256 of normalized text; en2zh keeps legacy key (text only)."""
    normalized = text.strip()
    payload = normalized if direction == "en2zh" else f"{direction}\n{normalized}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class TranslateCacheStore:
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
                CREATE TABLE IF NOT EXISTS translate_cache (
                    text_hash TEXT PRIMARY KEY,
                    source_text TEXT NOT NULL,
                    translation TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    hit_count INTEGER NOT NULL DEFAULT 0
                );
                """
            )

    def get(self, text: str, direction: str = "en2zh") -> str | None:
        key = text_hash(text, direction)
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT translation FROM translate_cache WHERE text_hash = ?",
                (key,),
            ).fetchone()
            if row is None:
                return None
            conn.execute(
                """
                UPDATE translate_cache
                SET hit_count = hit_count + 1
                WHERE text_hash = ?
                """,
                (key,),
            )
            return str(row["translation"])

    def put(self, text: str, translation: str, direction: str = "en2zh") -> None:
        key = text_hash(text, direction)
        source = text.strip()
        out = translation.strip()
        if not source or not out:
            return
        now = utcnow()
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                INSERT INTO translate_cache (text_hash, source_text, translation, created_at, hit_count)
                VALUES (?, ?, ?, ?, 0)
                ON CONFLICT(text_hash) DO UPDATE SET
                    translation = excluded.translation,
                    source_text = excluded.source_text
                """,
                (key, source, out, now),
            )
