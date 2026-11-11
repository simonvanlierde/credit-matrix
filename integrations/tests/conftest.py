"""Shared fixtures for the integration tests."""

import hashlib
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def figure_font_cache(tmp_path_factory) -> dict[str, str]:
    """An XDG cache holding the figure fonts, so a bundle away from its package draws offline."""
    cache = tmp_path_factory.mktemp("cache")
    folder = cache / "credit-matrix" / "fonts"
    folder.mkdir(parents=True)
    for font in (ROOT / "src/fonts").glob("*.ttf"):
        shutil.copyfile(font, folder / f"{hashlib.sha256(font.read_bytes()).hexdigest()}.ttf")
    return {"XDG_CACHE_HOME": str(cache)}
