# SEED-04 — Distillation walk

Prerequisite: SEED-03 merged. Read `docs/spec/04-distillation.md`.

## Objective
Implement the cold-start bootstrap: fact miner, epoch segmentation, synthesis agents, ratification PR generator, ledger backfill.

## Deliverables
1. **Pass one — fact miner** (deterministic, exhaustive): co-change graph, import graphs at epoch boundaries, dependency-manifest diffs, revert-pair and fix→issue extraction, directory lifecycles, author-file matrix, doc snapshots. Output: a fact base on disk, replayable.
2. **Epoch segmentation**: change-point detection over repo statistics (doc rewrites, manifest upheavals, renames, churn). Pluggable detector; a simple multi-signal z-score break finder is acceptable for v1 of this pass.
3. **Pass two — synthesis**: per-epoch agent prompts consuming (doc snapshot + top-churn diffs + litigated threads + fact aggregates) → candidate assertions with provenance; merge agent dedupes and merges provenance across epochs; recency asymmetry enforced (final epoch → statute candidates; earlier → precedent/trajectory candidates only).
4. **Empirical precision seeding** from violation-free span + corroboration count + cross-epoch persistence.
5. **Ratification PR generator**: top ~12 candidates by evidence, provenance rendered as links, per-assertion accept/edit/reject checklist. Rejections write `ruling: coincidence` tombstone precedents.
6. **Backfill**: replay current epoch through seated judges — deterministic class fully, judgment class at merge granularity — events carrying committer time so decay applies on arrival. Advance the manifest watermark.

## Constraints
- Distillation emits `status: inferred` only. It may never touch a ratified assertion.
- Tombstoned regularities must be checked before proposing any candidate.
- LLM cost guard: hard cap on judged merges per backfill run, configurable.

## Acceptance
- Run against a real mid-size OSS repo fixture: fact base builds; ≥2 plausible epochs found; candidates all carry provenance; ratification PR renders; rejecting a candidate then re-running does not re-propose it; backfilled accumulators show pre-decayed values matching hand computation.
