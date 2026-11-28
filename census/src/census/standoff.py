"""Store definition-B assertions apart from their exact extracted statement text.

Offsets are zero-based, half-open Python Unicode code points, never XML or UTF-8 byte
positions. The UTF-8 SHA-256 binds them to an unchanged statement, without normalisation.
The caller keeps the source statement and its licence separately from these annotations.
"""

import hashlib
from collections.abc import Sequence

from census import labels

_KEYS = {"version", "pmcid", "source_sha256", "unit", "annotations"}


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _span(start: int, end: int, text: str) -> str:
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
        raise ValueError(f"invalid offsets {start!r}:{end!r}")
    return text[start:end]


def encode(
    pmcid: str,
    text: str,
    label: list[dict],
    n_authors: int,
    *,
    spans: Sequence[tuple[int, int]] | None = None,
) -> dict:
    """Replace assertion quotes with offsets, validating the definition-B label first.

    A repeated quote needs an explicit span per assertion; guessing its occurrence would
    silently move the annotation. Explicit spans must reproduce every quote exactly.
    """
    checked = labels.check_label(label, text, n_authors)
    if spans is not None and len(spans) != len(checked):
        raise ValueError("one explicit span is required per assertion")
    annotations = []
    for i, assertion in enumerate(checked):
        quote = assertion["quote"]
        if spans is None:
            start = text.index(quote)
            if text.find(quote, start + 1) != -1:
                raise ValueError(f"assertion {i}: ambiguous quote; provide explicit spans")
            end = start + len(quote)
        else:
            start, end = spans[i]
        if _span(start, end, text) != quote:
            raise ValueError(f"assertion {i}: offsets do not reproduce the quote")
        annotations.append({"start": start, "end": end, **{k: v for k, v in assertion.items() if k != "quote"}})
    return {
        "version": 1,
        "pmcid": pmcid,
        "source_sha256": _digest(text),
        "unit": "unicode-codepoint",
        "annotations": annotations,
    }


def decode(record: dict, pmcid: str, text: str, n_authors: int) -> list[dict]:
    """Restore and validate assertions against the caller's identified source statement.

    Refuse source drift, unknown fields, invalid spans and invalid role/author metadata.
    """
    if not isinstance(record, dict) or record.keys() != _KEYS:
        raise ValueError("invalid stand-off record keys")
    if type(record["version"]) is not int or record["version"] != 1 or record["unit"] != "unicode-codepoint":
        raise ValueError("unsupported stand-off version or offset unit")
    if record["pmcid"] != pmcid:
        raise ValueError("annotation document does not match the source document")
    if record["source_sha256"] != _digest(text):
        raise ValueError("source statement hash does not match")
    if not isinstance(record["annotations"], list):
        raise ValueError("annotations must be a list")
    label = []
    for annotation in record["annotations"]:
        if (
            not isinstance(annotation, dict)
            or "start" not in annotation
            or "end" not in annotation
            or "quote" in annotation
        ):
            raise ValueError("invalid annotation keys")
        quote = _span(annotation["start"], annotation["end"], text)
        label.append({"quote": quote, **{k: v for k, v in annotation.items() if k not in {"start", "end"}}})
    return labels.check_label(label, text, n_authors)
