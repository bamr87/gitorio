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

Status: pre-alpha, and dogfooding itself in `.factory/`. Canvas, compiler, GitHub connect, telemetry, Prompt Studio, the headless-CMS cockpit, Fleet Ops, the archify console, and harness parity with the bamr87 hub have shipped; the [roadmap](docs/ROADMAP.md) is the product spec.

## Features

- Drag-and-drop factory canvas: machines are triggers, Claude Code agents and actions, connected by belts ([every machine type](docs/reference/machines.md))
- Deploy compiles a blueprint into readable GitHub Actions workflows in your repo
- Blueprints and prompts are versioned in the repo and shareable as encoded strings
- Factory-floor status rendered from the Actions API
- Fleet Ops: scan a roster of repos, grade their workflows, and run, cancel, re-run or arm/disarm their loops
- Archify maps of every assembly line and fleet, and a Harness tab that matches the bamr87 hub's scorecard
- A tokenless demo (`?demo=1`) that runs the real compiler and engines over fixture data
- A static frontend with no servers: GitHub is the database, event bus and compute

## Quick start

Open the [live app](https://bamr87.github.io/gitorio/), or run it locally. All application code lives in `app/` (the only npm project); Node 22 is pinned in `.nvmrc` (`nvm use`).

```bash
cd app
npm install
npm run dev        # vite dev server + HMR → http://localhost:5173
npm test           # vitest — compiler invariant tests
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # typecheck + production build → app/dist
```

Open the canvas, add machines from the Machine Finder (**`/`**, or drag them onto the floor), connect belts, and press **⚙ Compile blueprint** to see the generated workflows. The Docker commands below run the same npm scripts inside a container.

### Try it without a token

Open the app with **`?demo=1`** and the whole tool comes alive on a fictional three-repo fleet — canvas, prompts, telemetry, and the Fleet Ops cockpit — with no personal access token and no network calls. It is not a mock: the demo swaps in a fixture-backed client behind the same seam a real connection uses, so the compiler and the facts/metrics/audit engines run for real over the fixture data. Nothing is written to GitHub; edits live in the tab until you close it.

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

- Tasks: `Serve` (Docker) / `Serve (host)`, `Stop`, `Build`, `Verify` (lint → vitest → build, as CI), `Test`, `Lint`, `Typecheck`, `Preview: production (nginx)`, `Claude: session`.
- **Debug: app in Edge (Docker :5173)** — starts the dev server in Docker, then opens Edge with source-mapped breakpoints; the **(host :5173)** variant uses local Node.
- **Debug: Vitest (all)** / **Debug: Vitest (current file)** — breakpoint-debug the test suite.

### Powering a deployed factory

A deployed factory needs a Claude auth Actions secret on the target repo (the app calls this "connecting power") — `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` by default, or `ANTHROPIC_API_KEY` as the fallback.

## Why this shape

- **Blueprint-in-repo** — your automation design is versioned, reviewable, and shareable as an encoded blueprint string, like the game.
- **Compile-to-Actions** — no bespoke runtime to babysit; the emitted YAML is readable, auditable, and works without GitFactory existing.
- **Agents as machines** — each Claude agent has a prompt contract, scoped tool grants, loop guards, and telemetry, because an unbounded agent is just a fire.

## The console

The app is built on [tt-a1i/archify](https://github.com/tt-a1i/archify)'s design language and viewer model — "The Evidence Console": a dominant canvas, compact chrome, progressive disclosure. Press **`/`** to find a machine, click one to open its **passport** (dials, diagnostics, the tools it will be granted), and flip the Build tab from **Floor** to **Map** to see each assembly line drawn as the archify map it compiles to — lanes as roles, the main path, and the bot guard the YAML really carries. Fleet **Observe** draws any repo's workflows the same way with live run status on every node; the Docs tab embeds the delivered maps; **`T`** cycles the theme like the viewer. The delivered HTML maps under `app/public/maps/` stay the canonical, exportable artifacts (route probe, presentation, share cards live there) and every surface links to them when one exists for its source.

## The harness

**Agent = Model + Harness.** The bamr87 hub ([`bamr87.github.io/bamr87/harness/`](https://bamr87.github.io/bamr87/harness/)) presents and monitors the fleet's harness — a six-layer scorecard and six trip wires computed daily from committed fleet signals. GitFactory is the design side of that loop: the **Harness** tab renders the hub's page from the same numbers (a pure port of its `dash-gen harness`, re-run in-app over the hub's committed files with a computed "matches the hub" note), evaluates the same wires **live** over a Fleet Ops scan, grades a blueprint's **design readiness** across the six layers (guides, sensors, bounded loop, memory, permissions, observability), and shows every assembly line as the **`fleet/v1` lane** the hub reads — the same card on the floor, in Fleet Observe, and on the tab. The hub is read-only from here; nothing is written to it. `?tab=harness&hub=owner/repo` deep-links to another hub, and `?tab=fleet&roster=owner/a,owner/b` deep-links to a fleet — the one URL an operator bookmarks to observe, run, cancel, re-run and arm/disarm the loops of exactly those repos (ADR-038). The fleet's content loops live at [`?tab=fleet&roster=bamr87/lifehacker.dev,bamr87/irony-works`](https://bamr87.github.io/gitorio/?tab=fleet&roster=bamr87/lifehacker.dev,bamr87/irony-works).

## Imported packages

Two former repositories now live under `packages/`, imported with their full history, each keeping its own README, tooling and commands (run from inside the package):

| Path | Was | What it is |
|---|---|---|
| [`packages/git-with-the-program/`](packages/git-with-the-program/) | [bamr87/git-with-the-program](https://github.com/bamr87/git-with-the-program) | Agentic governance framework that distills git history into a core memory and scores every change for drift. Its own `ci.yml` and `upkeep.yml` do not run from this path and are kept as the reference for porting; its `@claude` caller was dropped because this repository runs one at the root. |
| [`packages/gitnexus/`](packages/gitnexus/) | [bamr87/gitnexus](https://github.com/bamr87/gitnexus) | Nexus Forge: a static rebuild-spec workbench (PRD, architecture, 14-step playbook) for reimplementing GitNexus. |

## Documentation

[`docs/README.md`](docs/README.md) indexes every document in the repository, one line each. Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (the full design), [`docs/reference/machines.md`](docs/reference/machines.md) (every machine type, generated from the registry) and [`docs/GENERATED-FILES.md`](docs/GENERATED-FILES.md) (what the compiler writes). [`docs/DOCUMENTATION-MAP.md`](docs/DOCUMENTATION-MAP.md) explains how `docs/`, `_docs/` (rendered in the app's Docs tab), `specs/` and `blog/` divide the prose.

## Project structure

| Path | What lives there |
| --- | --- |
| `app/` | The static frontend (Vite + React + `@xyflow/react`): canvas, compiler, archify maps, Fleet Ops and harness engines, GitHub client, demo fixtures. The only npm project. |
| `.factory/` | This repo dogfooding itself: `blueprint.json`, `prompts/*.md`, `config.yml`. **Source**, not output. |
| `.github/workflows/` | Hand-written CI/Pages/release/evolve workflows **plus** the compiled `factory--*.yml` lines (carry a `GENERATED BY GITFACTORY` header; never hand-edit). |
| `schema/` | `blueprint.schema.json` — the blueprint contract, drift-guarded against the machine registry. |
| `examples/` | Example blueprints and `compiled/` reference output the compiler converges to. |
| `docs/` | Contributor docs, read on GitHub; `docs/reference/` is generated. |
| `_docs/` | The user-facing docs collection, rendered in the app's Docs tab and tended by the Docs Gardener line. |
| `specs/` | AO-SDLC spec packages `NNN-slug/{spec,plan,tasks}.md`. |
| `tools/` | Stdlib gates: `spec_validator`, `backlog_lint`, `pick_backlog_item`, `next_backlog_id`, `evolve_audit`, `unwrap-prose`, `docs_index`. |
| `packages/` | Two imported repositories (see above). |
| `seeds/`, `blog/drafts/` | The closed bootstrap-era session prompts; session logs headed for the it-journey repo. |
| `fleet.manifest.yml` | This repo's entry in the `wtd` fleet (`fleet/v1` vocabulary, generated by `wtd fleet adopt`; hand edits survive). A parity test pins the lanes GitFactory compiles from the blueprint to this file. |

[`AGENTS.md`](AGENTS.md) § Layout has the per-directory detail.

## Development

This repo is built **session by session with Claude Code** through the spec-driven AO-SDLC loop ([`docs/AO-SDLC.md`](docs/AO-SDLC.md)): work enters [`BACKLOG.md`](BACKLOG.md), graduates to a `specs/` package via `/specify` → `/clarify` → `/plan` → `/tasks` → `/implement` (or `/evolve` for a whole cycle), and every cycle mirrors its follow-ups back into the backlog. The exact commands, repo gates, conventions and golden rules — for humans and AI agents alike — are in [`AGENTS.md`](AGENTS.md).

## Contributing

Contributions are welcome via pull request. Use [Conventional Commits](https://www.conventionalcommits.org/) and keep the CI checks green. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow; AI agents should start with [AGENTS.md](AGENTS.md). Report vulnerabilities privately per [SECURITY.md](SECURITY.md).

## Changelog

Notable changes are recorded in [CHANGELOG.md](CHANGELOG.md); the full record is in the [commit history](https://github.com/bamr87/gitorio/commits/main).

## License

Released under the [MIT License](LICENSE).

---

<!-- bamr87-portfolio-footer -->
Part of the [bamr87 portfolio](https://github.com/bamr87) — browse every project on [Amr's GitHub profile](https://github.com/bamr87).
