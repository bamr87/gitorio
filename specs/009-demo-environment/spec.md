# Spec: Browser demo environment

- **ID**: 009-demo-environment
- **Status**: shipped
- **Owner**: @bamr87
- **Created**: 2026-08-22
- **Roadmap link**: adoption/plug-and-play — GitFactory's Pages deployment is its own shop window
- **Golden-rules compliance**: confirmed against [CLAUDE.md](../../CLAUDE.md) § Golden rules

## 1. Problem & Motivation

GitFactory deploys to GitHub Pages, so anyone can open it — and five of its seven tabs are dead on arrival. Verified against the running app: `ContentPanel`, `MonitorPanel`, `PromptStudio`, both Fleet modes, and Deploy all render a "Connect a repo (top bar)" empty state until a fine-grained PAT is pasted in. Only Build and Docs work.

That is the wrong first impression for a tool whose whole thesis is that a factory is legible. A visitor cannot see the compiler produce a workflow, cannot see telemetry LEDs, cannot see the Fleet Ops cockpit that took two ADRs to build — without first creating a PAT and pointing it at a repo they own.

The cost is not hypothetical: a live browser pass over the app produced 27 screenshots, and every one showing real data required a token. The demo problem and the screenshot problem are the same problem.

## 2. Origin & Background

- Backlog items claimed: BL-20260822-02
- Builds on ADR-011's DEV-only `__fleetStore` tokenless-smoke hook and ADR-020's `__fleetOpsStore` — both prove seeded stores render correctly without a PAT, but both are `import.meta.env.DEV`-only, undiscoverable, and stripped from the Pages build.
- Reuses the 39 verbatim workflow fixtures under `app/src/fleet/fixtures/` captured for ADR-020/021.

## 3. Goals

- G1: Every one of the seven tabs renders meaningful, non-empty content with no PAT and no network.
- G2: The demo drives the **real** engines — `compile()`, `fleet/facts`, `fleet/metrics`, `fleet/audit` — so what a visitor sees is what the code actually does.
- G3: Reachable from a shareable URL on the Pages deployment.
- G4: A visitor who has never read the README can find out what each surface is for.

## 4. Non-Goals

- NG1: No mock UI. Nothing renders that is not produced by the shipping code paths.
- NG2: No write path to GitHub. The demo never holds or requests a credential.
- NG3: Not a replacement for connecting a real repo; the demo is an on-ramp, not a sandbox to build production blueprints in.

## 5. User Stories

- As someone sent a link to GitFactory, I want to see the whole tool working on realistic data immediately, so that I can judge whether it is worth wiring to my own repo.
- As a maintainer, I want a deterministic environment to screenshot and demo from, so that release notes and docs do not require a live token and a scratch repo.
- As a contributor, I want to exercise every panel offline, so that I can develop UI without provisioning credentials.

## 6. Functional Requirements

- **FR-1**: A `createDemoClient()` factory returns an object satisfying the full `GithubClient` contract (22 methods + `login`), backed by fixtures.
- **FR-2**: Reads resolve from a fixture fleet: repositories, workflow files, workflow runs (with `runAttempt` so rework metrics are exercised), Actions variables, `.factory/` blueprints, prompts and config.
- **FR-3**: Writes (`putFile`, `putSecret`, `setVariable`, `createPullRequest`, `createIssue`, `dispatchWorkflow`, …) succeed against an in-memory overlay, so Deploy, Prompt Studio edits and kill-switch toggles are demonstrable and visibly persist within the session.
- **FR-4**: Entering demo mode seeds the canvas with a blueprint, the Fleet Ops roster with the demo repos, and the connection state with a demo identity.
- **FR-5**: `?demo=1` enters demo mode on load; the empty states offer a button that does the same.
- **FR-6**: A persistent banner states that this is demo data and that nothing is written to GitHub, with a one-click exit.
- **FR-7**: A guided tour steps through the seven tabs, naming what each surface does.

## 7. Non-Functional Requirements

- **NFR-SEC-1**: The demo client performs no network I/O whatsoever, so it cannot leak or exercise a credential (golden rule #7).
- **NFR-SEC-2**: Demo mode is mutually exclusive with a live connection — entering it clears any live client rather than layering over it.
- **NFR-STATIC-1**: Ships in the production bundle as static data; no backend (golden rule #1).
- **NFR-PERF-1**: Fixture payload is bounded; the demo must not meaningfully regress the bundle. Budget: < 200 kB raw added.

## 8. Blueprint & Schema Impact

None. The demo consumes existing machine types and the existing blueprint schema; it adds no machine type and changes no schema branch, so the registry↔schema drift guard is unaffected.

## 9. Compiler & Workflow Impact

None to the compiler. The demo *calls* `compile()` unchanged — that is the point of G2. No emitter, permissions, or loop-guard behaviour changes; `examples/compiled/` needs no refresh.

## 10. UI Impact

- New `app/src/demo/` module (client, fixtures, seed, tour data).
- New `DemoBanner` + tour overlay components; existing empty states gain an "explore the demo" affordance.
- Stores (`state/github.ts`, `state/fleetops.ts`, `state/fleet.ts`, `state/content.ts`) accept an injected client — they already do internally; demo mode uses that seam rather than adding `if (demo)` branches to panels.
- Uses existing industrial palette tokens; banner is a landmark region and the tour is keyboard-navigable.

## 11. Security Impact

Reduces surface rather than adding it: the demo path never requests, stores, or transmits a token, and cannot reach `api.github.com`. Untrusted content is not a factor because all demo content is repo-committed fixtures, not attacker-supplied. The one risk is *confusion* — a visitor believing a demo write reached GitHub — which FR-6's persistent banner and the in-memory overlay's session-only lifetime address.

## 12. Acceptance Criteria

- **AC-1**: Given a browser with no PAT and no network, when the app is opened at `?demo=1`, then all seven tabs render non-empty content.
- **AC-2**: Given demo mode, when the Build tab compiles, then the YAML shown is produced by the real `compile()` — asserted by comparing against `compile()` output in a test.
- **AC-3**: Given demo mode, when Fleet Command scans, then Districts/Rankings/Workflows/Audit/Schedule all populate from `facts`/`metrics`/`audit` run over the fixtures.
- **AC-4**: Given demo mode, when a prompt is edited and saved, then the change is visible on re-read and no network request is made.
- **AC-5**: Given demo mode, the banner is present on every tab and exiting it returns the app to the disconnected state.
- **AC-6**: `createDemoClient()` satisfies `GithubClient` structurally — asserted by a type-level assignment plus a test that every method is callable.

## 13. Risks & Open Questions

- **R-1**: Fixture drift — demo data that ages into implausibility (the `fleetops.test.ts` time bomb was exactly this failure). Mitigation: runs are generated relative to an injected clock, never hard-dated.
- **R-2**: Bundle growth. Mitigation: NFR-PERF-1 budget, measured before/after.
- **R-3**: A demo that diverges from real behaviour is worse than no demo. Mitigation: G2/AC-2 — the demo may not reimplement engine logic, only supply data to it.

## 14. Out of Scope / Follow-ups

- Recording the tour as a video or GIF for the README.
- A "load my repo read-only" halfway mode between demo and full connect.
