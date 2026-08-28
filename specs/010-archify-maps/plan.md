# Plan: Archify maps

> Companion to `spec.md`. Describes **how** we will satisfy the requirements.

## 1. Architecture Overview

One new pure module and one new script. `app/src/archify/ir.ts` sits beside the compiler as a second pure consumer of `Blueprint` (via `assemblyLines()`) and of `Fleet` (via `fleet/parse.ts`); it emits plain JSON objects that match `vendor/archify/schemas/*.schema.json`. `app/scripts/gen-maps.ts` is the only place that touches the filesystem or spawns the vendored CLI, exactly like `regen-examples.ts` today. Rendering never happens in the browser (spec NG1); the app will later embed the pre-rendered HTML from `app/public/maps/`. See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) § 5 (compiler) and § 7c (fleet).

## 2. Component Changes

| Layer | File / Module | Change |
|-------|---------------|--------|
| Vendor | `vendor/archify/**`, `vendor/archify/VENDOR.md`, `NOTICE` | Pinned upstream tree (bin, renderers, schemas, assets, brand-marks, recipes, references, delta, scripts, examples JSON, SKILL/DESIGN/PRODUCT, LICENSE); tests, HTML examples, docs site and `archify.zip` omitted |
| Vocabulary | `app/src/archify/vocabulary.ts` | machine type → componentType + lane + short label (FR-2) |
| IR compiler | `app/src/archify/ir.ts` | `toWorkflowIR`, `toArchitectureIR`, shared id sanitising + label fitting (FR-3, FR-4) |
| Tests | `app/src/archify/ir.test.ts`, `vocabulary.test.ts` | invariants + drift guard + CLI showcase validation over the dogfood blueprints and demo fleet (AC-2..AC-5) |
| Script | `app/scripts/gen-maps.ts`, `package.json` (`maps`, `maps:check`) | generate / check (FR-5, NFR-GEN-1) |
| CI | `.github/workflows/ci.yml` | `diagram-gate` job (FR-6) |
| Skill | `.claude/skills/archify` (symlink → `vendor/archify`), `.claude/commands/compile-check.md` | FR-7 |
| Repo hygiene | `.gitattributes`, `app/eslint.config.js`, `app/.prettierignore` | vendor + `public/maps` marked generated / ignored |

## 3. Blueprint & Schema Changes

None. Archify's schemas are the contract; the IR compiler is validated against the vendored `validateSchema` in tests and the CLI in CI.

## 4. Tech Choices & Alternatives

| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|-------------------------|-----|
| How to depend on archify | Vendor a pinned SHA under `vendor/` | `npx skills add` at CI time; git submodule | No npm package exists and upstream is `-dev`; a vendored tree is reproducible, reviewable, and offline (ADR-034) |
| Where rendering runs | Scripts + CI only | Shim `node:*` and bundle renderers | Renderers execute at module scope with argv/fs; a browser build means a fork we would have to maintain (spec NG1) |
| Where maps live | `app/public/maps/` | `_docs/maps/` | Pages deploys only `app/dist`; `public/` is copied verbatim by Vite, so the maps ship with the app without touching the Docs glob |
| Header placement | Line 2, after `<!DOCTYPE html>` | Before the doctype | Verified `archify check` still passes and no quirks mode |
| Fonts | Strip the Google Fonts `<link>` | Keep it | Pages must work offline / CSP-clean; the template's fallback stack is the same mono family the design system already names |
| Workflow columns | Depth-based with same-lane collision resolution against the renderer's `colXs` | One column per machine | The renderer has six columns with 80 px neighbours; a 92 px node needs ≥100 px separation in its lane |

ADR-034 in [docs/DECISIONS.md](../../docs/DECISIONS.md) records the premise correction and the three plan decisions (pre-rendered only, retire the read-only fleet canvas in the UI spec, light theme as a peer in the design spec).

## 5. Least Privilege & Permissions

No workflow emitted by the compiler changes. The `diagram-gate` CI job runs with the workflow's default read-only `GITHUB_TOKEN` and needs no `permissions:` block beyond `contents: read`; it never writes. The generator is a local script. No `--allowedTools` grants exist in this package; the future Cartographer line (follow-up) will be an agent-less deterministic line with `sink.open_pr` only.

## 6. Loop Guards & Untrusted Input

Nothing in this package is triggered by GitHub events, so no self-retrigger path exists. Untrusted input reaching the maps: workflow YAML `name:` fields and blueprint `meta`/config strings become labels. The IR compiler truncates labels to the renderer's fit rules, restricts ids to `^[a-zA-Z][a-zA-Z0-9_-]*$`, and archify escapes all text into SVG/HTML; the generated HTML runs no page-provided script and is served as a static asset, never evaluated against a token.

## 7. Test Strategy

- `vocabulary.test.ts`: every `MACHINES` entry maps (drift guard); the mapping table is exhaustive by type prefix.
- `ir.test.ts` (node environment): structural invariants (lanes present and ordered, every edge endpoint exists, `mainPath` walks real edges, guard node iff loop-prone, ≤12 components and one boundary per repo for fleets), schema validation via the vendored `validateSchema`, and a showcase run of the vendored CLI over each dogfood line and each demo repo (spawned, temp dir).
- `gen-maps --check` in CI proves determinism + idempotency (NFR-GEN-1).
- Browser smoke: open `/maps/<slug>.html` from `npm run preview` — search, trace, theme toggle, no network requests.

## 8. Rollout

Dogfood: gitorio's own three-line factory and the Docs Gardener get maps under `app/public/maps/`, deployed with Pages. No kill switch needed (nothing scheduled). The Cartographer line is a follow-up and will be default-OFF via `CARTOGRAPHER_ENABLED`.

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Upstream drift (no releases) | high | low | `VENDOR.md` records the SHA; monthly upstream check follow-up |
| Showcase composition rules reject a real blueprint shape | med | med | Collision resolver + "+N more" collapse; CLI validation in tests over every dogfood line |
| Large fleets exceed the 12-node story | med | low | FR-4 cap + "N more" component; per-district maps follow-up |
| 700 kB maps bloat the repo | low | low | Only dogfood + demo maps are committed; a follow-up may move them to a build step |

## 10. Estimated Effort

One session for T-001..T-007; no human pairing required. T-006 (CI) is verified by the PR run.
