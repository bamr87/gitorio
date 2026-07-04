# Seeds — the build plan as session prompts

Each seed is one Claude Code session (occasionally two). Run them in order:

    claude
    > Read CLAUDE.md, then execute seeds/00-bootstrap.md.

Cadence per session: read the seed's Context files → work to the Acceptance
criteria and nothing more → `npm test && npm run build` → `/session-log`.
Discoveries that don't fit the seed go to ROADMAP § Backlog, not into scope.
