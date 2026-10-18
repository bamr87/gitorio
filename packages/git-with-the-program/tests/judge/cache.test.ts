// Tests for: src/judge/cache.ts — SEED-03 deliverable 5, the verdict cache keyed
// `assertion-id + hunk-hash + judge-hash` (spec 03 §1). Acceptance: same key hits with exactly one
// underlying judge call; a judge-hash change (new model or prompt) misses.
//
// Every sealed bundle here is minted by the REAL `sealEvidence` — nothing hand-rolls the seal — so
// `sealed.hunkHash` and `sealed.bundle.assertion.id` are the genuine values the cache composes.

import { describe, expect, it } from 'vitest';

import {
  judgeHash,
  parseAssertionId,
  parseJudgeId,
  parsePathGlob,
  parsePromptHash,
  parseRepoPath,
  sealEvidence,
  unwrap,
  verdictCacheKey,
  type Hunk,
  type Judge,
  type JudgeRef,
  type SealedEvidence,
  type Verdict,
} from '../../src/core/index.js';
import {
  inMemoryVerdictCache,
  verdictCache,
  verdictCacheKeyFor,
} from '../../src/judge/cache.js';

const glob = (s: string) => unwrap(parsePathGlob(s));
const rp = (s: string) => unwrap(parseRepoPath(s));

function hunk(path: string, newStart: number, lines: readonly string[]): Hunk {
  return {
    path: rp(path),
    oldStart: 0,
    oldLines: 0,
    newStart,
    newLines: lines.filter((l) => !l.startsWith('-')).length,
    text: lines.join('\n'),
  };
}

function seal(hunks: readonly Hunk[], id = 'INV-005'): SealedEvidence {
  return unwrap(
    sealEvidence({
      assertion: {
        id: unwrap(parseAssertionId(id)),
        statement: 'Engine core imports no forge-specific APIs',
        class: 'dependency',
        scope: [glob('src/core/**')],
      },
      charterExcerpt: 'fixture charter excerpt',
      hunks,
      ring: 'hunk' as const,
      precedent: null,
    }),
  );
}

const A = unwrap(parseAssertionId('INV-005'));
const ALIGNED: Verdict = { assertion: A, verdict: 'aligned' };

/** A `Judge` that records how many times it was actually invoked. */
function counting(verdict: Verdict = ALIGNED): { judge: Judge; calls: () => number } {
  let n = 0;
  return {
    judge: async () => {
      n += 1;
      return verdict;
    },
    calls: () => n,
  };
}

const DETERMINISTIC: JudgeRef = { kind: 'deterministic', id: unwrap(parseJudgeId('import-boundary')) };
const MODEL: JudgeRef = {
  kind: 'model',
  id: unwrap(parseJudgeId('claude-opus-5-5')),
  prompt: unwrap(parsePromptHash(`sha256:${'a'.repeat(64)}`)),
};
const MODEL_REPROMPTED: JudgeRef = {
  kind: 'model',
  id: unwrap(parseJudgeId('claude-opus-5-5')),
  prompt: unwrap(parsePromptHash(`sha256:${'b'.repeat(64)}`)),
};

const BREACH = [hunk('src/core/x.ts', 1, [`+import { Octokit } from '@octokit/rest';`])];

describe('the cache key composes the three parts of spec 03 §1', () => {
  it('is exactly verdictCacheKey(assertion-id, hunk-hash, judge-hash) — the Q-25 alignment', () => {
    const sealed = seal(BREACH);
    const key = unwrap(verdictCacheKeyFor(sealed, MODEL));
    const expected = verdictCacheKey(
      sealed.bundle.assertion.id,
      sealed.hunkHash,
      unwrap(judgeHash(MODEL)),
    );
    expect(key).toBe(expected);
    // The assertion id is greppable in the key; the hunk and judge halves are hashed.
    expect(key.startsWith('INV-005/')).toBe(true);
  });

  it('is stable: same sealed bundle + same seat → the same key, every time', () => {
    const k1 = unwrap(verdictCacheKeyFor(seal(BREACH), MODEL));
    const k2 = unwrap(verdictCacheKeyFor(seal(BREACH), MODEL));
    expect(k1).toBe(k2);
  });
});

describe('a cache hit dedupes a re-judge (spec 03 §1)', () => {
  it('same key hits — the underlying judge is called exactly once', async () => {
    const cache = verdictCache();
    const { judge, calls } = counting();
    const cached = cache.through(DETERMINISTIC, judge);
    const sealed = seal(BREACH);

    const first = await cached(sealed);
    const second = await cached(seal(BREACH)); // freshly sealed, same content → same key
    expect(first).toEqual(ALIGNED);
    expect(second).toEqual(first);
    expect(calls(), 'a hit must not re-run the judge').toBe(1);
    expect(cache.size()).toBe(1);
  });

  it('read/write are pure primitives over the backing', () => {
    const cache = verdictCache();
    const sealed = seal(BREACH);
    expect(cache.read(sealed, DETERMINISTIC).hit).toBe(false);
    cache.write(sealed, DETERMINISTIC, ALIGNED);
    const probe = cache.read(sealed, DETERMINISTIC);
    expect(probe.hit).toBe(true);
    expect(probe.verdict).toEqual(ALIGNED);
    expect(probe.key).toBe(unwrap(verdictCacheKeyFor(sealed, DETERMINISTIC)));
  });
});

describe('a judge-hash change misses (spec 03 §6: a re-seated judge must re-decide)', () => {
  it('a new model id or a new prompt hash is a different key — the judge runs again', async () => {
    const cache = verdictCache();
    const { judge, calls } = counting();
    const sealed = seal(BREACH);

    // Same content, three different seats: deterministic, model, and the model re-prompted.
    await cache.through(DETERMINISTIC, judge)(sealed);
    await cache.through(MODEL, judge)(sealed);
    await cache.through(MODEL_REPROMPTED, judge)(sealed);
    expect(calls(), 'three distinct judge hashes → three misses').toBe(3);
    expect(cache.size()).toBe(3);

    // …and re-asking any one of them hits.
    await cache.through(MODEL, judge)(sealed);
    expect(calls()).toBe(3);
  });

  it('different hunks under the same seat also miss — the cache is content-addressed', async () => {
    const cache = verdictCache();
    const { judge, calls } = counting();
    const other = [hunk('src/core/y.ts', 1, [`+import { request } from '@octokit/request';`])];

    await cache.through(MODEL, judge)(seal(BREACH));
    await cache.through(MODEL, judge)(seal(other));
    expect(calls()).toBe(2);
    expect(cache.size()).toBe(2);
  });
});

describe('the backing is injectable', () => {
  it('a seeded in-memory backing pre-populates hits without ever running a judge', async () => {
    const sealed = seal(BREACH);
    const key = unwrap(verdictCacheKeyFor(sealed, MODEL));
    const backing = inMemoryVerdictCache([[key, ALIGNED]]);
    const cache = verdictCache(backing);
    const { judge, calls } = counting({ assertion: A, verdict: 'abstain' });

    const out = await cache.through(MODEL, judge)(sealed);
    expect(out).toEqual(ALIGNED); // the seeded ruling, not the judge's fresh abstain
    expect(calls()).toBe(0);
  });

  it('two caches over independent backings do not share entries', async () => {
    const a = verdictCache();
    const b = verdictCache();
    const { judge } = counting();
    await a.through(MODEL, judge)(seal(BREACH));
    expect(a.size()).toBe(1);
    expect(b.size()).toBe(0);
  });
});
