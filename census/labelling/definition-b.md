# Definition B: who did what, in any wording

A label says which author did which CRediT role, as the statement says it, whether the statement uses
the CRediT names or its own words. Every claim in a label is grounded in an exact quote, and says how
directly the statement made it.

## The 14 roles

Written exactly so: conceptualization, data curation, formal analysis, funding acquisition,
investigation, methodology, project administration, resources, software, supervision, validation,
visualization, writing - original draft, writing - review & editing.

## Label format

One JSON object per row: `{"pmcid": "...", "label": [assertion, ...]}`. A statement that says
nothing about who did what gets `"label": []`.

A **role assertion**:

```json
{"quote": "MS contributed to metabolomic analysis", "mentions": ["MS"], "authors": [2],
 "roles": [{"role": "formal analysis", "evidence": "worded"}], "resolved_by": "order"}
```

- `quote`: an exact, character-for-character substring of the statement. Copy it, never retype it.
- `mentions`: the people as the statement writes them ("MS", "All other authors", "Lena Voss").
- `authors`: author numbers from the numbered author list. See "Matching authors".
- `roles`: one entry per role, each with `evidence`, and `degree` + `degree_evidence` when there is
  one.
- `resolved_by: "order"` (optional): see "Matching authors".
- `others_of` (optional): see "Group words".

A **pledge assertion**: `{"quote": "...", "mentions": ["All authors"], "authors": [1, 2, 3], "pledge": "icmje"}`.

## Evidence

Evidence is recorded for every role and degree, but the vote does not compare it and the model
does not train on it. Give your best reading and move on.

For a role:

- `named`: the CRediT name or a near form ("Conceptualization", "developed the methodology",
  "supervision", "writing - review and editing", "reviewing and editing").
- `worded`: the statement's own wording, mapped by the table below ("designed the study",
  "collected the data", "wrote the manuscript").
- `inferred`: vague or implied ("chief investigators" -> supervision; "supported H.H. with
  validation" implies H.H. did validation).

For a degree:

- `named`: "[Lead]", "(Equal)", "(supporting)" written as CRediT degrees.
- `worded`: "led", "primarily responsible", "assisted", "helped", "supported", "contributed equally in
  <roles>".
- `inferred`: "most", "the majority of" (-> lead), "some" (-> supporting).

## Degree rules

- `lead`, `equal` or `supporting`, only when the statement says or implies it. Most roles have none.
- "Contributed equally", "equal first authors", "share the first authorship" describe author order:
  no degree. But "contributed equally in the conceptualisation, methodology, ..." attaches to those
  roles: worded `equal` on each.
- "Led the team", "led the research team" is the supervision role itself: supervision with no degree.
  "Led the development of X" or "X was led by" gives X with a worded `lead`.
- "Helped" said of all authors gives no degree: there is no one to support.

## Mapping narrative wording (NISO 2026 CRediT role examples)

| Narrative wording | Role |
|---|---|
| conceived, came up with the idea, formulated the hypothesis, "concept" | conceptualization |
| designed the study or experiments, developed the protocol, study design, planned the study or research | methodology |
| performed the experiments, collected or acquired the data, fieldwork, searched or reviewed the literature, screened studies | investigation |
| analysed or interpreted the data, statistics, "interpreted the results" alone | formal analysis |
| managed, cleaned, curated or organised the data | data curation |
| wrote, drafted or prepared the manuscript or a section of it, "writing" | writing - original draft |
| revised, edited, commented on, reviewed, critically reviewed or critically revised the manuscript | writing - review & editing |
| supervised, led the team, oversaw, PI | supervision |
| obtained or secured funding | funding acquisition |
| provided samples, patients, reagents, equipment or compute, "technical or material support" | resources |
| made the figures | visualization |
| wrote the code, built the pipeline, developed software | software |
| recruited or selected participants or patients, coordinated or organized the project, the fieldwork, data collection or the writing process, project management, "administrative support" | project administration |
| verified, replicated, did pilot tests, ensured methodological rigor, assessed the quality of included studies | validation |

House rules on top of NISO:

- Data extraction in a systematic review (reading papers, filling in a form) is investigation. If
  the statement says a script extracted it, it stays software.
- "Ensured methodological rigor" is validation only, not methodology.
- Software that visualizes is software, not visualization, unless the statement says the person
  made figures.
- Map only what the statement says. A role a sentence does not name or describe is left out, even
  if it seems likely.
- Supervising, guiding or overseeing a task is supervision, not the task: "guided N.H. in the
  statistical analysis" and "supervised the validation study" give supervision only.
- Obtaining or collecting samples within the study is investigation ("obtained the samples from the
  recruited patients"); providing or supplying them is resources.
- Planning the manuscript is writing, not methodology: "contributed to the ideation, planning and
  drafting of the manuscript" gives original draft.
- "Wrote the manuscript with input from all authors" (or "with contributions from all authors", "all
  authors contributed to the text / to the final version") gives the other authors review & editing.
- When a statement gives examples in brackets ("technical support (constructing databases)"), map
  the examples, and the category word only when it maps on its own.

## No role

- "Approved the final version", "final approval", "read and approved", "reviewed and approved"
  (approval wording).
- "All authors contributed to the article / to the work / to this study" with no task named.
- "Agrees to be accountable for all aspects of the work".
- "Discussed the results", "participated in the discussion" on its own: discussing is not analysis.
  "Discussed and interpreted the results" still gives formal analysis.
- Either-or lists said of everyone: "all authors participated in the planning, execution, or
  analysis of the study" says no one did any one of them.
- Clinical or other non-research tasks: "primary physician", "contributed clinical input".
- People who are not in the author list (acknowledged people, consortia) get nothing.

"Reviewed the manuscript" on its own is review & editing; only "reviewed and approved" (or "read and
approved") is approval wording. But "All authors have revised the manuscript", "all authors reviewed and edited", "All authors
interpreted the results, wrote, and reviewed the manuscript" name tasks, so every author gets those
roles.

## Pledges

Only wording of the ICMJE authorship criteria as a standalone claim is a pledge: "all authors meet
the ICMJE criteria", "all authors meet the authorship criteria as outlined in the Uniform
Requirements", "all authors made substantial contributions to conception and design, acquisition of
data, or analysis and interpretation; drafted or revised...; gave final approval" said of everyone
at once. A pledge gets `"pledge": "icmje"`, no roles.

ICMJE wording attached to a named person ("KLR contributed to conception and design, acquisition of
data...") is a description, not a pledge: map it to worded roles.

## Matching authors

- An author number goes in `authors` only when exactly one author fits the mention: by initials
  (including hyphenated and particle names: "JP-R", "TvdB"), by surname, by full name, or by a
  scoped group word.
- Never match by position alone, and never by near-miss initials: "K.R." does not match Ren Kai
  (R.K.), and "SSMT" does not match the only "SSM" author. Those stay unresolved.
- When initials fit several authors (two "MS") and the statement visibly names authors in byline
  order, the order of mention breaks the tie: the first "MS" is the earlier of the two in the byline.
  Mark that assertion `"resolved_by": "order"`.
- Otherwise leave `authors` empty (`[]`) and keep the `mentions`: unresolved, never guessed.

## Group words

- "All authors" gives every author number.
- "All other authors", "the remaining authors", "the rest": add `"others_of": [indexes]`, the
  0-based positions in your label of the assertions it contrasts with, and write the authors you
  think it covers. The gate computes the complement and refuses a mismatch, so check it.

## Worked examples

`census/data/labels/defB-worked-examples.jsonl` holds 16 rows labelled under this definition and
checked by Simon, each with a `why`. They are the reference: where they and this text seem to
differ, follow the examples and say so in your notes.
