# Contributing to GitFactory

> How to propose a change: the session workflow, the local gates, and what a pull request needs — with the rules themselves kept in AGENTS.md.

GitFactory is built **session by session with Claude Code**, driven by the spec-driven AO-SDLC loop: work enters [`BACKLOG.md`](BACKLOG.md), graduates into [`specs/`](specs/) packages, and ships one verified task at a time (see [`docs/AO-SDLC.md`](docs/AO-SDLC.md); the bootstrap era's [`seeds/`](seeds/) are history). Whether you're a human or an agent, the workflow is the same. Read [`AGENTS.md`](AGENTS.md) first — it holds the commands, the conventions and the golden rules, which are non-negotiable.

## Prerequisites

- **Node 22** (see [`.nvmrc`](.nvmrc); CI pins the same). `nvm use` if you have nvm — or use the Docker service (`docker compose up dev`), which needs no local Node.
- Python 3 for the stdlib gates in [`tools/`](tools/README.md).
- No backend, no database — the frontend is fully static (golden rule #1).

## The workflow

1. **Pick or file the work.** `python3 tools/pick_backlog_item.py` chooses the top open item in `BACKLOG.md`; bring your own by filing it as a `BL-*` entry first (`python3 tools/next_backlog_id.py` mints the id). Trivial fixes need no spec — say why in the PR.
2. **Spec it.** Run `/specify` → `/clarify` → `/plan` → `/tasks` → `/implement` one task at a time (or `/evolve` for a whole cycle). Work to the spec's acceptance criteria — nothing more.
3. **Close the loop.** Park discoveries in the spec's `## Follow-ups Discovered` and mirror them into `BACKLOG.md` (golden rule #11).
4. **Run the gates** listed in [`AGENTS.md` § Stack & commands](AGENTS.md#stack--commands) — at minimum `cd app && npm test && npm run build` plus `python3 tools/spec_validator.py && python3 tools/backlog_lint.py`.
5. **Open a pull request** on a `feature/`, `fix/`, `docs/`, `refactor/`, `test/` or `chore/` branch with a [Conventional Commits](https://www.conventionalcommits.org/) title, and fill in [the checklist](.github/pull_request_template.md) — it is the Definition of Done.
6. **End the session** with `/session-log` (a draft post in `blog/drafts/`, plus a [`docs/DECISIONS.md`](docs/DECISIONS.md) entry if a decision was made).

A PR gets bounced for breaking a golden rule: a hand-edited generated file, a tool grant or permission wider than its sinks need, an unguarded loop, a secret outside `${{ secrets.* }}`, or untrusted text interpolated into a workflow. A new machine type follows the Definition of Done in golden rule #8 — run [`/add-machine`](.claude/commands/add-machine.md) for the checklist.

## Claude Code tooling

Project commands live in [`.claude/commands/`](.claude/commands/): the AO-SDLC chain (`/specify`, `/clarify`, `/plan`, `/tasks`, `/implement`, `/evolve`) plus `/add-machine`, `/compile-check`, and `/session-log`. Agents live in [`.claude/agents/`](.claude/agents/) (the read-only `golden-rules-reviewer` and `backlog-triager`, plus the `verifier` acceptance tester), and [`.claude/settings.json`](.claude/settings.json) registers hooks that block edits which break the spec/backlog gates. Use `/compile-check` to validate the compiler against the schema, the reference output, and the upstream `claude-code-action` inputs before shipping compiler changes.
