"""Minimal RFC 6238 TOTP (no extra dependency)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time


def generate_totp_secret() -> str:
    """Return a base32 secret suitable for Authenticator apps."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _normalize_secret(secret: str) -> bytes:
    s = "".join((secret or "").strip().upper().split())
    pad = "=" * ((8 - len(s) % 8) % 8)
    return base64.b32decode(s + pad, casefold=True)


def totp_code(secret: str, *, for_time: int | None = None, digits: int = 6, period: int = 30) -> str:
    counter = int((for_time if for_time is not None else time.time()) // period)
    key = _normalize_secret(secret)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    num = (
        ((digest[offset] & 0x7F) << 24)
        | (digest[offset + 1] << 16)
        | (digest[offset + 2] << 8)
        | digest[offset + 3]
    )
    return f"{num % (10 ** digits):0{digits}d}"


def verify_totp(
    secret: str,
    code: str,
    *,
    window: int = 1,
    digits: int = 6,
    period: int = 30,
) -> bool:
    raw = "".join(ch for ch in (code or "").strip() if ch.isdigit())
    if len(raw) != digits:
        return False
    now = int(time.time())
    for drift in range(-window, window + 1):
        if hmac.compare_digest(totp_code(secret, for_time=now + drift * period, digits=digits, period=period), raw):
            return True
    return False


def otpauth_uri(*, secret: str, account: str = "admin", issuer: str = "Comfy Gateway") -> str:
    # Keep URI simple; Authenticator apps accept secret without padding.
    s = "".join(secret.strip().upper().split()).rstrip("=")
    label = f"{issuer}:{account}"
    return (
        f"otpauth://totp/{label}?secret={s}&issuer={issuer.replace(' ', '%20')}"
        f"&algorithm=SHA1&digits=6&period=30"
    )
