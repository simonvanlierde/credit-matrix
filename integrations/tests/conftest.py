"""Shared fixtures for the integration tests."""

import hashlib
import os
import shutil
import socket
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def figure_font_cache(tmp_path_factory) -> dict[str, str]:
    """An XDG cache holding the figure fonts, so a bundle away from its package draws offline."""
    cache = tmp_path_factory.mktemp("cache")
    folder = cache / "credit-matrix" / "fonts"
    folder.mkdir(parents=True)
    # The provider caches every face, the HarfBuzz shaper and subsetter included, as <sha256>.ttf.
    for font in [*(ROOT / "src/fonts").glob("*.ttf"), *(ROOT / "src/fonts").glob("*.wasm")]:
        shutil.copyfile(font, folder / f"{hashlib.sha256(font.read_bytes()).hexdigest()}.ttf")
    return {"XDG_CACHE_HOME": str(cache)}


@pytest.fixture(autouse=True)
def no_network(monkeypatch, request):
    """Fail outbound sockets in the tests and `fetch` in the Node CLIs they spawn, unless marked `network`."""
    if request.node.get_closest_marker("network"):
        return

    def refuse(*_args, **_kwargs):
        raise RuntimeError("Outbound network access in an integration test; mark it @pytest.mark.network if intended.")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    guard = f"--import={Path(__file__).with_name('no_network.mjs').as_uri()}"
    monkeypatch.setenv("NODE_OPTIONS", f"{os.environ.get('NODE_OPTIONS', '')} {guard}".strip())
