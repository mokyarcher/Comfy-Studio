from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from app.config import Settings
from app.prompt_polish_prompt import select_polish_system_prompt
from app.schemas import PromptPolishRequest, PromptPolishResponse, PromptPolishConflict

logger = logging.getLogger(__name__)


class PromptPolishError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def _strip_fence(text: str) -> str:
    trimmed = text.strip()
    m = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", trimmed, re.IGNORECASE)
    return m.group(1).strip() if m else trimmed


def _join_url(base: str, path: str) -> str:
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def parse_model_payload(raw: dict[str, Any], request: PromptPolishRequest) -> PromptPolishResponse:
    # Accept director-doc aliases (positive_prompt) as well as legacy enhanced_*.
    enhanced = str(
        raw.get("enhanced_prompt") or raw.get("positive_prompt") or ""
    ).strip()
    if not enhanced:
        raise PromptPolishError("empty", "上游模型未返回有效提示词", 502)

    conflicts_raw = raw.get("conflicts") or []
    conflicts: list[PromptPolishConflict] = []
    if isinstance(conflicts_raw, list):
        for item in conflicts_raw:
            if not isinstance(item, dict):
                continue
            msg = str(item.get("message") or "").strip()
            if not msg:
                continue
            sev = str(item.get("severity") or "warning")
            if sev not in ("info", "warning", "blocking"):
                sev = "warning"
            conflicts.append(
                PromptPolishConflict(
                    code=str(item.get("code") or "ai_conflict"),
                    message=msg,
                    severity=sev,  # type: ignore[arg-type]
                )
            )

    def _str_list(*keys: str) -> list[str]:
        out: list[str] = []
        for key in keys:
            val = raw.get(key) or []
            if isinstance(val, list):
                out.extend(str(x) for x in val if str(x).strip())
            elif isinstance(val, str) and val.strip():
                out.append(val.strip())
        # de-dupe preserve order
        seen: set[str] = set()
        uniq: list[str] = []
        for x in out:
            if x in seen:
                continue
            seen.add(x)
            uniq.append(x)
        return uniq

    neg = raw.get("enhanced_negative_prompt")
    if neg is None:
        neg = raw.get("negative_prompt")
    if neg is not None:
        neg = str(neg).strip() or None

    categories = _str_list("matched_categories")
    scene = raw.get("scene_type")
    if isinstance(scene, str) and scene.strip() and scene.strip() not in categories:
        categories = [scene.strip(), *categories]

    preserved = _str_list("preserved_constraints", "consistency_constraints")
    assumptions = _str_list("assumptions", "risk_notes")
    intent = raw.get("intent_summary")
    added = _str_list("added_details")
    if isinstance(intent, str) and intent.strip():
        added = [f"意图：{intent.strip()}", *added]

    return PromptPolishResponse(
        enhanced_prompt=enhanced,
        enhanced_negative_prompt=neg if neg else request.negative_prompt,
        added_details=added,
        preserved_constraints=preserved,
        assumptions=assumptions,
        conflicts=conflicts,
        matched_categories=categories,
        model_profile=request.model_profile,
        output_language=request.output_language,
        provider="gateway",
    )


async def polish_via_upstream(
    settings: Settings, request: PromptPolishRequest
) -> PromptPolishResponse:
    if not settings.polish_enabled:
        raise PromptPolishError("disabled", "服务端未启用 AI 润色代理", 503)
    if not settings.polish_ai_api_key:
        raise PromptPolishError("not_configured", "服务端未配置 POLISH_AI_API_KEY", 503)
    if not settings.polish_ai_base_url:
        raise PromptPolishError("not_configured", "服务端未配置 POLISH_AI_BASE_URL", 503)
    if not settings.polish_ai_model:
        raise PromptPolishError("not_configured", "服务端未配置 POLISH_AI_MODEL", 503)

    system_prompt = select_polish_system_prompt(request.generation_mode)
    user_payload = {
        "original_prompt": request.prompt,
        "original_negative_prompt": request.negative_prompt or "",
        "model_profile": request.model_profile,
        "output_language": request.output_language,
        "detail": request.detail,
        "generation_mode": request.generation_mode,
        "instructions": (
            "请按 system 要求返回 JSON（不要 markdown 围栏）。"
            "必须同时给出 enhanced_prompt 与非空的 enhanced_negative_prompt。"
        ),
    }

    url = _join_url(settings.polish_ai_base_url, "/chat/completions")
    timeout = httpx.Timeout(settings.polish_ai_timeout_seconds)
    body = {
        "model": settings.polish_ai_model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {settings.polish_ai_api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
    except httpx.TimeoutException as exc:
        raise PromptPolishError("timeout", "上游 AI 润色超时", 504) from exc
    except httpx.HTTPError as exc:
        logger.warning("polish upstream network error: %s", type(exc).__name__)
        raise PromptPolishError("network", "上游 AI 网络错误", 502) from exc

    if res.status_code == 401:
        raise PromptPolishError("upstream_auth", "上游 AI 认证失败", 502)
    if res.status_code == 429:
        raise PromptPolishError("upstream_rate", "上游 AI 限流，请稍后重试", 429)
    if res.status_code >= 400:
        # Never echo upstream body (may leak provider details)
        raise PromptPolishError("upstream_http", f"上游 AI 错误（HTTP {res.status_code}）", 502)

    try:
        data = res.json()
    except Exception as exc:
        raise PromptPolishError("invalid_json", "上游返回非 JSON", 502) from exc

    content = (
        data.get("choices", [{}])[0].get("message", {}).get("content")
        if isinstance(data, dict)
        else None
    )
    if not content or not str(content).strip():
        raise PromptPolishError("empty", "上游返回内容为空", 502)

    try:
        parsed = json.loads(_strip_fence(str(content)))
    except json.JSONDecodeError as exc:
        raise PromptPolishError("invalid_json", "上游返回的提示词 JSON 无法解析", 502) from exc

    if not isinstance(parsed, dict):
        raise PromptPolishError("schema", "上游返回结构无效", 502)

    return parse_model_payload(parsed, request)
