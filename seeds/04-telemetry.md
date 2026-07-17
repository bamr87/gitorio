# Seed 04 — Telemetry ("the circuit network")

**Objective:** the factory floor shows what's actually happening on GitHub.

**Context:** docs/ARCHITECTURE.md §6 · app/src/github/client.ts

**Tasks**
1. Poller: workflow runs for `factory--*` files, ETag conditional requests, backoff
   on rate-limit headers, poll only while the tab is visible.
2. Map runs → components → machine LEDs (green/amber/red/grey). Belts animate only
   while a run is in progress. Header shows factory-wide status.
3. Run drawer: recent runs, jobs, durations, conclusions; fetch + unzip logs
   (fflate) on demand.
4. Dashboard panel: runs/day, success rate, p50 duration per assembly line (7-day
   window, computed client-side).

**Acceptance:** ROADMAP Phase 4 boxes; with the scratch repo from seed 03, an issue opened in another tab lights the line within one poll interval. **Out of scope:** webhooks/SSE, alerting (Phase 6 watchdog).
