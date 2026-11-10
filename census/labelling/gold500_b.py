"""Draw the definition-B gold set: 500 set2000 rows outside the 200 pilot rows and the worked examples.
It takes every row left that the old gold (definition A) marks none, which is where the narrative
statements are (239), and fills the rest with rows that have roles.
Writes oa-2026-10-gold500b.csv and its -key.csv (stratum)."""

import csv
import json
import random
from pathlib import Path

from census import labels

LAB = Path(__file__).resolve().parents[1] / "data/labels"
used = {json.loads(line)["pmcid"] for line in (LAB / "defB-worked-examples.jsonl").open(encoding="utf-8")}
used |= {r["pmcid"] for r in labels.read_rows(LAB / "oa-2026-10-pilot200b.csv")}
rows = [r for r in labels.read_rows(LAB / "oa-2026-10-set2000.csv") if r["pmcid"] not in used]
plain = [r for r in rows if r["gold"].strip().lower() == "none"]
named = [r for r in rows if r["gold"].strip().lower() != "none"]
rng = random.Random(2027)
pick = [{**r, "stratum": "narrative"} for r in plain] + [
    {**r, "stratum": "credit"} for r in rng.sample(named, 500 - len(plain))
]
pick.sort(key=lambda r: r["pmcid"])
assert len({r["pmcid"] for r in pick}) == 500 and not used & {r["pmcid"] for r in pick}
# The stratum goes in a key file, so labellers do not see the old verdict.
for name, fields in (("gold500b", ["pmcid", "authors", "text"]), ("gold500b-key", ["pmcid", "stratum"])):
    with (LAB / f"oa-2026-10-{name}.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(pick)
print(f"gold500b: {len(pick)} rows ({len(plain)} narrative and {len(named)} credit in the pool)")
