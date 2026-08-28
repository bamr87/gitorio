# Tasks: Archify maps

> Each task references `FR-*` / `NFR-*` / `AC-*` IDs from `spec.md`.

## Conventions

- Status: `[ ]` todo / `[~]` in-progress / `[x]` done.
- Owner: GitHub handle or `@agent:<role>`.
- Each task lists exact files to touch and how to verify.

---

## T-001 — Vendor archify pinned to a commit

- **Refs**: FR-1, NFR-LIC-1, NFR-SEC-1, AC-1
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**:
  - `vendor/archify/**` (new), `vendor/archify/VENDOR.md` (new), `NOTICE` (new)
  - `.gitattributes`, `app/.prettierignore`
- **Steps**:
  1. Copy bin, renderers, schemas, assets, brand-marks, recipes, references, delta, scripts, examples JSON, SKILL/DESIGN/PRODUCT, LICENSE, package.json from upstream `7fe139e`.
  2. Record SHA/version/date/omissions in `VENDOR.md`; mark the tree `linguist-vendored`.
- **Verify**:
  - `node vendor/archify/bin/archify.mjs render workflow vendor/archify/examples/agent-tool-call.workflow.json /tmp/a.html` twice → `cmp` identical.
  - `node vendor/archify/bin/archify.mjs validate workflow vendor/archify/examples/agent-tool-call.workflow.json --quality showcase --json` → `"ok": true`.

## T-002 — Vocabulary: machine type → componentType + lane

- **Refs**: FR-2, NFR-PURE-1, AC-2
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**:
  - `app/src/archify/vocabulary.ts` (new), `app/src/archify/vocabulary.test.ts` (new)
- **Steps**:
  1. Export `componentTypeFor(type)`, `laneFor(type)`, `shortLabel(type)`; unknown types fall back to `external` + `agent` lane but the drift guard fails on any registry type without an explicit entry.
- **Verify**:
  - `cd app && npx vitest run src/archify/vocabulary.test.ts` passes.

## T-003 — `toWorkflowIR` (one assembly line → workflow IR)

- **Refs**: FR-3, NFR-PURE-1, AC-3, AC-5
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**:
  - `app/src/archify/ir.ts` (new), `app/src/archify/ir.test.ts` (new)
- **Steps**:
  1. Depth by longest path from triggers; lanes by role; same-lane collision resolver against the renderer's column x positions; a full lane's tail collapses into one "+N more" node.
  2. `mainPath` = longest trigger→sink walk; guard node in an `exception` lane iff loop-prone.
  3. Validate with the vendored `validateSchema` and the CLI at showcase quality over both dogfood blueprints.
- **Verify**:
  - `cd app && npx vitest run src/archify/ir.test.ts` passes.

## T-004 — `toArchitectureIR` (fleet → architecture IR)

- **Refs**: FR-4, NFR-PURE-1, AC-4
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**:
  - `app/src/archify/ir.ts` (extend), `app/src/archify/ir.test.ts` (extend)
- **Steps**:
  1. Rank workflows (generated > agent > belted > rest), cap at 12 with a collapsed "N more" external component; grid layout, one boundary per repo, connections from `fleet.edges`.
  2. Validate over the three demo repos via `createDemoClient()` + `importFleet`.
- **Verify**:
  - `cd app && npx vitest run src/archify/ir.test.ts` passes.

## T-005 — `gen-maps` script: generate, header, font strip, `--check`

- **Refs**: FR-5, NFR-GEN-1, NFR-STATIC-1, AC-6, AC-7
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**:
  - `app/scripts/gen-maps.ts` (new), `app/package.json` (scripts `maps`, `maps:check`), `app/public/maps/**` (generated)
- **Steps**:
  1. For each `.factory/*.blueprint.json` line and each demo repo: write `<slug>.<kind>.json` and render `<slug>.html` via the vendored CLI; prepend the header; strip the fonts link; `archify check`.
  2. `--check` renders to a temp dir and diffs against `app/public/maps/`.
- **Verify**:
  - `cd app && npm run maps && npm run maps:check` exits 0; edit a map by hand → `npm run maps:check` exits 1.
  - `cd app && npm run build && ls dist/maps` lists the maps; `grep -rl "render-workflow" dist/assets` is empty.

## T-006 — CI `diagram-gate`

- **Refs**: FR-6, NFR-GEN-1
- **Owner**: @bamr87
- **Status**: `[~]`
- **Files**:
  - `.github/workflows/ci.yml`
- **Steps**:
  1. Add a job that runs `npm ci`, `npm run maps:check`, and showcase validation over `app/public/maps/*.json`.
- **Verify**:
  - The PR's CI run shows `diagram-gate` green.

## T-007 — Skill install + `/compile-check` diagram step + docs

- **Refs**: FR-7, NFR-STATIC-1
- **Owner**: @bamr87
- **Status**: `[x]`
- **Files**:
  - `.claude/skills/archify` (symlink), `.claude/commands/compile-check.md`, `docs/ARCHITECTURE.md` (§ 7e), `CLAUDE.md` (metaphor table + repo map + current state)
- **Verify**:
  - `ls -L .claude/skills/archify/SKILL.md` resolves; `python3 tools/unwrap-prose.py --check` clean.

---

## Done-When (Definition of Done)

- All tasks `[x]`.
- All `AC-*` from `spec.md` covered by passing tests.
- `cd app && npm test && npm run build` green.
- `python3 tools/unwrap-prose.py --check` clean (the markdown-oneline CI rule).
- **`## Follow-ups Discovered` section below populated**.

---

## Follow-ups Discovered

> Append-only. Mirror each item into [BACKLOG.md](../../BACKLOG.md) with a `BL-YYYYMMDD-NN` id (`python3 tools/next_backlog_id.py`).

- BL-20260828-04 — feature, med — Sequence maps for runs (`toSequenceIR` over jobs + steps), lifecycle maps for the perfection loop's ledger, and dataflow maps for belts — the three archify kinds specs/010 deliberately left out (NG3).
- BL-20260828-05 — infra, med — The Cartographer factory line: `trigger.push` on `.factory/**` → deterministic `npm run maps` step → `sink.open_pr`, default-OFF via `CARTOGRAPHER_ENABLED`, so GitFactory regenerates its own maps instead of relying on a local `npm run maps`.
- BL-20260828-06 — feature, low — Deploy-time before/after map: run archify `compare` on the fleet architecture IR before and after a deploy plan and attach the HTML to the deploy PR (PR mode only).
- BL-20260828-07 — infra, low — Monthly upstream drift check for the vendored archify pin (`vendor/archify/VENDOR.md`): diff the pinned commit against upstream and file a BL item when the schemas or renderer contracts change.
- BL-20260828-08 — feature, low — Per-district fleet maps for rosters larger than the 12-component story budget (`toArchitectureIR` currently collapses the tail into one "N more workflows" node per repo).
- BL-20260828-09 — tech-debt, low — `toWorkflowIR` lane capacity is four nodes; a line with a gate chain plus ≥3 sinks collapses outputs into "+N more". Consider a two-row lane (32 px nodes with `yOffset`) once archify's showcase rules for stacked nodes are understood.
