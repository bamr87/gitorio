# Plan: SHA-Pinned Actions Mode

> Companion to `spec.md`.

## 1. Architecture Overview

A pure, opt-in transform inside the existing emission path: a curated ref→SHA table, a `pinRef` wrapper at the three `uses:` sites, and a post-stringify comment annotator.

## 2. Component Changes

| Layer | File / Module | Change |
|-------|---------------|--------|
| Types | `app/src/blueprint/types.ts` | `BlueprintMeta.pinActions?: boolean` |
| Compiler | `app/src/compiler/compile.ts` | `PINNED_ACTIONS` table + `pinRef` + `annotatePins`; `CompileOptions.pinActions` |
| Schema | `schema/blueprint.schema.json` | `meta.pinActions` boolean |
| Docs | `docs/ARCHITECTURE.md` §5 | mode described |

## 3. Blueprint & Schema Changes

One optional meta boolean; existing blueprints unaffected (FR-3).

## 4. Tech Choices & Alternatives

| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|-------------------------|-----|
| SHA source | Static curated table | API lookup at compile/deploy | Purity + determinism (golden rule #3); refresh is an explicit, reviewable act |
| Tag comment | Post-stringify textual pass | Comment inside the scalar | The YAML emitter would quote ` # `, corrupting the ref |
| Scope | Opt-in flag | Always pin | Target repos own their pin-vs-tag convention |

## 5. Least Privilege & Permissions

No changes — the mode alters ref immutability, not capability.

## 6. Loop Guards & Untrusted Input

No changes; asserted indirectly by FR-3 byte-identity for unpinned output.

## 7. Test Strategy

Five invariants: pinned agent+checkout refs w/ comments, unpinned byte-behavior, opts override, fetch-metadata pin, and the two-way drift guard reading the compiler source.

## 8. Rollout

Feature ships dormant (no committed blueprint sets the flag); operators opt in per blueprint.

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Stale pins | med (over months) | low | documented re-verify command; follow-up wires it into `/compile-check` |

## 10. Estimated Effort

One loop cycle (done).
