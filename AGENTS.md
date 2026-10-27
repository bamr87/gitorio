<!-- kit: sdlc v0.1.0 · AGENTS.md is the CANONICAL agent instructions file (decision D4, UPS-AGENT-07/08). -->

# gitorio

> gitorio is GitFactory: a static, Factorio-style factory builder whose blueprints compile to GitHub Actions workflows that run Claude Code agents against real repositories.

## What this repo is

Users drag machines onto a canvas, connect them with belts, and **Deploy** compiles the blueprint into `factory--<slug>.yml` workflows in the target repo. The frontend is fully static (GitHub Pages); GitHub is the database, the event bus and the compute layer. The app also observes and operates a fleet (Fleet Ops, the Harness tab against the bamr87 hub) and runs tokenless with `?demo=1`. This repo dogfoods itself in `.factory/`. A change is done when it meets its spec's acceptance criteria, the gates below are green, generated files are regenerated rather than hand-edited, and the docs that describe it are updated in the same PR. Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before touching the compiler or auth.

## Stack & commands

Node 22 (`.nvmrc`), Vite + React + `@xyflow/react`, TypeScript, Vitest, ESLint; stdlib Python 3 gates in `tools/`. All application code lives in `app/`.

```bash
cd app
npm install
npm run dev        # vite dev server + HMR → http://localhost:5173
npm test           # vitest — compiler invariant tests
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # typecheck + production build → app/dist
```

Repo gates (from the root; CI runs each of them):

```bash
python3 tools/spec_validator.py && python3 tools/backlog_lint.py   # AO-SDLC gates (CI spec-gate)
python3 tools/unwrap-prose.py --check --exclude '(^|/)SCHEMA\.md$' --exclude '(^|/)CHANGELOG\.md$' --exclude '^vendor/'
python3 tools/docs_index.py --check                               # docs/README.md index is fresh
(cd app && npm run maps:check)                                    # delivered maps match the IR (CI diagram-gate)
(cd app && npm run reference:check)                               # docs/reference/ matches the registry (also in npm test)
docker compose up dev                                             # the same dev server in a container
```

Regenerate with `cd app && npm run maps` (maps), `npm run reference` (machine reference), `npx vite-node scripts/regen-examples.ts` (`examples/compiled/`), `npx vite-node scripts/gen-docs-gardener.ts` (the docs-gardener trio) and `python3 tools/docs_index.py --write` (docs index). [`docs/GENERATED-FILES.md`](docs/GENERATED-FILES.md) lists every generated file.

## Layout

| Path | What lives there |
| --- | --- |
| `app/` | The static frontend. `src/`: `compiler/` (pure compiler), `machines/` (registry), `github/` (client, deploy, telemetry), `fleet/` (Fleet Ops engines + verbatim fixtures), `archify/` (IR + colour vocabulary), `map/` (in-app maps), `ui/` (console primitives), `harness/` (hub harness engine), `demo/` (fixture client), `state/`. Also `scripts/` (generators) and `public/maps/` (generated) |
| `.factory/` | This repo's own blueprints, prompts and `config.yml` — source, not output |
| `.github/workflows/` | Hand-written CI/Pages/release/evolve workflows plus the compiled `factory--*.yml` lines |
| `schema/` | `blueprint.schema.json`, drift-guarded against the registry |
| `examples/` | Example blueprints and the `compiled/` golden anchors |
| `docs/` | Contributor docs, indexed in [`docs/README.md`](docs/README.md); `reference/` is generated |
| `_docs/` | The user-facing collection rendered in the app's Docs tab and tended by the Docs Gardener |
| `specs/` | AO-SDLC spec packages `NNN-slug/{spec,plan,tasks}.md` + `_template/` |
| `tools/` | Stdlib gates: spec validator, backlog lint, picker, id-minter, evolve audit, unwrap-prose, docs index |
| `.claude/` | Slash commands (AO-SDLC chain, `/add-machine`, `/compile-check`, `/session-log`), review agents, skills (`archify`, `verify-feature`), hooks |
| `vendor/archify/` | Pinned `tt-a1i/archify` renderer (`VENDOR.md` records the commit) — never edit |
| `packages/` | Two imported repos (`git-with-the-program`, `gitnexus`) with their own tooling; run commands inside each |
| `seeds/`, `blog/drafts/` | Closed bootstrap-era prompts (history); session-log drafts headed for it-journey |

[`docs/DOCUMENTATION-MAP.md`](docs/DOCUMENTATION-MAP.md) says which of `docs/`, `_docs/`, `specs/` and `blog/` new writing belongs in.

## Conventions

- **Backlog of record:** [`BACKLOG.md`](BACKLOG.md) — append-only `BL-YYYYMMDD-NN` items (mint with `python3 tools/next_backlog_id.py`), declared as `backlog.mode: file` in `.github/sdlc.yml`. Items move Open → Claimed → Done, never deleted. Not to be confused with `.factory/backlog.yml`, the product's content queue.
- **Definition of Done:** the checklist in [`.github/pull_request_template.md`](.github/pull_request_template.md) plus golden rule #8 for a new machine type.
- **Decisions:** ADR-lite entries appended to [`docs/DECISIONS.md`](docs/DECISIONS.md) (ADR-001…041; date, decision, why, alternatives). The fleet-format ADR directory `docs/adr/` (the `adr_path` in `.github/sdlc.yml`) holds ADR 0001 and its index.
- **Session workflow:** pick work with `python3 tools/pick_backlog_item.py` (or file the user's request as a `BL-*` item), run `/specify` → `/clarify` → `/plan` → `/tasks` → `/implement` one task at a time (or `/evolve` for a whole cycle), work to the acceptance criteria and nothing more, then `/session-log`. [`docs/AO-SDLC.md`](docs/AO-SDLC.md) has the stages and gates.
- **Commits:** Conventional Commits (`feat fix docs style refactor test chore perf ci build`). **Branches:** `feature/`, `fix/`, `docs/`, `refactor/`, `test/` or `chore/` off `main`.
- **Changelog:** `CHANGELOG.md` is written by release-please (`.github/workflows/release.yml`); don't edit it by hand.
- **Markdown:** one paragraph per line; `markdown-oneline.yml` repairs a PR branch and fails a push to `main`.
- **Never:** push to `main` directly, hand-edit a generated file, commit secrets, suppress type errors, or leave empty exception handlers.

## The metaphor (use it consistently in code, UI copy and docs)

| Factory term | GitHub reality |
| --- | --- |
| **Machine** | A node: trigger, processor (Claude agent, filter, gate), or sink (comment, label, PR…) — every type is in [`docs/reference/machines.md`](docs/reference/machines.md) |
| **Belt** | An edge: event/data flow between machines |
| **Blueprint** | The graph, stored as `.factory/blueprint.json` in the *target* repo (versioned, shareable as an encoded string) |
| **Assembly line** | One connected subgraph → one workflow file `factory--<slug>.yml` |
| **Power** | The Claude auth repo secret — `CLAUDE_CODE_OAUTH_TOKEN` (default) or `ANTHROPIC_API_KEY` (fallback); agent machines are greyed out without it |
| **Telemetry** | Actions run data polled from the API, rendered as machine status LEDs |
| **Map** | A rendered archify diagram of a line or a fleet — delivered under `app/public/maps/` (`npm run maps`, ADR-034) and drawn live by `app/src/map/` from the same IR |
| **Passport** | archify's Semantic Passport: the one proof surface a focused machine or workflow opens; there are no permanent side panels |
| **Finder** | archify's Node Finder: `/` opens it on the floor (add a machine) and on every map (focus a node) |
| **Harness** | The hub's six-layer model (guides, sensors, bounded loop, memory, permissions, observability). GitFactory designs it; the hub monitors it (`_data/harness_health.yml`); the Harness tab renders the hub's page from the same engine (ADR-036) |
| **Lane** | A `fleet/v1` record of one line in `fleet.manifest.yml` — the interchange contract with the hub and `wtd` (`packages/wtd/`, spec in `packages/wtd/docs/FLEET-SPEC.md`); one `HarnessCard` draws it everywhere |
| **Trip wire** | One of the hub's six alarms (stale-data, pass-rate-floor, waste-ceiling, cost-spike, standing-failures, credential-overdue) — an attention item, never an action |
| **Hub** | The bamr87/bamr87 monorepo that presents and monitors the fleet; read-only from GitFactory — one persisted slug, never a token, never a write |

## Architecture in ten lines

1. Static React app (Vite + `@xyflow/react`) — deployable to GitHub Pages, zero backend.
2. The canvas edits a **Blueprint** (JSON, schema in `schema/blueprint.schema.json`).
3. The **compiler** (`app/src/compiler/compile.ts`) is a pure function: Blueprint → `{filename, yaml, diagnostics}[]`.
4. Compiled workflows use **`anthropics/claude-code-action@v1`**, authenticated by `CLAUDE_CODE_OAUTH_TOKEN` with `ANTHROPIC_API_KEY` as fallback.
5. Downstream sinks of an agent become its **obligations** (prompt contract) plus scoped `--allowedTools` grants.
6. Trigger→sink chains with no agent compile to deterministic `gh` CLI steps.
7. The app reads and writes blueprints, prompts and workflow files in target repos through the GitHub REST API (fine-grained PAT; GitHub App device flow is parked).
8. Prompts live in the target repo at `.factory/prompts/*.md` — reviewable, versioned, hot-editable without recompiling.
9. Monitoring polls workflow runs and issue/PR timelines with conditional requests (ETags); no server.
10. Loop guards are compiler-enforced: an agent that writes comments never retriggers itself.

## Golden rules

1. **The frontend stays static.** No servers unless a spec introduces the optional webhook worker (Phase 7+). Everything works from GitHub Pages + APIs.
2. **The blueprint is the source of truth.** Generated YAML carries a `GENERATED BY GITFACTORY` header + blueprint hash. Never hand-edit generated files; fix the compiler (or the generator) and regenerate.
3. **The compiler is pure and tested.** No I/O, no globals. Every machine type has invariant tests in `compile.test.ts` that assert critical YAML fragments, not full golden strings.
4. **Verify, don't recall.** Before changing anything that touches `anthropics/claude-code-action`, fetch its current `action.yml` and docs from <https://github.com/anthropics/claude-code-action> (`direct_prompt`/`allowed_tools` are deprecated → `prompt`/`claude_args`). Check <https://docs.github.com/en/rest> for Octokit endpoints when unsure.
5. **Least privilege, always.** Compiled workflows get a computed `permissions:` block — only what the sinks need. Agent tools are narrow `--allowedTools` patterns like `Bash(gh issue comment:*)`, never blanket Bash.
6. **Loop guards are mandatory.** A workflow triggered by comments/issues that can also write comments/issues guards on the event actor (`github.event.sender.type != 'Bot'`, ADR-009). The compiler refuses to emit an unguarded feedback loop.
7. **Secrets never touch the blueprint, the code, or localStorage.** PATs live in `sessionStorage` at most (or a DEV-only `.env` the build refuses to bundle). Claude auth secrets are only `${{ secrets.* }}` in generated YAML, or provisioned through the encrypted-secret API (libsodium sealed box).
8. **Definition of done for a new machine type:** registry entry (`app/src/machines/registry.ts`) + config fields + compiler emitter + invariant test + one sentence in the `docs/ARCHITECTURE.md` §4 catalog + `cd app && npm run reference` + it renders on the canvas. `/add-machine` walks the checklist.
9. **Untrusted content is untrusted.** Issue bodies, PR diffs and comments are attacker-controlled input to agents: pass entity numbers, not bodies (ADR-005); never widen tool grants to make a prompt work — tighten the prompt. Fork PRs get no secrets (ARCHITECTURE §8).
10. **End every session with `/session-log`:** a draft post in `blog/drafts/` (`draft: true`, with a *Working-with-AI tip* section) and a dated `docs/DECISIONS.md` entry if a decision was made or reversed.
11. **The factory always grows forward (AO-SDLC).** Non-trivial work enters as a `BL-*` item, graduates to a `specs/NNN-slug/` package, and every implement cycle ends with `## Follow-ups Discovered` mirrored into `BACKLOG.md`. `tools/spec_validator.py` + `tools/backlog_lint.py` enforce this in CI (`spec-gate`) and through a blocking edit hook.

## Invariants worth knowing

- **Agents never merge** (ADR-039): `sink.merge_pr` downstream of an agent, or any merge-capable grant, is a compile error; merges are deterministic, label-gated lines (ADR-027).
- **Autonomous lines are default-OFF:** each scheduled agent line sits behind a `gate.enablement` repo variable (`*_ENABLED`); unset means idle (ADR-017). The same convention gates `evolve.yml` (`EVOLVE_AUDIT_ENABLED`).
- **Action versions are a compiler change:** bump `PINNED_ACTIONS` in `compile.ts` and regenerate; never accept a Dependabot edit to a `factory--*.yml` (ADR-033).
- **The demo is one substitution, not a mode:** `app/src/demo/` implements `GithubClient` over fixtures; no `if (demo)` branch anywhere (ADR-032).
- **Design tokens live in `theme.css` only:** no colour literals elsewhere (`theme.test.ts` enforces it); machine tones come from `app/src/archify/vocabulary.ts`.
- **The hub is read-only:** GitFactory persists the hub slug, never a token, and never writes to it (ADR-036).

## Current status

Pre-alpha and dogfooding itself: canvas, compiler (28 machine types), GitHub connect + deploy, telemetry, Prompt Studio, the headless-CMS cockpit, Fleet Ops, the archify console and maps, the tokenless demo, and harness parity with the hub have shipped. Phase status and acceptance history are in [`docs/ROADMAP.md`](docs/ROADMAP.md); every decision is in [`docs/DECISIONS.md`](docs/DECISIONS.md); open work is in [`BACKLOG.md`](BACKLOG.md). Parked: the OODA dispatcher, belt mode (Phase 6.1) and the GitHub App device flow (Phase 7, blocked on browser CORS). Update this paragraph only when the headline status changes — history goes to ROADMAP and DECISIONS.

## Fleet context

Member of the bamr87 fleet. The standards live in the hub: <https://github.com/bamr87/bamr87/tree/main/specs> (the Universal Project Standard). The repo's SDLC declaration is `.github/sdlc.yml`. gitorio is a submodule of `bamr87/bamr87`: commit and push here first; the hub bumps its pointer afterwards. Loops that act on this repo: the hub's fan-outs (standardize, sdlc and harness kits arrive as PRs), the shared `standard-ci.yml` and `fleet-conformance.yml` gates called from CI, the hub's daily fleet-pulse doctor (draft fix PRs for failing workflows), and this repo's own `@claude` handler, `evolve.yml` and kill-switched `factory--*` lines.

## Standard deviations

none

## Governance

Read [`docs/constitution.md`](docs/constitution.md) before changing anything: it is the highest-precedence rule set here and wins over this file when they disagree. It changes only through a numbered record in [`docs/amendments/`](docs/amendments/), ratified by the maintainer merging the PR; agents propose, never merge. Every user-facing feature has a stable id in [`features/features.yml`](features/features.yml) with `status`, location and the PRD requirement ids it serves; the PRD's "Feature catalog" block is generated from it (`python3 <bamr87/bamr87>/tools/governance_lint.py prd-sync . --write`; check with `… check .`). Never hand-edit that block or `CHANGELOG.md`.
