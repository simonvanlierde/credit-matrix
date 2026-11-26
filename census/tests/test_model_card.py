import hashlib
import json
import sys
import types
from pathlib import Path

import pytest

from census import browser, cli

CENSUS = Path(__file__).resolve().parents[1]


def test_card_names_the_shipped_run_repo_and_hashes():
    shipped = json.loads((CENSUS / "model.json").read_text(encoding="utf-8"))
    card = (CENSUS / "MODEL_CARD.md").read_text(encoding="utf-8")
    for fact in [shipped["run"], shipped["repo"], *shipped["sha256"].values()]:
        assert fact in card, f"MODEL_CARD.md does not quote {fact} from model.json"


def _export(tmp_path, run=None, out=None):
    run, out, card = run or tmp_path / "run", out or tmp_path / "browser", tmp_path / "MODEL_CARD.md"
    for path in [run / "checkpoint" / "model.safetensors", card, *(out / name for name in browser.HUB_EXPORT)]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(path.name.encode())
    return run, out, card


def test_hub_files_put_the_card_at_readme_and_leave_q4_out(tmp_path):
    run, out, card = _export(tmp_path)
    want = hashlib.sha256(b"model_int8.onnx").hexdigest()
    files = browser.hub_files(run, out, card, {"onnx/model_int8.onnx": want}, {})
    assert files["README.md"] == card
    assert files["model.safetensors"] == run / "checkpoint" / "model.safetensors"
    assert "onnx/model_q4.onnx" not in files


def test_hub_files_refuse_a_changed_or_missing_file(tmp_path):
    run, out, card = _export(tmp_path)
    with pytest.raises(ValueError, match="not the"):
        browser.hub_files(run, out, card, {"onnx/model_int8.onnx": "0" * 64}, {})
    with pytest.raises(ValueError, match="bytes, not the"):
        browser.hub_files(run, out, card, {}, {"onnx/model_int8.onnx": 1})
    (out / "best.json").unlink()
    with pytest.raises(ValueError, match="missing"):
        browser.hub_files(run, out, card, {}, {})


def test_publish_twice_keeps_the_first_tag(tmp_path, monkeypatch):
    model = tmp_path / "data" / "model" / "s"
    _export(tmp_path, model / "runs" / "r", model / "browser" / "r")
    (tmp_path / "model.json").write_text(
        json.dumps({"run": "r", "snapshot": "s", "repo": "o/m", "sha256": {}, "bytes": {}})
    )
    tags: dict[str, str] = {}
    commits: list[list[str]] = []

    class Api:
        def create_repo(self, repo, exist_ok):
            pass

        def create_commit(self, repo, operations, commit_message):
            commits.append([op.path_in_repo for op in operations])
            return types.SimpleNamespace(oid=f"c{len(commits)}", commit_url=f"u{len(commits)}")

        def create_tag(self, repo, tag, revision, exist_ok=False):
            if tag in tags and not exist_ok:
                raise RuntimeError("tag exists")
            tags.setdefault(tag, revision)

        def list_repo_refs(self, repo):
            refs = [types.SimpleNamespace(name=name, target_commit=oid) for name, oid in tags.items()]
            return types.SimpleNamespace(tags=refs)

    hub = types.SimpleNamespace(
        HfApi=Api, CommitOperationAdd=lambda path, local: types.SimpleNamespace(path_in_repo=path)
    )
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    monkeypatch.setattr(cli, "ROOT", tmp_path)
    monkeypatch.setattr(cli, "DATA", tmp_path / "data")
    assert cli.main(["model", "publish"]) == 0
    assert cli.main(["model", "publish"]) == 0
    assert tags == {"r": "c1"} and len(commits) == 2 and "README.md" in commits[0]
    assert json.loads((tmp_path / "model.json").read_text())["revision"] == "c1"
