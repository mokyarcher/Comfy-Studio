from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parent.parent
_LEGACY_DATA_ROOT = (PROJECT_ROOT / "data").resolve()

# Runtime / user content under data/ — namespaced by INSTANCE_ID.
_INSTANCE_PATH_FIELDS = (
    "database_path",
    "image_output_dir",
    "showcase_db_path",
    "showcase_files_dir",
    "cloud_gallery_db_path",
    "cloud_gallery_files_dir",
    "prompt_library_path",
    "shared_prompts_db_path",
    "translate_cache_db_path",
    "polish_quota_db_path",
    "users_db_path",
    "admin_sms_db_path",
    "email_reset_db_path",
    "works_db_path",
)


def sanitize_instance_id(raw: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9._-]+", "-", (raw or "default").strip())
    s = s.strip(".-")[:64]
    return s or "default"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "127.0.0.1"
    port: int = 8000

    # Isolates user content when multiple product chains share one host/tunnel.
    # Paths under data/ (not already under data/instances/) relocate to
    # data/instances/{INSTANCE_ID}/…
    instance_id: str = "default"
    # False = cloud meta data plane (auth / prompts / gallery / showcase / works).
    # Generation + ComfyUI stay on the GPU machine (ENABLE_GENERATION=true).
    enable_generation: bool = True

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
    cloud_gallery_db_path: Path = PROJECT_ROOT / "data" / "cloud_gallery.db"
    cloud_gallery_files_dir: Path = PROJECT_ROOT / "data" / "cloud_gallery"
    prompt_library_path: Path = PROJECT_ROOT / "data" / "prompt_library.json"
    shared_prompts_db_path: Path = PROJECT_ROOT / "data" / "shared_prompts.db"
    translate_cache_db_path: Path = PROJECT_ROOT / "data" / "translate_cache.db"
    works_db_path: Path = PROJECT_ROOT / "data" / "works.db"
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

    # Comma-separated browser origins for CORS (Web Studio / marketing site).
    # Empty = CORS middleware disabled (desktop / same-origin proxy only).
    cors_origins: str = (
        "https://comfy-studio.sharex.team,"
        "https://app.comfy-studio.sharex.team,"
        "https://comfy-gateway.sharex.team,"
        "http://localhost:5173,"
        "http://127.0.0.1:5173,"
        "http://localhost:5174,"
        "http://127.0.0.1:5174"
    )

    # --- Host service control (Gateway Web admin: start/stop ComfyUI / FRP / LHM) ---
    host_services_enabled: bool = True
    host_comfy_dir: Path | None = None
    host_comfy_launch: str = (
        ".venv\\Scripts\\python.exe main.py --listen 127.0.0.1 --port 8188"
    )
    host_frpc_path: Path | None = None
    host_frpc_config_path: Path | None = None
    # LibreHardwareMonitor.exe — Remote Web Server must be enabled once in the UI
    host_lhm_path: Path | None = None

    # LibreHardwareMonitor metrics (loopback only; FastAPI proxies a summary)
    lhm_url: str = "http://127.0.0.1:8085"
    lhm_timeout_seconds: float = 2.5

    # --- User email (register / bind / password reset) ---
    email_reset_db_path: Path = PROJECT_ROOT / "data" / "email_reset.db"
    mail_dry_run: bool = True
    mail_smtp_host: str = ""
    mail_smtp_port: int = 587
    mail_smtp_user: str = ""
    mail_smtp_password: str = ""
    mail_from: str = ""
    mail_use_tls: bool = True
    mail_cooldown_seconds: int = 60
    mail_daily_limit: int = 10
    mail_otp_ttl_seconds: int = 300

    # --- Gateway admin login (remote console) ---
    # totp = password + Authenticator (recommended; no SMS vendor)
    # sms = phone OTP via tencent/aliyun
    admin_login_mode: str = "totp"
    admin_password: str = ""
    admin_totp_secret: str = ""
    admin_phone: str = ""
    admin_session_secret: str = Field(default="")
    admin_session_ttl_seconds: int = 12 * 3600
    admin_sms_db_path: Path = PROJECT_ROOT / "data" / "admin_sms.db"
    sms_cooldown_seconds: int = 60
    sms_daily_limit: int = 10
    sms_otp_ttl_seconds: int = 300
    # SMS provider when admin_login_mode=sms: tencent | aliyun
    sms_provider: str = "tencent"
    sms_dry_run: bool = False
    sms_sign_name: str = ""
    # Tencent Cloud SMS (https://console.cloud.tencent.com/smsv2)
    sms_secret_id: str = ""
    sms_secret_key: str = ""
    sms_sdk_app_id: str = ""
    sms_template_id: str = ""
    sms_region: str = "ap-guangzhou"
    # Aliyun Dysmsapi (optional)
    sms_access_key_id: str = ""
    sms_access_key_secret: str = ""
    sms_template_code: str = ""
    sms_region_id: str = "cn-hangzhou"

    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def safe_instance_id(self) -> str:
        return sanitize_instance_id(self.instance_id)

    @property
    def instance_data_dir(self) -> Path:
        return (_LEGACY_DATA_ROOT / "instances" / self.safe_instance_id).resolve()

    @field_validator("polish_ai_base_url")
    @classmethod
    def _strip_polish_base(cls, value: str) -> str:
        return value.rstrip("/")

    @field_validator("instance_id")
    @classmethod
    def _normalize_instance_id(cls, value: str) -> str:
        return sanitize_instance_id(value)

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
        "cloud_gallery_db_path",
        "cloud_gallery_files_dir",
        "admin_sms_db_path",
        "email_reset_db_path",
        "works_db_path",
        mode="before",
    )
    @classmethod
    def _resolve_path(cls, value: str | Path) -> Path:
        path = Path(value)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path.resolve()

    @field_validator(
        "comfy_input_dir",
        "comfy_output_dir",
        "host_comfy_dir",
        "host_frpc_path",
        "host_frpc_config_path",
        "host_lhm_path",
        mode="before",
    )
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

    @model_validator(mode="after")
    def _namespace_instance_data_paths(self) -> Settings:
        """Relocate legacy data/* paths into data/instances/{INSTANCE_ID}/."""
        root = self.instance_data_dir
        for name in _INSTANCE_PATH_FIELDS:
            path: Path = getattr(self, name)
            try:
                rel = path.resolve().relative_to(_LEGACY_DATA_ROOT)
            except ValueError:
                # Absolute path outside repo data/ (tests, custom mounts) — keep.
                continue
            parts = rel.parts
            if parts and parts[0] == "instances":
                continue
            object.__setattr__(self, name, (root / rel).resolve())

        if not self.enable_generation:
            object.__setattr__(self, "host_services_enabled", False)
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
