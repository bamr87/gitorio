# Tasks: Browser demo environment

> Each task references `FR-*` / `NFR-*` / `AC-*` IDs from `spec.md`.

## Conventions

- Status: `[ ]` todo / `[~]` in-progress / `[x]` done.
- Owner: GitHub handle or `@agent:<role>`.
- Each task lists exact files to touch and how to verify.

---

## T-001 — Build the demo fixture fleet

- **Refs**: FR-2, NFR-STATIC-1, NFR-PERF-1, R-1
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**:
  - `app/src/demo/fixtures.ts` (new)
- **Steps**:
  1. Define the demo repos and reuse the committed workflow sources under `app/src/fleet/fixtures/`.
  2. Generate workflow runs from an injected clock — never hard-dated — including some `runAttempt > 1` so rework metrics are exercised.
  3. Add Actions variables (armed and disarmed kill switches), `.factory/` blueprint, prompts and `config.yml`.
- **Verify**:
  - `cd app && npx vitest run src/demo` passes.
  - Built bundle grows by less than the 200 kB raw budget.

## T-002 — Implement `createDemoClient()` over the fixtures

- **Refs**: FR-1, FR-3, NFR-SEC-1, AC-4, AC-6
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**:
  - `app/src/demo/client.ts` (new)
  - `app/src/demo/client.test.ts` (new)
- **Steps**:
  1. Implement all 22 `GithubClient` methods plus `login`, reading from T-001.
  2. Route every write through an in-memory overlay consulted first by every read.
  3. Assert structurally against the interface with a typed assignment.
- **Verify**:
  - Type-level assignment to `GithubClient` compiles.
  - A test stubs `globalThis.fetch` to throw and exercises every method without it firing.
  - A write followed by a read returns the written value.

## T-003 — Seed the stores on entering demo mode

- **Refs**: FR-4, NFR-SEC-2, AC-5
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**:
  - `app/src/demo/seed.ts` (new)
  - `app/src/demo/seed.test.ts` (new)
- **Steps**:
  1. `enterDemoMode()` clears any live client, installs the demo client, seeds the canvas blueprint and the Fleet Ops roster.
  2. `exitDemoMode()` returns the app to the disconnected state.
- **Verify**:
  - A test asserts a live client is replaced, not layered over.
  - A test asserts exit leaves the stores disconnected.

## T-004 — Prove the demo drives the real engines

- **Refs**: AC-2, AC-3, R-3
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**:
  - `app/src/demo/engines.test.ts` (new)
- **Steps**:
  1. Assert the demo blueprint compiles with zero error diagnostics through the real `compile()`.
  2. Run `facts` / `metrics` / `audit` over the fixture workflows and assert non-empty, plausible results.
- **Verify**:
  - `cd app && npx vitest run src/demo/engines.test.ts` passes.

## T-005 — Entry point, banner and guided tour

- **Refs**: FR-5, FR-6, FR-7
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**:
  - `app/src/demo/tour.ts` (new)
  - `app/src/panels/DemoBanner.tsx` (new)
  - `app/src/App.tsx` (extend)
  - `app/src/panels/*` empty states (extend)
- **Steps**:
  1. Read `?demo=1` on mount; add an "explore the demo" button to the empty states.
  2. Render a persistent banner naming the demo and offering exit.
  3. Add an ordered tour across the seven tabs, keyboard-navigable.
- **Verify**:
  - Render tests cover banner presence and exit.
  - Browser pass confirms the tour advances across tabs.

## T-006 — Browser verification and documentation

- **Refs**: AC-1, AC-5, NFR-PERF-1
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**:
  - `docs/ARCHITECTURE.md` (extend), `docs/DECISIONS.md` (append), `CLAUDE.md` (current state)
- **Steps**:
  1. Drive all seven tabs in Chromium with no token; capture each.
  2. Record bundle size before/after.
  3. Document the demo module and append an ADR-lite entry.
- **Verify**:
  - `npm test && npm run typecheck && npm run lint && npm run build` green.
  - `python3 tools/spec_validator.py && python3 tools/backlog_lint.py` green.

---

## Follow-ups Discovered

> Append-only. Mirrored into [BACKLOG.md](../../BACKLOG.md).

- BL-20260822-03 — test-gap, low — the demo client is the only `GithubClient` implementation besides the transport one, and nothing forces the two to stay in step beyond a structural type check. A shared conformance suite run against both (fixtures for the transport client via `fetchImpl`) would catch a semantic divergence, not just a shape one.
- BL-20260822-04 — feature, low — the demo is a natural screenshot rig: with the clock pinned, a script could drive the seven tabs and emit the README/docs images deterministically, retiring the "every screenshot needs a live token and a scratch repo" cost the spec named.
- BL-20260822-05 — feature, low — `listVariables` returning `null` (the ADR-021 false-disarmed fix) is unreachable in the demo, so the Schedule board's "unknown" state has no demo coverage. A fixture repo whose variables are deliberately unreadable would exercise it.

## Verification record

- `npm test` — 42 files, 546 tests green. `npm run typecheck`, `npm run lint` (0 errors), `npm run build` green.
- Browser pass (Chromium, no token, every `api.github.com` request aborted): all seven tabs non-empty; Fleet Command scanned 3/3 repos (287 runs / 14d, grades C·B·A); Districts, Rankings, Workflows, Audit and Schedule all populated; the tour walked the tabs; prompts listed and editable. **0 network attempts, 0 console errors.**
- Bundle: JS 751,663 → 774,986 bytes (**+23.3 kB raw**), CSS 57,213 → 58,297 (+1.1 kB). Budget was 200 kB (NFR-PERF-1).
