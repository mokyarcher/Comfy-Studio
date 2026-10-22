"""Admin SMS OTP + session store (Aliyun Dysmsapi). Only ADMIN_PHONE may login."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import sqlite3
import threading
import time
from base64 import b64decode, b64encode
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)

COOKIE_NAME = "admin_session"
# Portable cookie: Meta issues, GPU verifies with the same ADMIN_SESSION_SECRET / API_KEY.
SIGNED_SESSION_PREFIX = "cs1."


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_cn_phone(raw: str) -> str | None:
    s = "".join(ch for ch in (raw or "").strip() if ch.isdigit() or ch == "+")
    if s.startswith("+86"):
        s = s[3:]
    elif s.startswith("86") and len(s) == 13:
        s = s[2:]
    if len(s) == 11 and s.startswith("1"):
        return s
    return None


def _hash(value: str, *, salt: str = "") -> str:
    return hashlib.sha256(f"{salt}:{value}".encode("utf-8")).hexdigest()


def _b64url_encode(raw: bytes) -> str:
    return b64encode(raw).decode("ascii").rstrip("=").replace("+", "-").replace("/", "_")


@dataclass
class SessionInfo:
    session_id: str
    phone: str
    expires_at: float


class SmsAuthStore:
    def __init__(self, db_path: Path, *, signing_secret: str = "") -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.signing_secret = (signing_secret or "").strip()
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
                    CREATE TABLE IF NOT EXISTS sms_otps (
                        phone TEXT PRIMARY KEY,
                        code_hash TEXT NOT NULL,
                        expires_at REAL NOT NULL,
                        attempts INTEGER NOT NULL DEFAULT 0,
                        sent_at REAL NOT NULL,
                        send_count_day INTEGER NOT NULL DEFAULT 0,
                        send_day TEXT NOT NULL DEFAULT ''
                    );
                    CREATE TABLE IF NOT EXISTS admin_sessions (
                        token_hash TEXT PRIMARY KEY,
                        phone TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        expires_at REAL NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_admin_sessions_exp
                        ON admin_sessions(expires_at);
                    CREATE TABLE IF NOT EXISTS admin_session_revoked (
                        jti_hash TEXT PRIMARY KEY,
                        revoked_at REAL NOT NULL
                    );
                    """
                )
                conn.commit()
            finally:
                conn.close()

    def _sign_payload(self, body: str) -> str:
        assert self.signing_secret
        return hmac.new(
            self.signing_secret.encode("utf-8"),
            body.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def _decode_signed_body(self, token: str) -> tuple[dict[str, Any], str] | None:
        """Return (payload, jti_hash) if signature ok; does not check exp/revoke."""
        if not self.signing_secret or not token.startswith(SIGNED_SESSION_PREFIX):
            return None
        rest = token[len(SIGNED_SESSION_PREFIX) :]
        if "." not in rest:
            return None
        body, sig = rest.rsplit(".", 1)
        if not body or not sig:
            return None
        expect = self._sign_payload(body)
        if not hmac.compare_digest(expect, sig):
            return None
        pad = "=" * (-len(body) % 4)
        try:
            raw = body.replace("-", "+").replace("_", "/") + pad
            payload = json.loads(b64decode(raw).decode("utf-8"))
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
            return None
        if not isinstance(payload, dict):
            return None
        jti = str(payload.get("jti") or "")
        if not jti:
            return None
        return payload, _hash(jti)

    def _parse_signed_token(self, token: str) -> SessionInfo | None:
        decoded = self._decode_signed_body(token)
        if decoded is None:
            return None
        payload, jti_hash = decoded
        sub = str(payload.get("sub") or "")
        try:
            exp = float(payload.get("exp") or 0)
        except (TypeError, ValueError):
            return None
        if not sub or exp <= time.time():
            return None
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT 1 FROM admin_session_revoked WHERE jti_hash = ?",
                    (jti_hash,),
                ).fetchone()
                if row is not None:
                    return None
            finally:
                conn.close()
        return SessionInfo(session_id=jti_hash[:12], phone=sub, expires_at=exp)

    def can_send(
        self,
        phone: str,
        *,
        cooldown_seconds: int,
        daily_limit: int,
    ) -> tuple[bool, str]:
        now = time.time()
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT * FROM sms_otps WHERE phone = ?", (phone,)
                ).fetchone()
                if row is None:
                    return True, ""
                if float(row["sent_at"]) + cooldown_seconds > now:
                    wait = int(float(row["sent_at"]) + cooldown_seconds - now)
                    return False, f"请 {max(1, wait)} 秒后再试"
                count = int(row["send_count_day"] or 0)
                if str(row["send_day"] or "") != day:
                    count = 0
                if count >= daily_limit:
                    return False, "今日发送次数已达上限"
                return True, ""
            finally:
                conn.close()

    def save_otp(
        self,
        phone: str,
        code: str,
        *,
        ttl_seconds: int,
        secret: str,
    ) -> None:
        now = time.time()
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        code_hash = _hash(code, salt=f"{secret}:{phone}")
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT send_count_day, send_day FROM sms_otps WHERE phone = ?",
                    (phone,),
                ).fetchone()
                count = 1
                if row is not None:
                    if str(row["send_day"] or "") == day:
                        count = int(row["send_count_day"] or 0) + 1
                conn.execute(
                    """
                    INSERT INTO sms_otps (
                        phone, code_hash, expires_at, attempts, sent_at,
                        send_count_day, send_day
                    ) VALUES (?, ?, ?, 0, ?, ?, ?)
                    ON CONFLICT(phone) DO UPDATE SET
                        code_hash = excluded.code_hash,
                        expires_at = excluded.expires_at,
                        attempts = 0,
                        sent_at = excluded.sent_at,
                        send_count_day = excluded.send_count_day,
                        send_day = excluded.send_day
                    """,
                    (phone, code_hash, now + ttl_seconds, now, count, day),
                )
                conn.commit()
            finally:
                conn.close()

    def verify_otp(
        self,
        phone: str,
        code: str,
        *,
        secret: str,
        max_attempts: int = 5,
    ) -> tuple[bool, str]:
        now = time.time()
        code_hash = _hash(code, salt=f"{secret}:{phone}")
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT * FROM sms_otps WHERE phone = ?", (phone,)
                ).fetchone()
                if row is None:
                    return False, "请先获取验证码"
                if float(row["expires_at"]) < now:
                    return False, "验证码已过期"
                attempts = int(row["attempts"] or 0)
                if attempts >= max_attempts:
                    return False, "尝试次数过多，请重新获取验证码"
                if not hmac.compare_digest(str(row["code_hash"]), code_hash):
                    conn.execute(
                        "UPDATE sms_otps SET attempts = ? WHERE phone = ?",
                        (attempts + 1, phone),
                    )
                    conn.commit()
                    return False, "验证码错误"
                conn.execute("DELETE FROM sms_otps WHERE phone = ?", (phone,))
                conn.commit()
                return True, ""
            finally:
                conn.close()

    def create_session(
        self, phone: str, *, ttl_seconds: int
    ) -> tuple[str, float]:
        now = time.time()
        expires = now + ttl_seconds
        if self.signing_secret:
            jti = secrets.token_urlsafe(16)
            payload = json.dumps(
                {"sub": phone, "exp": int(expires), "jti": jti},
                separators=(",", ":"),
                ensure_ascii=False,
            ).encode("utf-8")
            body = _b64url_encode(payload)
            token = f"{SIGNED_SESSION_PREFIX}{body}.{self._sign_payload(body)}"
            token_hash = _hash(jti)
        else:
            token = secrets.token_urlsafe(32)
            token_hash = _hash(token)
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "DELETE FROM admin_sessions WHERE expires_at < ?", (now,)
                )
                conn.execute(
                    """
                    INSERT INTO admin_sessions (token_hash, phone, created_at, expires_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (token_hash, phone, now, expires),
                )
                conn.commit()
            finally:
                conn.close()
        return token, expires

    def validate_session(self, token: str | None) -> SessionInfo | None:
        if not token:
            return None
        signed = self._parse_signed_token(token)
        if signed is not None:
            return signed
        now = time.time()
        token_hash = _hash(token)
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT * FROM admin_sessions WHERE token_hash = ?",
                    (token_hash,),
                ).fetchone()
                if row is None:
                    return None
                if float(row["expires_at"]) < now:
                    conn.execute(
                        "DELETE FROM admin_sessions WHERE token_hash = ?",
                        (token_hash,),
                    )
                    conn.commit()
                    return None
                return SessionInfo(
                    session_id=token_hash[:12],
                    phone=str(row["phone"]),
                    expires_at=float(row["expires_at"]),
                )
            finally:
                conn.close()

    def revoke_session(self, token: str | None) -> None:
        if not token:
            return
        decoded = self._decode_signed_body(token)
        if decoded is not None:
            _payload, jti_hash = decoded
            with self._lock:
                conn = self._connect()
                try:
                    conn.execute(
                        "INSERT OR IGNORE INTO admin_session_revoked (jti_hash, revoked_at) VALUES (?, ?)",
                        (jti_hash, time.time()),
                    )
                    conn.execute(
                        "DELETE FROM admin_sessions WHERE token_hash = ?",
                        (jti_hash,),
                    )
                    conn.commit()
                finally:
                    conn.close()
            return
        token_hash = _hash(token)
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "DELETE FROM admin_sessions WHERE token_hash = ?",
                    (token_hash,),
                )
                conn.commit()
            finally:
                conn.close()


def generate_otp_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _aliyun_percent_encode(value: str) -> str:
    return quote(value, safe="~")


def _tc3_sign(
    *,
    secret_id: str,
    secret_key: str,
    service: str,
    host: str,
    action: str,
    region: str,
    payload: str,
    timestamp: int,
) -> str:
    algorithm = "TC3-HMAC-SHA256"
    date = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d")
    ct = "application/json; charset=utf-8"
    canonical_headers = f"content-type:{ct}\nhost:{host}\nx-tc-action:{action.lower()}\n"
    signed_headers = "content-type;host;x-tc-action"
    hashed_payload = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    canonical_request = (
        "POST\n/\n\n"
        f"{canonical_headers}\n"
        f"{signed_headers}\n"
        f"{hashed_payload}"
    )
    credential_scope = f"{date}/{service}/tc3_request"
    string_to_sign = (
        f"{algorithm}\n{timestamp}\n{credential_scope}\n"
        f"{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"
    )

    def _hmac_sha256(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    secret_date = _hmac_sha256(("TC3" + secret_key).encode("utf-8"), date)
    secret_service = _hmac_sha256(secret_date, service)
    secret_signing = _hmac_sha256(secret_service, "tc3_request")
    signature = hmac.new(
        secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return (
        f"{algorithm} Credential={secret_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )


def send_tencent_sms(
    *,
    phone: str,
    code: str,
    secret_id: str,
    secret_key: str,
    sdk_app_id: str,
    sign_name: str,
    template_id: str,
    region: str = "ap-guangzhou",
) -> None:
    """Send SMS via Tencent Cloud SMS API 2021-01-11 (TC3 signature)."""
    host = "sms.tencentcloudapi.com"
    service = "sms"
    action = "SendSms"
    version = "2021-01-11"
    e164 = phone if phone.startswith("+") else f"+86{phone}"
    body_obj = {
        "PhoneNumberSet": [e164],
        "SmsSdkAppId": sdk_app_id,
        "SignName": sign_name,
        "TemplateId": template_id,
        "TemplateParamSet": [code],
    }
    payload = json.dumps(body_obj, ensure_ascii=False, separators=(",", ":"))
    timestamp = int(time.time())
    authorization = _tc3_sign(
        secret_id=secret_id,
        secret_key=secret_key,
        service=service,
        host=host,
        action=action,
        region=region,
        payload=payload,
        timestamp=timestamp,
    )
    headers = {
        "Authorization": authorization,
        "Content-Type": "application/json; charset=utf-8",
        "Host": host,
        "X-TC-Action": action,
        "X-TC-Timestamp": str(timestamp),
        "X-TC-Version": version,
        "X-TC-Region": region,
    }
    with httpx.Client(timeout=15.0) as client:
        res = client.post(f"https://{host}/", headers=headers, content=payload)
        try:
            data = res.json()
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"SMS provider error HTTP {res.status_code}") from exc
    resp = data.get("Response") or {}
    if resp.get("Error"):
        err = resp["Error"]
        raise RuntimeError(str(err.get("Message") or err.get("Code") or "SMS failed"))
    status_set = resp.get("SendStatusSet") or []
    if status_set:
        st = status_set[0] or {}
        # Tencent success code is usually "Ok"
        st_code = str(st.get("Code") or "")
        if st_code and st_code.lower() != "ok":
            raise RuntimeError(str(st.get("Message") or st_code or "SMS failed"))


def send_aliyun_sms(
    *,
    phone: str,
    code: str,
    access_key_id: str,
    access_key_secret: str,
    sign_name: str,
    template_code: str,
    region_id: str = "cn-hangzhou",
) -> None:
    """Send SMS via Aliyun Dysmsapi (classic RPC signature)."""
    params: dict[str, str] = {
        "AccessKeyId": access_key_id,
        "Action": "SendSms",
        "Format": "JSON",
        "PhoneNumbers": phone,
        "RegionId": region_id,
        "SignName": sign_name,
        "SignatureMethod": "HMAC-SHA1",
        "SignatureNonce": str(uuid4()),
        "SignatureVersion": "1.0",
        "TemplateCode": template_code,
        "TemplateParam": json.dumps({"code": code}, ensure_ascii=False),
        "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "Version": "2017-05-25",
    }
    sorted_items = sorted(params.items())
    canonical = "&".join(
        f"{_aliyun_percent_encode(k)}={_aliyun_percent_encode(v)}" for k, v in sorted_items
    )
    string_to_sign = f"GET&%2F&{_aliyun_percent_encode(canonical)}"
    digest = hmac.new(
        (access_key_secret + "&").encode("utf-8"),
        string_to_sign.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    params["Signature"] = b64encode(digest).decode("utf-8")
    url = "https://dysmsapi.aliyuncs.com/?" + "&".join(
        f"{_aliyun_percent_encode(k)}={_aliyun_percent_encode(v)}"
        for k, v in sorted(params.items())
    )
    with httpx.Client(timeout=15.0) as client:
        res = client.get(url)
        data: dict[str, Any]
        try:
            data = res.json()
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"SMS provider error HTTP {res.status_code}") from exc
        if data.get("Code") != "OK":
            raise RuntimeError(str(data.get("Message") or data.get("Code") or "SMS failed"))
