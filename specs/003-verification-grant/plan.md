# Plan: Verification Grant

> Companion to `spec.md`.

## 1. Architecture Overview

A config-derived grant extension inside the existing agent emission path — no new machines, no new emit paths.

## 2. Component Changes

| Layer | File / Module | Change |
|-------|---------------|--------|
| Registry | `app/src/machines/registry.ts` | `checks` textarea field on `agent.claude` |
| Schema | `schema/blueprint.schema.json` | `checks: string` in the agent branch |
| Compiler | `app/src/compiler/compile.ts` | parse checks → quote-safety diagnostics → VERIFY note → per-check `Bash(<cmd>:*)` grants |
| Generator | `app/scripts/gen-aosdlc-factory.ts` | pilot + triage variants declare the two stdlib validators |
| law-ai | regenerated blueprints/workflows + prompt wording | FR-4 |

## 3. Blueprint & Schema Changes

Optional field; existing blueprints unaffected; drift guard green.

## 4. Tech Choices & Alternatives

| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|-------------------------|-----|
| Shape | Agent config field | `processor.verifier` machine | Checks run inside the agent's loop, not as a pipeline stage |
| Grant | Literal `Bash(<cmd>:*)` per line | `Bash(python3:*)` | Golden rule #5 — narrow beats interpreter-wide |
| Safety | Compile error on `"`/backtick/`$( )` | Escaping | Escaping in a quoted `--allowedTools` string is a bug farm; refusal is simple and total |

## 5. Least Privilege & Permissions

Exactly one Bash pattern per declared command; no `permissions:` change; concierge deliberately declares none.

## 6. Loop Guards & Untrusted Input

No trigger/sink change. Checks come from blueprint config only — attacker-controlled issue/PR text cannot add them; substitution syntax cannot smuggle commands past the literal pattern.

## 7. Test Strategy

Five invariant tests: per-line grants, VERIFY note, empty behavior, blank-line dropping, quote/backtick/`$( )` refusal — plus regenerated-artifact greps (AC-3).

## 8. Rollout

law-ai regenerated in the same change; the gallery template leaves `checks` empty (validator paths are repo-specific).

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Malicious check in a blueprint PR | low | med | Reviewed artifact; literal-command grant; no substitution |

## 10. Estimated Effort

One loop cycle (done).
