# Tasks: Harness parity

> Each task references `FR-*` / `NFR-*` / `AC-*` IDs from `spec.md`. CI's [tools/spec_validator.py](../../tools/spec_validator.py) enforces that every requirement in `spec.md` is referenced by at least one task.

## Conventions

- Status: `[ ]` todo / `[~]` in-progress / `[x]` done.
- Owner: GitHub handle or `@agent:<role>`.
- Each task lists exact files to touch and how to verify.

---

## T-001 — Harness health engine + golden parity

- **Refs**: FR-1, FR-2, NFR-PURE-1, NFR-SEC-1, AC-1, AC-2
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: `app/src/harness/health.ts` (new), `app/src/harness/health.test.ts` (new), `app/src/harness/fixtures/hub/{fleet-harness.yml,actions_usage.yml,fleet_triage.yml,issue_pipeline.yml,token_rotation.yml,harness_health.yml,SOURCE.md}` (new)
- **Steps**:
  1. Port `harness.py` (signal types, defaults, `parseHarnessConfig`, `buildScorecard`, `evaluateTripWires`, `harnessHealth`) with tolerant parsing and bounded numbers.
  2. Copy the hub's committed inputs (reduced to the read fields) and output at `bamr87/bamr87@d58a26c`; golden test at the committed `generated_at`; port the twelve invariants.
- **Verify**: `cd app && npx vitest run src/harness/health.test.ts`.

## T-002 — Live signals adapter

- **Refs**: FR-3, NFR-PURE-1, NFR-PERF-1, AC-3
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: `app/src/harness/signals.ts` (new), `app/src/harness/signals.test.ts` (new)
- **Steps**:
  1. Map Fleet Ops rollup + per-workflow metrics + run status into `ActionsUsage` / `FleetTriage` with the scan time as `generated_at`.
  2. Test over a demo scan: completion/effectiveness equal the rollup; the runaway workflow spikes; pipeline/rotation report missing.
- **Verify**: `cd app && npx vitest run src/harness/signals.test.ts`.

## T-003 — `fleet/v1` lanes bridge + HarnessCard

- **Refs**: FR-6, FR-7, NFR-PURE-1, AC-5
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: `app/src/harness/lanes.ts` (new), `app/src/harness/lanes.test.ts` (new), `app/src/harness/HarnessCard.tsx` (new), `app/src/fleet/types.ts` (+ `lane`), `app/src/fleet/import.ts` (fetch the manifest), `app/src/canvas/ObserveMap.tsx`, `app/src/panels/Inspector.tsx`
- **Steps**:
  1. `toFleetLanes` with the kind table; `parseFleetManifest`; parity test against `fleet.manifest.yml` for every `factory--*` lane.
  2. `HarnessCard`; Observe fetches `fleet.manifest.yml` and the passport shows the lane; the Blueprint passport gains Lanes.
- **Verify**: `cd app && npx vitest run src/harness/lanes.test.ts src/canvas/FleetView.test.tsx`.

## T-004 — Design readiness

- **Refs**: FR-8, NFR-PURE-1, AC-6
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: `app/src/harness/readiness.ts` (new), `app/src/harness/readiness.test.ts` (new)
- **Steps**:
  1. Six layers per line with evidence + status; the twelve-row checklist over the blueprint.
  2. Tests over the dogfood blueprints.
- **Verify**: `cd app && npx vitest run src/harness/readiness.test.ts`.

## T-005 — Hub source store + demo hub

- **Refs**: FR-4, FR-9, NFR-SEC-1, NFR-PERF-1, NFR-COMPAT-1, AC-4
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: `app/src/state/hub.ts` (new), `app/src/state/hub.test.ts` (new), `app/src/demo/fixtures.ts`, `app/src/demo/client.ts`, `app/src/demo/seed.ts`
- **Steps**:
  1. Persisted `hubSlug` (validated), `refresh()` via `getFile`, tolerant parse, committed + recomputed health, parity note; `?hub=` intake.
  2. Demo hub `acme/hub` with `_data/*.yml` in the hub's shapes (one tripped wire) and a `fleet.manifest.yml`.
- **Verify**: `cd app && npx vitest run src/state/hub.test.ts src/demo`.

## T-006 — The Harness tab

- **Refs**: FR-5, FR-9, NFR-STATIC-1, NFR-A11Y-1, AC-4
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: `app/src/panels/HarnessPanel.tsx` (new), `app/src/panels/harness.css` (new), `app/src/panels/HarnessPanel.test.tsx` (new), `app/src/App.tsx`, `app/src/state/ui.ts` (+ test), `app/src/panels/SettingsPanel.tsx`, `app/src/demo/tour.ts`
- **Steps**:
  1. The hub anatomy over the hub store / live signals: header, source switch, KPI strip, snapshot line, Trip wires, Scorecard, illustrated embeds, Design readiness, Lanes; "Open on the hub ↗".
  2. Tab + lazy chunk + `?tab=harness`; Settings hub field; tour step.
- **Verify**: `cd app && npx vitest run src/panels/HarnessPanel.test.tsx src/state/ui.test.ts && npm run typecheck`.

## T-007 — Docs, ADR, CLAUDE.md, the harness doc

- **Refs**: FR-10
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`, `README.md`, `CLAUDE.md`, `_docs/the-harness.md` (new), `blog/drafts/`
- **Steps**:
  1. § 7g, ROADMAP Fleet track, ADR-036, README, CLAUDE.md metaphor + current state.
  2. `_docs/the-harness.md` with `::map` embeds; the session blog draft.
- **Verify**: `python3 tools/unwrap-prose.py --check`; `cd app && npx vitest run src/panels/DocsView.test.tsx`.

## T-008 — Gates + browser pass

- **Refs**: AC-7, NFR-STATIC-1
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: none (evidence in the PR)
- **Steps**:
  1. `cd app && npm test && npm run lint && npm run typecheck && npm run build && npm run maps:check`; `python3 tools/spec_validator.py && python3 tools/backlog_lint.py && python3 tools/unwrap-prose.py --check`; bundle delta.
  2. Chromium pass on `?demo=1`: the Harness tab in both schemes, the Lanes card on the floor and in Observe.
- **Verify**: all commands exit 0; screenshots committed as evidence.

---

## Done-When (Definition of Done)

- All tasks `[x]`; all `AC-*` covered; `cd app && npm test && npm run build` green; `python3 tools/unwrap-prose.py --check` clean; follow-ups below populated and mirrored into `BACKLOG.md`.

---

## Follow-ups Discovered

> Append-only. Mirror each item into [BACKLOG.md](../../BACKLOG.md).

- **BL-20260902-13** — Deploy writes `fleet.manifest.yml` with declared provenance beside the compiled lines, so the hub and `wtd` read GitFactory's structural `kind`/`triggers` instead of name-derived ones (the parity test excludes those two fields today).
- **BL-20260902-14** — Live adapters for the two hub-only signals: the issue pipeline from the target repo's labels/PRs and token rotation from repo secrets' `updated_at`, so the Live source stops tripping `stale-data` by design.
- **BL-20260902-15** — Design readiness over observed fleets: grade the six layers from `WorkflowFacts` for hand-built workflows (not only blueprints) and show it in Observe's workflow passport.
- **BL-20260902-16** — Hub-side (bamr87/bamr87, not writable from here): the `/harness/` scorecard template tints rows on `breach`/`fail` while `dash-gen harness` emits `ok`/`warn`, so a breach never tints on the hub; and the page should link back to GitFactory (`?tab=harness&hub=bamr87/bamr87`).
- **BL-20260902-17** — A vendored-archify drift guard against the hub: compare the `vendor/archify` pins so the hub's embedded diagrams and the in-app maps share a renderer version.
- **BL-20260902-18** — ETag-conditional hub reads (`getFile` with `If-None-Match`) so a refresh of eight files costs nothing when the hub has not pulsed.
