# Seed 02 — Compiler v1

**Objective:** every v0 machine type compiles correctly; unsafe graphs are refused; output matches the reference example.

**Context:** docs/ARCHITECTURE.md §5 (spec) · examples/compiled/*.yml · app/src/compiler/compile.ts + compile.test.ts

**Tasks**
1. Re-verify the action interface first (golden rule #4): fetch action.yml and docs/usage.md from anthropics/claude-code-action; adjust step emission if drifted.
2. Implement/complete emitters for all 12 machine types incl. `trigger.issue_labeled` label guard, `trigger.pr_opened` optional synchronize, `filter.condition` AND-join.
3. Obligations engine: numbered obligations per downstream sink, allowedTools union, deterministic emission for trigger→sink chains without an agent.
4. Safety: loop-guard refusal (comment-ish trigger + writing sink must carry a bot
guard or compilation errors with a fix-it message); orphan components and unknown types produce diagnostics, never throws.
5. Tests: one invariant test per machine type + the refusal path + permissions and concurrency computation + hash stability (same blueprint → same hash).
6. Reconcile with examples/compiled/factory--issue-triage-line-1.yml — update either side deliberately and say why in DECISIONS.md.

**Acceptance:** ROADMAP Phase 2 boxes; `npm test` covers every emitter. **Out of scope:** belt mode (Phase 6), YAML import back to blueprint.
