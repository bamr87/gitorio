# Contributing to GitFactory

GitFactory is built **session by session with Claude Code**, driven by the spec-driven AO-SDLC loop: work enters [`BACKLOG.md`](BACKLOG.md), graduates into [`specs/`](specs/) packages, and ships one verified task at a time (see [`docs/AO-SDLC.md`](docs/AO-SDLC.md); the bootstrap era's [`seeds/`](seeds/) are history). Whether you're a human or an agent, the workflow is the same. Read [`CLAUDE.md`](CLAUDE.md) first — it's the project's memory and the golden rules are non-negotiable.

## Prerequisites

- **Node 22** (see [`.nvmrc`](.nvmrc); CI pins the same). `nvm use` if you have nvm.
- No backend, no database — the frontend is fully static (golden rule #1).

## Dev loop

```bash
cd app
npm install        # first time
npm run dev        # vite dev server → http://localhost:5173
npm test           # vitest — compiler invariant tests
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build to app/dist
```

Always run `npm test && npm run build` before opening a PR.

## How a session works

1. Pick work: `python3 tools/pick_backlog_item.py` chooses the top open item in [`BACKLOG.md`](BACKLOG.md) (or bring your own — file it as a `BL-*` entry first).
2. Run the AO-SDLC chain: `/specify` → `/clarify` → `/plan` → `/tasks` → `/implement` one task at a time (or `/evolve` for a whole autonomous cycle).
3. Work to the spec's **acceptance criteria** — nothing more. Park discoveries in the spec's `## Follow-ups Discovered` and mirror them into `BACKLOG.md` (golden rule #11).
4. Run the checks above, plus `python3 tools/spec_validator.py && python3 tools/backlog_lint.py`.
5. End with `/session-log` (drafts a post to `blog/drafts/` and appends to [`docs/DECISIONS.md`](docs/DECISIONS.md)).

## The rules that bite

These are the ones a PR gets bounced for — the full list is in `CLAUDE.md § Golden rules`:

- **The blueprint is the source of truth.** Never hand-edit generated workflow YAML; fix the compiler (`app/src/compiler/compile.ts`), which stays a pure, tested function.
- **Least privilege.** Compiled workflows get a computed `permissions:` block and narrow `--allowedTools` grants — never blanket `Bash`.
- **Loop guards are mandatory.** A workflow that can write comments/issues *and* be triggered by them must guard against retriggering itself; the compiler refuses to emit an unguarded loop.
- **Secrets never touch the blueprint, code, or `localStorage`.** PATs live in `sessionStorage` at most; `ANTHROPIC_API_KEY` is only ever `${{ secrets.ANTHROPIC_API_KEY }}`.
- **Untrusted content is untrusted.** Issue bodies, PR diffs, and comments are attacker-controlled input to agents. Tighten the prompt, don't widen tool grants.

## Adding a machine type

Run [`/add-machine`](.claude/commands/add-machine.md) for the checklist. Definition of done: registry entry + config fields + compiler emitter + invariant test + one line in the `docs/ARCHITECTURE.md` machine catalog + it renders on the canvas.

## Claude Code tooling

Project commands live in [`.claude/commands/`](.claude/commands/): the AO-SDLC chain (`/specify`, `/clarify`, `/plan`, `/tasks`, `/implement`, `/evolve`) plus `/add-machine`, `/compile-check`, and `/session-log`. Read-only review agents live in [`.claude/agents/`](.claude/agents/) (`golden-rules-reviewer`, `backlog-triager`), and [`.claude/settings.json`](.claude/settings.json) registers hooks that block edits which break the spec/backlog gates. Use `/compile-check` to validate the compiler against the schema, the reference output, and the upstream `claude-code-action` inputs before shipping compiler changes.
