# Tasks: The Evidence Console

> Each task references `FR-*` / `NFR-*` / `AC-*` IDs from `spec.md`.

## Conventions

- Status: `[ ]` todo / `[~]` in-progress / `[x]` done.
- Owner: GitHub handle or `@agent:<role>`.

---

## T-001 — Token block, aliases, light palette, radii/motion

- **Refs**: FR-1, FR-2, FR-6, NFR-STATIC-1
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**: `app/src/theme.css`
- **Verify**: `cd app && npm run build` green; `npx vitest run src/theme.test.ts`.

## T-002 — Semantic moves: copper split, machine tones, belts, LEDs, FleetOps categories, panel literals

- **Refs**: FR-3, FR-5, AC-1, AC-2
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**: `app/src/theme.css`, `app/src/panels/{content,docs,fleetops,settings}.css`, `app/src/canvas/MachineNode.tsx`, `app/src/panels/Palette.tsx`, `app/src/theme.test.ts` (new)
- **Verify**: `cd app && npx vitest run src/theme.test.ts src/archify` passes.

## T-003 — Theme preference + stamping

- **Refs**: FR-4, AC-3
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**: `app/src/state/settings.ts`, `app/src/state/settings.test.ts`, `app/src/panels/SettingsPanel.tsx`, `app/src/App.tsx`
- **Verify**: `cd app && npx vitest run src/state/settings.test.ts` passes; `npm run typecheck`.

## T-004 — Browser verification in both themes

- **Refs**: NFR-A11Y-1, NFR-PERF-1, AC-4, AC-5
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**: none (screenshots in the PR)
- **Verify**: seven demo tabs × two themes screenshotted; `npm test && npm run lint && npm run build` green; bundle delta reported.

---

## Done-When (Definition of Done)

- All tasks `[x]`; all `AC-*` covered; `cd app && npm test && npm run build` green; `python3 tools/unwrap-prose.py --check` clean; follow-ups below populated.

---

## Follow-ups Discovered

> Append-only. Mirror each item into [BACKLOG.md](../../BACKLOG.md).

- BL-20260828-11 — tech-debt, low — React Flow's own attribution link (`.react-flow__attribution a`) is the one text element below AA contrast in light mode; it is styled by the library — override it through the theme or hide it with `proOptions.hideAttribution` (check the license terms first).
- BL-20260828-12 — refactor, low — Retire the transitional aliases in `theme.css` (`--floor`, `--panel`, `--seam`, `--copper*`, `--steel`, `--signal`, `--alarm`) once every rule uses the semantic names — ~35 references remain.
- BL-20260828-13 — feature, low — Port archify's DESIGN.md recipe components (toolbar-button, diagram-panel, search-field, evidence-beacon) as React primitives in `app/src/ui/` next to `Menu`, and re-skin the panels onto them.
- Measured: +3.6 kB raw / +0.8 kB gzip JS (theme control + `applyTheme` + `machineTone`), CSS 61.7 kB; light mode signal hues darkened to AA (`#0e7490` cyan etc.) after the first audit found accent-as-text at 3.4:1.
