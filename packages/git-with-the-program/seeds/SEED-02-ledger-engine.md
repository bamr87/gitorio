# SEED-02 — Ledger engine

Prerequisite: SEED-01 merged. Read `docs/spec/02-ledger.md`, ADR-0002, ADR-0004.

## Objective
Implement the event-sourced ledger on `refs/program/ledger` and the accumulator fold.

## Deliverables
1. **Event store**: write/read content-addressed events under `events/` in the ledger ref. Canonical serialization → sha256 → filename. Writes are push-with-retry (fetch → merge-as-set-union → fast-forward push). Idempotent by construction.
2. **Fold**: deterministic accumulator computation per assertion — `A ← A·2^(−Δt/half_life) + precision_at·severity` over violating events, committer-time decay, supersession chains resolved to tips, aligned/abstain excluded, compliance counter maintained. Materialize to `accumulators/` as cache; a `--replay` flag recomputes from scratch with overridden knobs (counterfactual mode).
3. **Firing detector**: threshold crossing + hysteresis (re-arm below 50% budget). On fire, compute dispersion stats (author entropy, path entropy, time spread, compliance ratio) over contributing events and emit a Proposal object routed per spec 02 §5. v0 delivery: open a GitHub issue via the adapter containing the full evidence bundle.
4. **CLI**: `gwtp ledger append|fold|replay|status`.

## Constraints
- No mutation or deletion of events, ever (INV-002). Corrections supersede.
- The fold must be pure: same event set + same knobs → identical accumulator state, verified by a property test.
- Author identity appears ONLY in dispersion computation at firing time — never in anything a judge could read (INV-003).

## Acceptance
- Property tests: idempotent double-append; set-union merge of two divergent ledger refs; fold determinism; decay math against hand-computed fixtures (include the 8-month/90d ≈ 15% case).
- Simulated concurrent writers converge to one event set.
- A synthetic event stream crosses budget and files a correctly-bundled issue; a rejected proposal path writes an `affirmed` precedent and raises precision.
