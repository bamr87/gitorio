// Implements: docs/adr/0005-anchored-severity.md and docs/spec/03-judge.md §4-5
// ("grazes | bends | breach | entrenches -> 0.25 / 0.5 / 0.75 / 1.0"; panels take a MEDIAN
// on the ordinal scale, never a mean). The one place the ordinal scale and the numeric
// scale meet.

import { fail, ok, type Parsed } from './result.js';

/** The judge-facing scale (gwtp/verdict.schema.json#/properties/severity). Four rungs, no float. */
export type SeverityOrdinal = 'grazes' | 'bends' | 'breach' | 'entrenches';

/**
 * The ledger-facing scale (gwtp/event.schema.json#/properties/severity, enum
 * `[0.25, 0.5, 0.75, 1.0]`). A CLOSED numeric literal union, so `severity: 0.6` is a compile
 * error in the ledger event type, not a runtime one — ADR-0005's "not a bare float" stated
 * in the type system.
 *
 * `1.0` is written `1` because TypeScript and JSON both normalize it; the schema enum matches
 * numerically and canonicalize() emits `1`. See docs/spec/OPEN-QUESTIONS.md Q-16.
 */
export type SeverityWeight = 0.25 | 0.5 | 0.75 | 1;

/** Ascending. The index IS the ordinal rank. */
export const SEVERITY_ORDINALS = [
  'grazes',
  'bends',
  'breach',
  'entrenches',
] as const satisfies readonly SeverityOrdinal[];

export const SEVERITY_WEIGHTS = [0.25, 0.5, 0.75, 1] as const satisfies readonly SeverityWeight[];

/**
 * ADR-0005's fixed mapping. The `satisfies Record<...>` is the enforcement: adding a fifth
 * ordinal without a weight, or drifting a weight off the four anchors, fails to compile.
 */
export const SEVERITY_WEIGHT = {
  grazes: 0.25,
  bends: 0.5,
  breach: 0.75,
  entrenches: 1,
} as const satisfies Record<SeverityOrdinal, SeverityWeight>;

/** The inverse map, also `satisfies`-checked, so the two constants cannot drift apart. */
export const SEVERITY_ORDINAL_BY_WEIGHT = {
  0.25: 'grazes',
  0.5: 'bends',
  0.75: 'breach',
  1: 'entrenches',
} as const satisfies Record<SeverityWeight, SeverityOrdinal>;

export const SEVERITY_RANK = {
  grazes: 0,
  bends: 1,
  breach: 2,
  entrenches: 3,
} as const satisfies Record<SeverityOrdinal, 0 | 1 | 2 | 3>;

/**
 * The membership test for the closed ordinal union, and the ONLY one in this module.
 *
 * `SEVERITY_ORDINALS.includes(...)` compares against the four literals themselves. Contrast
 * `raw in SEVERITY_WEIGHT` / `SEVERITY_WEIGHT[raw] !== undefined`, both of which resolve
 * through `Object.prototype` and admit eight names that are not severities at all.
 */
export function isSeverityOrdinal(raw: string): raw is SeverityOrdinal {
  return (SEVERITY_ORDINALS as readonly string[]).includes(raw);
}

/** The same closed-union test on the numeric side, for symmetry at call sites. */
export function isSeverityWeight(raw: number): raw is SeverityWeight {
  return (SEVERITY_WEIGHTS as readonly number[]).includes(raw);
}

/** Ordinal -> numeric. The ONLY sanctioned direction at judgment time (spec 03 §4). Total. */
export function severityWeight(ordinal: SeverityOrdinal): SeverityWeight {
  return SEVERITY_WEIGHT[ordinal];
}

/** Numeric -> ordinal. Total, because SeverityWeight is a closed union. */
export function severityOrdinal(weight: SeverityWeight): SeverityOrdinal {
  return SEVERITY_ORDINAL_BY_WEIGHT[weight];
}

export function severityRank(ordinal: SeverityOrdinal): 0 | 1 | 2 | 3 {
  return SEVERITY_RANK[ordinal];
}

export function compareSeverity(a: SeverityOrdinal, b: SeverityOrdinal): -1 | 0 | 1 {
  const d = severityRank(a) - severityRank(b);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

/**
 * The gate on LLM output: anything outside the four anchors is REJECTED, never coerced.
 *
 * Membership is tested against `SEVERITY_ORDINALS` — the closed union written out as a list —
 * and NOT with `raw in SEVERITY_WEIGHT`. The `in` operator walks the prototype chain, so
 * `"toString"`, `"constructor"`, `"valueOf"`, `"__proto__"` and the rest of `Object.prototype`
 * would all pass the gate and be cast to `SeverityOrdinal`. Downstream that is not a cosmetic
 * bug: `severityWeight("toString")` returns a FUNCTION typed as `SeverityWeight`, so
 * `precision_at · severity` becomes `NaN`, and `NaN >= budget` is false forever — an assertion
 * silently disarmed by a single word in a model's JSON. A closed union is checked against the
 * list that defines it.
 */
export function parseSeverityOrdinal(raw: unknown, at?: string): Parsed<SeverityOrdinal> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string severity', at);
  if (!isSeverityOrdinal(raw)) {
    return fail(
      'invalid-severity',
      `severity must be one of ${SEVERITY_ORDINALS.join(' | ')}, got ${JSON.stringify(raw)}`,
      at,
      'gwtp/verdict.schema.json#/properties/severity',
    );
  }
  return ok(raw);
}

export function parseSeverityWeight(raw: unknown, at?: string): Parsed<SeverityWeight> {
  if (typeof raw !== 'number') return fail('wrong-type', 'expected a numeric severity', at);
  const hit = SEVERITY_WEIGHTS.find((w) => w === raw);
  if (hit === undefined) {
    return fail(
      'invalid-severity',
      `severity must be one of ${SEVERITY_WEIGHTS.join(' | ')}, got ${raw}`,
      at,
      'gwtp/event.schema.json#/properties/severity',
    );
  }
  return ok(hit);
}

/**
 * Panel median (spec 03 §5). On an EVEN sample size the LOWER of the two middle rungs wins:
 * panels resolve toward leniency, because a split bench is exactly the uncertainty the spec
 * says belongs in the ledger rather than papered over.
 */
export function medianSeverityOrdinal(
  samples: readonly SeverityOrdinal[],
): Parsed<SeverityOrdinal> {
  if (samples.length === 0) {
    return fail('invalid-severity', 'median of an empty panel is undefined');
  }
  const sorted = [...samples].sort(compareSeverity);
  const index = Math.ceil(sorted.length / 2) - 1;
  return ok(sorted[index] as SeverityOrdinal);
}

/**
 * max rung index - min rung index: the inter-judge disagreement measure a panel discounts
 * effective surprise by, or escalates on (spec 03 §5). 0 for fewer than two samples.
 */
export function severityRungSpread(samples: readonly SeverityOrdinal[]): number {
  if (samples.length < 2) return 0;
  const ranks = samples.map(severityRank);
  return Math.max(...ranks) - Math.min(...ranks);
}
