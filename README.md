# ⚙ GitFactory

**A Factorio-style factory builder for GitHub automation.** *(working title)*

Drag machines onto a canvas. Connect them with belts. Hit **Deploy** — and your
blueprint compiles into real GitHub Actions workflows where **Claude Code agents**
triage issues, review PRs, garden stale threads, and commit fixes on your actual
repositories.

```
 [📥 Issue opened] ══▶ [⚙ Claude: triage] ══▶ [🏷 Apply labels]
                                          ╚══▶ [📝 Post summary comment]

 [⏰ Nightly 03:00] ══▶ [⚙ Claude: gardener] ══▶ [📝 Stale-issue nudges]
```

No servers. The frontend is a static site; **GitHub is the database, the event bus,
and the compute layer**. Blueprints live in your repo, prompts live in your repo,
telemetry is read back from the Actions API and rendered as factory floor status.

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

Open the canvas, drag machines from the palette, connect belts, press **Compile** to
see the generated workflows. GitHub connectivity, telemetry, and the prompt studio
land in later phases — see `docs/ROADMAP.md`.

## Building this with Claude Code

This repo is designed to be **built by Claude Code, session by session**:

1. `CLAUDE.md` — project memory: architecture, golden rules, definition of done.
2. `seeds/` — ordered session prompts with acceptance criteria. Start with:
   ```
   claude
   > Read CLAUDE.md, then execute seeds/00-bootstrap.md.
   ```
3. `.claude/commands/` — `/add-machine`, `/compile-check`, `/session-log`.

Powering a deployed factory requires an `ANTHROPIC_API_KEY` Actions secret on the
target repo (the app calls this "connecting power").

## Status

Scaffold + canvas MVP + compiler v0, dogfooding itself in `.factory/`. Pre-alpha;
the roadmap is the product spec.
