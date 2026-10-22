# PRD — gitorio (GitFactory)

> Product requirements for [`bamr87/gitorio`](https://github.com/bamr87/gitorio).
> Derived from the README, agent docs, config and code in this repo. Anything not
> stated in those sources is marked **TBD**; success metrics are proposals.

## 1. Overview / problem

GitFactory (working title) is a Factorio-style factory builder for GitHub automation: users drag machines (triggers, Claude Code agents, actions) onto a canvas, connect them with belts, and Deploy compiles the blueprint into readable GitHub Actions workflows on their own repos. No servers: the frontend is static and GitHub is the database, event bus and compute layer.

## 2. Target users

- Developers/maintainers who want AI-driven repo automation (triage, review, gardening) without running infrastructure
- Fleet operators monitoring AI lanes across repos (Fleet Ops cockpit)

## 3. Goals and non-goals

**Goals**

- Compile visual blueprints into auditable Actions YAML that works without GitFactory
- Version blueprints and prompts in the repo, shareable as encoded strings
- Give each agent a prompt contract, scoped tool grants, loop guards and telemetry
- Render factory-floor status from the Actions API

**Non-goals**

- A bespoke runtime or hosted backend
- Unbounded agents without guards

## 4. Core features (current)

- Drag-and-drop canvas ("Evidence Console" design language)
- Blueprint → Actions workflow compiler with vitest invariant tests
- Demo mode `?demo=1` on a fixture-backed three-repo fleet, no token needed
- Fleet Ops cockpit and telemetry views
- Packages absorbed under `packages/` (gitnexus, git-with-the-program)
- Docker and VS Code task/debug workflows

## 5. Requirements

**Functional**

- Compile produces valid, readable workflow YAML for each blueprint
- Deploy writes workflows to the user's repo via their token
- Demo mode makes no network calls

**Non-functional**

- Static hosting only; Node 22 pinned (`.nvmrc`)
- Typecheck, lint, test and build pass in CI
- Token handled client-side only (storage policy: TBD)

## 6. Success metrics (proposed — not defined in sources)

- Blueprints compiled/deployed
- Compiled-workflow failure rate
- Demo-to-token conversion: TBD

## 7. Roadmap / open questions

- Final product name (README says working title)
- See docs/ROADMAP.md and BACKLOG.md for planned work

## 8. Links

- [README.md](README.md) · [AGENTS.md](AGENTS.md) · [BACKLOG.md](BACKLOG.md) · [CHANGELOG.md](CHANGELOG.md) · [docs/ROADMAP.md](docs/ROADMAP.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
