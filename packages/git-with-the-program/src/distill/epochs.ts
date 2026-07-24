// Implements: docs/spec/04-distillation.md §1 (epoch segmentation — "boundaries aren't dates":
// change-point detection on the repo's own statistics; volatility sets the learning rate) and
// §3 (recency asymmetry — the FINAL epoch writes the statute; earlier epochs contribute only
// precedents and trajectory). SEED-04 deliverable 2.
//
// This module is PURE: no fs, no git, no model, no clock. It runs over an ordered multi-signal
// series and returns an ordered list of epochs with boundary SHAs and the triggering signals
// (fully auditable). The change-point detector is PLUGGABLE (ChangePointDetector); the default is
// a simple multi-signal z-score break finder, which spec 04 §1 / SEED-04 name as acceptable for v1.
//
// HANDOFF (Wire agent): the fact base (src/distill/factbase.ts, being written concurrently) is
// consumed ONLY through the minimal structural view `FactBaseStatsView` below — the exact per-commit
// stats this segmenter reads, and nothing else. When factbase.ts lands, wire its FactBase into a
// `FactBaseStatsView` (or have it satisfy this shape directly) and delete the note. Nothing here
// imports factbase.ts, so pass one and epoch segmentation compile and test independently.

import type { CommitSha, EpochId } from '../core/ids.js';
import { parseEpochId } from '../core/ids.js';
import type { CommitterTime } from '../core/time.js';
import { unwrap } from '../core/result.js';

// ---------------------------------------------------------------------------
// The multi-signal series (the segmenter's whole input surface)
// ---------------------------------------------------------------------------

/**
 * A named structural-signal channel, e.g. `manifest-upheaval`. Channels are compared and
 * displayed by name; the standard four are the SIGNAL_* constants below, but the detector
 * runs over whatever channels the series actually carries, so a caller may add its own
 * (CODEOWNERS shifts, CI-config overhauls — spec 04 §1) without touching this module.
 */
export type SignalName = string;

/**
 * One position in the ordered walk: a commit and the magnitudes of each structural signal AT
 * that commit. Signals are non-negative magnitudes (a churn count, a delta count); a structural
 * break is an UPWARD spike, never a quiet commit, which is why the detector only reacts to
 * positive deviations.
 */
export interface SignalPoint {
  readonly sha: CommitSha;
  readonly committerTime: CommitterTime;
  readonly signals: Readonly<Record<SignalName, number>>;
}

/**
 * The ordered (OLDEST-FIRST) multi-signal series the detector runs over. `channels` is the sorted
 * union of every channel name present, so detectors iterate in a fixed, deterministic order.
 */
export interface SignalSeries {
  readonly points: readonly SignalPoint[];
  readonly channels: readonly SignalName[];
}

/** Builds a SignalSeries from points, computing the sorted channel union. Pure. */
export function makeSignalSeries(points: readonly SignalPoint[]): SignalSeries {
  const seen = new Set<SignalName>();
  for (const p of points) {
    for (const ch of Object.keys(p.signals)) seen.add(ch);
  }
  const channels = [...seen].sort();
  return { points, channels };
}

// ---------------------------------------------------------------------------
// Fact-base projection — the structural signals spec 04 §1 names
// ---------------------------------------------------------------------------

/** Churn-spike channel: total files touched at a commit. */
export const SIGNAL_FILE_CHURN = 'file-churn';
/** Doc-rewrite channel: doc files (README / ADR / CONTRIBUTING) touched at a commit. */
export const SIGNAL_DOC_CHURN = 'doc-churn';
/** Dependency-manifest-upheaval channel: dependency deltas at a commit. */
export const SIGNAL_MANIFEST_UPHEAVAL = 'manifest-upheaval';
/** Directory-structure channel: directory create / rename / delete events at a commit. */
export const SIGNAL_DIRECTORY_STRUCTURE = 'directory-structure';

/**
 * The four channels spec 04 §1 lists as structural-break signals (doc rewrites, manifest
 * upheavals, renames, churn spikes). A named list so widening what the segmenter treats as a
 * signal is a reviewable edit to a constant (same discipline as imports.ts FORGE_MODULE_PATTERNS).
 */
export const DEFAULT_SIGNAL_CHANNELS = [
  SIGNAL_FILE_CHURN,
  SIGNAL_DOC_CHURN,
  SIGNAL_MANIFEST_UPHEAVAL,
  SIGNAL_DIRECTORY_STRUCTURE,
] as const;

/**
 * MINIMAL structural view of the fact base this segmenter consumes — the per-commit stats, and
 * NOTHING author-bearing (INV-003 stays satisfied: no AuthorHandle crosses into segmentation).
 * HANDOFF: reconcile with src/distill/factbase.ts FactBase (Wire agent). See file header.
 */
export interface FactBaseStatsView {
  /** Oldest-first commit walk. */
  readonly commits: readonly CommitStatPoint[];
}

/** One commit's structural counts — the raw material `projectSignals` turns into a SignalPoint. */
export interface CommitStatPoint {
  readonly sha: CommitSha;
  readonly committerTime: CommitterTime;
  /** Total files touched (churn magnitude). */
  readonly filesChanged: number;
  /** Doc files touched (README / ADR / CONTRIBUTING). */
  readonly docFilesChanged: number;
  /** Dependency-manifest deltas at this commit (upheaval magnitude). */
  readonly manifestChurn: number;
  /** Directory create / rename / delete events at this commit. */
  readonly directoryEvents: number;
}

/**
 * Projects the fact-base per-commit stats into the four-channel signal series (spec 04 §1).
 * Pure and total: the segmenter never re-derives signals, it only reads this projection.
 */
export function projectSignals(stats: FactBaseStatsView): SignalSeries {
  const points: SignalPoint[] = stats.commits.map((c) => ({
    sha: c.sha,
    committerTime: c.committerTime,
    signals: {
      [SIGNAL_FILE_CHURN]: c.filesChanged,
      [SIGNAL_DOC_CHURN]: c.docFilesChanged,
      [SIGNAL_MANIFEST_UPHEAVAL]: c.manifestChurn,
      [SIGNAL_DIRECTORY_STRUCTURE]: c.directoryEvents,
    },
  }));
  return makeSignalSeries(points);
}

// ---------------------------------------------------------------------------
// Detector contract (pluggable) and configuration
// ---------------------------------------------------------------------------

/** One channel's contribution to a detected break, with the statistics that justified it. */
export interface SignalTrigger {
  readonly signal: SignalName;
  readonly value: number;
  readonly mean: number;
  readonly stddev: number;
  /** Standardized deviation of `value` from the channel baseline; positive = an upward spike. */
  readonly z: number;
}

/**
 * A candidate change-point the detector proposes: the index at which a NEW epoch would begin,
 * the channels that crossed threshold there (auditable), and an aggregate strength `score`.
 * `index` is always >= 1 (index 0 is the natural start of the first epoch, never a break).
 */
export interface DetectedBreak {
  readonly index: number;
  readonly sha: CommitSha;
  readonly committerTime: CommitterTime;
  readonly triggers: readonly SignalTrigger[];
  /** Break strength — the max trigger z-score. Drives debounce priority and the learning rate. */
  readonly score: number;
}

/**
 * The pluggable seam. A detector proposes RAW candidate breaks over the series; `segment` applies
 * the uniform debounce (minEpochLength) and builds epochs, so alternate detectors stay trivial.
 * `name` is recorded in the Segmentation for audit ("which detector drew these boundaries").
 */
export interface ChangePointDetector {
  readonly name: string;
  detect(series: SignalSeries, config: SegmentConfig): readonly DetectedBreak[];
}

export interface SegmentConfig {
  /** z-score a channel must reach to count as a break trigger. Higher = fewer, sharper breaks. */
  readonly zThreshold: number;
  /**
   * Minimum commits between two consecutive boundaries (index 0 counts as a boundary). Debounces a
   * single upheaval that bleeds across adjacent commits; the strongest candidate in a window wins.
   * The FINAL epoch is exempt — a repo fresh off an upheaval legitimately has a short current epoch.
   */
  readonly minEpochLength: number;
  /** Channels to consider; empty = every channel present in the series. */
  readonly channels: readonly SignalName[];
  /**
   * Learning-rate decay λ (spec 04 §1: "volatility sets the learning rate"). The recency weight of
   * an epoch is discounted by exp(-λ · (breakScore − zThreshold)) across each later upheaval, so a
   * strong break steeply discounts everything before it. 0 disables recency discounting.
   */
  readonly volatilityDecay: number;
}

/**
 * Runnable defaults. zThreshold 3 ≈ a 3σ structural spike; minEpochLength 2 merges a two-commit
 * upheaval; volatilityDecay 0.5 gives ~8% weight to the epoch behind a 5σ-over-threshold break.
 */
export const DEFAULT_SEGMENT_CONFIG: SegmentConfig = {
  zThreshold: 3,
  minEpochLength: 2,
  channels: [],
  volatilityDecay: 0.5,
};

// ---------------------------------------------------------------------------
// The default detector: a multi-signal z-score break finder
// ---------------------------------------------------------------------------

const EPSILON = 1e-9;

function resolveChannels(series: SignalSeries, config: SegmentConfig): readonly SignalName[] {
  if (config.channels.length === 0) return series.channels;
  const present = new Set(series.channels);
  return [...config.channels].filter((c) => present.has(c)).sort();
}

interface ChannelStats {
  readonly values: readonly number[];
  readonly mean: number;
  readonly stddev: number;
}

function channelStats(series: SignalSeries, channel: SignalName): ChannelStats {
  const values = series.points.map((p) => p.signals[channel] ?? 0);
  const n = values.length;
  if (n === 0) return { values, mean: 0, stddev: 0 };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let varAcc = 0;
  for (const v of values) varAcc += (v - mean) * (v - mean);
  const stddev = Math.sqrt(varAcc / n); // population stddev: a single sample has stddev 0 -> no break
  return { values, mean, stddev };
}

/**
 * The v1 detector. For each channel it standardizes the per-commit magnitude against the channel's
 * own mean/stddev and flags an UPWARD spike (z >= zThreshold) as a break trigger. Spike-oriented by
 * design: manifest upheavals, doc rewrites and wholesale directory renames all present as a single
 * high-churn commit, which is exactly a spike. Zero-variance channels (a flat or all-zero series)
 * produce no triggers, so a flat series yields a single epoch. A level-shift-oriented detector is a
 * future plug behind the same ChangePointDetector seam.
 */
export const zScoreBreakFinder: ChangePointDetector = {
  name: 'zscore-v1',
  detect(series, config): readonly DetectedBreak[] {
    const points = series.points;
    if (points.length < 2) return [];
    const channels = resolveChannels(series, config);
    const stats = new Map<SignalName, ChannelStats>();
    for (const ch of channels) stats.set(ch, channelStats(series, ch));

    const breaks: DetectedBreak[] = [];
    // index 0 is the natural start of epoch 0, never a break.
    for (let i = 1; i < points.length; i++) {
      const triggers: SignalTrigger[] = [];
      for (const ch of channels) {
        const s = stats.get(ch);
        if (s === undefined || s.stddev <= EPSILON) continue;
        const value = s.values[i] ?? 0;
        const z = (value - s.mean) / s.stddev;
        if (z >= config.zThreshold) {
          triggers.push({ signal: ch, value, mean: s.mean, stddev: s.stddev, z });
        }
      }
      if (triggers.length === 0) continue;
      triggers.sort((a, b) => b.z - a.z || (a.signal < b.signal ? -1 : 1));
      const point = points[i];
      if (point === undefined) continue;
      const score = triggers[0]?.z ?? 0;
      breaks.push({
        index: i,
        sha: point.sha,
        committerTime: point.committerTime,
        triggers,
        score,
      });
    }
    return breaks;
  },
};

// ---------------------------------------------------------------------------
// Epochs and segmentation output
// ---------------------------------------------------------------------------

export interface Epoch {
  readonly id: EpochId;
  /** First commit of the epoch — the boundary at which boundary-dependent snapshots are taken. */
  readonly startSha: CommitSha;
  readonly startTime: CommitterTime;
  /** Last commit of the epoch (inclusive). */
  readonly endSha: CommitSha;
  readonly endTime: CommitterTime;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly commitCount: number;
  /** The break that OPENED this epoch, with its triggering signals; null for the first epoch. */
  readonly openedBy: DetectedBreak | null;
  /**
   * Intrinsic volatility of this epoch — the coefficient of variation (stddev/mean) of the
   * per-commit aggregate signal magnitude within the epoch. How turbulent the epoch was on its own.
   */
  readonly volatility: number;
  /**
   * Recency-discounted learning weight in (0, 1], relative to the final epoch (which is 1.0). This
   * is the exposed "learning rate" of spec 04 §1: synthesis multiplies an epoch's evidence by this
   * so older epochs are discounted steeply after an upheaval. Compounds exp(-λ·excess) across every
   * later break (see SegmentConfig.volatilityDecay).
   */
  readonly recencyWeight: number;
  /** True only for the most recent epoch — recency asymmetry (spec 04 §3). */
  readonly isFinal: boolean;
}

export interface Segmentation {
  /** Epochs oldest-first; the last element is the final (current) epoch. */
  readonly epochs: readonly Epoch[];
  /** Name of the detector that drew these boundaries (audit). */
  readonly detector: string;
  readonly config: SegmentConfig;
  /** Every candidate break the detector proposed, retained for audit even after debounce dropped some. */
  readonly candidateBreaks: readonly DetectedBreak[];
  /** The final (current) epoch, or null for an empty series. Recency asymmetry made explicit. */
  readonly finalEpoch: Epoch | null;
}

export interface SegmentOptions {
  readonly detector?: ChangePointDetector;
  readonly config?: SegmentConfig;
}

function epochIdAt(ordinal: number): EpochId {
  // ordinal >= 0 always matches ^e[0-9]+$; unwrap can never throw here.
  return unwrap(parseEpochId(`e${ordinal}`));
}

/** stddev/mean of a series, guarded: an empty or zero-mean epoch has volatility 0. */
function coefficientOfVariation(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  if (Math.abs(mean) <= EPSILON) return 0;
  let varAcc = 0;
  for (const v of values) varAcc += (v - mean) * (v - mean);
  return Math.sqrt(varAcc / n) / mean;
}

/**
 * Segment a signal series into epochs. Pure and deterministic: the same series and config always
 * yield byte-identical epochs. Runs the (pluggable) detector, debounces its candidates by strength
 * under minEpochLength, builds contiguous epochs, computes per-epoch volatility, and derives the
 * recency-discounted learning weight (final epoch = 1.0, older epochs discounted across each later
 * upheaval — spec 04 §1). An empty series yields no epochs; a series with no detected break yields
 * exactly one epoch spanning the whole range.
 */
export function segment(series: SignalSeries, opts: SegmentOptions = {}): Segmentation {
  const detector = opts.detector ?? zScoreBreakFinder;
  const config = opts.config ?? DEFAULT_SEGMENT_CONFIG;
  const points = series.points;
  const n = points.length;

  const candidateBreaks = detector.detect(series, config);

  if (n === 0) {
    return { epochs: [], detector: detector.name, config, candidateBreaks, finalEpoch: null };
  }

  const channels = resolveChannels(series, config);
  const minLen = Math.max(1, Math.trunc(config.minEpochLength));

  // Debounce: index 0 is a pre-seeded boundary. Greedily admit the strongest candidate breaks such
  // that every boundary is >= minLen commits from all already-admitted boundaries. Deterministic:
  // score desc, then index asc. The final epoch's length is intentionally NOT constrained.
  const byStrength = [...candidateBreaks]
    .filter((b) => b.index >= 1 && b.index < n)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const boundaryIndices: number[] = [0];
  const admittedBreaks = new Map<number, DetectedBreak>();
  for (const b of byStrength) {
    let ok = true;
    for (const bi of boundaryIndices) {
      if (Math.abs(b.index - bi) < minLen) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    boundaryIndices.push(b.index);
    admittedBreaks.set(b.index, b);
  }
  boundaryIndices.sort((a, b) => a - b);

  // Build contiguous epoch intervals [start, end] from the sorted boundaries.
  const intervals: { start: number; end: number }[] = [];
  for (let j = 0; j < boundaryIndices.length; j++) {
    const start = boundaryIndices[j] ?? 0;
    const end = (j + 1 < boundaryIndices.length ? (boundaryIndices[j + 1] ?? n) : n) - 1;
    intervals.push({ start, end });
  }

  const lastEpochIndex = intervals.length - 1;

  // First pass: everything except recencyWeight (which needs a backward sweep over openedBy).
  const drafts = intervals.map((iv, j) => {
    const startPoint = points[iv.start];
    const endPoint = points[iv.end];
    // start/end indices are always in range by construction.
    const startSha = (startPoint as SignalPoint).sha;
    const endSha = (endPoint as SignalPoint).sha;
    const openedBy = admittedBreaks.get(iv.start) ?? null;
    const aggregate: number[] = [];
    for (let i = iv.start; i <= iv.end; i++) {
      const p = points[i];
      if (p === undefined) continue;
      let mag = 0;
      for (const ch of channels) mag += p.signals[ch] ?? 0;
      aggregate.push(mag);
    }
    return {
      id: epochIdAt(j),
      startSha,
      startTime: (startPoint as SignalPoint).committerTime,
      endSha,
      endTime: (endPoint as SignalPoint).committerTime,
      startIndex: iv.start,
      endIndex: iv.end,
      commitCount: iv.end - iv.start + 1,
      openedBy,
      volatility: coefficientOfVariation(aggregate),
      isFinal: j === lastEpochIndex,
    };
  });

  // Recency weight: final epoch = 1.0; each earlier epoch discounted by the compounded upheaval
  // strength of the breaks between it and the present (spec 04 §1 — volatility sets the learning
  // rate, discount older epochs steeply after an upheaval).
  const weights = new Array<number>(drafts.length).fill(1);
  for (let j = drafts.length - 2; j >= 0; j--) {
    const opener = drafts[j + 1]?.openedBy ?? null;
    const excess = opener === null ? 0 : Math.max(0, opener.score - config.zThreshold);
    const discount = Math.exp(-config.volatilityDecay * excess);
    weights[j] = (weights[j + 1] ?? 1) * discount;
  }

  const epochs: Epoch[] = drafts.map((d, j) => ({ ...d, recencyWeight: weights[j] ?? 1 }));
  const finalEpoch = epochs.length > 0 ? (epochs[epochs.length - 1] ?? null) : null;

  return { epochs, detector: detector.name, config, candidateBreaks, finalEpoch };
}

/** Convenience: project fact-base stats to a signal series and segment in one call. */
export function segmentFactBase(stats: FactBaseStatsView, opts: SegmentOptions = {}): Segmentation {
  return segment(projectSignals(stats), opts);
}

// ---------------------------------------------------------------------------
// Accessors and downstream wiring
// ---------------------------------------------------------------------------

export function epochById(seg: Segmentation, id: EpochId): Epoch | null {
  return seg.epochs.find((e) => e.id === id) ?? null;
}

/**
 * The boundary commits at which the fact base takes tree snapshots (import graphs, doc snapshots —
 * spec 04 §2). Structurally compatible with facts.ts `EpochBoundary`; `at` is the epoch's first
 * commit (its boundary). HANDOFF: the Wire agent feeds these to the boundary-dependent fact miners.
 */
export function epochBoundaries(seg: Segmentation): readonly { readonly epoch: EpochId; readonly at: CommitSha }[] {
  return seg.epochs.map((e) => ({ epoch: e.id, at: e.startSha }));
}
