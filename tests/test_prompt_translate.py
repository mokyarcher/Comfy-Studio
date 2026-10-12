from __future__ import annotations

from pathlib import Path

from app.prompt_translate_service import (
    looks_chinese_heavy,
    looks_translatable,
    worth_translating,
)
from app.translate_cache_store import TranslateCacheStore, text_hash


def test_looks_translatable_english() -> None:
    assert looks_translatable(
        "cinematic portrait of a young woman, soft rim light, 85mm lens"
    )


def test_looks_translatable_chinese() -> None:
    assert not looks_translatable("电影级人像，柔和边缘光，浅景深")


def test_looks_translatable_short() -> None:
    assert not looks_translatable("ok")


def test_looks_chinese_heavy() -> None:
    assert looks_chinese_heavy("电影级人像，柔和边缘光，浅景深")
    assert not looks_chinese_heavy(
        "cinematic portrait of a young woman, soft rim light"
    )


def test_worth_translating_direction() -> None:
    en = "cinematic portrait soft rim light shallow depth of field"
    zh = "电影级人像，柔和边缘光，浅景深"
    assert worth_translating(en, "en2zh")
    assert not worth_translating(zh, "en2zh")
    assert worth_translating(zh, "zh2en")
    assert not worth_translating(en, "zh2en")


def test_translate_cache_roundtrip(tmp_path: Path) -> None:
    store = TranslateCacheStore(tmp_path / "t.db")
    src = "cinematic portrait soft rim light shallow depth of field"
    assert store.get(src) is None
    store.put(src, "电影级人像，柔和边缘光，浅景深")
    assert store.get(src) == "电影级人像，柔和边缘光，浅景深"
    # Same hash for whitespace-normalized text
    assert text_hash(src) == text_hash(f"  {src}  ")
    assert store.get(f"  {src}  ") == "电影级人像，柔和边缘光，浅景深"


def test_translate_cache_direction_isolated(tmp_path: Path) -> None:
    store = TranslateCacheStore(tmp_path / "t2.db")
    src = "美丽亚洲女性肖像，柔和光线"
    store.put(src, "beautiful Asian woman portrait, soft light", "zh2en")
    assert store.get(src, "zh2en") == "beautiful Asian woman portrait, soft light"
    assert store.get(src, "en2zh") is None
    # Legacy en2zh key must not collide with zh2en
    assert text_hash(src, "en2zh") != text_hash(src, "zh2en")
