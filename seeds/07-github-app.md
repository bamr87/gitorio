# Seed 07 — GitHub App & device flow

**Objective:** replace PAT ergonomics with a proper GitHub App install, still with
zero backend.

**Context:** docs/ARCHITECTURE.md §2 · DECISIONS ADR-004

**Tasks**
1. Register the GitFactory GitHub App (manifest in docs/app-manifest.json — create
   it): permissions Contents RW, Issues RW, PRs RW, Actions R, Workflows RW,
   Secrets RW; enable device flow; no webhooks yet.
2. Implement device-flow auth in the UI (user code display, polling for the token),
   token refresh handling; keep PAT as a fallback path.
3. Installation picker = factory site selector; scope all API calls to the
   installation's repos.
4. Update preflight checks and docs (README auth section, ARCHITECTURE §2 table).

**Acceptance:** ROADMAP Phase 7 boxes; fresh user can install the app and deploy a
factory without ever creating a PAT.
