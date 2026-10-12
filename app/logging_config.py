from __future__ import annotations

import logging
import re
from typing import Iterable

_SENSITIVE_PATTERNS = (
    re.compile(r"(?i)(api[_-]?key|x-api-key|authorization)\s*[:=]\s*\S+"),
    re.compile(r"(?i)(frp[_-]?token|token)\s*[:=]\s*\S+"),
)


class SensitiveDataFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        redacted = message
        for pattern in _SENSITIVE_PATTERNS:
            redacted = pattern.sub(r"\1=[REDACTED]", redacted)
        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True


def setup_logging(level: int = logging.INFO) -> None:
    root = logging.getLogger()
    if not root.handlers:
        logging.basicConfig(
            level=level,
            format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        )
    else:
        root.setLevel(level)

    sensitive = SensitiveDataFilter()
    for handler in logging.getLogger().handlers:
        handler.addFilter(sensitive)


def truncate_for_log(text: str, max_len: int = 80) -> str:
    text = text.replace("\n", " ").strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def summarize_prompt_fields(fields: Iterable[str]) -> str:
    return ", ".join(f"{name}=<{name}>" for name in fields)
