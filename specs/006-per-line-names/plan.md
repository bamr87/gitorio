# Plan: Per-Line Names

> Companion to `spec.md`.

## 1. Architecture Overview

One naming seam: a `lineNames(bp, comps)` pure helper computing all component names at once (needed for collision suffixes), consumed by both `compile()` and `assemblyLines()`.

## 2. Component Changes

| Layer | File / Module | Change |
|-------|---------------|--------|
| Compiler | `app/src/compiler/compile.ts` | `lineNames()` + both call sites switched to the precomputed array |
| Types | `app/src/blueprint/types.ts` | `BlueprintMeta.lineNaming?: 'auto' \| 'indexed'` |
| Schema | `schema/blueprint.schema.json` | meta `lineNaming` enum |

## 3. Blueprint & Schema Changes

Optional meta enum; existing blueprints byte-identical (FR-3, tested).

## 4. Tech Choices & Alternatives

| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|-------------------------|-----|
| Name source | Agent promptRef basename | `lineName` field on triggers | The prompt file already IS the line's identity; a trigger field is ambiguous on multi-trigger lines and spreads across 7 machine types |
| Default | `indexed` (opt-in auto) | Always auto | Silent renames orphan deployed files and detach run history |

## 5. Least Privilege & Permissions

None — naming only.

## 6. Loop Guards & Untrusted Input

None; promptRef is blueprint config (kebab-slugged before use in filenames).

## 7. Test Strategy

Five invariants: auto names (agent + deterministic lines), default byte-behavior, compile↔assemblyLines equality, collision suffixes, single-line stability.

## 8. Rollout

Feature ships dormant; the dogfood migration (factories 1–3 + gardener fold-in) is a deliberate follow-up redeploy.

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Orphaned old filenames after opting in | med (on migration) | low | documented; deploy-planner cleanup filed as follow-up |

## 10. Estimated Effort

One loop cycle (done).
