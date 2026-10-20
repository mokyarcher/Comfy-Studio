from pathlib import Path

from app.works_store import WorksStore


def test_works_create_list_link_delete(tmp_path: Path):
    store = WorksStore(tmp_path / "works.db")
    w = store.create(
        owner_user_id="u1",
        prompt="a cat",
        mode="txt2img",
        width=512,
        height=512,
        steps=20,
        seed=1,
        remote_task_id="task-1",
    )
    assert w.id
    listed = store.list_by_owner("u1")
    assert len(listed) == 1
    assert listed[0].prompt == "a cat"

    assert store.link_gallery(w.id, "u1", "gal-9")
    got = store.get(w.id)
    assert got is not None
    assert got.cloud_gallery_id == "gal-9"
    assert got.to_dict()["image_url"] == "/v1/cloud-gallery/gal-9/image"

    assert store.delete(w.id, "u1")
    assert store.list_by_owner("u1") == []


def test_delete_by_owner(tmp_path: Path):
    store = WorksStore(tmp_path / "works.db")
    store.create(owner_user_id="a", prompt="1", mode="txt2img")
    store.create(owner_user_id="a", prompt="2", mode="txt2img")
    store.create(owner_user_id="b", prompt="3", mode="txt2img")
    assert store.delete_by_owner("a") == 2
    assert len(store.list_by_owner("b")) == 1
