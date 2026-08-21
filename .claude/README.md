# .claude/ — Claude Code project tooling

| Path | Role |
|---|---|
| `commands/add-machine.md` | Machine-type DoD checklist (golden rule #8) |
| `commands/compile-check.md` | Read-only compiler health check |
| `commands/session-log.md` | End-of-session wrap-up (golden rule #10) |
| `commands/specify.md` → `evolve.md` | The AO-SDLC chain (golden rule #11, ADR-022): `/specify` → `/clarify` → `/plan` → `/tasks` → `/implement`; `/evolve` runs the whole cycle autonomously |
| `agents/golden-rules-reviewer.md` | Read-only pre-PR audit against the 11 golden rules |
| `agents/backlog-triager.md` | Read-only BACKLOG.md reconciliation against the code |
| `hooks/session-start.sh` | SessionStart — injects the operational reminder + tool check |
| `hooks/gate-check.sh` | PostToolUse (Write\|Edit) — blocks on failed spec/backlog gates after edits to `BACKLOG.md` or `specs/**` |
| `settings.json` | Registers the two hooks (no permission allowlist yet — see BL-20260816-12) |

Commands are self-contained (frontmatter + full procedure) per this repo's convention — there is no separate `prompts/` layer, deliberately, so nothing collides with `.factory/prompts/` (the *deployed agents'* operating prompts, a different thing entirely).
