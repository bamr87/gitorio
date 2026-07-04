# Contributing to GitFactory

GitFactory is built **session by session with Claude Code**, driven by the ordered
prompts in [`seeds/`](seeds/). Whether you're a human or an agent, the workflow is the
same. Read [`CLAUDE.md`](CLAUDE.md) first — it's the project's memory and the golden
rules are non-negotiable.

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

1. Pick the next seed in [`seeds/`](seeds/) — they're ordered; [`seeds/README.md`](seeds/README.md) explains the cadence.
2. Read the seed's *Context* files and the matching phase in [`docs/ROADMAP.md`](docs/ROADMAP.md).
3. Work to the seed's **acceptance criteria** — nothing more. Park discoveries in `docs/ROADMAP.md § Backlog`.
4. Run the checks above.
5. End with `/session-log` (drafts a post to `blog/drafts/` and appends to [`docs/DECISIONS.md`](docs/DECISIONS.md)).

## The rules that bite

These are the ones a PR gets bounced for — the full list is in `CLAUDE.md § Golden rules`:

- **The blueprint is the source of truth.** Never hand-edit generated workflow YAML; fix the compiler (`app/src/compiler/compile.ts`), which stays a pure, tested function.
- **Least privilege.** Compiled workflows get a computed `permissions:` block and narrow `--allowedTools` grants — never blanket `Bash`.
- **Loop guards are mandatory.** A workflow that can write comments/issues *and* be triggered by them must guard against retriggering itself; the compiler refuses to emit an unguarded loop.
- **Secrets never touch the blueprint, code, or `localStorage`.** PATs live in `sessionStorage` at most; `ANTHROPIC_API_KEY` is only ever `${{ secrets.ANTHROPIC_API_KEY }}`.
- **Untrusted content is untrusted.** Issue bodies, PR diffs, and comments are attacker-controlled input to agents. Tighten the prompt, don't widen tool grants.

## Adding a machine type

Run [`/add-machine`](.claude/commands/add-machine.md) for the checklist. Definition of
done: registry entry + config fields + compiler emitter + invariant test + one line in
the `docs/ARCHITECTURE.md` machine catalog + it renders on the canvas.

## Claude Code tooling

Project commands live in [`.claude/commands/`](.claude/commands/): `/add-machine`,
`/compile-check`, `/session-log`. Use `/compile-check` to validate the compiler against
the schema, the reference output, and the upstream `claude-code-action` inputs before
shipping compiler changes.
