# Plan: Fleet Studio

> Companion to `spec.md`. Describes **how** we will satisfy the requirements.

## 1. Architecture Overview

The monorepo stays the fleet's ledger; GitFactory becomes its studio. One new read path and one widened write path, both through existing seams (ARCHITECTURE §§ GithubClient, Fleet Ops engines, deploy planner):

```mermaid
flowchart LR
  HUB[bamr87/bamr87\n_data/harness_registry.yml\ncontract + roster] -- "contents API (ETag)" --> FS[fleetSource client\napp/src/fleet/]
  FS --> ROSTER[Fleet Ops roster + cockpit]
  FS --> CONTRACT[active contract]
  CONTRACT --> DIAG[compile/deploy-plan\ncontract diagnostics]
  WF[target repo workflow YAML] -- adopt --> DEC[adopt.ts decompiler\nrecognized | raw]
  DEC --> BP[Blueprint]
  BP --> COMPILE[compile.ts pure] --> DEPLOY[deploy planner\ndirect commit → PR fallback] --> REPOS[fleet repos]
```

The decompiler is a separate pure module; `compile.ts` stays Blueprint→files and only gains an optional `contract` argument for diagnostics.

## 2. Component Changes

| Layer | File / Module | Change |
|-------|---------------|--------|
| Registry | `app/src/machines/registry.ts` | New `raw_workflow` machine type (opaque adopted workflow) |
| Compiler | `app/src/compiler/adopt.ts` (new) | Pure decompiler: YAML → recognized blueprint fragment or raw adoption + diagnostics |
| Compiler | `app/src/compiler/compile.ts` | Optional `contract` arg → FR-6 warning diagnostics; raw machines re-emit source verbatim |
| Fleet | `app/src/fleet/` (fleetSource client + engines) | Fetch/parse `harness_registry.yml` (ETag), merge hub roster, expose active contract |
| Schema | `schema/blueprint.schema.json` | `raw_workflow` config, optional blueprint `origin`/`sourcePath` (additive; drift guard updated) |
| UI | `app/src/panels/…`, `app/src/state/…` | Fleet source setting, roster/contract rendering, Adopt action, deploy landed-mode report |
| Fixtures | `app/src/fleet/fixtures/` | Fixture hub inventory (3 repos + contract), pinned kit `claude.yml` shapes, unrecognized workflow, protection-refusal client behavior |

## 3. Blueprint & Schema Changes

All additions optional with defaults (`origin: authored`), so existing encoded blueprint strings decode unchanged and the registry↔schema drift guard is extended, not weakened. The `raw_workflow` config stores `sourcePath`, `sourceYaml`, and parsed read-only facts (`name`, `triggers`, `crons`).

## 4. Tech Choices & Alternatives

| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|-------------------------|-----|
| Fleet model source | The hub's committed `_data/harness_registry.yml` via contents API | Re-scan every repo from the app; a bespoke export endpoint | The monorepo already computes exactly this daily; one file fetch respects rate limits and NG1; contents API + ETag works for a private hub later where raw URLs would not |
| Contract evaluation point | Optional `contract` argument to compile + deploy plan | A separate post-compile linter; baking caps into machine configs | Diagnostics belong where other diagnostics live; optional arg preserves compiler purity and NFR-COMPAT-1 |
| Adoption scope | Bounded recognizers (kit mention handler, single-job cron agent) + byte-preserving raw fallback | General YAML→graph decompilation | Recognizers can be invariant-tested (FR-8); general decompilation cannot honestly promise semantic fidelity (NG2) |
| Write mode | Direct commit to default branch; automatic branch+PR fallback on refusal | PR-only (the monorepo's fan-out doctrine); direct-with-no-fallback | Operator decision (2026-08-31) for iteration speed; the fallback exists because GitHub *refuses* direct pushes on ruleset-protected branches — without it the feature simply errors there (the monorepo's own publish-data pattern, adopted here). ADR-lite entry appended to [docs/DECISIONS.md](../../docs/DECISIONS.md) in the implementing PR |
| Prompt handling on adoption | Extract to `.factory/prompts/` flagged for review | Inline into blueprint config | Prompts are repo-reviewable content by GitFactory convention, and adopted prompt text is untrusted until reviewed (NFR-SEC-1) |

## 5. Least Privilege & Permissions

No new grants. Reads: the hub inventory fetch uses the same token/scopes as existing observed-repo reads (contents read). Writes: both deploy modes use the existing fine-grained PAT (contents + workflows write on targets); PR fallback additionally uses the already-held pull-request write. Compiled `permissions:` blocks are computed exactly as today; adoption never widens an extracted `--allowedTools` grant (verbatim import only, NFR-SEC-1). NOT granted: no admin/ruleset scopes (protection refusals are handled, not bypassed), no secrets read, no writes to the hub repo's data files.

## 6. Loop Guards & Untrusted Input

Adopted lines pass through the same compiler that refuses unguarded feedback loops: a recognized adoption whose source lacks a mandatory bot/actor guard gets the guard added at recompile or fails compile with a diagnostic — never emitted unguarded (NFR-LOOP-1). Raw machines re-emit verbatim and are clearly marked unmanaged; they are excluded from factory guarantees in the UI. Attacker-influenced inputs: adopted prompt text (reviewed before deploy, per plan § 4) and hub inventory field values (rendered escaped, treated as data only — no grant, prompt, or compile behavior derives from them beyond the declared contract numbers, which only *tighten* via warnings, never widen anything).

## 7. Test Strategy

- Compiler invariant tests: recognized-adoption round-trip fragments (triggers, action inputs, guards — AC-2); raw byte-identity (AC-3); contract diagnostics thresholds incl. the boundary case (AC-4); no-contract compile unchanged (NFR-COMPAT-1).
- Fixture needs: pinned kit `claude.yml` shapes (current + archive variants from the hub's templates), one unrecognized workflow, a 3-repo fixture `harness_registry.yml` with contract block, a `GithubClient` fixture refusing a push (AC-5).
- Conformance: extend the demo-client/transport-client structural check to the new fetch (BL-20260822-03 remains the deeper fix).
- Browser smoke: configure fleet source → roster renders; adopt → Inspector shows attributes; deploy → landed-mode report.

## 8. Rollout

- Dogfood: point the fleet source at bamr87/bamr87 for real; adopt gitorio's own `claude.yml` first (lowest-risk shape, self-contained repo).
- Scheduled adopted lines get the standard default-OFF `*_ENABLED` kill-switch offer (OQ-1 default: yes).
- No template-gallery entry (this is an operator feature, not a template).

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Recognizer misreads a workflow and deploys something different | med | high | Raw fallback is the default on low confidence; FR-8 round-trip invariants; adopted first deploy shows a full diff in the plan |
| Direct commits land unreviewed changes on unprotected branches | high (by design) | med | Operator decision, recorded (ADR-lite); landed-mode report keeps it auditable; protection, where present, still wins via the fallback |
| Hub inventory schema drifts under the parser | med | low | Tolerant parser (missing fields degrade, FR-1); monorepo counterpart adds a schema marker (spec § 14 / OQ-2) |
| Fleet-source fetch adds rate-limit pressure | low | low | One ETag-conditional file per refresh (NFR-PERF-1) |

## 10. Estimated Effort

Roughly 6–8 implementation sessions: T-001..T-003 (schema + fleet source + roster) one to two; T-004..T-006 (adoption + prompts) two to three, the decompiler being the bulk; T-007 (contract diagnostics) one; T-008 (write modes) one, needing one human-paired live test against a real protected and unprotected repo; T-009..T-010 (guards + compat) fold into the above plus one closing pass.
