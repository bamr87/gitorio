// Implements: docs/spec/05-nexus.md §5 (context rings — operationalizing spec 03 §3's
// "expanding context ring granted on abstain escalation (function bodies → file → nearest
// callers)") as an implementation of the `ChangeSource` PORT from src/core/evidence.ts. The
// evidence assembler and the seal are untouched: this module only changes what a change
// source OFFERS at each ring, and everything it offers is a `Hunk` — the already-proven-blind
// type (src/core/change.ts).
//
// THE THREE RING RULES (spec 05 §5), each visible in the code below:
//   1. Context is context — synthesized hunks carry ONLY ` `-prefixed lines, so
//      `postImageLines` reports them `added: false` and no deterministic judge can mint an
//      offence from granted context; a judge can still CITE into them (INV-004 allows citing
//      anything it was shown).
//   2. The ring does not escape the assertion's scope — `scopedHunks` is applied here too,
//      belt to the assembler's braces (docs/spec/OPEN-QUESTIONS.md Q-66).
//   3. Context is read from the snapshot the graph was built over, which must be the tree the
//      diff lands on (Q-67).
//
// IMPORT DISCIPLINE: value imports reach only src/core/change.js and src/core/paths.js (and
// sibling nexus modules), none of which can reach the sentencing branch — the same provably
// clean closure the deterministic judges keep, held here so src/nexus can join INV-003's
// blind scope by amendment without a code change (proposals/PROPOSED-nexus-amendment.md).

import { type ContextRing, type Hunk, scopedHunks } from '../core/change.js';
// TYPE-ONLY, and load-bearing that it stays that way: a VALUE import of core/evidence.js
// reaches core/blindness.js, which value-imports the sentencing tag (see Q-60).
import type { ChangeSource } from '../core/evidence.js';
import type { PathGlob, RepoPath } from '../core/paths.js';
import type { DefinitionNode, Span } from './types.js';
import { type NexusIndex, callersOf, enclosingDefinition } from './query.js';

// ---------------------------------------------------------------------------
// Span bookkeeping
// ---------------------------------------------------------------------------

interface PathSpan {
  readonly path: RepoPath;
  readonly span: Span;
}

/** Post-image range a diff hunk covers, 1-based inclusive; empty hunks still occupy a line. */
function hunkRange(h: Hunk): Span {
  return { start: h.newStart, end: h.newStart + Math.max(h.newLines, 1) - 1 };
}

function contains(outer: Span, inner: Span): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/**
 * One synthesized CONTEXT hunk covering `span` of `path`, every line ` `-prefixed. Old and
 * new sides are declared equal — context asserts nothing changed. Returns null when the
 * snapshot has no such file (a deleted path can anchor no context).
 */
function contextHunk(
  files: ReadonlyMap<string, string>,
  path: RepoPath,
  span: Span,
): Hunk | null {
  const content = files.get(path);
  if (content === undefined) return null;
  const all = content.split('\n');
  // A trailing newline yields a phantom final element; a file of N lines has N addressable ones.
  const lineCount = content.length === 0 ? 0 : content.endsWith('\n') ? all.length - 1 : all.length;
  if (lineCount === 0) return null;
  const start = Math.max(1, span.start);
  const end = Math.min(lineCount, span.end);
  if (end < start) return null;
  const body = all
    .slice(start - 1, end)
    .map((l) => ` ${l}`)
    .join('\n');
  return {
    path,
    oldStart: start,
    oldLines: end - start + 1,
    newStart: start,
    newLines: end - start + 1,
    text: body,
  };
}

/** Whole-file span for a snapshot member, or null. */
function fileSpan(files: ReadonlyMap<string, string>, path: RepoPath): Span | null {
  const content = files.get(path);
  if (content === undefined || content.length === 0) return null;
  const lines = content.endsWith('\n') ? content.split('\n').length - 1 : content.split('\n').length;
  return lines === 0 ? null : { start: 1, end: lines };
}

// ---------------------------------------------------------------------------
// The rings (spec 05 §5 — cumulative, matching spec 03 §3's arrow)
// ---------------------------------------------------------------------------

/**
 * The enclosing definitions of one hunk: the innermost definition at the hunk's first and
 * last post-image lines. A definition strictly inside the hunk contributes nothing the hunk
 * does not already show, so endpoints suffice.
 */
function enclosingDefs(ix: NexusIndex, h: Hunk): readonly DefinitionNode[] {
  const r = hunkRange(h);
  const out: DefinitionNode[] = [];
  for (const line of r.start === r.end ? [r.start] : [r.start, r.end]) {
    const d = enclosingDefinition(ix, h.path, line);
    if (d !== null && !out.some((x) => x.id === d.id)) out.push(d);
  }
  return out;
}

/**
 * The hunks a change source offers at `ring` (spec 05 §5): the base diff hunks, plus —
 * cumulatively per rung — enclosing-definition spans, whole touched files, and the spans of
 * nearest callers. Deterministic: context is deduped by containment and sorted by
 * (path, start); base hunks always come first, unmodified.
 */
export function ringHunks(
  ix: NexusIndex,
  files: ReadonlyMap<string, string>,
  base: readonly Hunk[],
  ring: ContextRing,
): readonly Hunk[] {
  if (ring === 'hunk') return base;

  const wanted: PathSpan[] = [];
  const enclosing: DefinitionNode[] = [];
  for (const h of base) {
    for (const d of enclosingDefs(ix, h)) {
      if (!enclosing.some((x) => x.id === d.id)) enclosing.push(d);
      wanted.push({ path: d.path, span: d.span });
    }
  }

  if (ring === 'file' || ring === 'callers') {
    const touched = new Set<string>(base.map((h) => h.path));
    for (const path of [...touched].sort()) {
      const span = fileSpan(files, path as RepoPath);
      if (span !== null) wanted.push({ path: path as RepoPath, span });
    }
  }

  if (ring === 'callers') {
    for (const d of enclosing) {
      for (const caller of callersOf(ix, d)) {
        wanted.push({ path: caller.definition.path, span: caller.definition.span });
      }
    }
  }

  // Containment dedupe: a span inside another offered span — or inside a BASE hunk's own
  // post-image range on the same path — adds no evidence, only bytes.
  const baseRanges: PathSpan[] = base.map((h) => ({ path: h.path, span: hunkRange(h) }));
  const kept: PathSpan[] = [];
  const bySize = [...wanted].sort(
    (a, b) =>
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      b.span.end - b.span.start - (a.span.end - a.span.start) ||
      a.span.start - b.span.start,
  );
  for (const c of bySize) {
    const swallowed =
      kept.some((k) => k.path === c.path && contains(k.span, c.span)) ||
      baseRanges.some((k) => k.path === c.path && contains(k.span, c.span));
    if (!swallowed) kept.push(c);
  }

  const context: Hunk[] = [];
  for (const c of kept.sort(
    (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.span.start - b.span.start,
  )) {
    const h = contextHunk(files, c.path, c.span);
    if (h !== null) context.push(h);
  }
  return [...base, ...context];
}

// ---------------------------------------------------------------------------
// The port implementation
// ---------------------------------------------------------------------------

/**
 * A `ChangeSource` (src/core/evidence.ts) that actually honors the ring parameter — the first
 * one in the engine to do so. `scope` is applied HERE as well as by the assembler
 * (`scopedHunks` twice, deliberately): rule 2 above, so a caller outside the assertion's
 * scope never leaves this module. `ref` is unused by construction — the tree was chosen when
 * the graph was built (rule 3), and a `ChangeRef` carries nothing blind code may not hold.
 */
export function nexusChangeSource(
  ix: NexusIndex,
  files: ReadonlyMap<string, string>,
  base: readonly Hunk[],
): ChangeSource {
  return {
    hunksIntersecting: (scope: readonly PathGlob[], _ref, ring: ContextRing) =>
      Promise.resolve(scopedHunks(scope, ringHunks(ix, files, base, ring))),
  };
}
