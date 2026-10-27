# Seed 01 — Canvas MVP polish

**Objective:** the factory floor feels like a tool: fluid drag, legible machines, working inspector, lossless blueprint round-trips.

**Context:** CLAUDE.md · app/src/canvas/* · app/src/panels/* · app/src/state/store.ts

**Tasks**
1. Drag/drop hardening: drop accuracy at all zoom levels (screenToFlowPosition), grid snap (16px), Delete/Backspace removes selection, Esc clears selection.
2. Belt semantics: only out→in connections; reject in→in / out→out; duplicate edges impossible. Animated dash on belts; hover highlights the full downstream path.
3. Inspector: render fields from the registry (`text | textarea | number | select`),
validate on blur (cron syntax for trigger.cron, path shape for promptRef), show machine description + docs link.
4. Blueprint round-trip: export JSON, import JSON, copy/paste blueprint string (base64url, unicode-safe) — a round-trip must be deep-equal. Add a store test.
5. Empty state: a short "lay your first machine" hint pointing at the palette.

**Acceptance:** ROADMAP Phase 1 boxes; a saved-then-loaded blueprint is deep-equal; no console errors during a 2-minute build session.

**Out of scope:** GitHub I/O, new machine types, undo/redo.
