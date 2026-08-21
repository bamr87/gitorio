# Specs — spec-driven development for GitFactory

This directory holds the persistent, versioned specifications that drive every non-trivial change in the codebase — the AO-SDLC spec-kit layer merged from law-ai (ADR-022, golden rule #11). See [docs/AO-SDLC.md](../docs/AO-SDLC.md) for the full loop.

## Layout

```
specs/
├── _template/            # Copy this to start a new spec
│   ├── spec.md           # WHAT + WHY (requirements, NFRs, acceptance criteria)
│   ├── plan.md           # HOW (architecture, tech choices, risks)
│   └── tasks.md          # Granular, agent-assignable tasks with acceptance tests
└── NNN-feature-slug/     # One directory per feature/epic, NNN = zero-padded id
```

## Workflow

1. `cp -r specs/_template specs/001-my-feature`
2. Run `/specify` → fill `spec.md` (claims matching `BL-*` items from [BACKLOG.md](../BACKLOG.md)).
3. Run `/clarify` → resolve open questions inline.
4. Run `/plan` → fill `plan.md`.
5. Run `/tasks` → fill `tasks.md`.
6. Open PR. CI runs [tools/spec_validator.py](../tools/spec_validator.py) — every requirement in `spec.md` must map to at least one task in `tasks.md`.
7. Run `/implement` on tasks, one at a time; reference `specs/NNN-...` in commits/PR descriptions.

## Rules

- Specs are **code**: review them in PRs, never edit historical specs in-place after merge — open an amendment spec instead.
- Every spec MUST satisfy the golden rules in [CLAUDE.md](../CLAUDE.md).
- One paragraph per line (the `markdown-oneline` CI check applies here too; fix with `python3 tools/unwrap-prose.py --write`).
- Keep specs concrete and free of marketing language — agents load them as context.
