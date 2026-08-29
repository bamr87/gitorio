# Spec: The Evidence Console — archify's design language as GitFactory's UI theme

- **ID**: 011-evidence-console
- **Status**: shipped
- **Owner**: @bamr87
- **Created**: 2026-08-28
- **Roadmap link**: [docs/ROADMAP.md](../../docs/ROADMAP.md) § Maps — design-token migration (ADR-034, plan Tier A)
- **Golden-rules compliance**: confirmed against [CLAUDE.md](../../CLAUDE.md) § Golden rules

## 1. Problem & Motivation

The app's chrome speaks one visual language (an industrial copper/steel control room, dark-only, 27 colour literals in `theme.css` and 61 more across four panel stylesheets, several of them off-palette GitHub fallbacks left from ADR-019) while the maps shipped by specs/010 speak archify's — a midnight console with seven semantic colours where colour carries meaning. A reader who clicks from a machine on the canvas to the same machine on a map should see the same colour mean the same thing. ADR-034 chose archify's `DESIGN.md` ("The Evidence Console") as the app's design system; this spec performs that migration tokens-first, so every panel moves together and the vocabulary in `app/src/archify/vocabulary.ts` becomes the single source of what a machine kind looks like.

## 2. Origin & Background

- Backlog items claimed: BL-20260828-10
- Builds on ADR-019's token unification (the `--border`/`--muted`/`--accent`/`--input` aliases) and on specs/010's `vocabulary.ts` (machine kind → archify component type).
- Source of truth for values: `vendor/archify/DESIGN.md` and the dark/light token blocks in `vendor/archify/assets/template.html`.

## 3. Goals

- G1: One token set, defined once in `app/src/theme.css`, carrying archify's grounds, seven semantic colours, type scale, radii, spacing, and motion durations — in both dark (default) and light.
- G2: Machine kinds on the canvas, in the palette, and on the maps share the same semantic colour via the vocabulary.
- G3: Light theme is a peer: system preference by default, overridable in Settings, persisted like other preferences.
- G4: No colour literal outside `theme.css` — enforced by a test.

## 4. Non-Goals

- NG1: No layout or information-architecture changes; panels keep their structure and copy.
- NG2: No external font download; JetBrains Mono is used when installed, with the system mono stack as fallback (the maps already behave this way after the fonts-link strip).
- NG3: No archify component ports beyond tokens (the "diagram-panel"/"toolbar-button" recipes inform values, not new React primitives).

## 5. User Stories

- As a reader moving between the canvas and a map, I want a gate to be rose and an agent to be green in both, so that colour tells me what a thing is.
- As a daytime user, I want a light theme that keeps the same vocabulary, so that the app is usable on a bright desk without becoming a different product.

## 6. Functional Requirements

- **FR-1**: `theme.css` `:root` defines the dark palette from DESIGN.md (`canvas`, `mask`, `ink`, `muted`, `dim`, `border`, and `frontend`/`backend`/`database`/`cloud`/`security`/`messagebus`/`external`) plus derived tokens (`--accent` = frontend cyan, `--ok` = backend green, `--warn` = cloud amber, `--danger` = security rose, soft variants), radii (`--r-precise`/`--r-control`/`--r-panel`/`--r-pill`), spacing, and `--motion` (160 ms); the legacy names (`--floor`, `--panel`, `--panel-2`, `--seam`, `--copper*`, `--steel`, `--signal`, `--alarm`, `--border`, `--muted`, `--input`, `--accent-soft`, `--hover`) remain as aliases so no rule breaks during the migration.
- **FR-2**: A light palette is defined under `@media (prefers-color-scheme: light)` guarded as `:root:not([data-theme="dark"])` and again under `:root[data-theme="light"]`, redefining only tokens; `body` paints `var(--canvas)` explicitly.
- **FR-3**: Machine nodes carry `machine--c-<componentType>` from `vocabulary.ts` and the palette section titles/items use the same mapping; belts use the accent; LEDs use `--ok`/`--warn`/`--danger`.
- **FR-4**: Settings gains a `theme: 'system' | 'dark' | 'light'` preference (persisted in `gitfactory.settings.v1`, default `system`) with a radio control under Preferences; the app stamps `data-theme` on `<html>` for `dark`/`light` and removes it for `system`.
- **FR-5**: Every colour literal outside `theme.css` is replaced by a token (panel fallbacks dropped, Content/Docs/FleetOps literals mapped); FleetOps' categorical cost-type bars become `--cat-*` tokens in `theme.css`.
- **FR-6**: Chrome typography is mono-forward per DESIGN.md (`--chrome` = the mono stack; long-form Markdown in the Docs tab keeps a sans body face); hover/focus transitions use `--motion` and are disabled under `prefers-reduced-motion`.

## 7. Non-Functional Requirements

- **NFR-A11Y-1**: Text/background contrast ≥ 4.5:1 for body text and ≥ 3:1 for UI text in both themes, checked on the demo across all seven tabs.
- **NFR-STATIC-1**: No new runtime dependency and no network request for fonts (golden rule #1).
- **NFR-PERF-1**: JS bundle growth ≤ 4 kB raw (the Settings control and the `<html>` stamp are the only new script); CSS is the only meaningful change.

## 8. Blueprint & Schema Impact

None.

## 9. Compiler & Workflow Impact

None.

## 10. UI Impact

`theme.css`, the four panel stylesheets with literals (`content.css`, `docs.css`, `fleetops.css`, `settings.css`), `MachineNode.tsx`, `Palette.tsx`, `SettingsPanel.tsx`, `state/settings.ts`, `App.tsx` (theme stamping). Design-token compliance is the point of the spec; a11y per NFR-A11Y-1.

## 11. Security Impact

None — CSS and a persisted enum preference; no token or secret handling changes (the settings store already persists only harmless preferences, never PATs).

## 12. Acceptance Criteria

- **AC-1**: Given the stylesheets under `app/src`, when scanned for hex/rgb(a) literals, then only `theme.css` contains any (test).
- **AC-2**: Given `MACHINES`, when each type's canvas class is derived, then it equals `machine--c-` + the vocabulary component type, and the seven `--c-*` tokens exist in `theme.css` (test).
- **AC-3**: Given a persisted `theme: 'light'`, when the app mounts, then `document.documentElement.dataset.theme === 'light'`; given `'system'`, then the attribute is absent (test).
- **AC-4**: Given the demo (`?demo=1`), when each of the seven tabs is opened in dark and in light, then no text fails NFR-A11Y-1 (browser check, screenshots in the PR).
- **AC-5**: `npm test`, `npm run lint`, `npm run build` green; bundle growth within NFR-PERF-1.

## 13. Risks & Open Questions

- **R-1**: Copper carried two meanings (primary accent *and* warning); splitting it by rule is manual — mitigated by the AC-4 tab-by-tab check.
- **R-2**: Mono chrome reduces readability in dense panels — mitigated by keeping DESIGN.md's sizes (0.75 rem body, 0.625 rem labels) and the sans face for Markdown.

## 14. Out of Scope / Follow-ups

- In-app Map surfaces (companion spec), archify recipe components as React primitives, theming of the generated maps themselves (they carry their own toggle).
