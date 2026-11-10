"""Gate for a definition-B labels file: check_b.py INPUT.csv PART.jsonl [FIRST COUNT | partial].

PART.jsonl has one {"pmcid", "label"} object per line. Every row of INPUT (or of rows FIRST to
FIRST+COUNT-1) must appear once, unless `partial`, and every label must pass labels.check_label.
Prints each fault and exits 1, or prints "ok N"."""

import json
import sys
from pathlib import Path

from census import labels

rows = labels.read_rows(Path(sys.argv[1]))
partial = sys.argv[3:] == ["partial"]
if len(sys.argv) > 4:
    first, count = int(sys.argv[3]), int(sys.argv[4])
    rows = rows[first : first + count]
want = {r["pmcid"]: r for r in rows}
seen, faults = set(), []
with open(sys.argv[2], encoding="utf-8") as f:
    for n, line in enumerate(f, 1):
        try:
            item = json.loads(line)
            pmcid = item["pmcid"]
            row = want[pmcid]
            if pmcid in seen:
                raise ValueError("appears twice")
            seen.add(pmcid)
            labels.check_label(item["label"], row["text"], row["authors"].count(" | ") + 1)
        except (ValueError, KeyError, TypeError) as error:
            faults.append(f"line {n} {line[:40]!r}: {type(error).__name__} {error}")
faults += [] if partial else [f"{p}: missing" for p in want.keys() - seen]
print("\n".join(faults) or f"ok {len(seen)}")
sys.exit(1 if faults else 0)
