// Implements: docs/adr/0004-committer-time-decay.md (decay runs on committer time) and
// docs/spec/01-core-memory.md §3 (`half_life` grammar), against
// schemas/assertion.schema.json#/properties/half_life and schemas/event.schema.json#/properties/t.
//
// Two clocks, both of which preserve their SOURCE TEXT. That is load-bearing: the event
// content hash is computed over the stored spelling, so re-reading and re-hashing an event
// must not drift. Minting has exactly one normalized form.

import type { Brand } from './brand.js';
import { fail, ok, type Parsed } from './result.js';

// ---------------------------------------------------------------------------
// Durations and half-lives
// ---------------------------------------------------------------------------

/** The `(d|w|mo)` alternation of gwtp/assertion.schema.json#/properties/half_life. */
export type DurationUnit = 'd' | 'w' | 'mo';

/** Mirrors gwtp/assertion.schema.json#/properties/half_life VERBATIM. */
export const HALF_LIFE_PATTERN = /^[0-9]+(d|w|mo)$/;

const DURATION_CAPTURE = /^([0-9]+)(d|w|mo)$/;

export const MILLIS_PER_DAY = 86_400_000;

/**
 * `mo` is not defined anywhere in the specs, and committer-time decay needs a constant.
 * 30 days exactly is the least-committal choice: integral, hand-computable, replay-stable,
 * and it reproduces the spec's own fixture (8 months against 90d ≈ 15%; spec 04 §7).
 * See docs/spec/OPEN-QUESTIONS.md Q-01.
 */
export const DAYS_PER_UNIT = { d: 1, w: 7, mo: 30 } as const satisfies Record<DurationUnit, number>;

export const DURATION_UNIT_MILLIS = {
  d: MILLIS_PER_DAY,
  w: 7 * MILLIS_PER_DAY,
  mo: 30 * MILLIS_PER_DAY,
} as const satisfies Record<DurationUnit, number>;

export interface Duration {
  readonly count: number;
  readonly unit: DurationUnit;
  readonly millis: number;
  /** Verbatim source text (`90d`), re-emitted on encode so YAML round-trips byte-identically. */
  readonly source: string;
}

/** Glossary alias. A half-life IS a duration; the fold multiplies them freely. */
export type HalfLife = Duration;

/**
 * Accepts `0d`, because the schema pattern admits it. Divergence would be a semantic edit
 * to schemas/**, which SEED-01 may not make; `decayFactor` pins the degenerate behaviour
 * instead. See docs/spec/OPEN-QUESTIONS.md Q-02.
 */
export function parseDuration(raw: unknown, at?: string): Parsed<Duration> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string duration', at);
  const m = DURATION_CAPTURE.exec(raw);
  if (m === null) {
    return fail(
      'invalid-duration',
      `expected ${HALF_LIFE_PATTERN.source}, got ${JSON.stringify(raw)}`,
      at,
      'gwtp/assertion.schema.json#/properties/half_life',
    );
  }
  const count = Number.parseInt(m[1] as string, 10);
  const unit = m[2] as DurationUnit;
  return ok({ count, unit, millis: count * DURATION_UNIT_MILLIS[unit], source: raw });
}

export function durationMillis(d: Duration): number {
  return d.millis;
}

export function durationDays(d: Duration): number {
  return d.count * DAYS_PER_UNIT[d.unit];
}

export function formatDuration(d: Duration): string {
  return d.source;
}

export function makeDuration(count: number, unit: DurationUnit): Parsed<Duration> {
  if (!Number.isInteger(count) || count < 0) {
    return fail('invalid-duration', `duration count must be a non-negative integer, got ${count}`);
  }
  return ok({ count, unit, millis: count * DURATION_UNIT_MILLIS[unit], source: `${count}${unit}` });
}

// ---------------------------------------------------------------------------
// Committer time
// ---------------------------------------------------------------------------

/**
 * Committer time, NEVER observation time (ADR-0004). A branded string rather than a Date:
 * the exact text is part of the hashed event body and must survive a read/write round trip.
 *
 * Deliberately permissive on the read path — spec 02 §2's own example event carries
 * `t: 2026-07-21T14:03Z`, which omits seconds and therefore fails ajv-formats' `date-time`.
 * Rejecting it here would reject the spec's own record. See OPEN-QUESTIONS Q-07.
 */
export type CommitterTime = Brand<string, 'CommitterTime'>;

export const RFC3339_LENIENT_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/;

/** Validates and brands the ORIGINAL text, unchanged. */
export function parseCommitterTime(raw: unknown, at?: string): Parsed<CommitterTime> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string timestamp', at);
  if (!RFC3339_LENIENT_PATTERN.test(raw)) {
    return fail(
      'invalid-timestamp',
      `expected an RFC 3339 date-time, got ${JSON.stringify(raw)}`,
      at,
      'gwtp/event.schema.json#/properties/t',
    );
  }
  if (!Number.isFinite(Date.parse(raw))) {
    return fail('invalid-timestamp', `unparseable date-time ${JSON.stringify(raw)}`, at);
  }
  return ok(raw as CommitterTime);
}

/**
 * The MINTING path, and the one normalized form: UTC, second precision, `Z`, no fractional
 * seconds (`2026-07-21T14:03:00Z`). Anything GWTP writes therefore validates under
 * ajv-formats `date-time`, and two writers agree byte-for-byte on the same instant — which
 * is what keeps the event content hash an idempotency key (spec 02 §1).
 */
export function committerTimeFromEpochMillis(ms: number, at?: string): Parsed<CommitterTime> {
  if (!Number.isFinite(ms)) return fail('invalid-timestamp', `non-finite epoch millis: ${ms}`, at);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return fail('invalid-timestamp', `out-of-range epoch millis: ${ms}`, at);
  return ok(d.toISOString().replace(/\.\d{3}Z$/, 'Z') as CommitterTime);
}

export function committerTimeMillis(t: CommitterTime): number {
  return Date.parse(t);
}

/** Signed. Callers that must not run time backwards (decay) clamp explicitly. */
export function elapsedMillis(from: CommitterTime, to: CommitterTime): number {
  return committerTimeMillis(to) - committerTimeMillis(from);
}

export function compareCommitterTime(a: CommitterTime, b: CommitterTime): number {
  const d = committerTimeMillis(a) - committerTimeMillis(b);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

/** Re-emits a committer time in the canonical mint form. Used only for display/normalization. */
export function normalizeCommitterTime(t: CommitterTime): Parsed<CommitterTime> {
  return committerTimeFromEpochMillis(committerTimeMillis(t));
}
