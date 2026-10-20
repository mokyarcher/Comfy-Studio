from __future__ import annotations

import json
import shutil
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

STATUS_PUBLISHED = "published"
STATUS_UNLISTED = "unlisted"

_ALLOWED_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
THUMB_FILENAME = "thumb.jpg"
THUMB_MAX_EDGE = 512
THUMB_JPEG_QUALITY = 82


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _normalize_suffix(raw: str | None) -> str:
    s = (raw or ".png").strip()
    if not s.startswith("."):
        s = f".{s}"
    s = s.lower()
    return s if s in _ALLOWED_SUFFIXES else ".png"


def make_thumbnail_jpeg(image_bytes: bytes, *, max_edge: int = THUMB_MAX_EDGE) -> bytes:
    """Resize to max_edge on the long side; return JPEG bytes."""
    from io import BytesIO

    from PIL import Image

    with Image.open(BytesIO(image_bytes)) as im:
        im = im.convert("RGB")
        w, h = im.size
        if w <= 0 or h <= 0:
            raise ValueError("invalid image size")
        scale = min(1.0, max_edge / float(max(w, h)))
        if scale < 1.0:
            im = im.resize(
                (max(1, int(w * scale)), max(1, int(h * scale))),
                Image.Resampling.LANCZOS,
            )
        out = BytesIO()
        im.save(out, format="JPEG", quality=THUMB_JPEG_QUALITY, optimize=True)
        return out.getvalue()


@dataclass
class ShowcaseItem:
    id: str
    author_user_id: str
    author_name: str
    author_username: str
    status: str
    prompt: str
    negative_prompt: str
    mode: str
    width: int
    height: int
    steps: int
    seed: int | None
    result_filename: str
    ref_count: int
    created_at: str
    updated_at: str
    elapsed_ms: int | None = None

    def to_public_dict(self, *, mine: bool = False) -> dict[str, Any]:
        return {
            "id": self.id,
            "author_name": self.author_name or self.author_username,
            "author_username": self.author_username,
            "status": self.status,
            "prompt": self.prompt,
            "negative_prompt": self.negative_prompt or None,
            "mode": self.mode,
            "width": self.width,
            "height": self.height,
            "steps": self.steps,
            "seed": self.seed,
            "ref_count": self.ref_count,
            "elapsed_ms": self.elapsed_ms,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "image_url": f"/v1/showcase/{self.id}/image",
            "thumb_url": f"/v1/showcase/{self.id}/thumb",
            "ref_urls": [
                f"/v1/showcase/{self.id}/refs/{i}" for i in range(self.ref_count)
            ],
            "mine": mine,
        }


class ShowcaseStore:
    def __init__(self, db_path: Path, files_dir: Path) -> None:
        self.db_path = db_path
        self.files_dir = files_dir
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
                CREATE TABLE IF NOT EXISTS showcase_items (
                    id TEXT PRIMARY KEY,
                    author_user_id TEXT NOT NULL,
                    author_name TEXT NOT NULL,
                    author_username TEXT NOT NULL,
                    status TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    negative_prompt TEXT NOT NULL DEFAULT '',
                    mode TEXT NOT NULL DEFAULT 'txt2img',
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    steps INTEGER NOT NULL,
                    seed INTEGER,
                    result_filename TEXT NOT NULL,
                    ref_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_showcase_status_created
                    ON showcase_items(status, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_showcase_author
                    ON showcase_items(author_user_id, created_at DESC);
                """
            )
            cols = {
                str(r[1])
                for r in conn.execute("PRAGMA table_info(showcase_items)").fetchall()
            }
            if "elapsed_ms" not in cols:
                conn.execute(
                    "ALTER TABLE showcase_items ADD COLUMN elapsed_ms INTEGER"
                )
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS showcase_likes (
                    item_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (item_id, user_id)
                );
                CREATE INDEX IF NOT EXISTS idx_showcase_likes_user
                    ON showcase_likes(user_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS showcase_favorites (
                    item_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (item_id, user_id)
                );
                CREATE INDEX IF NOT EXISTS idx_showcase_favorites_user
                    ON showcase_favorites(user_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS showcase_comments (
                    id TEXT PRIMARY KEY,
                    item_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    author_name TEXT NOT NULL,
                    body TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_showcase_comments_item
                    ON showcase_comments(item_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_showcase_comments_user
                    ON showcase_comments(user_id);
                """
            )

    def item_dir(self, item_id: str) -> Path:
        return self.files_dir / item_id

    def create(
        self,
        *,
        author_user_id: str,
        author_name: str,
        author_username: str,
        prompt: str,
        negative_prompt: str,
        mode: str,
        width: int,
        height: int,
        steps: int,
        seed: int | None,
        result_bytes: bytes,
        result_suffix: str,
        ref_blobs: list[tuple[bytes, str]],
        elapsed_ms: int | None = None,
    ) -> ShowcaseItem:
        item_id = str(uuid.uuid4())
        now = utcnow()
        result_filename = f"result{_normalize_suffix(result_suffix)}"
        directory = self.item_dir(item_id)
        directory.mkdir(parents=True, exist_ok=False)
        try:
            (directory / result_filename).write_bytes(result_bytes)
            try:
                (directory / THUMB_FILENAME).write_bytes(make_thumbnail_jpeg(result_bytes))
            except Exception:
                # Thumbnail is best-effort; list can regenerate later from result.
                pass
            refs_meta: list[str] = []
            for i, (blob, ref_suffix) in enumerate(ref_blobs):
                name = f"ref_{i}{_normalize_suffix(ref_suffix)}"
                (directory / name).write_bytes(blob)
                refs_meta.append(name)
            (directory / "meta.json").write_text(
                json.dumps({"refs": refs_meta}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            with self._lock, self.connect() as conn:
                conn.execute(
                    """
                    INSERT INTO showcase_items (
                        id, author_user_id, author_name, author_username, status,
                        prompt, negative_prompt, mode, width, height, steps, seed,
                        result_filename, ref_count, created_at, updated_at, elapsed_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item_id,
                        author_user_id,
                        author_name,
                        author_username,
                        STATUS_PUBLISHED,
                        prompt,
                        negative_prompt or "",
                        mode or "txt2img",
                        width,
                        height,
                        steps,
                        seed,
                        result_filename,
                        len(refs_meta),
                        now,
                        now,
                        int(elapsed_ms) if elapsed_ms is not None and elapsed_ms > 0 else None,
                    ),
                )
        except Exception:
            if directory.exists():
                shutil.rmtree(directory, ignore_errors=True)
            raise
        item = self.get(item_id)
        assert item is not None
        return item

    def get(self, item_id: str) -> ShowcaseItem | None:
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM showcase_items WHERE id = ?", (item_id,)
            ).fetchone()
        return self._row(row) if row else None

    def list_published(self, *, limit: int = 50, offset: int = 0) -> list[ShowcaseItem]:
        limit = max(1, min(limit, 100))
        offset = max(0, offset)
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM showcase_items
                WHERE status = ?
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                (STATUS_PUBLISHED, limit, offset),
            ).fetchall()
        return [self._row(r) for r in rows]

    def list_by_author(self, author_user_id: str, *, limit: int = 50) -> list[ShowcaseItem]:
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM showcase_items
                WHERE author_user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (author_user_id, max(1, min(limit, 100))),
            ).fetchall()
        return [self._row(r) for r in rows]

    def unlist(self, item_id: str, author_user_id: str) -> ShowcaseItem | None:
        item = self.get(item_id)
        if item is None:
            return None
        if item.author_user_id != author_user_id:
            raise PermissionError("only author can unlist")
        return self._set_unlisted(item_id)

    def admin_unlist(self, item_id: str) -> ShowcaseItem | None:
        """Force unlist without author check (moderation)."""
        item = self.get(item_id)
        if item is None:
            return None
        return self._set_unlisted(item_id)

    def delete_all_by_author(self, author_user_id: str) -> int:
        deleted = 0
        while True:
            items = self.list_by_author(author_user_id, limit=100)
            if not items:
                break
            for item in items:
                with self._lock, self.connect() as conn:
                    conn.execute("DELETE FROM showcase_likes WHERE item_id = ?", (item.id,))
                    conn.execute(
                        "DELETE FROM showcase_favorites WHERE item_id = ?", (item.id,)
                    )
                    conn.execute(
                        "DELETE FROM showcase_comments WHERE item_id = ?", (item.id,)
                    )
                    conn.execute("DELETE FROM showcase_items WHERE id = ?", (item.id,))
                directory = self.item_dir(item.id)
                if directory.exists():
                    shutil.rmtree(directory, ignore_errors=True)
                deleted += 1
        # Also drop this user's likes / favorites / comments on others' works.
        with self._lock, self.connect() as conn:
            conn.execute("DELETE FROM showcase_likes WHERE user_id = ?", (author_user_id,))
            conn.execute(
                "DELETE FROM showcase_favorites WHERE user_id = ?", (author_user_id,)
            )
            conn.execute(
                "DELETE FROM showcase_comments WHERE user_id = ?", (author_user_id,)
            )
        return deleted

    def engagement_for(self, item_id: str, user_id: str) -> dict[str, Any]:
        with self._lock, self.connect() as conn:
            like_count = int(
                conn.execute(
                    "SELECT COUNT(*) AS c FROM showcase_likes WHERE item_id = ?",
                    (item_id,),
                ).fetchone()["c"]
            )
            fav_count = int(
                conn.execute(
                    "SELECT COUNT(*) AS c FROM showcase_favorites WHERE item_id = ?",
                    (item_id,),
                ).fetchone()["c"]
            )
            comment_count = int(
                conn.execute(
                    "SELECT COUNT(*) AS c FROM showcase_comments WHERE item_id = ?",
                    (item_id,),
                ).fetchone()["c"]
            )
            liked = (
                conn.execute(
                    "SELECT 1 FROM showcase_likes WHERE item_id = ? AND user_id = ?",
                    (item_id, user_id),
                ).fetchone()
                is not None
            )
            favorited = (
                conn.execute(
                    "SELECT 1 FROM showcase_favorites WHERE item_id = ? AND user_id = ?",
                    (item_id, user_id),
                ).fetchone()
                is not None
            )
        return {
            "like_count": like_count,
            "favorite_count": fav_count,
            "comment_count": comment_count,
            "liked_by_me": liked,
            "favorited_by_me": favorited,
        }

    def engagement_batch(
        self, item_ids: list[str], user_id: str
    ) -> dict[str, dict[str, Any]]:
        if not item_ids:
            return {}
        out: dict[str, dict[str, Any]] = {
            i: {
                "like_count": 0,
                "favorite_count": 0,
                "comment_count": 0,
                "liked_by_me": False,
                "favorited_by_me": False,
            }
            for i in item_ids
        }
        placeholders = ",".join("?" * len(item_ids))
        with self._lock, self.connect() as conn:
            for row in conn.execute(
                f"""
                SELECT item_id, COUNT(*) AS c FROM showcase_likes
                WHERE item_id IN ({placeholders}) GROUP BY item_id
                """,
                item_ids,
            ):
                out[row["item_id"]]["like_count"] = int(row["c"])
            for row in conn.execute(
                f"""
                SELECT item_id, COUNT(*) AS c FROM showcase_favorites
                WHERE item_id IN ({placeholders}) GROUP BY item_id
                """,
                item_ids,
            ):
                out[row["item_id"]]["favorite_count"] = int(row["c"])
            for row in conn.execute(
                f"""
                SELECT item_id, COUNT(*) AS c FROM showcase_comments
                WHERE item_id IN ({placeholders}) GROUP BY item_id
                """,
                item_ids,
            ):
                out[row["item_id"]]["comment_count"] = int(row["c"])
            for row in conn.execute(
                f"""
                SELECT item_id FROM showcase_likes
                WHERE user_id = ? AND item_id IN ({placeholders})
                """,
                [user_id, *item_ids],
            ):
                out[row["item_id"]]["liked_by_me"] = True
            for row in conn.execute(
                f"""
                SELECT item_id FROM showcase_favorites
                WHERE user_id = ? AND item_id IN ({placeholders})
                """,
                [user_id, *item_ids],
            ):
                out[row["item_id"]]["favorited_by_me"] = True
        return out

    def toggle_like(self, item_id: str, user_id: str) -> dict[str, Any]:
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM showcase_likes WHERE item_id = ? AND user_id = ?",
                (item_id, user_id),
            ).fetchone()
            if row:
                conn.execute(
                    "DELETE FROM showcase_likes WHERE item_id = ? AND user_id = ?",
                    (item_id, user_id),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO showcase_likes (item_id, user_id, created_at)
                    VALUES (?, ?, ?)
                    """,
                    (item_id, user_id, utcnow()),
                )
        return self.engagement_for(item_id, user_id)

    def toggle_favorite(self, item_id: str, user_id: str) -> dict[str, Any]:
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM showcase_favorites WHERE item_id = ? AND user_id = ?",
                (item_id, user_id),
            ).fetchone()
            if row:
                conn.execute(
                    "DELETE FROM showcase_favorites WHERE item_id = ? AND user_id = ?",
                    (item_id, user_id),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO showcase_favorites (item_id, user_id, created_at)
                    VALUES (?, ?, ?)
                    """,
                    (item_id, user_id, utcnow()),
                )
        return self.engagement_for(item_id, user_id)

    def list_comments(self, item_id: str, *, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 200))
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                """
                SELECT id, item_id, user_id, author_name, body, created_at
                FROM showcase_comments
                WHERE item_id = ?
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (item_id, limit),
            ).fetchall()
        return [
            {
                "id": r["id"],
                "item_id": r["item_id"],
                "user_id": r["user_id"],
                "author_name": r["author_name"],
                "body": r["body"],
                "created_at": r["created_at"],
            }
            for r in rows
        ]

    def add_comment(
        self,
        *,
        item_id: str,
        user_id: str,
        author_name: str,
        body: str,
    ) -> dict[str, Any]:
        text = (body or "").strip()
        if not text:
            raise ValueError("评论不能为空")
        if len(text) > 500:
            raise ValueError("评论最多 500 字")
        comment_id = str(uuid.uuid4())
        now = utcnow()
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                INSERT INTO showcase_comments (
                    id, item_id, user_id, author_name, body, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    comment_id,
                    item_id,
                    user_id,
                    (author_name or "用户").strip()[:64],
                    text,
                    now,
                ),
            )
        return {
            "id": comment_id,
            "item_id": item_id,
            "user_id": user_id,
            "author_name": (author_name or "用户").strip()[:64],
            "body": text,
            "created_at": now,
        }

    def delete_comment(
        self, comment_id: str, *, user_id: str, is_admin: bool = False
    ) -> bool:
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT user_id FROM showcase_comments WHERE id = ?",
                (comment_id,),
            ).fetchone()
            if row is None:
                return False
            if not is_admin and row["user_id"] != user_id:
                raise PermissionError("只能删除自己的评论")
            cur = conn.execute(
                "DELETE FROM showcase_comments WHERE id = ?", (comment_id,)
            )
            return cur.rowcount > 0

    def _set_unlisted(self, item_id: str) -> ShowcaseItem | None:
        item = self.get(item_id)
        if item is None:
            return None
        if item.status == STATUS_UNLISTED:
            return item
        now = utcnow()
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                UPDATE showcase_items
                SET status = ?, updated_at = ?
                WHERE id = ?
                """,
                (STATUS_UNLISTED, now, item_id),
            )
        return self.get(item_id)

    def resolve_result_path(self, item: ShowcaseItem) -> Path | None:
        base = self.item_dir(item.id).resolve()
        path = (base / item.result_filename).resolve()
        try:
            path.relative_to(base)
        except ValueError:
            return None
        return path if path.is_file() else None

    def resolve_thumb_path(self, item: ShowcaseItem) -> Path | None:
        """Return thumb.jpg path, generating it from the result if missing."""
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

    def resolve_ref_path(self, item: ShowcaseItem, index: int) -> Path | None:
        if index < 0 or index >= item.ref_count:
            return None
        directory = self.item_dir(item.id)
        base = directory.resolve()
        meta_path = directory / "meta.json"
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                names = meta.get("refs") or []
                if 0 <= index < len(names):
                    path = (directory / str(names[index])).resolve()
                    path.relative_to(base)
                    return path if path.is_file() else None
            except Exception:
                pass
        for candidate in directory.glob(f"ref_{index}.*"):
            if candidate.is_file():
                return candidate.resolve()
        return None

    @staticmethod
    def _row(row: sqlite3.Row) -> ShowcaseItem:
        keys = set(row.keys())
        raw_elapsed = row["elapsed_ms"] if "elapsed_ms" in keys else None
        elapsed_ms = int(raw_elapsed) if raw_elapsed is not None else None
        return ShowcaseItem(
            id=row["id"],
            author_user_id=row["author_user_id"],
            author_name=row["author_name"],
            author_username=row["author_username"],
            status=row["status"],
            prompt=row["prompt"],
            negative_prompt=row["negative_prompt"] or "",
            mode=row["mode"] or "txt2img",
            width=int(row["width"]),
            height=int(row["height"]),
            steps=int(row["steps"]),
            seed=row["seed"],
            result_filename=row["result_filename"],
            ref_count=int(row["ref_count"] or 0),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            elapsed_ms=elapsed_ms,
        )
