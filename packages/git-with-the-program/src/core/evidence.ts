// Implements: docs/spec/03-judge.md §3 (evidence assembly — what the judge does see) and §2
// (the two blindness rules). Everything a judge can see is defined here, PROVEN blind here,
// and sealed here. The assembler implementation lands in src/evidence/ at SEED-03; the types
// live in src/core so judge and evidence share them without a cycle.

import type { Assertion, AssertionClass } from './assertion.js';
import { deepFreeze, type NonEmptyReadonlyArray } from './brand.js';
import { type Blind, type IsBlind, type Proof, assertBlind } from './blindness.js';
import {
  type ChangeRef,
  type ContextRing,
  type Hunk,
  hunkHash,
} from './change.js';
import type { AssertionId, HunkHash } from './ids.js';
import type { PathGlob } from './paths.js';
import type { PrecedentView } from './precedent.js';
import { ok, type Parsed } from './result.js';
import type { Citation, Verdict } from './verdict.js';

/**
 * Exactly what spec 03 §3 permits: "the assertion — statement, class, scope". It
 * conspicuously does NOT include precision, budget, half_life or status, so this type has no
 * slot for them. A judge holding precision and budget is one arithmetic step from inferring
 * how hot the meter is; the `Pick` removes the step. A bundle with no numeric knobs also
 * gives a stray accumulator value nowhere natural to land.
 *
 * Whether §3's list is exhaustive or merely brief is docs/spec/OPEN-QUESTIONS.md Q-21; the
 * narrow reading is the least-committal one.
 */
export interface AssertionView {
  readonly id: AssertionId;
  readonly statement: string;
  readonly class: AssertionClass;
  readonly scope: NonEmptyReadonlyArray<PathGlob>;
}

/** One-directional door. There is deliberately NO `fromAssertionView`. */
export function assertionView(a: Assertion): AssertionView {
  return { id: a.id, statement: a.statement, class: a.class, scope: a.scope };
}

/** The assembler's product, before sealing. Proven blind below. */
export interface EvidenceBundleInput {
  readonly assertion: AssertionView;
  /** "The *why*, so the judge can rule on spirit, not just letter" — charter.md excerpt. */
  readonly charterExcerpt: string;
  /** Hunks intersecting `assertion.scope`, widened to `ring`. */
  readonly hunks: readonly Hunk[];
  readonly ring: ContextRing;
  /** Non-null only for the regression judge (spec 03 §7). Settled case law, not case history. */
  readonly precedent: PrecedentView | null;
}

export const EVIDENCE_SEAL: unique symbol = Symbol.for('gwtp.evidence.seal');

/**
 * Opaque: the seal symbol is only applied by `sealEvidence`, so no caller can hand-roll a
 * bundle. `hunkHash` is carried here because the verdict cache key needs it and recomputing
 * it outside the seal would let the cache key drift from the sealed content.
 */
export interface SealedEvidence {
  readonly [EVIDENCE_SEAL]: 'sealed';
  readonly bundle: EvidenceBundleInput;
  readonly hunkHash: HunkHash;
}

const KNOWN_BUNDLE_KEYS = [
  'assertion',
  'charterExcerpt',
  'hunks',
  'ring',
  'precedent',
] as const;

/**
 * THE CHOKEPOINT. Three enforcements, because no single one suffices:
 *
 *  1. COMPILE TIME — the parameter type is `B & Blind<B>`. `Blind<B>` rewrites any
 *     sentencing-only value, forbidden key name or callable at any depth into
 *     `BlindnessViolation<…>`, a type nobody can supply. Pass a bundle carrying
 *     `author: ActorId`, or one whose `hunks[0]` came from a rich git-log object with a
 *     `committer` field, and the call does not type-check — with the offending field named.
 *
 *  2. RUN TIME — `assertBlind` over the CALLER'S OBJECT, before anything is copied. The
 *     order matters: auditing the whitelisted copy instead would silently strip a leak and
 *     report success, and a leak that vanishes quietly is worse than one that raises. This
 *     is the limb that covers data entering as `unknown` from YAML or a forge API, where the
 *     type-level check is vacuous.
 *
 *  3. STRUCTURE — an explicit whitelist copy of the five known keys, AFTER the audit.
 *     TypeScript's excess-property check only fires on fresh object literals, so a subtype
 *     carrying extra runtime properties would otherwise pass straight through. Anything
 *     `assertBlind` could not recognise as a leak is dropped rather than forwarded.
 *
 * The result is deep-frozen. Throws `BlindnessBreach` on a runtime leak.
 */
export function sealEvidence<B extends EvidenceBundleInput>(
  input: B & Blind<B>,
): Parsed<SealedEvidence> {
  const source = input as EvidenceBundleInput;

  // Audit first, narrow second.
  assertBlind(source);

  const bundle: EvidenceBundleInput = {
    assertion: {
      id: source.assertion.id,
      statement: source.assertion.statement,
      class: source.assertion.class,
      scope: source.assertion.scope,
    },
    charterExcerpt: source.charterExcerpt,
    hunks: source.hunks.map((h) => ({
      path: h.path,
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      text: h.text,
    })),
    ring: source.ring,
    precedent:
      source.precedent === null
        ? null
        : {
            id: source.precedent.id,
            pattern: source.precedent.pattern,
            ruling: source.precedent.ruling,
            rationale: source.precedent.rationale,
          },
  };

  const h = hunkHash(bundle.hunks);
  if (!h.ok) return h;

  return ok(
    deepFreeze({
      [EVIDENCE_SEAL]: 'sealed',
      bundle,
      hunkHash: h.value,
    } as SealedEvidence),
  );
}

/** The keys a sealed bundle may carry. Exported so SEED-03 can assert the whitelist is total. */
export const SEALED_BUNDLE_KEYS: readonly string[] = KNOWN_BUNDLE_KEYS;

/**
 * Mechanical check that every cited span lies inside a hunk the judge was actually SHOWN.
 * This is what turns "no citation, no verdict" from a rule the judge is asked to follow into
 * one the harness enforces (SEED-03: "rejects uncited violations, re-prompt once, then abstain").
 */
export function citationsWithinBundle(
  sealed: SealedEvidence,
  citations: readonly Citation[],
): boolean {
  return citations.every((c) =>
    sealed.bundle.hunks.some(
      (h) =>
        h.path === c.path &&
        c.startLine >= h.newStart &&
        c.endLine <= h.newStart + Math.max(h.newLines, 1) - 1,
    ),
  );
}

/**
 * Every rung of the ladder — deterministic check, LLM magistrate, panel, human shim —
 * implements this one signature. Because `SealedEvidence` is the only parameter and only
 * `sealEvidence` mints it, there is no overload, no options bag, and no second argument
 * through which authorship or a running total could arrive.
 */
export type Judge = (evidence: SealedEvidence) => Verdict | Promise<Verdict>;

/**
 * The assembler's only window onto the repository. No author accessor, no accumulator
 * accessor, and no forge type — INV-003 and INV-005 in one interface.
 */
export interface ChangeSource {
  hunksIntersecting(
    scope: NonEmptyReadonlyArray<PathGlob>,
    ref: ChangeRef,
    ring: ContextRing,
  ): Promise<readonly Hunk[]>;
}

/**
 * INV-003 as a BUILD-TIME OBLIGATION. Zero runtime cost. Adding an ActorId, a Surprise, a
 * LedgerEvent, a DispersionStats or a forbidden field name anywhere transitively inside these
 * types turns `IsBlind<T>` into `false`, which violates `Proof<T extends true>` and fails tsc.
 */
export type __INV003_PROOFS = readonly [
  Proof<IsBlind<AssertionView>>,
  Proof<IsBlind<PrecedentView>>,
  Proof<IsBlind<Hunk>>,
  Proof<IsBlind<ChangeRef>>,
  Proof<IsBlind<ContextRing>>,
  Proof<IsBlind<EvidenceBundleInput>>,
  Proof<IsBlind<Verdict>>,
];
