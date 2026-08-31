# Spec: Fleet Studio — the bamr87 fleet model as GitFactory's roster, contract, and adoption source

- **ID**: 012-fleet-studio
- **Status**: draft
- **Owner**: @bamr87
- **Created**: 2026-08-31
- **Roadmap link**: ROADMAP § Fleet Ops (extends the Fleet Ops cockpit shipped in specs/009); operator request recorded in bamr87/bamr87 PR #207 (the monorepo's harness central-management layer, 2026-08-31)
- **Golden-rules compliance**: confirmed against [CLAUDE.md](../../CLAUDE.md) § Golden rules; rule-relevant deviations: none (the direct-commit write mode is an operator decision recorded as an ADR-lite entry — see plan § 4 — and does not contradict a golden rule; the frontend stays static, the compiler stays pure)

## 1. Problem & Motivation

Managing the bamr87 fleet's AI harnesses is currently split across two halves that do not meet: the bamr87/bamr87 monorepo **observes** (a daily committed inventory `_data/harness_registry.yml` of every claude-code-action workflow and cron across ~40 repos, graded against a declared contract in `_data/fleet.yml` `harnesses:` — throughput caps, budget ceilings, baseline coverage) and **mass-deploys static templates** (harness-fanout), while GitFactory can **design, compile, and write** workflows but only for repos hand-added to its roster, with no fleet contract informing the compile. The consequence the operator named directly: there is no full-stack application where harness and workflow *attributes* — triggers, crons, model, turn budget, tool grants, auth shape — are read from and written back to the fleet through the application's own design structure; every attribute change today is hand-edited YAML in one repo at a time. GitFactory is the natural home for that application: the blueprint/compiler/deploy pipeline already exists, the Fleet Ops cockpit already renders observed repos, and the missing pieces are exactly (a) the monorepo's fleet model as a roster/contract source, (b) adoption of existing non-factory workflows into blueprints, and (c) the contract enforced at design time instead of observed after the fact.

## 2. Origin & Background

- Backlog items claimed: BL-20260831-01, BL-20260831-02, BL-20260831-03 (moved to `## Claimed` annotated `claimed-by:specs/012-fleet-studio`).
- Builds on: specs/009-demo-environment (the `GithubClient` seam and fixture-backed demo client this spec's fixtures ride), specs/010/011 (Fleet map + Evidence Console surfaces the roster renders into), ADR-021 (kill-switch state reading), and the monorepo side: bamr87/bamr87 `_data/harness_registry.yml` (generated daily by `dash-gen harnesses`, documented in that repo's `docs/HARNESS-OPS.md`).

## 3. Goals

- G1: One configured hub repo makes the whole bamr87 fleet visible in Fleet Ops — roster, per-repo harness attributes, crons, coverage, and the active contract — from the hub's committed inventory file, with zero additional API calls per fleet repo.
- G2: Existing non-factory harness workflows become editable as blueprints ("adoption"), so attributes are changed structurally and recompiled, never hand-YAML'd.
- G3: The fleet contract (throughput caps, UTC-hour adjacency, OAuth-first auth, budget) is evaluated at compile/deploy-plan time as diagnostics.
- G4: Deploys write workflows by direct commit to the target branch (operator decision, 2026-08-31), falling back to a machine branch + PR automatically only when GitHub refuses the push.

## 4. Non-Goals

- NG1: Replacing the monorepo's own machinery — the daily inventory generator, the `/harnesses/` board, harness-fanout, and token rotation stay where they are; GitFactory consumes the inventory, it does not regenerate it.
- NG2: General YAML→blueprint decompilation of arbitrary workflows — adoption recognizes bounded shapes and falls back to a byte-preserving raw form (FR-5); it does not promise semantic understanding of any workflow.
- NG3: Editing hand-modified fleet workflows without adoption — a workflow the operator has not adopted is display-only, exactly as today.
- NG4: Any server-side component — the hub inventory is a committed file fetched like any other repo content; golden rule #1 holds.
- NG5: Secrets management changes — Claude auth provisioning stays with the monorepo's token-rotation loop; GitFactory's existing sealed-box secret provisioning is unchanged.

## 5. User Stories

- As the fleet operator, I want GitFactory's Fleet Ops to show every repo, harness, and cron the monorepo's inventory already knows, so that the studio and the ledger describe the same fleet without re-scanning it.
- As the fleet operator, I want to adopt an existing `claude.yml` mention handler or scheduled agent workflow into a blueprint, change its model, turn budget, or cron in the Inspector, and deploy the recompiled workflow back, so that harness attributes are managed through the application instead of hand-edited YAML.
- As the fleet operator, I want the compiler to warn me when a blueprint would push a repo or the fleet past the declared scheduled-throughput caps or collide on a busy UTC hour, so that the contract binds at design time.
- As the fleet operator, I want deploys to land directly on the target branch when GitHub allows it and as a PR when it refuses, so that iteration is fast on my own repos and never silently lost on protected ones.

## 6. Functional Requirements

- **FR-1**: A Fleet Ops **fleet source** setting names one hub repo (default `bamr87/bamr87`); refresh fetches that repo's `_data/harness_registry.yml` via the contents API (ETag-conditional) through the existing `GithubClient` seam, and parse failures or absence degrade to the current hand-added roster with a visible notice, never an error state.
- **FR-2**: The fetched inventory's `contract:` block (kit version, baseline, throughput caps, budget) becomes the app's **active fleet contract**; when no fleet source is configured or the block is absent, no contract is active and behavior is unchanged.
- **FR-3**: The Fleet map and cockpit render hub-sourced repos with their harness attributes (kind, auth shape, model, max-turns, kit stamp, crons, coverage/secret state), visually distinguishing factory-managed (`factory--*.yml`), adopted, and foreign (unadopted) workflows.
- **FR-4**: **Adoption** imports a recognized non-factory workflow as a blueprint line. Recognized shapes: (a) the agent-context-kit mention handler (`claude.yml`: mention-capable triggers + `anthropics/claude-code-action`), (b) single-job scheduled agent workflows (cron trigger + claude-code-action step). Extraction covers triggers, crons, auth shape, model, `--max-turns`, `--allowedTools` grants, and the prompt (written to `.factory/prompts/` for review).
- **FR-5**: An unrecognized workflow adopts as a **raw workflow machine**: an opaque node preserving the source YAML byte-for-byte, surfacing only parseable facts (name, triggers, crons) read-only; recompiling a raw machine re-emits its YAML unchanged.
- **FR-6**: With an active contract, compile/deploy-plan emits **contract diagnostics**: per-repo and fleet estimated scheduled agent runs/day vs `max_scheduled_ai_per_day_repo`/`_fleet`, AI crons sharing a UTC hour vs `max_ai_crons_per_utc_hour`, auth shape deviating from OAuth-first, and an advisory budget note. Contract diagnostics are warnings — deploy remains possible; the compiler's own hard errors (loop guards etc.) are unchanged.
- **FR-7**: Deploy writes compiled workflows by **direct commit to the target repo's default branch**. When GitHub refuses the push (ruleset, branch protection, missing permission), the deploy automatically falls back to a machine branch + PR, and the deploy result surfaces which mode landed per repo.
- **FR-8**: **Round-trip integrity**: adopting a recognized workflow and recompiling without edits produces a workflow semantically equivalent to the source (same triggers, same action inputs, same guards — asserted as invariant fragments, not golden strings); a raw adoption round-trips byte-identically.

## 7. Non-Functional Requirements

- **NFR-SEC-1**: Hub inventory content is **data, never instructions**: nothing fetched from the fleet source may widen a tool grant, alter a prompt, or change compiler behavior beyond the declared contract fields; adopted prompts land in `.factory/prompts/` flagged for human review before first deploy (golden rule #9).
- **NFR-SEC-2**: The direct-commit write mode introduces no new credential surface: the existing fine-grained PAT with contents+workflows write is used for both modes, and secrets continue to appear only as `${{ secrets.* }}` references in emitted YAML (golden rule #7).
- **NFR-LOOP-1**: Adoption preserves existing loop guards, and a recognized adoption whose source lacks a mandatory guard compiles only with the guard added — the compiler's refusal to emit an unguarded feedback loop applies to adopted lines identically (golden rule #6).
- **NFR-PERF-1**: Fleet-source refresh is one ETag-conditional file fetch per refresh; no background polling is added beyond the existing cadence (golden rule: ARCHITECTURE § rate limits).
- **NFR-COMPAT-1**: With no fleet source configured, every existing flow (canvas, compile, deploy, demo mode, tests) behaves exactly as before; the schema change is additive and existing encoded blueprints remain valid.

## 8. Blueprint & Schema Impact

- New machine type `raw_workflow` (opaque adopted workflow; config carries source YAML, path, and parsed read-only facts) — registry entry + schema + drift guard stay in sync.
- Blueprint metadata gains optional `origin` (`adopted` | `authored`, default `authored`) and `sourcePath` for adopted lines.
- Fleet source configuration lives in app state (persisted like other Fleet Ops settings), not in the blueprint; `.factory/config.yml` may carry a default hub for dogfooding.
- Blueprint-string compatibility: all additions optional; existing strings decode unchanged.

## 9. Compiler & Workflow Impact

- New pure module `app/src/compiler/adopt.ts`: workflow YAML → `{blueprintFragment | rawAdoption, diagnostics}` — the decompiler; kept out of `compile.ts` so compilation stays a pure Blueprint→files function.
- `compile.ts` gains an optional `contract` argument feeding the FR-6 diagnostics; absent contract = no new diagnostics (purity and existing tests untouched).
- Raw machines re-emit source YAML verbatim (no GENERATED header — the file is not factory-generated content); recognized adoptions emit standard generated output with header + blueprint hash.
- Verify current `anthropics/claude-code-action` inputs against upstream before building the extractor (golden rule #4); the kit shapes to recognize are pinned as fixtures from bamr87/bamr87 `templates/agent-context/claude.yml` and its archive shapes.
- `examples/compiled/` gains one adopted-line reference output.

## 10. UI Impact

- Fleet Ops roster/cockpit (`app/src/fleet/`, `app/src/panels/`): hub-sourced repo rows, contract summary card, coverage/secret badges; design-token compliant (specs/011), no new colour literals.
- Inspector: adopted lines expose the extracted attributes as normal machine config; raw machines render read-only facts with an "unrecognized shape" note.
- Deploy dialog: per-repo landed-mode report (direct vs PR-fallback) with links.
- A11y: badges carry text labels, not colour alone.

## 11. Security Impact

- Untrusted content: the hub inventory is committed YAML from the operator's own hub repo, but it is still treated as data (NFR-SEC-1) — field values render escaped, and nothing in it is executed or interpolated into prompts or grants.
- Adopted workflows may contain attacker-influenced prompt text (they lived in target repos); adoption surfaces the prompt for review rather than trusting it (NFR-SEC-1), and tool grants are extracted verbatim, never widened.
- Direct-commit mode: blast radius is one workflow file per deploy per repo with the existing PAT; the refusal-fallback keeps protected branches protected — protection settings, where present, still win.
- Fork-PR behavior unchanged.

## 12. Acceptance Criteria

- **AC-1**: Given a fleet source configured to a fixture hub carrying a `harness_registry.yml` with 3 repos and a `contract:` block, when Fleet Ops refreshes, then the roster lists the 3 repos with kind/auth/model/turns/cron facts and the cockpit renders the contract caps; given the file is absent, the roster falls back with a visible notice.
- **AC-2**: Given the pinned agent-context-kit `claude.yml` fixture, when adopted, then the blueprint contains a mention trigger + agent machine with auth `oauth-first` and the prompt extracted to `.factory/prompts/`, and recompiling asserts the same triggers, action inputs, and guards as invariant fragments.
- **AC-3**: Given an unrecognized workflow fixture, when adopted and recompiled without edits, then the emitted YAML is byte-identical to the source.
- **AC-4**: Given an active contract with `max_scheduled_ai_per_day_repo: 8` and a blueprint whose crons estimate 9 runs/day for one repo, when compiled, then a contract diagnostic names the cap and the estimate, and deploy remains possible.
- **AC-5**: Given direct mode and a target where the push is refused (fixture client returns a protection refusal), when deployed, then the deploy lands as branch + PR and the result reports `pr-fallback`; given an unprotected target, the commit lands on the default branch and reports `direct`.
- **AC-6**: Given no fleet source configured, then the full existing test suite and the demo environment pass unchanged.

## 13. Risks & Open Questions

- **R-1**: Inventory staleness — the hub file is regenerated daily; the roster could lag reality by a day. Mitigated: the cockpit shows the file's `generated_at` and `scan.mode`, and per-repo live polling (existing behavior) still refreshes what the operator drills into.
- **R-2**: Decompile fidelity — recognized-shape extraction that guesses wrong would produce a blueprint that deploys something subtly different; mitigated by FR-8 round-trip invariants and the raw fallback being the default for anything not confidently recognized.
- **R-3**: Direct-commit mode on unprotected default branches bypasses review by design; recorded as the operator's decision (ADR-lite, plan § 4) with the landed-mode report keeping it visible after the fact.
- **OQ-1**: Should adopted scheduled agents be offered a kill-switch repo variable (`*_ENABLED`, the template-gallery convention) at adoption time? (Default proposal: yes, opt-in checkbox.)
- **OQ-2**: Hub file schema versioning — the monorepo counterpart work (its roadmap item) may add a schema marker to `harness_registry.yml`; until then the parser is tolerant-by-construction (missing fields degrade per FR-1).

## 14. Out of Scope / Follow-ups

- Monorepo counterpart (tracked in bamr87/bamr87's roadmap, not here): the inventory records `.factory/blueprint.json` presence per repo; `harness_registry.yml` gains a documented consumed-by-GitFactory stability note / schema marker.
- Writing back to the hub's `_data/fleet.yml` contract from the app (contract editing stays a monorepo PR for now).
- Inter-repo belts sourced from the hub's schedule calendar (builds on BL-20260818-08).
