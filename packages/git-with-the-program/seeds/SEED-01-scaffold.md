# SEED-01 — Scaffold the engine workspace

You are building **Git with the Program** (GWTP). Read, in order:
`README.md`, `docs/vision.md`, `docs/spec/01-core-memory.md`, `docs/adr/0006-reference-stack.md`.

## Objective
Turn this seed package into a buildable workspace with schema validation wired into CI. Decide ADR-0006 (stack) as your first act: update its Status to Accepted with a one-paragraph justification, then scaffold accordingly.

## Deliverables
1. `src/` workspace for the chosen stack: `core/` (forge-agnostic engine), `adapters/github/`, `judge/`, `ledger/`, `evidence/`, `cli/`. Empty modules with typed interfaces matching the specs' vocabulary (Assertion, Event, Verdict, Accumulator, Proposal).
2. Schema validation: a `gwtp validate` CLI command that checks `.program/*.yaml` and any ledger event file against `schemas/*.schema.json`. Wire it into CI (GitHub Actions) on every PR.
3. A deterministic CI check enforcing INV-001: fail if a commit authored by a bot/machine actor touches `.program/**`.
4. Update `.program/scope.yaml` to claim `src/**`.
5. `CONTRIBUTING.md`: how to propose an amendment (ratification PR flow), how to run validation locally.

## Constraints
- Engine `core/` imports no forge-specific APIs (INV-005). GitHub code only under `adapters/`.
- Do not modify `docs/spec/**` or `schemas/**` semantics; if a spec is ambiguous, record the question in `docs/spec/OPEN-QUESTIONS.md` and choose the least-committal interpretation.
- Every module header comments which spec section it implements.

## Acceptance
- `gwtp validate` passes on the shipped `.program/` and fails on a deliberately malformed assertion (add that as a test fixture).
- CI runs validation + INV-001 check on PRs.
- Repo builds clean from fresh clone in one documented command.
