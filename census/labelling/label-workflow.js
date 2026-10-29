export const meta = {
  name: 'credit-label-defb',
  description: 'Definition-B labels: 3 blind Opus labellers x chunks, gate-checked, majority vote, adjudicator on splits',
  phases: [
    { title: 'Label', detail: '3 blind labellers, each chunk gate-checked by the labeller' },
    { title: 'Vote', detail: 'vote_b.py: agreement and splits' },
    { title: 'Adjudicate', detail: 'one adjudicator settles the splits, then the gold file' },
  ],
}

// args: { census, name: 'pilot200b', rows: 200, chunk: 100, labellers: 'abc', model }. Input is oa-2026-10-<name>.csv.
// With fewer than three labellers the run stops after labelling (a cost or model probe).
const NAME = args?.name ?? 'pilot200b'
const ONLY = args?.labellers ?? 'abc'
const MODEL = args?.model
const ROWS = args?.rows ?? 200
const CHUNK = args?.chunk ?? 100
// The runner has no filesystem API, so the census folder comes in as an absolute path: args.census.
if (!args?.census) throw new Error('pass args.census, the absolute path of the census folder')
const CENSUS = args.census
const LAB = `${CENSUS}/data/labels`
const PY = `${CENSUS}/.venv/bin/python`
const S = `${CENSUS}/labelling`
const INPUT = `${LAB}/oa-2026-10-${NAME}.csv`

const LABELLERS = [
  { id: 'a', order: 'in file order, first row to last' },
  { id: 'b', order: 'in reverse order, last row of your chunk first' },
  { id: 'c', order: 'in file order, but read the whole statement and the author list twice before writing each label' },
  { id: 's', order: 'in file order, first row to last' }, // probe labeller for model comparisons, never voted
]

const reading = `Read these first, in full: ${S}/definition-b.md (the definition, mapping table and label format) and ${LAB}/defB-worked-examples.jsonl (16 rows labelled under it and checked by the project owner, each with a "why"; look up each one's statement and authors in ${LAB}/oa-2026-10-set2000.csv by pmcid). The worked examples are the reference.`

const labelBrief = (L, first) => `You are labeller ${L.id.toUpperCase()}, one of three independent blind labellers building CRediT (Contributor Roles Taxonomy) labels for author contribution statements. Do not read the other labellers' files in ${LAB}/${NAME}-parts, any other labels file in ${LAB} (old gold columns follow a different definition), or run the census parser or model: the point is an independent, careful reading.

${reading}

Input: ${INPUT} (CSV, utf-8-sig, columns pmcid, authors, text). Your chunk is data rows ${first} to ${first + CHUNK - 1} (0-based, after the header); read them with a short python3 csv script, e.g. rows[${first}:${first + CHUNK}]. 'authors' is a numbered list "1. Name | 2. Name | ..."; 'text' is the statement. Label ${L.order}. Label every row yourself by reading it: never write a script that guesses labels from keywords. Copy each quote from the text programmatically or exactly; the gate rejects any quote that is not an exact substring.

Output: ${LAB}/${NAME}-parts/opus-${L.id}-${first / CHUNK}.jsonl, utf-8, one line per row of your chunk: {"pmcid": "...", "label": [...], "confidence": "high" | "low", "notes": "short reason when low, else empty"}. Then run the gate:
  ${PY} ${S}/check_b.py ${INPUT} <your file> ${first} ${CHUNK}
It prints "ok ${CHUNK}" or each fault. Fix every fault and rerun until it prints ok. Return the counts.`

const LABEL_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    rows: { type: 'integer' },
    empty_labels: { type: 'integer' },
    low_confidence: { type: 'integer' },
    gate: { type: 'string', description: "the gate's last output line" },
  },
  required: ['file', 'rows', 'empty_labels', 'low_confidence', 'gate'],
}

phase('Label')
const jobs = []
for (const L of LABELLERS.filter(L => ONLY.includes(L.id))) for (let first = 0; first < ROWS; first += CHUNK) jobs.push({ L, first })
const done = (await parallel(jobs.map(j => () =>
  agent(labelBrief(j.L, j.first), { label: `label:${j.L.id}-${j.first / CHUNK}`, phase: 'Label', schema: LABEL_SCHEMA, ...(MODEL && { model: MODEL }) })
    .then(r => r && { job: `${j.L.id}-${j.first / CHUNK}`, ...r })))).filter(Boolean)
const failed = done.filter(d => !d.gate.startsWith('ok')).map(d => d.job)
const missing = jobs.map(j => `${j.L.id}-${j.first / CHUNK}`).filter(k => !done.some(d => d.job === k))
log(`${done.length}/${jobs.length} chunks written${missing.length ? '; missing ' + missing.join(', ') : ''}${failed.length ? '; gate failed ' + failed.join(', ') : ''}`)
if (missing.length || failed.length || ONLY.length < 3) return { done, missing, failed }

phase('Vote')
const vote = await agent(`Run exactly this command and return its full output verbatim, nothing else:
  cd ${CENSUS} && ${PY} ${S}/vote_b.py ${NAME}`, { label: 'vote', phase: 'Vote', effort: 'low' })
log(vote)

phase('Adjudicate')
const adjudicated = await agent(`You are the adjudicator for a CRediT labelling set. ${reading}

${LAB}/${NAME}-splits.jsonl holds the rows where three blind labellers (a, b, c) gave three different labels: each line has pmcid, authors, text and the three labels. Agreement means the same (author, role, evidence) triples, degrees and pledges. For each row, read the statement and the author list yourself, judge which label follows the definition and the worked examples (or write your own when none does), and write ${LAB}/${NAME}-adjudicated.jsonl, one {"pmcid": "...", "label": [...], "notes": "which labeller was right and why, one line"} per split. If the splits file is empty, write an empty file.

Then run the gate on it, fixing faults until it prints ok:
  ${PY} ${S}/check_b.py ${INPUT} ${LAB}/${NAME}-adjudicated.jsonl partial
and then build the gold file:
  cd ${CENSUS} && ${PY} ${S}/vote_b.py ${NAME}
Return the vote's last two lines and the three most common reasons labellers split.`, { label: 'adjudicate', phase: 'Adjudicate' })
return { done, vote, adjudicated }
