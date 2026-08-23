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

## Where documentation lives

The repository root holds several places that all look like "docs". Use this map
to decide where a new page belongs.

| Location | What goes here | Written for |
| --- | --- | --- |
| `README.md` | This file. The one-screen pitch, quickstart, and pointers to everywhere else. | Anyone arriving at the repo for the first time |
| `CLAUDE.md` | Project memory for Claude Code sessions: architecture, golden rules, definition of done. | Claude Code agents, and humans steering them |
| `CONTRIBUTING.md` ⟨?⟩ | How to contribute changes to this repo. | Contributors |
| `SECURITY.md` ⟨?⟩ | Security policy and how to report a vulnerability. | Security reporters |
| `BACKLOG.md` ⟨?⟩ | Tracked work that is not yet scheduled. | Maintainers |
| `docs/` | Long-form project documentation. The roadmap — which doubles as the product spec — lives at `docs/ROADMAP.md`, linked from the Quickstart above. | Users and contributors reading about the project |
| `_docs/` | **TBD** — see the note below. | **TBD** |
| `specs/` | **TBD** — see the note below. | **TBD** |
| `blog/` | **TBD** — see the note below. | **TBD** |
| `seeds/` | Ordered Claude Code session prompts with acceptance criteria, e.g. `seeds/00-bootstrap.md`. Not prose documentation — these are executable instructions. | Whoever is driving the next build session |
| `.claude/commands/` | Slash-command definitions (`/add-machine`, `/compile-check`, `/session-log`). | Claude Code |
| `.factory/` | GitFactory's own blueprints — the project dogfooding itself. | Maintainers |

<!--
TODO(maintainer): the three TBD rows above are unresolved on purpose.
The author of this section could not read the contents of `_docs/`, `specs/`,
or `blog/`, and would rather leave a visible gap than invent a description.
Please fill them in — in particular, state plainly what distinguishes `_docs/`
from `docs/` (authored vs. generated? published vs. internal? current vs.
legacy?) — and delete this comment.

Rows marked ⟨?⟩ are inferred from conventional filenames and have not been
verified against the files themselves. Confirm or correct them, then drop the
marker.
-->

Not documentation, but often mistaken for it: `app/` is the frontend source
(`npm run build` emits `app/dist`), and `examples/`, `schema/`, and `tools/`
hold supporting project files rather than prose.

## Status

Scaffold + canvas MVP + compiler v0, dogfooding itself in `.factory/`. Pre-alpha; the roadmap is the product spec.
