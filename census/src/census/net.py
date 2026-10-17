"""HTTP GET with retries, shared by the Europe PMC and PMC bucket readers, and the atomic file write
the caches use."""

import http.client
import io
import os
import random
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO

USER_AGENT = "credit-census (https://github.com/simonvanlierde/credit-matrix)"
RETRY_STATUS = {429, 500, 502, 503, 504}
DEADLINE = 15 * 60
"""Seconds one attempt may take in all: the socket timeout only bounds each read, so a server sending a
trickle would otherwise hold a worker forever. A bulk file is about 130 MB."""


def get(url: str, retries: int = 5) -> bytes:
    """The body of `url`; see `_fetch`."""
    body = io.BytesIO()
    _fetch(url, body, retries)
    return body.getvalue()


def download(url: str, path: Path, retries: int = 5) -> None:
    """Stream the body of `url` into `path` without holding it in memory; see `_fetch`."""
    with replacing(path) as tmp, tmp.open("wb") as f:
        _fetch(url, f, retries)


def _fetch(url: str, out: BinaryIO, retries: int) -> None:
    """Write the body of `url` to `out`, starting over on each attempt.

    Retries throttling, server errors, dropped connections, bodies cut short (http.client raises
    IncompleteRead, not an OSError) and attempts past DEADLINE, waiting 1, 2, 4, 8 s between attempts,
    each jittered by up to half so many threads do not retry in step (about 15 s in all). Any other
    HTTP error, 404 included, raises at once.
    """
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        out.seek(0)
        out.truncate()
        try:
            end = time.monotonic() + DEADLINE
            with urllib.request.urlopen(request, timeout=60) as response:
                while chunk := response.read(1 << 20):
                    out.write(chunk)
                    if time.monotonic() > end:
                        raise TimeoutError(f"{url} took over {DEADLINE} s")
                # read(n) returns short at a dropped connection instead of raising, so check the length.
                if left := getattr(response, "length", None):
                    raise http.client.IncompleteRead(b"", left)
            return
        except urllib.error.HTTPError as error:
            if error.code not in RETRY_STATUS or attempt == retries - 1:
                raise
        except OSError, http.client.HTTPException:
            if attempt == retries - 1:
                raise
        time.sleep(min(30, 2**attempt) * random.uniform(0.5, 1.5))
    raise AssertionError("unreachable")


@contextmanager
def replacing(path: Path) -> Generator[Path]:
    """A temp path that replaces `path` when the block succeeds and is deleted when it fails, so a kill
    or a full disk never leaves a half file under the real name. The temp name is unique to the process
    and thread, so writers sharing a directory never replace each other's half file."""
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        yield tmp
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)
