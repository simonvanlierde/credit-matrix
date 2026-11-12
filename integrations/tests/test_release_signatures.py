"""The release gate rejects tags without a verified signature before publishing."""

import itertools
import os
import subprocess
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("signature", ["true", "false", "unavailable", "lightweight"])
def test_release_requires_a_verified_signed_tag(tmp_path, signature):
    workflow = (ROOT / ".github/workflows/release-core.yml").read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(workflow) if "- name: Check the tagged commit" in line)
    run = next(i for i in range(start, len(workflow)) if workflow[i] == "        run: |")
    script = textwrap.dedent(
        "\n".join(
            itertools.takewhile(lambda line: not line.strip() or line.startswith("          "), workflow[run + 1 :])
        )
    )
    git = tmp_path / "git"
    git.write_text(
        '#!/bin/sh\nif [ "$1" = "merge-base" ]; then exit 0; fi\n'
        + ("exit 1\n" if signature == "lightweight" else "echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"),
        encoding="utf-8",
    )
    gh = tmp_path / "gh"
    gh.write_text(
        "#!/bin/sh\n" + ("exit 1\n" if signature == "unavailable" else f"echo {signature}\n"),
        encoding="utf-8",
    )
    git.chmod(0o755)
    gh.chmod(0o755)
    result = subprocess.run(
        ["bash", "-e", "-o", "pipefail", "-c", script],
        env={
            "PATH": f"{tmp_path}{os.pathsep}{os.defpath}",
            "GITHUB_REF_NAME": "v1.2.3",
            "GITHUB_SHA": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "GITHUB_REPOSITORY": "example/credit-matrix",
        },
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert (result.returncode == 0) == (signature == "true"), result.stdout + result.stderr
