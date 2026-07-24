// Implements: docs/spec/03-judge.md §2 (the two blindness rules) and §3 (evidence assembly —
// "the assertion, its charter provenance, the diff hunks intersecting the assertion's scope,
// with an expanding context ring granted on abstain escalation"), against ADR-0003
// (author-blind and accumulator-blind) and .program/invariants.yaml INV-003.
//
// THE EVIDENCE ASSEMBLER. Given an assertion projection + a change source, it produces the
// SealedEvidence bundle a judge rules on — assertion view, charter excerpt, scope-intersected
// hunks, context ring — and nothing else. It is the inbound gate of ADR-0003: the one place
// that decides what a judge is allowed to see, and it is structurally incapable of putting an
// author or a meter reading in front of one.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  BLIND MODULE (INV-003). This file sits under `src/evidence/**`, so `scripts/check-inv003.ts`
//  forbids it from value-importing `core/{sentencing,accumulator,dispersion}` or anything under
//  `src/ledger/**`, and `tests/ledger/blindness-boundary.test.ts` forbids it from REACHING
//  `core/sentencing.ts` through ANY chain of value imports ("holds TRANSITIVELY").
//
//  THE Q-60 CROSSING, RESOLVED BY INJECTION. The assembler's whole job is to CALL
//  `sealEvidence` — the one function that enforces INV-003 — yet a VALUE import of
//  `core/evidence.js` reaches `core/blindness.js`, which value-imports `SENTENCING_TAG` from
//  `core/sentencing.js` for `assertBlind`'s runtime walk. So a blind module that statically
//  value-imports `sealEvidence` is clean under the by-VALUE reading of INV-003 (which
//  `check-inv003.ts`, `Blind<T>` and the warrants enforce) but RED under the by-REACHABILITY
//  reading (which `blindness-boundary.test.ts` enforces). docs/spec/OPEN-QUESTIONS.md Q-60
//  records that these two readings are both live and unratified, and that the assembler is
//  exactly where they collide.
//
//  This file takes the least-committal resolution that satisfies BOTH readings without editing
//  `src/core/**` or any test: the seal is an INJECTED PORT (`EvidenceSeal`). A non-blind caller
//  (the CLI, a test) supplies the real `sealEvidence`; this module never statically imports it,
//  so its runtime value-closure never contains `core/sentencing.ts`, and its only reference to
//  `core/evidence.js` is an ERASED `import type`. The blindness chokepoint is fully real —
//  `sealEvidence` still runs `assertBlind`, whitelists the five known keys and deep-freezes —
//  the module just does not statically depend on the tag it would otherwise transitively name.
//  Every other specifier below leads only to change/paths/brand/ids/result, none of which can
//  reach the sentencing branch.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { scopedHunks, widenContextRing } from '../core/change.js';

// TYPE-ONLY, and load-bearing that they stay that way (see the header). A value import of
// evidence.js or blindness.js would reach core/sentencing.ts and fail the by-reachability rule.
import type { NonEmptyReadonlyArray } from '../core/brand.js';
import type { ChangeRef, ContextRing, Hunk } from '../core/change.js';
import type {
  AssertionView,
  ChangeSource,
  EvidenceBundleInput,
  SealedEvidence,
} from '../core/evidence.js';
import type { PathGlob } from '../core/paths.js';
import type { PrecedentView } from '../core/precedent.js';
import type { Parsed } from '../core/result.js';

// ---------------------------------------------------------------------------
// The seal port (the Q-60 resolution)
// ---------------------------------------------------------------------------

/**
 * The injected chokepoint. `sealEvidence` (src/core/evidence.ts) is exactly this shape — its
 * generic `B & Blind<B>` parameter is assignable here because `EvidenceBundleInput` is PROVEN
 * blind (`__INV003_PROOFS`), so the two are interchangeable at the call boundary. Injection
 * moves WHERE `sealEvidence` is named — out of this blind module, into a non-blind caller
 * (Q-60) — never WHAT it guarantees: the injected function still runs `assertBlind`, whitelists
 * the five known keys and deep-freezes.
 *
 * The blindness the assembler needs is carried by the INPUT type, not by this port: an
 * `EvidenceBundleInput` has no author or accumulator slot and its scalar fields are strings, so
 * there is nothing leaky the assembler could hand a seal even if a caller supplied a lax one.
 * The full deep `Blind<B>` value-arm still fires at every DIRECT call site of `sealEvidence`
 * (e.g. the CLI, the tests), which is where an `unknown`-typed leak would actually arrive.
 */
export type EvidenceSeal = (input: EvidenceBundleInput) => Parsed<SealedEvidence>;

// ---------------------------------------------------------------------------
// The request (structurally blind by shape)
// ---------------------------------------------------------------------------

/**
 * Everything the assembler is allowed to be handed. Note what has NO slot here and never will:
 * an author, a committer, a `SightedCommit`, an `AccumulatorState`, a `Surprise`, a prior
 * verdict. `assertion` is the already-projected `AssertionView` (id, statement, class, scope —
 * no knobs, Q-21); the caller runs the one-directional `assertionView()` door, which keeps
 * this module off a value import of `core/evidence.ts` (Q-60). The change arrives only through
 * `ChangeSource`, whose sole method returns `Hunk[]` — a type that cannot carry identity
 * (src/core/change.ts). Feeding author or accumulator data here fails to compile: it is an
 * excess property on a fixed-shape request, and `sealEvidence`'s `Blind<B>` rejects the value
 * regardless of the name (tests/evidence/assembler.test.ts pins both with `@ts-expect-error`).
 */
export interface AssembleRequest {
  /** The judge-facing projection (spec 03 §3). Built by the caller via `assertionView()`. */
  readonly assertion: AssertionView;
  /** Full charter.md prose; the assembler excerpts the relevant part (spec 03 §3). */
  readonly charter: string;
  /** The blind window onto the repository — no author accessor, no accumulator accessor. */
  readonly change: ChangeSource;
  /** Which change to read hunks for. `ChangeRef` carries commit + committer time, never a name. */
  readonly ref: ChangeRef;
  /** The context ring to assemble at; defaults to `INITIAL_RING` (spec 03 §3). */
  readonly ring?: ContextRing;
  /** Non-null only for the regression judge (spec 03 §7). Settled case law, not case history. */
  readonly precedent?: PrecedentView | null;
  /** Upper bound on the charter excerpt; defaults to `DEFAULT_CHARTER_CHARS`. */
  readonly maxCharterChars?: number;
}

/** The narrowest ring: just the changed hunks (spec 03 §3). Widens on abstain escalation. */
export const INITIAL_RING: ContextRing = 'hunk';

/** A charter excerpt is provenance, not the whole document. Bounded so compliance stays cheap. */
export const DEFAULT_CHARTER_CHARS = 800;

// ---------------------------------------------------------------------------
// Charter excerpting (spec 03 §3: "the why, so the judge can rule on spirit")
// ---------------------------------------------------------------------------

/** The literal leading path of a glob, before the first `*`/`?` — a searchable charter needle. */
export function scopeLiteralPrefix(glob: PathGlob): string {
  const s = String(glob);
  const cut = s.search(/[*?]/);
  const head = cut === -1 ? s : s.slice(0, cut);
  return head.replace(/\/+$/, '');
}

/**
 * A deterministic, pure excerpt of the charter for one assertion. Prefers the paragraph that
 * mentions the assertion id or a scope path, then grows by whole paragraphs up to `maxChars`;
 * falls back to the head when nothing matches. Deterministic because the excerpt feeds a
 * judge whose verdict is content-hashed into the ledger — a wandering excerpt would make the
 * same change land at two addresses.
 *
 * Deliberately NOT a scrub: it does not strip identity-bearing lines from the charter, because
 * that is docs/spec/OPEN-QUESTIONS.md Q-09's proposed-but-unratified handling and spec 03 §3
 * mandates no scrubbing today. `assertBlind` inside `sealEvidence` is the second line; the
 * first is that `Hunk.text` already excludes commit metadata by contract (src/core/change.ts).
 */
export function excerptCharter(
  charter: string,
  view: AssertionView,
  maxChars: number = DEFAULT_CHARTER_CHARS,
): string {
  const trimmed = charter.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const paragraphs = trimmed.split(/\n\s*\n/);
  const needles = [String(view.id), ...view.scope.map(scopeLiteralPrefix)].filter(
    (n) => n.length > 0,
  );
  const startIdx = paragraphs.findIndex((p) => needles.some((n) => p.includes(n)));
  const chosen = startIdx >= 0 ? paragraphs.slice(startIdx) : paragraphs;

  let out = '';
  for (const p of chosen) {
    const candidate = out.length === 0 ? p : `${out}\n\n${p}`;
    if (candidate.length > maxChars) {
      // A single opening paragraph longer than the budget is hard-cut; otherwise stop cleanly
      // on the last whole paragraph that fits.
      if (out.length === 0) return p.slice(0, maxChars).trimEnd();
      break;
    }
    out = candidate;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * spec 03 §3, the whole of it: read the hunks the change source offers for this ring, keep the
 * ones intersecting the assertion's scope, excerpt the charter, and SEAL. Re-applying
 * `scopedHunks` after `ChangeSource.hunksIntersecting` is cheap insurance — it matches the
 * deterministic judge's belt-and-braces and guarantees the sealed bundle never carries a hunk
 * outside `scope`, so a citation the judge later emits can only land on a shown hunk
 * (`citationsWithinBundle`, INV-004).
 *
 * The seal is the injected `EvidenceSeal` (Q-60): the assembler builds the bundle input as a
 * plain object literal and hands it to `seal`, which is the caller's `sealEvidence`. There is
 * no second argument, and the request has no author or accumulator slot, so there is nothing
 * to leak even if a caller tried.
 */
export async function assembleEvidence(
  req: AssembleRequest,
  seal: EvidenceSeal,
): Promise<Parsed<SealedEvidence>> {
  const ring = req.ring ?? INITIAL_RING;
  const view = req.assertion;
  const scope: NonEmptyReadonlyArray<PathGlob> = view.scope;

  const offered = await req.change.hunksIntersecting(scope, req.ref, ring);
  const hunks: readonly Hunk[] = scopedHunks(scope, offered);
  const charterExcerpt = excerptCharter(req.charter, view, req.maxCharterChars ?? DEFAULT_CHARTER_CHARS);

  return seal({
    assertion: view,
    charterExcerpt,
    hunks,
    ring,
    precedent: req.precedent ?? null,
  });
}

/**
 * The result of one abstain escalation (spec 03 §3: "an expanding context ring granted on
 * abstain escalation (function bodies → file → nearest callers)").
 */
export interface Escalation {
  /** The wider ring the case was re-assembled at. */
  readonly ring: ContextRing;
  readonly sealed: Parsed<SealedEvidence>;
}

/**
 * Widen the context ring by exactly one step and re-assemble. Returns `null` when the request
 * is already at the widest ring (`callers`) — the point at which the case escalates a RUNG up
 * the ladder (single judge → panel → human, spec 03 §1) instead of widening further. This is
 * the assembler's half of the abstain contract: `abstain` "never accumulates; it escalates
 * with a wider context ring, then up the ladder" (spec 03 §4). The judge decides to abstain;
 * this decides what it gets to see next.
 */
export async function escalateEvidence(
  req: AssembleRequest,
  seal: EvidenceSeal,
): Promise<Escalation | null> {
  const current = req.ring ?? INITIAL_RING;
  const wider = widenContextRing(current);
  if (wider === null) return null;
  const sealed = await assembleEvidence({ ...req, ring: wider }, seal);
  return { ring: wider, sealed };
}
