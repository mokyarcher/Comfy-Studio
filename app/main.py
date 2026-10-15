from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

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
    AdminResetPasswordRequest,
    AdminResetPasswordResponse,
    AuthChangePasswordRequest,
    AuthChangePasswordResponse,
    AuthLoginRequest,
    AuthLoginResponse,
    AuthMeResponse,
    AuthRegisterRequest,
    AuthRegisterResponse,
    AdminTotpLoginRequest,
    AdminTotpLoginResponse,
    SmsSendRequest,
    SmsSendResponse,
    SmsVerifyRequest,
    SmsVerifyResponse,
    GenerateImageRequest,
    GenerateImageResponse,
    GpuStatusResponse,
    HealthLiveResponse,
    HealthReadyResponse,
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
    WorkflowModesResponse,
    PurgeTaskResponse,
    CloudGalleryItemResponse,
    CloudGalleryListResponse,
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
from app.task_service import QueueFullError, TaskService, UnsupportedModeError
from app.user_store import UserStore
from app.cloud_gallery_store import CloudGalleryStore
from app.showcase_store import ShowcaseStore
from app.sms_auth import (
    COOKIE_NAME,
    SmsAuthStore,
    generate_otp_code,
    normalize_cn_phone,
    send_aliyun_sms,
    send_tencent_sms,
)
from app.totp import verify_totp
import secrets as _secrets
from app.workflow import WorkflowError, WorkflowRegistry, load_workflow_registry
from app.worker import TaskWorker

_ALLOWED_UPLOAD_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
_SHOWCASE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
_CLOUD_GALLERY_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm"}

logger = logging.getLogger(__name__)


class AppState:
    settings: Settings
    db: Database
    comfy: ComfyClient
    registry: WorkflowRegistry
    task_service: TaskService
    worker: TaskWorker
    polish_quota: PolishQuotaStore
    user_store: UserStore
    showcase: ShowcaseStore
    cloud_gallery: CloudGalleryStore
    sms_auth: SmsAuthStore
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
            await state.task_service.purge_stale_tasks()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Retention sweep failed")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    setup_logging()
    settings = get_settings()
    state.settings = settings

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
    state.worker = TaskWorker(state.db, state.task_service, hold_checker=local_hold.is_held)
    state.polish_quota = PolishQuotaStore(settings.polish_quota_db_path)
    state.user_store = UserStore(settings.users_db_path)
    state.showcase = ShowcaseStore(settings.showcase_db_path, settings.showcase_files_dir)
    state.cloud_gallery = CloudGalleryStore(
        settings.cloud_gallery_db_path, settings.cloud_gallery_files_dir
    )
    state.sms_auth = SmsAuthStore(settings.admin_sms_db_path)
    state.prompt_library = PromptLibraryStore(settings.prompt_library_path)
    state.shared_prompts = SharedPromptStore(settings.shared_prompts_db_path)
    state.translate_cache = TranslateCacheStore(settings.translate_cache_db_path)
    boot = state.user_store.ensure_bootstrap_admin(settings.api_key)
    if boot:
        logger.info("Bootstrapped admin user id=%s from .env API_KEY", boot.id)
    app.state.user_store = state.user_store
    app.state.settings = settings
    app.state.sms_auth = state.sms_auth
    await state.worker.start()
    state.retention_task = None
    if settings.image_retention_days > 0:
        state.retention_task = asyncio.create_task(_retention_loop())
    logger.info(
        "API listening on %s:%s (polish_enabled=%s users=%s modes=%s retention_days=%s)",
        settings.host,
        settings.port,
        settings.polish_enabled,
        len(state.user_store.list_users()),
        ",".join(registry.modes),
        settings.image_retention_days,
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
        await state.worker.stop()
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
        ok = await state.comfy.ping()
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"status": "not_ready", "comfyui": "down"},
            )
        s = state.settings
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
        try:
            task = state.task_service.submit(body)
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
        return WorkflowModesResponse(modes=state.registry.modes, default="txt2img")

    @app.post(
        "/v1/images/upload",
        response_model=UploadImageResponse,
        tags=["images"],
    )
    async def upload_image(
        file: UploadFile = File(...),
        auth: AuthContext = Depends(require_auth),
    ) -> UploadImageResponse:
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
        return ShowcaseListResponse(
            items=[
                ShowcaseItemResponse(
                    **it.to_public_dict(mine=it.author_user_id == auth.user.id)
                )
                for it in items
            ],
            count=len(items),
        )

    @app.get(
        "/v1/showcase/mine",
        response_model=ShowcaseListResponse,
        tags=["showcase"],
    )
    async def list_my_showcase(
        auth: AuthContext = Depends(require_auth),
    ) -> ShowcaseListResponse:
        items = state.showcase.list_by_author(auth.user.id)
        return ShowcaseListResponse(
            items=[ShowcaseItemResponse(**it.to_public_dict(mine=True)) for it in items],
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
        item = state.showcase.get(item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Showcase item not found")
        mine = item.author_user_id == auth.user.id
        if item.status != "published" and not mine:
            raise HTTPException(status_code=404, detail="Showcase item not found")
        return ShowcaseItemResponse(**item.to_public_dict(mine=mine))

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
        return ShowcaseItemResponse(**item.to_public_dict(mine=True))

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
        return ShowcaseItemResponse(**item.to_public_dict(mine=True))

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
        logger.info("admin TOTP login ok")
        return AdminTotpLoginResponse()

    @app.post("/v1/auth/admin/logout", tags=["auth"])
    async def auth_admin_logout(request: Request, response: Response) -> dict[str, bool]:
        token = request.cookies.get(COOKIE_NAME)
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
            )
            state.user_store.set_default_limits(
                user.id,
                s.default_daily_generate_limit,
                s.default_daily_polish_limit,
            )
            user = state.user_store.get_user(user.id) or user
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        logger.info("user registered id=%s username=%s pending", user.id, user.username)
        return AuthRegisterResponse(
            user_id=user.id,
            username=user.username,
            status=user.status,
            message="注册成功，请等待管理员审核通过后再登录",
        )

    @app.post("/v1/auth/login", response_model=AuthLoginResponse, tags=["auth"])
    async def auth_login(body: AuthLoginRequest) -> AuthLoginResponse:
        user = state.user_store.authenticate(body.username, body.password)
        if user is None:
            # Bootstrap admin may have no password — allow login with username=admin
            # and password equal to API_KEY only if admin has empty password_hash
            admin = state.user_store.find_by_username(body.username)
            if (
                admin
                and admin.is_admin
                and not admin.password_hash
                and body.password == state.settings.api_key
            ):
                user = admin
            else:
                raise HTTPException(status_code=401, detail="用户名或密码错误")

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
        )

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
        queued = len(state.db.list_tasks_by_status("queued"))
        running = len(state.db.list_tasks_by_status("running"))
        gen, pol = state.user_store.usage_today_global()
        users = state.user_store.list_users()
        max_approved = state.settings.max_approved_users
        approved = state.user_store.approved_non_admin_count()
        hold = local_hold.snapshot()
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
