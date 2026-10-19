from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

STATUS_PENDING = "pending"
STATUS_ACTIVE = "active"
STATUS_REJECTED = "rejected"
STATUS_DISABLED = "disabled"

PBKDF2_ROUNDS = 200_000


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def new_api_key() -> str:
    return secrets.token_urlsafe(32)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ROUNDS
    )
    return f"pbkdf2${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt, hexdigest = stored.split("$", 2)
        if algo != "pbkdf2":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ROUNDS
        )
        return secrets.compare_digest(dk.hex(), hexdigest)
    except Exception:
        return False


def normalize_email(raw: str) -> str | None:
    s = (raw or "").strip().lower()
    if not s or len(s) > 254 or " " in s or s.count("@") != 1:
        return None
    local, _, domain = s.partition("@")
    if not local or not domain or "." not in domain:
        return None
    if domain.startswith(".") or domain.endswith("."):
        return None
    return s


@dataclass
class ApiUser:
    id: str
    name: str
    username: str
    password_hash: str
    status: str
    api_key_hash: str
    api_key_prefix: str
    api_key_secret: str
    enabled: bool
    is_admin: bool
    daily_generate_limit: int
    daily_polish_limit: int
    note: str
    created_at: str
    last_seen_at: str | None
    email: str = ""


@dataclass
class UsageCounts:
    generate_today: int
    polish_today: int


class UserStore:
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
            # Base tables only — do NOT index new columns here (old DBs lack them until ALTER).
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS api_users (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    api_key_hash TEXT NOT NULL UNIQUE,
                    api_key_prefix TEXT NOT NULL DEFAULT '',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    is_admin INTEGER NOT NULL DEFAULT 0,
                    daily_generate_limit INTEGER NOT NULL DEFAULT 50,
                    daily_polish_limit INTEGER NOT NULL DEFAULT 200,
                    note TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    last_seen_at TEXT
                );

                CREATE TABLE IF NOT EXISTS usage_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    meta_json TEXT NOT NULL DEFAULT '{}'
                );

                CREATE INDEX IF NOT EXISTS idx_users_hash ON api_users(api_key_hash);
                CREATE INDEX IF NOT EXISTS idx_usage_user_kind_day
                    ON usage_events(user_id, kind, created_at);
                """
            )
            cols = {
                r[1]
                for r in conn.execute("PRAGMA table_info(api_users)").fetchall()
            }
            migrations = [
                ("username", "TEXT NOT NULL DEFAULT ''"),
                ("password_hash", "TEXT NOT NULL DEFAULT ''"),
                ("status", "TEXT NOT NULL DEFAULT 'active'"),
                ("api_key_secret", "TEXT NOT NULL DEFAULT ''"),
                ("email", "TEXT NOT NULL DEFAULT ''"),
            ]
            for name, decl in migrations:
                if name not in cols:
                    conn.execute(f"ALTER TABLE api_users ADD COLUMN {name} {decl}")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_users_username ON api_users(username)"
            )
            conn.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
                ON api_users(lower(email)) WHERE email != ''
                """
            )

    def ensure_bootstrap_admin(self, legacy_api_key: str) -> ApiUser | None:
        """If no users exist, create admin from legacy .env API_KEY."""
        if not legacy_api_key or legacy_api_key == "change-me-to-a-long-random-string":
            return None
        with self._lock, self.connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS c FROM api_users").fetchone()
            if int(row["c"]) > 0:
                return None
        user, _plain = self.create_admin_with_key(
            name="管理员（bootstrap）",
            username="admin",
            api_key=legacy_api_key,
            daily_generate_limit=9999,
            daily_polish_limit=9999,
            note="由 .env API_KEY 自动导入",
        )
        return user

    def create_admin_with_key(
        self,
        *,
        name: str,
        username: str,
        api_key: str,
        daily_generate_limit: int = 9999,
        daily_polish_limit: int = 9999,
        note: str = "",
        password: str | None = None,
    ) -> tuple[ApiUser, str]:
        plain = api_key
        user_id = uuid.uuid4().hex[:12]
        now = utcnow()
        pw = hash_password(password) if password else ""
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                INSERT INTO api_users (
                    id, name, username, password_hash, status,
                    api_key_hash, api_key_prefix, api_key_secret,
                    enabled, is_admin, daily_generate_limit, daily_polish_limit,
                    note, created_at, last_seen_at, email
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, NULL, '')
                """,
                (
                    user_id,
                    name.strip() or "管理员",
                    username.strip().lower(),
                    pw,
                    STATUS_ACTIVE,
                    hash_api_key(plain),
                    plain[:4],
                    plain,
                    daily_generate_limit,
                    daily_polish_limit,
                    note or "",
                    now,
                ),
            )
        user = self.get_user(user_id)
        assert user is not None
        return user, plain

    def register_user(
        self,
        username: str,
        password: str,
        *,
        display_name: str = "",
        email: str = "",
    ) -> ApiUser:
        uname = username.strip().lower()
        if not uname or len(uname) < 3:
            raise ValueError("用户名至少 3 个字符")
        if len(password) < 6:
            raise ValueError("密码至少 6 个字符")
        if self.find_by_username(uname) is not None:
            raise ValueError("用户名已存在")
        email_norm = normalize_email(email)
        if not email_norm:
            raise ValueError("请填写有效邮箱")
        if self.find_by_email(email_norm) is not None:
            raise ValueError("该邮箱已被注册")

        user_id = uuid.uuid4().hex[:12]
        now = utcnow()
        placeholder_hash = f"pending:{user_id}"
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                INSERT INTO api_users (
                    id, name, username, password_hash, status,
                    api_key_hash, api_key_prefix, api_key_secret,
                    enabled, is_admin, daily_generate_limit, daily_polish_limit,
                    note, created_at, last_seen_at, email
                ) VALUES (?, ?, ?, ?, ?, ?, '', '', 1, 0, ?, ?, '', ?, NULL, ?)
                """,
                (
                    user_id,
                    (display_name or uname).strip(),
                    uname,
                    hash_password(password),
                    STATUS_PENDING,
                    placeholder_hash,
                    50,  # overwritten by settings at route layer if needed
                    200,
                    now,
                    email_norm,
                ),
            )
        user = self.get_user(user_id)
        assert user is not None
        return user

    def find_by_email(self, email: str) -> ApiUser | None:
        email_norm = normalize_email(email)
        if not email_norm:
            return None
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM api_users WHERE lower(email) = ?", (email_norm,)
            ).fetchone()
        return self._row_to_user(row) if row else None

    def bind_email(self, user_id: str, password: str, email: str) -> ApiUser:
        """Bind/replace recovery email after verifying current password. No mail send."""
        user = self.get_user(user_id)
        if user is None:
            raise LookupError("User not found")
        if not user.password_hash or not verify_password(password, user.password_hash):
            raise ValueError("当前密码不正确")
        email_norm = normalize_email(email)
        if not email_norm:
            raise ValueError("请填写有效邮箱")
        other = self.find_by_email(email_norm)
        if other is not None and other.id != user_id:
            raise ValueError("该邮箱已被其他账号占用")
        with self._lock, self.connect() as conn:
            conn.execute(
                "UPDATE api_users SET email = ? WHERE id = ?",
                (email_norm, user_id),
            )
        updated = self.get_user(user_id)
        assert updated is not None
        return updated

    def set_default_limits(self, user_id: str, gen: int, polish: int) -> ApiUser | None:
        return self.update_user(
            user_id, daily_generate_limit=gen, daily_polish_limit=polish
        )

    def find_by_username(self, username: str) -> ApiUser | None:
        uname = username.strip().lower()
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM api_users WHERE lower(username) = ?", (uname,)
            ).fetchone()
        return self._row_to_user(row) if row else None

    def authenticate(self, username: str, password: str) -> ApiUser | None:
        user = self.find_by_username(username)
        if user is None or not user.password_hash:
            return None
        if not verify_password(password, user.password_hash):
            return None
        return user

    def set_password(self, user_id: str, password: str) -> ApiUser:
        if len(password) < 6:
            raise ValueError("密码至少 6 个字符")
        user = self.get_user(user_id)
        if user is None:
            raise LookupError("User not found")
        with self._lock, self.connect() as conn:
            conn.execute(
                "UPDATE api_users SET password_hash = ? WHERE id = ?",
                (hash_password(password), user_id),
            )
        updated = self.get_user(user_id)
        assert updated is not None
        return updated

    def reset_password(self, user_id: str, new_password: str | None = None) -> tuple[ApiUser, str]:
        """Admin reset. Returns (user, plaintext password to tell the user once)."""
        plain = new_password.strip() if new_password else secrets.token_urlsafe(9)
        if len(plain) < 6:
            raise ValueError("密码至少 6 个字符")
        user = self.set_password(user_id, plain)
        return user, plain

    def change_password(self, user_id: str, old_password: str, new_password: str) -> ApiUser:
        user = self.get_user(user_id)
        if user is None:
            raise LookupError("User not found")
        if not user.password_hash or not verify_password(old_password, user.password_hash):
            raise ValueError("原密码不正确")
        return self.set_password(user_id, new_password)

    def approved_non_admin_count(self) -> int:
        with self._lock, self.connect() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS c FROM api_users
                WHERE is_admin = 0 AND status = ? AND api_key_secret != ''
                """,
                (STATUS_ACTIVE,),
            ).fetchone()
        return int(row["c"]) if row else 0

    def pending_count(self) -> int:
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS c FROM api_users WHERE status = ?",
                (STATUS_PENDING,),
            ).fetchone()
        return int(row["c"]) if row else 0

    def pool_remaining(self, max_approved: int) -> int:
        return max(0, max_approved - self.approved_non_admin_count())

    def approve_user(self, user_id: str, *, max_approved: int) -> tuple[ApiUser, str]:
        user = self.get_user(user_id)
        if user is None:
            raise LookupError("User not found")
        if user.is_admin:
            raise ValueError("不能审批管理员账号")
        if user.status == STATUS_ACTIVE and user.api_key_secret:
            return user, user.api_key_secret
        if user.status == STATUS_REJECTED:
            raise ValueError("已拒绝的用户不能批准")

        plain = new_api_key()
        with self._lock, self.connect() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS c FROM api_users
                WHERE is_admin = 0 AND status = ? AND api_key_secret != '' AND id != ?
                """,
                (STATUS_ACTIVE, user_id),
            ).fetchone()
            if int(row["c"]) >= max_approved:
                raise ValueError("名额已满，无法批准")
            conn.execute(
                """
                UPDATE api_users SET
                    status = ?,
                    enabled = 1,
                    api_key_hash = ?,
                    api_key_prefix = ?,
                    api_key_secret = ?
                WHERE id = ?
                """,
                (
                    STATUS_ACTIVE,
                    hash_api_key(plain),
                    plain[:4],
                    plain,
                    user_id,
                ),
            )
        updated = self.get_user(user_id)
        assert updated is not None
        return updated, plain

    def reject_user(self, user_id: str) -> ApiUser:
        user = self.get_user(user_id)
        if user is None:
            raise LookupError("User not found")
        if user.is_admin:
            raise ValueError("不能拒绝管理员账号")
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                UPDATE api_users SET
                    status = ?,
                    enabled = 0,
                    api_key_hash = ?,
                    api_key_prefix = '',
                    api_key_secret = ''
                WHERE id = ?
                """,
                (STATUS_REJECTED, f"rejected:{user_id}", user_id),
            )
        updated = self.get_user(user_id)
        assert updated is not None
        return updated

    def delete_user(self, user_id: str) -> ApiUser:
        """Hard-delete account row and usage events. Caller purges related stores."""
        user = self.get_user(user_id)
        if user is None:
            raise LookupError("User not found")
        if user.is_admin:
            raise ValueError("不能注销管理员账号")
        with self._lock, self.connect() as conn:
            conn.execute("DELETE FROM usage_events WHERE user_id = ?", (user_id,))
            cur = conn.execute("DELETE FROM api_users WHERE id = ?", (user_id,))
            if cur.rowcount < 1:
                raise LookupError("User not found")
        return user

    def get_user(self, user_id: str) -> ApiUser | None:
        with self._lock, self.connect() as conn:
            row = conn.execute("SELECT * FROM api_users WHERE id = ?", (user_id,)).fetchone()
        return self._row_to_user(row) if row else None

    def find_by_api_key(self, api_key: str) -> ApiUser | None:
        """Lookup by key hash. Caller enforces active/enabled (401 vs 403)."""
        digest = hash_api_key(api_key)
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM api_users WHERE api_key_hash = ?", (digest,)
            ).fetchone()
        return self._row_to_user(row) if row else None

    def list_users(self) -> list[ApiUser]:
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM api_users ORDER BY created_at ASC"
            ).fetchall()
        return [self._row_to_user(r) for r in rows]

    def update_user(
        self,
        user_id: str,
        *,
        name: str | None = None,
        enabled: bool | None = None,
        daily_generate_limit: int | None = None,
        daily_polish_limit: int | None = None,
        note: str | None = None,
        status: str | None = None,
    ) -> ApiUser | None:
        user = self.get_user(user_id)
        if user is None:
            return None
        new_enabled = (1 if enabled else 0) if enabled is not None else (1 if user.enabled else 0)
        new_status = status if status is not None else user.status
        if enabled is False and not user.is_admin:
            new_status = STATUS_DISABLED
        if enabled is True and user.status == STATUS_DISABLED:
            new_status = STATUS_ACTIVE
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                UPDATE api_users SET
                    name = ?,
                    enabled = ?,
                    status = ?,
                    daily_generate_limit = ?,
                    daily_polish_limit = ?,
                    note = ?
                WHERE id = ?
                """,
                (
                    name if name is not None else user.name,
                    new_enabled,
                    new_status,
                    daily_generate_limit
                    if daily_generate_limit is not None
                    else user.daily_generate_limit,
                    daily_polish_limit
                    if daily_polish_limit is not None
                    else user.daily_polish_limit,
                    note if note is not None else user.note,
                    user_id,
                ),
            )
        return self.get_user(user_id)

    def rotate_key(self, user_id: str) -> tuple[ApiUser, str] | None:
        user = self.get_user(user_id)
        if user is None:
            return None
        if user.status != STATUS_ACTIVE:
            raise ValueError("仅已激活用户可轮换 Key")
        plain = new_api_key()
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                UPDATE api_users SET api_key_hash = ?, api_key_prefix = ?, api_key_secret = ?
                WHERE id = ?
                """,
                (hash_api_key(plain), plain[:4], plain, user_id),
            )
        updated = self.get_user(user_id)
        assert updated is not None
        return updated, plain

    def touch_seen(self, user_id: str) -> None:
        with self._lock, self.connect() as conn:
            conn.execute(
                "UPDATE api_users SET last_seen_at = ? WHERE id = ?",
                (utcnow(), user_id),
            )

    def record_usage(self, user_id: str, kind: str, meta: dict[str, Any] | None = None) -> None:
        import json

        with self._lock, self.connect() as conn:
            conn.execute(
                """
                INSERT INTO usage_events(user_id, kind, created_at, meta_json)
                VALUES (?, ?, ?, ?)
                """,
                (user_id, kind, utcnow(), json.dumps(meta or {}, ensure_ascii=False)),
            )

    def _day_start_iso(self) -> str:
        now = datetime.now(timezone.utc)
        start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
        return start.replace(microsecond=0).isoformat()

    def counts_today(self, user_id: str) -> UsageCounts:
        day = self._day_start_iso()
        with self._lock, self.connect() as conn:
            gen = conn.execute(
                """
                SELECT COUNT(*) AS c FROM usage_events
                WHERE user_id = ? AND kind = 'generate' AND created_at >= ?
                """,
                (user_id, day),
            ).fetchone()
            pol = conn.execute(
                """
                SELECT COUNT(*) AS c FROM usage_events
                WHERE user_id = ? AND kind = 'polish' AND created_at >= ?
                """,
                (user_id, day),
            ).fetchone()
        return UsageCounts(
            generate_today=int(gen["c"]) if gen else 0,
            polish_today=int(pol["c"]) if pol else 0,
        )

    def usage_today_global(self) -> tuple[int, int]:
        day = self._day_start_iso()
        with self._lock, self.connect() as conn:
            gen = conn.execute(
                "SELECT COUNT(*) AS c FROM usage_events WHERE kind='generate' AND created_at >= ?",
                (day,),
            ).fetchone()
            pol = conn.execute(
                "SELECT COUNT(*) AS c FROM usage_events WHERE kind='polish' AND created_at >= ?",
                (day,),
            ).fetchone()
        return int(gen["c"]) if gen else 0, int(pol["c"]) if pol else 0

    def active_user_count(self, minutes: int = 15) -> int:
        cutoff = (
            datetime.now(timezone.utc) - timedelta(minutes=minutes)
        ).replace(microsecond=0).isoformat()
        with self._lock, self.connect() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS c FROM api_users
                WHERE last_seen_at IS NOT NULL AND last_seen_at >= ?
                  AND enabled = 1 AND status = ?
                """,
                (cutoff, STATUS_ACTIVE),
            ).fetchone()
        return int(row["c"]) if row else 0

    def user_public_dict(self, user: ApiUser, counts: UsageCounts | None = None) -> dict[str, Any]:
        c = counts or self.counts_today(user.id)
        return {
            "id": user.id,
            "name": user.name,
            "username": user.username,
            "email": user.email or "",
            "status": user.status,
            "api_key_prefix": user.api_key_prefix,
            "enabled": user.enabled,
            "is_admin": user.is_admin,
            "daily_generate_limit": user.daily_generate_limit,
            "daily_polish_limit": user.daily_polish_limit,
            "generate_today": c.generate_today,
            "polish_today": c.polish_today,
            "note": user.note,
            "created_at": user.created_at,
            "last_seen_at": user.last_seen_at,
        }

    @staticmethod
    def _row_to_user(row: sqlite3.Row) -> ApiUser:
        keys = row.keys()
        return ApiUser(
            id=row["id"],
            name=row["name"],
            username=row["username"] if "username" in keys else "",
            password_hash=row["password_hash"] if "password_hash" in keys else "",
            status=row["status"] if "status" in keys else STATUS_ACTIVE,
            api_key_hash=row["api_key_hash"],
            api_key_prefix=row["api_key_prefix"] or "",
            api_key_secret=row["api_key_secret"] if "api_key_secret" in keys else "",
            enabled=bool(row["enabled"]),
            is_admin=bool(row["is_admin"]),
            daily_generate_limit=int(row["daily_generate_limit"]),
            daily_polish_limit=int(row["daily_polish_limit"]),
            note=row["note"] or "",
            created_at=row["created_at"],
            last_seen_at=row["last_seen_at"],
            email=(row["email"] if "email" in keys else "") or "",
        )
