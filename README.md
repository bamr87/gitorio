# ⚙ GitFactory

> Factorio-style factory builder for GitHub automation: blueprints compile to Actions workflows running Claude Code.

[![CI](https://github.com/bamr87/gitorio/actions/workflows/ci.yml/badge.svg)](https://github.com/bamr87/gitorio/actions/workflows/ci.yml) [![Live site](https://img.shields.io/badge/live-bamr87.github.io%2Fgitorio-2ea44f)](https://bamr87.github.io/gitorio/) [![License](https://img.shields.io/github/license/bamr87/gitorio)](LICENSE)

## Overview

**A Factorio-style factory builder for GitHub automation.** *(working title)*

Drag machines onto a canvas. Connect them with belts. Hit **Deploy** — and your blueprint compiles into real GitHub Actions workflows where **Claude Code agents** triage issues, review PRs, garden stale threads, and commit fixes on your actual repositories.

```
 [📥 Issue opened] ══▶ [⚙ Claude: triage] ══▶ [🏷 Apply labels]
                                          ╚══▶ [📝 Post summary comment]

 [⏰ Nightly 03:00] ══▶ [⚙ Claude: gardener] ══▶ [📝 Stale-issue nudges]
```

No servers. The frontend is a static site; **GitHub is the database, the event bus, and the compute layer**. Blueprints live in your repo, prompts live in your repo, telemetry is read back from the Actions API and rendered as factory floor status.

## Features

- Drag-and-drop factory canvas: machines are triggers, Claude Code agents and actions, connected by belts
- Deploy compiles a blueprint into readable GitHub Actions workflows in your repo
- Blueprints and prompts are versioned in the repo and shareable as encoded strings
- Factory-floor status rendered from the Actions API
- A static frontend with no servers: GitHub is the database, event bus and compute

## Why this shape

- **Blueprint-in-repo** — your automation design is versioned, reviewable, and
  shareable as an encoded blueprint string, like the game.
- **Compile-to-Actions** — no bespoke runtime to babysit; the emitted YAML is
  readable, auditable, and works without GitFactory existing.
- **Agents as machines** — each Claude agent has a prompt contract, scoped tool
  grants, loop guards, and telemetry, because an unbounded agent is just a fire.

## The console

The app is built on [tt-a1i/archify](https://github.com/tt-a1i/archify)'s design language and viewer model — "The Evidence Console": a dominant canvas, compact chrome, progressive disclosure. Press **`/`** to find a machine, click one to open its **passport** (dials, diagnostics, the tools it will be granted), and flip the Build tab from **Floor** to **Map** to see each assembly line drawn as the archify map it compiles to — lanes as roles, the main path, and the bot guard the YAML really carries. Fleet **Observe** draws any repo's workflows the same way with live run status on every node; the Docs tab embeds the delivered maps; **`T`** cycles the theme like the viewer. The delivered HTML maps under `app/public/maps/` stay the canonical, exportable artifacts (route probe, presentation, share cards live there) and every surface links to them when one exists for its source.

## The harness

**Agent = Model + Harness.** The bamr87 hub ([`bamr87.github.io/bamr87/harness/`](https://bamr87.github.io/bamr87/harness/)) presents and monitors the fleet's harness — a six-layer scorecard and six trip wires computed daily from committed fleet signals. GitFactory is the design side of that loop: the **Harness** tab renders the hub's page from the same numbers (a pure port of its `dash-gen harness`, re-run in-app over the hub's committed files with a computed "matches the hub" note), evaluates the same wires **live** over a Fleet Ops scan, grades a blueprint's **design readiness** across the six layers (guides, sensors, bounded loop, memory, permissions, observability), and shows every assembly line as the **`fleet/v1` lane** the hub reads — the same card on the floor, in Fleet Observe, and on the tab. The hub is read-only from here; nothing is written to it. `?tab=harness&hub=owner/repo` deep-links to another hub, and `?tab=fleet&roster=owner/a,owner/b` deep-links to a fleet — the one URL an operator bookmarks to observe, run, cancel, re-run and arm/disarm the loops of exactly those repos (ADR-038). The fleet's content loops live at [`?tab=fleet&roster=bamr87/lifehacker.dev,bamr87/irony-works`](https://bamr87.github.io/gitorio/?tab=fleet&roster=bamr87/lifehacker.dev,bamr87/irony-works).

## Try it without a token

Open the app with **`?demo=1`** and the whole tool comes alive on a fictional three-repo fleet — canvas, prompts, telemetry, and the Fleet Ops cockpit — with no personal access token and no network calls. It is not a mock: the demo swaps in a fixture-backed client behind the same seam a real connection uses, so the compiler and the facts/metrics/audit engines run for real over the fixture data. Nothing is written to GitHub; edits live in the tab until you close it.

## Quick start (development)
All application code lives in `app/` (the only npm project); Node 22 is pinned in `.nvmrc` (`nvm use`).

```bash
cd app
npm install
npm run dev        # vite dev server + HMR → http://localhost:5173
npm test           # vitest — compiler invariant tests
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # typecheck + production build → app/dist
```

Open the canvas, drag machines from the palette, connect belts, press **Compile** to see the generated workflows. The Docker commands below run the same npm scripts inside a container.

### Run with Docker

No local Node needed — everything runs in a container:

```bash
docker compose up dev                       # dev server + HMR → http://localhost:5173
docker compose run --rm dev npm test         # run the vitest suite
docker compose run --rm dev npm run build    # produce app/dist
docker compose --profile preview up --build  # production build via nginx → http://localhost:8080
docker compose down                          # stop everything
```

Your working tree is mounted into the `dev` container, so edits hot-reload (`VITE_USE_POLLING=true` keeps HMR reliable across the macOS ↔ container boundary).

### Running and debugging in VS Code

The `.vscode/` folder follows the fleet convention (see [`.vscode/README.md`](.vscode/README.md)): **Terminal → Run Task** runs things, **F5** debugs them.

- Tasks: `Serve` (Docker) / `Serve (host)`, `Stop`, `Build`, `Verify` (lint → vitest → build, as CI), `Test`, `Lint`, `Typecheck`, `Preview: production (nginx)`.
- **Debug: app in Edge (Docker :5173)** — starts the dev server in Docker, then opens Edge with source-mapped breakpoints; the **(host :5173)** variant uses local Node.
- **Debug: Vitest (all)** / **Debug: Vitest (current file)** — breakpoint-debug the test suite.

## Project structure
Four of these directories hold prose. [`docs/DOCUMENTATION-MAP.md`](docs/DOCUMENTATION-MAP.md) explains the division of labour between them and answers "where does this writing go?".

| Path | What lives there |
| --- | --- |
| `app/` | The static frontend (Vite + React + `@xyflow/react`): canvas, compiler (`src/compiler/`), the archify IR compiler (`src/archify/`) and the in-app map surface (`src/map/`), the console primitives (`src/ui/`), the harness engine + hub reader (`src/harness/`), GitHub client, Fleet Ops engines (`src/fleet/`), demo fixtures. The only npm project. |
| `.factory/` | This repo dogfooding itself: `blueprint.json`, `prompts/*.md`, `config.yml`. **Source**, not output — see [`docs/GENERATED-FILES.md`](docs/GENERATED-FILES.md). |
| `.github/workflows/` | Hand-written CI/Pages/evolve workflows **plus** the compiled `factory--*.yml` lines (carry a `GENERATED BY GITFACTORY` header; never hand-edit). |
| `schema/` | `blueprint.schema.json` — the blueprint contract, drift-guarded against the machine registry. |
| `examples/` | Example blueprints and `compiled/` reference output the compiler converges to. |
| `docs/` | **Authored design docs for contributors**, read on GitHub: `ARCHITECTURE.md`, `ROADMAP.md`, `DECISIONS.md` (ADR log), `AO-SDLC.md`, `GENERATED-FILES.md`, [`DOCUMENTATION-MAP.md`](docs/DOCUMENTATION-MAP.md). |
| `_docs/` | **User-facing docs collection**, rendered in the app's Docs tab and tended by the Docs Gardener line. The only prose that ships to app users — see [`docs/DOCUMENTATION-MAP.md`](docs/DOCUMENTATION-MAP.md). |
| `specs/` | **Per-item AO-SDLC working documents**: spec packages `NNN-slug/{spec,plan,tasks}.md`. Intent at a moment, not a description of the current system. |
| `tools/` | stdlib gates: `spec_validator`, `backlog_lint`, `pick_backlog_item`, `next_backlog_id`, `evolve_audit`, `unwrap-prose`. |
| `seeds/` | Historical: the bootstrap-era session prompts (00–07). Closed — not intake. |
| `blog/drafts/` | **Staging area only**: session logs headed for the it-journey repo. Transient — don't link to it from other docs. |
| `.claude/` | Slash commands (`commands/`), read-only review agents (`agents/`), hooks, settings. |
| `fleet.manifest.yml` | This repo's entry in the `wtd` fleet (`fleet/v1` vocabulary, generated by `wtd fleet adopt`; hand edits survive). GitFactory compiles the same lanes from the blueprint (`toFleetLanes`) and a parity test pins them to this file. Not the Fleet Ops roster — that imports a hub's `.gitmodules`. |

## Project docs

| Document | What it covers |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Project memory for Claude Code: architecture in ten lines, golden rules, current state. Read first. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | The dev loop and the AO-SDLC session workflow. |
| [`BACKLOG.md`](BACKLOG.md) | Append-only `BL-*` work register — where all non-trivial work enters. |
| [`SECURITY.md`](SECURITY.md) | How to report a vulnerability. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Full design: auth phases, compiler spec, security model, machine catalog. |
| [`docs/DOCUMENTATION-MAP.md`](docs/DOCUMENTATION-MAP.md) | Which of `docs/`, `_docs/`, `specs/`, `blog/` a piece of writing belongs in, and why. |
| [`docs/GENERATED-FILES.md`](docs/GENERATED-FILES.md) | Which files the compiler writes, how to regenerate them, determinism and action-pinning guarantees. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phases and acceptance history. |

## Building this with Claude Code

This repo is designed to be **built by Claude Code, session by session**, through the spec-driven AO-SDLC loop ([`docs/AO-SDLC.md`](docs/AO-SDLC.md)):

1. `CLAUDE.md` — project memory: architecture, golden rules, definition of done.
2. `BACKLOG.md` → `specs/` — pick an item (`python3 tools/pick_backlog_item.py`) and run `/specify` → `/clarify` → `/plan` → `/tasks` → `/implement`, or `/evolve` for a whole cycle.
3. `.claude/commands/` — the chain above plus `/add-machine`, `/compile-check`, `/session-log`.

The bootstrap-era `seeds/` (00–07) are kept as history, not as intake.

Powering a deployed factory requires a Claude auth Actions secret on the target repo (the app calls this "connecting power") — `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` by default, or `ANTHROPIC_API_KEY` as the fallback.

## Imported packages

Two former repositories now live under `packages/`, imported with their full history, each keeping its own README, tooling and commands (run from inside the package):

| Path | Was | What it is |
|---|---|---|
| [`packages/git-with-the-program/`](packages/git-with-the-program/) | [bamr87/git-with-the-program](https://github.com/bamr87/git-with-the-program) | Agentic governance framework that distills git history into a core memory and scores every change for drift. Its own `ci.yml` and `upkeep.yml` do not run from this path and are kept as the reference for porting; its `@claude` caller was dropped because this repository runs one at the root. |
| [`packages/gitnexus/`](packages/gitnexus/) | [bamr87/gitnexus](https://github.com/bamr87/gitnexus) | Nexus Forge: a static rebuild-spec workbench (PRD, architecture, 14-step playbook) for reimplementing GitNexus. |

## Status

Canvas, compiler, GitHub connect, telemetry, Prompt Studio, the headless-CMS cockpit, Fleet Ops, the archify console, and harness parity with the bamr87 hub — dogfooding itself in `.factory/`. Pre-alpha; the roadmap is the product spec.

## Development

Full commands, conventions and gotchas for humans and AI agents live in [CLAUDE.md](CLAUDE.md).

## Contributing

Contributions are welcome via pull request. Use [Conventional Commits](https://www.conventionalcommits.org/) and keep the CI checks green. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow. AI agents should start with [CLAUDE.md](CLAUDE.md).

## Changelog

Notable changes are recorded in [CHANGELOG.md](CHANGELOG.md); the full record is in the [commit history](https://github.com/bamr87/gitorio/commits/main).

## License

Released under the [MIT License](LICENSE).

---

<!-- bamr87-portfolio-footer -->
Part of the [bamr87 portfolio](https://github.com/bamr87) — browse every project on [Amr's GitHub profile](https://github.com/bamr87).
