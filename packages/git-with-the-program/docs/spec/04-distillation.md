# Spec 04 — The Distillation Walk

Status: Designed · Bootstraps: `.program/` (candidates), `precedents.yaml`, judge calibration corpus, ledger backfill

## 0. Orientation

Distillation is the detection loop run in reverse: instead of scoring observations against a fixed model, it **infers the model from observations**. The live loop filters forward; distillation smooths backward. Steady state, distillation shrinks to spotting new epochs and long-tail candidates; cold start, it is the whole bootstrap.

Two passes with a strict division of labor: a **deterministic miner** that finds regularities, and an **LLM synthesizer** that *names laws*. Never let the expensive pass do the cheap pass's job.

## 1. Epoch segmentation — boundaries aren't dates

Epochs are found by **change-point detection on the repo's own statistics**: README/doc rewrites, dependency-manifest upheavals, directory renames, churn spikes, CODEOWNERS shifts, CI-config overhauls. Structural breaks, not calendar time.

Volatility sets the learning rate: a repo fresh off an upheaval discounts its own past steeply; a stable one lets old evidence keep its weight.

## 2. Pass one — the deterministic fact base (exhaustive)

Walk every commit; no LLM. Produce:

- file **co-change graph**
- **import graphs** at each epoch boundary
- **dependency manifest diffs** over time
- **revert pairs** (`This reverts commit …`) and fix-commit → issue links
- **directory lifecycles** (created / renamed / deleted)
- **author-file matrix**
- **doc snapshots** (README, ADRs, CONTRIBUTING) at each epoch boundary

**The strongest laws live in negative space.** No third-party import *ever* crossing into `core/` across four years is a firmer statute than anything written down — and absence is exactly what a deterministic pass can prove exhaustively. Revert pairs and litigated PR threads fall out here too: that is `precedents.yaml` and the judges' bar exam, mined for free.

Forge metadata (PR threads, review comments, issue links) enters through an adapter; a bare repo degrades gracefully to commits-only.

## 3. Pass two — map-reduce synthesis over epochs

Parallel agents, one per epoch. Each reads its epoch's doc snapshot, top-churn diffs, contested PR threads, and fact-base aggregates, then emits **candidate assertions with provenance**. A merge agent dedupes: the same law surfacing independently in three epochs merges provenance and strengthens evidence.

**Recency asymmetry:** the final epoch writes the statute; earlier epochs contribute only precedents and trajectory. Old history is case law, not current law. Trajectory candidates come from deltas between epoch charters (e.g., monolith → adapters visible across e2 → e4) plus deprecation annotations and issue milestones.

## 4. Distillation may only emit `inferred`

Every candidate is `status: inferred`, never enforced, never self-ratifying. The human is the constitutional author; inferred intent is noisy by construction.

## 5. Empirical precision seeding

Evidence strength seeds `precision` — the prior's confidence comes from the data that formed it:

```yaml
- id: CAND-014
  statement: core/ imports stdlib only; adapters own third-party deps
  evidence:
    span: 2022-03 → present            # violation-free duration
    corroborations: [import-graph e3..e6, pr#88, revert 9f2c1d]
  precision_seed: 0.85                  # derived, not hand-set
  status: inferred
```

Inputs to the seed: violation-free span, number of independent corroborations, cross-epoch persistence. Humans may override at ratification.

## 6. The ratification ritual

Delivered as a **PR proposing `.program/`**, provenance rendered inline as commit and thread links, per-assertion **accept / edit / reject**.

Two rules keep it from becoming rubber-stamping:

1. **Constitutional minimalism.** Rank candidates by evidence and ship only the top ~12. A sixty-assertion day-one program gets skimmed; a twelve-assertion one gets read. The long tail arrives by amendment once the live loop runs.
2. **Rejections are tombstoned** in the ledger (`ruling: coincidence` precedent), so the next walk can't resurrect a law the humans already declined. A rejected regularity is a ruling: *coincidence, not statute*.

## 7. Priming the ledger — backfill is safe by construction

After ratification, replay the **current epoch** through the judges. Because decay runs on **committer time** (spec 02 §3), backfilled events arrive pre-decayed: an eight-month-old breach against a 90-day half-life lands at ~15% strength. The leaky integrator absorbs history without firing on stale news — but if drift is *currently* underway, the accumulators start **warm instead of blind**.

Cost control: deterministic-class backfills fully; judgment-class at merge granularity only.

## 8. The watermark and steady state

`manifest.yaml` records the last SHA walked; subsequent walks process the delta. Steady-state distillation's remaining jobs: detect new epochs from live statistics, surface long-tail candidates that the live loop's dispersion stats hint at, and propose knob retunes justified by ledger replay.
