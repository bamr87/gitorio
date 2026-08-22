# Plan: Browser demo environment

> Companion to `spec.md`. Describes **how** we will satisfy the requirements.

## 1. Architecture Overview

Every panel in GitFactory already talks to a single injectable seam: the `GithubClient` interface in `app/src/github/types.ts`. `connectWithPat()` returns one; the stores hold one; no panel reaches the network directly. The client tests already exploit this by injecting a fake `fetch`.

So the demo is one substitution, not a mode threaded through the UI: implement `GithubClient` over committed fixtures and put *that* in the stores. Every panel then works unchanged, and — critically — the compile, facts, metrics and audit engines run for real over the fixture data (spec G2). There is no second rendering path to drift.

```
?demo=1 ──▶ enterDemoMode()
              ├── createDemoClient()  ── implements GithubClient over fixtures + in-memory overlay
              ├── seeds github store (client + repo + demo login)
              ├── seeds blueprint on the canvas
              └── seeds fleetops roster
                        │
        unchanged panels ┴── compile() · fleet/facts · fleet/metrics · fleet/audit
```

## 2. Component Changes

| Layer | File / Module | Change |
|-------|---------------|--------|
| Demo | `app/src/demo/fixtures.ts` | new — the demo fleet: repos, workflow sources, runs, variables, `.factory/` files |
| Demo | `app/src/demo/client.ts` | new — `createDemoClient()`: all 22 `GithubClient` methods + `login`, reads from fixtures, writes to an in-memory overlay |
| Demo | `app/src/demo/seed.ts` | new — `enterDemoMode()` / `exitDemoMode()`: wires client + blueprint + roster into the stores |
| Demo | `app/src/demo/tour.ts` | new — ordered tour steps (tab, title, body) |
| UI | `app/src/panels/DemoBanner.tsx` | new — persistent banner + tour overlay |
| UI | `app/src/App.tsx` | read `?demo=1` on mount; render the banner |
| UI | `app/src/panels/*` empty states | add an "explore the demo" affordance |
| Registry / Compiler / Schema | — | **unchanged** (see §3) |

## 3. Blueprint & Schema Changes

None. No machine type is added or altered, so `schema/blueprint.schema.json` is untouched and the registry↔schema drift guard is unaffected. The demo seeds an ordinary blueprint built from existing machine types, so every previously-encoded blueprint string remains valid.

## 4. Tech Choices & Alternatives

| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|-------------------------|-----|
| Demo data seam | Implement `GithubClient` | `if (demoMode)` branches in each panel; MSW-style network interception | The interface already exists and every panel uses it; branching per panel creates a second rendering path that will drift from the real one. Network interception would need a service worker, which is a moving part a static Pages app should not need. |
| Writes | In-memory overlay over fixtures | Reject writes; localStorage persistence | Rejecting makes Deploy and Prompt Studio undemonstrable — half the tool. Persisting across reloads makes the demo stateful and un-resettable for the next visitor. Session-scoped is the honest middle. |
| Run timestamps | Generated relative to an injected clock | Hard-coded dates in fixtures | This repo has already shipped one time bomb from hard-dated fixtures (`fleetops.test.ts`, red on main for three weeks). Relative generation cannot rot. |
| Entry | `?demo=1` + empty-state buttons | Auto-enter when disconnected | Auto-entering would hide the real disconnected state from someone who *means* to connect, and would make the Pages deployment lie about what it is. |

No golden-rule deviation, so no ADR-lite entry is required by this table — though the work is significant enough to warrant one for the log.

## 5. Least Privilege & Permissions

No compiled workflow changes, so no `permissions:` block and no `--allowedTools` grant changes anywhere. The demo grants strictly *less* than the existing app: the demo client holds no token, exposes no auth parameter, and issues no request. Explicitly NOT granted: any network access, any credential storage, any path to `api.github.com`. Demo mode also clears any live client on entry (NFR-SEC-2) so a real token can never be in play behind a demo banner.

## 6. Loop Guards & Untrusted Input

Loop guards are a property of compiled workflows and are unchanged. Untrusted input is not a new factor: all demo content is repo-committed fixtures reviewed in this PR, not attacker-supplied issue bodies or diffs. The demo renders that content into the same panels that already render live GitHub content, so no new sink is introduced.

## 7. Test Strategy

- Unit: `createDemoClient()` satisfies `GithubClient` (type-level assignment + every method callable) — AC-6.
- Unit: reads return fixture content; writes are visible on the following read — FR-2, FR-3, AC-4.
- Unit: no method touches `globalThis.fetch` — asserted by stubbing fetch to throw and exercising the client — NFR-SEC-1.
- Integration: the demo blueprint compiles with zero error diagnostics through the real `compile()`, and the demo's YAML equals `compile()` output — AC-2.
- Integration: fixtures drive `facts`/`metrics`/`audit` to non-empty results — AC-3.
- Browser: drive all seven tabs in Chromium with no token and capture each — AC-1, AC-5.
- Bundle: record built size before/after against the NFR-PERF-1 budget.

## 8. Rollout

Ships in the normal Pages deploy; no flag, no migration, nothing to provision. Demo mode is inert until a visitor asks for it via `?demo=1` or a button, so the default first paint is unchanged for existing users.

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| R-1 fixture drift / time bombs | Runs generated from an injected clock; no hard dates (§4) |
| R-2 bundle growth | NFR-PERF-1 budget, measured before/after in §7 |
| R-3 demo diverges from real behaviour | The demo may supply data but never reimplement engine logic; AC-2 pins the compiler output |
| Visitor believes a demo write reached GitHub | Persistent banner (FR-6) + session-only overlay |

## 10. Estimated Effort

Medium. The client is 22 small methods over static data; the fixtures largely exist already (39 committed workflow files); the UI addition is a banner plus a tour overlay. The care is in the fixtures being realistic enough to exercise the metrics and audit engines meaningfully.
