# Charter — Git with the Program (this repository)

This repository builds a governance framework, so it governs itself first.

**Intent.** Produce a framework that keeps any repository's evolution in accordance with its program, and that can recommend amending the program when reality has already outvoted it. The repo's own structure must demonstrate the framework's principles: separated write paths, evidence-bearing rulings, and a constitution that changes only by ratified amendment.

**Boundaries.**
- Law and evidence never share a write path. `.program/` changes arrive only as
  reviewed, human-ratified PRs; the ledger ref is machine-append-only.
- The engine core stays forge-agnostic. GitHub-specific APIs (PR threads, issue
delivery) live behind an adapter boundary; a bare git repo must degrade gracefully to commits-only operation.
- Rulings are verifiable. Any component that emits a violation must cite the
  lines it rules on. Severity is expressed only in the anchored ordinal scale.
- History is never rewritten in the ledger; corrections supersede.

**Direction.** v0 is a *sighted* repo: hand-authored program, deterministic judges, live accumulators, issues on threshold crossings. LLM judges, dispersion- directed proposals, and the distillation walk follow in order (ROADMAP.md).
