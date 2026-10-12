"""Official prompt library (templates + phrase chips) maintained by Gateway admin."""

from __future__ import annotations

import json
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_DEFAULT_TEMPLATES: list[dict[str, Any]] = [
    {
        "title": "电影级人像",
        "prompt": (
            "cinematic portrait of a young woman, soft rim light, 85mm lens, "
            "shallow depth of field, film grain, highly detailed"
        ),
        "negative_prompt": "blurry, lowres, deformed, watermark, text",
        "tags": ["人像", "电影"],
    },
    {
        "title": "赛博都市夜景",
        "prompt": (
            "cyberpunk city street at night, neon signs, rain-soaked asphalt reflections, "
            "volumetric fog, ultra detailed"
        ),
        "negative_prompt": "daylight, empty street, blurry",
        "tags": ["场景", "赛博朋克"],
    },
    {
        "title": "水彩风景",
        "prompt": (
            "watercolor landscape of misty mountains and a quiet lake, soft washes, "
            "paper texture, serene atmosphere"
        ),
        "negative_prompt": "photo, 3d render, harsh contrast",
        "tags": ["风景", "艺术"],
    },
]

_DEFAULT_PHRASES: list[dict[str, str]] = [
    {"text": "highly detailed", "category": "质量"},
    {"text": "cinematic lighting", "category": "光线"},
    {"text": "shallow depth of field", "category": "镜头"},
    {"text": "volumetric fog", "category": "氛围"},
    {"text": "best quality", "category": "质量"},
    {"text": "sharp focus", "category": "质量"},
    {"text": "blurry", "category": "负向"},
    {"text": "lowres", "category": "负向"},
    {"text": "watermark", "category": "负向"},
    {"text": "deformed hands", "category": "负向"},
]


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class PromptLibraryDocument:
    version: int
    updated_at: str
    templates: list[dict[str, Any]]
    phrases: list[dict[str, Any]]

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "updated_at": self.updated_at,
            "templates": self.templates,
            "phrases": self.phrases,
        }


class PromptLibraryStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write(self._seed_document())

    def _seed_document(self) -> PromptLibraryDocument:
        now = utcnow()
        templates: list[dict[str, Any]] = []
        for row in _DEFAULT_TEMPLATES:
            templates.append(
                {
                    "id": str(uuid.uuid4()),
                    "title": row["title"],
                    "prompt": row["prompt"],
                    "negative_prompt": row.get("negative_prompt") or "",
                    "tags": list(row.get("tags") or []),
                    "created_at": now,
                    "updated_at": now,
                }
            )
        phrases: list[dict[str, Any]] = []
        for row in _DEFAULT_PHRASES:
            phrases.append(
                {
                    "id": str(uuid.uuid4()),
                    "text": row["text"],
                    "category": row["category"],
                }
            )
        return PromptLibraryDocument(
            version=1,
            updated_at=now,
            templates=templates,
            phrases=phrases,
        )

    def _read(self) -> PromptLibraryDocument:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            doc = self._seed_document()
            self._write(doc)
            return doc
        if not isinstance(raw, dict):
            doc = self._seed_document()
            self._write(doc)
            return doc
        templates = raw.get("templates") if isinstance(raw.get("templates"), list) else []
        phrases = raw.get("phrases") if isinstance(raw.get("phrases"), list) else []
        version = int(raw.get("version") or 1)
        updated_at = str(raw.get("updated_at") or utcnow())
        return PromptLibraryDocument(
            version=max(1, version),
            updated_at=updated_at,
            templates=[t for t in templates if isinstance(t, dict)],
            phrases=[p for p in phrases if isinstance(p, dict)],
        )

    def _write(self, doc: PromptLibraryDocument) -> None:
        payload = doc.to_public_dict()
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(self.path)

    def get(self) -> PromptLibraryDocument:
        with self._lock:
            return self._read()

    def replace(
        self,
        *,
        templates: list[dict[str, Any]],
        phrases: list[dict[str, Any]],
    ) -> PromptLibraryDocument:
        with self._lock:
            current = self._read()
            now = utcnow()
            clean_templates: list[dict[str, Any]] = []
            for row in templates:
                title = str(row.get("title") or "").strip()
                prompt = str(row.get("prompt") or "").strip()
                if not title or not prompt:
                    continue
                tid = str(row.get("id") or "").strip() or str(uuid.uuid4())
                tags_raw = row.get("tags") or []
                tags = [str(t).strip() for t in tags_raw if str(t).strip()] if isinstance(tags_raw, list) else []
                clean_templates.append(
                    {
                        "id": tid,
                        "title": title,
                        "prompt": prompt,
                        "negative_prompt": str(row.get("negative_prompt") or "").strip(),
                        "tags": tags,
                        "created_at": str(row.get("created_at") or now),
                        "updated_at": now,
                    }
                )
            clean_phrases: list[dict[str, Any]] = []
            for row in phrases:
                text = str(row.get("text") or "").strip()
                category = str(row.get("category") or "").strip() or "通用"
                if not text:
                    continue
                pid = str(row.get("id") or "").strip() or str(uuid.uuid4())
                clean_phrases.append({"id": pid, "text": text, "category": category})

            doc = PromptLibraryDocument(
                version=current.version + 1,
                updated_at=now,
                templates=clean_templates,
                phrases=clean_phrases,
            )
            self._write(doc)
            return doc
