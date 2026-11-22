import hashlib
import json
from pathlib import Path

import pytest

from census import browser

CENSUS = Path(__file__).resolve().parents[1]


def test_card_names_the_shipped_run_repo_and_hashes():
    shipped = json.loads((CENSUS / "model.json").read_text(encoding="utf-8"))
    card = (CENSUS / "MODEL_CARD.md").read_text(encoding="utf-8")
    for fact in [shipped["run"], shipped["repo"], *shipped["sha256"].values()]:
        assert fact in card, f"MODEL_CARD.md does not quote {fact} from model.json"


def _export(tmp_path):
    run, out, card = tmp_path / "run", tmp_path / "browser", tmp_path / "MODEL_CARD.md"
    for path in [run / "checkpoint" / "model.safetensors", card, *(out / name for name in browser.HUB_EXPORT)]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(path.name.encode())
    return run, out, card


def test_hub_files_put_the_card_at_readme_and_leave_q4_out(tmp_path):
    run, out, card = _export(tmp_path)
    want = hashlib.sha256(b"model_int8.onnx").hexdigest()
    files = browser.hub_files(run, out, card, {"onnx/model_int8.onnx": want})
    assert files["README.md"] == card
    assert files["model.safetensors"] == run / "checkpoint" / "model.safetensors"
    assert "onnx/model_q4.onnx" not in files


def test_hub_files_refuse_a_changed_or_missing_file(tmp_path):
    run, out, card = _export(tmp_path)
    with pytest.raises(ValueError, match="not the"):
        browser.hub_files(run, out, card, {"onnx/model_int8.onnx": "0" * 64})
    (out / "best.json").unlink()
    with pytest.raises(ValueError, match="missing"):
        browser.hub_files(run, out, card, {})
