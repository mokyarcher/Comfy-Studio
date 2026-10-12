"""Safe filesystem helpers for purging ComfyUI input/output artifacts."""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def resolve_under(root: Path, *, filename: str, subfolder: str = "") -> Path | None:
    """Resolve a file under root; reject path traversal / absolute segments."""
    name = (filename or "").strip()
    sub = (subfolder or "").strip().replace("\\", "/")
    if not name or name in (".", ".."):
        return None
    if "/" in name or "\\" in name or ".." in name:
        return None
    if sub.startswith("/") or sub.startswith("\\") or ".." in sub.split("/"):
        return None
    base = root.resolve()
    candidate = (base / sub / name).resolve() if sub else (base / name).resolve()
    try:
        candidate.relative_to(base)
    except ValueError:
        return None
    return candidate


def delete_under(root: Path | None, *, filename: str, subfolder: str = "") -> bool:
    """Delete one file under root. Returns True if deleted or already absent."""
    if root is None:
        return False
    if not root.exists():
        logger.warning("Comfy dir missing, skip delete: %s", root)
        return False
    path = resolve_under(root, filename=filename, subfolder=subfolder)
    if path is None:
        logger.warning("Rejected unsafe path under %s: %s / %s", root, subfolder, filename)
        return False
    try:
        if path.is_file():
            path.unlink()
            logger.info("Deleted %s", path)
            return True
        if not path.exists():
            return True
        logger.warning("Not a file, skip: %s", path)
        return False
    except OSError as exc:
        logger.warning("Failed to delete %s: %s", path, exc)
        return False
