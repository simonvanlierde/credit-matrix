"""The encoder for a browser: ONNX export, smaller quantised copies, and their F1 against the full model.

The output directory has the layout transformers.js loads (config and tokenizer files at the top, weights
in onnx/model.onnx, onnx/model_int8.onnx, onnx/model_q4.onnx), so `dtype: "int8"` or `"q4"` picks a copy.
int8 stores every weight matrix in 8 bits and quantises activations on the fly; q4 stores the weight
matrices of the linear layers in 4-bit blocks of 32, which onnxruntime-web runs as MatMulNBits.

Needs the `train` and `browser` dependency groups.
"""

import json
import shutil
import time
from pathlib import Path
from typing import Any

from census import encoder, labels

VARIANTS = {"fp32": "model.onnx", "int8": "model_int8.onnx", "q4": "model_q4.onnx"}


def export(run: Path, out: Path) -> dict[str, int]:
    """Write the run's best checkpoint as ONNX with its int8 and q4 copies. Returns each file's size in bytes."""
    import onnx
    import torch
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
    from transformers import AutoModelForSequenceClassification

    weights = out / "onnx"
    weights.mkdir(parents=True, exist_ok=True)
    for name in ("config.json", "tokenizer.json", "tokenizer_config.json"):
        shutil.copy(run / "checkpoint" / name, out / name)
    # The decision threshold and the max length, which the model config does not hold.
    shutil.copy(run / "best.json", out / "best.json")
    shutil.copy(run / "config.json", out / "run.json")
    model = AutoModelForSequenceClassification.from_pretrained(run / "checkpoint", attn_implementation="eager").eval()
    ids = torch.ones((2, 16), dtype=torch.long)
    batch, length = torch.export.Dim("batch"), torch.export.Dim("length", max=8192)
    torch.onnx.export(
        model,
        (),
        weights / VARIANTS["fp32"],
        kwargs={"input_ids": ids, "attention_mask": torch.ones_like(ids)},
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_shapes={"input_ids": {0: batch, 1: length}, "attention_mask": {0: batch, 1: length}},
        external_data=False,
        dynamo=True,
    )
    # The exporter's recorded intermediate shapes trip onnx's shape inference, which quantising runs: drop them.
    graph = onnx.load(weights / VARIANTS["fp32"])
    del graph.graph.value_info[:]
    onnx.save(graph, weights / VARIANTS["fp32"])
    quantize_dynamic(weights / VARIANTS["fp32"], weights / VARIANTS["int8"], weight_type=QuantType.QInt8)
    q4 = MatMulNBitsQuantizer(onnx.load(weights / VARIANTS["fp32"]), block_size=32, is_symmetric=True)
    q4.process()
    quantised: Any = q4.model  # an ONNXModel once processed, though typed as either
    quantised.save_model_to_file(str(weights / VARIANTS["q4"]))
    return {name: (weights / file).stat().st_size for name, file in VARIANTS.items()}


def _onnx_probabilities(session: Any, encoded: encoder.Encoded, batch_size: int) -> list[list[float]]:
    import torch

    lengths = [len(encoded.ids(i)) for i in range(len(encoded.examples))]
    out: list[list[float]] = [[] for _ in lengths]
    for batch in encoder._batches(lengths, batch_size, None):
        inputs = {k: v.numpy() for k, v in encoder._tensors(torch, encoded, batch, "cpu").items()}
        (logits,) = session.run(["logits"], inputs)
        for i, p in zip(batch, torch.sigmoid(torch.from_numpy(logits)).tolist(), strict=True):
            out[i] = p
    return out


def evaluate(out: Path, rows: list[dict[str, Any]], threads: int, batch_size: int = 16) -> dict[str, dict[str, Any]]:
    """Per variant on CPU: pair-level precision, recall and F1 against the rows' gold, as `census model score`
    counts them, the share of articles whose pairs match the fp32 model's exactly, and the seconds taken."""
    import onnxruntime as ort
    from transformers import AutoTokenizer

    tokenizer: Any = AutoTokenizer.from_pretrained(out)
    threshold = json.loads((out / "best.json").read_text(encoding="utf-8"))["threshold"]
    max_length = json.loads((out / "run.json").read_text(encoding="utf-8"))["max_length"]
    encoded = encoder.Encoded(tokenizer, rows, max_length)
    gold = [{(int(p), s) for p, s in r["gold"]} for r in rows]
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    results: dict[str, dict[str, Any]] = {}
    reference: list[encoder.Pairs] = []
    for name, file in VARIANTS.items():
        session = ort.InferenceSession(str(out / "onnx" / file), options, providers=["CPUExecutionProvider"])
        start = time.monotonic()
        probs = encoder._per_article(rows, encoded, _onnx_probabilities(session, encoded, batch_size))
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
