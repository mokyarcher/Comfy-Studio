from app.totp import generate_totp_secret, otpauth_uri, totp_code, verify_totp


def test_totp_roundtrip():
    secret = generate_totp_secret()
    code = totp_code(secret)
    assert verify_totp(secret, code)
    assert not verify_totp(secret, "000000")


def test_otpauth_uri_contains_secret():
    secret = "JBSWY3DPEHPK3PXP"
    uri = otpauth_uri(secret=secret, account="admin", issuer="Comfy Gateway")
    assert uri.startswith("otpauth://totp/")
    assert "secret=JBSWY3DPEHPK3PXP" in uri
    assert "Comfy%20Gateway" in uri or "Comfy Gateway" in uri
