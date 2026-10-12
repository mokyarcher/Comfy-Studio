"""Prompt translation via polish upstream (display or in-place draft translate)."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Literal

import httpx

from app.config import Settings
from app.prompt_polish_service import PromptPolishError, _join_url, _strip_fence

logger = logging.getLogger(__name__)

TranslateDirection = Literal["en2zh", "zh2en"]

_TRANSLATE_SYSTEM_EN2ZH = """你是提示词翻译助手。把用户给出的图像/视频生成提示词译成简体中文。
规则：
1. 只翻译含义，不要改写、扩写、润色或删减要点。
2. 专有名词、模型术语可保留英文并在括号内附中文（如 rim light（边缘光））。
3. 输出 JSON：{"translation":"..."}，不要 markdown 围栏。
4. 若原文已是中文为主，translation 可原样返回或略作通顺。"""

_TRANSLATE_SYSTEM_ZH2EN = """你是提示词翻译助手。把用户给出的图像/视频生成提示词译成英文（适合文生图/图生视频的英文提示词风格）。
规则：
1. 只翻译含义，不要改写、扩写、润色或删减要点；可保持逗号分隔的 tag 风格。
2. 专有名词、模型术语保持英文常见写法。
3. 输出 JSON：{"translation":"..."}，不要 markdown 围栏。
4. 若原文已是英文为主，translation 可原样返回或略作通顺。"""


def _system_for(direction: TranslateDirection) -> str:
    return _TRANSLATE_SYSTEM_ZH2EN if direction == "zh2en" else _TRANSLATE_SYSTEM_EN2ZH


async def translate_via_upstream(
    settings: Settings,
    text: str,
    direction: TranslateDirection = "en2zh",
) -> str:
    if not settings.polish_enabled:
        raise PromptPolishError("disabled", "服务端未启用 AI 代理（译文需 POLISH_ENABLED）", 503)
    if not settings.polish_ai_api_key:
        raise PromptPolishError("not_configured", "服务端未配置 POLISH_AI_API_KEY", 503)
    if not settings.polish_ai_base_url:
        raise PromptPolishError("not_configured", "服务端未配置 POLISH_AI_BASE_URL", 503)
    if not settings.polish_ai_model:
        raise PromptPolishError("not_configured", "服务端未配置 POLISH_AI_MODEL", 503)

    url = _join_url(settings.polish_ai_base_url, "/chat/completions")
    timeout = httpx.Timeout(settings.polish_ai_timeout_seconds)
    body: dict[str, Any] = {
        "model": settings.polish_ai_model,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _system_for(direction)},
            {
                "role": "user",
                "content": json.dumps({"text": text, "direction": direction}, ensure_ascii=False),
            },
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
        raise PromptPolishError("timeout", "上游翻译超时", 504) from exc
    except httpx.HTTPError as exc:
        logger.warning("translate upstream network error: %s", type(exc).__name__)
        raise PromptPolishError("network", "上游 AI 网络错误", 502) from exc

    if res.status_code == 401:
        raise PromptPolishError("upstream_auth", "上游 AI 认证失败", 502)
    if res.status_code == 429:
        raise PromptPolishError("upstream_rate", "上游 AI 限流，请稍后重试", 429)
    if res.status_code >= 400:
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
        # Fallback: treat whole content as translation
        cleaned = _strip_fence(str(content)).strip()
        if cleaned:
            return cleaned
        raise PromptPolishError("invalid_json", "上游译文无法解析", 502) from exc

    if isinstance(parsed, dict):
        out = str(parsed.get("translation") or parsed.get("zh") or "").strip()
        if out:
            return out
    raise PromptPolishError("empty", "上游未返回译文", 502)


def looks_translatable(text: str) -> bool:
    """True when text is mostly Latin (worth EN→ZH for CN users)."""
    s = (text or "").strip()
    if len(s) < 8:
        return False
    latin = len(re.findall(r"[A-Za-z]", s))
    cjk = len(re.findall(r"[\u4e00-\u9fff]", s))
    return latin >= 10 and latin > cjk * 2


def looks_chinese_heavy(text: str) -> bool:
    """True when text has enough CJK to warrant ZH→EN."""
    s = (text or "").strip()
    if len(s) < 4:
        return False
    latin = len(re.findall(r"[A-Za-z]", s))
    cjk = len(re.findall(r"[\u4e00-\u9fff]", s))
    return cjk >= 4 and cjk >= latin


def worth_translating(text: str, direction: TranslateDirection) -> bool:
    if direction == "zh2en":
        return looks_chinese_heavy(text)
    return looks_translatable(text)
