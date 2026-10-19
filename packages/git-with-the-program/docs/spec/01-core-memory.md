# Spec 01 — Core Memory

Status: Designed · Machine schemas: [`schemas/assertion.schema.json`](../../schemas/assertion.schema.json), [`schemas/precedent.schema.json`](../../schemas/precedent.schema.json)

## 1. Two stores, two politics

| | **Program** | **Ledger** |
|---|---|---|
| Location | `.program/` (in-tree) | `refs/program/ledger` (out-of-tree ref) |
| Nature | Normative — the law | Observational — the evidence |
| Writers | Humans, via reviewed/ratified PRs | Machines, append-only |
| Churn | Low | High |
| Clone/fork | Travels with every clone | Opt-in fetch; forks inherit the law, not the surveillance |

Mixing them is how you end up with bots committing to governance files. The split is the first invariant of the framework itself (see this repo's `.program/invariants.yaml`, INV-001).

## 2. `.program/` layout

```
.program/
  manifest.yaml     # schema_version, distillation watermark (last SHA walked)
  charter.md        # prose intent — the source, what humans ratify and judges read for spirit
  invariants.yaml   # enforceable assertions — the compiled program
  trajectory.yaml   # directional intents and deprecation horizons
  precedents.yaml   # case law: patterns killed, disputes settled
  scope.yaml        # what the program claims — the obsolescence baseline
```

`charter.md` **compiles to** `invariants.yaml`: prose is what humans ratify and what LLM judges read for context; invariants are the addressable, enforceable form. The relationship is blueprint → workflow.

## 3. The assertion atom

Everything hangs off stable IDs so surprise can accumulate against a specific claim over months.

```yaml
- id: INV-007
  statement: Core stays dependency-free; adapters own all third-party imports
  class: boundary            # boundary | dependency | interface | behavior | convention
  scope: ["core/**"]
  enforcement: judgment      # deterministic | judgment | hybrid
  precision: 0.9             # surprise weight per violation (synaptic weight)
  budget: 3.0                # accumulated surprise before a proposal fires (threshold)
  half_life: 90d             # decay constant for accumulated surprise (leak)
  status: ratified           # inferred → ratified → contested → amended | retired
  provenance: [pr#41, adr-0003, commit abc123]
```

Field semantics:

- **`class`** routes to a judge family and shapes the evidence the judge is shown.
- **`enforcement`** places the assertion on the judgment ladder (spec 03): `deterministic` = compiled rule, runs on every push; `judgment` = LLM magistrate at PR granularity; `hybrid` = deterministic prescreen gates the LLM call.
- **`precision` / `budget` / `half_life`** are the predictive-processing knobs made explicit: cost per deviation, error threshold that converts drift into a proposal, and decay so ancient one-offs never trip the wire. Tuned **per-assertion**, which is what kills recommendation fatigue. Parameters are program (normative, human-set); accumulator *state* is ledger.
- At bootstrap, `precision` is **seeded empirically** by distillation from evidence strength (spec 04 §5) and may be overridden at ratification.

## 4. Two non-negotiable field rules

1. **No assertion without provenance.** Distillation and humans alike must cite the commits, PRs, issues, or ADRs an assertion rests on. An assertion without provenance is unreviewable and therefore unratifiable.
2. **`status` is a lifecycle, not a flag.**
   - `inferred` — all distillation may emit. Not enforced.
   - `ratified` — human-promoted only. Enforced.
   - `contested` — set automatically when a reprogramming PR opens against the assertion. **Enforcement mutes** while contested: you don't keep citing someone for a law under active renegotiation.
   - `amended` / `retired` — terminal states of a contest or an obsolescence ruling; the assertion's history remains in git.

## 5. Precedents — the regression memory

Mined from reverts, fix-commits, and litigated PR threads; each entry is settled case law with ground truth attached.

```yaml
- id: PRE-003
  pattern: retry logic inline in request handlers
  ruling: killed             # killed | affirmed | coincidence
  rationale: centralized in middleware after cascade incident
  evidence: [revert 9f2c1d, issue#88]
```

Precedents serve three masters: the **regression judge** matches diffs against `killed` patterns (spec 03 §7); the **bar exam** uses settled cases to calibrate any new judge (spec 03 §6); and `ruling: coincidence` records a human's rejection of an inferred regularity so re-distillation can't resurrect it (spec 04 §6).

## 6. Trajectory and scope — the obsolescence baseline

- `trajectory.yaml` entries carry directional intent plus `implies_obsolete: [paths]` and optional deprecation horizons.
- `scope.yaml` declares which paths the program currently claims and supports.

**Obsolescence is not "old code."** It is code whose only support in the program has expired: in tree, but unclaimed by `scope.yaml` across N distillation epochs, or explicitly obsoleted by a trajectory entry whose horizon has passed. Detection is a scheduled sweep, not a commit trigger (spec 02 §7).

## 7. Manifest

```yaml
schema_version: 0.1.0
watermark:
  last_walked: <sha>         # distillation resumes from here
  last_epoch: e6
judges:                       # seated judges are part of the program (spec 03 §6)
  - id: invariant-judge
    model: <model-id>
    prompt: sha256:<hash of prompts/invariant-judge.md>
```

Changing `judges` — model id **or** prompt hash — is seating a new judge and requires a ratified PR plus a passing bar exam.
