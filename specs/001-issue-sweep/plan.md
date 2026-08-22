# Plan: Issue Sweep

> Companion to `spec.md`. Describes **how** we will satisfy the requirements.

## 1. Architecture Overview

Eight independent fixes on disjoint file sets, executed as parallel agents (Fix stage) plus a serialized date-sweep (Sweep stage), with the compiler fix (FR-1) applied first from draft PR #37's tested diff since regenerated examples (FR-4) depend on final compiler output.

## 2. Component Changes

| Layer | File / Module | Change |
|-------|---------------|--------|
| Compiler | `app/src/compiler/compile.ts` | FR-1: `if (promptRef)` read grants + survey `gh pr checks` (ADR-023, from PR #37) |
| Compiler tests | `app/src/compiler/compile.test.ts` | FR-1 regression + invariant table (PR #37); FR-2 `filter.condition` + `sink.commit_files` describes |
| Schema | `schema/blueprint.schema.json` + `app/src/machines/schema.test.ts` (new) | FR-3 per-type config branches + drift guard |
| Examples | `app/scripts/regen-examples.ts` (new) + `examples/` | FR-4 deterministic regen + golden anchors |
| UI | `app/src/App.tsx`, Inspector, `ErrorBoundary` (new) + tests | FR-5 four fixes |
| Tooling | `app/eslint.config.js` (new), `.prettierrc.json` (new), `app/package.json`, `.github/workflows/ci.yml` build job | FR-6 lint toolchain + CI step |
| CI/CD | `.github/workflows/deploy-pages.yml` | FR-7 `workflow_run` gate on CI success |
| Tests | any `*.test.ts` with real-clock windows | FR-8 clock pinning |

## 3. Blueprint & Schema Changes

Per-type config branches added under the schema; committed blueprints re-validated in the new test; the registry `type`-enum drift guard untouched and green.

## 4. Tech Choices & Alternatives

| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|-------------------------|-----|
| FR-1 source | Adopt draft PR #37's diff verbatim (code + tests) | Re-derive the fix | The PR's fix is incident-tested with an invariant table; re-deriving re-risks it |
| FR-3 test | Dependency-free registry↔schema drift guard | ajv devDependency | No new runtime deps; matches the house drift-guard idiom |
| FR-6 scope | Rules tuned to current code; lint in CI, prettier advisory | Mass reformat | Churn hides real diffs; adopt incrementally (R-1) |
| FR-7 trigger | `workflow_run` on CI completed | `needs:` in one workflow | Deploy lives in a separate workflow; `workflow_run` chains without merging files |

No golden-rule deviations; ADR-023 records the FR-1 decision.

## 5. Least Privilege & Permissions

FR-1 adds only read-class tools (`Read`, `Glob`, `Grep`, `Bash(gh pr checks:*)`); no `permissions:` scope widens; the no-self-merge invariant is untouched. Everything else touches no grants.

## 6. Loop Guards & Untrusted Input

No trigger/sink semantics change; loop-guard emission is untouched (asserted by existing invariant tests). No new attacker-controlled input reaches any agent.

## 7. Test Strategy

Per-fix regression tests (FR-1 invariant table, FR-2 fragments, FR-3 drift guard, FR-5 component tests, FR-8 pinned-clock reruns); full suite + typecheck + build + new lint as the exit gate.

## 8. Rollout

Working-tree only (no commit until the user says so); deployed `factory--*.yml` recompile is a recorded follow-up since generated files are never hand-edited (golden rule #2).

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Parallel agents collide on a shared file | low | med | Explicit per-agent file ownership; `package.json`/`ci.yml` single-owner |
| ESLint findings demand code churn (R-1) | med | low | Tune rules off rather than mass-edit |
| Regen diff mistaken for drift (R-2) | low | low | Spec + ADR record that the diff is the FR-1 fix |

## 10. Estimated Effort

One session, six parallel fix agents + one sweep agent + orchestrator verification.
