---
license: mit
base_model: jhu-clsp/ettin-encoder-68m
base_model_relation: finetune
library_name: onnx
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
`ac19ae4bc51093b31c475665ac872a936d056cc2`), fine-tuned on 166,567 statements, and it reads every
author of a statement in one pass.
Source paths below are in the
[census code](https://github.com/simonvanlierde/credit-matrix/tree/main/census/src/census).

| | |
| --- | --- |
| Run | `ettin-68m-onepass-b8-s2` |
| Hub repository | [`simonvanlierde/credit-statement-reader`](https://huggingface.co/simonvanlierde/credit-statement-reader) |
| `onnx/model_w8.onnx` sha256 | `f720cbbb47529e521d80be75dd1aa1b08449f57489edd7f8067c71591930ccf5` |
| `onnx/model.onnx` sha256 | `ad261fb9b72b4e1f05bf7702ea8c5b7e43ccdb7976afd292a321c6b78f7b79cd` |
| `model.safetensors` sha256 | `1e74f68491f212b746c89f1e5c1cc4e03b9a3a0cf9c0c43b68f07d8e10afc54d` |
| `tokenizer.json` sha256 | `6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30` |
| `config.json` sha256 | `d9f7523bcc0248102608c85d698876886fbf45ce93c75176ae70edd241ca77d3` |
| `best.json` sha256 | `529baba95800ccb09a1168bbfab9519f268b4c1b00a8cfd71cf096bce00b678d` |

`census/model.json` in the source repository holds the same names and hashes, and a test fails
when this card and that file disagree.

## What it does

The model reads a statement once for all its authors. The input lists the authors, each after a
marker token, then the statement:

```text
[CLS] [unused0] Marie Curie (M.C., MC, Curie M); author 1 of 3 [unused0] Ada Lovelace (A.L., AL, Lovelace A); author 2 of 3 [unused0] ... [SEP] <statement> [SEP]
```

The author text is the name, the ways a statement may write its initials, and the place in the
byline (`encoder.author_text` in `src/census/encoder.py`). The model reads the hidden state at
each marker and applies a 14-output head with a sigmoid on each, one yes or no per role, so one
call gives every author's roles. The config names the outputs by role in `id2label`. A role counts
when its probability is at or above 0.4, the threshold that scored best on the dev set; it is in
`best.json`. The max length (1,024) and the marker token are in `run.json`.

The ONNX graph takes three int64 inputs, `input_ids` and `attention_mask` [batch, length] and
`marker_positions` [batch, authors] (the index of each author's marker in `input_ids`), and gives
`logits` [batch, authors, 14].

A byline too long to fit 1,024 tokens beside the statement is split into chunks of authors, and
each chunk repeats the statement; every author keeps its "author i of n" text. A statement longer
than 1,024 tokens less a quarter for authors is cut to make room for them (`onepass.chunks` and
`onepass.statement_room` in `src/census/onepass.py`).

## How to use

The repository holds the PyTorch weights (`model.safetensors`) and two ONNX copies:
`onnx/model.onnx` (fp32) and `onnx/model_w8.onnx` (8-bit weights, 75 MB). In Python, with
`onnxruntime`, `tokenizers` and `huggingface_hub`:

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
session = ort.InferenceSession(hf_hub_download(REPO, "onnx/model_w8.onnx"))
config = json.load(open(hf_hub_download(REPO, "config.json")))
run = json.load(open(hf_hub_download(REPO, "run.json")))
roles = [config["id2label"][str(i)] for i in range(len(config["id2label"]))]
threshold = json.load(open(hf_hub_download(REPO, "best.json")))["threshold"]
CLS, SEP, MARK = (tokenizer.token_to_id(t) for t in ("[CLS]", "[SEP]", run["marker"]))
MAX = run["max_length"]


def ids(text):
    return tokenizer.encode(text, add_special_tokens=False).ids


def read(statement, authors):
    n = len(authors)
    texts = [ids(f"{a} ({', '.join(initials(a))}); author {i} of {n}")[: MAX // 4] for i, a in enumerate(authors, 1)]
    need = [1 + len(t) for t in texts]
    words = ids(statement)[: MAX - 3 - min(sum(need), max(max(need), MAX // 4))]
    room, chunks = MAX - 3 - len(words), [[]]
    for i, k in enumerate(need):
        if chunks[-1] and sum(need[j] for j in chunks[-1]) + k > room:
            chunks.append([])
        chunks[-1].append(i)
    pairs = set()
    for chunk in chunks:
        tokens, marks = [CLS], []
        for i in chunk:
            marks.append(len(tokens))
            tokens += [MARK, *texts[i]]
        tokens += [SEP, *words, SEP]
        inputs = {
            "input_ids": np.array([tokens]),
            "attention_mask": np.ones((1, len(tokens)), dtype=np.int64),
            "marker_positions": np.array([marks]),
        }
        for i, row in zip(chunk, session.run(None, inputs)[0][0]):
            pairs |= {(i + 1, roles[r]) for r, p in enumerate(1 / (1 + np.exp(-row))) if p >= threshold}
    return pairs


statement = "A.L. designed the study and wrote the first draft. C.D. analysed the data."
print(read(statement, ["Ada Lovelace", "Charles Darwin"]))
```

In a browser, run `onnx/model_w8.onnx` with onnxruntime-web and build the inputs as above; the
`parity.json` file in the census data gives the exact inputs and outputs for six statements to test
a port against. Reading one article per call, the w8 copy gave the same pairs as the PyTorch model
on 92% of narrative and 98% of CRediT test articles.

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
| Started from | the per-author run `ettin-68m-both-s1` (its encoder and head), trained on the same data |
| Articles | 166,567 (163,266 after the CC BY / CC0 filter; 164,484 chunks, 801 articles split) |
| Epochs | 1 |
| Learning rate | 3e-5, linear decay, warm-up over the first 6% of steps |
| Batch size | 8 chunks |
| Weight decay | 0.01 |
| Loss | binary cross-entropy over the 14 roles of every author in a chunk |
| Max length | 1,024 tokens |
| Seed | 2 |
| Hardware | one RTX 4090, bf16; 4.2 GB of GPU memory at most |
| Time | 555 s, after the 1,654 s of the run it started from |
| Libraries | torch 2.15.0, transformers 5.23.0 |

Every setting is in `run.json` beside the weights (`onepass.Config`).

**Energy.** Not metered. At about 0.5 kW, the 555 s of this run are about 0.08 kWh (0.02 kg CO2e
at 0.27 kg per kWh), on top of the 0.23 kWh of the run it started from. Choosing the recipe took
three one-pass runs of similar size.

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
| this model, PyTorch | 0.964 (0.949 to 0.977) | 0.61 | 0.971 (0.957 to 0.983) | 0.71 |
| this model, w8 ONNX | 0.964 (0.949 to 0.977) | 0.61 | 0.971 (0.956 to 0.983) | 0.71 |
| previous per-author model (`ettin-68m-both-s1`), PyTorch | 0.961 (0.944 to 0.975) | 0.59 | 0.973 (0.960 to 0.984) | 0.74 |
| previous per-author model, int8 ONNX | 0.960 (0.944 to 0.975) | 0.57 | 0.971 (0.956 to 0.984) | 0.73 |
| rule parser | 0.000 | 0.00 | 0.860 (0.800 to 0.910) | 0.56 |

`test200b` was scored once for this model, after it was chosen on gold500b.

The rule parser reads only CRediT names, so it finds nothing in narrative statements by design.
The three labellers agreed exactly with each other on 85% to 91% of narrative articles and 94% to
96% of CRediT articles. The model's exact scores (61% and 71%) sit well below that: it gets most
pairs right, but often one pair per article wrong.

### Outside biomedicine

`ood200b`: 147 CC BY / CC0 articles from 2022 on, drawn on 2026-11-23 from publishers outside Europe
PMC: Copernicus (40), Pensoft (40), Scientific Research Publishing (SRP, 40), Frontiers (25) and Open
Research Europe (2); about half are earth science. 71 statements are narrative and 76 use CRediT names.
They were labelled as the test set was, and a person ruled on the 5 rows where all three labellers
differed.

| | narrative F1 | narrative exact | CRediT F1 | CRediT exact |
| --- | --- | --- | --- | --- |
| this model, PyTorch | 0.883 (0.851 to 0.913) | 0.42 | 0.949 (0.920 to 0.974) | 0.71 |
| previous per-author model, PyTorch | 0.894 (0.863 to 0.925) | 0.41 | 0.951 (0.922 to 0.973) | 0.68 |
| previous per-author model, int8 ONNX | 0.884 (0.854 to 0.914) | 0.35 | 0.949 (0.920 to 0.972) | 0.66 |
| rule parser | 0.000 | 0.17 | 0.857 (0.799 to 0.907) | 0.49 |

Narrative statements score clearly lower than in the test set (0.883 against 0.964). Against the
per-author model, F1 differs by -0.011 (-0.025 to +0.003, paired) on narrative statements and -0.002
on CRediT ones. CRediT statements hold up once SRP is left out (0.968 on the other 56), and
narrative rises only to 0.895 without SRP, whose statements are often loosely worded. The labellers
also agreed less: 78% to 82% of narrative articles and 87% to 95% of CRediT articles. Training on
269 more narrative statements from these publishers (Pensoft left out) did not close the per-author
model's gap over two seeds. OpenAlex's role data, which reads CRediT names in full text, has roles
for 43 of the 76 CRediT articles and none of the narrative ones; on those 43 the per-author model
scores F1 0.968 and OpenAlex 0.899 (checked 2026-11-26).

### Dev set used for model choice

`gold500b`: 500 articles (239 narrative, 261 CRediT). Every candidate run was scored on it, so
these scores are optimistic. Its narrative stratum is harder than the test set's: it holds the
statements an earlier labelling marked as having no CRediT roles.

| | narrative F1 | narrative exact | CRediT F1 | CRediT exact |
| --- | --- | --- | --- | --- |
| this model (seed 2), PyTorch | 0.931 (0.911 to 0.948) | 0.506 | 0.974 (0.963 to 0.985) | 0.801 |
| same recipe, seed 1 | 0.929 | 0.485 | 0.972 | 0.797 |
| w8 ONNX | 0.931 | 0.502 | 0.974 | 0.797 |
| int8 ONNX (not shipped) | 0.922 | 0.418 | 0.972 | 0.747 |
| previous per-author model, PyTorch | 0.930 | 0.506 | 0.976 | 0.808 |
| rule parser | 0.069 | | 0.903 | |

Paired against the per-author model on gold500b (2,000 bootstrap resamples), CRediT exact changes
by -0.011 (95% interval -0.038 to +0.015) for seed 1 and -0.008 (-0.034 to +0.019) for seed 2, and
CRediT F1 by -0.004 and -0.001. Against the per-author int8 copy the app loaded, seed 2's w8 copy
changes CRediT exact by +0.004 (-0.019 to +0.031) and narrative exact by +0.029 (-0.017 to +0.071).

### int8 against w8

int8 (`quantize_dynamic`) quantises activations with one scale per call. A one-pass call holds
every author of the statement, and int8 lost pairs: on gold500b it matched the PyTorch model on
56.5% of narrative and 79.7% of CRediT articles, and CRediT exact fell from 0.801 to 0.747. A
threshold fitted to it did not win this back. w8 keeps activations in fp32 and stores the weights
of the linear layers in 8 bits in blocks of 32 (MatMulNBits) and the embedding table in int8. It
matched PyTorch on 88.7% of narrative and 96.6% of CRediT gold500b articles, at 75 MB against
int8's 70 MB, so w8 is the copy the app loads.

### Speed

In Chromium with 4 threads on eight desktop cores, 20 authors: the one-pass w8 copy reads a
164-token statement in 0.80 to 0.90 s and a long statement (2 chunks) in 2.8 to 3.5 s. The previous
per-author int8 model took 2.5 to 2.7 s and 21.6 to 24.0 s. The model loads in 2.8 s cold and
1.1 s from the cache.

## Limitations

- **Extra roles.** Most remaining errors are roles added to authors who do hold other roles, such
  as methodology next to formal analysis.
- **Rare roles in narrative text.** Data curation, software and validation are worded in many ways
  and are rare in narrative statements; their F1 is lowest there.
- **Initials.** The author text guesses initials from the name, taking the last word as the
  surname. Bylines in other orders, and statements with swapped or misspelled initials, depend on
  the model reading the name itself.
- **Biomedical sources.** Europe PMC is biomedical by construction, and Frontiers and MDPI lead the
  training data. Outside biomedicine, narrative statements score about 0.08 F1 lower (see
  [Outside biomedicine](#outside-biomedicine)).
- **Labels.** The gold sets were made by language-model labellers with a vote and an adjudicator. A
  person checked 40 rows of the pilot set (36 right) and ruled on 4 of 40 sampled gold500b rows,
  which changed the definition. Nobody checked the test set by hand; a person ruled on the 5 split
  rows of ood200b. Part of the training data comes from publisher tags, which can name roles a
  statement never gives.
- **Long statements.** A statement is cut at 1,024 tokens less the room its authors need (at most a
  quarter), so very long statements lose more text than the per-author model's cut did.

## Licence

The weights are released under the MIT licence, the same as Ettin. The training text is CC BY 4.0
or CC0 articles from the Europe PMC open-access subset; the weights do not contain that text, and
no training text is published with them.

## How to cite

Cite CRediT Matrix as <https://doi.org/10.5281/zenodo.21213659> (metadata in
[`CITATION.cff`](https://github.com/simonvanlierde/credit-matrix/blob/main/CITATION.cff)). Cite
Ettin as [its model card](https://huggingface.co/jhu-clsp/ettin-encoder-68m) asks.
