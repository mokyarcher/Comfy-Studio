from __future__ import annotations

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import get_settings
from app.main import create_app


def _png_bytes(w: int = 128, h: int = 96) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (w, h), (40, 120, 200)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def client(test_settings):
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def _admin():
    return {"X-API-Key": "test-secret-key"}


def test_showcase_share_list_copy_unlist(client: TestClient):
    # share with result + one ref
    png = _png_bytes()
    files = [
        ("image", ("result.png", png, "image/png")),
        ("refs", ("ref0.png", png, "image/png")),
    ]
    data = {
        "prompt": "a glowing fox in mist",
        "negative_prompt": "blurry",
        "mode": "image_edit",
        "width": "1024",
        "height": "1024",
        "steps": "25",
        "seed": "42",
        "elapsed_ms": "18320",
    }
    r = client.post("/v1/showcase", data=data, files=files, headers=_admin())
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["prompt"] == "a glowing fox in mist"
    assert item["negative_prompt"] == "blurry"
    assert item["mode"] == "image_edit"
    assert item["seed"] == 42
    assert item["elapsed_ms"] == 18320
    assert item["ref_count"] == 1
    assert item["mine"] is True
    assert item["status"] == "published"
    item_id = item["id"]

    listed = client.get("/v1/showcase", headers=_admin())
    assert listed.status_code == 200
    body = listed.json()
    assert body["count"] >= 1
    assert any(i["id"] == item_id for i in body["items"])

    detail = client.get(f"/v1/showcase/{item_id}", headers=_admin())
    assert detail.status_code == 200
    assert detail.json()["prompt"] == "a glowing fox in mist"

    assert item.get("thumb_url") == f"/v1/showcase/{item_id}/thumb"

    thumb = client.get(f"/v1/showcase/{item_id}/thumb", headers=_admin())
    assert thumb.status_code == 200
    assert thumb.headers["content-type"].startswith("image/jpeg")
    assert thumb.content[:2] == b"\xff\xd8"  # JPEG SOI

    img = client.get(f"/v1/showcase/{item_id}/image", headers=_admin())
    assert img.status_code == 200
    assert img.content[:8] == b"\x89PNG\r\n\x1a\n"

    ref = client.get(f"/v1/showcase/{item_id}/refs/0", headers=_admin())
    assert ref.status_code == 200
    assert ref.content[:8] == b"\x89PNG\r\n\x1a\n"

    un = client.post(f"/v1/showcase/{item_id}/unlist", headers=_admin())
    assert un.status_code == 200
    assert un.json()["status"] == "unlisted"

    listed2 = client.get("/v1/showcase", headers=_admin())
    assert listed2.status_code == 200
    assert not any(i["id"] == item_id for i in listed2.json()["items"])

    # author can still see in mine
    mine = client.get("/v1/showcase/mine", headers=_admin())
    assert mine.status_code == 200
    mine_item = next(i for i in mine.json()["items"] if i["id"] == item_id)
    assert mine_item["status"] == "unlisted"

    # public image gone after unlist
    img2 = client.get(f"/v1/showcase/{item_id}/image", headers=_admin())
    assert img2.status_code == 404


def test_showcase_requires_auth(client: TestClient):
    r = client.get("/v1/showcase")
    assert r.status_code == 401


def test_admin_force_unlist(client: TestClient):
    png = _png_bytes()
    r = client.post(
        "/v1/showcase",
        data={
            "prompt": "moderation target",
            "mode": "txt2img",
            "width": "512",
            "height": "512",
            "steps": "20",
        },
        files=[("image", ("result.png", png, "image/png"))],
        headers=_admin(),
    )
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]

    un = client.post(f"/v1/admin/showcase/{item_id}/unlist", headers=_admin())
    assert un.status_code == 200, un.text
    assert un.json()["status"] == "unlisted"

    listed = client.get("/v1/showcase", headers=_admin())
    assert listed.status_code == 200
    assert not any(i["id"] == item_id for i in listed.json()["items"])
