"""Unit tests for admin SMS OTP store (no Aliyun network)."""

from __future__ import annotations

from pathlib import Path

from app.sms_auth import SmsAuthStore, generate_otp_code, normalize_cn_phone


def test_normalize_cn_phone() -> None:
    assert normalize_cn_phone("13800138000") == "13800138000"
    assert normalize_cn_phone("+86 138-0013-8000") == "13800138000"
    assert normalize_cn_phone("8613800138000") == "13800138000"
    assert normalize_cn_phone("12345") is None


def test_tencent_sign_shape() -> None:
    from app.sms_auth import _tc3_sign

    auth = _tc3_sign(
        secret_id="AKIDxxxx",
        secret_key="secret",
        service="sms",
        host="sms.tencentcloudapi.com",
        action="SendSms",
        region="ap-guangzhou",
        payload='{"PhoneNumberSet":["+8613800138000"]}',
        timestamp=1_700_000_000,
    )
    assert auth.startswith("TC3-HMAC-SHA256 Credential=AKIDxxxx/")
    assert "Signature=" in auth


def test_otp_and_session_roundtrip(tmp_path: Path) -> None:
    store = SmsAuthStore(tmp_path / "admin_sms.db")
    phone = "13800138000"
    secret = "test-secret"
    code = generate_otp_code()
    assert len(code) == 6

    ok, _ = store.can_send(phone, cooldown_seconds=60, daily_limit=10)
    assert ok
    store.save_otp(phone, code, ttl_seconds=300, secret=secret)

    bad, msg = store.verify_otp(phone, "000000", secret=secret)
    assert not bad
    assert "错误" in msg

    good, _ = store.verify_otp(phone, code, secret=secret)
    assert good

    # one-time
    again, _ = store.verify_otp(phone, code, secret=secret)
    assert not again

    token, _exp = store.create_session(phone, ttl_seconds=3600)
    sess = store.validate_session(token)
    assert sess is not None
    assert sess.phone == phone
    store.revoke_session(token)
    assert store.validate_session(token) is None


def test_signed_session_portable_across_stores(tmp_path: Path) -> None:
    """Meta issues cookie; GPU validates with same signing_secret (separate DBs)."""
    secret = "shared-admin-session-secret"
    meta = SmsAuthStore(tmp_path / "meta.db", signing_secret=secret)
    gpu = SmsAuthStore(tmp_path / "gpu.db", signing_secret=secret)
    token, _ = meta.create_session("admin", ttl_seconds=3600)
    assert token.startswith("cs1.")
    sess = gpu.validate_session(token)
    assert sess is not None
    assert sess.phone == "admin"
    meta.revoke_session(token)
    assert meta.validate_session(token) is None
    # GPU has no revoke row — still valid until TTL (acceptable across planes)
    assert gpu.validate_session(token) is not None
