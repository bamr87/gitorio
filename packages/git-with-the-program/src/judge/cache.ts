// Implements: docs/spec/03-judge.md §1 (the judgment ladder — the verdict cache: "Cache key:
// `assertion-id + hunk-hash + judge-hash` — which lines up exactly with the event store's
// idempotency and dedupes across force-pushes"). SEED-03 deliverable 5.
//
// A content-addressed store that memoizes a re-judge. The key is composed by the CONTRACT's own
// `verdictCacheKey()` (src/core/change.ts), so this file re-derives nothing: it only wires the
// three parts — the assertion id and hunk hash off the sealed bundle, the judge hash off the seat
// — into that key, and holds the result in an injectable backing.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  BLIND MODULE (INV-003). Under `src/judge/**`, so `scripts/check-inv003.ts` forbids a value
//  import of `core/{sentencing,accumulator,dispersion}` and `tests/ledger/blindness-boundary`
//  forbids REACHING them through any chain of value imports. Every value import below leads only
//  to `change`/`event`/`ids`/`result` — none of which reach the sentencing branch — and
//  `SealedEvidence`/`Judge`/`JudgeRef` are TYPE-ONLY imports (erased by `verbatimModuleSyntax`),
//  because a value import of `core/evidence.js` reaches `core/blindness.ts` → `core/sentencing.ts`
//  (docs/spec/OPEN-QUESTIONS.md Q-60). This module never mints a bundle; it only reads a sealed
//  one's `assertion.id` and `hunkHash`, both plain blind data.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// On Q-25: spec 03 §1 says this key "lines up exactly with the event store's idempotency", but
// the event id hashes the WHOLE canonical body (subject, verdict, severity, t, supersedes), so the
// two are not the same key — they are two indexes over the same fact (docs/spec/OPEN-QUESTIONS.md
// Q-25). This cache dedupes a *re-judgment* of the same (assertion, diff, judge) triple BEFORE an
// event is minted; the event store dedupes the minted event AFTER. A cache HIT means "this exact
// seat already ruled on this exact diff for this exact assertion, so do not pay to ask again"; a
// judge-hash change (new model id OR new prompt hash — spec 03 §6) changes the key and MISSES,
// which is the point: a re-seated judge must re-decide, never inherit the old bench's ruling.

import { verdictCacheKey } from '../core/change.js';
import { judgeHash } from '../core/event.js';
import type { AccumulatorKey, VerdictCacheKey } from '../core/ids.js';
import { ok, type Parsed } from '../core/result.js';
// TYPE-ONLY, and load-bearing that it stays that way — see the header.
import type { Judge, SealedEvidence } from '../core/evidence.js';
import type { JudgeRef } from '../core/event.js';
import type { Verdict } from '../core/verdict.js';

// ---------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------

/**
 * The three-part key of spec 03 §1, composed from a sealed bundle and a seat:
 *
 *   assertion-id  ← `sealed.bundle.assertion.id`   (the one assertion under judgment, spec 03 §1)
 *   hunk-hash     ← `sealed.hunkHash`              (carried on the seal, so it cannot drift from
 *                                                    the sealed content, and is stable across
 *                                                    force-pushes, spec 03 §1)
 *   judge-hash    ← `judgeHash(judge)`             (kind + id + prompt; changing model OR prompt
 *                                                    is seating a new judge, spec 03 §6)
 *
 * `Parsed` only because `judgeHash` is: it hashes `{kind, id, prompt}` and can fail on a malformed
 * seat. For a well-formed `JudgeRef` it is total. `sealed.bundle.assertion.id` is an `AssertionId`,
 * a member of the `AccumulatorKey` union `verdictCacheKey` accepts.
 */
export function verdictCacheKeyFor(
  sealed: SealedEvidence,
  judge: JudgeRef,
): Parsed<VerdictCacheKey> {
  const jh = judgeHash(judge);
  if (!jh.ok) return jh;
  const assertion: AccumulatorKey = sealed.bundle.assertion.id;
  return ok(verdictCacheKey(assertion, sealed.hunkHash, jh.value));
}

// ---------------------------------------------------------------------------
// The backing
// ---------------------------------------------------------------------------

/**
 * The pluggable store behind the cache. Deliberately the smallest possible surface — `get`/`set`
 * over the composed key — so a persistent backing (a git note, a file, an LRU) can satisfy it
 * without this module knowing. `size` is exposed for the "one underlying judge call" assertion and
 * for cheap observability; nothing in the decision procedure reads it.
 *
 * A cache is "never authoritative" (ADR-0002): the event set is the truth and re-folding is always
 * available, so a backing may legitimately forget an entry, and losing one only costs a re-judge.
 */
export interface VerdictCacheBacking {
  get(key: VerdictCacheKey): Verdict | undefined;
  set(key: VerdictCacheKey, value: Verdict): void;
  readonly size: number;
}

/** The default backing: a plain `Map`, optionally seeded. Pure over its own contents. */
export function inMemoryVerdictCache(
  seed?: Iterable<readonly [VerdictCacheKey, Verdict]>,
): VerdictCacheBacking {
  const map = new Map<VerdictCacheKey, Verdict>(
    seed === undefined ? undefined : [...seed].map(([k, v]) => [k, v] as const),
  );
  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    get size() {
      return map.size;
    },
  };
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

/** The result of a read: the composed key, whether it hit, and the cached verdict if so. */
export interface CacheProbe {
  readonly key: VerdictCacheKey;
  readonly hit: boolean;
  readonly verdict: Verdict | undefined;
}

/**
 * A small pure store over an injectable backing. `read`/`write` are the primitives; `through`
 * is the memoizing wrapper that turns any `Judge` into a caching `Judge` for a fixed seat.
 *
 * Nothing here reads a clock, an author, or the accumulator: a cache keyed by content and seat is
 * exactly as blind as the seal it is keyed from.
 */
export interface VerdictCache {
  /** Compose the key for `(sealed, judge)`. Exposed so a caller can pre-compute or log it. */
  readonly keyFor: (sealed: SealedEvidence, judge: JudgeRef) => Parsed<VerdictCacheKey>;
  /** Read without running any judge. A key-composition failure surfaces as a clean miss. */
  readonly read: (sealed: SealedEvidence, judge: JudgeRef) => CacheProbe;
  /** Record a ruling under `(sealed, judge)`. A key-composition failure is a no-op. */
  readonly write: (sealed: SealedEvidence, judge: JudgeRef, verdict: Verdict) => void;
  /**
   * Wrap a bench for a fixed seat: the returned `Judge` looks up `(sealed, judge)`, returns the
   * cached ruling on a hit, and on a miss runs `run(sealed)` exactly once, stores it, and returns
   * it. The `judge` seat is closed over because a `Judge`'s only argument is the `SealedEvidence`
   * (src/core/evidence.ts) — there is no channel through which the seat could otherwise arrive,
   * which is the same reason authorship cannot.
   */
  readonly through: (judge: JudgeRef, run: Judge) => Judge;
  /** Live entry count of the backing. */
  readonly size: () => number;
}

/**
 * Construct a cache over `backing` (a fresh in-memory `Map` by default).
 *
 * Fail-open on key composition: if `judgeHash` cannot hash a malformed seat, `read` reports a miss
 * and `through` runs the judge uncached rather than throwing. A cache that is never authoritative
 * (ADR-0002) must degrade to "ask the judge" on any doubt, never to a wrong answer or a crash.
 */
export function verdictCache(
  backing: VerdictCacheBacking = inMemoryVerdictCache(),
): VerdictCache {
  const keyFor = (sealed: SealedEvidence, judge: JudgeRef): Parsed<VerdictCacheKey> =>
    verdictCacheKeyFor(sealed, judge);

  const read = (sealed: SealedEvidence, judge: JudgeRef): CacheProbe => {
    const k = keyFor(sealed, judge);
    if (!k.ok) {
      return { key: '' as VerdictCacheKey, hit: false, verdict: undefined };
    }
    const verdict = backing.get(k.value);
    return { key: k.value, hit: verdict !== undefined, verdict };
  };

  const write = (sealed: SealedEvidence, judge: JudgeRef, verdict: Verdict): void => {
    const k = keyFor(sealed, judge);
    if (k.ok) backing.set(k.value, verdict);
  };

  const through =
    (judge: JudgeRef, run: Judge): Judge =>
    async (sealed: SealedEvidence): Promise<Verdict> => {
      const k = keyFor(sealed, judge);
      if (!k.ok) return run(sealed); // uncached: never authoritative, never a crash
      const cached = backing.get(k.value);
      if (cached !== undefined) return cached;
      const verdict = await run(sealed);
      backing.set(k.value, verdict);
      return verdict;
    };

  return { keyFor, read, write, through, size: () => backing.size };
}
