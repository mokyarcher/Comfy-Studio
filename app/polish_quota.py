from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


def _utc_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _utc_minute() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")


@dataclass
class QuotaSnapshot:
    daily_limit: int
    daily_used: int
    daily_remaining: int
    per_minute_limit: int
    minute_used: int


class PolishQuotaStore:
    """Simple SQLite counters keyed by API key fingerprint (not the raw key)."""

    def __init__(self, db_path: Path) -> None:
        self._path = db_path
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS polish_usage (
                    key_fp TEXT NOT NULL,
                    bucket TEXT NOT NULL,
                    count INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (key_fp, bucket)
                )
                """
            )
            conn.commit()

    def _get_count(self, conn: sqlite3.Connection, key_fp: str, bucket: str) -> int:
        row = conn.execute(
            "SELECT count FROM polish_usage WHERE key_fp=? AND bucket=?",
            (key_fp, bucket),
        ).fetchone()
        return int(row["count"]) if row else 0

    def _incr(self, conn: sqlite3.Connection, key_fp: str, bucket: str) -> int:
        conn.execute(
            """
            INSERT INTO polish_usage(key_fp, bucket, count) VALUES(?,?,1)
            ON CONFLICT(key_fp, bucket) DO UPDATE SET count = count + 1
            """,
            (key_fp, bucket),
        )
        return self._get_count(conn, key_fp, bucket)

    def delete_key(self, key_fp: str) -> int:
        with self._lock, self._connect() as conn:
            cur = conn.execute("DELETE FROM polish_usage WHERE key_fp = ?", (key_fp,))
            conn.commit()
            return int(cur.rowcount or 0)

    def snapshot(self, key_fp: str, daily_limit: int, per_minute_limit: int) -> QuotaSnapshot:
        day = f"d:{_utc_day()}"
        minute = f"m:{_utc_minute()}"
        with self._lock, self._connect() as conn:
            daily_used = self._get_count(conn, key_fp, day)
            minute_used = self._get_count(conn, key_fp, minute)
        remaining = max(0, daily_limit - daily_used) if daily_limit > 0 else 10**9
        return QuotaSnapshot(
            daily_limit=daily_limit,
            daily_used=daily_used,
            daily_remaining=remaining if daily_limit > 0 else -1,
            per_minute_limit=per_minute_limit,
            minute_used=minute_used,
        )

    def check_and_consume(
        self, key_fp: str, daily_limit: int, per_minute_limit: int
    ) -> tuple[bool, str | None, QuotaSnapshot]:
        """Atomically check limits and increment. Returns (ok, error_code, snapshot)."""
        day = f"d:{_utc_day()}"
        minute = f"m:{_utc_minute()}"
        with self._lock, self._connect() as conn:
            daily_used = self._get_count(conn, key_fp, day)
            minute_used = self._get_count(conn, key_fp, minute)
            if daily_limit > 0 and daily_used >= daily_limit:
                snap = QuotaSnapshot(
                    daily_limit=daily_limit,
                    daily_used=daily_used,
                    daily_remaining=0,
                    per_minute_limit=per_minute_limit,
                    minute_used=minute_used,
                )
                return False, "daily_quota_exceeded", snap
            if per_minute_limit > 0 and minute_used >= per_minute_limit:
                snap = QuotaSnapshot(
                    daily_limit=daily_limit,
                    daily_used=daily_used,
                    daily_remaining=max(0, daily_limit - daily_used) if daily_limit > 0 else -1,
                    per_minute_limit=per_minute_limit,
                    minute_used=minute_used,
                )
                return False, "rate_limited", snap
            daily_used = self._incr(conn, key_fp, day)
            minute_used = self._incr(conn, key_fp, minute)
            conn.commit()
            snap = QuotaSnapshot(
                daily_limit=daily_limit,
                daily_used=daily_used,
                daily_remaining=max(0, daily_limit - daily_used) if daily_limit > 0 else -1,
                per_minute_limit=per_minute_limit,
                minute_used=minute_used,
            )
            return True, None, snap
