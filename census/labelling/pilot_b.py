"""Draw the definition-B pilot: 200 set2000 rows, half that the old gold (definition A) marks none,
which is where the narrative statements are, half with roles, leaving out the worked examples.
Writes oa-2026-10-pilot200b.csv and its -key.csv (stratum)."""

import csv
import json
import random
from pathlib import Path

from census import labels

LAB = Path(__file__).resolve().parents[1] / "data/labels"
examples = {json.loads(line)["pmcid"] for line in (LAB / "defB-worked-examples.jsonl").open(encoding="utf-8")}
rows = [r for r in labels.read_rows(LAB / "oa-2026-10-set2000.csv") if r["pmcid"] not in examples]
plain = [r for r in rows if r["gold"].strip().lower() == "none"]
named = [r for r in rows if r["gold"].strip().lower() != "none"]
rng = random.Random(2026)
pick = [{**r, "stratum": "narrative"} for r in rng.sample(plain, 100)] + [
    {**r, "stratum": "credit"} for r in rng.sample(named, 100)
]
pick.sort(key=lambda r: r["pmcid"])
# The stratum goes in a key file, so labellers do not see the old verdict.
for name, fields in (("pilot200b", ["pmcid", "authors", "text"]), ("pilot200b-key", ["pmcid", "stratum"])):
    with (LAB / f"oa-2026-10-{name}.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(pick)
print(f"pilot200b: {len(pick)} rows ({len(plain)} narrative and {len(named)} credit in the pool)")
