# Tasks: The archify console

> Each task references `FR-*` / `NFR-*` / `AC-*` IDs from `spec.md`. CI's [tools/spec_validator.py](../../tools/spec_validator.py) enforces that every requirement in `spec.md` is referenced by at least one task.

## Conventions

- Status: `[ ]` todo / `[~]` in-progress / `[x]` done.
- Owner: GitHub handle or `@agent:<role>`.
- Each task lists exact files to touch and how to verify.

---

## T-001 — Pure layout: archify IR → positioned geometry

- **Refs**: FR-1, NFR-PURE-1, AC-1
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: `app/src/map/layout.ts` (new), `app/src/map/layout.test.ts` (new), `app/src/archify/ir.ts` (export `fleetComponentId`)
- **Steps**:
  1. Port archify's workflow constants (lane x/y/w/h/gap/title, `colXs`, node 92 × 52) and the architecture grid resolver (`origin + col × (cellW + gapX)`); place lanes, nodes, boundaries.
  2. Route edges orthogonally from endpoint sides chosen by relative position; flag `role`/`variant`; compute label anchors; expose `upstream`/`downstream` reachability over edges.
- **Verify**: `cd app && npx vitest run src/map/layout.test.ts` — determinism, bounds, no same-lane overlap, edge refs, main-path roles, 680 px frame, reachability.

## T-002 — MapView, Passport, Finder

- **Refs**: FR-2, FR-3, FR-4, NFR-A11Y-1, NFR-DESIGN-1, NFR-SEC-1, AC-2
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: `app/src/map/MapView.tsx`, `Passport.tsx`, `Finder.tsx`, `map.css` (new), `app/src/map/MapView.test.tsx` (new)
- **Steps**:
  1. Inline SVG: lanes/boundaries, nodes with `c-<type>` classes + labels, edges with markers per role/variant, legend from the IR entries, host beacons.
  2. Reader model: focus → passport (reachability, host sections), `/` finder with arrow keys, views chips, zoom nav, Escape order, reduced motion; text nodes only.
- **Verify**: `cd app && npx vitest run src/map/MapView.test.tsx src/theme.test.ts`.

## T-003 — Shell grammar: `ui/` primitives, toolbar top bar, theme toggle

- **Refs**: FR-8, NFR-DESIGN-1, NFR-STATIC-1
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: `app/src/ui/primitives.tsx`, `app/src/ui/ui.css` (new), `app/src/App.tsx`, `app/src/theme.css`, `app/src/panels/{MonitorPanel,ContentPanel,PromptStudio,SettingsPanel,FleetOpsPanel}.tsx` + their css
- **Steps**:
  1. Primitives + `ui.css` (container, header-row, panel, cards, chip, kbd, eyebrow, search-field, beacon); `.btn` toolbar-button recipe; tabs as chips with a non-colour active cue.
  2. Top bar: pulse-dot logo, theme toggle (system → dark → light) with `T`; every non-Build tab gets `PageHeader` + `Panel`; retire aliases in touched rules.
- **Verify**: `cd app && npx vitest run src/panels src/theme.test.ts && npm run typecheck`.

## T-004 — Build tab: Floor | Map, Machine Finder, Passport

- **Refs**: FR-5, NFR-PERF-1, NFR-A11Y-1, AC-3
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: `app/src/panels/BuildToolbar.tsx`, `app/src/panels/Palette.tsx`, `app/src/panels/Inspector.tsx`, `app/src/panels/LineMaps.tsx` (new), `app/src/canvas/FactoryCanvas.tsx`, `app/src/state/ui.ts` (+ test), `app/src/App.tsx`, `app/src/theme.css`, `app/src/panels/LineMaps.test.tsx` (new), `app/src/panels/BuildToolbar.test.tsx`
- **Steps**:
  1. `ui` store gains `buildMode`, `finderOpen`, `blueprintPassportOpen`; toolbar gains the mode toggle, `+ Machine`, and the title-as-blueprint-passport.
  2. Floor: palette → floating `MachineFinder` (docked open when empty, `/`), Inspector → floating passport (Escape deselects). Map: `LineMaps` renders `MapView` per line with beacons and a machine passport (blurb, dials, diagnostics, capabilities, members of `+N more`, Edit on the floor).
- **Verify**: `cd app && npx vitest run src/panels/LineMaps.test.tsx src/panels/BuildToolbar.test.tsx src/state/ui.test.ts`.

## T-005 — Fleet Observe on the map; retire the React Flow fleet canvas

- **Refs**: FR-6, NFR-A11Y-1, AC-4
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: `app/src/canvas/FleetView.tsx`, `app/src/canvas/FleetView.test.tsx` (new), delete `app/src/canvas/FleetCanvas.tsx`, `app/src/canvas/WorkflowNode.tsx`, `app/src/canvas/fleetview.css`, `app/src/fleet/layout.ts`; `app/src/theme.css` (drop `.wfnode`/`.extnode`/fleet-edge rules)
- **Steps**:
  1. Observe → `MapView` over `toArchitectureIR(fleet, { cap: all })`, beacons from `statusByPath`, workflow passport (triggers, agent, sinks, gate, cross-repo, last run), delivered-map action via the manifest.
  2. Delete the React Flow fleet renderer and its styles; grep for stale imports.
- **Verify**: `cd app && npx vitest run src/canvas/FleetView.test.tsx && npm run typecheck`.

## T-006 — Delivered maps in-app: manifest, DiagramFrame, `::map`

- **Refs**: FR-7, NFR-SEC-1, NFR-STATIC-1, AC-5, AC-6
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: `app/scripts/gen-maps.ts`, `app/public/maps/manifest.json` (generated), `app/src/map/manifest.ts` (+ test), `app/src/map/DiagramFrame.tsx`, `app/src/docs/markdown.ts` (+ test), `app/src/panels/DocsView.tsx`, `app/src/panels/docs.css`, `_docs/what-is-gitfactory.md`, `_docs/machines-and-belts.md`, `docs/GENERATED-FILES.md`
- **Steps**:
  1. `gen-maps` writes a sorted `manifest.json`; `npm run maps` then `npm run maps:check` green; hand-edit → non-zero.
  2. `deliveredMapFor`, `DiagramFrame` (base URL, `embed=1`, theme parity, lazy, caption, open link), `::map` block, Docs embeds.
- **Verify**: `cd app && npm run maps && npm run maps:check && npx vitest run src/map/manifest.test.ts src/docs/markdown.test.ts src/panels/DocsView.test.tsx`.

## T-007 — Tour copy and repository docs

- **Refs**: FR-9
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: `app/src/demo/tour.ts`, `docs/ARCHITECTURE.md` (§ 7f), `docs/ROADMAP.md`, `docs/DECISIONS.md` (ADR-035), `README.md`, `CLAUDE.md`
- **Steps**:
  1. Tour Build/Fleet steps mention Map mode and the Observe map.
  2. ARCHITECTURE § 7f (the console surfaces), ROADMAP Maps box ticked, ADR-035, README + CLAUDE.md current state and repo map.
- **Verify**: `python3 tools/unwrap-prose.py --check`; `cd app && npx vitest run src/panels/DemoBanner.test.tsx`.

## T-008 — Gates, browser verification, follow-ups

- **Refs**: AC-7, AC-8, NFR-STATIC-1
- **Owner**: @agent:implementer
- **Status**: `[x]`
- **Files**: none (evidence in the PR)
- **Steps**:
  1. `cd app && npm test && npm run lint && npm run typecheck && npm run build && npm run maps:check`; `python3 tools/spec_validator.py && python3 tools/backlog_lint.py && python3 tools/unwrap-prose.py --check`; report the bundle delta.
  2. Chromium pass on `?demo=1`: seven tabs × two themes, Map mode, Observe map, `/`, node click, `T`; screenshots; zero console errors.
- **Verify**: all commands exit 0; screenshots attached.

---

## Done-When (Definition of Done)

- All tasks `[x]`; all `AC-*` covered; `cd app && npm test && npm run build` green; `python3 tools/unwrap-prose.py --check` clean; follow-ups below populated and mirrored into `BACKLOG.md`.

---

## Follow-ups Discovered

> Append-only. Mirror each item into [BACKLOG.md](../../BACKLOG.md).

- BL-20260902-04 — tech-debt, low — The workflow map's four-node lane capacity collapses extra machines into `+N more` in-app exactly as on the delivered map; the in-app surface is not bound by archify's showcase rules, so `toWorkflowIR` could take a wider column set for the live map (sharpens BL-20260828-09).
- BL-20260902-05 — feature, low — The console skipped two viewer-runtime pieces: a Semantic Lens (recede by kind) and a copyable deep link (`?focus=<id>`) on the passport, plus a full-bleed Present mode for the Build map.
- BL-20260902-06 — test-gap, low — The Chromium pass lives in the session scratchpad (a Playwright script over `?demo=1` with the clock pinned); commit it as `app/e2e/console-check.mjs` so it doubles as the screenshot rig BL-20260822-04 asked for.
- BL-20260902-07 — refactor, low — `FleetOpsPanel` (800+ lines) still carries its own bar/board grammar; port its HUD and boards onto the `Cards`/`Panel` primitives and retire the remaining `--copper`/`--steel` aliases in `fleetops.css` and `monitor.css` (progress on BL-20260828-12).
- BL-20260902-08 — feature, low — The floor's Machine Passport has no authored-reach trace (React Flow owns the belts there); port Upstream / Downstream highlighting onto the canvas so the floor and the map answer the same buttons.
- Measured: initial JS +9.0 kB raw / +4.0 kB gzip (787.7 vs 778.7 kB); lazy map chunk 35.4 kB raw / 13.2 kB gzip (MapView 26.9 + LineMaps 5.8 + ObserveMap 2.8) loaded only on the map surfaces; CSS +18.5 kB raw / +3.2 kB gzip.
