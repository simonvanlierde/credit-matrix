"""Offsets bind annotations to the exact statement, including non-ASCII text."""

import copy
import hashlib
import json
from itertools import product

import pytest

from census import standoff


def assertion(quote):
    return {"quote": quote, "mentions": ["LV"], "authors": [1], "roles": [{"role": "software", "evidence": "named"}]}


def test_unicode_round_trip():
    for prefix in ("", "é", "e\u0301", "🙂\r\n"):
        for characters in product("é🙂a", repeat=3):
            quote = "LV: Software " + "".join(characters)
            text = prefix + quote + "."
            label = [assertion(quote)]
            before = copy.deepcopy(label)
            record = standoff.encode("PMC0000001", text, label, 1)
            assert record["annotations"][0]["start"] == len(prefix)
            assert record["annotations"][0]["end"] == len(prefix + quote)
            assert record["source_sha256"] == hashlib.sha256(text.encode("utf-8")).hexdigest()
            assert "quote" not in record["annotations"][0]
            assert standoff.decode(json.loads(json.dumps(record)), "PMC0000001", text, 1) == label
            assert label == before


def test_empty_label():
    assert standoff.decode(standoff.encode("PMC0000001", "No roles", [], 1), "PMC0000001", "No roles", 1) == []


def test_repeated_quote_requires_explicit_span():
    text = "LV: Software. LV: Software."
    with pytest.raises(ValueError, match="ambiguous"):
        standoff.encode("PMC0000001", text, [assertion("LV: Software")], 1)
    record = standoff.encode("PMC0000001", text, [assertion("LV: Software")], 1, spans=[(14, 26)])
    assert record["annotations"][0]["start"] == 14
    assert standoff.decode(record, "PMC0000001", text, 1) == [assertion("LV: Software")]


@pytest.mark.parametrize("spans", [[(0, 1)], [], [(False, 12)], [(0, 12), (0, 12)]])
def test_bad_explicit_spans(spans):
    with pytest.raises(ValueError):
        standoff.encode("PMC0000001", "LV: Software", [assertion("LV: Software")], 1, spans=spans)


@pytest.mark.parametrize("changed", ["LV: Software ", "LV: software", "LV: Software\n"])
def test_source_drift(changed):
    record = standoff.encode("PMC0000001", "LV: Software", [assertion("LV: Software")], 1)
    with pytest.raises(ValueError, match="source"):
        standoff.decode(record, "PMC0000001", changed, 1)


def test_wrong_document():
    record = standoff.encode("PMC0000001", "LV: Software", [assertion("LV: Software")], 1)
    with pytest.raises(ValueError, match="document"):
        standoff.decode(record, "PMC0000002", "LV: Software", 1)


@pytest.mark.parametrize("start,end", [(-1, 3), (0, 13), (1, 0), (0, 0), (False, 12), (0, 12.0)])
def test_invalid_offsets(start, end):
    record = standoff.encode("PMC0000001", "LV: Software", [assertion("LV: Software")], 1)
    record["annotations"][0].update(start=start, end=end)
    with pytest.raises(ValueError, match="offset"):
        standoff.decode(record, "PMC0000001", "LV: Software", 1)


def test_invalid_label_rejected():
    with pytest.raises(ValueError, match="outside"):
        standoff.encode("PMC0000001", "LV: Software", [assertion("LV: Software")], 0)
    record = standoff.encode("PMC0000001", "LV: Software", [assertion("LV: Software")], 1)
    record["annotations"][0]["quote"] = "spoof"
    with pytest.raises(ValueError, match="keys"):
        standoff.decode(record, "PMC0000001", "LV: Software", 1)


@pytest.mark.parametrize("field,value", [("version", 2), ("unit", "byte"), ("annotations", {}), ("extra", 1)])
def test_bad_envelope(field, value):
    record = standoff.encode("PMC0000001", "LV: Software", [assertion("LV: Software")], 1)
    record[field] = value
    with pytest.raises(ValueError):
        standoff.decode(record, "PMC0000001", "LV: Software", 1)


def test_pledges_degrees_and_others_survive_roundtrip():
    text = "LV: Software (lead). The others wrote the draft. All authors meet the ICMJE criteria."
    label = [
        {
            "quote": "LV: Software (lead)",
            "mentions": ["LV"],
            "authors": [1],
            "roles": [{"role": "software", "evidence": "named", "degree": "lead", "degree_evidence": "named"}],
        },
        {
            "quote": "The others wrote the draft",
            "mentions": ["The others"],
            "authors": [2, 3],
            "others_of": [0],
            "roles": [{"role": "writing - original draft", "evidence": "worded"}],
        },
        {
            "quote": "All authors meet the ICMJE criteria",
            "mentions": ["All authors"],
            "authors": [1, 2, 3],
            "pledge": "icmje",
        },
    ]
    record = standoff.encode("PMC0000001", text, label, 3)
    assert standoff.decode(json.loads(json.dumps(record)), "PMC0000001", text, 3) == label


def test_overlapping_quotes_stay_independent():
    text = "LV: Software"
    label = [assertion(text), assertion("Software")]
    record = standoff.encode("PMC0000001", text, label, 1)
    assert standoff.decode(record, "PMC0000001", text, 1) == label
