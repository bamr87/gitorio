# ⚙ GitFactory

**A Factorio-style factory builder for GitHub automation.** *(working title)*

Drag machines onto a canvas. Connect them with belts. Hit **Deploy** — and your blueprint compiles into real GitHub Actions workflows where **Claude Code agents** triage issues, review PRs, garden stale threads, and commit fixes on your actual repositories.

```
 [📥 Issue opened] ══▶ [⚙ Claude: triage] ══▶ [🏷 Apply labels]
                                          ╚══▶ [📝 Post summary comment]

 [⏰ Nightly 03:00] ══▶ [⚙ Claude: gardener] ══▶ [📝 Stale-issue nudges]
```

No servers. The frontend is a static site; **GitHub is the database, the event bus, and the compute layer**. Blueprints live in your repo, prompts live in your repo, telemetry is read back from the Actions API and rendered as factory floor status.

## Why this shape

- **Blueprint-in-repo** — your automation design is versioned, reviewable, and
  shareable as an encoded blueprint string, like the game.
- **Compile-to-Actions** — no bespoke runtime to babysit; the emitted YAML is
  readable, auditable, and works without GitFactory existing.
- **Agents as machines** — each Claude agent has a prompt contract, scoped tool
  grants, loop guards, and telemetry, because an unbounded agent is just a fire.

## Try it without a token

Open the app with **`?demo=1`** and the whole tool comes alive on a fictional three-repo fleet — canvas, prompts, telemetry, and the Fleet Ops cockpit — with no personal access token and no network calls. It is not a mock: the demo swaps in a fixture-backed client behind the same seam a real connection uses, so the compiler and the facts/metrics/audit engines run for real over the fixture data. Nothing is written to GitHub; edits live in the tab until you close it.

## Quickstart (development)

```bash
cd app && npm install && npm run dev
```

Open the canvas, drag machines from the palette, connect belts, press **Compile** to see the generated workflows. GitHub connectivity, telemetry, and the prompt studio land in later phases — see `docs/ROADMAP.md`.

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

### Debugging in VS Code

`.vscode/launch.json` ships ready-to-run configs (press **F5**):

- **Debug in Chrome (Docker dev)** — starts the dev server in Docker, then opens Chrome with source-mapped breakpoints.
- **Debug in Chrome (npm dev)** — same, using local Node instead of Docker.
- **Vitest: all tests** / **Vitest: current file** — breakpoint-debug the test suite.

## Repository layout

Where things live at the repo root:

| Path | What lives there |
| --- | --- |
| `app/` | The GitFactory frontend — the canvas, palette, compiler, and Fleet Ops cockpit. This is the only npm project: `npm install`, `npm run dev`, `npm test` (vitest) and `npm run build` (into `app/dist`) all run from here. |
| `.factory/` | GitFactory's own blueprint — the project dogfoods itself, so the automation running on this repo is designed with the tool it ships. |
| `.claude/` | Claude Code project configuration, including the slash commands in `.claude/commands/` (`/add-machine`, `/compile-check`, `/session-log`). |
| `seeds/` | Ordered Claude Code session prompts with acceptance criteria, one file per build session. Start at `seeds/00-bootstrap.md` — see [Building this with Claude Code](#building-this-with-claude-code). |
| `docs/` | Project documentation, including `docs/ROADMAP.md`, which doubles as the product spec. |
| `_docs/` † | Additional documentation source. |
| `specs/` † | Written specifications feeding the roadmap. |
| `blog/` † | Long-form posts / development log. |
| `examples/` † | Example blueprints and generated output. |
| `schema/` † | Schemas for the project's structured files (blueprints, manifest). |
| `tools/` † | Repository-level scripts and utilities, outside the `app/` build. |
| `.github/` † | GitHub configuration for this repository, including its own Actions workflows. |
| `fleet.manifest.yml` † | Declares the fleet of repositories this factory operates on. |

And the loose files worth knowing about:

| File | Purpose |
| --- | --- |
| `CLAUDE.md` | Project memory for Claude Code: architecture, golden rules, definition of done. Read this first if you are driving the build with an agent. |
| `CONTRIBUTING.md` | How to propose changes. |
| `SECURITY.md` | How to report a vulnerability. |
| `BACKLOG.md` | Queued work that has not been scheduled into a seed or the roadmap yet. |
| `docker-compose.yml` | The `dev` and `preview` services used by [Run with Docker](#run-with-docker). |
| `.vscode/` | Editor settings and the `launch.json` debug configs described above. |
| `.nvmrc` | Node version used by the project. |
| `.editorconfig`, `.gitattributes`, `.gitignore` | Formatting and Git hygiene. |

† These entries are still being confirmed by a maintainer — treat the description as a hint, not a contract. In particular, the division of labour between `_docs/`, `docs/`, `specs/`, and `blog/` is not yet documented; if you know it, a PR clarifying these rows is very welcome.

## Building this with Claude Code

This repo is designed to be **built by Claude Code, session by session**:

1. `CLAUDE.md` — project memory: architecture, golden rules, definition of done.
2. `seeds/` — ordered session prompts with acceptance criteria. Start with:
   ```
   claude
   > Read CLAUDE.md, then execute seeds/00-bootstrap.md.
   ```
3. `.claude/commands/` — `/add-machine`, `/compile-check`, `/session-log`.

Powering a deployed factory requires a Claude auth Actions secret on the target repo (the app calls this "connecting power") — `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` by default, or `ANTHROPIC_API_KEY` as the fallback.

## Status

Scaffold + canvas MVP + compiler v0, dogfooding itself in `.factory/`. Pre-alpha; the roadmap is the product spec.
