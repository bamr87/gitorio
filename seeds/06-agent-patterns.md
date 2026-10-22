# Seed 06 — Agent patterns: belt mode, watchdog, gates

**Objective:** graduate from "agent does everything" to typed, guarded pipelines.

**Context:** docs/ARCHITECTURE.md §5 (belt mode), §6 (watchdog), §8 · DECISIONS ADR-003

**Tasks**
1. Belt mode: agent writes `factory-output.json` per a per-machine output schema;
compiler emits downstream sinks as deterministic steps consuming it via `fromJSON`. Blueprint edges gain typed ports. Feature-flag per assembly line.
2. Watchdog factory: a template blueprint (cron → analyzer agent → create/update
`factory-alarm` issue) users can stamp onto any repo; compiler support for `sink.create_issue` update-or-create semantics.
3. New machines: `gate.approval` (environment protection) and `rate.limiter` (concurrency group + max-runs-per-day guard step) — full /add-machine checklist.
4. Red-team pass on §8: attempt a comment-loop and a prompt-injection tool-escape on the scratch repo; document results and mitigations in DECISIONS.md.

**Acceptance:** ROADMAP Phase 6 boxes; belt-mode triage line runs end-to-end.
