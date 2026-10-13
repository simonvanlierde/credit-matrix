"""HTTP GET with retries, shared by the Europe PMC and PMC bucket readers."""

import http.client
import random
import time
import urllib.error
import urllib.request

USER_AGENT = "credit-census (https://github.com/simonvanlierde/credit-matrix)"
RETRY_STATUS = {429, 500, 502, 503, 504}


def get(url: str, retries: int = 5) -> bytes:
    """The body of `url`.

    Retries throttling, server errors and dropped connections (including a body cut short, which
    http.client raises as IncompleteRead, not as an OSError), with jittered backoff of up to about
    30 s so many threads do not retry in step. Any other HTTP error, 404 included, raises at once.
    """
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code not in RETRY_STATUS or attempt == retries - 1:
                raise
        except OSError, http.client.HTTPException:
            if attempt == retries - 1:
                raise
        time.sleep(min(30, 2**attempt) * random.uniform(0.5, 1.5))
    raise AssertionError("unreachable")
