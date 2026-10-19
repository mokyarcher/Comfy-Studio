"""Password-reset OTP via email (SMTP or dry-run log)."""

from __future__ import annotations

import hashlib
import logging
import secrets
import smtplib
import sqlite3
import threading
import time
from email.message import EmailMessage
from pathlib import Path

logger = logging.getLogger(__name__)


def generate_otp_code(digits: int = 6) -> str:
    upper = 10**digits
    return f"{secrets.randbelow(upper):0{digits}d}"


def _hash_code(email: str, code: str, secret: str) -> str:
    return hashlib.sha256(f"{secret}:{email}:{code}".encode("utf-8")).hexdigest()


class EmailResetStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS email_otps (
                        email TEXT PRIMARY KEY,
                        code_hash TEXT NOT NULL,
                        expires_at REAL NOT NULL,
                        attempts INTEGER NOT NULL DEFAULT 0,
                        sent_at REAL NOT NULL,
                        send_count_day INTEGER NOT NULL DEFAULT 0,
                        send_day TEXT NOT NULL DEFAULT ''
                    );
                    """
                )
                conn.commit()
            finally:
                conn.close()

    def can_send(
        self,
        email: str,
        *,
        cooldown_seconds: int,
        daily_limit: int,
    ) -> tuple[bool, str]:
        now = time.time()
        day = time.strftime("%Y-%m-%d", time.gmtime(now))
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT * FROM email_otps WHERE email = ?", (email,)
                ).fetchone()
                if row is None:
                    return True, ""
                if float(row["sent_at"]) + cooldown_seconds > now:
                    wait = int(float(row["sent_at"]) + cooldown_seconds - now) + 1
                    return False, f"请 {wait} 秒后再试"
                count = int(row["send_count_day"] or 0)
                if row["send_day"] == day and count >= daily_limit:
                    return False, "今日发送次数已达上限"
                return True, ""
            finally:
                conn.close()

    def save_otp(
        self,
        email: str,
        code: str,
        *,
        ttl_seconds: int,
        secret: str,
    ) -> None:
        now = time.time()
        day = time.strftime("%Y-%m-%d", time.gmtime(now))
        code_hash = _hash_code(email, code, secret)
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT send_count_day, send_day FROM email_otps WHERE email = ?",
                    (email,),
                ).fetchone()
                if row and row["send_day"] == day:
                    count = int(row["send_count_day"] or 0) + 1
                else:
                    count = 1
                conn.execute(
                    """
                    INSERT INTO email_otps(
                        email, code_hash, expires_at, attempts, sent_at,
                        send_count_day, send_day
                    ) VALUES (?, ?, ?, 0, ?, ?, ?)
                    ON CONFLICT(email) DO UPDATE SET
                        code_hash = excluded.code_hash,
                        expires_at = excluded.expires_at,
                        attempts = 0,
                        sent_at = excluded.sent_at,
                        send_count_day = excluded.send_count_day,
                        send_day = excluded.send_day
                    """,
                    (email, code_hash, now + ttl_seconds, now, count, day),
                )
                conn.commit()
            finally:
                conn.close()

    def verify_otp(
        self,
        email: str,
        code: str,
        *,
        secret: str,
        max_attempts: int = 5,
    ) -> tuple[bool, str]:
        raw = "".join(ch for ch in (code or "").strip() if ch.isdigit())
        if len(raw) < 4:
            return False, "验证码格式不正确"
        now = time.time()
        expect = _hash_code(email, raw, secret)
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT * FROM email_otps WHERE email = ?", (email,)
                ).fetchone()
                if row is None:
                    return False, "请先获取验证码"
                if float(row["expires_at"]) < now:
                    return False, "验证码已过期"
                attempts = int(row["attempts"] or 0)
                if attempts >= max_attempts:
                    return False, "验证码错误次数过多，请重新获取"
                if not secrets.compare_digest(row["code_hash"], expect):
                    conn.execute(
                        "UPDATE email_otps SET attempts = attempts + 1 WHERE email = ?",
                        (email,),
                    )
                    conn.commit()
                    return False, "验证码错误"
                conn.execute("DELETE FROM email_otps WHERE email = ?", (email,))
                conn.commit()
                return True, ""
            finally:
                conn.close()


def send_reset_email(
    *,
    to_email: str,
    code: str,
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_password: str,
    mail_from: str,
    use_tls: bool = True,
    dry_run: bool = False,
) -> None:
    subject = "Comfy Studio 密码重置验证码"
    body = (
        f"您的密码重置验证码是：{code}\n\n"
        f"有效期约 5 分钟。如非本人操作请忽略本邮件。\n"
    )
    if dry_run or not smtp_host:
        logger.warning(
            "MAIL dry-run to=%s code=%s (configure MAIL_SMTP_* to send for real)",
            to_email,
            code,
        )
        return

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = mail_from or smtp_user
    msg["To"] = to_email
    msg.set_content(body)

    if use_tls:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as smtp:
            smtp.starttls()
            if smtp_user:
                smtp.login(smtp_user, smtp_password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as smtp:
            if smtp_user:
                smtp.login(smtp_user, smtp_password)
            smtp.send_message(msg)
