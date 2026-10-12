from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "127.0.0.1"
    port: int = 8000

    comfyui_url: str = "http://127.0.0.1:8188"
    comfyui_timeout_seconds: float = 30.0
    comfyui_poll_interval_seconds: float = 1.5
    comfyui_job_timeout_seconds: float = 900.0
    # Wan / image_to_video jobs are slower (~200s typical); allow a dedicated ceiling.
    comfyui_video_job_timeout_seconds: float = 400.0

    api_key: str = Field(default="change-me-to-a-long-random-string")

    database_path: Path = PROJECT_ROOT / "data" / "tasks.db"
    image_output_dir: Path = PROJECT_ROOT / "data" / "images"
    showcase_db_path: Path = PROJECT_ROOT / "data" / "showcase.db"
    showcase_files_dir: Path = PROJECT_ROOT / "data" / "showcase"
    prompt_library_path: Path = PROJECT_ROOT / "data" / "prompt_library.json"
    shared_prompts_db_path: Path = PROJECT_ROOT / "data" / "shared_prompts.db"
    translate_cache_db_path: Path = PROJECT_ROOT / "data" / "translate_cache.db"
    workflow_path: Path = PROJECT_ROOT / "llm_workflow" / "workflow_api.json"
    workflow_mapping_path: Path = PROJECT_ROOT / "llm_workflow" / "workflow_mapping.json"
    # Optional second workflow: Qwen Image Edit (multi-reference image edit)
    image_edit_workflow_path: Path = (
        PROJECT_ROOT / "llm_workflow" / "workflow_image_edit_api.json"
    )
    image_edit_workflow_mapping_path: Path = (
        PROJECT_ROOT / "llm_workflow" / "workflow_image_edit_mapping.json"
    )
    # Optional: Wan 2.2 TI2V image-to-video
    image_to_video_workflow_path: Path = (
        PROJECT_ROOT / "llm_workflow" / "workflow_image_to_video_api.json"
    )
    image_to_video_workflow_mapping_path: Path = (
        PROJECT_ROOT / "llm_workflow" / "workflow_image_to_video_mapping.json"
    )
    max_video_length: int = 161
    # Upload limits for /v1/images/upload
    max_upload_bytes: int = 15 * 1024 * 1024
    max_edit_images: int = 10

    max_queue_size: int = 20
    max_prompt_length: int = 2000
    max_negative_prompt_length: int = 2000
    # Image modes (txt2img / image_edit): each side ≤ 1024
    max_width: int = 1024
    max_height: int = 1024
    max_image_pixels: int = 1_048_576  # 1024²
    # Video (image_to_video): landscape ≤ 800×496, portrait ≤ 496×800
    # (500 is not a multiple of size_multiple; use 496 as the ≤500 ceiling)
    max_video_long_side: int = 800
    max_video_short_side: int = 496
    max_steps: int = 60
    size_multiple: int = 8

    enable_docs: bool = True
    # Orphan purge for succeeded tasks not yet purged by client (0 = disabled)
    image_retention_days: int = 7
    # Local ComfyUI folders on the API host (for privacy purge). Empty = skip file delete.
    comfy_input_dir: Path | None = None
    comfy_output_dir: Path | None = None
    # How often the retention sweeper runs (seconds)
    retention_sweep_interval_seconds: float = 3600.0

    # --- AI prompt polish gateway (Option B: server holds upstream key) ---
    polish_enabled: bool = False
    polish_ai_base_url: str = "https://api.deepseek.com"
    polish_ai_api_key: str = ""
    polish_ai_model: str = "deepseek-chat"
    polish_ai_timeout_seconds: float = 60.0
    # Daily polish calls per Studio API key fingerprint; 0 = unlimited
    polish_daily_limit: int = 200
    # Per-minute polish calls per key; 0 = unlimited
    polish_rate_per_minute: int = 20
    polish_quota_db_path: Path = PROJECT_ROOT / "data" / "polish_quota.db"
    users_db_path: Path = PROJECT_ROOT / "data" / "users.db"
    # Default per-user limits when approving registered users
    default_daily_generate_limit: int = 50
    default_daily_polish_limit: int = 200
    # Max non-admin users that may hold an API key (pool remaining = this - approved)
    max_approved_users: int = 20
    # Consider user "active" if seen within this many minutes
    active_user_window_minutes: int = 15

    @field_validator("polish_ai_base_url")
    @classmethod
    def _strip_polish_base(cls, value: str) -> str:
        return value.rstrip("/")

    @field_validator(
        "database_path",
        "image_output_dir",
        "showcase_db_path",
        "showcase_files_dir",
        "prompt_library_path",
        "shared_prompts_db_path",
        "translate_cache_db_path",
        "workflow_path",
        "workflow_mapping_path",
        "image_edit_workflow_path",
        "image_edit_workflow_mapping_path",
        "image_to_video_workflow_path",
        "image_to_video_workflow_mapping_path",
        "polish_quota_db_path",
        "users_db_path",
        mode="before",
    )
    @classmethod
    def _resolve_path(cls, value: str | Path) -> Path:
        path = Path(value)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path.resolve()

    @field_validator("comfy_input_dir", "comfy_output_dir", mode="before")
    @classmethod
    def _optional_comfy_dir(cls, value: str | Path | None) -> Path | None:
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        path = Path(value)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path.resolve()

    @field_validator("comfyui_url")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()
