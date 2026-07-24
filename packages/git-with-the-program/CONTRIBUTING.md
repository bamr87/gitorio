# Contributing to Git with the Program

<!-- Implements: seeds/SEED-01-scaffold.md deliverable 5 — "how to propose an amendment
     (ratification PR flow), how to run validation locally". -->

This repository builds a governance framework, so it governs itself first. Two consequences
you will hit within your first PR:

1. **`.program/` is not code.** It is this repo's constitution, and it changes only through a
   human-ratified PR. CI fails any commit where a machine actor touched that path (INV-001).
2. **Verdicts, laws and evidence all need provenance.** No assertion without provenance; no
   violation without a line citation. Both are enforced, not encouraged.

If you only came to fix a bug in `src/`, skip to [Working on the engine](#working-on-the-engine).

---

## The two stores, and which one you are touching

| | **Program** — the law | **Ledger** — the evidence |
|---|---|---|
| Where | `.program/` (in-tree) | `refs/program/ledger` (out-of-tree ref) |
| Writers | Humans, via reviewed and ratified PRs | Machines, append-only |
| Your PR | Needs the ratification flow below | You almost certainly should not be writing it by hand |

Mixing the write paths is the failure mode the whole design exists to prevent
(docs/spec/01-core-memory.md §1, ADR-0001). Keep them in separate PRs, too: a PR that both
amends the law and changes the engine cannot be reviewed as either.

---

## Working on the engine

Fresh clone to green, in one command:

```bash
npm ci && npm run ci
```

`npm run ci` is `typecheck && test && validate && check:inv003`. Requires **Node >= 22**.

> **`package-lock.json` must be committed.** `npm ci` — which both this command and CI use —
> fails outright without a lockfile, and `.gitignore` says nothing about it, so it is easy to
> leave untracked. If you are landing engine work, `git status` should show no untracked
> `package-lock.json` before you open the PR. CI degrades to `npm install` with a warning
> rather than failing, but a run without a lockfile is not a reproducible run.

### The local command list

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over `src/`, `scripts/`, `tests/`. Strict mode; this is also where the INV-003 blindness proofs are enforced (`tests/core/blindness-compile.test.ts` uses `@ts-expect-error`, so a *lost* leak fails the typecheck). |
| `npm run test` | `vitest run` — the full unit + property suite. |
| `npm run test:watch` | `vitest` in watch mode. |
| `npm run build` | `tsc -p tsconfig.build.json` — emits `src/` only, into `dist/`, so `dist/cli/index.js` is the `gwtp` binary `package.json` declares. `tsconfig.json` is the *checking* config (src + scripts + tests, `noEmit`); the build config is the *emitting* one. Do not merge them: one `include` cannot serve both without `rootDir` sliding to `.` and moving the binary to `dist/src/cli/index.js`. |
| `npm run validate` | `gwtp validate` — validates `.program/*.yaml` and ledger event files against `schemas/*.schema.json` (INV-006). |
| `npm run check:inv001` | The deterministic INV-001 check over a commit range (see below). |
| `npm run check:inv003` | The deterministic INV-003 prescreen: nothing under `src/judge/**` or `src/evidence/**` may *value*-import the sentencing branch (see below). |
| `npm run gwtp -- <args>` | Run the CLI from source via `tsx`, e.g. `npm run gwtp -- --help`. |
| `npm run ci` | What CI runs for the engine job. |

### Running the validation CI runs, locally

```bash
npm run validate                                  # INV-006: artifacts match schemas/
npm run check:inv003                              # INV-003: the judge cannot reach sentencing
npm run check:inv001 -- --base origin/main        # INV-001: no machine wrote to .program/
```

`check:inv001` resolves its commit range in this order:

| Precedence | Source | Range |
|---|---|---|
| 1 | `--range <base>..<head>` | as given (two dots — three-dot symmetric difference is rejected) |
| 2 | `--base <ref>` | `<ref>..HEAD` |
| 3 | `$GWTP_INV001_RANGE` | as given |
| 4 | GitHub Actions, `pull_request` | `origin/$GITHUB_BASE_REF..$GITHUB_SHA` |
| 5 | GitHub Actions, `push` | `<event.before>..$GITHUB_SHA` |
| 6 | default | `origin/main..HEAD` |

Exit codes: **0** clean (or empty range) · **1** INV-001 violated · **2** the check could not
run. 2 is not 1 on purpose — "I found nothing" and "I could not look" must never be the same
signal. A shallow clone produces 2, which is why the CI job checks out with `fetch-depth: 0`.

The rule the check applies, and the pattern list it applies it with, are in
`scripts/check-inv001.ts` (`MACHINE_ACTOR_PATTERNS`). Every entry carries a `why`. Widening
that list widens who is barred from `.program/`, so treat a change to it as a governance
change and say so in the PR body.

`check-inv001` reads git one commit at a time — `git rev-list` for the shas, then a `git show`
per commit for the header and another for the `-z` path list. That is more subprocesses than a
single `git log`, and it is deliberate: a commit message is text the commit's own author wrote,
so any separator embedded in a batched `--format` is a separator that author can forge. There
is no cross-commit framing left to break. If you touch that code, keep it that way, and keep
the "fewer than four identity separators" case raising — a framing failure must surface as exit
2 ("could not look"), never as a commit that appears to have touched nothing.

### The INV-003 prescreen

```bash
npm run check:inv003
```

`src/judge/**` and `src/evidence/**` may `import type` from `src/core/sentencing.ts`,
`src/core/accumulator.ts` and `src/core/dispersion.ts` — naming a type you cannot read is the
whole design — but may never **value**-import them, nor value-import a declassifier
(`revealSurprise`, `withSentencingWarrant`, `toAccumulatorSnapshot`, `rawSurprise`,
`computeDispersion`, `toDispersionSnapshot`, …) from anywhere, nor name the
`gwtp.sentencing*` global symbol-registry keys.

The type system alone cannot enforce that. `Blind<T>` stops a `Surprise` from entering an
evidence bundle, but a `number` that a declassifier already unwrapped is just a number, and
every numeric field will take it. So three locks hold the line together, and all three are
tested:

1. the declassifiers are **withheld from the `src/core` barrel** (`tests/core/barrel-surface.test.ts`
   asserts the export surface; `tests/core/blindness-compile.test.ts` asserts it at compile time);
2. each takes a **`SentencingWarrant`** its caller must already hold, so a declassification is
   always a call with an extra argument;
3. this prescreen fails CI on the one greppable line that would be needed to obtain one.

Exit codes match `check:inv001`: **0** clean · **1** violated · **2** could not run. It is the
deterministic half of INV-003's `enforcement: hybrid`; the LLM half — identity flattened into
free text, which no static check can see (`docs/spec/OPEN-QUESTIONS.md` Q-09) — lands with
SEED-03.

### House rules for engine code

- **`src/core/**` imports nothing forge-specific** (INV-005). GitHub APIs live only under
  `src/adapters/github/**`. `src/core` is also dependency-free by convention — glob matching,
  canonical JSON and duration parsing are hand-written there for exactly this reason.
- **Every module file opens with a header comment naming the spec section it implements**, e.g.
  `// Implements: docs/spec/02-ledger.md §4 (accumulation: leaky integrator)`.
- **Never pass author identity or accumulator state toward a judge** (INV-003, ADR-0003). The
  type layer makes this a compile error; do not reach for `as any` to get around it — if you
  need the escape hatch, the design question is upstream of your patch.
- **`docs/spec/**`, `schemas/**`, `prompts/**` and `seeds/**` are contracts**, not
  implementation detail. If a spec is ambiguous, do **not** resolve it in code silently: append
  the question to `docs/spec/OPEN-QUESTIONS.md`, ship the least-committal interpretation, and
  reference the entry (`Q-nn`) from the code that depends on it.

---

## Fetching the ledger

The ledger lives on a **non-default ref**, `refs/program/ledger`. Non-default refs are not
fetched by a normal `git clone` — that is the point: **the program propagates, the surveillance
does not** (docs/spec/02-ledger.md §8). A fork inherits the law and starts its own evidence.

Fetch it once:

```bash
git fetch origin '+refs/program/ledger:refs/program/ledger'
```

Or wire it into every fetch for this remote:

```bash
git config --add remote.origin.fetch '+refs/program/ledger:refs/program/ledger'
git fetch origin
```

Read it without checking it out:

```bash
git log --oneline refs/program/ledger              # the append history
git ls-tree -r --name-only refs/program/ledger     # events/, accumulators/, epochs/
git show refs/program/ledger:accumulators/INV-001.yaml
```

Notes that will save you an afternoon:

- **Do not check the ledger ref out into your working tree.** It is a parallel commit chain
  with its own tree layout (`events/`, `accumulators/`, `epochs/`), not a branch of this repo.
- **Never rewrite it.** Corrections supersede (`supersedes: <event-id>`), they do not edit or
  delete (ADR-0002). An event file's name is the hash of its own body; editing one in place is
  detectable and is a bug report, not a fix.
- **Accumulators are a cache, never authority.** They are a deterministic fold over `events/`
  and can be recomputed at will. If a cached accumulator disagrees with the fold, the fold wins.
- CI pushes to this ref; humans generally should not. The engine job in
  `.github/workflows/ci.yml` runs with `permissions: contents: read` precisely so that a
  routine PR build cannot write either store.

*(The ref does not exist yet — it is created by the ledger engine in `seeds/SEED-02-ledger-engine.md`.
The commands above are the contract it lands against.)*

---

## Proposing an amendment to `.program/`

An **amendment** is any change to the law: `charter.md`, `invariants.yaml`, `trajectory.yaml`,
`precedents.yaml`, `scope.yaml`, `manifest.yaml`.

### The lifecycle you are moving an assertion through

`status` is a lifecycle, not a flag (docs/spec/01-core-memory.md §4):

```
inferred ──(human ratification)──▶ ratified ──(reprogramming PR opens)──▶ contested
                                                                   │
                                             ┌─────────────────────┴────────────────────┐
                                             ▼                                          ▼
                                         amended                                    retired
```

- **`inferred`** — everything distillation may emit, and everything in this repo's
  `invariants.yaml` today. **Not enforced.** Machines may propose `inferred`; only a human may
  promote past it.
- **`ratified`** — human-promoted, enforced.
- **`contested`** — set when a reprogramming PR opens against the assertion. **Enforcement
  mutes**: you do not keep citing people for a law under active renegotiation.
- **`amended` / `retired`** — terminal. The assertion's history stays in git; nothing is
  deleted.

### The two field rules, which reviewers will hold you to

1. **No assertion without provenance.** Cite the commits, PRs, issues or ADRs the assertion
   rests on. An assertion without provenance is unreviewable and therefore unratifiable.
2. **Constitutional minimalism.** A twelve-assertion program gets read; a sixty-assertion one
   gets rubber-stamped. Adding an assertion means arguing it earns its slot — and the honest
   version of that argument sometimes retires another one.

### The ratification PR

1. **One amendment per PR**, separate from any engine change.
2. Edit only `.program/` files. The PR body states, per assertion:
   - the exact statement being added, changed, retired, or promoted,
   - its provenance (links, not adjectives),
   - for knob changes (`precision` / `budget` / `half_life`), what evidence justifies the
     number. Once the ledger exists, "replay says this fires 3 times instead of 40" is the
     argument that wins.
3. **A human must be the author, the committer, and the merger.** CI checks this
   (`.github/workflows/ci.yml` → the `inv001` job).
4. Review is per-assertion: **accept / edit / reject**. Rejecting an inferred regularity is
   itself a ruling — record it as a `coincidence` precedent in `precedents.yaml` so
   re-distillation cannot resurrect it (docs/spec/04-distillation.md §6).

### If an agent produced the change

Agents may **propose**, never enact. A Claude Code session (or any bot) that concludes
`.program/` should change writes the proposal to
[`proposals/PROPOSED-program-amendment.md`](proposals/PROPOSED-program-amendment.md) — a
ready-to-apply unified diff plus rationale — and stops there. A human reads it, applies it,
and opens the ratification PR under their own name.

This is not a formality about credit. INV-001 is `precision: 1.0, budget: 1.0`: a single
machine write to `.program/` fires immediately, and there is no version of "but the change was
correct" that makes the write path legitimate.

### Reprogramming proposals — when the law is wrong

The framework's whole point is that drift is not always the code's fault
(docs/vision.md). When accumulated surprise crosses an assertion's budget and the evidence is
**dispersed** — many independent authors, many paths, sustained over months — the engine files
a PR against `.program/` arguing that reality has already outvoted the statute
(docs/spec/02-ledger.md §5).

Handling one as a reviewer:

- The proposal ships its own evidence: contributing events, dispersion statistics, compliance
  ratio, decay-weighted total. Read the evidence before the prose.
- Opening it sets the assertion **`contested`** and mutes enforcement. That is deliberate;
  it is also a clock, because ignoring it accrues **governance debt**.
- **Rejecting** it is a real outcome, not a non-decision: it mints an `affirmed` precedent and
  *raises* the assertion's precision — a law ratified under fire is a stronger prior.
- **Accepting** it lands the amendment, moves the assertion to `amended`, and zeroes the
  accumulator.

---

## Changing `prompts/` re-seats a judge

A judge's identity is **model id + prompt hash** (docs/spec/01-core-memory.md §7,
docs/spec/03-judge.md §6). Editing `prompts/invariant-judge.md` or
`prompts/regression-judge.md` — even a typo fix, even whitespace — changes the hash and is
therefore **seating a new judge**, not editing a file.

A prompt PR must:

1. Update the `judges` entry in `.program/manifest.yaml` with the new prompt hash. That is a
   `.program/` change, so the whole ratification flow above applies — human author, human
   committer, reviewed PR.

   ```bash
   shasum -a 256 prompts/invariant-judge.md      # macOS
   sha256sum  prompts/invariant-judge.md         # Linux
   ```

2. **Pass the bar exam.** The candidate judge re-decides the settled cases in
   `.program/precedents.yaml` and must match the recorded rulings before it may sit. Precedents
   are the framework's case law and its calibration corpus at the same time; a judge that
   cannot reproduce settled law does not get to make new law.

3. Say what changed and why, in the PR body, in terms of *rulings* — which cases would now be
   decided differently, and is that the intent?

The same rule applies to changing a judge's `model` id in `manifest.yaml`. And it applies to
the framework's own judges, permanently: the observer is observed, with the same machinery
(golden-sample drift checks, docs/spec/03-judge.md §6).

---

## What CI runs on your PR

`.github/workflows/ci.yml`, three jobs:

| Job | Question | Fails when |
|---|---|---|
| `engine` | Does it build, pass tests, do the artifacts match `schemas/`, and does the declared `gwtp` binary exist after a build? | typecheck, vitest or `gwtp validate` fails (INV-006); or `package.json`'s `bin.gwtp` is not what `npm run build` emitted |
| `inv003` | Can the verdict branch reach the sentencing branch? | anything under `src/judge/**` or `src/evidence/**` value-imports a sentencing module or a declassifier, or any module outside `src/core/sentencing.ts` names the `gwtp.sentencing*` symbol-registry keys (INV-003) |
| `inv001` | Did a machine actor write to `.program/`? | any commit in the PR range touches `.program/**` with a bot/agent author, committer, or `Co-Authored-By:` trailer (INV-001) |

All three must be green. The `inv001` job checks out full history (`fetch-depth: 0`) and
fetches the base branch, because it walks a commit range rather than inspecting a tree.

> **Current status (v0, pre-SEED-02):** there is no ledger ref yet, so `gwtp validate` has only
> `.program/` to validate; ledger event files start being checked when SEED-02 creates them.
> If `npm run ci` fails on a clean tree, run the three steps individually — the failure is in
> the toolchain, not in your patch.

---

## Reading order for a new contributor

1. [`README.md`](README.md) — what this is, in one page.
2. [`docs/vision.md`](docs/vision.md) — why bidirectionality is the point.
3. [`GLOSSARY.md`](GLOSSARY.md) — the vocabulary. Worth reading before the specs, not after.
4. The spec for the component you are touching: [core memory](docs/spec/01-core-memory.md),
   [ledger](docs/spec/02-ledger.md), [judge](docs/spec/03-judge.md),
   [distillation](docs/spec/04-distillation.md).
5. [`docs/adr/`](docs/adr) — the six irreversible choices, and what was rejected.
6. [`docs/spec/OPEN-QUESTIONS.md`](docs/spec/OPEN-QUESTIONS.md) — everywhere the specs are
   silent and the implementation had to pick. If your change touches one of those places, the
   entry tells you the single spot where the interpretation is pinned.
