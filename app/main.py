from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator, Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import mimetypes
import uuid
from pathlib import PurePosixPath, Path

from app.auth import AuthContext, normalize_admin_phone, require_admin_access, require_auth, verify_api_key
from app.comfy_client import ComfyClient, ComfyClientError
from app.config import Settings, get_settings
from app.database import Database
from app.host_services import run_action as host_service_run_action
from app.host_services import status_all as host_services_status
from app.local_hold import local_hold
from app.logging_config import setup_logging
from app.polish_quota import PolishQuotaStore
from app.prompt_library_store import PromptLibraryStore
from app.prompt_polish_service import PromptPolishError, polish_via_upstream
from app.prompt_translate_service import translate_via_upstream, worth_translating
from app.translate_cache_store import TranslateCacheStore
from app.schemas import (
    AdminPatchUserRequest,
    AdminStatsResponse,
    AdminUserResponse,
    AdminDeleteUserResponse,
    AdminResetPasswordRequest,
    AdminResetPasswordResponse,
    AuthBindEmailRequest,
    AuthBindEmailResponse,
    AuthChangePasswordRequest,
    AuthChangePasswordResponse,
    AuthLoginRequest,
    AuthLoginResponse,
    AuthMeResponse,
    AuthPasswordResetRequest,
    AuthPasswordResetResponse,
    AuthPasswordResetSendRequest,
    AuthPasswordResetSendResponse,
    AuthProfileResponse,
    AuthRegisterRequest,
    AuthRegisterResponse,
    InternalAuthResolveRequest,
    InternalAuthResolveResponse,
    AdminTotpLoginRequest,
    AdminTotpLoginResponse,
    SmsSendRequest,
    SmsSendResponse,
    SmsVerifyRequest,
    SmsVerifyResponse,
    GenerateImageRequest,
    GenerateImageResponse,
    GpuStatusResponse,
    ComfyControlResponse,
    ComfyCooldownStatusResponse,
    ComfyFreeRequest,
    HostMetricsResponse,
    HealthLiveResponse,
    HealthReadyResponse,
    HostServiceActionRequest,
    HostServiceActionResponse,
    HostServiceItem,
    HostServicesResponse,
    LocalHoldResponse,
    LocalHoldSetRequest,
    PromptLibraryPhrase,
    PromptLibraryReplaceRequest,
    PromptLibraryResponse,
    PromptLibraryTemplate,
    SharedPromptItemResponse,
    SharedPromptListResponse,
    SharedPromptShareRequest,
    UploadImageResponse,
    WorkflowInfoResponse,
    WorkflowListResponse,
    WorkflowModesResponse,
    PurgeTaskResponse,
    CloudGalleryItemResponse,
    CloudGalleryListResponse,
    WorkItemResponse,
    WorkListResponse,
    WorkCreateRequest,
    ShowcaseCommentCreateRequest,
    ShowcaseCommentListResponse,
    ShowcaseCommentResponse,
    ShowcaseEngagementResponse,
    ShowcaseItemResponse,
    ShowcaseListResponse,
    PromptPolishQuota,
    PromptPolishRequest,
    PromptPolishResponse,
    PromptPolishStatusResponse,
    PromptTranslateRequest,
    PromptTranslateResponse,
    TaskResultResponse,
    TaskStatus,
    TaskStatusResponse,
)
from app.shared_prompt_store import SharedPromptStore
from app.user_store import STATUS_ACTIVE, STATUS_DISABLED, STATUS_PENDING, STATUS_REJECTED
from app.task_service import (
    QueueFullError,
    TaskService,
    UnknownWorkflowError,
    UnsupportedModeError,
)
from app.user_store import UserStore
from app.cloud_gallery_store import CloudGalleryStore
from app.showcase_store import ShowcaseStore
from app.works_store import WorksStore
from app.sms_auth import (
    COOKIE_NAME,
    SmsAuthStore,
    generate_otp_code,
    normalize_cn_phone,
    send_aliyun_sms,
    send_tencent_sms,
)
from app.totp import verify_totp
from app import admin_step_up
from app.email_auth import EmailResetStore, generate_otp_code, send_reset_email
from app.user_store import normalize_email
import secrets as _secrets
from app.workflow import WorkflowError, WorkflowRegistry, load_workflow_registry
from app.worker import TaskWorker

_ALLOWED_UPLOAD_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
_SHOWCASE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
_CLOUD_GALLERY_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm"}

logger = logging.getLogger(__name__)


class AppState:
    settings: Settings
    db: Database | None
    comfy: ComfyClient | None
    registry: WorkflowRegistry
    task_service: TaskService | None
    worker: TaskWorker | None
    polish_quota: PolishQuotaStore
    user_store: UserStore
    showcase: ShowcaseStore
    cloud_gallery: CloudGalleryStore
    works: WorksStore
    sms_auth: SmsAuthStore
    email_reset: EmailResetStore
    prompt_library: PromptLibraryStore
    shared_prompts: SharedPromptStore
    translate_cache: TranslateCacheStore
    retention_task: asyncio.Task[None] | None = None


state = AppState()


async def _retention_loop() -> None:
    interval = max(60.0, float(state.settings.retention_sweep_interval_seconds))
    while True:
        try:
            await asyncio.sleep(interval)
            if state.task_service is not None:
                await state.task_service.purge_stale_tasks()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Retention sweep failed")


def _require_generation() -> None:
    if not state.settings.enable_generation or state.task_service is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="generation disabled on this instance (meta data plane)",
        )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    setup_logging()
    settings = get_settings()
    state.settings = settings
    settings.instance_data_dir.mkdir(parents=True, exist_ok=True)

    if settings.enable_generation:
        try:
            registry = load_workflow_registry(
                txt2img_workflow=settings.workflow_path,
                txt2img_mapping=settings.workflow_mapping_path,
                image_edit_workflow=settings.image_edit_workflow_path,
                image_edit_mapping=settings.image_edit_workflow_mapping_path,
                image_to_video_workflow=settings.image_to_video_workflow_path,
                image_to_video_mapping=settings.image_to_video_workflow_mapping_path,
            )
        except WorkflowError:
            logger.exception("Failed to load workflow/mapping")
            raise
        settings.image_output_dir.mkdir(parents=True, exist_ok=True)
        state.db = Database(settings.database_path)
        state.comfy = ComfyClient(settings)
        state.registry = registry
        state.task_service = TaskService(settings, state.db, registry, state.comfy)
        local_hold.clear()
        state.worker = TaskWorker(
            state.db, state.task_service, hold_checker=local_hold.is_held
        )
    else:
        state.db = None
        state.comfy = None
        state.registry = WorkflowRegistry()
        state.task_service = None
        state.worker = None
        logger.info(
            "Meta data plane (ENABLE_GENERATION=false) instance_id=%s dir=%s",
            settings.safe_instance_id,
            settings.instance_data_dir,
        )

    state.polish_quota = PolishQuotaStore(settings.polish_quota_db_path)
    state.user_store = UserStore(settings.users_db_path)
    state.showcase = ShowcaseStore(settings.showcase_db_path, settings.showcase_files_dir)
    state.cloud_gallery = CloudGalleryStore(
        settings.cloud_gallery_db_path, settings.cloud_gallery_files_dir
    )
    state.works = WorksStore(settings.works_db_path)
    state.sms_auth = SmsAuthStore(
        settings.admin_sms_db_path,
        signing_secret=(settings.admin_session_secret or settings.api_key).strip(),
    )
    state.email_reset = EmailResetStore(settings.email_reset_db_path)
    state.prompt_library = PromptLibraryStore(settings.prompt_library_path)
    state.shared_prompts = SharedPromptStore(settings.shared_prompts_db_path)
    state.translate_cache = TranslateCacheStore(settings.translate_cache_db_path)
    boot = state.user_store.ensure_bootstrap_admin(settings.api_key)
    if boot:
        logger.info("Bootstrapped admin user id=%s from .env API_KEY", boot.id)
    app.state.user_store = state.user_store
    app.state.settings = settings
    app.state.sms_auth = state.sms_auth
    if state.worker is not None:
        await state.worker.start()
    state.retention_task = None
    if settings.enable_generation and settings.image_retention_days > 0:
        state.retention_task = asyncio.create_task(_retention_loop())
    logger.info(
        "API listening on %s:%s instance=%s generation=%s polish=%s users=%s modes=%s",
        settings.host,
        settings.port,
        settings.safe_instance_id,
        settings.enable_generation,
        settings.polish_enabled,
        len(state.user_store.list_users()),
        ",".join(state.registry.modes) or "(none)",
    )
    try:
        yield
    finally:
        if state.retention_task is not None:
            state.retention_task.cancel()
            try:
                await state.retention_task
            except asyncio.CancelledError:
                pass
            state.retention_task = None
        if state.worker is not None:
            await state.worker.stop()
        if state.comfy is not None:
            await state.comfy.aclose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="ComfyUI Image API",
        version="1.0.0",
        docs_url="/docs" if settings.enable_docs else None,
        redoc_url="/redoc" if settings.enable_docs else None,
        openapi_url="/openapi.json" if settings.enable_docs else None,
        lifespan=lifespan,
    )

    cors_origins = settings.cors_origin_list()
    if cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type", "Accept", "X-API-Key"],
            expose_headers=["Content-Type", "Content-Length"],
            max_age=600,
        )

    @app.get("/health/live", response_model=HealthLiveResponse, tags=["health"])
    async def health_live() -> HealthLiveResponse:
        return HealthLiveResponse()

    @app.get("/health/ready", response_model=HealthReadyResponse, tags=["health"])
    async def health_ready() -> HealthReadyResponse:
        s = state.settings
        if not s.enable_generation or state.comfy is None:
            return HealthReadyResponse(
                status="ready",
                comfyui="meta",
                max_steps=s.max_steps,
                max_width=s.max_width,
                max_height=s.max_height,
            )
        ok = await state.comfy.ping()
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"status": "not_ready", "comfyui": "down"},
            )
        return HealthReadyResponse(
            status="ready",
            comfyui="up",
            max_steps=s.max_steps,
            max_width=s.max_width,
            max_height=s.max_height,
        )

    @app.post(
        "/v1/images/generate",
        response_model=GenerateImageResponse,
        status_code=status.HTTP_202_ACCEPTED,
        tags=["images"],
    )
    async def generate_image(
        body: GenerateImageRequest,
        auth: AuthContext = Depends(require_auth),
    ) -> GenerateImageResponse:
        _require_generation()
        if local_hold.is_held():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=local_hold.reject_detail(),
            )
        counts = state.user_store.counts_today(auth.user.id)
        limit = auth.user.daily_generate_limit
        if limit > 0 and counts.generate_today >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "code": "daily_generate_quota",
                    "message": f"今日生图次数已用完（{limit}）",
                    "generate_today": counts.generate_today,
                    "daily_generate_limit": limit,
                },
            )
        assert state.task_service is not None
        try:
            task = state.task_service.submit(body)
        except UnknownWorkflowError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "unknown_workflow", "message": str(exc)},
            ) from exc
        except UnsupportedModeError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "unsupported_mode", "message": str(exc)},
            ) from exc
        except QueueFullError as exc:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "code": "queue_full",
                    "message": str(exc),
                    "max_queue_size": state.settings.max_queue_size,
                },
            ) from exc
        state.user_store.record_usage(auth.user.id, "generate", {"task_id": task.task_id})
        q = state.db.queue_info(task.task_id)
        logger.info(
            "generate queued user=%s task=%s today=%s position=%s ahead=%s",
            auth.user.id,
            task.task_id,
            counts.generate_today + 1,
            q["queue_position"],
            q["queue_ahead"],
        )
        return GenerateImageResponse(
            task_id=task.task_id,
            status=TaskStatus.queued,
            queue_position=q["queue_position"],
            queue_ahead=q["queue_ahead"],
            queue_size=q["queue_size"],
            max_queue_size=state.settings.max_queue_size,
        )

    @app.get(
        "/v1/workflows/modes",
        response_model=WorkflowModesResponse,
        dependencies=[Depends(verify_api_key)],
        tags=["images"],
    )
    async def list_workflow_modes() -> WorkflowModesResponse:
        _require_generation()
        return WorkflowModesResponse(modes=state.registry.modes, default="txt2img")

    @app.get(
        "/v1/workflows",
        response_model=WorkflowListResponse,
        dependencies=[Depends(verify_api_key)],
        tags=["images"],
    )
    async def list_workflows(
        mode: Literal["txt2img", "image_edit", "image_to_video"] = "txt2img",
    ) -> WorkflowListResponse:
        """List concrete pipelines under a mode (from GPU plane, not Meta)."""
        _require_generation()
        if not state.registry.has(mode):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "unsupported_mode", "message": f"mode={mode!r} not loaded"},
            )
        items = state.registry.list_workflows(mode)
        return WorkflowListResponse(
            mode=mode,
            default=state.registry.default_id(mode),
            workflows=[
                WorkflowInfoResponse(
                    id=i.id,
                    display_name=i.display_name,
                    description=i.description,
                    default=i.default,
                    mode=i.mode,
                )
                for i in items
            ],
        )

    @app.post(
        "/v1/images/upload",
        response_model=UploadImageResponse,
        tags=["images"],
    )
    async def upload_image(
        file: UploadFile = File(...),
        auth: AuthContext = Depends(require_auth),
    ) -> UploadImageResponse:
        _require_generation()
        raw_name = file.filename or "upload.png"
        suffix = PurePosixPath(raw_name).suffix.lower()
        if suffix not in _ALLOWED_UPLOAD_SUFFIXES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "invalid_image_type",
                    "message": f"仅支持: {', '.join(sorted(_ALLOWED_UPLOAD_SUFFIXES))}",
                },
            )
        data = await file.read()
        if not data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "empty_file", "message": "上传文件为空"},
            )
        if len(data) > state.settings.max_upload_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail={
                    "code": "file_too_large",
                    "message": f"文件超过上限 {state.settings.max_upload_bytes} bytes",
                },
            )
        assert state.comfy is not None
        safe_name = f"studio_{auth.user.id[:8]}_{uuid.uuid4().hex[:12]}{suffix}"
        try:
            ref = await state.comfy.upload_image(
                data,
                safe_name,
                overwrite=True,
                content_type=file.content_type or "application/octet-stream",
            )
        except ComfyClientError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"code": exc.code, "message": str(exc)},
            ) from exc
        logger.info(
            "upload ok user=%s filename=%s bytes=%s",
            auth.user.id,
            ref.filename,
            len(data),
        )
        return UploadImageResponse(
            filename=ref.filename,
            subfolder=ref.subfolder,
            image_type=ref.image_type,
        )

    @app.get(
        "/v1/tasks/{task_id}",
        response_model=TaskStatusResponse,
        dependencies=[Depends(verify_api_key)],
        tags=["tasks"],
    )
    async def get_task(task_id: str) -> TaskStatusResponse:
        _require_generation()
        assert state.task_service is not None
        result = state.task_service.get_status(task_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return result

    @app.get(
        "/v1/tasks/{task_id}/result",
        response_model=TaskResultResponse,
        dependencies=[Depends(verify_api_key)],
        tags=["tasks"],
    )
    async def get_task_result(task_id: str) -> TaskResultResponse:
        _require_generation()
        assert state.task_service is not None
        result = state.task_service.get_result(task_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return result

    @app.get(
        "/v1/tasks/{task_id}/images/{image_index}",
        dependencies=[Depends(verify_api_key)],
        tags=["tasks"],
    )
    async def get_task_image(task_id: str, image_index: int) -> FileResponse:
        _require_generation()
        assert state.task_service is not None
        resolved = state.task_service.resolve_image_path(task_id, image_index)
        if resolved is None:
            raise HTTPException(status_code=404, detail="Image not found")
        path, record = resolved
        return FileResponse(
            path,
            media_type=record.content_type,
            filename=record.filename,
        )

    @app.post(
        "/v1/tasks/{task_id}/purge",
        response_model=PurgeTaskResponse,
        tags=["tasks"],
    )
    async def purge_task(
        task_id: str,
        auth: AuthContext = Depends(require_auth),
    ) -> PurgeTaskResponse:
        # Auth required so only logged-in clients can purge; task ids are UUIDs.
        _require_generation()
        assert state.task_service is not None
        _ = auth
        try:
            result = await state.task_service.purge_task(task_id)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "purge_not_allowed", "message": str(exc)},
            ) from exc
        if result is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return result

    def _showcase_response(item, *, mine: bool, user_id: str) -> ShowcaseItemResponse:
        eng = state.showcase.engagement_for(item.id, user_id)
        return ShowcaseItemResponse(**{**item.to_public_dict(mine=mine), **eng})

    def _showcase_list_response(items, *, user_id: str) -> ShowcaseListResponse:
        eng_map = state.showcase.engagement_batch([it.id for it in items], user_id)
        return ShowcaseListResponse(
            items=[
                ShowcaseItemResponse(
                    **{
                        **it.to_public_dict(mine=it.author_user_id == user_id),
                        **eng_map.get(it.id, {}),
                    }
                )
                for it in items
            ],
            count=len(items),
        )

    def _require_published_showcase(item_id: str, auth: AuthContext):
        item = state.showcase.get(item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Showcase item not found")
        mine = item.author_user_id == auth.user.id
        if item.status != "published" and not mine:
            raise HTTPException(status_code=404, detail="Showcase item not found")
        return item, mine

    @app.get(
        "/v1/showcase",
        response_model=ShowcaseListResponse,
        tags=["showcase"],
    )
    async def list_showcase(
        limit: int = 50,
        offset: int = 0,
        auth: AuthContext = Depends(require_auth),
    ) -> ShowcaseListResponse:
        items = state.showcase.list_published(limit=limit, offset=offset)
        return _showcase_list_response(items, user_id=auth.user.id)

    @app.get(
        "/v1/showcase/mine",
        response_model=ShowcaseListResponse,
        tags=["showcase"],
    )
    async def list_my_showcase(
        auth: AuthContext = Depends(require_auth),
    ) -> ShowcaseListResponse:
        items = state.showcase.list_by_author(auth.user.id)
        eng_map = state.showcase.engagement_batch([it.id for it in items], auth.user.id)
        return ShowcaseListResponse(
            items=[
                ShowcaseItemResponse(
                    **{**it.to_public_dict(mine=True), **eng_map.get(it.id, {})}
                )
                for it in items
            ],
            count=len(items),
        )

    @app.get(
        "/v1/showcase/{item_id}",
        response_model=ShowcaseItemResponse,
        tags=["showcase"],
    )
    async def get_showcase_item(
        item_id: str,
        auth: AuthContext = Depends(require_auth),
    ) -> ShowcaseItemResponse:
        item, mine = _require_published_showcase(item_id, auth)
        return _showcase_response(item, mine=mine, user_id=auth.user.id)

    @app.post(
        "/v1/showcase",
        response_model=ShowcaseItemResponse,
        status_code=status.HTTP_201_CREATED,
        tags=["showcase"],
    )
    async def share_to_showcase(
        auth: AuthContext = Depends(require_auth),
        prompt: str = Form(...),
        negative_prompt: str = Form(""),
        mode: str = Form("txt2img"),
        width: int = Form(...),
        height: int = Form(...),
        steps: int = Form(...),
        seed: int | None = Form(None),
        elapsed_ms: int | None = Form(None),
        image: UploadFile = File(...),
        refs: list[UploadFile] | None = File(None),
    ) -> ShowcaseItemResponse:
        prompt = prompt.strip()
        if not prompt:
            raise HTTPException(status_code=400, detail="prompt required")
        if mode not in ("txt2img", "image_edit"):
            raise HTTPException(status_code=400, detail="invalid mode")
        result_name = image.filename or "result.png"
        result_suffix = PurePosixPath(result_name).suffix.lower() or ".png"
        if result_suffix not in _SHOWCASE_SUFFIXES:
            raise HTTPException(status_code=400, detail="unsupported image type")
        result_bytes = await image.read()
        if not result_bytes:
            raise HTTPException(status_code=400, detail="empty image")
        if len(result_bytes) > state.settings.max_upload_bytes:
            raise HTTPException(status_code=413, detail="image too large")

        ref_blobs: list[tuple[bytes, str]] = []
        for ref in refs or []:
            rname = ref.filename or "ref.png"
            rsuffix = PurePosixPath(rname).suffix.lower() or ".png"
            if rsuffix not in _SHOWCASE_SUFFIXES:
                continue
            data = await ref.read()
            if not data:
                continue
            if len(data) > state.settings.max_upload_bytes:
                raise HTTPException(status_code=413, detail="ref image too large")
            ref_blobs.append((data, rsuffix))
            if len(ref_blobs) >= state.settings.max_edit_images:
                break

        item = state.showcase.create(
            author_user_id=auth.user.id,
            author_name=auth.user.name or auth.user.username,
            author_username=auth.user.username,
            prompt=prompt,
            negative_prompt=negative_prompt.strip(),
            mode=mode,
            width=width,
            height=height,
            steps=steps,
            seed=seed,
            result_bytes=result_bytes,
            result_suffix=result_suffix,
            ref_blobs=ref_blobs,
            elapsed_ms=elapsed_ms,
        )
        logger.info(
            "showcase share user=%s id=%s mode=%s refs=%s",
            auth.user.id,
            item.id,
            mode,
            item.ref_count,
        )
        return _showcase_response(item, mine=True, user_id=auth.user.id)

    @app.post(
        "/v1/showcase/{item_id}/unlist",
        response_model=ShowcaseItemResponse,
        tags=["showcase"],
    )
    async def unlist_showcase(
        item_id: str,
        auth: AuthContext = Depends(require_auth),
    ) -> ShowcaseItemResponse:
        try:
            item = state.showcase.unlist(item_id, auth.user.id)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        if item is None:
            raise HTTPException(status_code=404, detail="Showcase item not found")
        return _showcase_response(item, mine=True, user_id=auth.user.id)

    @app.post(
        "/v1/showcase/{item_id}/like",
        response_model=ShowcaseEngagementResponse,
        tags=["showcase"],
    )
    async def toggle_showcase_like(
        item_id: str,
        auth: AuthContext = Depends(require_auth),
    ) -> ShowcaseEngagementResponse:
        _require_published_showcase(item_id, auth)
        eng = state.showcase.toggle_like(item_id, auth.user.id)
        return ShowcaseEngagementResponse(**eng)

    @app.post(
        "/v1/showcase/{item_id}/favorite",
        response_model=ShowcaseEngagementResponse,
        tags=["showcase"],
    )
    async def toggle_showcase_favorite(
        item_id: str,
        auth: AuthContext = Depends(require_auth),
    ) -> ShowcaseEngagementResponse:
        _require_published_showcase(item_id, auth)
        eng = state.showcase.toggle_favorite(item_id, auth.user.id)
        return ShowcaseEngagementResponse(**eng)

    @app.get(
        "/v1/showcase/{item_id}/comments",
        response_model=ShowcaseCommentListResponse,
        tags=["showcase"],
    )
    async def list_showcase_comments(
        item_id: str,
        auth: AuthContext = Depends(require_auth),
        limit: int = 100,
    ) -> ShowcaseCommentListResponse:
        _require_published_showcase(item_id, auth)
        rows = state.showcase.list_comments(item_id, limit=limit)
        return ShowcaseCommentListResponse(
            items=[
                ShowcaseCommentResponse(
                    **row, mine=row["user_id"] == auth.user.id
                )
                for row in rows
            ],
            count=len(rows),
        )

    @app.post(
        "/v1/showcase/{item_id}/comments",
        response_model=ShowcaseCommentResponse,
        status_code=status.HTTP_201_CREATED,
        tags=["showcase"],
    )
    async def add_showcase_comment(
        item_id: str,
        body: ShowcaseCommentCreateRequest,
        auth: AuthContext = Depends(require_auth),
    ) -> ShowcaseCommentResponse:
        _require_published_showcase(item_id, auth)
        try:
            row = state.showcase.add_comment(
                item_id=item_id,
                user_id=auth.user.id,
                author_name=auth.user.name or auth.user.username,
                body=body.body,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return ShowcaseCommentResponse(**row, mine=True)

    @app.delete(
        "/v1/showcase/{item_id}/comments/{comment_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        tags=["showcase"],
        response_class=Response,
    )
    async def delete_showcase_comment(
        item_id: str,
        comment_id: str,
        auth: AuthContext = Depends(require_auth),
    ) -> Response:
        _require_published_showcase(item_id, auth)
        try:
            ok = state.showcase.delete_comment(
                comment_id,
                user_id=auth.user.id,
                is_admin=bool(auth.user.is_admin),
            )
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        if not ok:
            raise HTTPException(status_code=404, detail="Comment not found")
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get(
        "/v1/showcase/{item_id}/thumb",
        dependencies=[Depends(verify_api_key)],
        tags=["showcase"],
    )
    async def get_showcase_thumb(item_id: str) -> FileResponse:
        item = state.showcase.get(item_id)
        if item is None or item.status != "published":
            raise HTTPException(status_code=404, detail="Image not found")
        path = state.showcase.resolve_thumb_path(item)
        if path is None:
            raise HTTPException(status_code=404, detail="Image not found")
        return FileResponse(path, media_type="image/jpeg", filename=path.name)

    @app.get(
        "/v1/showcase/{item_id}/image",
        dependencies=[Depends(verify_api_key)],
        tags=["showcase"],
    )
    async def get_showcase_image(item_id: str) -> FileResponse:
        item = state.showcase.get(item_id)
        if item is None or item.status != "published":
            if item is None:
                raise HTTPException(status_code=404, detail="Image not found")
            if item.status != "published":
                raise HTTPException(status_code=404, detail="Image not found")
        path = state.showcase.resolve_result_path(item)
        if path is None:
            raise HTTPException(status_code=404, detail="Image not found")
        media = mimetypes.guess_type(path.name)[0] or "image/png"
        return FileResponse(path, media_type=media, filename=path.name)

    @app.get(
        "/v1/showcase/{item_id}/refs/{ref_index}",
        dependencies=[Depends(verify_api_key)],
        tags=["showcase"],
    )
    async def get_showcase_ref(item_id: str, ref_index: int) -> FileResponse:
        item = state.showcase.get(item_id)
        if item is None or item.status != "published":
            raise HTTPException(status_code=404, detail="Image not found")
        path = state.showcase.resolve_ref_path(item, ref_index)
        if path is None:
            raise HTTPException(status_code=404, detail="Image not found")
        media = mimetypes.guess_type(path.name)[0] or "image/png"
        return FileResponse(path, media_type=media, filename=path.name)

    @app.get(
        "/v1/cloud-gallery",
        response_model=CloudGalleryListResponse,
        tags=["cloud-gallery"],
    )
    async def list_cloud_gallery(
        auth: AuthContext = Depends(require_auth),
        limit: int = 100,
    ) -> CloudGalleryListResponse:
        items = state.cloud_gallery.list_by_owner(auth.user.id, limit=limit)
        return CloudGalleryListResponse(
            items=[CloudGalleryItemResponse(**it.to_dict()) for it in items],
            count=len(items),
        )

    @app.post(
        "/v1/cloud-gallery",
        response_model=CloudGalleryItemResponse,
        status_code=status.HTTP_201_CREATED,
        tags=["cloud-gallery"],
    )
    async def upload_cloud_gallery(
        auth: AuthContext = Depends(require_auth),
        prompt: str = Form(...),
        negative_prompt: str = Form(""),
        mode: str = Form("txt2img"),
        width: int = Form(...),
        height: int = Form(...),
        steps: int = Form(...),
        seed: int | None = Form(None),
        image: UploadFile = File(...),
    ) -> CloudGalleryItemResponse:
        prompt = prompt.strip()
        if not prompt:
            raise HTTPException(status_code=400, detail="prompt required")
        if mode not in ("txt2img", "image_edit", "image_to_video"):
            raise HTTPException(status_code=400, detail="invalid mode")
        result_name = image.filename or "result.png"
        result_suffix = PurePosixPath(result_name).suffix.lower() or ".png"
        if result_suffix not in _CLOUD_GALLERY_SUFFIXES:
            raise HTTPException(status_code=400, detail="unsupported media type")
        result_bytes = await image.read()
        if not result_bytes:
            raise HTTPException(status_code=400, detail="empty file")
        max_bytes = state.settings.max_upload_bytes * (
            4 if result_suffix in {".mp4", ".webm"} else 1
        )
        if len(result_bytes) > max_bytes:
            raise HTTPException(status_code=413, detail="file too large")
        mime = image.content_type or (
            "video/mp4" if result_suffix == ".mp4" else "image/png"
        )
        item = state.cloud_gallery.create(
            owner_user_id=auth.user.id,
            prompt=prompt,
            negative_prompt=negative_prompt.strip(),
            mode=mode,
            width=width,
            height=height,
            steps=steps,
            seed=seed,
            result_bytes=result_bytes,
            result_suffix=result_suffix,
            mime_type=mime,
        )
        logger.info("cloud gallery save user=%s id=%s mode=%s", auth.user.id, item.id, mode)
        return CloudGalleryItemResponse(**item.to_dict())

    @app.get(
        "/v1/works",
        response_model=WorkListResponse,
        tags=["works"],
    )
    async def list_works(
        auth: AuthContext = Depends(require_auth),
        limit: int = 100,
    ) -> WorkListResponse:
        items = state.works.list_by_owner(auth.user.id, limit=limit)
        return WorkListResponse(
            items=[WorkItemResponse(**it.to_dict()) for it in items],
            count=len(items),
        )

    @app.post(
        "/v1/works",
        response_model=WorkItemResponse,
        status_code=status.HTTP_201_CREATED,
        tags=["works"],
    )
    async def create_work(
        body: WorkCreateRequest,
        auth: AuthContext = Depends(require_auth),
    ) -> WorkItemResponse:
        if body.mode not in ("txt2img", "image_edit", "image_to_video"):
            raise HTTPException(status_code=400, detail="invalid mode")
        item = state.works.create(
            owner_user_id=auth.user.id,
            prompt=body.prompt.strip(),
            negative_prompt=(body.negative_prompt or "").strip(),
            mode=body.mode,
            width=body.width,
            height=body.height,
            steps=body.steps,
            seed=body.seed,
            remote_task_id=body.remote_task_id,
            cloud_gallery_id=body.cloud_gallery_id,
            mime_type=body.mime_type,
        )
        return WorkItemResponse(**item.to_dict())

    @app.delete(
        "/v1/works/{work_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        tags=["works"],
    )
    async def delete_work(
        work_id: str,
        auth: AuthContext = Depends(require_auth),
    ) -> None:
        if not state.works.delete(work_id, auth.user.id):
            raise HTTPException(status_code=404, detail="Work not found")

    @app.delete(
        "/v1/cloud-gallery/{item_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        tags=["cloud-gallery"],
    )
    async def delete_cloud_gallery(
        item_id: str,
        auth: AuthContext = Depends(require_auth),
    ) -> None:
        try:
            ok = state.cloud_gallery.delete(item_id, auth.user.id)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        if not ok:
            raise HTTPException(status_code=404, detail="Cloud gallery item not found")

    @app.get(
        "/v1/cloud-gallery/{item_id}/thumb",
        tags=["cloud-gallery"],
    )
    async def get_cloud_gallery_thumb(
        item_id: str,
        auth: AuthContext = Depends(require_auth),
    ) -> FileResponse:
        item = state.cloud_gallery.get(item_id)
        if item is None or item.owner_user_id != auth.user.id:
            raise HTTPException(status_code=404, detail="Image not found")
        path = state.cloud_gallery.resolve_thumb_path(item)
        if path is None:
            raise HTTPException(status_code=404, detail="Image not found")
        return FileResponse(path, media_type="image/jpeg", filename=path.name)

    @app.get(
        "/v1/cloud-gallery/{item_id}/image",
        tags=["cloud-gallery"],
    )
    async def get_cloud_gallery_image(
        item_id: str,
        auth: AuthContext = Depends(require_auth),
    ) -> FileResponse:
        item = state.cloud_gallery.get(item_id)
        if item is None or item.owner_user_id != auth.user.id:
            raise HTTPException(status_code=404, detail="Image not found")
        path = state.cloud_gallery.resolve_result_path(item)
        if path is None:
            raise HTTPException(status_code=404, detail="Image not found")
        return FileResponse(path, media_type=item.mime_type, filename=path.name)

    def _polish_quota_for_user(user_id: str, daily_limit: int) -> PromptPolishQuota:
        counts = state.user_store.counts_today(user_id)
        used = counts.polish_today
        remaining = max(0, daily_limit - used) if daily_limit > 0 else -1
        rate = state.settings.polish_rate_per_minute
        snap = state.polish_quota.snapshot(user_id, 0, rate)
        return PromptPolishQuota(
            daily_limit=daily_limit,
            daily_used=used,
            daily_remaining=remaining,
            per_minute_limit=rate,
            minute_used=snap.minute_used,
        )

    @app.get(
        "/v1/prompt/polish/status",
        response_model=PromptPolishStatusResponse,
        tags=["polish"],
    )
    async def polish_status(
        auth: AuthContext = Depends(require_auth),
    ) -> PromptPolishStatusResponse:
        s = state.settings
        configured = bool(s.polish_enabled and s.polish_ai_api_key and s.polish_ai_base_url)
        quota = _polish_quota_for_user(auth.user.id, auth.user.daily_polish_limit)
        if not s.polish_enabled:
            msg = "服务端未启用 AI 润色代理（POLISH_ENABLED=false）"
        elif not configured:
            msg = "服务端未配置上游 AI（缺少 POLISH_AI_API_KEY 等）"
        else:
            msg = "网关 AI 润色可用"
        return PromptPolishStatusResponse(
            enabled=s.polish_enabled,
            configured=configured,
            model=s.polish_ai_model if configured else None,
            quota=quota,
            message=msg,
        )

    @app.post(
        "/v1/prompt/polish",
        response_model=PromptPolishResponse,
        tags=["polish"],
    )
    async def polish_prompt(
        body: PromptPolishRequest,
        auth: AuthContext = Depends(require_auth),
    ) -> PromptPolishResponse:
        s = state.settings
        counts = state.user_store.counts_today(auth.user.id)
        limit = auth.user.daily_polish_limit
        if limit > 0 and counts.polish_today >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "code": "daily_polish_quota",
                    "message": f"今日润色次数已用完（{limit}）",
                    "quota": _polish_quota_for_user(auth.user.id, limit).model_dump(),
                },
            )
        # Per-minute rate by user id (global polish_daily_limit unused; per-user limits apply)
        ok, err, _snap = state.polish_quota.check_and_consume(
            auth.user.id, 0, s.polish_rate_per_minute
        )
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "code": err or "rate_limited",
                    "message": "润色请求过于频繁，请稍后再试",
                    "quota": _polish_quota_for_user(auth.user.id, limit).model_dump(),
                },
            )
        try:
            result = await polish_via_upstream(s, body)
        except PromptPolishError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail={"code": exc.code, "message": exc.message},
            ) from exc
        state.user_store.record_usage(auth.user.id, "polish", {"model_profile": body.model_profile})
        result.quota = _polish_quota_for_user(auth.user.id, limit)
        # After record, refresh used count
        result.quota.daily_used = counts.polish_today + 1
        if limit > 0:
            result.quota.daily_remaining = max(0, limit - result.quota.daily_used)
        logger.info(
            "polish ok user=%s today=%s model_profile=%s",
            auth.user.id,
            result.quota.daily_used,
            body.model_profile,
        )
        return result

    @app.post(
        "/v1/prompt/translate",
        response_model=PromptTranslateResponse,
        tags=["polish"],
    )
    async def translate_prompt(
        body: PromptTranslateRequest,
        auth: AuthContext = Depends(require_auth),
    ) -> PromptTranslateResponse:
        """Translate prompt text (en2zh / zh2en). Client decides whether to write into draft."""
        s = state.settings
        text = body.text
        direction = body.direction
        if not worth_translating(text, direction):
            return PromptTranslateResponse(
                translation=text, source=text, direction=direction
            )

        cached = state.translate_cache.get(text, direction)
        if cached is not None:
            logger.info(
                "translate cache hit user=%s chars=%s dir=%s",
                auth.user.id,
                len(text),
                direction,
            )
            return PromptTranslateResponse(
                translation=cached, source=text, direction=direction
            )

        # Miss: rate-limit then call upstream (do not burn daily polish quota)
        ok, err, _snap = state.polish_quota.check_and_consume(
            auth.user.id, 0, s.polish_rate_per_minute
        )
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "code": err or "rate_limited",
                    "message": "翻译请求过于频繁，请稍后再试",
                },
            )
        try:
            out = await translate_via_upstream(s, text, direction)
        except PromptPolishError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail={"code": exc.code, "message": exc.message},
            ) from exc
        state.translate_cache.put(text, out, direction)
        logger.info(
            "translate ok user=%s chars=%s dir=%s cached=1",
            auth.user.id,
            len(text),
            direction,
        )
        return PromptTranslateResponse(
            translation=out, source=text, direction=direction
        )

    def admin_auth(auth: AuthContext = Depends(require_admin_access)) -> AuthContext:
        return auth

    def _session_secret() -> str:
        return (state.settings.admin_session_secret or state.settings.api_key).strip()

    def _mask_phone(phone: str) -> str:
        if len(phone) < 7:
            return phone
        return f"{phone[:3]}****{phone[-4:]}"

    def _cookie_secure(request: Request) -> bool:
        proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "").lower()
        return proto == "https"

    def _set_admin_cookie(
        response: Response, token: str, max_age: int, *, request: Request
    ) -> None:
        response.set_cookie(
            key=COOKIE_NAME,
            value=token,
            max_age=max_age,
            httponly=True,
            secure=_cookie_secure(request),
            samesite="lax",
            path="/",
        )

    def _clear_admin_cookie(response: Response, *, request: Request) -> None:
        response.delete_cookie(
            COOKIE_NAME,
            path="/",
            secure=_cookie_secure(request),
            samesite="lax",
        )

    @app.post("/v1/auth/admin/login", response_model=AdminTotpLoginResponse, tags=["auth"])
    async def auth_admin_login(
        body: AdminTotpLoginRequest, request: Request, response: Response
    ) -> AdminTotpLoginResponse:
        mode = (state.settings.admin_login_mode or "totp").strip().lower()
        if mode not in {"totp", "password_totp"}:
            raise HTTPException(
                status_code=503,
                detail="当前登录模式不是密码+动态码，请改用短信或调整 ADMIN_LOGIN_MODE",
            )
        password = (state.settings.admin_password or "").strip()
        secret = (state.settings.admin_totp_secret or "").strip()
        if not password or not secret:
            raise HTTPException(
                status_code=503,
                detail="未配置 ADMIN_PASSWORD / ADMIN_TOTP_SECRET",
            )
        pw_ok = len(body.password) == len(password) and _secrets.compare_digest(
            body.password, password
        )
        if not pw_ok or not verify_totp(secret, body.totp_code):
            raise HTTPException(status_code=401, detail="密码或动态码错误")

        token, _exp = state.sms_auth.create_session(
            "admin", ttl_seconds=state.settings.admin_session_ttl_seconds
        )
        _set_admin_cookie(
            response, token, state.settings.admin_session_ttl_seconds, request=request
        )
        # Login TOTP already proved — grant short host-action step-up window.
        admin_step_up.mark_elevated(
            admin_step_up.elevation_key(session_token=token, user_id=None),
            ttl_seconds=state.settings.host_action_step_up_seconds,
        )
        logger.info("admin TOTP login ok")
        return AdminTotpLoginResponse()

    @app.post("/v1/auth/admin/logout", tags=["auth"])
    async def auth_admin_logout(request: Request, response: Response) -> dict[str, bool]:
        token = request.cookies.get(COOKIE_NAME)
        admin_step_up.clear_elevated(
            admin_step_up.elevation_key(session_token=token, user_id=None)
        )
        state.sms_auth.revoke_session(token)
        _clear_admin_cookie(response, request=request)
        return {"ok": True}

    @app.post("/v1/auth/sms/send", response_model=SmsSendResponse, tags=["auth"])
    async def auth_sms_send(body: SmsSendRequest, request: Request) -> SmsSendResponse:
        mode = (state.settings.admin_login_mode or "totp").strip().lower()
        if mode != "sms":
            raise HTTPException(
                status_code=503,
                detail="短信登录未启用（ADMIN_LOGIN_MODE=sms 时可用）",
            )
        _ = request
        phone = normalize_cn_phone(body.phone)
        if not phone:
            raise HTTPException(status_code=400, detail="手机号格式不正确")
        allowed = normalize_admin_phone(state.settings.admin_phone)
        if not allowed:
            raise HTTPException(status_code=503, detail="未配置管理员手机号")
        if phone != allowed:
            # Do not leak whether the number is the admin phone.
            raise HTTPException(status_code=403, detail="该手机号无权登录管理台")

        ok, msg = state.sms_auth.can_send(
            phone,
            cooldown_seconds=state.settings.sms_cooldown_seconds,
            daily_limit=state.settings.sms_daily_limit,
        )
        if not ok:
            raise HTTPException(status_code=429, detail=msg)

        code = generate_otp_code()
        secret = _session_secret()
        provider = (state.settings.sms_provider or "tencent").strip().lower()
        tencent_ready = bool(
            state.settings.sms_secret_id
            and state.settings.sms_secret_key
            and state.settings.sms_sdk_app_id
            and state.settings.sms_sign_name
            and state.settings.sms_template_id
        )
        aliyun_ready = bool(
            state.settings.sms_access_key_id
            and state.settings.sms_access_key_secret
            and state.settings.sms_sign_name
            and state.settings.sms_template_code
        )
        dry = state.settings.sms_dry_run or (
            provider == "tencent" and not tencent_ready
        ) or (provider == "aliyun" and not aliyun_ready)
        try:
            if dry:
                logger.warning(
                    "SMS dry-run provider=%s phone=%s code=%s",
                    provider,
                    _mask_phone(phone),
                    code,
                )
            elif provider == "tencent":
                send_tencent_sms(
                    phone=phone,
                    code=code,
                    secret_id=state.settings.sms_secret_id,
                    secret_key=state.settings.sms_secret_key,
                    sdk_app_id=state.settings.sms_sdk_app_id,
                    sign_name=state.settings.sms_sign_name,
                    template_id=state.settings.sms_template_id,
                    region=state.settings.sms_region or "ap-guangzhou",
                )
            elif provider == "aliyun":
                send_aliyun_sms(
                    phone=phone,
                    code=code,
                    access_key_id=state.settings.sms_access_key_id,
                    access_key_secret=state.settings.sms_access_key_secret,
                    sign_name=state.settings.sms_sign_name,
                    template_code=state.settings.sms_template_code,
                    region_id=state.settings.sms_region_id,
                )
            else:
                raise RuntimeError(f"unsupported SMS provider: {provider}")
        except Exception as exc:  # noqa: BLE001
            logger.exception("SMS send failed")
            raise HTTPException(status_code=502, detail=f"短信发送失败：{exc}") from exc

        state.sms_auth.save_otp(
            phone,
            code,
            ttl_seconds=state.settings.sms_otp_ttl_seconds,
            secret=secret,
        )
        return SmsSendResponse(
            message="验证码已发送" if not dry else "验证码已发送（调试模式见服务端日志）",
            cooldown_seconds=state.settings.sms_cooldown_seconds,
        )

    @app.post("/v1/auth/sms/verify", response_model=SmsVerifyResponse, tags=["auth"])
    async def auth_sms_verify(
        body: SmsVerifyRequest, request: Request, response: Response
    ) -> SmsVerifyResponse:
        mode = (state.settings.admin_login_mode or "totp").strip().lower()
        if mode != "sms":
            raise HTTPException(
                status_code=503,
                detail="短信登录未启用（ADMIN_LOGIN_MODE=sms 时可用）",
            )
        phone = normalize_cn_phone(body.phone)
        if not phone:
            raise HTTPException(status_code=400, detail="手机号格式不正确")
        allowed = normalize_admin_phone(state.settings.admin_phone)
        if not allowed or phone != allowed:
            raise HTTPException(status_code=403, detail="该手机号无权登录管理台")

        code = "".join(ch for ch in body.code.strip() if ch.isdigit())
        ok, msg = state.sms_auth.verify_otp(
            phone, code, secret=_session_secret()
        )
        if not ok:
            raise HTTPException(status_code=401, detail=msg)

        token, _exp = state.sms_auth.create_session(
            phone, ttl_seconds=state.settings.admin_session_ttl_seconds
        )
        _set_admin_cookie(
            response, token, state.settings.admin_session_ttl_seconds, request=request
        )
        logger.info("admin SMS login phone=%s", _mask_phone(phone))
        return SmsVerifyResponse(phone_masked=_mask_phone(phone))

    @app.post("/v1/auth/sms/logout", tags=["auth"])
    async def auth_sms_logout(request: Request, response: Response) -> dict[str, bool]:
        return await auth_admin_logout(request, response)

    @app.get("/v1/auth/me", response_model=AuthMeResponse, tags=["auth"])
    async def auth_me(auth: AuthContext = Depends(require_admin_access)) -> AuthMeResponse:
        phone = normalize_admin_phone(state.settings.admin_phone) or ""
        mode = (state.settings.admin_login_mode or "totp").strip().lower()
        via = "api_key"
        if auth.via_sms_session:
            via = "sms" if mode == "sms" else "totp"
        return AuthMeResponse(
            role="admin",
            phone_masked=_mask_phone(phone) if phone else "",
            username=auth.user.username or auth.user.name,
            via=via,
        )

    @app.post("/v1/auth/register", response_model=AuthRegisterResponse, tags=["auth"])
    async def auth_register(body: AuthRegisterRequest) -> AuthRegisterResponse:
        s = state.settings
        try:
            user = state.user_store.register_user(
                body.username,
                body.password,
                display_name=body.display_name or body.username,
                email=body.email,
            )
            state.user_store.set_default_limits(
                user.id,
                s.default_daily_generate_limit,
                s.default_daily_polish_limit,
            )
            user = state.user_store.get_user(user.id) or user
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        logger.info(
            "user registered id=%s username=%s email=%s pending",
            user.id,
            user.username,
            user.email,
        )
        return AuthRegisterResponse(
            user_id=user.id,
            username=user.username,
            status=user.status,
            message="注册成功，等待审核",
        )

    @app.post("/v1/auth/login", response_model=AuthLoginResponse, tags=["auth"])
    async def auth_login(body: AuthLoginRequest) -> AuthLoginResponse:
        user = state.user_store.authenticate(body.username, body.password)
        if user is None:
            # Bootstrap admin may have no password — allow login with username=admin
            # and password equal to API_KEY only if admin has empty password_hash
            lookup = body.username.strip()
            admin = (
                None
                if "@" in lookup
                else state.user_store.find_by_username(lookup)
            )
            if (
                admin
                and admin.is_admin
                and not admin.password_hash
                and body.password == state.settings.api_key
            ):
                user = admin
            else:
                raise HTTPException(status_code=401, detail="用户名/邮箱或密码错误")

        if user.status == STATUS_PENDING:
            raise HTTPException(status_code=403, detail="账号待管理员审核，请稍后再试")
        if user.status == STATUS_REJECTED:
            raise HTTPException(status_code=403, detail="账号未通过审核")
        if user.status == STATUS_DISABLED or not user.enabled:
            raise HTTPException(status_code=403, detail="账号已禁用")
        if user.status != STATUS_ACTIVE or not user.api_key_secret:
            raise HTTPException(status_code=403, detail="账号未激活")

        state.user_store.touch_seen(user.id)
        return AuthLoginResponse(
            user_id=user.id,
            username=user.username,
            name=user.name,
            api_key=user.api_key_secret,
            daily_generate_limit=user.daily_generate_limit,
            daily_polish_limit=user.daily_polish_limit,
            status=user.status,
            email=user.email or "",
        )

    @app.get("/v1/auth/profile", response_model=AuthProfileResponse, tags=["auth"])
    async def auth_profile(auth: AuthContext = Depends(require_auth)) -> AuthProfileResponse:
        user = state.user_store.get_user(auth.user.id) or auth.user
        return AuthProfileResponse(
            user_id=user.id,
            username=user.username,
            name=user.name,
            email=user.email or "",
        )

    @app.post(
        "/v1/internal/auth/resolve",
        response_model=InternalAuthResolveResponse,
        tags=["internal"],
    )
    async def internal_auth_resolve(
        body: InternalAuthResolveRequest,
        request: Request,
    ) -> InternalAuthResolveResponse:
        """GPU generation plane pulls a Meta-approved user by API key (shared sync secret)."""
        expected = (
            state.settings.meta_sync_secret or state.settings.api_key
        ).strip()
        got = (request.headers.get("X-Meta-Sync-Key") or "").strip()
        if not expected or not got or not _secrets.compare_digest(got, expected):
            raise HTTPException(status_code=401, detail="Invalid meta sync key")
        user = state.user_store.find_by_api_key(body.api_key)
        if (
            user is None
            or not user.enabled
            or user.status != STATUS_ACTIVE
            or not user.api_key_secret
        ):
            raise HTTPException(status_code=404, detail="Unknown or inactive API key")
        return InternalAuthResolveResponse(
            id=user.id,
            name=user.name,
            username=user.username,
            password_hash=user.password_hash,
            status=user.status,
            api_key_hash=user.api_key_hash,
            api_key_prefix=user.api_key_prefix,
            api_key_secret=user.api_key_secret,
            enabled=user.enabled,
            is_admin=user.is_admin,
            daily_generate_limit=user.daily_generate_limit,
            daily_polish_limit=user.daily_polish_limit,
            note=user.note,
            created_at=user.created_at,
            last_seen_at=user.last_seen_at,
            email=user.email or "",
        )

    @app.post("/v1/auth/email", response_model=AuthBindEmailResponse, tags=["auth"])
    async def auth_bind_email(
        body: AuthBindEmailRequest,
        auth: AuthContext = Depends(require_auth),
    ) -> AuthBindEmailResponse:
        try:
            user = state.user_store.bind_email(auth.user.id, body.password, body.email)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="User not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        logger.info("user bound email id=%s email=%s", user.id, user.email)
        return AuthBindEmailResponse(email=user.email)

    @app.post(
        "/v1/auth/password-reset/send",
        response_model=AuthPasswordResetSendResponse,
        tags=["auth"],
    )
    async def auth_password_reset_send(
        body: AuthPasswordResetSendRequest,
    ) -> AuthPasswordResetSendResponse:
        email = normalize_email(body.email)
        if not email:
            raise HTTPException(status_code=400, detail="请填写有效邮箱")
        user = state.user_store.find_by_email(email)
        if user is None or not user.email:
            raise HTTPException(status_code=404, detail="该邮箱未绑定任何账号")
        if user.status != STATUS_ACTIVE or not user.enabled:
            raise HTTPException(status_code=403, detail="账号不可用，无法重置密码")

        s = state.settings
        ok, msg = state.email_reset.can_send(
            email,
            cooldown_seconds=s.mail_cooldown_seconds,
            daily_limit=s.mail_daily_limit,
        )
        if not ok:
            raise HTTPException(status_code=429, detail=msg)

        code = generate_otp_code()
        secret = (s.admin_session_secret or s.api_key).strip()
        dry = s.mail_dry_run or not s.mail_smtp_host
        try:
            send_reset_email(
                to_email=email,
                code=code,
                smtp_host=s.mail_smtp_host,
                smtp_port=s.mail_smtp_port,
                smtp_user=s.mail_smtp_user,
                smtp_password=s.mail_smtp_password,
                mail_from=s.mail_from or s.mail_smtp_user,
                use_tls=s.mail_use_tls,
                dry_run=dry,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("send reset email failed")
            raise HTTPException(status_code=502, detail=f"邮件发送失败：{exc}") from exc

        state.email_reset.save_otp(
            email, code, ttl_seconds=s.mail_otp_ttl_seconds, secret=secret
        )
        return AuthPasswordResetSendResponse(
            message="验证码已发送" if not dry else "验证码已发送（调试模式见服务端日志）",
            cooldown_seconds=s.mail_cooldown_seconds,
        )

    @app.post(
        "/v1/auth/password-reset",
        response_model=AuthPasswordResetResponse,
        tags=["auth"],
    )
    async def auth_password_reset(
        body: AuthPasswordResetRequest,
    ) -> AuthPasswordResetResponse:
        if body.new_password != body.confirm_password:
            raise HTTPException(status_code=400, detail="两次输入的密码不一致")
        email = normalize_email(body.email)
        if not email:
            raise HTTPException(status_code=400, detail="请填写有效邮箱")
        user = state.user_store.find_by_email(email)
        if user is None:
            raise HTTPException(status_code=404, detail="该邮箱未绑定任何账号")

        secret = (state.settings.admin_session_secret or state.settings.api_key).strip()
        ok, msg = state.email_reset.verify_otp(email, body.code, secret=secret)
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        try:
            state.user_store.set_password(user.id, body.new_password)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        logger.info("password reset via email user_id=%s", user.id)
        return AuthPasswordResetResponse()

    @app.post(
        "/v1/auth/change-password",
        response_model=AuthChangePasswordResponse,
        tags=["auth"],
    )
    async def auth_change_password(
        body: AuthChangePasswordRequest,
        auth: AuthContext = Depends(require_auth),
    ) -> AuthChangePasswordResponse:
        try:
            state.user_store.change_password(
                auth.user.id, body.old_password, body.new_password
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="User not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        logger.info("user changed password id=%s", auth.user.id)
        return AuthChangePasswordResponse(message="密码已修改，请牢记新密码")

    def _local_hold_response() -> LocalHoldResponse:
        snap = local_hold.snapshot()
        return LocalHoldResponse(**snap.to_public_dict())

    def _gpu_status_response() -> GpuStatusResponse:
        running = len(state.db.list_tasks_by_status("running"))
        queued = len(state.db.list_tasks_by_status("queued"))
        held = local_hold.is_held()
        busy = held or running > 0 or queued > 0
        return GpuStatusResponse(
            state="busy" if busy else "idle",
            queue_running=running,
            queue_queued=queued,
            local_hold=held,
        )

    @app.get("/v1/system/gpu", response_model=GpuStatusResponse, tags=["system"])
    async def get_gpu_status(auth: AuthContext = Depends(require_auth)) -> GpuStatusResponse:
        _ = auth
        return _gpu_status_response()

    @app.get(
        "/v1/system/host-metrics",
        response_model=HostMetricsResponse,
        tags=["system"],
    )
    async def get_host_metrics(auth: AuthContext = Depends(require_auth)) -> HostMetricsResponse:
        """GPU-host sensors via LibreHardwareMonitor (loopback Data.json)."""
        _ = auth
        _require_generation()
        from app.lhm_client import fetch_host_metrics

        data = await fetch_host_metrics(state.settings)
        return HostMetricsResponse(**data)

    def _comfy_cd_seconds() -> int:
        return max(0, int(getattr(state.settings, "comfy_control_cooldown_seconds", 90) or 0))

    def _comfy_cd_guard(action: str) -> None:
        from app.comfy_control_cooldown import check_allowed

        allowed, left, until = check_allowed(action)  # type: ignore[arg-type]
        if allowed:
            return
        raise HTTPException(
            status_code=429,
            detail={
                "message": f"冷却中，请 {left}s 后再试（全站共用）",
                "action": action,
                "cooldown_remaining_seconds": left,
                "cooldown_until": until,
            },
        )

    def _comfy_cd_mark(action: str) -> tuple[int, str | None]:
        from app.comfy_control_cooldown import mark_used

        sec = _comfy_cd_seconds()
        if sec <= 0:
            return 0, None
        left, until = mark_used(action, sec)  # type: ignore[arg-type]
        return left, until

    async def _comfy_control(action: str) -> ComfyControlResponse:
        """Proxy a ComfyUI control call; never expose 8188 publicly."""
        _require_generation()
        if state.comfy is None:
            raise HTTPException(status_code=503, detail="ComfyUI client unavailable")
        from app.comfy_client import ComfyClientError

        _comfy_cd_guard(action)
        try:
            if action == "interrupt":
                await state.comfy.interrupt()
                msg = "已请求打断当前任务"
            elif action == "clear_queue":
                await state.comfy.clear_queue()
                msg = "已清空 ComfyUI 等待队列"
            else:
                raise HTTPException(status_code=400, detail="unknown action")
        except ComfyClientError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        left, until = _comfy_cd_mark(action)
        logger.info("comfy control action=%s cooldown=%ss", action, left)
        return ComfyControlResponse(
            ok=True,
            message=msg,
            action=action,
            cooldown_remaining_seconds=left,
            cooldown_until=until,
        )

    @app.get(
        "/v1/system/comfy/cooldowns",
        response_model=ComfyCooldownStatusResponse,
        tags=["system"],
    )
    async def comfy_cooldowns(auth: AuthContext = Depends(require_auth)) -> ComfyCooldownStatusResponse:
        _ = auth
        _require_generation()
        from app.comfy_control_cooldown import status_snapshot

        return ComfyCooldownStatusResponse(**status_snapshot(_comfy_cd_seconds()))

    @app.post(
        "/v1/system/comfy/interrupt",
        response_model=ComfyControlResponse,
        tags=["system"],
    )
    async def comfy_interrupt(auth: AuthContext = Depends(require_auth)) -> ComfyControlResponse:
        _ = auth
        return await _comfy_control("interrupt")

    @app.post(
        "/v1/system/comfy/queue/clear",
        response_model=ComfyControlResponse,
        tags=["system"],
    )
    async def comfy_queue_clear(auth: AuthContext = Depends(require_auth)) -> ComfyControlResponse:
        _ = auth
        return await _comfy_control("clear_queue")

    @app.post(
        "/v1/system/comfy/free",
        response_model=ComfyControlResponse,
        tags=["system"],
    )
    async def comfy_free(
        body: ComfyFreeRequest,
        auth: AuthContext = Depends(require_auth),
    ) -> ComfyControlResponse:
        _ = auth
        _require_generation()
        if state.comfy is None:
            raise HTTPException(status_code=503, detail="ComfyUI client unavailable")
        from app.comfy_client import ComfyClientError

        _comfy_cd_guard("free")
        try:
            await state.comfy.free_memory(
                unload_models=body.unload_models,
                free_memory=body.free_memory,
            )
        except ComfyClientError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        parts: list[str] = []
        if body.unload_models:
            parts.append("卸载模型")
        if body.free_memory:
            parts.append("清缓存")
        msg = "已请求" + "·".join(parts) if parts else "ok"
        left, until = _comfy_cd_mark("free")
        logger.info(
            "comfy free unload_models=%s free_memory=%s cooldown=%ss",
            body.unload_models,
            body.free_memory,
            left,
        )
        return ComfyControlResponse(
            ok=True,
            message=msg,
            action="free",
            cooldown_remaining_seconds=left,
            cooldown_until=until,
        )

    @app.get("/v1/local-hold", response_model=LocalHoldResponse, tags=["system"])
    async def get_local_hold(auth: AuthContext = Depends(require_auth)) -> LocalHoldResponse:
        _ = auth
        return _local_hold_response()

    @app.get("/v1/admin/local-hold", response_model=LocalHoldResponse, tags=["admin"])
    async def admin_get_local_hold(auth: AuthContext = Depends(admin_auth)) -> LocalHoldResponse:
        _ = auth
        return _local_hold_response()

    @app.post("/v1/admin/local-hold", response_model=LocalHoldResponse, tags=["admin"])
    async def admin_set_local_hold(
        body: LocalHoldSetRequest,
        auth: AuthContext = Depends(admin_auth),
    ) -> LocalHoldResponse:
        snap = local_hold.set(
            held=body.held,
            ttl_seconds=body.ttl_seconds,
            message=body.message,
            set_by=auth.user.id,
        )
        logger.info(
            "local_hold set held=%s ttl=%s by=%s expires=%s",
            snap.held,
            body.ttl_seconds,
            auth.user.id,
            snap.expires_at.isoformat() if snap.expires_at else None,
        )
        return LocalHoldResponse(**snap.to_public_dict())

    def _step_up_key_for_request(request: Request, auth: AuthContext) -> str | None:
        return admin_step_up.elevation_key(
            session_token=request.cookies.get(COOKIE_NAME),
            user_id=auth.user.id if auth.user else None,
        )

    def _host_services_response(
        *, step_up_remaining: int = 0
    ) -> HostServicesResponse:
        settings = get_settings()
        items = [
            HostServiceItem(
                id=s.id,
                label=s.label,
                ok=s.ok,
                state=s.state,
                message=s.message,
                pid=s.pid,
                configured=s.configured,
                detail=s.detail,
            )
            for s in host_services_status(settings)
        ]
        return HostServicesResponse(
            enabled=settings.host_services_enabled,
            services=items,
            step_up_remaining_seconds=step_up_remaining,
        )

    @app.get("/v1/admin/host-services", response_model=HostServicesResponse, tags=["admin"])
    async def admin_host_services(
        request: Request,
        auth: AuthContext = Depends(admin_auth),
    ) -> HostServicesResponse:
        key = _step_up_key_for_request(request, auth)
        remaining = admin_step_up.remaining_seconds(key)
        return await asyncio.to_thread(
            _host_services_response, step_up_remaining=remaining
        )

    @app.post(
        "/v1/admin/host-services/action",
        response_model=HostServiceActionResponse,
        tags=["admin"],
    )
    async def admin_host_service_action(
        body: HostServiceActionRequest,
        request: Request,
        auth: AuthContext = Depends(admin_auth),
    ) -> HostServiceActionResponse:
        settings = get_settings()
        secret = (settings.admin_totp_secret or "").strip()
        if not secret:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="未配置 ADMIN_TOTP_SECRET，无法二次校验启停操作",
            )
        step_key = _step_up_key_for_request(request, auth)
        code = (body.totp_code or "").strip()
        if admin_step_up.is_elevated(step_key):
            pass
        elif not code:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="需要动态码确认（或等待重新登录后的短时免验证已过期）",
            )
        elif not verify_totp(secret, code):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="动态码错误或已过期",
            )
        else:
            admin_step_up.mark_elevated(
                step_key,
                ttl_seconds=settings.host_action_step_up_seconds,
            )

        ok, message = await asyncio.to_thread(
            host_service_run_action, settings, body.service, body.action
        )
        logger.info(
            "host_service action service=%s action=%s ok=%s by=%s msg=%s",
            body.service,
            body.action,
            ok,
            auth.user.id,
            message,
        )
        if body.service == "api" and body.action == "restart" and ok:
            # Return response first; exit shortly so the restart helper can bind the port.
            async def _exit_soon() -> None:
                await asyncio.sleep(0.8)
                os._exit(0)

            asyncio.create_task(_exit_soon())
        remaining = admin_step_up.remaining_seconds(step_key)
        snap = await asyncio.to_thread(
            _host_services_response, step_up_remaining=remaining
        )
        return HostServiceActionResponse(
            ok=ok,
            message=message,
            services=snap.services,
            step_up_remaining_seconds=remaining,
        )

    def _prompt_library_response() -> PromptLibraryResponse:
        doc = state.prompt_library.get()
        return PromptLibraryResponse(
            version=doc.version,
            updated_at=doc.updated_at,
            templates=[PromptLibraryTemplate(**t) for t in doc.templates],
            phrases=[PromptLibraryPhrase(**p) for p in doc.phrases],
        )

    @app.get("/v1/prompt-library", response_model=PromptLibraryResponse, tags=["prompt-library"])
    async def get_prompt_library(auth: AuthContext = Depends(require_auth)) -> PromptLibraryResponse:
        _ = auth
        return _prompt_library_response()

    @app.get(
        "/v1/admin/prompt-library",
        response_model=PromptLibraryResponse,
        tags=["admin"],
    )
    async def admin_get_prompt_library(
        auth: AuthContext = Depends(admin_auth),
    ) -> PromptLibraryResponse:
        _ = auth
        return _prompt_library_response()

    @app.put(
        "/v1/admin/prompt-library",
        response_model=PromptLibraryResponse,
        tags=["admin"],
    )
    async def admin_replace_prompt_library(
        body: PromptLibraryReplaceRequest,
        auth: AuthContext = Depends(admin_auth),
    ) -> PromptLibraryResponse:
        doc = state.prompt_library.replace(
            templates=[t.model_dump() for t in body.templates],
            phrases=[p.model_dump() for p in body.phrases],
        )
        logger.info(
            "prompt_library replaced by=%s version=%s templates=%s phrases=%s",
            auth.user.id,
            doc.version,
            len(doc.templates),
            len(doc.phrases),
        )
        return PromptLibraryResponse(
            version=doc.version,
            updated_at=doc.updated_at,
            templates=[PromptLibraryTemplate(**t) for t in doc.templates],
            phrases=[PromptLibraryPhrase(**p) for p in doc.phrases],
        )

    @app.get(
        "/v1/prompt-library/shared",
        response_model=SharedPromptListResponse,
        tags=["prompt-library"],
    )
    async def list_shared_prompts(
        auth: AuthContext = Depends(require_auth),
        limit: int = 100,
        offset: int = 0,
    ) -> SharedPromptListResponse:
        items = state.shared_prompts.list_all(limit=limit, offset=offset)
        return SharedPromptListResponse(
            items=[
                SharedPromptItemResponse(
                    **item.to_public_dict(viewer_user_id=auth.user.id)
                )
                for item in items
            ],
            count=len(items),
        )

    @app.post(
        "/v1/prompt-library/shared",
        response_model=SharedPromptItemResponse,
        status_code=status.HTTP_201_CREATED,
        tags=["prompt-library"],
    )
    async def share_prompt_template(
        body: SharedPromptShareRequest,
        auth: AuthContext = Depends(require_auth),
    ) -> SharedPromptItemResponse:
        if not body.title or not body.prompt:
            raise HTTPException(status_code=400, detail="title and prompt required")
        item = state.shared_prompts.create(
            title=body.title,
            prompt=body.prompt,
            negative_prompt=body.negative_prompt,
            tags=body.tags,
            author_user_id=auth.user.id,
            author_name=auth.user.name or auth.user.username,
            author_username=auth.user.username,
        )
        logger.info(
            "shared_prompt create user=%s id=%s title=%s",
            auth.user.id,
            item.id,
            item.title[:80],
        )
        return SharedPromptItemResponse(**item.to_public_dict(viewer_user_id=auth.user.id))

    @app.delete(
        "/v1/prompt-library/shared/{item_id}",
        response_model=SharedPromptItemResponse,
        tags=["prompt-library"],
    )
    async def delete_own_shared_prompt(
        item_id: str,
        auth: AuthContext = Depends(require_auth),
    ) -> SharedPromptItemResponse:
        item = state.shared_prompts.get(item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Shared prompt not found")
        if item.author_user_id != auth.user.id:
            raise HTTPException(status_code=403, detail="only author can delete")
        state.shared_prompts.delete(item_id)
        return SharedPromptItemResponse(**item.to_public_dict(viewer_user_id=auth.user.id))

    @app.get(
        "/v1/admin/prompt-library/shared",
        response_model=SharedPromptListResponse,
        tags=["admin"],
    )
    async def admin_list_shared_prompts(
        auth: AuthContext = Depends(admin_auth),
        limit: int = 100,
        offset: int = 0,
    ) -> SharedPromptListResponse:
        items = state.shared_prompts.list_all(limit=limit, offset=offset)
        return SharedPromptListResponse(
            items=[
                SharedPromptItemResponse(
                    **item.to_public_dict(viewer_user_id=auth.user.id)
                )
                for item in items
            ],
            count=len(items),
        )

    @app.delete(
        "/v1/admin/prompt-library/shared/{item_id}",
        response_model=SharedPromptItemResponse,
        tags=["admin"],
    )
    async def admin_delete_shared_prompt(
        item_id: str,
        auth: AuthContext = Depends(admin_auth),
    ) -> SharedPromptItemResponse:
        item = state.shared_prompts.get(item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Shared prompt not found")
        state.shared_prompts.delete(item_id)
        logger.info(
            "admin delete shared_prompt id=%s by=%s author=%s",
            item_id,
            auth.user.id,
            item.author_user_id,
        )
        return SharedPromptItemResponse(**item.to_public_dict(viewer_user_id=auth.user.id))

    @app.get("/v1/admin/stats", response_model=AdminStatsResponse, tags=["admin"])
    async def admin_stats(auth: AuthContext = Depends(admin_auth)) -> AdminStatsResponse:
        _ = auth
        # Meta (ENABLE_GENERATION=false): no task DB — queue stays 0; real queue/hold on GPU.
        if state.db is not None:
            queued = len(state.db.list_tasks_by_status("queued"))
            running = len(state.db.list_tasks_by_status("running"))
        else:
            queued = 0
            running = 0
        hold = local_hold.snapshot()
        gen, pol = state.user_store.usage_today_global()
        users = state.user_store.list_users()
        max_approved = state.settings.max_approved_users
        approved = state.user_store.approved_non_admin_count()
        return AdminStatsResponse(
            queue_open=queued + running,
            queue_queued=queued,
            queue_running=running,
            max_queue_size=state.settings.max_queue_size,
            generate_today=gen,
            polish_today=pol,
            active_users_15m=state.user_store.active_user_count(
                state.settings.active_user_window_minutes
            ),
            users_total=len(users),
            users_enabled=sum(1 for u in users if u.enabled and u.status == STATUS_ACTIVE),
            polish_enabled=state.settings.polish_enabled,
            pending_users=state.user_store.pending_count(),
            pool_remaining=state.user_store.pool_remaining(max_approved),
            max_approved_users=max_approved,
            approved_users=approved,
            local_hold=hold.held,
            local_hold_expires_at=hold.expires_at.isoformat() if hold.expires_at else None,
        )

    @app.get("/v1/admin/users", response_model=list[AdminUserResponse], tags=["admin"])
    async def admin_list_users(auth: AuthContext = Depends(admin_auth)) -> list[AdminUserResponse]:
        _ = auth
        out: list[AdminUserResponse] = []
        for u in state.user_store.list_users():
            d = state.user_store.user_public_dict(u)
            out.append(AdminUserResponse(**d))
        return out

    @app.post(
        "/v1/admin/users/{user_id}/approve",
        response_model=AdminUserResponse,
        tags=["admin"],
    )
    async def admin_approve_user(
        user_id: str,
        auth: AuthContext = Depends(admin_auth),
    ) -> AdminUserResponse:
        _ = auth
        try:
            user, _plain = state.user_store.approve_user(
                user_id, max_approved=state.settings.max_approved_users
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="User not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        logger.info("admin approved user id=%s username=%s", user.id, user.username)
        return AdminUserResponse(**state.user_store.user_public_dict(user))

    @app.post(
        "/v1/admin/users/{user_id}/reject",
        response_model=AdminUserResponse,
        tags=["admin"],
    )
    async def admin_reject_user(
        user_id: str,
        auth: AuthContext = Depends(admin_auth),
    ) -> AdminUserResponse:
        _ = auth
        try:
            user = state.user_store.reject_user(user_id)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="User not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return AdminUserResponse(**state.user_store.user_public_dict(user))

    @app.delete(
        "/v1/admin/users/{user_id}",
        response_model=AdminDeleteUserResponse,
        tags=["admin"],
    )
    async def admin_delete_user(
        user_id: str,
        auth: AuthContext = Depends(admin_auth),
    ) -> AdminDeleteUserResponse:
        _ = auth
        # Purge related data first; then remove the account row.
        try:
            user = state.user_store.get_user(user_id)
            if user is None:
                raise LookupError("User not found")
            if user.is_admin:
                raise ValueError("不能注销管理员账号")
            cloud_n = state.cloud_gallery.delete_all_by_owner(user_id)
            showcase_n = state.showcase.delete_all_by_author(user_id)
            shared_n = state.shared_prompts.delete_all_by_author(user_id)
            works_n = state.works.delete_by_owner(user_id)
            state.polish_quota.delete_key(user_id)
            state.user_store.delete_user(user_id)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="User not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        logger.info(
            "admin deleted user id=%s username=%s cloud=%s showcase=%s shared=%s works=%s",
            user.id,
            user.username,
            cloud_n,
            showcase_n,
            shared_n,
            works_n,
        )
        return AdminDeleteUserResponse(
            id=user.id,
            username=user.username or user.name,
            cloud_gallery_deleted=cloud_n,
            showcase_deleted=showcase_n,
            shared_prompts_deleted=shared_n,
            works_deleted=works_n,
        )

    @app.post(
        "/v1/admin/users/{user_id}/reset-password",
        response_model=AdminResetPasswordResponse,
        tags=["admin"],
    )
    async def admin_reset_password(
        user_id: str,
        body: AdminResetPasswordRequest | None = None,
        auth: AuthContext = Depends(admin_auth),
    ) -> AdminResetPasswordResponse:
        _ = auth
        req = body or AdminResetPasswordRequest()
        try:
            user, plain = state.user_store.reset_password(user_id, req.password)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="User not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        logger.info("admin reset password user_id=%s username=%s", user.id, user.username)
        return AdminResetPasswordResponse(
            id=user.id,
            username=user.username,
            temporary_password=plain,
            message="已重置密码，请立即告知用户（只显示一次）",
        )

    @app.patch("/v1/admin/users/{user_id}", response_model=AdminUserResponse, tags=["admin"])
    async def admin_patch_user(
        user_id: str,
        body: AdminPatchUserRequest,
        auth: AuthContext = Depends(admin_auth),
    ) -> AdminUserResponse:
        _ = auth
        user = state.user_store.update_user(
            user_id,
            name=body.name,
            enabled=body.enabled,
            daily_generate_limit=body.daily_generate_limit,
            daily_polish_limit=body.daily_polish_limit,
            note=body.note,
        )
        if user is None:
            raise HTTPException(status_code=404, detail="User not found")
        return AdminUserResponse(**state.user_store.user_public_dict(user))

    @app.post(
        "/v1/admin/users/{user_id}/rotate-key",
        response_model=AdminUserResponse,
        tags=["admin"],
    )
    async def admin_rotate_key(
        user_id: str,
        auth: AuthContext = Depends(admin_auth),
    ) -> AdminUserResponse:
        _ = auth
        try:
            rotated = state.user_store.rotate_key(user_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if rotated is None:
            raise HTTPException(status_code=404, detail="User not found")
        user, plain = rotated
        d = state.user_store.user_public_dict(user)
        d["api_key"] = plain
        return AdminUserResponse(**d)

    @app.post(
        "/v1/admin/showcase/{item_id}/unlist",
        response_model=ShowcaseItemResponse,
        tags=["admin"],
    )
    async def admin_unlist_showcase(
        item_id: str,
        auth: AuthContext = Depends(admin_auth),
    ) -> ShowcaseItemResponse:
        item = state.showcase.admin_unlist(item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Showcase item not found")
        logger.info(
            "admin unlist showcase id=%s by=%s author=%s",
            item_id,
            auth.user.id,
            item.author_username,
        )
        return ShowcaseItemResponse(**item.to_public_dict(mine=False))

    return app


app = create_app()
