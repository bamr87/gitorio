# AO-SDLC — the spec-driven development loop

> How work moves from BACKLOG.md through spec packages to merged code: the stages, the slash commands, the three mechanical gates and the autonomy invariants.

GitFactory's development process is an **agent-orchestrated SDLC** merged from the law-ai repo (ADR-022): work enters an append-only backlog, graduates into versioned spec packages, gets implemented one verifiable task at a time, and every cycle is forced — mechanically, not aspirationally — to leave the backlog richer than it found it (golden rule #11). It replaces the seed-driven session era (seeds 00–07, now historical — see `seeds/README.md`).

## The loop

```
                 ┌──────────────────────────────────────────────┐
                 │                 BACKLOG.md                   │
                 │   ## Open ──► ## Claimed ──► ## Done         │
                 └───────▲──────────────┬──────────────────────┘
                         │              │ pick (tools/pick_backlog_item.py)
        follow-ups       │              ▼
        mirrored back    │   /specify ─► /clarify ─► /plan ─► /tasks ─► /implement
                         │      specs/NNN-slug/{spec,plan,tasks}.md      (one task
                         └──────────────────────────────────────────────  per run)
                                        /evolve = the whole cycle, autonomously
```

## Stages

| Stage | Command | Writes | Gate |
|---|---|---|---|
| Intake | (anyone) / `tools/evolve_audit.py` | `BACKLOG.md ## Open` | `tools/backlog_lint.py` format + append-only |
| Specify | `/specify` | `specs/NNN-slug/spec.md`, claims BL items | golden-rules waiver check; validator tolerates OQs at `draft` |
| Clarify | `/clarify` | resolves `OQ-N` inline, status → `clarified` | hard stops on grants/guards/secrets/runtime questions |
| Plan | `/plan` | `plan.md`, status → `planned` | §5 Least Privilege + §6 Loop Guards mandatory; deviations → ADR in `docs/DECISIONS.md` |
| Tasks | `/tasks` | `tasks.md`, status → `in-progress` | every FR/NFR/AC referenced by ≥1 task (validator-enforced) |
| Implement | `/implement T-NNN` | code + tests, one task per run | task `Verify:` + `npm test && npm run build` + follow-ups mirrored |
| Evolve | `/evolve` | one full cycle, ends in a **draft PR** | all gates; never merges itself |

## The three mechanical invariants

These are what make the loop self-sustaining — they are enforced by code, and they travel together:

1. `tools/spec_validator.py` refuses a spec whose `tasks.md` lacks `## Follow-ups Discovered` (and checks OQ resolution, requirement coverage, status↔task drift, leftover template placeholders).
2. `tools/backlog_lint.py` diffs against `git show HEAD:BACKLOG.md`, so committed entries can never be deleted — only moved to `## Done`.
3. The `PostToolUse` hook (`.claude/hooks/gate-check.sh`) runs both validators after every Write/Edit touching `BACKLOG.md` or `specs/**` and returns `{"decision": "block"}` on failure, so an agent cannot walk away from a broken loop.

CI runs the same validators in the `spec-gate` job (`.github/workflows/ci.yml`), and all markdown obeys the house one-paragraph-per-line rule (`tools/unwrap-prose.py --check`).

## Backlog format

One bullet per item, exactly: `- **BL-YYYYMMDD-NN** — *<kind>, <severity>* — <text> _Surfaced in:_ <where>.` Kinds: `feature` / `refactor` / `tech-debt` / `test-gap` / `doc-gap` / `infra`; severities `low` / `med` / `high`. Mint ids with `python3 tools/next_backlog_id.py`; pick work with `python3 tools/pick_backlog_item.py` (severity first, then debt-over-feature **always** — the standing tiebreak is how the ≥1-refactor-per-3-features budget is implemented, deliberately stateless — then oldest id).

Do not confuse `BACKLOG.md` (the **repo's** engineering work register, this loop) with `.factory/backlog.yml` (the **product's** content work queue that deployed agents read at runtime, ADR-017).

## Autonomy invariants

- **No self-merge, ever.** `/evolve` ends in a *draft* PR; the weekly audit workflow opens a PR a human merges. Same invariant the product enforces on `processor.feedback_controller`.
- **Default-OFF kill switch.** The scheduled discovery workflow (`.github/workflows/evolve.yml`) is inert until the repo variable `EVOLVE_AUDIT_ENABLED` is `'true'` — gitorio's own `gate.enablement` convention applied to its own automation. Manual dispatch always runs.
- **Propose, don't decide.** The reviewer/triager agents (`.claude/agents/`) are read-only; hard-stop questions (tool grants, loop guards, secrets, external services, runtime swaps, golden-rule amendments) always surface to a human.
- **Saturation stop.** Three consecutive `/evolve` cycles with zero net-new BACKLOG items means ask for direction, not spin.

## File map

```
BACKLOG.md                     ← the work register (append-only; lint-gated)
specs/NNN-slug/                ← spec packages: spec.md + plan.md + tasks.md
specs/_template/               ← copy to start; validator flags leftover placeholders
tools/spec_validator.py        ← spec drift gate (stdlib, CI + hook)
tools/backlog_lint.py          ← backlog format + append-only gate (stdlib, CI + hook)
tools/next_backlog_id.py       ← deterministic id minting (parallel-agent safe)
tools/pick_backlog_item.py     ← the /evolve pick ordering, in code
tools/evolve_audit.py          ← headless discovery (TODO scan + missing-docs scan)
.claude/commands/              ← /specify /clarify /plan /tasks /implement /evolve
.claude/agents/                ← golden-rules-reviewer · backlog-triager (read-only)
.claude/hooks/                 ← session-start orientation · gate-check blocker
.github/workflows/ci.yml       ← spec-gate job (validators on every push/PR)
.github/workflows/evolve.yml   ← kill-switched weekly discovery → PR + issue
docs/DECISIONS.md              ← ADR-lite log (plans that deviate must add one)
```

## Relation to the rest of the process

- **Golden rules are the constitution.** Specs confirm compliance against `AGENTS.md § Golden rules`; amendments require an ADR. Rule #11 *is* this loop.
- **`/session-log` still closes every session** (golden rule #10); `/evolve` calls it as its final step.
- **`docs/ROADMAP.md`** keeps the phase narrative and acceptance history; its `§ Backlog` was migrated here on 2026-08-16 and is frozen — new discoveries go to `BACKLOG.md`.
- **seeds/** is the historical build plan (bootstrap era). Nothing new goes there.
