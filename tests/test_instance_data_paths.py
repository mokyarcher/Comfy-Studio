"""INSTANCE_ID namespaces runtime data under data/instances/{id}/."""

from pathlib import Path

from app.config import PROJECT_ROOT, Settings, get_settings, sanitize_instance_id


def test_sanitize_instance_id():
    assert sanitize_instance_id("qwen-image") == "qwen-image"
    assert sanitize_instance_id("  Foo Bar!! ") == "Foo-Bar"
    assert sanitize_instance_id("") == "default"


def test_instance_namespaces_legacy_data_paths(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("INSTANCE_ID", "chain-a")
    monkeypatch.setenv("API_KEY", "test-key")
    # Relative paths under data/ should relocate.
    monkeypatch.setenv("USERS_DB_PATH", "data/users.db")
    monkeypatch.setenv("PROMPT_LIBRARY_PATH", "data/prompt_library.json")
    monkeypatch.setenv("WORKS_DB_PATH", "data/works.db")
    monkeypatch.setenv("CLOUD_GALLERY_DB_PATH", "data/cloud_gallery.db")
    monkeypatch.setenv("SHOWCASE_DB_PATH", "data/showcase.db")
    get_settings.cache_clear()
    s = Settings()
    root = (PROJECT_ROOT / "data" / "instances" / "chain-a").resolve()
    assert s.instance_data_dir == root
    assert s.users_db_path == root / "users.db"
    assert s.prompt_library_path == root / "prompt_library.json"
    assert s.works_db_path == root / "works.db"
    assert s.cloud_gallery_db_path == root / "cloud_gallery.db"
    assert s.showcase_db_path == root / "showcase.db"
    get_settings.cache_clear()


def test_absolute_paths_outside_data_untouched(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("INSTANCE_ID", "chain-b")
    monkeypatch.setenv("API_KEY", "test-key")
    users = tmp_path / "users.db"
    monkeypatch.setenv("USERS_DB_PATH", str(users))
    monkeypatch.setenv("PROMPT_LIBRARY_PATH", str(tmp_path / "prompt_library.json"))
    get_settings.cache_clear()
    s = Settings()
    assert s.users_db_path == users.resolve()
    assert s.prompt_library_path == (tmp_path / "prompt_library.json").resolve()
    get_settings.cache_clear()


def test_meta_mode_disables_host_services(monkeypatch):
    monkeypatch.setenv("INSTANCE_ID", "meta")
    monkeypatch.setenv("ENABLE_GENERATION", "false")
    monkeypatch.setenv("HOST_SERVICES_ENABLED", "true")
    monkeypatch.setenv("API_KEY", "test-key")
    get_settings.cache_clear()
    s = Settings()
    assert s.enable_generation is False
    assert s.host_services_enabled is False
    get_settings.cache_clear()
