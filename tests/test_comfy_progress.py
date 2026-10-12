from __future__ import annotations

from app.comfy_client import comfy_ws_url


def test_comfy_ws_url_http() -> None:
    assert (
        comfy_ws_url("http://127.0.0.1:8188", "abc")
        == "ws://127.0.0.1:8188/ws?clientId=abc"
    )


def test_comfy_ws_url_https_trailing_slash() -> None:
    assert (
        comfy_ws_url("https://comfy.example.com/", "cid-1")
        == "wss://comfy.example.com/ws?clientId=cid-1"
    )
