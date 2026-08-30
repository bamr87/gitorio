# Demo mode (`?demo=1`)

> **Status: partial.** The "How it works" section below is an open gap — it needs
> a pass from someone reading the fixture and client source under `app/`. Everything
> above it is derived from behaviour described in [`README.md`](../README.md).

Audience: contributors. If you just want to click around the tool, the one-line
version is in the README's *"Try it without a token"* section.

## What it is

Appending **`?demo=1`** to the app URL brings the whole tool up on a fictional
three-repo fleet — canvas, prompts, telemetry, and the Fleet Ops cockpit — with
**no personal access token and no network calls**.

It is not a screenshot mock. Per the README, the demo swaps in a *fixture-backed
client behind the same seam a real connection uses*, so the compiler and the
facts / metrics / audit engines run for real over the fixture data. What you see
on the canvas is the output of the same code paths a token-backed session drives;
only the source of the repository data differs.

This matters for two reasons:

- **Onboarding.** A newcomer can see what a compiled factory looks like before
  deciding whether to point the tool at a real repository.
- **Manual testing.** Because the engines really execute, demo mode is a
  deterministic harness for eyeballing UI and compiler changes without minting a
  token or waiting on the GitHub API.

## Turning it on

The flag is a URL query parameter, so it works against any way you are already
serving the app.

| How you are running the app | URL |
| --- | --- |
| Vite dev server (`cd app && npm run dev`) | <http://localhost:5173/?demo=1> |
| Docker dev (`docker compose up dev`) | <http://localhost:5173/?demo=1> |
| Docker preview build (`docker compose --profile preview up --build`) | <http://localhost:8080/?demo=1> |

See the README's *Quickstart* and *Run with Docker* sections for the full set of
commands; demo mode needs no extra setup beyond adding the parameter.

## What it guarantees

- **No token required.** You do not need a PAT, and you are not asked to connect
  power (the Claude auth secret described in the README) to look around.
- **No network calls.** The fixture-backed client answers locally.
- **Nothing is written to GitHub.** No branches, no issues, no workflow files.
- **Edits are ephemeral.** Changes you make live in the tab and are gone when you
  close it. Treat a demo session as a scratchpad, not a place to draft a
  blueprint you care about.

A corollary worth stating out loud: because nothing is persisted and nothing is
sent, demo mode is a safe thing to hand to someone in a screenshare, and a safe
default for a public deployment of the static site.

## What it is *not*

- Not a fixture of *your* repositories — the fleet is fictional, so numbers on the
  factory floor are illustrative, not a benchmark.
- Not a substitute for the vitest suite. `cd app && npm test` remains the gate for
  compiler invariants; demo mode is for looking, not asserting.

## How it works

**This section is not yet written.** It should cover, for a contributor who needs
to change or extend the demo:

- **Where the fixtures live.** The repository layout table in the README places
  "demo fixtures" inside `app/` (alongside the canvas, `src/compiler/`, the GitHub
  client, and the Fleet Ops engines in `src/fleet/`) but does not give a path.
- **The seam.** The name of the client interface that the fixture implementation
  substitutes for, the file it is defined in, and where the substitution decision
  is made.
- **Flag detection.** Where `?demo=1` is read, and whether any other values or
  flags are honoured.
- **Adding or editing a fixture repo.** The shape of a fixture (repos, issues,
  workflow runs, whatever the engines consume), and which of the three fictional
  repos exercises which feature.
- **Test coverage.** Whether the fixtures are asserted against in `npm test`, and
  what breaks first if a fixture drifts from the client interface.

If you are the person filling this in: keep it to file paths and the one
invariant a future editor must not break (that the demo and the real client sit
behind the same seam), and let the source speak for the rest.

## Related

- [`README.md`](../README.md) — the user-facing one-paragraph version.
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — auth phases and the compiler spec;
  the real-connection half of the seam.
- [`docs/DOCUMENTATION-MAP.md`](DOCUMENTATION-MAP.md) — why this page is a
  contributor doc in `docs/` rather than user-facing prose in `_docs/`.
