from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.config import get_settings


class TaskStatus(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    purged = "purged"


class GenerateImageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # txt2img | image_edit (Qwen) | image_to_video (Wan TI2V)
    mode: Literal["txt2img", "image_edit", "image_to_video"] = "txt2img"
    prompt: str = Field(..., min_length=1)
    negative_prompt: str | None = None
    width: int | None = None
    height: int | None = None
    steps: int | None = None
    seed: int | None = None
    # Frame count for image_to_video (Wan length; typically 4n+1)
    length: int | None = None
    # ComfyUI input filenames (from POST /v1/images/upload), order = image_1..image_N
    images: list[str] | None = None

    @field_validator("prompt")
    @classmethod
    def _validate_prompt(cls, value: str) -> str:
        settings = get_settings()
        value = value.strip()
        if not value:
            raise ValueError("prompt must not be empty")
        if len(value) > settings.max_prompt_length:
            raise ValueError(f"prompt exceeds max length {settings.max_prompt_length}")
        return value

    @field_validator("negative_prompt")
    @classmethod
    def _validate_negative(cls, value: str | None) -> str | None:
        if value is None:
            return None
        settings = get_settings()
        value = value.strip()
        if len(value) > settings.max_negative_prompt_length:
            raise ValueError(
                f"negative_prompt exceeds max length {settings.max_negative_prompt_length}"
            )
        return value

    @field_validator("width", "height")
    @classmethod
    def _validate_size(cls, value: int | None, info) -> int | None:
        if value is None:
            return None
        settings = get_settings()
        name = info.field_name
        max_value = settings.max_width if name == "width" else settings.max_height
        if value < settings.size_multiple or value > max_value:
            raise ValueError(f"{name} must be between {settings.size_multiple} and {max_value}")
        if value % settings.size_multiple != 0:
            raise ValueError(f"{name} must be a multiple of {settings.size_multiple}")
        return value

    @field_validator("steps")
    @classmethod
    def _validate_steps(cls, value: int | None) -> int | None:
        if value is None:
            return None
        settings = get_settings()
        if value < 1 or value > settings.max_steps:
            raise ValueError(f"steps must be between 1 and {settings.max_steps}")
        return value

    @field_validator("seed")
    @classmethod
    def _validate_seed(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value < 0 or value > 2**63 - 1:
            raise ValueError("seed must be between 0 and 2^63-1")
        return value

    @field_validator("length")
    @classmethod
    def _validate_length(cls, value: int | None) -> int | None:
        if value is None:
            return None
        settings = get_settings()
        if value < 1 or value > settings.max_video_length:
            raise ValueError(f"length must be between 1 and {settings.max_video_length}")
        return value

    @field_validator("images")
    @classmethod
    def _validate_images(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        settings = get_settings()
        if len(value) > settings.max_edit_images:
            raise ValueError(f"images accepts at most {settings.max_edit_images} items")
        cleaned: list[str] = []
        for item in value:
            name = (item or "").strip()
            if not name:
                raise ValueError("images entries must be non-empty filenames")
            if "/" in name or "\\" in name or ".." in name:
                raise ValueError("images filenames must not contain path separators")
            cleaned.append(name)
        return cleaned

    @model_validator(mode="after")
    def _validate_pixels(self) -> GenerateImageRequest:
        settings = get_settings()
        width = self.width
        height = self.height
        if width is not None and height is not None:
            if self.mode == "image_to_video":
                long_side = max(width, height)
                short_side = min(width, height)
                if (
                    long_side > settings.max_video_long_side
                    or short_side > settings.max_video_short_side
                ):
                    raise ValueError(
                        "video size must fit within "
                        f"{settings.max_video_long_side}×{settings.max_video_short_side} "
                        f"(or {settings.max_video_short_side}×{settings.max_video_long_side})"
                    )
            else:
                if width > settings.max_width or height > settings.max_height:
                    raise ValueError(
                        f"width/height must be ≤ {settings.max_width}×{settings.max_height}"
                    )
                if width * height > settings.max_image_pixels:
                    raise ValueError(
                        f"width*height exceeds max pixels {settings.max_image_pixels}"
                    )
        if self.mode in ("image_edit", "image_to_video"):
            if not self.images:
                raise ValueError(
                    f"images is required for mode={self.mode} (at least image_1)"
                )
        elif self.images:
            raise ValueError("images is only allowed for image_edit / image_to_video")
        if self.length is not None and self.mode != "image_to_video":
            raise ValueError("length is only allowed when mode=image_to_video")
        return self


class UploadImageResponse(BaseModel):
    filename: str
    subfolder: str = ""
    image_type: str = "input"


class WorkflowModesResponse(BaseModel):
    modes: list[str]
    default: str = "txt2img"


class PurgeTaskResponse(BaseModel):
    task_id: str
    status: TaskStatus = TaskStatus.purged
    deleted_api_images: int = 0
    deleted_comfy_inputs: int = 0
    deleted_comfy_outputs: int = 0
    history_cleared: bool = False
    comfy_dirs_configured: bool = False
    message: str = "purged"


class ShowcaseItemResponse(BaseModel):
    id: str
    author_name: str
    author_username: str
    status: str
    prompt: str
    negative_prompt: str | None = None
    mode: str = "txt2img"
    width: int
    height: int
    steps: int
    seed: int | None = None
    ref_count: int = 0
    elapsed_ms: int | None = None
    created_at: str
    updated_at: str
    image_url: str
    thumb_url: str = ""
    ref_urls: list[str] = Field(default_factory=list)
    mine: bool = False


class ShowcaseListResponse(BaseModel):
    items: list[ShowcaseItemResponse]
    count: int


class CloudGalleryItemResponse(BaseModel):
    id: str
    prompt: str
    negative_prompt: str | None = None
    mode: str = "txt2img"
    width: int
    height: int
    steps: int
    seed: int | None = None
    mime_type: str = "image/png"
    created_at: str
    updated_at: str
    image_url: str
    thumb_url: str = ""


class CloudGalleryListResponse(BaseModel):
    items: list[CloudGalleryItemResponse]
    count: int


class GenerateImageResponse(BaseModel):
    task_id: str
    status: TaskStatus
    # 1 = currently running or next; ahead = how many jobs before yours
    queue_position: int | None = None
    queue_ahead: int | None = None
    queue_size: int | None = None
    max_queue_size: int | None = None


class TaskProgress(BaseModel):
    """ComfyUI sampler progress from WS `progress` (value/max)."""

    value: int
    max: int
    percent: float


class TaskStatusResponse(BaseModel):
    task_id: str
    status: TaskStatus
    created_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    seed: int | None = None
    error_code: str | None = None
    error_message: str | None = None
    queue_position: int | None = None
    queue_ahead: int | None = None
    queue_size: int | None = None
    max_queue_size: int | None = None
    # Present while running and ComfyUI has emitted at least one progress tick
    progress: TaskProgress | None = None


class ImageMeta(BaseModel):
    index: int
    filename: str
    content_type: str
    url: str


class TaskResultResponse(BaseModel):
    task_id: str
    status: TaskStatus
    seed: int | None = None
    images: list[ImageMeta] = Field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None


class HealthLiveResponse(BaseModel):
    status: str = "ok"


class HealthReadyResponse(BaseModel):
    status: str
    comfyui: str
    # Deploy limits from .env — Studio clamps UI to these after connection check
    max_steps: int = 60
    max_width: int = 1024
    max_height: int = 1024


class ErrorResponse(BaseModel):
    detail: Any


class PromptPolishConflict(BaseModel):
    code: str = "ai_conflict"
    message: str
    severity: str = "warning"


class PromptPolishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(..., min_length=1)
    negative_prompt: str | None = None
    output_language: str = "match_input"
    detail: str = "standard"
    model_profile: str = "unknown"
    # Generation mode from Studio Create draft (not polish provider mode).
    generation_mode: Literal["txt2img", "image_edit", "image_to_video"] = "txt2img"

    @field_validator("prompt")
    @classmethod
    def _prompt(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("prompt must not be empty")
        settings = get_settings()
        if len(value) > settings.max_prompt_length:
            raise ValueError(f"prompt exceeds max length {settings.max_prompt_length}")
        return value

    @field_validator("output_language")
    @classmethod
    def _lang(cls, value: str) -> str:
        if value not in ("match_input", "zh", "en"):
            raise ValueError("output_language must be match_input|zh|en")
        return value

    @field_validator("detail")
    @classmethod
    def _detail(cls, value: str) -> str:
        if value not in ("concise", "standard", "detailed"):
            raise ValueError("detail must be concise|standard|detailed")
        return value

    @field_validator("model_profile")
    @classmethod
    def _profile(cls, value: str) -> str:
        if value not in ("sd15", "sdxl", "flux", "sd3", "wan", "unknown"):
            raise ValueError("model_profile invalid")
        return value


class PromptPolishQuota(BaseModel):
    daily_limit: int
    daily_used: int
    daily_remaining: int
    per_minute_limit: int
    minute_used: int


class PromptPolishResponse(BaseModel):
    enhanced_prompt: str
    enhanced_negative_prompt: str | None = None
    added_details: list[str] = Field(default_factory=list)
    preserved_constraints: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    conflicts: list[PromptPolishConflict] = Field(default_factory=list)
    matched_categories: list[str] = Field(default_factory=list)
    model_profile: str = "unknown"
    output_language: str = "match_input"
    provider: str = "gateway"
    quota: PromptPolishQuota | None = None


class PromptPolishStatusResponse(BaseModel):
    enabled: bool
    configured: bool
    model: str | None = None
    quota: PromptPolishQuota | None = None
    message: str


class AuthRegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(..., min_length=3, max_length=32)
    password: str = Field(..., min_length=6, max_length=128)
    display_name: str = Field(default="", max_length=64)


class AuthLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(..., min_length=1, max_length=32)
    password: str = Field(..., min_length=1, max_length=128)


class AuthRegisterResponse(BaseModel):
    user_id: str
    username: str
    status: str
    message: str


class AuthLoginResponse(BaseModel):
    user_id: str
    username: str
    name: str
    api_key: str
    daily_generate_limit: int
    daily_polish_limit: int
    status: str


class AuthChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    old_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=6, max_length=128)


class AuthChangePasswordResponse(BaseModel):
    ok: bool = True
    message: str = "密码已修改"


class AdminTotpLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: str = Field(..., min_length=1, max_length=128)
    totp_code: str = Field(..., min_length=6, max_length=8)


class AdminTotpLoginResponse(BaseModel):
    ok: bool = True
    message: str = "登录成功"
    via: str = "totp"


class SmsSendRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    phone: str = Field(..., min_length=11, max_length=20)


class SmsSendResponse(BaseModel):
    ok: bool = True
    message: str = "验证码已发送"
    cooldown_seconds: int = 60


class SmsVerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    phone: str = Field(..., min_length=11, max_length=20)
    code: str = Field(..., min_length=4, max_length=8)


class SmsVerifyResponse(BaseModel):
    ok: bool = True
    message: str = "登录成功"
    phone_masked: str = ""


class AuthMeResponse(BaseModel):
    ok: bool = True
    role: str = "admin"
    phone_masked: str = ""
    username: str = ""
    via: str = "session"


class AdminResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # If omitted, server generates a temporary password
    password: str | None = Field(default=None, min_length=6, max_length=128)


class AdminResetPasswordResponse(BaseModel):
    id: str
    username: str
    temporary_password: str
    message: str


class AdminDeleteUserResponse(BaseModel):
    ok: bool = True
    id: str
    username: str
    message: str = "已注销用户并清除相关数据"
    cloud_gallery_deleted: int = 0
    showcase_deleted: int = 0
    shared_prompts_deleted: int = 0


class AdminPatchUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    enabled: bool | None = None
    daily_generate_limit: int | None = None
    daily_polish_limit: int | None = None
    note: str | None = None


class LocalHoldResponse(BaseModel):
    held: bool
    message: str = ""
    expires_at: str | None = None
    updated_at: str | None = None


class LocalHoldSetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    held: bool
    ttl_seconds: int | None = Field(default=None, ge=60, le=24 * 3600)
    message: str | None = Field(default=None, max_length=200)


class GpuStatusResponse(BaseModel):
    """Lightweight GPU / queue load for Studio clients (any authenticated user)."""

    state: Literal["idle", "busy"]
    queue_running: int = 0
    queue_queued: int = 0
    local_hold: bool = False


class AdminStatsResponse(BaseModel):
    queue_open: int
    queue_queued: int
    queue_running: int
    max_queue_size: int
    generate_today: int
    polish_today: int
    active_users_15m: int
    users_total: int
    users_enabled: int
    polish_enabled: bool
    pending_users: int = 0
    pool_remaining: int = 0
    max_approved_users: int = 0
    approved_users: int = 0
    local_hold: bool = False
    local_hold_expires_at: str | None = None


class HostServiceItem(BaseModel):
    id: str
    label: str
    ok: bool
    state: str
    message: str
    pid: int | None = None
    configured: bool = True
    detail: str = ""


class HostServicesResponse(BaseModel):
    enabled: bool
    services: list[HostServiceItem]


class HostServiceActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    service: Literal["comfy", "api", "frp"]
    action: Literal["start", "stop", "force_stop", "restart"]
    # Re-auth: Authenticator 6-digit code required for every start/stop/restart
    totp_code: str = Field(..., min_length=6, max_length=8)


class HostServiceActionResponse(BaseModel):
    ok: bool
    message: str
    services: list[HostServiceItem] = Field(default_factory=list)


class AdminUserResponse(BaseModel):
    id: str
    name: str
    username: str = ""
    status: str = "active"
    api_key_prefix: str
    enabled: bool
    is_admin: bool
    daily_generate_limit: int
    daily_polish_limit: int
    generate_today: int
    polish_today: int
    note: str
    created_at: str
    last_seen_at: str | None = None
    # Only present on rotate (admin debugging)
    api_key: str | None = None


class PromptLibraryTemplate(BaseModel):
    id: str
    title: str
    prompt: str
    negative_prompt: str = ""
    tags: list[str] = Field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""


class PromptLibraryPhrase(BaseModel):
    id: str
    text: str
    category: str = "通用"


class PromptLibraryResponse(BaseModel):
    version: int
    updated_at: str
    templates: list[PromptLibraryTemplate] = Field(default_factory=list)
    phrases: list[PromptLibraryPhrase] = Field(default_factory=list)


class PromptLibraryReplaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    templates: list[PromptLibraryTemplate] = Field(default_factory=list)
    phrases: list[PromptLibraryPhrase] = Field(default_factory=list)


class PromptTranslateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=4000)
    # en2zh default keeps「查看译文」compatible; zh2en for create-page draft translate
    direction: Literal["en2zh", "zh2en"] = "en2zh"

    @field_validator("text")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        return value.strip()


class PromptTranslateResponse(BaseModel):
    translation: str
    # Echo original so clients can verify cache keys
    source: str = ""
    direction: Literal["en2zh", "zh2en"] = "en2zh"


class SharedPromptItemResponse(BaseModel):
    id: str
    title: str
    prompt: str
    negative_prompt: str | None = None
    tags: list[str] = Field(default_factory=list)
    author_name: str
    author_username: str
    created_at: str
    mine: bool = False


class SharedPromptListResponse(BaseModel):
    items: list[SharedPromptItemResponse]
    count: int


class SharedPromptShareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str = Field(default="", max_length=4000)
    tags: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("title", "prompt", "negative_prompt")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("tags")
    @classmethod
    def _clean_tags(cls, value: list[str]) -> list[str]:
        out: list[str] = []
        for tag in value:
            t = str(tag).strip()
            if t and t not in out:
                out.append(t[:40])
            if len(out) >= 12:
                break
        return out
