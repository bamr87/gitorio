// Implements tests for: docs/adr/0004-committer-time-decay.md, docs/spec/01-core-memory.md §3
// (half_life grammar), schemas/assertion.schema.json#/properties/half_life.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DAYS_PER_UNIT,
  DURATION_UNIT_MILLIS,
  HALF_LIFE_PATTERN,
  MILLIS_PER_DAY,
  committerTimeFromEpochMillis,
  committerTimeMillis,
  compareCommitterTime,
  durationDays,
  durationMillis,
  elapsedMillis,
  formatDuration,
  makeDuration,
  parseCommitterTime,
  parseDuration,
  type CommitterTime,
} from '../../src/core/time.js';
import { unwrap } from '../../src/core/result.js';

describe('duration grammar mirrors schemas/assertion.schema.json', () => {
  it('exports the schema pattern verbatim', () => {
    expect(HALF_LIFE_PATTERN.source).toBe('^[0-9]+(d|w|mo)$');
  });

  it('parses days', () => {
    const d = unwrap(parseDuration('90d'));
    expect(d).toMatchObject({ count: 90, unit: 'd', source: '90d' });
    expect(durationMillis(d)).toBe(90 * MILLIS_PER_DAY);
    expect(durationDays(d)).toBe(90);
  });

  it('parses weeks', () => {
    const d = unwrap(parseDuration('12w'));
    expect(d).toMatchObject({ count: 12, unit: 'w' });
    expect(durationMillis(d)).toBe(12 * 7 * MILLIS_PER_DAY);
    expect(durationDays(d)).toBe(84);
  });

  it('parses months, pinned at exactly 30 days (OPEN-QUESTIONS Q-01)', () => {
    const d = unwrap(parseDuration('6mo'));
    expect(d).toMatchObject({ count: 6, unit: 'mo' });
    expect(DAYS_PER_UNIT.mo).toBe(30);
    expect(durationMillis(d)).toBe(6 * 30 * MILLIS_PER_DAY);
    expect(durationDays(d)).toBe(180);
  });

  it('keeps the unit table consistent with the day table', () => {
    for (const unit of ['d', 'w', 'mo'] as const) {
      expect(DURATION_UNIT_MILLIS[unit]).toBe(DAYS_PER_UNIT[unit] * MILLIS_PER_DAY);
    }
  });

  it('accepts 0d because the schema pattern admits it (OPEN-QUESTIONS Q-02)', () => {
    const d = unwrap(parseDuration('0d'));
    expect(d.count).toBe(0);
    expect(d.millis).toBe(0);
  });

  it.each([
    '90',
    '90D',
    'd',
    '90y',
    '-90d',
    '9.5d',
    '90 d',
    ' 90d',
    '90dd',
    '90mo ',
    '',
    '1e3d',
  ])('rejects %p', (bad) => {
    const r = parseDuration(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-duration');
  });

  it.each([90, null, undefined, {}, ['90d']])('rejects non-string %p', (bad) => {
    expect(parseDuration(bad).ok).toBe(false);
  });

  it('re-emits the verbatim source so YAML round-trips byte-identically', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99999 }),
        fc.constantFrom('d', 'w', 'mo'),
        (n, unit) => {
          const source = `${n}${unit}`;
          const d = unwrap(parseDuration(source));
          expect(formatDuration(d)).toBe(source);
        },
      ),
    );
  });

  it('makeDuration produces a parseable source', () => {
    const d = unwrap(makeDuration(45, 'w'));
    expect(d.source).toBe('45w');
    expect(unwrap(parseDuration(d.source))).toEqual(d);
    expect(makeDuration(-1, 'd').ok).toBe(false);
    expect(makeDuration(1.5, 'd').ok).toBe(false);
  });
});

describe('committer time (ADR-0004)', () => {
  it('accepts full RFC 3339', () => {
    expect(parseCommitterTime('2026-07-21T14:03:00Z').ok).toBe(true);
    expect(parseCommitterTime('2026-07-21T14:03:00.500Z').ok).toBe(true);
    expect(parseCommitterTime('2026-07-21T14:03:00+02:00').ok).toBe(true);
  });

  it("accepts spec 02 §2's own abbreviated example (OPEN-QUESTIONS Q-07)", () => {
    const r = parseCommitterTime('2026-07-21T14:03Z');
    expect(r.ok).toBe(true);
  });

  it('brands the ORIGINAL text unchanged, so re-hashing cannot drift', () => {
    const source = '2026-07-21T14:03Z';
    expect(unwrap(parseCommitterTime(source))).toBe(source);
  });

  it.each(['2026-07-21', 'yesterday', '2026-07-21T14:03', '', '14:03Z', '2026-13-45T99:99:99Z'])(
    'rejects %p',
    (bad) => {
      expect(parseCommitterTime(bad).ok).toBe(false);
    },
  );

  it('mints exactly one normalized form: UTC, second precision, no fraction', () => {
    const t = unwrap(committerTimeFromEpochMillis(Date.UTC(2026, 6, 21, 14, 3, 0, 250)));
    expect(t).toBe('2026-07-21T14:03:00Z');
  });

  it('every minted timestamp is itself parseable (idempotent round trip)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_102_444_800_000 }), (ms) => {
        const t = unwrap(committerTimeFromEpochMillis(ms));
        expect(parseCommitterTime(t).ok).toBe(true);
        // Second precision: re-minting from the parsed value is a fixed point.
        const again = unwrap(committerTimeFromEpochMillis(committerTimeMillis(t)));
        expect(again).toBe(t);
      }),
    );
  });

  it('rejects non-finite epoch millis', () => {
    expect(committerTimeFromEpochMillis(Number.NaN).ok).toBe(false);
    expect(committerTimeFromEpochMillis(Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  it('elapsed time is signed; clamping is the decay function’s job', () => {
    const a = unwrap(parseCommitterTime('2026-01-01T00:00:00Z'));
    const b = unwrap(parseCommitterTime('2026-01-02T00:00:00Z'));
    expect(elapsedMillis(a, b)).toBe(MILLIS_PER_DAY);
    expect(elapsedMillis(b, a)).toBe(-MILLIS_PER_DAY);
  });

  it('orders committer times', () => {
    const a = unwrap(parseCommitterTime('2026-01-01T00:00:00Z'));
    const b = unwrap(parseCommitterTime('2026-06-01T00:00:00Z'));
    expect(compareCommitterTime(a, b)).toBe(-1);
    expect(compareCommitterTime(b, a)).toBe(1);
    expect(compareCommitterTime(a, a)).toBe(0);
  });

  it('compares equal instants spelled differently as equal', () => {
    const z = unwrap(parseCommitterTime('2026-07-21T14:03:00Z'));
    const offset = unwrap(parseCommitterTime('2026-07-21T16:03:00+02:00'));
    expect(compareCommitterTime(z, offset)).toBe(0);
  });
});

// Type-level: nothing but `parseCommitterTime`/`committerTimeFromEpochMillis` produces a
// CommitterTime, so `new Date().toISOString()` cannot reach a ledger event's `t`.
const _typeGuard: (t: CommitterTime) => number = committerTimeMillis;
void _typeGuard;
