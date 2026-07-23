# Glossary

**Program** — the repo's normative core memory in `.program/`: charter, invariants, trajectory, precedents, scope, manifest. Sacred: human-ratified PRs only.
**Ledger** — observational store at `refs/program/ledger`: content-addressed events + derived accumulators. Profane: machine-append-only.
**Assertion** — one enforceable law with stable id, class, scope, enforcement tier, and knobs (precision, budget, half_life).
**Precision** — surprise weight per violation; the cost of one deviation.
**Budget** — accumulated-surprise threshold that converts drift into a proposal.
**Half-life** — decay constant of accumulated surprise; committer-time basis. Decay is the only forgiveness.
**Verdict** — a judge's ruling: aligned | drift | regression | stale-claim | abstain.
**Drift** — change diverging from a ratified assertion.
**Regression** — reintroduction of a pattern previously killed (see Precedent).
**Obsolescence / stale-claim** — code whose only support in the program has expired; detected by scheduled sweep, accumulates from silence.
**Abstain** — honest insufficiency; never accumulates, always escalates.
**Anchored severity** — grazes | bends | breach | entrenches → 0.25/0.5/0.75/1.0.
**Accumulator** — per-assertion leaky integrator: A ← A·2^(−Δt/τ½) + p·s.
**Dispersion** — author/path entropy + time spread of contributing evidence; decides refactor vs. reprogram at firing.
**Reprogramming proposal** — a PR against `.program/` arguing the law, not the code, is wrong. Sets the assertion `contested`; enforcement mutes.
**Precedent** — settled case law: killed | affirmed | coincidence. Doubles as the judges' bar exam.
**Tombstone** — a `coincidence` precedent recording a rejected inferred regularity so re-distillation can't resurrect it.
**Bar exam** — replay of settled precedents that any new judge (model or prompt change) must pass before seating.
**Epoch** — a history segment between structural change-points; distillation's unit of parallelism.
**Watermark** — last SHA distilled; walks resume from here.
**Hysteresis** — post-fire re-arm only below ~50% budget; nothing flaps.
**Governance debt** — accumulated staleness of ignored proposals.
