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
[CRediT](https://credit.niso.org/) roles each author holds. It is the browser model of the
[CRediT census](https://github.com/simonvanlierde/credit-matrix/tree/main/census) in [CRediT Matrix](https://github.com/simonvanlierde/credit-matrix).
It is [Ettin-68M](https://huggingface.co/jhu-clsp/ettin-encoder-68m) (revision
`ac19ae4bc51093b31c475665ac872a936d056cc2`), fine-tuned on statements paired with the roles their
publishers tagged.
Source paths below are in the
[census code](https://github.com/simonvanlierde/credit-matrix/tree/main/census/src/census).

## What it does

The model classifies one author at a time. Each input is a pair: a short author text, then the
statement.

```text
[CLS] Na-Gyeong Ryu (N.-G.R., NGR, Ryu NG); author 2 of 5 [SEP] <statement> [SEP]
```

The author text is the name, the ways a statement may write its initials, and the place in the
byline (`encoder.author_text` in `src/census/encoder.py`). The head is a sequence classifier
with 14 outputs and a sigmoid on each, one yes or no per role. A role counts when its probability
is at or above 0.4, the threshold that scored best on the dev set. The threshold is in `best.json`
beside the weights, because the model config does not hold it. Run the model once per author and
the answers are (author, role) pairs.

The published checkpoint predates named outputs, so its config calls them `LABEL_0` to `LABEL_13`;
a model trained from the current code names them by role in `id2label`. In order they are: conceptualization,
data-curation, formal-analysis, funding-acquisition, investigation, methodology,
project-administration, resources, software, supervision, validation, visualization,
writing-original-draft and writing-review-editing (`ROLE_PATTERNS` in `src/census/roles.py`).

Inputs are cut at 512 tokens, as in training.

## How to use

The repository holds ONNX weights only. In Python, with `onnxruntime`, `tokenizers` and
`huggingface_hub`:

```python
import json, re
import numpy as np, onnxruntime as ort
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer

REPO = "<owner>/<repo>"
ROLES = [
    "conceptualization",
    "data-curation",
    "formal-analysis",
    "funding-acquisition",
    "investigation",
    "methodology",
    "project-administration",
    "resources",
    "software",
    "supervision",
    "validation",
    "visualization",
    "writing-original-draft",
    "writing-review-editing",
]


def initials(name):
    *given, surname = name.split()
    parts = [[p[0] for p in re.split(r"-+", g) if p] for g in given]
    dotted = "".join("-".join(f"{c}." for c in g) for g in parts) + f"{surname[0]}."
    compact = "".join(c for g in parts for c in g)
    variants = [dotted, compact + surname[0]] + ([f"{surname} {compact}"] if compact else [])
    return list(dict.fromkeys(variants))


tokenizer = Tokenizer.from_file(hf_hub_download(REPO, "tokenizer.json"))
tokenizer.enable_truncation(512, strategy="only_second")
session = ort.InferenceSession(hf_hub_download(REPO, "onnx/model_int8.onnx"))
threshold = json.load(open(hf_hub_download(REPO, "best.json")))["threshold"]


def roles(statement, authors):
    pairs = set()
    for i, name in enumerate(authors, 1):
        text = f"{name} ({', '.join(initials(name))}); author {i} of {len(authors)}"
        enc = tokenizer.encode(text, statement)
        inputs = {"input_ids": np.array([enc.ids]), "attention_mask": np.array([enc.attention_mask])}
        logits = session.run(None, inputs)[0][0]
        pairs |= {(i, ROLES[r]) for r, p in enumerate(1 / (1 + np.exp(-logits))) if p >= threshold}
    return pairs
```

In transformers.js, load it with
`AutoModelForSequenceClassification.from_pretrained(REPO, { dtype: "int8" })`.

`REPO` is filled in when the Hugging Face repository is created. The int8 copy gives the same
pairs as fp32 for 92.9% of articles (see the ONNX table below), and an article whose probability sits
at the threshold can flip between runtimes.

## Intended use

- Reading CRediT statements in the CRediT Matrix web app, in the browser, so the text never leaves
  the user's machine.
- Reading free-text statements in bulk for the census, with a person or the rule parser as a
  check.
- A baseline for other work on contribution statements.

## Out-of-scope use

- Judging what a person did. The model reads what a statement says, not what happened.
- Statements that are not CRediT. On narrative text ("A.B. designed the study") the model still
  names roles, where the rule parser names none (see Limitations).
- Languages other than English. Every training statement is English.
- Decisions about authorship, hiring or credit without a person reading the statement.

## Training data

The pairs come from Europe PMC's open-access subset, snapshot `oa-2026-10`. Some publishers tag
each author's roles in the JATS XML and also print a statement. The statement is the input and
the tags are the answer.
- The split holds out every twentieth group of identical statements, in publisher and year order,
  so no statement text sits on both sides. Its sha256 is
  `fe3b1264b06d3fe98a9373cda8f9f46408f98b2ac4cf462f458f16f37683e43a`.
- Training draws 120,000 articles from the training side (82,357 with `jats4r` tags, 37,643 with
  `plos_uri` tags), 814,249 (article, author) examples. Each
  publisher and style gets a share in proportion to the square root of its size.
- One statement group in 50 is kept out as a dev set: 2,000 articles, 13,333 examples.
- 1,176 training statements and 10 dev statements were cut at 512 tokens.

**Licence of the training text.** Training used every tagged article in the training split,
whatever its licence. Of the 120,000 articles, 10,817 are not CC BY or CC0, most of them from
SAGE, Oxford University Press and AAAS. The training files name authors and are not published.
The census publishes statement text only for CC BY and CC0 articles (`OPEN_LICENCE` in
`src/census/export.py`). A retrain with `census model train --open-licence-only` draws train and
dev from those articles alone.

## Training setup

| Setting | Value |
| --- | --- |
| Base model | `jhu-clsp/ettin-encoder-68m` at `ac19ae4bc51093b31c475665ac872a936d056cc2` |
| Articles / examples | 120,000 / 814,249 |
| Epochs | 2 (the first scored best on dev and is the one kept) |
| Learning rate | 5e-5, linear decay, warm-up over the first 6% of steps |
| Batch size | 32 |
| Weight decay | 0.01 |
| Loss | binary cross-entropy over the 14 roles |
| Max length | 512 tokens |
| Seed | 20261018 |
| Hardware | one RTX 4090, bf16; 7.14 GB of GPU memory at most |
| Time | 1,158 s for the first epoch, 2,309 s for both |
| Libraries | torch 2.14.1, transformers 5.20.1 |

Every setting is in the run's `config.json` (`encoder.Config`). To train it again:

```sh
uv sync --group train --group browser
uv run census model train --name ettin-68m-120k --model jhu-clsp/ettin-encoder-68m \
  --revision ac19ae4bc51093b31c475665ac872a936d056cc2
```

## Evaluation

All scores count (author, role) pairs pooled over articles, as `census model score` does.
"Exact" is the share of articles whose pairs are all right.

### Against publisher tags

Dev set, best epoch, threshold 0.4: precision 0.878, recall 0.928, F1 0.903, exact 0.545.

Held-out set, 27,874 articles never looked at during training:

| | precision | recall | F1 | exact (95% interval) |
| --- | --- | --- | --- | --- |
| rule parser | 0.878 | 0.875 | 0.877 | 0.488 |
| Ettin-68M | 0.874 | 0.926 | 0.899 | 0.537 (0.532 to 0.543) |
| ModernBERT-base, fine-tuned the same way | 0.874 | 0.927 | 0.899 | 0.539 |

By publisher, Ettin-68M scores F1 0.826 on MDPI (15,847 articles), 0.991 on Frontiers (10,334)
and 0.946 on Oxford University Press (512). Over three training seeds, held-out F1 is 0.899 to
0.900. Learning rates from 3e-5 to 1.5e-4 and one epoch instead of two scored 0.898 to 0.900.

**These tags are not gold.** A publisher's tags can name roles its statement never gives, and no
reader of the statement can recover those. On 20 MDPI articles where the rule parser and the tags
disagree, a language model judged the tags wrong on 18 and both wrong on 2. So the held-out F1
measures agreement with the tags, and it understates accuracy, most on MDPI.

### Against the label set

The label set is 160 articles whose roles were read from free text, drawn per style and publisher
(`census label --set`). Two independent language-model runs labelled it, and a third run settled
where they differed. A person checked a random sample of 20 rows and agreed with every label. Rows
are weighted by their stratum's article count. With 30 to 100 articles per style, the intervals are
wide. The table is scored on the adjudicated
labels (`oa-2026-10-set-opus-adj-defb.csv`).

| | statement_text F1 (100) | contrib_text F1 (30) | articles without roles, exact (30) |
| --- | --- | --- | --- |
| rule parser | 0.932 | 0.997 | 0.868 |
| Ettin-68M | 0.946 | 0.842 | 0.000 |

### On every free-text statement

The model read all 1,297,504 free-text articles in the snapshot. Against the rule parser, the two
agree at pair F1 0.881 and give exactly the same pairs for 54.4% of articles. On MDPI (485,266
articles) they agree at 0.946. This is agreement, not accuracy.

## Limitations

- **Narrative statements.** The model gives roles to statements that name no CRediT roles. On the
  30 label-set articles without roles it was exactly right on none. The census pairs it with the
  rule parser (`census model hybrid`): an article the rules give no role keeps none.
- **Per-author text.** On `contrib_text` articles (a role list per author) the rule parser scores
  0.997 and the model 0.842. The hybrid keeps the rules' reading there.
- **Long statements.** Statements over 512 tokens are cut: 203 of the held-out set. For
  ModernBERT-base, trained with the same cut, those 203 score F1 0.850 against 0.901 for the rest.
  Ettin-68M was not scored on them apart.
- **Biomedical sources.** Europe PMC is biomedical by construction, and MDPI and Frontiers lead the
  training pairs. Other fields and statement layouts are less well covered.
- **Labels.** Both sets of scores rest on labels that are not fully checked by a person: publisher
  tags with known errors, and a label set made by language models with a 20-row human check.
- **Initials.** The author text guesses initials from the name, taking the last word as the
  surname. Bylines in other orders depend on the model reading the name itself.

## ONNX for transformers.js

`census model browser --name ettin-68m-120k` exports the model to ONNX in the layout
transformers.js loads: config and tokenizer files at the top, weights in `onnx/`, so
`dtype: "int8"` picks `onnx/model_int8.onnx`. `best.json` (the threshold) and `run.json` (the
training settings) sit beside them. The int8 copy stores weight matrices in 8 bits and quantises
activations on the fly.

Scored on 2,000 held-out articles on CPU, 16 threads:

| | size | F1 | exact | same pairs as fp32 | seconds for 2,000 articles |
| --- | --- | --- | --- | --- | --- |
| fp32 | 275 MB | 0.903 | 0.542 | 100% | 648 |
| int8 | 70 MB | 0.903 | 0.538 | 92.9% | 595 |
| q4 | 132 MB | 0.903 | 0.545 | 94.2% | 744 |

int8 keeps the full model's F1 at a quarter of the size, so it is the one the app ships. The pairs
differ from fp32's on 7.1% of articles, which the F1 does not show.

## How to cite

Cite CRediT Matrix as <https://doi.org/10.5281/zenodo.21213659> (metadata in
[`CITATION.cff`](https://github.com/simonvanlierde/credit-matrix/blob/main/CITATION.cff)). Cite
Ettin as [its model card](https://huggingface.co/jhu-clsp/ettin-encoder-68m) asks.
