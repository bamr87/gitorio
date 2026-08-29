# Plan: The Evidence Console

> Companion to `spec.md`.

## 1. Architecture Overview

A tokens-first migration: `theme.css` gains a new `:root` block whose canonical names are archify's (`--canvas`, `--mask`, `--ink`, `--muted`, `--dim`, `--border`, `--c-frontend` … `--c-external`) plus derived semantic roles (`--accent`, `--ok`, `--warn`, `--danger`) and DESIGN.md radii/motion. Every legacy name becomes an alias of a new token, so all 700 existing rules keep resolving while each is then moved to the semantic role it actually means (accent vs warning, the copper split). Light mode redefines tokens only, in the three-state pattern (`:root` dark, `prefers-color-scheme: light` guarded by `:not([data-theme="dark"])`, `[data-theme="light"]`). See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) § 7e for the vocabulary the colours come from.

## 2. Component Changes

| Layer | File / Module | Change |
|-------|---------------|--------|
| Theme | `app/src/theme.css` | new token block (dark + light), aliases, copper split, radii/motion, `--cat-*` for FleetOps types, `.machine--c-*` |
| Panels | `content.css`, `docs.css`, `fleetops.css`, `settings.css` | literals → tokens |
| Canvas | `MachineNode.tsx`, `Palette.tsx` | add `machine--c-<component>` / `palette__*--c-<component>` from `vocabulary.ts` |
| State | `state/settings.ts` (+ test) | `theme` preference + setter |
| Shell | `App.tsx`, `SettingsPanel.tsx` | stamp `data-theme`; radio control |
| Tests | `src/theme.test.ts` (new) | AC-1 literal scan, AC-2 class/token check |

## 3. Blueprint & Schema Changes

None.

## 4. Tech Choices & Alternatives

| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|-------------------------|-----|
| Migration strategy | Aliases first, then per-rule semantic moves | Rewrite every rule at once | Zero-breakage at each step; reviewable diff |
| Default theme | Dark (archify is dark-first); light follows system or Settings | Light default | Continuity for existing users; DESIGN.md's stated default |
| Fonts | System/JetBrains Mono stack, no download | Google Fonts link | Golden rule #1 / offline Pages; identical to the maps after the fonts strip |
| Literal enforcement | vitest scan of `src/**/*.css` | stylelint | No new dev dependency |

ADR-034 already records the design-language decision; no new ADR.

## 5. Least Privilege & Permissions

No compiled workflow, grant, or `permissions:` block is touched.

## 6. Loop Guards & Untrusted Input

No event-triggered code and no untrusted content reaches this change; the theme preference is a validated enum read from localStorage.

## 7. Test Strategy

- `theme.test.ts`: (a) no `#hex`/`rgb(` outside `theme.css`; (b) all seven `--c-*` tokens defined; (c) `machineTone(type)` for every registry type returns a vocabulary component.
- `settings.test.ts`: theme round-trips and rejects junk.
- Browser: demo, seven tabs, dark + light, screenshots attached to the PR.

## 8. Rollout

Pages picks it up on merge. No kill switch (pure UI).

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Contrast regressions in light mode | med | med | Tab-by-tab browser check; tokens tuned per DESIGN.md light block |
| A rule keeps a legacy alias with the wrong meaning | med | low | Copper split reviewed rule by rule; aliases documented as transitional |

## 10. Estimated Effort

One session, four tasks.
