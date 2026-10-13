"""HTTP GET with retries, shared by the Europe PMC and PMC bucket readers."""

import time
import urllib.error
import urllib.request

USER_AGENT = "credit-observatory (https://github.com/simonvanlierde/credit-matrix)"


def get(url: str, retries: int = 3) -> bytes:
    """The body of `url`. Retries server and network errors with backoff; a 404 raises at once."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404 or attempt == retries - 1:
                raise
        except urllib.error.URLError:
            if attempt == retries - 1:
                raise
        time.sleep(2**attempt)
    raise AssertionError("unreachable")
