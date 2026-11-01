"""Exercise the release lifecycle with real citation-file readers and writers."""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def release(tmp_path, monkeypatch):
    git_env = subprocess.check_output(["git", "rev-parse", "--local-env-vars"], text=True).splitlines()
    for key in [*git_env, *os.environ]:
        if key in git_env or any(part in key.upper() for part in ("TOKEN", "KEY", "SECRET")):
            monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("npm_package_version", "1.2.3")
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    script = tmp_path / "scripts/sync-citation.sh"
    script.parent.mkdir()
    shutil.copyfile(ROOT / "scripts/sync-citation.sh", script)
    config = ROOT / "citesync.toml"
    if config.exists():
        shutil.copyfile(config, tmp_path / "citesync.toml")
    (tmp_path / "package.json").write_text('{"name":"credit-matrix-app","version":"1.2.3","private":true}\n')
    (tmp_path / "CHANGELOG.md").write_text("## [1.2.3] - 2026-11-01\n")
    (tmp_path / "CITATION.cff").write_text(
        'cff-version: 1.2.0\ntitle: Example Lab\nversion: "0.9.0"\ndate-released: "2026-10-30"\n'
        "authors:\n  - given-names: Marie\n    family-names: Curie\n"
        '    orcid: "https://orcid.org/0000-0002-1825-0097"\n'
        'license: MIT\n# Keep this explanation.\nmessage: "Please cite the software."\n'
    )
    metadata = {
        "@context": "https://w3id.org/codemeta/3.0",
        "@type": "SoftwareSourceCode",
        "name": "Example Lab",
        "version": "0.9.0",
        "datePublished": "2026-10-30",
        "license": "MIT",
        "author": [
            {
                "@type": "Person",
                "@id": "https://orcid.org/0000-0002-1825-0097",
                "givenName": "Marie",
                "familyName": "Curie",
                "affiliation": {"name": "Example Institute"},
            },
            {
                "@type": "Role",
                "schema:author": "https://orcid.org/0000-0002-1825-0097",
                "roleName": "https://credit.niso.org/contributor-roles/software/",
            },
        ],
        "contributor": [{"@type": "Organization", "name": "Example Lab contributors"}],
        "description": "Additional CodeMeta detail, absent from the release source.",
        "identifier": "https://doi.org/10.5555/example",
        "custom": {"keep": True},
    }
    (tmp_path / "codemeta.json").write_text(json.dumps(metadata, indent=4) + "\n")
    package = tmp_path / "src/core/package.json"
    package.parent.mkdir(parents=True)
    package.write_text(json.dumps({"name": "credit-matrix", "version": "0.9.0", "private": False}, indent=4) + "\n")
    extension = tmp_path / "integrations/quarto/_extensions/credit-matrix/_extension.yml"
    extension.parent.mkdir(parents=True)
    extension.write_text("title: CRediT Matrix\nversion: 0.9.0\ncontributes:\n  filters: [credit-matrix.lua]\n")
    return tmp_path, metadata


def test_release_sync_preserves_metadata_and_is_idempotent(release):
    root, before = release
    command = ["bash", "scripts/sync-citation.sh"]
    result = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    raw_before = json.dumps(before, indent=4) + "\n"
    expected = {**before, "version": "1.2.3", "datePublished": "2026-11-01"}
    assert json.loads((root / "codemeta.json").read_text()) == expected
    assert (root / "codemeta.json").read_text() == raw_before.replace("0.9.0", "1.2.3").replace(
        "2026-10-30", "2026-11-01"
    )
    assert json.loads((root / "src/core/package.json").read_text())["version"] == "1.2.3"
    citation = (root / "CITATION.cff").read_text()
    assert 'version: "1.2.3"' in citation
    assert 'date-released: "2026-11-01"' in citation
    assert '# Keep this explanation.\nmessage: "Please cite the software."' in citation
    assert "version: 1.2.3\n" in (root / "integrations/quarto/_extensions/credit-matrix/_extension.yml").read_text()
    assert json.loads((root / "package.json").read_text())["version"] == "1.2.3"
    files = [
        "CITATION.cff",
        "codemeta.json",
        "src/core/package.json",
        "integrations/quarto/_extensions/credit-matrix/_extension.yml",
    ]
    snapshot = {name: (root / name).read_bytes() for name in files}
    result = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    assert {name: (root / name).read_bytes() for name in files} == snapshot
    assert not list((root / ".cache").glob("release-metadata.*"))
    result = subprocess.run(
        ["uvx", "--from", "citesync==0.2.0", "citesync", "check", "--root", str(root)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_missing_changelog_date_changes_no_metadata(release):
    root, _ = release
    (root / "CHANGELOG.md").write_text("## [Unreleased]\n")
    before = (root / "CITATION.cff").read_bytes()
    result = subprocess.run(["bash", "scripts/sync-citation.sh"], cwd=root, capture_output=True, text=True)
    assert result.returncode != 0
    assert "No dated CHANGELOG entry" in result.stderr
    assert (root / "CITATION.cff").read_bytes() == before


def test_failed_metadata_sync_does_not_stage_a_partial_release(release):
    root, _ = release
    (root / "codemeta.json").write_text("{broken")
    extension = root / "integrations/quarto/_extensions/credit-matrix/_extension.yml"
    before = extension.read_bytes()
    result = subprocess.run(["bash", "scripts/sync-citation.sh"], cwd=root, capture_output=True, text=True)
    assert result.returncode != 0
    assert "unreadable" in result.stdout + result.stderr
    assert extension.read_bytes() == before
    staged = subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=root, text=True)
    assert not staged
    assert not list((root / ".cache").glob("release-metadata.*"))
