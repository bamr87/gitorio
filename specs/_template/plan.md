# Plan: {Feature Name}

> Companion to `spec.md`. Describes **how** we will satisfy the requirements.

## 1. Architecture Overview

Short prose + Mermaid diagram only if it adds clarity (no boilerplate diagrams). Reference the relevant §§ of [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

## 2. Component Changes

| Layer | File / Module | Change |
|-------|---------------|--------|
| Registry | `app/src/machines/registry.ts` | … |
| Compiler | `app/src/compiler/compile.ts` | … |
| Schema | `schema/blueprint.schema.json` | … |
| UI | `app/src/panels/…` / `app/src/state/…` | … |

## 3. Blueprint & Schema Changes

Schema edits stay in sync with the registry (the drift-guard test must stay green). Note blueprint-string compatibility for existing encoded blueprints.

## 4. Tech Choices & Alternatives

| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|-------------------------|-----|
| … | … | … | … |

If any choice deviates from a golden rule in [AGENTS.md](../../AGENTS.md), append an ADR-lite entry to [docs/DECISIONS.md](../../docs/DECISIONS.md) and reference it here.

## 5. Least Privilege & Permissions

Mandatory — do not leave empty (golden rule #5). The computed `permissions:` block delta and every new `--allowedTools` grant, each as narrow as the sink allows. State explicitly what is NOT granted.

## 6. Loop Guards & Untrusted Input

Mandatory — do not leave empty (golden rules #6 and #9). How self-retriggering is prevented (bot guard / terminal sink / types scoping), and which attacker-controlled inputs (issue bodies, PR diffs, comments) reach an agent — and why the tool ceiling contains them.

## 7. Test Strategy

- Compiler invariant tests (`compile.test.ts`): critical YAML fragments to assert (golden rule #3 — no full golden strings).
- Fixture needs (`fleet/fixtures/` verbatim workflows, seeded stores).
- Browser smoke (what to eyeball in the running app).

## 8. Rollout

- Dogfood on gitorio? (`.factory/` blueprint/prompt updates, regenerated `factory--*.yml`.)
- Template-gallery entry? Default-OFF kill switch (`*_ENABLED` repo variable) for anything scheduled?

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| … | low/med/high | low/med/high | … |

## 10. Estimated Effort

Sessions / tasks; flag any task that needs human pairing (e.g. a live scratch-repo test).
