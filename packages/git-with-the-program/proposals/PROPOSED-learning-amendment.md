# Proposed amendment to `.program/` — the learner joins the program's direction

**Raised by:** the RL drift-learning design session (agent — [`docs/proposals/rl-drift-learning.md`](../docs/proposals/rl-drift-learning.md)) **Status:** proposed — requires a human-ratified PR (INV-001) **Target:** `.program/charter.md` (Amendment 1), `.program/invariants.yaml` (Amendment 2, deferred until `src/learn/**` exists)

---

## Why this is a proposal rather than a commit

INV-001: nothing writes to `.program/` except human-ratified PRs. The design widens GWTP's purpose from *scoring* drift to *learning how well its scores predict outcomes* across phases of history, which is a change of direction the charter should state. Same shape as `PROPOSED-program-amendment.md` and `PROPOSED-nexus-amendment.md`: delivered as ready-to-apply diffs; a human applies them.

---

## Amendment 1 — charter *Direction* names the learner, and its limits

**Recommended once the proposal is accepted.**

```diff
--- a/.program/charter.md
+++ b/.program/charter.md
@@
-**Direction.** v0 is a *sighted* repo: hand-authored program, deterministic judges, live accumulators, issues on threshold crossings. LLM judges, dispersion- directed proposals, and the distillation walk follow in order (ROADMAP.md).
+**Direction.** v0 is a *sighted* repo: hand-authored program, deterministic judges, live accumulators, issues on threshold crossings. LLM judges, dispersion- directed proposals, and the distillation walk follow in order (ROADMAP.md). After them, an offline learner calibrates drift scores against observed outcomes (reverts, bug-fix chains, review verdicts, human-resolved counterbalance findings) on held-out phases of history and *proposes* knob retunes and calibrators; it never writes law, never learns online from its own outputs, never reads author identity, and is evaluated against an independent expected-path model (AI seed recipes) whose disagreements go to a human.
```

**Provenance line** (spec 01 §4 rule 1):

```
provenance: [docs/proposals/rl-drift-learning.md, docs/spec/04-distillation.md#8-the-watermark-and-steady-state, adr-0002, ROADMAP.md#v2--the-institution, pr#<this PR>]
```

## Amendment 2 — INV-003 covers the learner's outputs (deferred)

When `src/learn/**` exists: add a deterministic check that no module in INV-003's scope imports `src/learn/**`, so calibrated probabilities can reach the fold but never a judge. Diff to be drafted against the real file at that time; recorded here so the obligation is not forgotten.
