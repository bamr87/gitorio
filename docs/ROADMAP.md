# Roadmap

Phases mirror `seeds/`. A phase is done when its acceptance criteria pass and
`npm test && npm run build` are green. Park anything else in § Backlog.

## Phase 0 — Bootstrap (seeds/00)
- [ ] `npm install / dev / test / build` all work on a fresh clone
- [ ] Baseline screenshot of the canvas committed to `docs/img/`
- [ ] Any dependency/tooling fixes logged in DECISIONS.md

## Phase 1 — Canvas MVP (seeds/01)
- [ ] Palette → drag onto canvas → machine node renders with category styling
- [ ] Belts connect out→in ports; delete via keyboard; grid snap
- [ ] Inspector edits machine config (fields from registry) and factory meta
- [ ] Blueprint export/import (JSON file + base64url blueprint string) round-trips
- [ ] Compile drawer shows per-workflow YAML + diagnostics

## Phase 2 — Compiler v1 (seeds/02)
- [ ] All 13 v0 machine types emit correct YAML (invariant tests per type)
- [ ] Loop-guard refusal path tested (comment trigger + comment sink, no guard → error)
- [ ] Permissions/concurrency computed per component; generated header + hash
- [ ] Output verified against examples/compiled/ and current claude-code-action docs

## Phase 3 — GitHub connect (seeds/03) — MVP ✅
- [x] PAT auth (sessionStorage), repo entry, permission preflight checklist
- [x] Load/save blueprint + workflows via contents API (commit or PR mode)
      — prompt *content* editing/writing lands with Prompt Studio (Phase 5); deploy
      warns on referenced-but-missing prompt files
- [x] Power hookup: sealed-box secret provisioning for ANTHROPIC_API_KEY (tweetnacl)
- [x] Drift detection: hash-mismatch banner when deployed workflows were hand-edited
- Note: repo *picker* is a text field for the MVP (list picker = backlog); live
  end-to-end demo on a scratch repo pending a user PAT.

## Phase 4 — Telemetry (seeds/04) — MVP ✅
- [x] Runs polling with ETag conditional requests (304s are free); status LEDs on machines
      (green=success, amber=running, red=failed, grey=idle) via `assemblyLines` mapping.
      Polling follows the open panel only (rate-hygiene).
- [x] Run list: conclusion, duration, event, deep link per `factory--*` run
      — jobs drill-down + log-zip (fflate) view deferred to backlog
- [x] Dashboard: total runs, success rate, in-progress, p50 duration (global). Per-line
      status is the machine LEDs; per-line stat *rows* (`statsByLine` exists, tested) = backlog.

## Phase 5 — Prompt Studio (seeds/05)
- [ ] Prompt list/edit/diff; PR-by-default writes; frontmatter form
- [ ] Prompt lint (inputs stated, obligations stated, no secrets)
- [ ] Cron overview: next scheduled runs per factory

## Phase 6 — Agent patterns (seeds/06)
- [ ] Belt mode: structured JSON handoff agent→deterministic sinks
- [ ] Watchdog factory template (failure-rate alarm issue)
- [ ] Rate limiter / approval gate machines

## Phase 7 — GitHub App (seeds/07)
- [ ] Device-flow auth; installation picker; PAT path kept as fallback
- [ ] Multi-repo factory switcher

## Backlog
- Undo/redo; touch drag; blueprint marketplace; SHA-pinned actions mode;
  webhook worker + SSE live belts; multi-repo train stations.

### Parked by the 2026-07-03 foundation review
Correctness (compiler):
- ~~**[security] `issue_labeled` loop guard checks the wrong identity**~~ — ✅ FIXED
  2026-07-04 (ADR-009): the guard now checks the event actor `github.event.sender.type`
  (correct for `labeled` and `pull_request.synchronize`), not the entity author. Regression
  tests added.
- **`sink.commit_files` / `sink.open_pr` under-provisioned** — `compile.ts:125-147`:
  obligations tell the agent to branch/commit/push and `permissions` grants
  `contents: write`, but `toolsFor` has no `commit_files` case (falls through to `[]`) and
  grants `open_pr` only `Bash(gh pr create:*)` — no `git add/commit/push`. Reconcile against
  the current `claude-code-action@v1` `action.yml` (golden rule #4).

Test coverage (golden rule #3):
- **5 of 13 machine types have zero invariant tests** — `compile.test.ts` now also covers
  `issue_labeled` + `pr_opened` (added with the ADR-009 guard fix). Still untested:
  `trigger.manual, filter.condition, sink.create_issue, sink.open_pr, sink.commit_files`.
- **Drift-guard test**: assert `MACHINES.map(m => m.type)` deep-equals the schema `type`
  enum and the compiler's `TRIGGERS`/`SINKS` sets (single source of truth for machine types).

Lower priority:
- Per-type `oneOf` config subschemas in `schema/blueprint.schema.json` (config is bare
  `object` today — registry field/required constraints go unenforced).
- Committed regen script for `examples/compiled/*` + a golden anchor for a no-agent
  (deterministic `gh`) line and a PR-triggered line; strip hand-written comments that
  cause spurious regenerate-and-diff drift.
- UI polish (`app/src/App.tsx`): `download()` revokes the blob URL before download starts;
  flash `say()` doesn't clear the prior timer. `Inspector.tsx`: numeric fields use
  `Number('') === 0`, so a field can't be blanked. Add a React error boundary + store tests.

Foundation follow-ups (not done this session):
- Lint/format: ESLint flat config (`typescript-eslint` + `react-hooks`) + Prettier; add
  `npm run lint` to CI.
- `.claude/settings.json` permission allowlist (blocked from auto-generation this session
  — run `/fewer-permission-prompts` to create it).
- LICENSE (intentionally deferred — decide MIT vs Apache-2.0).
- Gate `deploy-pages.yml` on CI success (`workflow_run`/`needs`) so a failing-test push
  doesn't spawn an independent deploy.
