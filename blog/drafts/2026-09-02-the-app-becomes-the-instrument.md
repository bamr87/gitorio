---
title: "The app becomes the instrument: rebuilding GitFactory's surfaces on archify's viewer model"
description: "Two earlier sessions adopted archify as a renderer and a design language. This one made the app itself behave like the console those maps come from — one IR, two views, no permanent chrome."
date: 2026-09-02
categories: [it-journey]
tags: [gitfactory, archify, design-systems, react, svg, information-architecture, claude-code, ao-sdlc]
draft: true
---

## Where we started

By the end of August, GitFactory had adopted [tt-a1i/archify](https://github.com/tt-a1i/archify) twice over. Spec 010 vendored its renderer and wrote a pure compiler from GitFactory's blueprint and fleet models into archify's JSON IR, so every assembly line and every demo fleet shipped as a delivered, interactive HTML map. Spec 011 took archify's `DESIGN.md` — "The Evidence Console", seven semantic colours where colour carries meaning — and made it the app's design tokens, light theme and all.

And yet the app did not feel like the thing those maps came from. The eight delivered maps were served from the Pages deployment and linked from nowhere. Fleet Observe was still a second React Flow renderer of the same graph the architecture IR already described. The Build tab was a three-column editor with two permanent side panels — exactly the shape archify's design document names as the anti-pattern: *"don't create another permanent panel when the Semantic Passport, Node Finder, or existing canvas can carry the capability."* The tabs shared colours but not a grammar. The request that opened this session was blunt: rebuild the repo so the GitFactory framework lives inside archify's UI/UX design.

## The decision that made the rest fall out

The tempting move was to iframe the delivered maps everywhere. It fails on the first live blueprint: only the dogfood lines and the demo fleets have delivered maps, because rendering requires Node and archify's renderers execute at module scope over `process.argv`. That constraint had already been recorded as ADR-034's decision D-1 — archify never runs in the browser — and nothing about it had changed.

The other tempting move was to port `render-workflow.mjs` into React. That is a fork of someone else's renderer, and it drifts the first time either side changes.

What worked was noticing what the IR already is. Archify's IR is not a graph that needs layout; it is a *placed* diagram. Workflow nodes carry a lane and a column, architecture components carry a grid row and column, and the renderer's geometry is a handful of constants: a 680-pixel lane frame, six column x positions, a 92 × 52 node, a grid step of cell plus gap, boundary padding of 30 with 20 extra at the bottom. So the app grew a third pure consumer of its own data model beside the compiler and the IR compiler: `app/src/map/layout.ts` turns the IR JSON into positioned geometry using archify's own constants, and `MapView.tsx` draws that geometry as inline SVG with the same `c-<type>` semantic classes the delivered maps use. One IR, two views, one coordinate frame. The in-app view is deliberately a subset — focus and passport, finder, authored reach, guided views, zoom, beacons — and every surface links to the delivered HTML for the parts that stay there: route probe, exports, presentation.

```ts
// archify's workflow renderer, as constants — the in-app map and the delivered map agree on x/y
export const WORKFLOW_LAYOUT = {
  laneX: 40, laneY: 52, laneW: 640, laneH: 104, laneGap: 20, laneTitleH: 30,
  colXs: [88, 220, 300, 430, 500, 625],
  nodeW: 92, nodeH: 52,
} as const;
```

The test that pins this is small and unforgiving: lay out every dogfood line and every demo fleet twice, assert deep equality, assert every node's centre sits on one of archify's column x positions, assert nothing overlaps and every edge references two real nodes.

## Three hosts, one surface

With the surface in hand, the three gaps closed in the same shape. The Build tab gained a `Floor | Map` mode: Map draws each assembly line live — `assemblyLines()` → `toWorkflowIR()` → `layoutWorkflow()` memoised on the blueprint — with telemetry LEDs and diagnostics riding on the nodes as text-labelled evidence beacons, and a machine passport that shows the configured dials, the diagnostics, the compiled capabilities from `describeWorkflow`, and an *Edit on the floor* action. Selection is shared with the floor in both directions. The compiler's bot guard, which the map draws in an exception lane because the YAML really carries it, got a passport of its own that explains ADR-009 in two sentences.

Fleet Observe renders `toArchitectureIR(fleet, { cap: every workflow })` through the same surface. An in-app map has no twelve-node story budget, so nothing collapses into "N more workflows"; run status from the observe store rides as beacons; the workflow passport carries triggers, agent runner and model, writes, kill switch, cross-repo targets and the last run link. The React Flow fleet canvas, its node component and its layout module were deleted.

The Docs tab embeds delivered maps as figures through a one-line Markdown directive, `::map <slug> [caption]`, rendered as a same-origin iframe in the viewer's embed mode with the app's pinned theme passed through. Whether a map *exists* for a slug is answered by a manifest that `gen-maps` now writes beside the maps — slug, type, source, hash, sorted so it is byte-stable and covered by the same `maps:check` that keeps the maps exact. The app imports it at build time; a runtime fetch was rejected because the demo's "zero network" claim would have had to explain it.

## The floor without columns

The hardest change was also the smallest in code. The palette became a floating **Machine Finder** — `/` or a toolbar button opens it, it docks open while the floor is empty, drag-to-add still works — and the Inspector became a floating **Machine Passport** that opens on selection and closes on Escape, carrying every field the column had. The blueprint's own name, target repo and description moved behind a **Blueprint passport** on the toolbar title. No permanent side column remains; the canvas is dominant. The chrome grammar shipped as React primitives in `app/src/ui/` — `PageHeader`, `Panel`, `Cards`, `Chip`, `Kbd`, `Eyebrow`, `SearchField`, `Beacon` — and every other tab opens with a header inside a centred container and keeps its content in panels. The top bar carries the viewer's three-state theme toggle on the same `T` key.

## The one gnarly problem

Map mode's focus had to serve two masters. A machine selected on the floor should be the focused node on the map, and a node focused on the map should select its machine on the floor — but two kinds of node have *no* machine behind them: the compiler's guard and a collapsed "+N more". The first version made `MapView`'s focus fully controlled by the floor's selection, which meant clicking the guard set the selection to null and the passport never opened. The fix was a local focus state in the Map host that the floor's selection *writes into* rather than *replaces*, plus one effect-ordering subtlety: when the active line changes, the "clear focus on line change" effect must be declared before the "follow the selection" effect, because React runs a commit's effects in declaration order and the second one has to win. The failing test was the guard's passport; the passing test is the same click.

## Numbers

Fifty test files, 598 tests, lint at zero errors, typecheck and production build green, the AO-SDLC gates green, `maps:check` green with the eight delivered maps byte-identical to before. The initial JS bundle grew by 9 kB raw (4 kB gzipped); the map surfaces ship as a lazily loaded 35 kB chunk the floor's first paint never pays for. A Chromium pass over the demo in both colour schemes — seven tabs, Map mode, the Observe map, the finder, a passport, reach, the Docs embed, the `T` toggle — recorded zero console errors and zero requests to `api.github.com`.

## Working-with-AI tip

**Read the vendored thing's constants before designing around it.** The whole session pivoted on one fact that was sitting in `vendor/archify/renderers/workflow/render-workflow.mjs`: a nine-line `layout` object. Once the agent had grepped for `laneY`, `colXs` and `nodeW` instead of reasoning about "what a layout engine would need", the design collapsed from *port a renderer or bring in dagre* to *copy nine numbers and draw rectangles*. The general tactic: when adopting a library's *look*, ask the model to find the library's own source of geometric truth first and quote it into the plan, then write the invariant test that asserts your output lands on those numbers. The test doubles as documentation of where the numbers came from, and it will fail loudly the day the pin is bumped and the constants move — which is exactly when you want to know.
