// Implements tests for: docs/spec/02-ledger.md §3 (supersession chains resolved to tips),
// §4 (the leaky integrator, and the aligned/abstain asymmetry) and §6 (hysteresis, not reset),
// plus SEED-02's stated acceptance criterion — "the fold must be pure: same event set + same
// knobs -> identical accumulator state, verified by a property test".
//
// The determinism property is written as a BYTE comparison of a full fingerprint (JSON, so
// every double is compared in its exact shortest round-trip form) rather than as a tolerance on
// the final value. A fold that agreed to 9 decimal places under permutation would still be a
// broken fold: the ledger is a content-addressed SET (ADR-0002) and the array order it arrives
// in is an accident of a directory walk.

import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  committerTimeFromEpochMillis,
  eventBodyFromVerdict,
  isViolationEvent,
  parseAccumulatorKey,
  parseBudget,
  parseCommitSha,
  parseCommitterTime,
  parseDuration,
  parseEventId,
  parseJudgeId,
  parsePrecision,
  parseRationaleRef,
  sealEvent,
  supersede,
  unwrap,
  MILLIS_PER_DAY,
  REARM_FRACTION_DEFAULT,
  type AccumulatorKey,
  type AccumulatorState,
  type EventSubject,
  type FoldKnobs,
  type JudgeRef,
  type LedgerEvent,
  type MintViolationInput,
} from '../../src/core/index.js';
import { hashBlob } from '../../src/core/canonical.js';
import { toAccumulatorSnapshot } from '../../src/core/accumulator.js';
import {
  revealSurprise,
  withSentencingWarrant,
  type Surprise,
} from '../../src/core/sentencing.js';
import {
  decodeLedgerEvent,
  decodeVerdict,
  type AbstainVerdict,
  type AlignedVerdict,
  type SeverityOrdinal,
  type ViolationVerdict,
} from '../../src/core/index.js';
import {
  compareAccumulatorKeys,
  foldEvents,
  foldKnobs,
  groupTipsByKey,
  projectStateTo,
  stateFor,
  type FoldResult,
} from '../../src/ledger/fold.js';
import {
  accumulatorFilePath,
  cacheFactsFor,
  decodeAccumulatorFileName,
  decodeAccumulatorSnapshot,
  encodeAccumulatorSnapshot,
  materializeFold,
  mayTrustCachedSnapshot,
  mayTrustCachedSnapshotFor,
} from '../../src/ledger/cache.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WARRANT = withSentencingWarrant((w) => w);
const read = (s: Surprise): number => revealSurprise(s, WARRANT);

const HALF_LIFE_90D = unwrap(parseDuration('90d'));
const JUDGE: JudgeRef = { kind: 'deterministic', id: unwrap(parseJudgeId('fold-fixture')) };
const RATIONALE = unwrap(parseRationaleRef(hashBlob('the full rationale text')));
const KEY_A = unwrap(parseAccumulatorKey('INV-007'));
const KEY_B = unwrap(parseAccumulatorKey('INV-008'));
const EPOCH = Date.parse('2026-01-01T00:00:00Z');

const key = (s: string): AccumulatorKey => unwrap(parseAccumulatorKey(s));
const atDay = (day: number) => unwrap(committerTimeFromEpochMillis(EPOCH + day * MILLIS_PER_DAY));
const commit = (n: number): string => (0x100000 + n).toString(16);

const knobsWith = (budget: number, overrides: Partial<FoldKnobs> = {}): FoldKnobs => ({
  halfLife: HALF_LIFE_90D,
  budget: unwrap(parseBudget(budget)),
  precisionOverride: null,
  rearmFraction: REARM_FRACTION_DEFAULT,
  ...overrides,
});

interface EventSpec {
  readonly assertion?: string;
  readonly day: number;
  readonly n: number;
  readonly kind?: 'drift' | 'stale-claim' | 'aligned' | 'abstain';
  readonly severity?: SeverityOrdinal;
  readonly precision?: number;
}

function mintInput(spec: EventSpec): MintViolationInput {
  const verdict = unwrap(
    decodeVerdict({
      assertion: spec.assertion ?? 'INV-007',
      verdict: spec.kind ?? 'drift',
      severity: spec.severity ?? 'breach',
      evidence: ['src/core/http.ts:41-58'],
      rationale: 'imports a forge SDK inside core/',
    }),
  ) as ViolationVerdict;
  return {
    verdict,
    subject: { commit: unwrap(parseCommitSha(commit(spec.n))) } as EventSubject,
    judge: JUDGE,
    t: atDay(spec.day),
    precision_at: unwrap(parsePrecision(spec.precision ?? 0.9)),
    rationale: RATIONALE,
  };
}

/** A violating event (drift by default) at `day`, made unique by `n`. */
function event(spec: EventSpec): LedgerEvent {
  const kind = spec.kind ?? 'drift';
  if (kind === 'aligned' || kind === 'abstain') {
    const verdict = unwrap(
      decodeVerdict({ assertion: spec.assertion ?? 'INV-007', verdict: kind }),
    ) as AlignedVerdict | AbstainVerdict;
    return unwrap(
      sealEvent(
        eventBodyFromVerdict({
          verdict,
          subject: { commit: unwrap(parseCommitSha(commit(spec.n))) } as EventSubject,
          judge: JUDGE,
          t: atDay(spec.day),
        }),
      ),
    );
  }
  return unwrap(sealEvent(eventBodyFromVerdict(mintInput(spec))));
}

const fold = (events: readonly LedgerEvent[], knobs: FoldKnobs): FoldResult =>
  unwrap(foldEvents(events, knobs));

const mustState = (r: FoldResult, k: AccumulatorKey): AccumulatorState => {
  const s = stateFor(r, k);
  if (s === null) throw new Error(`no accumulator state for ${k}`);
  return s;
};

/**
 * Everything a caller can observe about a fold, flattened to JSON. `Surprise` is opaque, so the
 * meter and every residual weight are revealed under a warrant HERE — in a test, which is not a
 * blind directory — and nowhere in src/ledger.
 */
function fingerprint(result: FoldResult): string {
  return JSON.stringify({
    keys: result.keys,
    states: result.keys.map((k) => {
      const s = mustState(result, k);
      return {
        snapshot: toAccumulatorSnapshot(s, WARRANT),
        arm:
          s.arm.kind === 'fired'
            ? { kind: s.arm.kind, at: s.arm.at, value: read(s.arm.value) }
            : { kind: s.arm.kind },
        contributing: s.contributing.map((c) => ({
          event: c.event,
          key: c.key,
          t: c.t,
          verdict: c.verdict,
          rawWeight: c.rawWeight,
          residualWeight: read(c.residualWeight),
        })),
      };
    }),
    firings: result.firings.map((f) => ({
      key: f.key,
      at: f.at,
      triggeredBy: f.triggeredBy,
      value: read(f.value),
      residuals: f.contributing.map((c) => read(c.residualWeight)),
    })),
    tips: result.tips.map((e) => e.event),
    forks: result.forks,
    dangling: result.dangling,
    knobs: result.knobsDigest,
    eventCount: result.eventCount,
  });
}

// A generated event set: several keys, several verdict kinds, ties on committer time, and a
// spread wide enough that decay actually bites.
const specArb = fc.record({
  assertion: fc.constantFrom('INV-007', 'INV-008', 'src/**'),
  day: fc.integer({ min: 0, max: 900 }),
  kind: fc.constantFrom<'drift' | 'stale-claim' | 'aligned' | 'abstain'>(
    'drift',
    'stale-claim',
    'aligned',
    'abstain',
  ),
  severity: fc.constantFrom<SeverityOrdinal>('grazes', 'bends', 'breach', 'entrenches'),
  precision: fc.constantFrom(0.25, 0.5, 0.75, 0.9, 1),
});

const eventSetArb = fc
  .array(specArb, { maxLength: 22 })
  .map((specs) => specs.map((s, i) => event({ ...s, n: i })));

// ---------------------------------------------------------------------------

describe('foldEvents — purity (SEED-02 acceptance)', () => {
  it('is invariant under permutation of the input array: byte-identical state', () => {
    fc.assert(
      fc.property(
        eventSetArb.chain((events) =>
          fc.tuple(
            fc.constant(events),
            fc.shuffledSubarray(events, {
              minLength: events.length,
              maxLength: events.length,
            }),
          ),
        ),
        ([events, shuffled]) => {
          const knobs = knobsWith(2);
          expect(fingerprint(fold(shuffled, knobs))).toBe(fingerprint(fold(events, knobs)));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('is invariant under duplicated input: the ledger is a SET (ADR-0002)', () => {
    const events = [
      event({ day: 0, n: 1 }),
      event({ day: 40, n: 2 }),
      event({ day: 41, n: 3, kind: 'aligned' }),
    ];
    const knobs = knobsWith(2);
    expect(fingerprint(fold([...events, ...events], knobs))).toBe(
      fingerprint(fold(events, knobs)),
    );
  });

  it('does not mutate its input array or its events', () => {
    const events = [event({ day: 5, n: 1 }), event({ day: 0, n: 2 })];
    const before = events.map((e) => e.event);
    fold(events, knobsWith(1));
    expect(events.map((e) => e.event)).toEqual(before);
    expect(events.every((e) => Object.isFrozen(e))).toBe(true);
  });

  it('reads no clock: Date.now() is never called', () => {
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('the fold read a clock');
    });
    try {
      expect(() => fold([event({ day: 0, n: 1 }), event({ day: 100, n: 2 })], knobsWith(1))).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it('orders keys and firings deterministically, never by Map insertion', () => {
    const events = [
      event({ assertion: 'src/**', day: 3, n: 1, kind: 'stale-claim' }),
      event({ assertion: 'INV-008', day: 2, n: 2 }),
      event({ assertion: 'INV-007', day: 1, n: 3 }),
    ];
    const result = fold(events, knobsWith(0.5));
    expect(result.keys).toEqual([key('INV-007'), key('INV-008'), key('src/**')]);
    expect([...result.states.keys()]).toEqual(result.keys);
    expect([...result.keys].sort(compareAccumulatorKeys)).toEqual(result.keys);
  });
});

describe('the aligned asymmetry (spec 02 §4: decay is the only forgiveness)', () => {
  /** The meter and its clock, ignoring the counters an aligned event is allowed to touch. */
  const meterOf = (r: FoldResult, k: AccumulatorKey): unknown => {
    const s = stateFor(r, k);
    if (s === null) return null;
    return {
      value: read(s.value),
      asOf: s.asOf,
      lastEventAt: s.lastEventAt,
      violationCount: s.violationCount,
      arm: s.arm.kind,
      contributing: s.contributing.map((c) => [c.event, c.rawWeight, read(c.residualWeight)]),
    };
  };

  it('appending an aligned event never CHANGES the value and never advances lastEventAt', () => {
    fc.assert(
      fc.property(
        eventSetArb,
        fc.constantFrom('INV-007', 'INV-008', 'src/**'),
        fc.integer({ min: 0, max: 1200 }),
        (events, assertion, day) => {
          const knobs = knobsWith(2);
          const before = fold(events, knobs);
          const compliance = event({ assertion, day, n: 900, kind: 'aligned' });
          const after = fold([...events, compliance], knobs);

          for (const k of before.keys) {
            expect(meterOf(after, k)).toEqual(meterOf(before, k));
          }
          const k = key(assertion);
          expect(mustState(after, k).complianceCount).toBe(
            (stateFor(before, k)?.complianceCount ?? 0) + 1,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('an abstain event increments only the abstention counter (spec 03 §4: it escalates)', () => {
    const knobs = knobsWith(2);
    const base = [event({ day: 0, n: 1 })];
    const before = fold(base, knobs);
    const after = fold([...base, event({ day: 500, n: 2, kind: 'abstain' })], knobs);
    expect(meterOf(after, KEY_A)).toEqual(meterOf(before, KEY_A));
    expect(mustState(after, KEY_A).abstentionCount).toBe(1);
    expect(mustState(after, KEY_A).complianceCount).toBe(0);
  });

  it('a thousand compliances do not pay down one breach', () => {
    const knobs = knobsWith(2);
    const breach = event({ day: 0, n: 1 });
    const many = Array.from({ length: 200 }, (_, i) => event({ day: i, n: i + 2, kind: 'aligned' }));
    const alone = fold([breach], knobs);
    const laundered = fold([breach, ...many], knobs);
    expect(read(mustState(laundered, KEY_A).value)).toBe(read(mustState(alone, KEY_A).value));
    expect(mustState(laundered, KEY_A).complianceCount).toBe(200);
  });

  it('a key with only compliances exists, at zero, armed, with no reference instant', () => {
    const result = fold([event({ day: 0, n: 1, kind: 'aligned' })], knobsWith(1));
    const s = mustState(result, KEY_A);
    expect(read(s.value)).toBe(0);
    expect(s.asOf).toBeNull();
    expect(s.lastEventAt).toBeNull();
    expect(s.arm.kind).toBe('armed');
  });
});

describe('supersession (spec 02 §3: the fold takes the tip of each chain)', () => {
  it('folds a chain of three as the tip only', () => {
    const first = event({ day: 0, n: 1, severity: 'entrenches' });
    const second = unwrap(supersede(first, mintInput({ day: 1, n: 2, severity: 'bends' })));
    const third = unwrap(supersede(second, mintInput({ day: 2, n: 3, severity: 'grazes' })));

    const result = fold([first, second, third], knobsWith(5));
    expect(result.tips.map((e) => e.event)).toEqual([third.event]);
    const s = mustState(result, KEY_A);
    expect(s.violationCount).toBe(1);
    expect(s.contributing.map((c) => c.event)).toEqual([third.event]);
    // grazes = 0.25 at precision 0.9.
    expect(read(s.value)).toBeCloseTo(0.225, 12);
    expect(result.forks).toEqual([]);
    expect(result.dangling).toEqual([]);
  });

  it('keeps an event whose `supersedes` dangles, and reports it', () => {
    const missing = unwrap(parseEventId(`sha256:${'b'.repeat(64)}`));
    const orphan = unwrap(
      sealEvent(eventBodyFromVerdict({ ...mintInput({ day: 0, n: 1 }), supersedes: missing })),
    );
    const result = fold([orphan], knobsWith(5));
    expect(result.tips.map((e) => e.event)).toEqual([orphan.event]);
    expect(result.dangling).toEqual([orphan.event]);
    expect(mustState(result, KEY_A).violationCount).toBe(1);
  });

  it('reports a fork, and does not fold the superseded event alongside its successors', () => {
    // Two concurrent CI runs re-judged the same event (Q-23). Both successors are tips —
    // src/core reports the fork rather than inventing a tie-break, and this fold must not
    // invent one either. What must NOT happen is the original counting as well: the superseded
    // event is dropped exactly once, so a fork cannot double-count it.
    const original = event({ day: 0, n: 1, severity: 'entrenches' });
    const left = unwrap(supersede(original, mintInput({ day: 1, n: 2, severity: 'grazes' })));
    const right = unwrap(supersede(original, mintInput({ day: 1, n: 3, severity: 'grazes' })));

    const result = fold([original, left, right], knobsWith(5));
    const tips = result.tips.map((e) => e.event).sort();
    expect(tips).toEqual([left.event, right.event].sort());
    expect(tips).not.toContain(original.event);

    expect(result.forks).toHaveLength(1);
    expect(result.forks[0]?.superseded).toBe(original.event);
    expect([...(result.forks[0]?.successors ?? [])].sort()).toEqual(
      [left.event, right.event].sort(),
    );

    const s = mustState(result, KEY_A);
    expect(s.violationCount).toBe(2);
    expect(s.contributing.map((c) => c.event)).not.toContain(original.event);
    // Two grazes at 0.9, same instant: 0.225 + 0.225. The entrenching original contributes
    // nothing — had it been folded too, this would read 1.125.
    expect(read(s.value)).toBeCloseTo(0.45, 12);
  });

  it('an abstain that supersedes a drift removes that drift\'s surprise (Q-28)', () => {
    // Pinned deliberately, because it is a consequence rather than a decision: the fold consumes
    // TIPS, so a higher rung answering "honestly insufficient" over a lower rung's `drift`
    // erases the accumulated weight of the call it replaced. docs/spec/OPEN-QUESTIONS.md Q-28
    // asks whether that is intended or whether an abstain should be forbidden from superseding a
    // violation. Whichever way it is ratified, this test is where the answer changes.
    const drift = event({ day: 0, n: 1, severity: 'entrenches' });
    const unsure = unwrap(
      supersede(drift, {
        verdict: unwrap(decodeVerdict({ assertion: 'INV-007', verdict: 'abstain' })) as AbstainVerdict,
        subject: { commit: unwrap(parseCommitSha(commit(2))) } as EventSubject,
        judge: JUDGE,
        t: atDay(1),
      }),
    );
    const result = fold([drift, unsure], knobsWith(0.5));
    expect(result.tips.map((e) => e.event)).toEqual([unsure.event]);
    expect(read(mustState(result, KEY_A).value)).toBe(0);
    expect(mustState(result, KEY_A).abstentionCount).toBe(1);
    expect(result.firings).toEqual([]);
  });

  it('groups by accumulator key: two assertions never contaminate each other', () => {
    const result = fold(
      [
        event({ assertion: 'INV-007', day: 0, n: 1, severity: 'entrenches' }),
        event({ assertion: 'INV-008', day: 0, n: 2, severity: 'grazes' }),
      ],
      knobsWith(5),
    );
    expect(read(mustState(result, KEY_A).value)).toBeCloseTo(0.9, 12);
    expect(read(mustState(result, KEY_B).value)).toBeCloseTo(0.225, 12);
  });

  it('groupTipsByKey is the same grouping the cache uses', () => {
    const events = [event({ day: 0, n: 1 }), event({ assertion: 'INV-008', day: 1, n: 2 })];
    const grouping = groupTipsByKey(events);
    expect(grouping.keys).toEqual([KEY_A, KEY_B]);
    expect(grouping.byKey.get(KEY_A)?.map((e) => e.event)).toEqual([events[0]?.event]);
  });
});

describe('hysteresis (spec 02 §6: nothing flaps)', () => {
  // budget 1.0, half-life 90d, every event an `entrenches` (1.0) at precision 0.9 -> +0.9.
  const knobs = knobsWith(1);

  const e1 = event({ day: 0, n: 1, severity: 'entrenches' });
  const e2 = event({ day: 0, n: 2, severity: 'entrenches' });
  const e3 = event({ day: 30, n: 3, severity: 'entrenches' });
  const e4 = event({ day: 600, n: 4, severity: 'entrenches' });
  const e5 = event({ day: 601, n: 5, severity: 'entrenches' });

  it('fires once at the crossing and does not re-fire while above the re-arm fraction', () => {
    const result = fold([e1, e2, e3], knobs);
    // e1: 0.9 < 1.0. e2 (same instant): 1.8 >= 1.0 -> FIRE.
    // e3 (+30d): 1.8 * 2^(-1/3) = 1.4287, still >> 0.5 -> stays fired; +0.9 = 2.3287, and
    // 2.3287 >= budget yet does NOT fire, because the unit is not armed.
    expect(result.firings.map((f) => f.triggeredBy)).toEqual([e2.event]);
    const s = mustState(result, KEY_A);
    expect(s.arm.kind).toBe('fired');
    // e3 left the meter ABOVE budget and still produced no proposal: that is the hysteresis.
    expect(read(s.value)).toBeGreaterThan(knobs.budget);
    expect(s.violationCount).toBe(3);
  });

  it('re-arms only after decaying below rearmFraction · budget, then can fire again', () => {
    const result = fold([e1, e2, e3, e4, e5], knobs);
    // By day 600 the meter has decayed to ~0.029 — under 0.5 — so e4 re-arms it and lands at
    // 0.9287, below budget. e5 the next day pushes it to ~1.82 and the unit fires a second time.
    expect(result.firings.map((f) => f.triggeredBy)).toEqual([e2.event, e5.event]);
    expect(mustState(result, KEY_A).arm.kind).toBe('fired');
  });

  it('a firing ships its evidence: every contributing event, weighted at the firing instant', () => {
    const result = fold([e1, e2, e3], knobs);
    const firing = result.firings[0];
    expect(firing?.contributing.map((c) => c.event)).toEqual([e1.event, e2.event]);
    expect(firing?.contributing.every((c) => read(c.residualWeight) === 0.9)).toBe(true);
    expect(firing?.budget).toBe(knobs.budget);
    // The firing's snapshot is frozen at its instant: later events do not rewrite it.
    expect(firing?.contributing).toHaveLength(2);
    expect(mustState(result, KEY_A).contributing).toHaveLength(3);
  });

  it('never fires below budget, and fires exactly at it', () => {
    const under = fold([event({ day: 0, n: 1, severity: 'entrenches', precision: 0.9 })], knobsWith(0.91));
    expect(under.firings).toEqual([]);
    const exact = fold([event({ day: 0, n: 1, severity: 'entrenches', precision: 0.9 })], knobsWith(0.9));
    expect(exact.firings).toHaveLength(1);
  });

  it('rejects a re-arm fraction outside [0, 1] rather than silently disarming hysteresis', () => {
    const bad = foldEvents([e1], { ...knobs, rearmFraction: 1.5 });
    expect(bad.ok).toBe(false);
    const worse = foldEvents([e1], { ...knobs, rearmFraction: Number.NaN });
    expect(worse.ok).toBe(false);
  });
});

describe('hostile input: an unbounded precision_at (Q-26)', () => {
  // `assertion.schema.json` bounds `precision` to (0, 1], but `event.precision_at` is an
  // UNBOUNDED number — deliberately, so the read path does not reject a third-party event the
  // schema would have accepted (Q-26). The minter cannot produce one: `MintViolationInput`
  // takes a branded `Precision`. A decoded event can, so this is built through the read path.
  const rawEvent = (precisionAt: number, day = 0, nonce = 'a'): LedgerEvent =>
    unwrap(
      decodeLedgerEvent({
        event: `sha256:${nonce.repeat(64)}`,
        assertion: 'INV-007',
        verdict: 'drift',
        severity: 0.75,
        precision_at: precisionAt,
        rationale: RATIONALE,
        judge: { kind: 'deterministic', id: 'fold-fixture' },
        subject: { commit: commit(700) },
        t: atDay(day),
        supersedes: null,
      }),
    );

  it('cannot drive the meter below zero, and never manufactures a firing', () => {
    const result = fold([rawEvent(-0.9)], knobsWith(0.1));
    const s = mustState(result, KEY_A);
    expect(read(s.value)).toBe(0);
    expect(result.firings).toEqual([]);
    // The event is still COUNTED and still advances the reference instant: it is a recorded
    // violation, it merely weighs nothing.
    expect(s.violationCount).toBe(1);
    expect(s.lastEventAt).toBe(atDay(0));
  });

  it('reports what the event recorded, while the meter takes only what it can hold', () => {
    // rawWeight is the product as recorded (-0.9 × 0.75); residualWeight is what was integrated.
    // The divergence is the point — see src/ledger/fold.ts step 3.
    const s = mustState(fold([rawEvent(-0.9)], knobsWith(5)), KEY_A);
    expect(s.contributing[0]?.rawWeight).toBeCloseTo(-0.675, 12);
    expect(read(s.contributing[0]!.residualWeight)).toBe(0);
    expect(read(s.value)).toBe(0);
  });

  it('cannot be laundered into forgiveness: it does nothing but let time pass', () => {
    // The negative event DOES age the meter to its committer instant — that is decay, which is
    // owed to every violating event regardless of what it weighs. What it must not do is subtract
    // anything of its own. So the result is exactly the earlier breach projected to day 1, and a
    // precision of -4 lands in the same place a precision of -0.0001 would.
    const knobs = knobsWith(5);
    const real = event({ day: 0, n: 1 });
    const aged = read(projectStateTo(mustState(fold([real], knobs), KEY_A), atDay(1), knobs).value);

    expect(read(mustState(fold([real, rawEvent(-4, 1)], knobs), KEY_A).value)).toBeCloseTo(aged, 12);
    // 0.675 × 2^(-1/90) = 0.6698213637274869 — pure decay, nothing paid down.
    expect(aged).toBeCloseTo(0.6698213637274869, 12);
  });

  it('a precision above 1 is integrated as recorded — the ceiling is Q-26, not the fold', () => {
    // Nothing in spec 02 §4 caps the increment, and spec 02 §6 has precision RISING under fire
    // with no headroom above 1.0. The fold does not invent a ceiling it was not given.
    const s = mustState(fold([rawEvent(2)], knobsWith(5)), KEY_A);
    expect(read(s.value)).toBeCloseTo(1.5, 12);
  });
});

describe('replay / counterfactual (spec 02 §1.3)', () => {
  const events = [event({ day: 0, n: 1 }), event({ day: 90, n: 2 })];

  it('overrides precision at READ time and never touches the recorded precision_at', () => {
    const recorded = fold(events, knobsWith(5));
    const halved = fold(events, knobsWith(5, { precisionOverride: unwrap(parsePrecision(0.45)) }));
    expect(read(mustState(halved, KEY_A).value)).toBeCloseTo(
      read(mustState(recorded, KEY_A).value) / 2,
      12,
    );
    for (const e of events) {
      expect(isViolationEvent(e) ? e.precision_at : null).toBe(0.9);
    }
  });

  it('a retuned budget changes what fires, through the same code path', () => {
    expect(fold(events, knobsWith(5)).firings).toEqual([]);
    expect(fold(events, knobsWith(1)).firings).toHaveLength(1);
  });

  it('a retuned half-life changes the fold and the knobs digest together', () => {
    const fast = fold(events, knobsWith(5, { halfLife: unwrap(parseDuration('7d')) }));
    const slow = fold(events, knobsWith(5, { halfLife: unwrap(parseDuration('365d')) }));
    expect(read(mustState(fast, KEY_A).value)).toBeLessThan(read(mustState(slow, KEY_A).value));
    expect(fast.knobsDigest).not.toBe(slow.knobsDigest);
  });

  it('foldKnobs takes its defaults from the assertion and its overrides from the caller', () => {
    const source = { budget: unwrap(parseBudget(3)), half_life: HALF_LIFE_90D };
    expect(foldKnobs(source)).toEqual({
      halfLife: HALF_LIFE_90D,
      budget: source.budget,
      precisionOverride: null,
      rearmFraction: REARM_FRACTION_DEFAULT,
    });
    expect(foldKnobs(source, { budget: unwrap(parseBudget(2)) }).budget).toBe(2);
  });
});

describe('the derived cache (ADR-0002: never authoritative)', () => {
  const knobs = knobsWith(5);
  const events = [event({ day: 0, n: 1 }), event({ day: 45, n: 2 }), event({ day: 46, n: 3, kind: 'aligned' })];

  it('materializes one snapshot per key, at a stable path, in key order', () => {
    const result = fold(events, knobs);
    const files = materializeFold(result, WARRANT);
    expect(files.map((f) => f.path)).toEqual(['accumulators/INV-007.yaml']);
    expect(files[0]?.snapshot.violation_count).toBe(2);
    expect(files[0]?.snapshot.compliance_count).toBe(1);
    expect(files[0]?.snapshot.event_count).toBe(2);
    expect(files[0]?.snapshot.knobs).toBe(result.knobsDigest);
  });

  it('percent-encodes a scope-claim key so `src/**` is one file, not three directories (Q-41)', () => {
    const claim = key('src/**');
    expect(accumulatorFilePath(claim)).toBe('accumulators/src%2F%2A%2A.yaml');
    expect(unwrap(decodeAccumulatorFileName('src%2F%2A%2A.yaml'))).toBe(claim);
    expect(unwrap(decodeAccumulatorFileName('INV-007.yaml'))).toBe(KEY_A);
  });

  it('round-trips through encode -> decode', () => {
    const snap = materializeFold(fold(events, knobs), WARRANT)[0]?.snapshot;
    const decoded = unwrap(decodeAccumulatorSnapshot(encodeAccumulatorSnapshot(snap!)));
    expect(decoded).toEqual(snap);
  });

  it('rejects an unknown key in a cache file rather than ignoring it (Q-34)', () => {
    const snap = materializeFold(fold(events, knobs), WARRANT)[0]?.snapshot;
    const bad = { ...encodeAccumulatorSnapshot(snap!), budget_remaining: 0.4 };
    const decoded = decodeAccumulatorSnapshot(bad);
    expect(decoded.ok).toBe(false);
  });

  it('requires `armed`: an omission must not silently restore the ability to fire', () => {
    const snap = materializeFold(fold(events, knobs), WARRANT)[0]?.snapshot;
    const { armed: _dropped, ...withoutArm } = encodeAccumulatorSnapshot(snap!);
    const decoded = decodeAccumulatorSnapshot(withoutArm);
    expect(decoded.ok).toBe(false);
    expect(decoded.ok ? [] : decoded.error.map((e) => e.code)).toContain('missing-field');
  });

  it('trusts a snapshot only when it agrees with the event set on every cheap fact', () => {
    const snap = materializeFold(fold(events, knobs), WARRANT)[0]?.snapshot;
    expect(mayTrustCachedSnapshotFor(snap, events, KEY_A, knobs).trusted).toBe(true);
  });

  it('distrusts on a knob retune — a cache is invalidated by its digest, not by a timestamp', () => {
    const snap = materializeFold(fold(events, knobs), WARRANT)[0]?.snapshot;
    const retuned = knobsWith(5, { halfLife: unwrap(parseDuration('30d')) });
    const verdict = mayTrustCachedSnapshotFor(snap, events, KEY_A, retuned);
    expect(verdict.trusted).toBe(false);
    expect(verdict.reasons).toContain('knobs-retuned');
  });

  it('distrusts when the event set grew under it', () => {
    const snap = materializeFold(fold(events, knobs), WARRANT)[0]?.snapshot;
    const grown = [...events, event({ day: 200, n: 9 })];
    const verdict = mayTrustCachedSnapshotFor(snap, grown, KEY_A, knobs);
    expect(verdict.trusted).toBe(false);
    expect(verdict.reasons).toContain('event-count-mismatch');
    expect(verdict.reasons).toContain('as-of-behind');
  });

  it('distrusts a same-count set whose tip was swapped by a supersession', () => {
    const original = event({ day: 300, n: 20 });
    const snap = materializeFold(fold([...events, original], knobs), WARRANT)[0]?.snapshot;
    const rejudged = unwrap(supersede(original, mintInput({ day: 301, n: 21 })));
    const verdict = mayTrustCachedSnapshotFor(snap, [...events, original, rejudged], KEY_A, knobs);
    expect(verdict.trusted).toBe(false);
    expect(verdict.reasons).toContain('last-event-mismatch');
  });

  it('distrusts an absent cache, and any snapshot for another key', () => {
    const facts = unwrap(cacheFactsFor(events, KEY_A, knobs));
    expect(mayTrustCachedSnapshot(null, facts).reasons).toEqual(['absent']);
    expect(mayTrustCachedSnapshot(undefined, facts).trusted).toBe(false);
    const snap = materializeFold(fold(events, knobs), WARRANT)[0]?.snapshot;
    expect(mayTrustCachedSnapshot({ ...snap!, key: KEY_B }, facts).reasons).toContain('key-mismatch');
  });

  it('distrusts a meter reading that is not a meter reading', () => {
    const facts = unwrap(cacheFactsFor(events, KEY_A, knobs));
    const snap = materializeFold(fold(events, knobs), WARRANT)[0]?.snapshot;
    expect(mayTrustCachedSnapshot({ ...snap!, value: Number.NaN }, facts).reasons).toContain(
      'invalid-value',
    );
    expect(mayTrustCachedSnapshot({ ...snap!, value: -1 }, facts).reasons).toContain(
      'invalid-value',
    );
  });

  it('answers `indeterminate` — never `trusted` — when the facts cannot be computed', () => {
    const snap = materializeFold(fold(events, knobs), WARRANT)[0]?.snapshot;
    const undigestable = { ...knobs, rearmFraction: Number.POSITIVE_INFINITY };
    const verdict = mayTrustCachedSnapshotFor(snap, events, KEY_A, undigestable);
    expect(verdict.trusted).toBe(false);
    expect(verdict.reasons).toEqual(['indeterminate']);
  });
});

describe('projectStateTo — reporting without a clock in the engine', () => {
  it('ages a state to an explicit instant and re-tests the re-arm threshold', () => {
    const knobs = knobsWith(1);
    const result = fold(
      [event({ day: 0, n: 1, severity: 'entrenches' }), event({ day: 0, n: 2, severity: 'entrenches' })],
      knobs,
    );
    const fired = mustState(result, KEY_A);
    expect(fired.arm.kind).toBe('fired');

    const stillHot = projectStateTo(fired, unwrap(parseCommitterTime('2026-02-01T00:00:00Z')), knobs);
    expect(stillHot.arm.kind).toBe('fired');

    const cold = projectStateTo(fired, unwrap(parseCommitterTime('2028-01-01T00:00:00Z')), knobs);
    expect(cold.arm.kind).toBe('armed');
    expect(read(cold.value)).toBeLessThan(0.5);
  });
});
