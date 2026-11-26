"""The encoder for a browser: its ONNX files (`onepass.export`), and their F1 against the full model.

The output directory holds the config and tokenizer files at the top and the weights under onnx/: the fp32
model and its w8 copy (`onepass.VARIANTS`), which the app's worker loads.

Needs the `train` and `browser` dependency groups.
"""

import json
import time
from pathlib import Path
from typing import Any

from census import encoder, labels, onepass, runinfo

# What the Hub repository gets from an export.
HUB_EXPORT = (
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "best.json",
    "run.json",
    "onnx/model.onnx",
    "onnx/model_w8.onnx",
)
# What the app's worker downloads (src/lib/statement-reader.worker.ts), which refuses a file model.json does not
# pin by sha256 and size: `census model publish` records them.
APP_FILES = ("tokenizer.json", "config.json", "best.json", "onnx/model_w8.onnx")


def hub_files(run: Path, out: Path, card: Path, sha256: dict[str, str], sizes: dict[str, int]) -> dict[str, Path]:
    """Path in the Hub repository -> local file: the export, the PyTorch weights, and the model
    card as README.md. A ValueError when a file is missing, or one named in `sha256` or `sizes` (bytes)
    differs; the app reads the size it shows from `sizes`, and its build caps it."""
    files = {name: out / name for name in HUB_EXPORT}
    files |= {"model.safetensors": run / "checkpoint" / "model.safetensors", "README.md": card}
    if missing := [str(f) for f in files.values() if not f.exists()]:
        raise ValueError(f"missing {', '.join(missing)}")
    for name, want in sha256.items():
        if (got := runinfo.sha256(files[name])) != want:
            raise ValueError(f"{name} has sha256 {got}, not the {want} that model.json names")
    for name, size in sizes.items():
        if (got := files[name].stat().st_size) != size:
            raise ValueError(f"{name} is {got} bytes, not the {size} that model.json names")
    return files


def evaluate(out: Path, rows: list[dict[str, Any]], threads: int) -> dict[str, dict[str, Any]]:
    """Per variant on CPU: pair-level precision, recall and F1 against the rows' gold, as `census model score`
    counts them, the share of articles whose pairs match the fp32 model's exactly, and the seconds taken.
    It reads one article per call, as the app does."""
    import onnxruntime as ort
    from transformers import AutoTokenizer

    tokenizer: Any = AutoTokenizer.from_pretrained(out)
    threshold = json.loads((out / "best.json").read_text(encoding="utf-8"))["threshold"]
    config = json.loads((out / "run.json").read_text(encoding="utf-8"))
    marked = onepass.Encoded(tokenizer, rows, config["max_length"], config["marker"])

    def read(session: Any) -> list[list[list[float]]]:
        return onepass.onnx_probabilities(session, marked, 1)

    gold = [{(int(p), s) for p, s in r["gold"]} for r in rows]
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    results: dict[str, dict[str, Any]] = {}
    reference: list[encoder.Pairs] = []
    for name, file in onepass.VARIANTS.items():
        session = ort.InferenceSession(str(out / "onnx" / file), options, providers=["CPUExecutionProvider"])
        start = time.monotonic()
        probs = read(session)
        seconds = time.monotonic() - start
        found = [encoder.decode(p, threshold) for p in probs]
        reference = reference or found
        ((_, n, precision, recall, f1, exact, _, _),) = labels.table(
            ("(all)", f, g, 1.0) for f, g in zip(found, gold, strict=True)
        )
        same = sum(a == b for a, b in zip(found, reference, strict=True)) / len(rows)
        results[name] = {
            "articles": n,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "exact": exact,
            "same_as_fp32": round(same, 4),
            "seconds": round(seconds),
            "bytes": (out / "onnx" / file).stat().st_size,
        }
        print(json.dumps({name: results[name]}), flush=True)
    return results
