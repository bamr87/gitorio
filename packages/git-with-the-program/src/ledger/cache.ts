// Implements: docs/spec/02-ledger.md §1 (the `accumulators/` tree: "a deterministic fold over
// events/") and §1 property 2 ("accumulator state is a fold over the event set: recomputable at
// will, cacheable, NEVER AUTHORITATIVE"), against docs/adr/0002-event-sourced-ledger.md.
//
// The derived cache, and the one question that matters about a derived cache: may this file be
// believed? ADR-0002 makes `events/` the only authority, so every answer here is CONSERVATIVE —
// `mayTrustCachedSnapshot` returns `trusted: true` only when every cheap check passes, and
// returns `trusted: false` for "I could not tell" exactly as it does for "I can tell it is
// wrong". A cache that says "probably fine" is worse than no cache: the whole value of the
// event-sourced design is that a doubt is answered by re-folding, which is always available.
//
// No I/O. The tree walk, the YAML emit and the ref push belong to the event store; this module
// turns state into the record that gets written and answers questions about a record that was
// read. Keeping it pure is what lets the staleness rule be property-tested.
//
// INV-003 NOTE — WHY NOTHING HERE MINTS A WARRANT. `toAccumulatorSnapshot` turns the METER into
// a plain `number`; that is a real declassification, and docs/spec/OPEN-QUESTIONS.md Q-40
// records what happens when such a function is reachable without one. If
// `materializeAccumulator(state)` took no warrant, a module under src/judge/** could import it
// FROM HERE and read `.value` as a number, and `scripts/check-inv003.ts` — which watches
// `core/{sentencing,accumulator,dispersion}` — would not see it. So the warrant is a PARAMETER
// at every declassification site in this file. Obtaining one still means calling
// `withSentencingWarrant`, which still means value-importing `../core/sentencing.js`, which the
// prescreen still fails under the blind directories. The door stays where the audit is looking.

import {
  committerTimeMillis,
  err,
  fail,
  isViolationEvent,
  knobsDigest,
  ok,
  optionalBoolean,
  optionalNumber,
  parseAccumulatorKey,
  parseCommitterTime,
  parseSha256Ref,
  rejectUnknownKeys,
  requireNumber,
  requireRecord,
  requireString,
  take,
  type AccumulatorKey,
  type AccumulatorSnapshot,
  type AccumulatorState,
  type CanonicalObject,
  type CommitterTime,
  type ContractError,
  type Decoded,
  type FoldKnobs,
  type LedgerEvent,
  type Parsed,
  type SentencingWarrant,
  type Sha256Ref,
} from '../core/index.js';
import { toAccumulatorSnapshot } from '../core/accumulator.js';
import { groupTipsByKey, type FoldResult } from './fold.js';

// ---------------------------------------------------------------------------
// Where a snapshot lives
// ---------------------------------------------------------------------------

/** `accumulators/<assertion-id>.yaml` (spec 02 §1 tree layout). */
export const ACCUMULATORS_DIR = 'accumulators';

/** Percent-encodes one byte the way `encodeURIComponent` does: `%` + uppercase hex. */
function percent(c: string): string {
  return `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
}

/** The characters `encodeURIComponent` leaves alone but a filesystem should not. */
const UNRESERVED_BUT_UNSAFE = /[!~*'()]/g;

/**
 * Spec 02 §1 writes `accumulators/<assertion-id>.yaml`, which is unambiguous for `INV-007` and
 * silent about the other arm of `AccumulatorKey`: obsolescence sweeps accumulate against a SCOPE
 * CLAIM (spec 02 §7, Q-04), and a claim key is any non-empty whitespace-free string — `src/**`
 * contains a `/` and a `*`, neither of which survives as a filename.
 *
 * Shipped (least-committal): percent-encode every character outside `[A-Za-z0-9._-]`, plus a
 * leading `.` so no key can name a dotfile or a directory traversal. `INV-007` is untouched, the
 * encoding is total, and `decodeAccumulatorFileName` inverts it exactly.
 * See docs/spec/OPEN-QUESTIONS.md Q-41.
 */
export function accumulatorFileName(key: AccumulatorKey): string {
  const encoded = encodeURIComponent(key).replace(UNRESERVED_BUT_UNSAFE, percent);
  const safe = encoded.startsWith('.') ? `%2E${encoded.slice(1)}` : encoded;
  return `${safe}.yaml`;
}

export function accumulatorFilePath(key: AccumulatorKey): string {
  return `${ACCUMULATORS_DIR}/${accumulatorFileName(key)}`;
}

/** The inverse of `accumulatorFileName`. Round-trips every key the parser accepts. */
export function decodeAccumulatorFileName(name: string): Parsed<AccumulatorKey> {
  if (!name.endsWith('.yaml')) {
    return fail('invalid-id', `accumulator files are \`.yaml\`, got ${JSON.stringify(name)}`);
  }
  const stem = name.slice(0, -'.yaml'.length);
  let decoded: string;
  try {
    decoded = decodeURIComponent(stem);
  } catch {
    return fail('invalid-id', `undecodable accumulator filename ${JSON.stringify(name)}`);
  }
  return parseAccumulatorKey(decoded);
}

// ---------------------------------------------------------------------------
// Materialization: state -> the record that gets written
// ---------------------------------------------------------------------------

export interface MaterializedAccumulator {
  readonly key: AccumulatorKey;
  /** Repo-relative path inside the ledger tree. */
  readonly path: string;
  readonly snapshot: AccumulatorSnapshot;
}

/**
 * The declassification site. Takes the warrant from its CALLER — see the module header.
 */
export function materializeAccumulator(
  state: AccumulatorState,
  warrant: SentencingWarrant,
): MaterializedAccumulator {
  return {
    key: state.key,
    path: accumulatorFilePath(state.key),
    snapshot: toAccumulatorSnapshot(state, warrant),
  };
}

/**
 * Every accumulator in a fold, in the fold's (sorted) key order — so two runs write the same
 * files in the same order and a tree diff is meaningful.
 */
export function materializeFold(
  result: FoldResult,
  warrant: SentencingWarrant,
): readonly MaterializedAccumulator[] {
  const out: MaterializedAccumulator[] = [];
  for (const key of result.keys) {
    const state = result.states.get(key);
    if (state === undefined) continue;
    out.push(materializeAccumulator(state, warrant));
  }
  return out;
}

const SNAPSHOT_KEYS = [
  'key',
  'value',
  'as_of',
  'last_event_at',
  'violation_count',
  'compliance_count',
  'abstention_count',
  'armed',
  'last_fired_at',
  'knobs',
  'event_count',
] as const;

/**
 * The YAML body, key order fixed. No JSON Schema binds this file (Q-08), so the encoder IS the
 * shape: a fixed key set with `null` written rather than omitted, for the same reason the event
 * minter emits one — two spellings of the same fact would make two caches of one state.
 */
export function encodeAccumulatorSnapshot(s: AccumulatorSnapshot): CanonicalObject {
  return {
    key: s.key,
    value: s.value,
    as_of: s.as_of,
    last_event_at: s.last_event_at,
    violation_count: s.violation_count,
    compliance_count: s.compliance_count,
    abstention_count: s.abstention_count,
    armed: s.armed,
    last_fired_at: s.last_fired_at,
    knobs: s.knobs,
    event_count: s.event_count,
  };
}

/**
 * Reads a cached snapshot back off the ref. Deliberately strict — an unknown key is an error,
 * matching the policy `gwtp validate` applies to the other unschema'd artifacts (Q-34): a typo
 * that silently does nothing is the worst outcome available in a file that decides whether a
 * fold gets skipped.
 *
 * A snapshot that will not decode is simply an absent cache. It is never a reason to fail: the
 * events are authoritative and the fold is always available (ADR-0002).
 */
export function decodeAccumulatorSnapshot(raw: unknown, at = ''): Decoded<AccumulatorSnapshot> {
  const rec = requireRecord(raw, at);
  if (!rec.ok) return err([rec.error]);
  const r = rec.value;
  const errors: ContractError[] = [];

  const keyRaw = take(requireString(r, 'key', at), errors);
  const key = keyRaw === undefined ? undefined : take(parseAccumulatorKey(keyRaw, `${at}/key`), errors);
  const value = take(requireNumber(r, 'value', at), errors);
  const knobsRaw = take(requireString(r, 'knobs', at), errors);
  const knobs = knobsRaw === undefined ? undefined : take(parseSha256Ref(knobsRaw, `${at}/knobs`), errors);

  const nullableTime = (field: 'as_of' | 'last_event_at' | 'last_fired_at'): CommitterTime | null => {
    const v = r[field];
    if (v === undefined || v === null) return null;
    return take(parseCommitterTime(v, `${at}/${field}`), errors) ?? null;
  };
  const asOf = nullableTime('as_of');
  const lastEventAt = nullableTime('last_event_at');
  const lastFiredAt = nullableTime('last_fired_at');

  const violationCount = take(optionalNumber(r, 'violation_count', at), errors) ?? 0;
  const complianceCount = take(optionalNumber(r, 'compliance_count', at), errors) ?? 0;
  const abstentionCount = take(optionalNumber(r, 'abstention_count', at), errors) ?? 0;
  const eventCount = take(optionalNumber(r, 'event_count', at), errors) ?? 0;

  // `armed` is REQUIRED, unlike the counters. Absence of a counter can only understate the
  // evidence; absence of the arm state would default a fired accumulator back to armed, and a
  // hand-edited cache would silently restore the ability to fire — hysteresis undone by an
  // omission (spec 02 §6). The encoder always writes it, so a missing one means tampering or a
  // format from another era, and either is a reason to re-fold.
  const armed = take(optionalBoolean(r, 'armed', at), errors);
  if (armed === undefined && r['armed'] === undefined) {
    errors.push({ code: 'missing-field', message: 'required field `armed` is absent', at: `${at}/armed` });
  }

  rejectUnknownKeys(r, SNAPSHOT_KEYS, at, errors);

  if (
    key === undefined ||
    value === undefined ||
    knobs === undefined ||
    armed === undefined ||
    errors.length > 0
  ) {
    return err(
      errors.length > 0 ? errors : [{ code: 'missing-field', message: 'incomplete snapshot', at }],
    );
  }

  return ok({
    key,
    value,
    as_of: asOf,
    last_event_at: lastEventAt,
    violation_count: violationCount,
    compliance_count: complianceCount,
    abstention_count: abstentionCount,
    armed,
    last_fired_at: lastFiredAt,
    knobs,
    event_count: eventCount,
  });
}

// ---------------------------------------------------------------------------
// Staleness: may this cache be believed?
// ---------------------------------------------------------------------------

/**
 * What a cached snapshot must agree with, derived from the EVENT SET without running the
 * arithmetic. Supersessions still have to be resolved and verdicts still have to be read — that
 * is what "which events belong to this accumulator" means — but no decay, no addition, and no
 * evidence list. `event_count` exists on the snapshot for exactly this comparison (spec 02 §1).
 *
 * Neither ADR-0002 nor spec 02 §1.2 says what "cheap staleness detection" actually compares, so
 * the list of facts below is this engine's answer and not the spec's; the count is of VIOLATING
 * tips, matching `contributing.length`, which is the half of the choice that is arguable.
 * See docs/spec/OPEN-QUESTIONS.md Q-44.
 */
export interface CacheFacts {
  readonly key: AccumulatorKey;
  readonly knobs: Sha256Ref;
  /** Violating tips for this key — the count `AccumulatorSnapshot.event_count` records. */
  readonly eventCount: number;
  readonly lastEventAt: CommitterTime | null;
}

export function cacheFacts(
  events: readonly LedgerEvent[],
  knobs: FoldKnobs,
): Parsed<ReadonlyMap<AccumulatorKey, CacheFacts>> {
  const digest = knobsDigest(knobs);
  if (!digest.ok) return digest;

  const grouping = groupTipsByKey(events);
  const out = new Map<AccumulatorKey, CacheFacts>();
  for (const key of grouping.keys) {
    const violations = (grouping.byKey.get(key) ?? []).filter(isViolationEvent);
    const last = violations[violations.length - 1];
    out.set(key, {
      key,
      knobs: digest.value,
      eventCount: violations.length,
      lastEventAt: last === undefined ? null : last.t,
    });
  }
  return ok(out);
}

/** Facts for one key. A key with no events has zero facts, which no non-empty cache matches. */
export function cacheFactsFor(
  events: readonly LedgerEvent[],
  key: AccumulatorKey,
  knobs: FoldKnobs,
): Parsed<CacheFacts> {
  const all = cacheFacts(events, knobs);
  if (!all.ok) return all;
  const hit = all.value.get(key);
  if (hit !== undefined) return ok(hit);
  const digest = knobsDigest(knobs);
  if (!digest.ok) return digest;
  return ok({ key, knobs: digest.value, eventCount: 0, lastEventAt: null });
}

export type CacheStalenessReason =
  /** No cache file, or one that would not decode. */
  | 'absent'
  /** The snapshot is for a different accumulator. */
  | 'key-mismatch'
  /** `knobsDigest` differs: a retuned half-life, budget, precision override or re-arm fraction. */
  | 'knobs-retuned'
  /** The event set grew, shrank, or was re-superseded under the cache. */
  | 'event-count-mismatch'
  /** Same count, different tip: a supersession swapped an event out. */
  | 'last-event-mismatch'
  /** The cache was taken before the newest violating event. */
  | 'as-of-behind'
  /** A meter reading that is not a finite non-negative number. */
  | 'invalid-value'
  /** The facts could not be computed, so the question could not be answered. */
  | 'indeterminate';

export interface CacheVerdict {
  /**
   * `true` only when every check passed. Even then it means "this snapshot agrees with the
   * event set", never "this snapshot is the truth" — the events are authoritative (ADR-0002).
   */
  readonly trusted: boolean;
  readonly reasons: readonly CacheStalenessReason[];
  readonly detail: readonly string[];
}

const TRUSTED: CacheVerdict = { trusted: true, reasons: [], detail: [] };

/**
 * The conservative answer (Q-44). Every disagreement between the snapshot and the facts is a
 * reason to re-fold, and so is every question this function cannot decide. `trusted: true` means
 * "this snapshot agrees with the event set", never "this snapshot is the truth": `events/` is the
 * only authority (ADR-0002) and re-folding is always available.
 */
export function mayTrustCachedSnapshot(
  snapshot: AccumulatorSnapshot | null | undefined,
  facts: CacheFacts,
): CacheVerdict {
  const reasons: CacheStalenessReason[] = [];
  const detail: string[] = [];
  const note = (reason: CacheStalenessReason, message: string): void => {
    reasons.push(reason);
    detail.push(message);
  };

  if (snapshot === null || snapshot === undefined) {
    return { trusted: false, reasons: ['absent'], detail: ['no cached snapshot'] };
  }
  if (snapshot.key !== facts.key) {
    note('key-mismatch', `snapshot is keyed ${snapshot.key}, expected ${facts.key}`);
  }
  if (snapshot.knobs !== facts.knobs) {
    note('knobs-retuned', `snapshot was folded under knobs ${snapshot.knobs}, now ${facts.knobs}`);
  }
  if (snapshot.event_count !== facts.eventCount) {
    note(
      'event-count-mismatch',
      `snapshot counts ${snapshot.event_count} contributing event(s), the set has ${facts.eventCount}`,
    );
  }
  if (snapshot.last_event_at !== facts.lastEventAt) {
    note(
      'last-event-mismatch',
      `snapshot's last violating event is ${String(snapshot.last_event_at)}, the set's is ${String(facts.lastEventAt)}`,
    );
  }
  if (facts.lastEventAt !== null) {
    const asOf = snapshot.as_of;
    if (asOf === null || committerTimeMillis(asOf) < committerTimeMillis(facts.lastEventAt)) {
      note('as-of-behind', `snapshot is as of ${String(asOf)}, behind ${facts.lastEventAt}`);
    }
  }
  if (!Number.isFinite(snapshot.value) || snapshot.value < 0) {
    note('invalid-value', `snapshot value ${String(snapshot.value)} is not a meter reading`);
  }

  return reasons.length === 0 ? TRUSTED : { trusted: false, reasons, detail };
}

/**
 * The whole question in one call. An event set that cannot even be reduced to facts yields
 * `indeterminate` — untrusted, because "I could not look" must never read as "clean".
 */
export function mayTrustCachedSnapshotFor(
  snapshot: AccumulatorSnapshot | null | undefined,
  events: readonly LedgerEvent[],
  key: AccumulatorKey,
  knobs: FoldKnobs,
): CacheVerdict {
  const facts = cacheFactsFor(events, key, knobs);
  if (!facts.ok) {
    return {
      trusted: false,
      reasons: ['indeterminate'],
      detail: [`could not derive cache facts: ${facts.error.message}`],
    };
  }
  return mayTrustCachedSnapshot(snapshot, facts.value);
}

/** One line per reason, for `gwtp ledger status`. */
export function explainCacheVerdict(v: CacheVerdict): string {
  if (v.trusted) return 'cache agrees with the event set (still derived, never authoritative)';
  return v.detail.map((d, i) => `${v.reasons[i] ?? 'indeterminate'}: ${d}`).join('\n');
}
