// Implements: docs/spec/03-judge.md §1 (verdict cache key: `assertion-id + hunk-hash +
// judge-hash`) and §3 (evidence assembly: "the diff hunks intersecting the assertion's
// scope, with an expanding context ring granted on abstain escalation").
//
// The blind view of a change. This file is identity-free BY CONSTRUCTION: there is no field
// anywhere in it that an author's name could occupy, and `BlindCommit` carries poison-pill
// `never` properties so a `SightedCommit` is not structurally assignable to it.

import type { AccumulatorKey, CommitSha, HunkHash, JudgeHash, PullRequestNumber, VerdictCacheKey } from './ids.js';
import { sha256RefHex } from './ids.js';
import { contentHash, type CanonicalValue } from './canonical.js';
import { type PathGlob, type RepoPath, matchesScope } from './paths.js';
import { ok, type Parsed } from './result.js';
import type { CommitterTime } from './time.js';

/**
 * One unified-diff hunk. Carries NO commit sha and NO author — that is what makes `hunkHash`
 * stable across force-pushes (spec 03 §1) and keeps the type blind.
 *
 * `newStart`/`newLines` are in the post-image, 1-based, so a `Citation` can be checked
 * against them. `text` is a free-form patch body and is the one hole the type system cannot
 * see into — see docs/spec/OPEN-QUESTIONS.md Q-09.
 */
export interface Hunk {
  readonly path: RepoPath;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  /** Hunk body only: `+`/`-`/` ` lines. No `@@` header, no index or commit metadata. */
  readonly text: string;
}

/**
 * Order-independent: hashes the canonical JSON of the hunks sorted by (path, newStart,
 * oldStart), so the same content produces the same key regardless of enumeration order.
 */
export function hunkHash(hunks: readonly Hunk[]): Parsed<HunkHash> {
  const sorted = [...hunks].sort(
    (a, b) =>
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      a.newStart - b.newStart ||
      a.oldStart - b.oldStart,
  );
  const body: CanonicalValue = sorted.map((h) => ({
    path: h.path,
    old_start: h.oldStart,
    old_lines: h.oldLines,
    new_start: h.newStart,
    new_lines: h.newLines,
    text: h.text,
  }));
  const r = contentHash(body);
  return r.ok ? ok(r.value as HunkHash) : r;
}

/**
 * What core knows about a change. There is deliberately no `author` field: the assembler
 * cannot leak identity it was never handed (ADR-0003).
 */
export interface ChangeRef {
  readonly commit: CommitSha;
  readonly committerTime: CommitterTime;
  readonly pr?: PullRequestNumber;
}

/**
 * The author-free commit view. The poison-pill fields are load-bearing: without them a
 * `SightedCommit` (src/core/sentencing.ts) would be STRUCTURALLY assignable here, because
 * excess-property checking only fires on fresh object literals. With them,
 * `const b: BlindCommit = sightedCommit` is a type error, since `ActorId` is not assignable
 * to `undefined`.
 */
export interface BlindCommit {
  readonly sha: CommitSha;
  readonly committedAt: CommitterTime;
  readonly paths: readonly RepoPath[];
  readonly author?: never;
  readonly committer?: never;
}

/** The evidence assembler's only input channel for the change under judgment. */
export interface BlindChangeSet {
  readonly commits: readonly BlindCommit[];
  readonly hunks: readonly Hunk[];
  readonly pr?: PullRequestNumber;
}

/** The expanding context ring granted on abstain escalation (spec 03 §3). */
export type ContextRing = 'hunk' | 'enclosing-symbol' | 'file' | 'callers';

export const CONTEXT_RINGS = [
  'hunk',
  'enclosing-symbol',
  'file',
  'callers',
] as const satisfies readonly ContextRing[];

/**
 * `null` at the widest ring — the point at which the case escalates a rung on the ladder
 * (single judge -> panel -> human) instead of widening further.
 */
export function widenContextRing(ring: ContextRing): ContextRing | null {
  const i = CONTEXT_RINGS.indexOf(ring);
  const next = CONTEXT_RINGS[i + 1];
  return next ?? null;
}

/** "The diff hunks intersecting the assertion's scope" (spec 03 §3), as a pure filter. */
export function scopedHunks(scope: readonly PathGlob[], hunks: readonly Hunk[]): readonly Hunk[] {
  return hunks.filter((h) => matchesScope(scope, h.path));
}

/**
 * spec 03 §1: `assertion-id + hunk-hash + judge-hash`. Rendered as
 * `<assertion>/<hunk-hex>/<judge-hex>` — path-safe and greppable in logs.
 */
export function verdictCacheKey(
  assertion: AccumulatorKey,
  hunks: HunkHash,
  judge: JudgeHash,
): VerdictCacheKey {
  return `${assertion}/${sha256RefHex(hunks)}/${sha256RefHex(judge)}` as VerdictCacheKey;
}
