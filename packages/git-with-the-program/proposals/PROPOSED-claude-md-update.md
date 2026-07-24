# Proposed edit to `CLAUDE.md`

**Raised by:** SEED-01 remediation (agent session — adversarial-audit fixes)
**Status:** proposed — needs a human, because `CLAUDE.md` is outside this session's write scope
**Target:** `CLAUDE.md` (two paragraphs)

---

## Why this is a proposal rather than a commit

`CLAUDE.md` is on the forbidden-path list for seed sessions, alongside `README.md`,
`ROADMAP.md` and `GLOSSARY.md`. It is also the first thing the next agent session reads, so
leaving it stale is not cosmetic: two of its statements are now false, and one of them tells
the next session to redo work that is already done.

Nothing here touches `.program/` — that is a separate document
([`PROPOSED-program-amendment.md`](PROPOSED-program-amendment.md)) with a separate ratification
requirement (INV-001). This one is ordinary documentation drift and needs only a normal review.

---

## Edit 1 — the stack is no longer undecided

`docs/adr/0006-reference-stack.md` was flipped to `Status: Accepted` in this session, per
SEED-01's Objective (*"Decide ADR-0006 (stack) as your first act"*). CLAUDE.md still says the
opposite, and instructs the reader to do it again.

```diff
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@
-**The stack is undecided.** [docs/adr/0006-reference-stack.md](docs/adr/0006-reference-stack.md) is `Status: Proposed`, leaning TypeScript for v0. The first act of SEED-01 is to flip it to Accepted with a justification, then scaffold accordingly. Until then, `schemas/*.schema.json` is the only binding contract.
+**The stack is decided.** [docs/adr/0006-reference-stack.md](docs/adr/0006-reference-stack.md) is `Status: Accepted` — Option A, TypeScript on Node: ESM, `"strict": true`, Node >= 22, `vitest` + `fast-check`, `ajv` + `ajv-formats` + `yaml` as the only runtime dependencies, and `node:util` `parseArgs` for the CLI. That list is pinned by the ADR; widening it is an ADR change, not a package.json change. `schemas/*.schema.json` remains the binding contract across languages.
```

## Edit 2 — the repository-state paragraph

The first paragraph of *Repository state* describes the `init` commit: no `src/`, no package
manager, no CI, "no build/lint/test commands yet". SEED-01 created all of them.

```diff
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@
-This is a **seed package, not a codebase**. As of the `init` commit it contains only specs, schemas, ADRs, judge prompts, and this repo's own `.program/` constitution. There is no `src/`, no package manager, no CI, and therefore **no build/lint/test commands yet** — they are created by SEED-01.
+This was a seed package; SEED-01 turned it into a buildable workspace. Specs, schemas, ADRs, judge prompts and this repo's own `.program/` constitution are still the source of truth, and `src/` is now a TypeScript workspace on top of them (ADR-0006).
+
+Fresh clone to green, in one command: `npm ci && npm run ci` (Node >= 22). `npm run ci` is `typecheck && test && validate && check:inv003`. The deterministic governance checks are `npm run check:inv001` (INV-001: no machine actor writes to `.program/`) and `npm run check:inv003` (INV-003: no blind module value-imports the sentencing branch). [`CONTRIBUTING.md`](CONTRIBUTING.md) has the full command list and the exit-code contract — **0 clean · 1 violated · 2 could not run**, which is load-bearing: "I found nothing" and "I could not look" are never the same signal.
```

---

## Verification

Both edits are documentation-only; nothing in `src/`, `scripts/` or `.github/` depends on
CLAUDE.md's text. After applying, the claims above are checkable directly:

```bash
grep -n 'Status:' docs/adr/0006-reference-stack.md   # Accepted
npm ci && npm run ci                                  # exit 0
npm run check:inv001                                  # exit 0
npm run check:inv003                                  # exit 0
```
