// Implements tests for: docs/adr/0003-judge-blindness.md (authorship is used ONLY downstream,
// in dispersion statistics at firing time), docs/spec/02-ledger.md §5 (dispersion decides
// direction), docs/vision.md (the bidirectional hinge).

import { describe, expect, it } from 'vitest';
import type { ContributingEvent } from '../../src/core/accumulator.js';
import {
  computeDispersion,
  shannonEntropy,
  toDispersionSnapshot,
  type EvidenceLocus,
} from '../../src/core/dispersion.js';
import { parseAccumulatorKey, parseEventId, type EventId } from '../../src/core/ids.js';
import { parseRepoPath } from '../../src/core/paths.js';
import { PROVISIONAL_DISPERSION_POLICY, classifyFiring } from '../../src/core/proposal.js';
import { unwrap } from '../../src/core/result.js';
import {
  actorId,
  addSurprise,
  blindCommit,
  compareSurprise,
  isSentencingValue,
  revealActor,
  revealSurprise,
  scaleSurprise,
  surprise,
  surpriseBelowFraction,
  surpriseFrom,
  surpriseReachesBudget,
  withSentencingWarrant,
  type SightedCommit,
} from '../../src/core/sentencing.js';
import { parseBudget, parsePrecision } from '../../src/core/assertion.js';
import { MILLIS_PER_DAY, parseCommitterTime } from '../../src/core/time.js';
import { parseCommitSha } from '../../src/core/ids.js';

const KEY = unwrap(parseAccumulatorKey('INV-007'));
const t = (s: string) => unwrap(parseCommitterTime(s));
const id = (n: number): EventId => unwrap(parseEventId(`sha256:${String(n).padStart(64, '0')}`));
const p = (s: string) => unwrap(parseRepoPath(s));
const read = (s: Parameters<typeof revealSurprise>[0]) =>
  withSentencingWarrant((w) => revealSurprise(s, w));

/**
 * Every declassifier now takes the warrant from its CALLER (INV-003). Obtaining one is the
 * deep value-import of `../../src/core/sentencing.js` above — the single greppable line
 * `scripts/check-inv003.ts` forbids under `src/judge/**` and `src/evidence/**`. A test file is
 * not under either, so it may hold one; that is the whole point of where the line is drawn.
 */
const WARRANT = withSentencingWarrant((w) => w);

describe('opaque sentencing values', () => {
  it('round-trips an actor id only through a warrant', () => {
    const a = actorId('amr');
    expect(withSentencingWarrant((w) => revealActor(a, w))).toBe('amr');
    expect(isSentencingValue(a)).toBe(true);
  });

  it('round-trips surprise only through a warrant', () => {
    expect(read(surprise(2.7))).toBeCloseTo(2.7, 12);
    expect(isSentencingValue(surprise(1))).toBe(true);
  });

  it('clamps negative and non-finite surprise to zero rather than throwing', () => {
    expect(read(surprise(-5))).toBe(0);
    expect(read(surprise(Number.NaN))).toBe(0);
    expect(read(surprise(Number.POSITIVE_INFINITY))).toBe(0);
  });

  it('is frozen, so it cannot be mutated through an alias', () => {
    const a = actorId('amr');
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('supports the whole leaky integrator WITHOUT ever holding a warrant', () => {
    // SEED-02 must be able to fold without unwrapping. This is that surface.
    const precision = unwrap(parsePrecision(0.9));
    const budget = unwrap(parseBudget(3));

    let acc = surprise(0);
    acc = addSurprise(acc, surpriseFrom(precision, 0.75)); // a breach
    expect(surpriseReachesBudget(acc, budget)).toBe(false);

    acc = addSurprise(acc, surpriseFrom(precision, 1)); // an entrenchment
    acc = addSurprise(acc, surpriseFrom(precision, 1));
    acc = addSurprise(acc, surpriseFrom(precision, 1));
    expect(surpriseReachesBudget(acc, budget)).toBe(true);

    const decayed = scaleSurprise(acc, 0.25);
    expect(surpriseReachesBudget(decayed, budget)).toBe(false);
    expect(surpriseBelowFraction(decayed, budget, 0.5)).toBe(true);
    expect(compareSurprise(decayed, acc)).toBe(-1);
  });

  it('surpriseFrom is exactly precision * severity', () => {
    expect(read(surpriseFrom(unwrap(parsePrecision(0.9)), 0.75))).toBeCloseTo(0.675, 12);
    expect(read(surpriseFrom(unwrap(parsePrecision(1)), 1))).toBe(1);
  });

  it('blindCommit is one-directional: identity is dropped, never recoverable from the result', () => {
    const sighted: SightedCommit = {
      sha: unwrap(parseCommitSha('9f2c1d')),
      committedAt: t('2026-07-21T14:03:00Z'),
      paths: [p('src/core/http.ts')],
      author: actorId('amr'),
      committer: actorId('ci-bot'),
    };
    const blind = blindCommit(sighted);
    expect(Object.keys(blind).sort()).toEqual(['committedAt', 'paths', 'sha']);
    expect((blind as unknown as Record<string, unknown>)['author']).toBeUndefined();
  });
});

describe('shannon entropy (spec 02 §5)', () => {
  it('is zero for a single category — one hand, one seam', () => {
    expect(shannonEntropy([5]).bits).toBe(0);
    expect(shannonEntropy([5]).normalized).toBe(0);
    expect(shannonEntropy([5]).distinct).toBe(1);
  });

  it('is zero for empty or all-zero input', () => {
    expect(shannonEntropy([])).toEqual({ bits: 0, normalized: 0, distinct: 0 });
    expect(shannonEntropy([0, 0])).toEqual({ bits: 0, normalized: 0, distinct: 0 });
  });

  it('is 1 bit for two equal categories, 2 bits for four', () => {
    expect(shannonEntropy([1, 1]).bits).toBeCloseTo(1, 12);
    expect(shannonEntropy([1, 1, 1, 1]).bits).toBeCloseTo(2, 12);
  });

  it('normalizes to 1 at a uniform distribution, regardless of cardinality', () => {
    expect(shannonEntropy([1, 1]).normalized).toBeCloseTo(1, 12);
    expect(shannonEntropy([3, 3, 3, 3, 3]).normalized).toBeCloseTo(1, 12);
  });

  it('is lower when one hand dominates', () => {
    expect(shannonEntropy([99, 1]).bits).toBeLessThan(shannonEntropy([50, 50]).bits);
  });

  it('drops non-positive weights', () => {
    expect(shannonEntropy([1, 1, 0, -3]).distinct).toBe(2);
  });
});

describe('computeDispersion is the sanctioned declassifier (ADR-0003)', () => {
  const contributing = (specs: { n: number; day: number; w: number }[]): ContributingEvent[] =>
    specs.map((s) => ({
      event: id(s.n),
      key: KEY,
      t: t(`2026-01-${String(s.day).padStart(2, '0')}T00:00:00Z`),
      verdict: 'drift' as const,
      rawWeight: s.w,
      residualWeight: surprise(s.w),
    }));

  const loci = (specs: { n: number; who: string; paths: string[] }[]): Map<EventId, EvidenceLocus> =>
    new Map(
      specs.map((s) => [
        id(s.n),
        { event: id(s.n), actor: actorId(s.who), paths: s.paths.map(p) },
      ]),
    );

  it('turns identity into an aggregate — no ActorId survives the computation', () => {
    const stats = unwrap(
      computeDispersion({
        key: KEY,
        contributing: contributing([
          { n: 1, day: 1, w: 1 },
          { n: 2, day: 2, w: 1 },
        ]),
        loci: loci([
          { n: 1, who: 'amr', paths: ['src/core/a.ts'] },
          { n: 2, who: 'other', paths: ['src/core/b.ts'] },
        ]),
        complianceCount: 0,
      }, WARRANT),
    );
    expect(JSON.stringify(stats)).not.toContain('amr');
    expect(stats.authorEntropy.distinct).toBe(2);
    expect(stats.authorEntropy.normalized).toBeCloseTo(1, 12);
  });

  it('one author hitting one seam yields zero entropy — the refactor signature', () => {
    const stats = unwrap(
      computeDispersion({
        key: KEY,
        contributing: contributing([
          { n: 1, day: 1, w: 1 },
          { n: 2, day: 2, w: 1 },
          { n: 3, day: 3, w: 1 },
        ]),
        loci: loci([
          { n: 1, who: 'amr', paths: ['src/core/http.ts'] },
          { n: 2, who: 'amr', paths: ['src/core/http.ts'] },
          { n: 3, who: 'amr', paths: ['src/core/http.ts'] },
        ]),
        complianceCount: 12,
      }, WARRANT),
    );
    expect(stats.authorEntropy.bits).toBe(0);
    expect(stats.pathEntropy.bits).toBe(0);
    expect(stats.complianceRatio).toBeCloseTo(12 / 15, 12);
    expect(classifyFiring(stats, PROVISIONAL_DISPERSION_POLICY)).toBe('refactor');
  });

  it('many hands, many seams, sustained yields the reprogram signature', () => {
    const specs = Array.from({ length: 6 }, (_, i) => ({ n: i + 1, day: 1 + i * 6, w: 1 }));
    const stats = unwrap(
      computeDispersion({
        key: KEY,
        contributing: specs.map((s) => ({
          event: id(s.n),
          key: KEY,
          t: t(new Date(Date.UTC(2026, 0, 1) + s.day * 20 * MILLIS_PER_DAY).toISOString().replace(/\.\d{3}Z$/, 'Z')),
          verdict: 'drift' as const,
          rawWeight: 1,
          residualWeight: surprise(1),
        })),
        loci: loci(
          specs.map((s) => ({ n: s.n, who: `dev${s.n}`, paths: [`src/core/m${s.n}.ts`] })),
        ),
        complianceCount: 1,
      }, WARRANT),
    );
    expect(stats.authorEntropy.distinct).toBe(6);
    expect(stats.authorEntropy.normalized).toBeCloseTo(1, 12);
    expect(stats.pathEntropy.normalized).toBeCloseTo(1, 12);
    expect(stats.timeSpread.spanMs).toBeGreaterThan(60 * MILLIS_PER_DAY);
    expect(classifyFiring(stats, PROVISIONAL_DISPERSION_POLICY)).toBe('reprogram');
  });

  it('splits an event weight evenly across the paths it touched', () => {
    const stats = unwrap(
      computeDispersion({
        key: KEY,
        contributing: contributing([{ n: 1, day: 1, w: 2 }]),
        loci: loci([{ n: 1, who: 'amr', paths: ['a/x.ts', 'a/y.ts'] }]),
        complianceCount: 0,
      }, WARRANT),
    );
    expect(stats.pathEntropy.distinct).toBe(2);
    expect(stats.pathEntropy.normalized).toBeCloseTo(1, 12);
  });

  it('FAILS LOUD on an unresolved locus rather than biasing toward refactor', () => {
    const r = computeDispersion({
      key: KEY,
      contributing: contributing([
        { n: 1, day: 1, w: 1 },
        { n: 2, day: 2, w: 1 },
      ]),
      loci: loci([{ n: 1, who: 'amr', paths: ['a.ts'] }]),
      complianceCount: 0,
    }, WARRANT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.code).toBe('unresolved-locus');
  });

  it('rejects an empty contributing set', () => {
    expect(
      computeDispersion({ key: KEY, contributing: [], loci: new Map(), complianceCount: 0 }, WARRANT).ok,
    ).toBe(false);
  });

  it('reports which weighting it used, so any figure is self-describing (Q-18)', () => {
    const input = {
      key: KEY,
      contributing: contributing([
        { n: 1, day: 1, w: 10 },
        { n: 2, day: 2, w: 1 },
      ]),
      loci: loci([
        { n: 1, who: 'a', paths: ['a.ts'] },
        { n: 2, who: 'b', paths: ['b.ts'] },
      ]),
      complianceCount: 0,
    };
    const residual = unwrap(computeDispersion({ ...input }, WARRANT));
    const uniform = unwrap(computeDispersion({ ...input, weighting: 'uniform' }, WARRANT));
    expect(residual.weighting).toBe('residual');
    expect(uniform.weighting).toBe('uniform');
    // Uniform treats a lopsided pair as two equal hands; residual does not.
    expect(uniform.authorEntropy.normalized).toBeGreaterThan(residual.authorEntropy.normalized);
  });

  it('compliance ratio is null when nothing was observed on either side', () => {
    const stats = unwrap(
      computeDispersion({
        key: KEY,
        contributing: contributing([{ n: 1, day: 1, w: 1 }]),
        loci: loci([{ n: 1, who: 'amr', paths: ['a.ts'] }]),
        complianceCount: 0,
      }, WARRANT),
    );
    expect(stats.complianceRatio).toBe(0);
    expect(toDispersionSnapshot(stats, WARRANT).compliance_ratio).toBe(0);
  });

  it('the snapshot carries only four numbers and no identity', () => {
    const stats = unwrap(
      computeDispersion({
        key: KEY,
        contributing: contributing([{ n: 1, day: 1, w: 1 }]),
        loci: loci([{ n: 1, who: 'amr', paths: ['a.ts'] }]),
        complianceCount: 3,
      }, WARRANT),
    );
    const snap = toDispersionSnapshot(stats, WARRANT);
    expect(Object.keys(snap).sort()).toEqual([
      'author_entropy',
      'compliance_ratio',
      'path_entropy',
      'time_spread',
    ]);
    expect(JSON.stringify(snap)).not.toContain('amr');
  });
});

describe('the bidirectional hinge (spec 02 §5, docs/vision.md)', () => {
  it('requires ALL FOUR conditions for reprogram; anything short is refactor', () => {
    const base = {
      key: KEY,
      authorEntropy: { bits: 3, normalized: 1, distinct: 6 },
      pathEntropy: { bits: 3, normalized: 1, distinct: 6 },
      timeSpread: {
        firstAt: t('2026-01-01T00:00:00Z'),
        lastAt: t('2026-06-01T00:00:00Z'),
        spanMs: 151 * MILLIS_PER_DAY,
        weightedStdDevMs: 0,
      },
      complianceRatio: 0.2,
      weighting: 'residual' as const,
      eventCount: 6,
    };
    expect(classifyFiring(base, PROVISIONAL_DISPERSION_POLICY)).toBe('reprogram');

    // One tight burst.
    expect(
      classifyFiring(
        { ...base, timeSpread: { ...base.timeSpread, spanMs: 2 * MILLIS_PER_DAY } },
        PROVISIONAL_DISPERSION_POLICY,
      ),
    ).toBe('refactor');
    // Too few independent hands.
    expect(
      classifyFiring(
        { ...base, authorEntropy: { bits: 1, normalized: 1, distinct: 2 } },
        PROVISIONAL_DISPERSION_POLICY,
      ),
    ).toBe('refactor');
    // One seam.
    expect(
      classifyFiring(
        { ...base, pathEntropy: { bits: 0, normalized: 0, distinct: 1 } },
        PROVISIONAL_DISPERSION_POLICY,
      ),
    ).toBe('refactor');
  });

  it('the provisional thresholds are exported as provisional, not baked into the classifier', () => {
    expect(PROVISIONAL_DISPERSION_POLICY.minDistinctAuthors).toBeGreaterThan(1);
    expect(PROVISIONAL_DISPERSION_POLICY.timeSpreadMinMs).toBeGreaterThan(0);
  });
});
