"""HOST_COMFY_DIR resolves desktop (main.py) and Windows portable layouts."""

from pathlib import Path

from app.host_services import _resolve_comfy_install, _resolve_comfy_launch


def test_resolve_source_install(tmp_path: Path):
    (tmp_path / "main.py").write_text("# comfy\n", encoding="utf-8")
    (tmp_path / ".venv" / "Scripts").mkdir(parents=True)
    (tmp_path / ".venv" / "Scripts" / "python.exe").write_bytes(b"")

    resolved = _resolve_comfy_install(tmp_path)
    assert resolved is not None
    cwd, kind, default = resolved
    assert kind == "source"
    assert cwd == tmp_path
    assert "main.py" in default

    launch = _resolve_comfy_launch(cwd, kind, default, default)
    assert launch == default


def test_resolve_portable_nested_and_outer(tmp_path: Path):
    portable = tmp_path / "ComfyUI_windows_portable"
    (portable / "ComfyUI").mkdir(parents=True)
    (portable / "ComfyUI" / "main.py").write_text("# comfy\n", encoding="utf-8")
    (portable / "python_embeded").mkdir()
    (portable / "python_embeded" / "python.exe").write_bytes(b"")

    inner = _resolve_comfy_install(portable)
    assert inner is not None
    assert inner[1] == "portable"
    assert inner[0] == portable
    assert "python_embeded" in inner[2]

    outer = _resolve_comfy_install(tmp_path)
    assert outer is not None
    assert outer[0] == portable
    assert outer[1] == "portable"

    # Desktop-style launch on portable dir → rewritten
    rewritten = _resolve_comfy_launch(
        portable,
        "portable",
        inner[2],
        r".venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188",
    )
    assert "python_embeded" in rewritten
    assert r"ComfyUI\main.py" in rewritten
