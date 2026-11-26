---
license: mit
base_model: jhu-clsp/ettin-encoder-68m
base_model_relation: finetune
library_name: transformers.js
pipeline_tag: text-classification
language:
  - en
tags:
  - credit
  - contributor-roles
  - scholarly-publishing
  - multi-label-classification
  - modernbert
  - onnx
  - transformers.js
---

# CRediT statement reader (Ettin-68M)

This model reads an author contribution statement and says which of the 14
[CRediT](https://credit.niso.org/) roles each author holds. It reads statements written with the
CRediT role names and statements written in the authors' own words ("A.B. designed the study").
It is the browser model of the
[CRediT census](https://github.com/simonvanlierde/credit-matrix/tree/main/census) in
[CRediT Matrix](https://github.com/simonvanlierde/credit-matrix).
It is [Ettin-68M](https://huggingface.co/jhu-clsp/ettin-encoder-68m) (revision
`ac19ae4bc51093b31c475665ac872a936d056cc2`), fine-tuned on 166,567 statements.
Source paths below are in the
[census code](https://github.com/simonvanlierde/credit-matrix/tree/main/census/src/census).

| | |
| --- | --- |
| Run | `ettin-68m-both-s1` |
| Hub repository | [`simonvanlierde/credit-statement-reader`](https://huggingface.co/simonvanlierde/credit-statement-reader) |
| `onnx/model_int8.onnx` sha256 | `0157d52635f2a0a5482591ef525a40ddaac02b5ecb774587f945480b4a6b67ee` |
| `onnx/model.onnx` sha256 | `ea66c786ba8d7fa33a490f707444a62f6e2589420b963afd129bc27440b85530` |
| `model.safetensors` sha256 | `a48dff938802fef29959e193d2ed7c3a5bd6ca3a3ae1fef6ff5f308f128e8e86` |

`census/model.json` in the source repository holds the same names and hashes, and a test fails
when this card and that file disagree.

## What it does

The model classifies one author at a time. Each input is a pair: a short author text, then the
statement.

```text
[CLS] Na-Gyeong Ryu (N.-G.R., NGR, Ryu NG); author 2 of 5 [SEP] <statement> [SEP]
```

The author text is the name, the ways a statement may write its initials, and the place in the
byline (`encoder.author_text` in `src/census/encoder.py`). The head is a sequence classifier
with 14 outputs and a sigmoid on each, one yes or no per role. The config names the outputs by
role in `id2label`. A role counts when its probability is at or above 0.4, the threshold that
scored best on the dev set. The threshold is in `best.json` beside the weights, because the model
config does not hold it. Run the model once per author and the answers are (author, role) pairs.

Inputs are cut at 1,024 tokens, as in training.

## How to use

The repository holds the PyTorch weights (`model.safetensors`) and two ONNX copies:
`onnx/model.onnx` (fp32) and `onnx/model_int8.onnx` (int8). In Python, with `onnxruntime`,
`tokenizers` and `huggingface_hub`:

```python
import json, re
import numpy as np, onnxruntime as ort
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer

REPO = "simonvanlierde/credit-statement-reader"


def initials(name):
    *given, surname = name.split()
    parts = [[p[0] for p in re.split(r"-+", g) if p] for g in given]
    dotted = "".join("-".join(f"{c}." for c in g) for g in parts) + f"{surname[0]}."
    compact = "".join(c for g in parts for c in g)
    variants = [dotted, compact + surname[0]] + ([f"{surname} {compact}"] if compact else [])
    return list(dict.fromkeys(variants))


tokenizer = Tokenizer.from_file(hf_hub_download(REPO, "tokenizer.json"))
tokenizer.enable_truncation(1024, strategy="only_second")
session = ort.InferenceSession(hf_hub_download(REPO, "onnx/model_int8.onnx"))
config = json.load(open(hf_hub_download(REPO, "config.json")))
roles = [config["id2label"][str(i)] for i in range(len(config["id2label"]))]
threshold = json.load(open(hf_hub_download(REPO, "best.json")))["threshold"]


def read(statement, authors):
    pairs = set()
    for i, name in enumerate(authors, 1):
        text = f"{name} ({', '.join(initials(name))}); author {i} of {len(authors)}"
        enc = tokenizer.encode(text, statement)
        inputs = {"input_ids": np.array([enc.ids]), "attention_mask": np.array([enc.attention_mask])}
        logits = session.run(None, inputs)[0][0]
        pairs |= {(i, roles[r]) for r, p in enumerate(1 / (1 + np.exp(-logits))) if p >= threshold}
    return pairs


statement = "A.L. designed the study and wrote the first draft. C.D. analysed the data."
print(read(statement, ["Ada Lovelace", "Charles Darwin"]))
```

In transformers.js, load it with
`AutoModelForSequenceClassification.from_pretrained(REPO, { dtype: "int8" })`.

A role whose probability sits near the threshold can flip between runtimes and batch sizes, because
the int8 copy quantises activations per batch. Reading one author at a time, as the snippet
does, the int8 copy gave the same pairs as the batched evaluation on 37 of 40 test articles. The fp32 copy gave the
same pairs as the PyTorch model on 39 of 40.

## Intended use

- Reading contribution statements in the CRediT Matrix web app, in the browser, so the text never
  leaves the user's machine.
- Reading free-text statements in bulk for the census, with the rule parser for statements that
  use the CRediT names.
- A baseline for other work on contribution statements.

## Out-of-scope use

- Judging what a person did. The model reads what a statement says, not what happened.
- Decisions about authorship, hiring or credit without a person reading the statement.
- Languages other than English. Every training statement is English.
- Text that is not a contribution statement. The model was trained on statements, and it will
  still name roles for other text.

## Labels: definition B

The labels follow "definition B" ([labelling/README.md](labelling/README.md) and
[labelling/definition-b.md](labelling/definition-b.md)). An author holds a role when the statement
says so, either with the CRediT name ("Conceptualization: A.B.") or in its own words ("A.B.
designed the study" is methodology). The mapping from common wording to roles follows the 2026
CRediT role examples (Hosseini et al., [doi:10.5281/zenodo.18421449](https://doi.org/10.5281/zenodo.18421449)).
ICMJE authorship wording ("substantial contributions to conception and design") is a pledge,
not a role. The scores below use the definition's general view: every role the statement names
or words.

## Training data

All training text comes from CC BY and CC0 articles in Europe PMC's open-access subset, snapshot
`oa-2026-10` (`OPEN_LICENCE` in `src/census/export.py`). The training files name authors and are
not published.

| Part | Articles | Answer |
| --- | --- | --- |
| Statements with publisher role tags | 105,000 | the tags in the JATS XML |
| Statements with tags, read by a large language model | 15,000 | the model's reading |
| Narrative statements, read by Gemma 4 26B under definition B | 6,027 | the reading, if it passed the label gate |
| Unlabelled free-text statements | 40,000 | pairs that at least 3 of 5 earlier seeds of this model predicted |
| Statements with ICMJE pledge wording, read by Gemma 4 26B | 540 | the reading, which gives pledges no role |
| Total | 166,567 | |

The fourth row is self-distillation: five seeds of an earlier run each read 40,000 statements that
no labeller had seen, and a pair counts when three of them agree. Frontiers (55,167) and MDPI
(51,526) give most of the articles.

The split holds out every twentieth group of identical statements, in publisher and year order,
so no statement text sits on both sides. Its sha256 is
`fe3b1264b06d3fe98a9373cda8f9f46408f98b2ac4cf462f458f16f37683e43a`. One statement group in 50 is
kept out of training as a dev set (2,000 articles), which picks the threshold.

No article in the evaluation sets below is in the training data.

## Training setup

| Setting | Value |
| --- | --- |
| Base model | `jhu-clsp/ettin-encoder-68m` at `ac19ae4bc51093b31c475665ac872a936d056cc2` |
| Articles | 166,567 |
| Epochs | 1 |
| Learning rate | 3e-5, linear decay, warm-up over the first 6% of steps |
| Batch size | 32 |
| Weight decay | 0.01 |
| Loss | binary cross-entropy over the 14 roles |
| Max length | 1,024 tokens |
| Seed | 1 |
| Hardware | one RTX 4090, bf16; 14.0 GB of GPU memory at most |
| Time | 1,654 s |
| Libraries | torch 2.15.0, transformers 5.20.2 |

Every setting is in `run.json` beside the weights (`encoder.Config`).

**Energy.** Training energy was not metered. Assuming about 0.5 kW for the RTX 4090 and its host,
1,654 s is about 0.23 kWh. At the Dutch grid average that the census uses for its metered runs
(0.27 kg CO2e per kWh), that is about 0.06 kg CO2e. The model search behind this run took about
100 training runs of similar size, so roughly 100 times that.

## Evaluation

All scores count (author, role) pairs pooled over articles, against definition-B gold in the
general view. "Exact" is the share of articles whose pairs are all right. Intervals are 95%
bootstrap intervals over articles (2,000 resamples).

Three runs of a large language model labelled each gold set blind, and a fourth settled the rows
where all three differed ([labelling/README.md](labelling/README.md)).

### Test set (headline)

`test200b`: 200 articles drawn on 2026-11-21, after the model was chosen, and never used for any
choice. They are simple random samples of 100 from each of two pools of CC BY / CC0 free-text
statements with 2 to 30 authors that no other label set, training set or the held-out split
used:

- **narrative**: statements that use none of the CRediT role names (163,619 in the pool);
- **CRediT**: statements that use them (917,709 in the pool).

| | narrative F1 | narrative exact | CRediT F1 | CRediT exact |
| --- | --- | --- | --- | --- |
| this model, PyTorch | 0.961 (0.944 to 0.975) | 0.59 | 0.973 (0.960 to 0.984) | 0.74 |
| this model, int8 ONNX | 0.960 (0.944 to 0.975) | 0.57 | 0.971 (0.956 to 0.984) | 0.73 |
| rule parser | 0.000 | 0.00 | 0.860 (0.800 to 0.910) | 0.56 |

The rule parser reads only CRediT names, so it finds nothing in narrative statements by design.
The three labellers agreed exactly with each other on 85% to 91% of narrative articles and 94% to
96% of CRediT articles. The model's exact scores (59% and 74%) sit well below that: it gets most
pairs right, but often one pair per article wrong.

Per role on the test set, F1 is 0.87 or more for every role except narrative validation (0.80,
21 gold pairs). Small roles have wide intervals: visualization has 10 narrative gold pairs,
funding acquisition 11.

### Dev set used for model choice

`gold500b`: 500 articles (239 narrative, 261 CRediT). Every candidate run was scored on it, so
these scores are optimistic. Its narrative stratum is harder than the test set's: it holds the
statements an earlier labelling marked as having no CRediT roles.

| | narrative F1 | CRediT F1 |
| --- | --- | --- |
| this model (seed 1) | 0.930 (0.910 to 0.947) | 0.976 (0.963 to 0.986) |
| same recipe, seed 2 | 0.928 | 0.975 |
| int8 ONNX | 0.927 | 0.975 |
| rule parser | 0.069 | 0.903 |

On gold500b the weakest narrative roles are data curation (0.74, 75 gold pairs), software (0.79,
57) and validation (0.83, 66).

### int8 against fp32

On 2,000 held-out articles scored against publisher tags, fp32, int8 and q4 ONNX all reach F1
0.904. int8 gives exactly the same pairs as fp32 on 95.1% of those articles. On gold500b the share
is 74.0% (61.5% narrative), because narrative statements put more probabilities near the
threshold. Paired against the PyTorch model on gold500b, int8 changes narrative F1 by -0.003 (95%
interval -0.009 to +0.003) and CRediT F1 by -0.001 (-0.003 to +0.002); q4 loses 0.004 on narrative,
with an interval below zero. Exact match falls further. Reading one author at a time, as the app does, int8 matches the gold
labels on whole CRediT articles of gold500b 0.793 of the time against 0.812 for PyTorch (-0.019, 95%
interval -0.038 to -0.004). On narrative articles it is 0.473 against 0.510 (-0.038, -0.075 to
+0.000), a borderline drop. A single threshold fitted to int8 on the 2,000-article dev set (0.34) does
not win this back, and CRediT exact match stays down under every threshold variant tried. int8 is a quarter of the size (70 MB
against 275 MB), so it is the copy the app loads.

## Limitations

- **Extra roles.** Most remaining errors are roles added to authors who do hold other roles, such
  as methodology next to formal analysis.
- **Rare roles in narrative text.** Data curation, software and validation are worded in many ways
  and are rare in narrative statements; their F1 is lowest there.
- **Initials.** The author text guesses initials from the name, taking the last word as the
  surname. Bylines in other orders, and statements with swapped or misspelled initials, depend on
  the model reading the name itself.
- **Biomedical sources.** Europe PMC is biomedical by construction, and Frontiers and MDPI lead the
  training data. Other fields and statement layouts are less well covered.
- **Labels.** The gold sets were made by language-model labellers with a vote and an adjudicator.
  A person checked 40 rows of the pilot set (36 right) and ruled on 4 of 40 sampled gold500b rows,
  which changed the definition. Nobody checked the test set by hand. Part of the training data
  comes from publisher tags, which can name roles a statement never gives.
- **Long statements.** Statements over 1,024 tokens are cut.

## Licence

The weights are released under the MIT licence, the same as Ettin. The training text is CC BY 4.0
or CC0 articles from the Europe PMC open-access subset; the weights do not contain that text, and
no training text is published with them.

## How to cite

Cite CRediT Matrix as <https://doi.org/10.5281/zenodo.21213659> (metadata in
[`CITATION.cff`](https://github.com/simonvanlierde/credit-matrix/blob/main/CITATION.cff)). Cite
Ettin as [its model card](https://huggingface.co/jhu-clsp/ettin-encoder-68m) asks.
