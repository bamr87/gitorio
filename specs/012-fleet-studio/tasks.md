# Tasks: Fleet Studio

> Each task must reference one or more `FR-*` / `NFR-*` / `AC-*` IDs from `spec.md`. CI's [tools/spec_validator.py](../../tools/spec_validator.py) enforces that every requirement in `spec.md` is referenced by at least one task.

## Conventions

- Status: `[ ]` todo / `[~]` in-progress / `[x]` done.
- Owner: GitHub handle or `@agent:<role>`.
- Each task lists exact files to touch and how to verify.

---

## T-001 — Schema: `raw_workflow` machine + adopted-origin metadata

- **Refs**: FR-5, NFR-COMPAT-1
- **Owner**: @agent:implementer
- **Status**: `[ ]`
- **Files**:
  - `app/src/machines/registry.ts` (extend)
  - `schema/blueprint.schema.json` (extend)
  - `app/src/compiler/compile.test.ts` (extend: drift guard + decode-compat cases)
- **Steps**:
  1. Add the `raw_workflow` machine type (config: `sourcePath`, `sourceYaml`, parsed read-only facts) to the registry and schema, keeping the drift guard green.
  2. Add optional blueprint metadata `origin` (`authored` default) and `sourcePath`; assert an existing encoded blueprint string still decodes unchanged.
- **Verify**:
  - `cd app && npx vitest run src/compiler/compile.test.ts` passes (drift guard + compat cases).
  - `cd app && npm run typecheck` clean.

## T-002 — Fleet source client: fetch + parse the hub inventory

- **Refs**: FR-1, FR-2, NFR-PERF-1, NFR-SEC-1, AC-1
- **Owner**: @agent:implementer
- **Status**: `[ ]`
- **Files**:
  - `app/src/fleet/fleetSource.ts` (new)
  - `app/src/fleet/fixtures/harness_registry.fixture.yml` (new: 3 repos + `contract:` block)
  - `app/src/fleet/fleetSource.test.ts` (new)
- **Steps**:
  1. Fetch `_data/harness_registry.yml` from the configured hub via the `GithubClient` seam, ETag-conditional; parse tolerantly (missing fields degrade, absence → fallback notice state, never a thrown error).
  2. Expose `{roster, contract, generatedAt, scanMode}`; treat every field as display data only (no interpolation into prompts/grants).
- **Verify**:
  - `cd app && npx vitest run src/fleet/fleetSource.test.ts` covers present/absent/malformed inventory and the ETag revalidation path.

## T-003 — Roster + contract rendering in Fleet Ops

- **Refs**: FR-3, AC-1
- **Owner**: @agent:implementer
- **Status**: `[ ]`
- **Files**:
  - `app/src/panels/` (fleet cockpit + roster panels, per current layout)
  - `app/src/state/` (fleet source setting, persisted)
- **Steps**:
  1. Merge hub-sourced repos into the observed roster; render harness kind/auth/model/turns/kit/cron facts and coverage/secret badges (text-labelled, token-compliant).
  2. Contract summary card with `generated_at` + `scan.mode` freshness line; factory-managed vs adopted vs foreign distinction on workflow rows.
- **Verify**:
  - Browser smoke: fixture hub renders roster + contract; absent file shows the fallback notice.
  - `cd app && npm run typecheck && npm run lint` clean.

## T-004 — Decompiler: recognized shapes → blueprint fragments

- **Refs**: FR-4, FR-8, AC-2
- **Owner**: @agent:implementer
- **Status**: `[ ]`
- **Files**:
  - `app/src/compiler/adopt.ts` (new)
  - `app/src/compiler/adopt.test.ts` (new)
  - `app/src/fleet/fixtures/` (pinned kit `claude.yml` current + archive shapes; scheduled-agent workflow)
- **Steps**:
  1. Verify current `anthropics/claude-code-action` inputs upstream first (golden rule #4), then implement recognizers for (a) the kit mention handler and (b) single-job cron→agent workflows; extract triggers, crons, auth shape, model, `--max-turns`, `--allowedTools` verbatim.
  2. Confidence gate: anything not fully recognized routes to raw adoption (T-005), never a partial guess.
- **Verify**:
  - `cd app && npx vitest run src/compiler/adopt.test.ts`: round-trip invariants — recompiled output carries the same triggers, action inputs, and guards as the source fixtures (fragments, not golden strings).

## T-005 — Raw adoption: byte-preserving fallback

- **Refs**: FR-5, FR-8, AC-3
- **Owner**: @agent:implementer
- **Status**: `[ ]`
- **Files**:
  - `app/src/compiler/adopt.ts` (extend)
  - `app/src/compiler/compile.ts` (extend: raw machines re-emit `sourceYaml` verbatim, no GENERATED header)
  - `app/src/compiler/adopt.test.ts` (extend)
- **Steps**:
  1. Unrecognized workflow → `raw_workflow` machine carrying the YAML byte-for-byte plus parsed read-only facts.
  2. Compile path emits raw sources unchanged and excludes them from factory-managed guarantees.
- **Verify**:
  - Invariant test: adopt→compile of the unrecognized fixture is byte-identical to the source.

## T-006 — Prompt extraction to `.factory/prompts/` with review flag

- **Refs**: FR-4, NFR-SEC-1, AC-2
- **Owner**: @agent:implementer
- **Status**: `[ ]`
- **Files**:
  - `app/src/compiler/adopt.ts` (extend)
  - `app/src/panels/` (Inspector: review-pending marker on adopted prompts)
- **Steps**:
  1. Extracted prompt text lands as a `.factory/prompts/*.md` write in the deploy plan, marked review-pending; adopted prompt text is never trusted silently (untrusted-content rule).
- **Verify**:
  - Adoption test asserts the prompt file appears in the plan with the review flag; grants are imported verbatim, never widened.

## T-007 — Contract diagnostics in compile/deploy-plan

- **Refs**: FR-6, FR-2, AC-4
- **Owner**: @agent:implementer
- **Status**: `[ ]`
- **Files**:
  - `app/src/compiler/compile.ts` (optional `contract` arg)
  - `app/src/compiler/compile.test.ts` (extend)
- **Steps**:
  1. Estimate scheduled runs/day from blueprint crons (mirror the hub's documented approximation); warn on per-repo/fleet cap breach, UTC-hour adjacency over `max_ai_crons_per_utc_hour`, non-OAuth-first auth; advisory budget note.
  2. No contract → zero new diagnostics.
- **Verify**:
  - Invariant tests incl. the boundary (estimate 9 vs cap 8 warns; 8 vs 8 does not); no-contract compile output unchanged.

## T-008 — Deploy write modes: direct commit + refusal fallback

- **Refs**: FR-7, NFR-SEC-2, AC-5
- **Owner**: @agent:implementer (one human-paired live test)
- **Status**: `[ ]`
- **Files**:
  - `app/src/fleet/` deploy planner (extend)
  - `app/src/fleet/fixtures/` (push-refusal client behavior)
  - `app/src/panels/` (landed-mode report)
  - `docs/DECISIONS.md` (ADR-lite: direct-commit write mode, operator decision 2026-08-31)
- **Steps**:
  1. Default write path: direct commit to the target's default branch; on GitHub refusal (protection/ruleset/permission error), fall back to machine branch + PR automatically.
  2. Per-repo landed-mode (`direct` | `pr-fallback`) in the deploy result with links; same PAT, no new scopes.
  3. Human-paired: one live verification against a protected and an unprotected scratch repo.
- **Verify**:
  - Fixture test covers both modes (AC-5); live pairing session confirms the refusal path against real rulesets.

## T-009 — Loop-guard preservation on adoption

- **Refs**: NFR-LOOP-1, AC-2
- **Owner**: @agent:implementer
- **Status**: `[ ]`
- **Files**:
  - `app/src/compiler/adopt.ts` / `compile.ts` (guard synthesis for recognized adoptions)
  - `app/src/compiler/adopt.test.ts` (extend)
- **Steps**:
  1. Recognized adoptions inherit source guards; a comment-writing adopted line without a bot/actor guard gets the guard synthesized at recompile or fails compile with a diagnostic — never emitted unguarded.
- **Verify**:
  - Invariant test: guard-less mention-handler fixture compiles WITH the guard present in output (or errors), per the existing unguarded-loop refusal semantics.

## T-010 — Compat + demo regression

- **Refs**: NFR-COMPAT-1, AC-6
- **Owner**: @agent:implementer
- **Status**: `[ ]`
- **Files**:
  - `app/src/` demo fixtures (fleet-source demo coverage optional)
  - full suite
- **Steps**:
  1. With no fleet source configured, assert existing flows are untouched: full vitest suite, typecheck, lint, build, and `?demo=1` smoke.
- **Verify**:
  - `cd app && npm test && npm run typecheck && npm run lint && npm run build` all green with the feature unconfigured.

---

## Done-When (Definition of Done)

- All tasks `[x]`.
- All `AC-*` from `spec.md` covered by passing tests.
- `cd app && npm test && npm run build` green.
- New machine type? The golden rule #8 DoD is complete for `raw_workflow` (registry + config + emitter + invariant test + ARCHITECTURE §4 catalog line + renders on canvas).
- `python3 tools/unwrap-prose.py --check` clean (the markdown-oneline CI rule).
- **`## Follow-ups Discovered` section below populated** — at minimum, every implementer must record one of: a new BACKLOG entry, a refactor candidate, a missing test, or `_none_` (must be justified in the PR).

---

## Follow-ups Discovered

> Append-only. Mirror each item into [BACKLOG.md](../../BACKLOG.md) with a `BL-YYYYMMDD-NN` id (`python3 tools/next_backlog_id.py`). CI ([tools/spec_validator.py](../../tools/spec_validator.py)) checks this section exists. CI ([tools/backlog_lint.py](../../tools/backlog_lint.py)) checks the BACKLOG mirror.

- _none_  <!-- populated during /implement -->
