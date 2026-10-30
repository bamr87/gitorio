# Proposal — Gitorio as Harness Studio: the fleet's home for loop and harness observe, design and manage

> A design proposal (no implementation) to redefine gitorio from "a factory builder that also observes" into the fleet's one interactive surface for harnesses and loops: a live map (observe), a blueprint editor (design) and confirm-gated actions through the hub console (manage), all over one shared graph schema that sits on JEV's numbering and generation layer.

- **Status:** proposed (design only — nothing in `app/` changes in this PR)
- **Date:** 2026-10-30
- **Proposed by:** Grok Bot (agent), at Amr's request; ratification is the maintainer's merge
- **Affects:** constitution §1 (mission) via [amendment 0002](../amendments/0002-harness-studio-mission.md); PRD FR4–FR12, NFR4–NFR7 (proposed); features GITORIO-007…GITORIO-014 (planned)
- **Related (hub):** roadmap issue [bamr87/bamr87#479 — "Roadmap: harness console live interactive map of loops and harnesses (Gitorio-style)"](https://github.com/bamr87/bamr87/issues/479) · proposed amendment PR [bamr87/bamr87#480 — "docs(governance): propose amendment — prior-art research before harness/loop design"](https://github.com/bamr87/bamr87/pull/480) · hub [`docs/JEV.md`](https://github.com/bamr87/bamr87/blob/main/docs/JEV.md) and amendment 0002 (conflict-free numbering) · gitorio ADR-011, ADR-034, ADR-035, ADR-036, ADR-038 · BL-20260902-13…18 · BL-20261022-02

## 0. Summary

Gitorio already holds most of the parts: a workflow parser (`app/src/fleet/parse.ts`), the archify IR (`app/src/archify/ir.ts`), a placed SVG map (`app/src/map/layout.ts` → `MapView.tsx`) with Passport and Finder, ETag-polled telemetry (`app/src/state/telemetry.ts`), a harness engine ported value-for-value from the hub (`app/src/harness/`, ADR-036), `fleet/v1` lanes, Fleet Command's confirm-gated run/arm/cancel, and the `@xyflow/react` blueprint canvas. The hub holds the rest: `diagrams/pipeline-map/pipeline.json` + `tools/pipeline_map.py` (live per-node status that the console does not show), the harness console (`tools/console`, `/api/live/stream` SSE, the workflow atlas, 11 loops, 49 ops), `_data/harness_registry.yml`, and JEV (`tools/jev/`: ids assigned at merge from fragments, main-only generated files, a tiered conflict engine). What is missing is one contract tying them together. This proposal names that contract — a **fleet graph schema (`fleetgraph/v1`)** generated on the hub under JEV's rules — and reorganises gitorio around three modes over it: **Observe**, **Design**, **Manage**. The research below finds no existing tool worth adopting wholesale; it recommends adopting two libraries (`elkjs` for layout of un-placed graphs, keeping `@xyflow/react` for editing) and borrowing UI patterns from Temporal, Dagster, Argo, LangGraph Studio and Langfuse.

## Goals

Amr's stated goals for the redesign. Every layer (§ 3.2) and phase (§ 5) maps to them; each goal has measurable success criteria checked at the phase that delivers it.

| Goal | Statement | Success criteria (measurable) |
| --- | --- | --- |
| **G1** | A robust, full-featured harness and loop design and configuration system | Every hub loop in `_data/harness_registry.yml` (11 today) and every gitorio blueprint line can be designed, configured and validated in the studio; 100% of the hub's six harness layers and twelve readiness checks are editable and graded; a studio-designed loop lands as a reviewable PR with zero hand edits (P6) |
| **G2** | A front end abstracted from the back end: a versioned graph/config schema (`fleetgraph/v1`) plus an engine/API layer that any UI consumes | `fleetgraph/v1` has a published JSON Schema with a version field and a compatibility test suite; the Gitorio app and the hub console both render from the same engine/API package with no UI-specific graph code; a schema change that breaks v1 fixtures fails CI (P2, P7) |
| **G3** | Highly configurable and extensible: plugin node types, adapters for GitHub Actions, the local runner and other engines, and config-driven behavior | Node types are registered through a plugin API, not core edits (at least one built-in type migrated to a plugin as proof); at least three adapters ship behind one adapter interface — GitHub Actions, the fleet local runner, and one other engine; behavior toggles live in config files validated by schema, not code branches (P8) |
| **G4** | Overarching: a production-ready, community-ready, full-fledged open harness tool for creating agentic workflows | A 1.0 release with: packaged artifacts (npm package for the engine/API + static app build) published by release-please; semver with a documented extension-API stability policy (deprecations survive one minor release); a docs site; `CONTRIBUTING.md`, a `CODE_OF_CONDUCT.md` (missing today), `LICENSE`, `SECURITY.md` with a written security model; CI green on tests, typecheck, lint, build and gates, with engine coverage ≥ 80%; a newcomer can install, run the demo and add a plugin node from the docs alone (P9) |
| **G5** | Jev is a core foundation, not an optional integration | Jev numbering is enforced in gitorio CI (`number lint` gating, `generated guard` on PRs) before any schema or engine work merges; every graph node id in `fleetgraph/v1` is a Jev-assigned id; design fragments are Jev fragments (P1, P2, P6) |

## 1. Needs assessment (per the proposed hub rule, bamr87/bamr87#480)

The proposed rule says every new harness or loop design starts with a needs assessment and an existing-tools survey with a build-vs-adopt decision. This section and § 2 are that record.

| # | Need | Who has it | Today | Gap |
| --- | --- | --- | --- | --- |
| N1 | See every loop and harness in the fleet as one live graph, with per-node status | Operator (Amr), fleet-pulse doctor triage | Gitorio Observe draws one repo's workflows; hub `pipeline_map.py` computes per-node status but nothing renders it live; console atlas is a list | No single live map; two status computations |
| N2 | Click a node and get its proof: last runs, cost, guardrails, kill switch, owning spec/feature/amendment | Operator, reviewers | Gitorio Passport (workflow facts, lanes); console ops pages | Passport cannot see hub registry or JEV ids; console cannot see blueprints |
| N3 | Design a new loop or change a harness visually and get a reviewable artifact | Operator, agents proposing loops | Blueprint canvas compiles to `factory--*.yml`; hub loops are hand-written | Designs for hub loops (registry entries, `pipeline.json` nodes) have no editor |
| N4 | Act on a loop (run, re-run, cancel, arm/disarm) safely | Operator | Fleet Command writes with the user's PAT behind a confirm (ADR-038); console has 49 ops | Two write paths with different guardrails; hub ops are not reachable from the map |
| N5 | Know what a loop costs, honestly | Operator, budget trip wires | Hub ledger + `budget.*`; JEV ledger separates `reported`/`estimated` | Gitorio shows no cost; any display must say "API-equivalent (estimate)" |
| N6 | Keep ids, generated files and new designs conflict-free while many agents open PRs | Every agent loop | JEV in the hub; gitorio is fan-out step 4 of hub amendment 0002 and not yet on it | Gitorio still picks `GITORIO-NNN` / `FRn` / ADR numbers in the PR |
| N7 | Embed the live map in the hub console without a second renderer | Hub console | Console is server-side (SSE); gitorio is static | No embed contract |

Constraints carried from the constitution and fleet rules: the frontend stays static (Pages); secrets never in code or localStorage; the hub is read-only from gitorio (ADR-036); agents never merge; nothing acts through the MCP tunnel.

## 2. Existing-tools survey and build-vs-adopt

Licenses were checked against each project's repository or license page on 2026-10-30; "borrow" means copy an interaction pattern, not code.

| Tool | What it is | License | Adopt / borrow | Call |
| --- | --- | --- | --- | --- |
| React Flow (`@xyflow/react`) | React library for node-based editors | MIT | Already used for the blueprint canvas; keep for Design only (ADR-011/035) | **Keep (adopted)** |
| ELK (`elkjs`) | Eclipse Layout Kernel, layered/orthogonal graph layout, JS port | EPL-2.0 | Adopt for laying out graphs that arrive without placement (hub registry, cross-repo belts); keep archify's own placement where the IR is already placed | **Adopt (library, lazy chunk)** |
| dagre | Simple layered DAG layout | MIT | Fallback only; ELK handles ports, compound nodes and orthogonal edges better | Don't adopt |
| Cytoscape.js | Graph theory + canvas/WebGL renderer | MIT | Borrow compound-node and "neighbourhood fade" ideas; a second renderer would contradict ADR-035 | Borrow |
| Temporal Web UI | Workflow execution history UI (SvelteKit) | MIT | Borrow event-history timeline and "pending activity" views for the Passport run tab | Borrow |
| Dagster UI (Dagit) | Asset/op graph with run status, launchpad | Apache-2.0 | Borrow asset-lineage view and the "launchpad" confirm screen for Manage | Borrow |
| Apache Airflow | DAG scheduler; Grid/Graph views | Apache-2.0 | Borrow Grid view (runs × tasks matrix) for loop history | Borrow |
| Prefect | Python orchestration; flow-run graph UI | Apache-2.0 (OSS server) | Borrow run-graph zoom-to-time | Borrow |
| Argo Workflows | K8s workflow engine + UI | Apache-2.0 | Borrow workflow-template vs workflow-run split (= blueprint vs observed line) | Borrow |
| n8n | Node-based automation editor + runtime | Sustainable Use License (fair-code, not OSI) | Borrow node-pinned execution data; do not embed (license, runtime) | Don't adopt |
| Node-RED | Flow-based low-code runtime + editor | Apache-2.0 | Borrow flow export/import as a string (gitorio already shares blueprints this way) | Borrow |
| LangGraph Studio | Agent-graph IDE (LangSmith) | LangGraph library MIT; Studio is part of the proprietary LangSmith platform | Borrow "interrupt/step through a node" and state inspector as a Design-mode simulate idea | Borrow |
| Langfuse | LLM tracing, cost, evals | MIT core (enterprise dirs separately licensed) | Borrow trace → span → cost drill-down and explicit "estimated cost" labelling | Borrow |
| Arize Phoenix | LLM tracing/evals (OpenTelemetry) | Elastic License 2.0 | Borrow OTel span model as a future telemetry shape; ELv2 rules out embedding as a hosted service | Borrow |
| Backstage | Developer portal, software catalog, plugin system | Apache-2.0 | Borrow catalog-entity YAML (`kind`, `spec.owner`, relations) for the registry side of `fleetgraph/v1`; too heavy (Node backend) to host | Borrow |
| GitHub Actions run graph | GitHub's built-in per-run job graph | Proprietary (GitHub UI) | Link out per run; it shows one run, not a fleet | Link |
| Actions visualizers (e.g. `actionlint` for checks; community workflow-graph renderers) | Linters / static renderers of workflow YAML | MIT for actionlint; varied for renderers | Consider `actionlint` as a Design-mode check in the compile step; static renderers add nothing over archify | Borrow (evaluate actionlint) |
| Mermaid | Text-to-diagram | MIT | Already superseded by archify maps (ADR-034) | Don't adopt |
| archify (vendored `tt-a1i/archify`) | Diagram IR, renderer, design language | as vendored (see `vendor/archify/VENDOR.md`) | Already the map language | **Keep (adopted)** |
| JEV (hub `tools/jev/`) | Fleet numbering, main-only generated files, conflict engine | Fleet-internal (hub) | Foundation layer — see § 3.2 | **Adopt (foundational)** |

Verdict: **build** the studio on gitorio's existing engines; **adopt** `elkjs`, keep `@xyflow/react` and archify, and **adopt JEV** as the governance and generation layer; everything else is borrowed patterns. No tool offers a static, GitHub-native, multi-repo harness map with confirm-gated ops — that combination is the reason to build.

## 3. The redesign

### 3.1 New purpose

> Gitorio is the fleet's Harness Studio: the place to **observe** every loop and harness live, **design** new ones as reviewable blueprints, and **manage** them through confirm-gated hub operations — over one graph schema shared with the hub, numbered and generated under JEV.

The factory builder stays — it becomes the Design mode, not the whole product.

### 3.2 Layer model (bottom to top)

| Layer | Owner | What it is | Goals |
| --- | --- | --- | --- |
| L0 **JEV** — ids, fragments, generated files | hub `tools/jev/` | Every new loop, harness, feature, requirement and amendment enters as a fragment with a `*-NEW` placeholder and is numbered at merge on `main` under `concurrency: jev-number`; generated files (the graph, catalogs) are main-only and regenerated, never merged; the conflict engine handles what is left (tier 0 free first, never merges, never force-pushes). Gitorio adopts it as fan-out step 4 of hub amendment 0002. | G5, G4 |
| L1 **`fleetgraph/v1`** — the shared graph schema | hub (generated) | One JSON document: nodes (loop, harness, workflow, job, op, trip wire), edges (triggers, dispatch belts, writes), each node keyed by its stable JEV-assigned id plus its source (registry entry, `pipeline.json` node, `fleet.manifest.yml` lane, blueprint line). Generated on the hub from `_data/harness_registry.yml`, `diagrams/pipeline-map/pipeline.json` and fleet manifests, as a JEV main-only file. Borrowing Backstage's `kind`/`relations` shape. | G2, G5 |
| L2 **Status** | hub + gitorio | Per-node status from one computation: `pipeline_map.py`'s status rules, either served by the console SSE (`/api/live/stream`) or recomputed client-side by a TypeScript port with a golden-file parity test (the ADR-036 pattern). | G2, G1 |
| L2b **Engine/API** | gitorio package (`@gitorio/engine`, proposed name) | The pure, UI-free layer: schema types and validation, graph→IR, status rules, compiler, harness grading, op-intent builders, the plugin registry and the adapter interface. Both the app and the console consume it; nothing in it imports React. | G2, G3, G4 |
| L3 **IR + layout** | gitorio | `fleetgraph/v1` → archify IR (`archify/ir.ts`); placed by archify where the IR is placed, by `elkjs` (lazy) where it is not. | G2 |
| L4 **Modes** | gitorio | Observe (SVG `MapView`), Design (`@xyflow/react` canvas), Manage (op intents → hub console). | G1, G3 |
| L5 **Hosts** | gitorio Pages + hub console | The same static bundle, deep-linked (`?tab=`, `?roster=`, new `?graph=`), embeddable in the console. | G2, G4 |

### 3.3 The three modes

- **Observe = live map.** Today's Observe map widened from one repo to `fleetgraph/v1`: loops as compound nodes, harness layers as badges, status beacons from L2, Passport on focus (runs, guardrails, kill switch, JEV ids linking to the feature/amendment/spec), Finder on `/`. Read-only. Sources in order: the console SSE when embedded; ETag-polled hub files on Pages (BL-20260902-18); fixtures in `?demo=1`.
- **Design = blueprint editor.** The existing canvas, plus a second output: alongside `factory--*.yml`, Deploy can emit a **design fragment** — a JEV fragment proposing a registry entry / `pipeline.json` node / feature (`id: *-NEW`) — opened as a PR, never committed to `main`. Every design carries its needs assessment and prior-art section (hub rule #480) as required Passport fields.
- **Manage = gated actions through the hub console.** Map actions become *op intents* (`{op, target, reason}`) handed to a console op from its 49; the console shows its confirm (repo, workflow, consequence, cost) and executes with its own credential. Gitorio never holds a hub write credential. Fleet Command's existing PAT-based actions on roster repos (ADR-038) stay for non-hub repos, behind the same confirm wording.

### 3.4 How the console embeds or consumes it

Option A (recommended first): the console links to Pages with `?graph=<hub-url>&tab=observe`. Option B: the console serves the static bundle under its own origin and passes the SSE URL in the query; gitorio's `GithubClient` seam gains a read-only `StatusSource` (SSE or poll). Option C: an iframe with `postMessage` op intents. B is the target because it keeps one renderer (ADR-035) and makes the console the only writer.

### 3.5 Guardrails

1. **Read-only by default.** Observe and Design never write; Manage is off until a session explicitly enables it.
2. **Writes only via confirm-gated hub ops.** Every hub-side mutation is a named console op with a confirm naming target and consequence; gitorio emits intents only. ADR-036 (hub read-only from gitorio) stands.
3. **Never through the MCP tunnel.** No mode reaches the hub or any repo through an MCP tunnel; ops go through the console's own authenticated path or the user's PAT (non-hub roster repos only).
4. **Cost is labelled "API-equivalent (estimate)"** everywhere it appears, with JEV's `reported`/`estimated`/`no-spend` source carried through and the estimated share shown separately.
5. Agents never merge; design fragments arrive as PRs; JEV's conflict engine never merges or force-pushes.
6. Secrets stay out of blueprints, code and localStorage (constitution §2).

## 4. What stays, what changes

**Stays:** the static frontend; the pure compiler and its invariants; `@xyflow/react` for Design only; archify IR + `MapView` + Passport + Finder; ETag telemetry; the harness engine and its golden parity; `fleet/v1` lanes; `?demo=1` as one substitution; ADR-036's read-only hub.

**Changes:** the mission (amendment 0002 here); the tab model collapses toward Observe / Design / Manage; Observe consumes `fleetgraph/v1` instead of only per-repo YAML; numbering moves to JEV fragments (`features/features.d/`, `docs/amendments/proposed/`); ADRs settle into one home (resolves BL-20261022-02); `elkjs` arrives as a lazy chunk; a `StatusSource` seam joins `GithubClient`.

## 5. Migration phases

| Phase | Scope | Exit criteria | Goals |
| --- | --- | --- | --- |
| P0 Ratify | Merge this proposal + amendment 0002 (mission); hub #480 ratified; hub #479 scoped | Maintainer merges; no code change | G1–G5 (agreed) |
| **P1 Integrate JEV (early, foundational)** | Take hub amendment 0002 fan-out step 4 for gitorio: `features/features.d/`, `docs/amendments/proposed/`, `.gitattributes` merge drivers, main-only generated files, `number lint` in CI; keep release-please for `CHANGELOG.md` (so no `changelog.d/`, per fan-out step 5) | Next feature/amendment lands numbered at merge; `jev generated guard` green on PRs | G5, G4 |
| P2 Schema | Define `fleetgraph/v1` on the hub (generated, JEV main-only) from registry + `pipeline.json` + manifests; a TS reader + fixture in gitorio | Golden fixture round-trips; schema doc in hub | G2, G5 |
| P3 Live map | Observe renders `fleetgraph/v1`; status via ETag poll; `pipeline_map.py` status ported with parity test; `elkjs` lazy | Fleet-wide map at `?graph=`; demo fixture; bundle budget held | G1, G2 |
| P4 Console embed | `StatusSource` SSE; console hosts the bundle (option B) | hub #479 acceptance met | G2 |
| P5 Manage | Op intents → console ops with confirms; cost labels | No write path exists outside console ops / user PAT on non-hub repos | G1, G4 |
| P6 Design fragments | Deploy emits JEV design fragments + needs-assessment fields | A new loop designed in the studio lands as a hub PR | G1, G5 |
| P7 Engine/API extraction | Move schema, graph→IR, status, compiler, harness grading and op intents into a UI-free engine/API package with a versioned public surface; app and console consume it | App has no graph logic outside the package; console renders from it; API docs generated | G2, G4 |
| P8 Plugin SDK + adapters | Plugin API for node types; adapter interface with GitHub Actions, local runner and one other engine; config-driven behavior validated by schema | One built-in node type moved to a plugin; three adapters pass a shared conformance suite | G3, G1 |
| P9 Community release 1.0 | Packaging and release-please releases, semver + extension-API stability policy, docs site, `CODE_OF_CONDUCT.md`, security model in `SECURITY.md`, contribution guide refresh, coverage target | 1.0 tagged; G4 checklist all green | G4 |

Ordering: P7 can start once P2 lands and runs in parallel with P3–P5; P8 needs P7; P9 needs P1–P8. Each phase enters as a `BL-*` item and a `specs/NNN-*` package (AO-SDLC).

## 6. Risks

- **Two status computations drift** (Python vs TS) — mitigate with the ADR-036 golden-file pattern.
- **JEV is hub-specific today**: `tools/jev/number.py` hard-codes the `HUB-` feature series (`FEATURE_ID`, `Series("HUB-", …)`); gitorio needs `GITORIO-`. See open questions.
- **Bundle growth** from `elkjs` (large) — lazy chunk, only for un-placed graphs.
- **Scope creep into a backend** — the console is the only server; gitorio stays static.
- **Embedding origin/CSP issues** with SSE across origins — option B avoids them.
- **Cost figures read as bills** — guardrail 4.

## 7. Open questions

1. Does JEV's numbering support a non-`HUB` feature prefix, or does fan-out step 4 bring a configurable series? (`number.py` reads `HUB-` today.) How does JEV treat gitorio's `docs/DECISIONS.md` ADR series, which is not one of its four series (feature, FR/NFR, changelog, amendment)?
2. Is `tools/jev/` consumed by reference (hub path) or vendored into gitorio? The fan-out plan says "`number.py` by reference" for governance-kit repos.
3. Should JEV's conflict engine (tiers 0–3) cover gitorio PRs once `JEV_CONFLICTS_ENABLED` is on — gitorio is in the registry, so presumably yes; confirm.
4. Is `_data/harness_registry.yml` the authority for loop identity, or `pipeline.json`? (ADR-036 recorded that the registry did not exist on 2026-09-02; it does now.)
5. Does the console's op set already include run/re-run/cancel/arm for non-hub repos, or only hub ops?
6. Where does `fleetgraph/v1` live — hub `_data/`, `diagrams/`, or a published Pages JSON?

## 8. Requirement and feature placeholders

Added in this PR as **planned** entries (see `features/features.yml` GITORIO-007…014 and PRD § 5 FR4–FR12, NFR4–NFR7, marked *proposed*). Once P1 lands, new ones are written as JEV fragments instead and numbered at merge.
