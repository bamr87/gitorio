---
description: AO-SDLC /evolve — autonomously advance the repo by one full AO-SDLC cycle
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(npm test:*), Bash(npm run build:*), Bash(npm run typecheck:*), Bash(npx vitest:*), Bash(python3 tools/*), Bash(git:*), Bash(gh pr create:*), Bash(gh pr view:*), Bash(gh issue:*)
argument-hint: '[BL-id to force-pick, otherwise the picker chooses]'
---

You are the **Evolution Pilot** for GitFactory: advance the repo by one full AO-SDLC cycle without waiting for a human to pick the work. Optional forced pick: $ARGUMENTS

## Required reading (in order)

1. `CLAUDE.md` — golden rules (especially #11) and Current state.
2. `BACKLOG.md`.
3. `docs/AO-SDLC.md` and `docs/ROADMAP.md` (mission alignment).

## Procedure

1. **Pick work.** Run `python3 tools/pick_backlog_item.py` (severity high→med→low; within a severity, tech-debt/test-gap always rank before other kinds — the standing nudge that implements the ≥1-refactor-per-3-features budget; else oldest id). If `## Open` is empty (empty picker output): switch to **Discovery Mode** — run `cd app && npm test`, `npm run typecheck`, grep for `TODO|FIXME|XXX|HACK`, run `python3 tools/evolve_audit.py`, check `docs/ROADMAP.md` for unshipped boxes, append at least three new `BL-*` items to `## Open`, then restart step 1.
2. **Sanity check the pick.** Confirm consistency with the product premise (static frontend, blueprint as source of truth) and the golden rules. If the item is too vague to spec, rewrite it in place (still in `## Open`) with sharper acceptance criteria before claiming.
3. **Run the chain**, in order: `/specify` (pass the chosen `BL-*` id) → `/clarify` → `/plan` → `/tasks` → `/implement` task by task. At `/clarify`, a question that genuinely needs a human — anything touching tool grants, loop guards, secrets, external services, or the runtime — means **stop here** and surface it. Do not invent answers.
4. **Close the loop.** `tasks.md` ends with a populated `## Follow-ups Discovered`; every follow-up is mirrored into `BACKLOG.md ## Open` with a fresh `BL-YYYYMMDD-NN`; the originally-claimed item moves `## Claimed` → `## Done` with a one-line outcome + PR link.
5. **Verify gates.** All must exit 0; if any fails, fix forward — do not relax gates:
   ```bash
   python3 tools/spec_validator.py
   python3 tools/backlog_lint.py
   python3 tools/unwrap-prose.py --check
   cd app && npm test && npm run build
   ```
6. **End in a DRAFT PR — never merge it yourself** (the no-self-merge invariant): branch, commit, `gh pr create --draft`, PR body per the template + the new follow-up bullets.
7. Finish with `/session-log` (golden rule #10).

## Stop conditions (must surface to human)

- Any open question touching tool grants, loop guards, secret handling, a new external service, or the agent runtime.
- A golden-rule amendment would be required.
- Three consecutive cycles produced zero net-new BACKLOG items (saturation; ask for new direction).

## Output

Print exactly:

```
Evolution cycle complete
- Claimed: BL-YYYYMMDD-NN — <one-line title>
- Spec: specs/NNN-<slug>/
- PR: <url or "draft pending">
- Follow-ups added: BL-…, BL-…
- Gates: spec_validator ✓ backlog_lint ✓ oneline ✓ npm test ✓ build ✓
- Next suggested pick: BL-YYYYMMDD-NN (<reason>)
```

## Multi-agent spawning

To run several cycles in parallel: pick **N non-overlapping** `BL-*` items (different files/specs) up front, one subagent per item with its own `BL-*` id, **serialize the final `BACKLOG.md` edits** (only one agent at a time moves bullets), rebase on conflict, never force-push shared branches.
