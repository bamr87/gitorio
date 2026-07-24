// Implements the acceptance for docs/spec/04-distillation.md §1 (epoch segmentation) / SEED-04
// deliverable 2: a clear multi-signal break yields the expected boundary and a flat series a single
// epoch; >=2 epochs on a manifest-upheaval-between-two-stable-runs fixture; the detector is
// pluggable; and segmentation is deterministic. All PURE — no git, no fs, no model, no network.

import { describe, expect, it } from 'vitest';

import { parseCommitSha, parseEpochId, type CommitSha } from '../../src/core/ids.js';
import { committerTimeFromEpochMillis, type CommitterTime } from '../../src/core/time.js';
import { unwrap } from '../../src/core/result.js';

import {
  DEFAULT_SEGMENT_CONFIG,
  SIGNAL_DIRECTORY_STRUCTURE,
  SIGNAL_DOC_CHURN,
  SIGNAL_FILE_CHURN,
  SIGNAL_MANIFEST_UPHEAVAL,
  epochBoundaries,
  epochById,
  makeSignalSeries,
  projectSignals,
  segment,
  segmentFactBase,
  zScoreBreakFinder,
  type ChangePointDetector,
  type CommitStatPoint,
  type DetectedBreak,
  type FactBaseStatsView,
  type SignalName,
  type SignalPoint,
  type SignalSeries,
} from '../../src/distill/epochs.js';

// ---------------------------------------------------------------------------
// Builders — deterministic synthetic shas / times so tests read like data.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const BASE_MS = Date.parse('2022-01-01T00:00:00Z');

function shaAt(i: number): CommitSha {
  return unwrap(parseCommitSha(i.toString(16).padStart(8, '0')));
}

function timeAt(i: number): CommitterTime {
  return unwrap(committerTimeFromEpochMillis(BASE_MS + i * DAY_MS));
}

/** Turn per-commit channel rows into an oldest-first SignalSeries. */
function seriesFrom(rows: readonly Readonly<Record<SignalName, number>>[]): SignalSeries {
  const points: SignalPoint[] = rows.map((signals, i) => ({
    sha: shaAt(i),
    committerTime: timeAt(i),
    signals,
  }));
  return makeSignalSeries(points);
}

function stat(
  i: number,
  filesChanged: number,
  manifestChurn = 0,
  docFilesChanged = 0,
  directoryEvents = 0,
): CommitStatPoint {
  return { sha: shaAt(i), committerTime: timeAt(i), filesChanged, manifestChurn, docFilesChanged, directoryEvents };
}

// ---------------------------------------------------------------------------
// 1. Clear break -> expected boundary; flat series -> single epoch.
// ---------------------------------------------------------------------------

describe('z-score break finder', () => {
  it('finds the expected boundary on a clear multi-signal spike', () => {
    // 20 commits; a structural upheaval at index 10 spikes the manifest AND doc channels while
    // file-churn stays flat. Expect two epochs split exactly at the spike.
    const rows = Array.from({ length: 20 }, (_v, i) => ({
      [SIGNAL_FILE_CHURN]: 3,
      [SIGNAL_MANIFEST_UPHEAVAL]: i === 10 ? 40 : 0,
      [SIGNAL_DOC_CHURN]: i === 10 ? 5 : 0,
      [SIGNAL_DIRECTORY_STRUCTURE]: 0,
    }));
    const seg = segment(seriesFrom(rows));

    expect(seg.epochs).toHaveLength(2);
    expect(seg.epochs[0]?.id).toBe('e0');
    expect(seg.epochs[1]?.id).toBe('e1');
    expect(seg.epochs[0]?.startIndex).toBe(0);
    expect(seg.epochs[0]?.endIndex).toBe(9);
    expect(seg.epochs[1]?.startIndex).toBe(10);
    expect(seg.epochs[1]?.endIndex).toBe(19);
    // The boundary commit is the spike commit, and the triggering signals are audit-visible.
    expect(seg.epochs[1]?.startSha).toBe(shaAt(10));
    const opener = seg.epochs[1]?.openedBy;
    expect(opener).not.toBeNull();
    const triggered = (opener as DetectedBreak).triggers.map((t) => t.signal).sort();
    expect(triggered).toEqual([SIGNAL_DOC_CHURN, SIGNAL_MANIFEST_UPHEAVAL].sort());
  });

  it('yields a single epoch on a flat series (zero variance -> no break)', () => {
    const rows = Array.from({ length: 15 }, () => ({
      [SIGNAL_FILE_CHURN]: 4,
      [SIGNAL_MANIFEST_UPHEAVAL]: 0,
      [SIGNAL_DOC_CHURN]: 0,
      [SIGNAL_DIRECTORY_STRUCTURE]: 0,
    }));
    const seg = segment(seriesFrom(rows));

    expect(seg.epochs).toHaveLength(1);
    expect(seg.epochs[0]?.id).toBe('e0');
    expect(seg.epochs[0]?.startIndex).toBe(0);
    expect(seg.epochs[0]?.endIndex).toBe(14);
    expect(seg.epochs[0]?.openedBy).toBeNull();
    // A flat epoch has zero intrinsic volatility and full learning weight.
    expect(seg.epochs[0]?.volatility).toBe(0);
    expect(seg.epochs[0]?.recencyWeight).toBe(1);
  });

  it('yields a single epoch on an all-zero series and handles a one-commit series', () => {
    const zero = segment(seriesFrom(Array.from({ length: 8 }, () => ({ [SIGNAL_FILE_CHURN]: 0 }))));
    expect(zero.epochs).toHaveLength(1);

    const one = segment(seriesFrom([{ [SIGNAL_FILE_CHURN]: 99 }]));
    expect(one.epochs).toHaveLength(1);
    expect(one.epochs[0]?.startIndex).toBe(0);
    expect(one.epochs[0]?.endIndex).toBe(0);
  });

  it('returns an empty segmentation with null final epoch for an empty series', () => {
    const seg = segment(makeSignalSeries([]));
    expect(seg.epochs).toEqual([]);
    expect(seg.finalEpoch).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. >=2 epochs on a fact-base fixture: manifest upheaval between two stable runs.
// ---------------------------------------------------------------------------

describe('segmentFactBase', () => {
  it('finds >=2 epochs across a dependency-manifest upheaval between two stable runs', () => {
    const commits: CommitStatPoint[] = [];
    // Stable run A: routine 3-file commits, no manifest churn.
    for (let i = 0; i < 10; i++) commits.push(stat(i, 3));
    // The upheaval: a dependency-manifest rewrite (25 deltas), a directory reshuffle, a doc rewrite.
    commits.push(stat(10, 30, 25, 2, 3));
    // Stable run B: routine again.
    for (let i = 11; i < 21; i++) commits.push(stat(i, 3));

    const stats: FactBaseStatsView = { commits };
    const seg = segmentFactBase(stats);

    expect(seg.epochs.length).toBeGreaterThanOrEqual(2);
    // The boundary sits at the upheaval commit.
    const boundary = seg.epochs[1]?.startSha;
    expect(boundary).toBe(shaAt(10));
    // Provenance of the break names the manifest channel among its triggers.
    const triggers = (seg.epochs[1]?.openedBy as DetectedBreak).triggers.map((t) => t.signal);
    expect(triggers).toContain(SIGNAL_MANIFEST_UPHEAVAL);

    // epochBoundaries exposes one snapshot point per epoch for the boundary-dependent fact miners.
    const bounds = epochBoundaries(seg);
    expect(bounds).toHaveLength(seg.epochs.length);
    expect(bounds[0]).toEqual({ epoch: 'e0', at: shaAt(0) });
    expect(bounds[1]).toEqual({ epoch: 'e1', at: shaAt(10) });
  });

  it('projectSignals maps the four fact-base counts onto the four named channels', () => {
    const series = projectSignals({ commits: [stat(0, 7, 4, 2, 1)] });
    expect(series.channels).toEqual(
      [SIGNAL_DIRECTORY_STRUCTURE, SIGNAL_DOC_CHURN, SIGNAL_FILE_CHURN, SIGNAL_MANIFEST_UPHEAVAL].sort(),
    );
    const p = series.points[0];
    expect(p?.signals[SIGNAL_FILE_CHURN]).toBe(7);
    expect(p?.signals[SIGNAL_MANIFEST_UPHEAVAL]).toBe(4);
    expect(p?.signals[SIGNAL_DOC_CHURN]).toBe(2);
    expect(p?.signals[SIGNAL_DIRECTORY_STRUCTURE]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Pluggability: a trivial injected detector is honored over the default.
// ---------------------------------------------------------------------------

describe('pluggable detector', () => {
  // A flat series the default z-score detector would leave as a SINGLE epoch...
  const flat = seriesFrom(Array.from({ length: 10 }, () => ({ [SIGNAL_FILE_CHURN]: 5 })));

  it('is a single epoch under the default detector', () => {
    expect(segment(flat).epochs).toHaveLength(1);
  });

  it('honors an injected detector that breaks at the midpoint', () => {
    const midpointDetector: ChangePointDetector = {
      name: 'midpoint-test',
      detect(series) {
        const i = Math.floor(series.points.length / 2);
        const p = series.points[i];
        if (p === undefined) return [];
        return [{ index: i, sha: p.sha, committerTime: p.committerTime, triggers: [], score: 99 }];
      },
    };
    const seg = segment(flat, { detector: midpointDetector });
    expect(seg.detector).toBe('midpoint-test');
    expect(seg.epochs).toHaveLength(2);
    expect(seg.epochs[1]?.startIndex).toBe(5);
  });

  it('honors an injected detector that never breaks', () => {
    const neverDetector: ChangePointDetector = { name: 'never', detect: () => [] };
    const seg = segment(seriesFrom(Array.from({ length: 6 }, (_v, i) => ({ [SIGNAL_FILE_CHURN]: i }))), {
      detector: neverDetector,
    });
    expect(seg.detector).toBe('never');
    expect(seg.epochs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Determinism: same signal -> same epochs.
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces byte-identical epochs for the same series and config', () => {
    const rows = [
      ...Array.from({ length: 6 }, () => ({ [SIGNAL_FILE_CHURN]: 2, [SIGNAL_MANIFEST_UPHEAVAL]: 0 })),
      { [SIGNAL_FILE_CHURN]: 30, [SIGNAL_MANIFEST_UPHEAVAL]: 20 },
      ...Array.from({ length: 6 }, () => ({ [SIGNAL_FILE_CHURN]: 2, [SIGNAL_MANIFEST_UPHEAVAL]: 0 })),
      { [SIGNAL_FILE_CHURN]: 28, [SIGNAL_MANIFEST_UPHEAVAL]: 18 },
      ...Array.from({ length: 6 }, () => ({ [SIGNAL_FILE_CHURN]: 2, [SIGNAL_MANIFEST_UPHEAVAL]: 0 })),
    ];
    const a = segment(seriesFrom(rows));
    const b = segment(seriesFrom(rows));
    expect(JSON.stringify(a.epochs)).toBe(JSON.stringify(b.epochs));
  });
});

// ---------------------------------------------------------------------------
// Recency asymmetry + volatility-as-learning-rate (spec 04 §1, §3).
//
// The learning-rate MATH is exercised through an injected detector with controlled break scores:
// the global z-score baseline couples two spikes' variances, so driving weight arithmetic with the
// real detector would be testing the detector, not the arithmetic. The z-score detector is exercised
// on clean single-break real signals elsewhere in this file.
// ---------------------------------------------------------------------------

/** A detector that emits breaks at fixed (index, score) pairs — for testing segment() policy exactly. */
function fixedBreaks(name: string, specs: readonly { index: number; score: number }[]): ChangePointDetector {
  return {
    name,
    detect(series) {
      const out: DetectedBreak[] = [];
      for (const s of specs) {
        const p = series.points[s.index];
        if (p === undefined) continue;
        out.push({ index: s.index, sha: p.sha, committerTime: p.committerTime, triggers: [], score: s.score });
      }
      return out;
    },
  };
}

describe('recency asymmetry and learning rate', () => {
  const flat18 = seriesFrom(Array.from({ length: 18 }, () => ({ [SIGNAL_FILE_CHURN]: 1 })));
  // Two upheavals: index 5 at strength 6, index 12 at strength 9 (the more recent, stronger break).
  const twoBreaks = fixedBreaks('two-breaks', [
    { index: 5, score: 6 },
    { index: 12, score: 9 },
  ]);

  it('marks exactly one final epoch — the most recent — with full weight', () => {
    const seg = segment(flat18, { detector: twoBreaks });
    expect(seg.epochs).toHaveLength(3);
    const finals = seg.epochs.filter((e) => e.isFinal);
    expect(finals).toHaveLength(1);
    expect(seg.finalEpoch).not.toBeNull();
    expect(seg.finalEpoch?.id).toBe('e2');
    expect(seg.finalEpoch?.id).toBe(seg.epochs[seg.epochs.length - 1]?.id);
    expect(seg.finalEpoch?.isFinal).toBe(true);
    expect(seg.finalEpoch?.recencyWeight).toBe(1);
  });

  it('discounts older epochs steeply and compounds across upheavals (exact math)', () => {
    // λ=0.5, zThreshold=3. e2=1; e1 = exp(-0.5·(9-3)); e0 = e1·exp(-0.5·(6-3)).
    const seg = segment(flat18, { detector: twoBreaks });
    const w = seg.epochs.map((e) => e.recencyWeight);
    const e1Expected = Math.exp(-0.5 * (9 - 3));
    const e0Expected = e1Expected * Math.exp(-0.5 * (6 - 3));
    expect(w[2]).toBe(1);
    expect(w[1]).toBeCloseTo(e1Expected, 10);
    expect(w[0]).toBeCloseTo(e0Expected, 10);
    // Monotonically non-decreasing toward the present, and older-than-final is strictly < 1.
    expect(w[1] as number).toBeGreaterThan(w[0] as number);
    expect(w[1] as number).toBeLessThan(1);
  });

  it('disables discounting when volatilityDecay is 0 (all weights 1)', () => {
    const seg = segment(flat18, {
      detector: twoBreaks,
      config: { ...DEFAULT_SEGMENT_CONFIG, volatilityDecay: 0 },
    });
    expect(seg.epochs).toHaveLength(3);
    for (const e of seg.epochs) expect(e.recencyWeight).toBe(1);
  });

  it('exposes intrinsic volatility per epoch (a turbulent epoch is more volatile than a calm one)', () => {
    // Calm run (constant file-churn) then a clean manifest-spike break into a turbulent run.
    const rows: Record<SignalName, number>[] = [];
    for (let i = 0; i < 6; i++) rows.push({ [SIGNAL_FILE_CHURN]: 4, [SIGNAL_MANIFEST_UPHEAVAL]: 0 });
    rows.push({ [SIGNAL_FILE_CHURN]: 30, [SIGNAL_MANIFEST_UPHEAVAL]: 50 }); // clean single-spike break
    for (const fc of [40, 50, 45, 55, 42, 48, 44, 52]) {
      rows.push({ [SIGNAL_FILE_CHURN]: fc, [SIGNAL_MANIFEST_UPHEAVAL]: 0 });
    }
    const seg = segment(seriesFrom(rows));
    expect(seg.epochs).toHaveLength(2);
    expect(seg.epochs[1]?.startIndex).toBe(6);
    const calm = seg.epochs[0];
    const turbulent = seg.epochs[seg.epochs.length - 1];
    expect(calm?.volatility).toBe(0); // constant aggregate -> CoV 0
    expect(turbulent?.volatility as number).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Debounce + accessors.
// ---------------------------------------------------------------------------

describe('debounce and accessors', () => {
  it('merges two adjacent candidate breaks under minEpochLength, keeping the stronger', () => {
    // One upheaval bleeding across two commits: candidate breaks at index 8 (score 5) and 9 (score 9).
    const flat = seriesFrom(Array.from({ length: 18 }, () => ({ [SIGNAL_FILE_CHURN]: 1 })));
    const bleed = fixedBreaks('bleed', [
      { index: 8, score: 5 },
      { index: 9, score: 9 },
    ]);
    const seg = segment(flat, { detector: bleed, config: { ...DEFAULT_SEGMENT_CONFIG, minEpochLength: 3 } });
    // Only one boundary survives the debounce -> exactly two epochs.
    expect(seg.epochs).toHaveLength(2);
    // The stronger candidate (index 9) becomes the boundary; the weaker adjacent one is suppressed.
    expect(seg.epochs[1]?.startIndex).toBe(9);
    // Both candidates remain visible for audit.
    expect(seg.candidateBreaks.map((b) => b.index).sort((a, b) => a - b)).toEqual([8, 9]);
  });

  it('epochById resolves a known epoch and returns null for an unknown one', () => {
    const seg = segment(seriesFrom(Array.from({ length: 4 }, () => ({ [SIGNAL_FILE_CHURN]: 1 }))));
    expect(epochById(seg, unwrap(parseEpochId('e0')))?.id).toBe('e0');
    expect(epochById(seg, unwrap(parseEpochId('e9')))).toBeNull();
  });

  it('the default detector is the z-score break finder', () => {
    expect(zScoreBreakFinder.name).toBe('zscore-v1');
    expect(segment(seriesFrom([{ [SIGNAL_FILE_CHURN]: 1 }])).detector).toBe('zscore-v1');
  });
});
