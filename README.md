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

## Repository layout

Which paths the compiler writes and which are yours to hand-edit is documented in
[`docs/FILE-OWNERSHIP.md`](docs/FILE-OWNERSHIP.md).

## Status

Scaffold + canvas MVP + compiler v0, dogfooding itself in `.factory/`. Pre-alpha; the roadmap is the product spec.
