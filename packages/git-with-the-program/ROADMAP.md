# Roadmap

## v0 — The sighted repo  (SEED-01 + SEED-02, deterministic slice of SEED-03)
Hand-authored `.program/`, deterministic judges only, live event ledger and accumulators, issues filed on threshold crossings with full evidence bundles. No LLM in the loop. **Exit test:** this repo runs it on itself; a staged INV-005 breach accumulates and files.

## v0.5 — The bench  (SEED-03)
LLM invariant judge seated via bar exam, panels + variance discounting, verdict cache, hybrid prescreens gating model calls. **Exit test:** a judgment-class assertion rules correctly on fixture PRs; degraded prompt fails seating.

## v1 — The governor  (proposal engine maturation)
Dispersion-directed outputs: refactor recommendations vs. reprogramming proposal PRs against `.program/`; contested lifecycle with enforcement muting; rejected proposals write affirmed precedents and raise precision; governance- debt meter for ignored proposals. **Exit test:** synthetic diffuse drift produces a reprogramming PR; concentrated drift produces a refactor issue.

## v1.5 — The historian  (SEED-04)
Distillation walk end-to-end on an external repo: fact base, epochs, candidate program, ratification PR, tombstones, pre-decayed backfill, watermark. **Exit test:** the SEED-04 acceptance run on a real OSS fixture.

## v2 — The institution
Bar-exam CI + golden-sample judge-drift checks on schedule; obsolescence sweeps live; knob-retune proposals justified by ledger replay; epoch compaction; packaging as a reusable GitHub Action for arbitrary repos.

## Deliberately deferred
Multi-repo/org-level programs; autonomy escalation (auto-merge refactors); non-GitHub forge adapters beyond the bare-git degradation path.
