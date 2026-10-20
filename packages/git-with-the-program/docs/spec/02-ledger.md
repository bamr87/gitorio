# Spec 02 — The Ledger

Status: Designed · Machine schema: [`schemas/event.schema.json`](../../schemas/event.schema.json)

## 1. Substrate: a dedicated ref, event-sourced

The ledger lives at **`refs/program/ledger`** — its own commit chain, invisible to branch listings, pushable by CI without touching working branches. Not git notes: notes are keyed per-commit, but surprise is keyed per-assertion — wrong index.

Tree layout:

```
events/
  <sha256-of-event>.yaml     # one file per observation; filename = content hash
accumulators/
  <assertion-id>.yaml        # derived cache — a deterministic fold over events/
epochs/
  <epoch-id>.snapshot.yaml   # compaction snapshots (§8)
```

The event-sourced, content-addressed design buys three properties:

1. **Conflict-free concurrency.** Concurrent CI runs pushing simultaneously merge as set union — content-addressed events cannot conflict. Push with fetch → fast-forward → retry.
2. **Deterministic derivation.** Accumulator state is a fold over the event set: recomputable at will, cacheable, never authoritative.
3. **Replay.** Retune a `half_life` or `precision` retroactively and recompute; run counterfactuals ("what fires under budget 2.0?") without losing anything. The observer itself is versioned and tamper-evident.

## 2. The observation record

```yaml
event: sha256:…              # hash of canonical body = filename = idempotency key
subject: {commit: 9f2c1d, pr: 214}
assertion: INV-007
verdict: drift               # aligned | drift | regression | stale-claim | abstain
severity: 0.75               # numeric mapping of the anchored ordinal (spec 03 §4)
precision_at: 0.9            # assertion precision frozen at observation time
judge: {kind: model, id: <model-id>, prompt: sha256:…}
rationale: sha256:…          # blob ref; full text retained out of the hot path
t: 2026-07-21T14:03Z         # committer time, not observation time
supersedes: null             # event id when re-judging (§3)
```

## 3. Rules that keep the fold safe

- **Verdicts are recorded facts.** LLM judges are stochastic; the fold is deterministic anyway because it folds *recorded verdicts*, not judgments. Re-judging emits a **superseding event** (`supersedes: <event-id>`) — never an edit, never a deletion. The fold takes the tip of each supersession chain.
- **Decay runs on committer time**, so history backfills land in the right epoch and arrive pre-decayed (spec 04 §7). Events pointing at rebased-away SHAs are kept — a rewritten commit is itself information; mark orphaned, keep folding.

## 4. Accumulation: a leaky integrator

Per assertion, on each **violating** event (drift / regression / stale-claim; never aligned, never abstain):

```
A ← A · 2^(−Δt / half_life)  +  precision_at · severity
```

This is a leaky integrate-and-fire unit: precision is synaptic weight, half-life the membrane time constant, budget the firing threshold, the proposal is the spike.

**One deliberate asymmetry: aligned events do not pay down the accumulator.** Otherwise high-traffic repos never fire and compliance launders violations. **Decay is the only forgiveness.** Compliances are *counted* — the violation-to-compliance ratio ships in every proposal as evidence quality — but they subtract nothing.

`abstain` never accumulates; it escalates (spec 03 §4).

## 5. Firing: dispersion decides direction

When `A ≥ budget`, compute dispersion statistics over the contributing (undecayed-weighted) events:

- **author entropy** — how many independent hands
- **path entropy** — one seam or many call sites
- **time spread** — a tight burst or sustained pressure

Then:

| Evidence pattern | Attribution | Output |
|---|---|---|
| Low author/path entropy, tight window | The code is wrong | **Refactoring recommendation** (issue or patch PR). Assertion stands. |
| High entropy, sustained over months | The law is wrong | **Reprogramming proposal** — a PR against `.program/`. Assertion → `contested`, enforcement mutes. |

One person drifting versus the org outvoting the statute, distinguished by statistics instead of vibes. Every proposal ships its evidence: contributing events, dispersion stats, compliance ratio, decay-weighted total.

## 6. Post-fire lifecycle

- **Hysteresis, not reset.** Re-arm only after the accumulator decays below ~50% of budget. Nothing flaps.
- **Outcomes are events too:**
  - Proposal **rejected** → new precedent (`ruling: affirmed`), and the assertion's `precision` *rises* — a law ratified under fire is a stronger prior.
  - Proposal **accepted** → amendment PR lands in `.program/`, assertion → `amended`, accumulator zeroes.
  - Proposal **ignored until stale** → recorded; staleness accumulates on its own meter: **governance debt**.

## 7. Triggers, tiered by judge cost

| Tier | Trigger | Assertions |
|---|---|---|
| Deterministic | every push | `enforcement: deterministic` and `hybrid` prescreens |
| Judgment | PR-merge granularity | `enforcement: judgment` and escalated `hybrid` |
| Obsolescence sweep | scheduled (e.g., weekly) | scope claims and trajectory horizons |

**Obsolescence never triggers on commits** — it accumulates from *silence*. The sweep compares tree against `scope.yaml` and trajectory `implies_obsolete`, emitting `stale-claim` events into slower accumulators keyed by scope claim.

## 8. Compaction and fork semantics

- **Epoch compaction:** snapshot accumulator state at epoch boundaries; pack events older than N epochs into a summary (retain hashes for audit). Replayability argues for generous retention — compact late.
- **Fork semantics fall out of git itself:** `.program/` travels with every clone; non-default refs don't fetch by default. Forks inherit the law and start their own ledger. **The program propagates; the surveillance doesn't.**
