// Implements: docs/spec/01-core-memory.md §3 (the assertion atom) and §4 (the two
// non-negotiable field rules), against schemas/assertion.schema.json. The compiled program's
// atom.
//
// Persisted field names are snake_case, matching the YAML/JSON byte-for-byte. There is no
// camelCase mapping layer anywhere in GWTP: a rename layer would sit between the schema and
// the content hash, and content addressing is unforgiving.

import type { Brand, NonEmptyReadonlyArray } from './brand.js';
import { isNonEmpty } from './brand.js';
import type { CanonicalObject } from './canonical.js';
import {
  optionalNumber,
  optionalString,
  requireArray,
  requireEnum,
  requireRecord,
  requireString,
  requireStringArray,
  take,
} from './decode.js';
import {
  type AssertionId,
  type CandidateId,
  type InvariantId,
  type ProvenanceRef,
  isCandidateId,
  parseAssertionId,
} from './ids.js';
import { type PathGlob, parsePathGlob } from './paths.js';
import { type ContractError, collectResults, err, fail, ok, type Decoded, type Parsed } from './result.js';
import { type HalfLife, parseDuration } from './time.js';

const SCHEMA = 'gwtp/assertion.schema.json';

export type AssertionClass =
  | 'boundary'
  | 'dependency'
  | 'interface'
  | 'behavior'
  | 'convention';

export const ASSERTION_CLASSES = [
  'boundary',
  'dependency',
  'interface',
  'behavior',
  'convention',
] as const satisfies readonly AssertionClass[];

/** Rung on the judgment ladder (spec 01 §3, spec 03 §1). */
export type Enforcement = 'deterministic' | 'judgment' | 'hybrid';

export const ENFORCEMENTS = [
  'deterministic',
  'judgment',
  'hybrid',
] as const satisfies readonly Enforcement[];

/** A lifecycle, not a flag (spec 01 §4.2). */
export type AssertionStatus = 'inferred' | 'ratified' | 'contested' | 'amended' | 'retired';

export const ASSERTION_STATUSES = [
  'inferred',
  'ratified',
  'contested',
  'amended',
  'retired',
] as const satisfies readonly AssertionStatus[];

/**
 * Surprise weight per violation; synaptic weight. Schema: exclusiveMinimum 0, maximum 1.
 * A refinement brand, not opaque: precision is normative program data, published in every
 * proposal, and multiplied by severity in the fold. It is not a secret. Contrast `Surprise`.
 */
export type Precision = Brand<number, 'Precision'>;

/** Accumulated-surprise threshold that fires a proposal; the decision bound. Schema: > 0. */
export type Budget = Brand<number, 'Budget'>;

export function parsePrecision(raw: unknown, at?: string): Parsed<Precision> {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fail('wrong-type', 'precision must be a finite number', at);
  }
  if (!(raw > 0 && raw <= 1)) {
    return fail(
      'invalid-precision',
      `precision must be in (0, 1], got ${raw}`,
      at,
      `${SCHEMA}#/properties/precision`,
    );
  }
  return ok(raw as Precision);
}

export function parseBudget(raw: unknown, at?: string): Parsed<Budget> {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fail('wrong-type', 'budget must be a finite number', at);
  }
  if (!(raw > 0)) {
    return fail(
      'invalid-budget',
      `budget must be > 0, got ${raw}`,
      at,
      `${SCHEMA}#/properties/budget`,
    );
  }
  return ok(raw as Budget);
}

/** gwtp/assertion.schema.json#/properties/evidence — "for CAND-* entries" (spec 04 §5). */
export interface DistillationEvidence {
  readonly span?: string;
  readonly corroborations?: readonly ProvenanceRef[];
}

export interface AssertionFields {
  /** minLength 8 in the schema. */
  readonly statement: string;
  readonly class: AssertionClass;
  readonly scope: NonEmptyReadonlyArray<PathGlob>;
  readonly enforcement: Enforcement;
  readonly precision: Precision;
  readonly budget: Budget;
  /** Parsed form of the schema's `half_life` string; `Duration.source` re-emits it verbatim. */
  readonly half_life: HalfLife;
  /**
   * "No assertion without provenance" — spec 01 §4 rule 1 and `minItems: 1` in the schema,
   * made UNREPRESENTABLE rather than merely invalid.
   */
  readonly provenance: NonEmptyReadonlyArray<ProvenanceRef>;
  /** Distillation-derived; informational after ratification. The schema places no bounds. */
  readonly precision_seed?: number;
  readonly evidence?: DistillationEvidence;
}

export interface InvariantAssertion extends AssertionFields {
  readonly id: InvariantId;
  readonly status: AssertionStatus;
}

/**
 * gwtp/assertion.schema.json#/allOf/0: `if id matches ^CAND- then status const 'inferred'`.
 * Spec 04 §4: "Distillation may only emit `inferred`."
 *
 * The schema's conditional becomes a STRUCTURAL IMPOSSIBILITY: there is no way to spell a
 * CAND-* assertion with `status: ratified`. A distillation miner whose return type is
 * `CandidateAssertion[]` cannot self-ratify even by mistake.
 */
export interface CandidateAssertion extends AssertionFields {
  readonly id: CandidateId;
  readonly status: 'inferred';
}

export type Assertion = InvariantAssertion | CandidateAssertion;

/**
 * The only type judge-routing code accepts. Because `contested` is a different type,
 * "enforcement mutes while contested" (spec 01 §4.2) stops being a runtime branch someone
 * can forget and becomes a type error at the bench boundary.
 */
export type RatifiedAssertion = InvariantAssertion & { readonly status: 'ratified' };

export function isCandidateAssertion(a: Assertion): a is CandidateAssertion {
  return isCandidateId(a.id);
}

export function isInvariantAssertion(a: Assertion): a is InvariantAssertion {
  return !isCandidateId(a.id);
}

/**
 * spec 01 §4.2: `inferred` is not enforced; `ratified` is; `contested` MUTES enforcement
 * while a reprogramming PR is open; `amended`/`retired` are terminal. So: enforced iff
 * ratified. This single predicate is the enforcement gate for the whole engine.
 */
export function isEnforced(a: Assertion): boolean {
  return a.status === 'ratified';
}

/** The single narrowing point from Assertion to RatifiedAssertion. */
export function isEnforceable(a: Assertion): a is RatifiedAssertion {
  return isInvariantAssertion(a) && a.status === 'ratified';
}

// ---------------------------------------------------------------------------
// Decode / encode
// ---------------------------------------------------------------------------

const KNOWN_KEYS = [
  'id',
  'statement',
  'class',
  'scope',
  'enforcement',
  'precision',
  'budget',
  'half_life',
  'status',
  'provenance',
  'precision_seed',
  'evidence',
] as const;

function decodeEvidence(raw: unknown, at: string): Parsed<DistillationEvidence | undefined> {
  if (raw === undefined || raw === null) return ok(undefined);
  const rec = requireRecord(raw, at);
  if (!rec.ok) return rec;
  const span = optionalString(rec.value, 'span', at);
  if (!span.ok) return span;
  let corroborations: readonly string[] | undefined;
  if (rec.value['corroborations'] !== undefined && rec.value['corroborations'] !== null) {
    const arr = requireStringArray(rec.value, 'corroborations', at);
    if (!arr.ok) return arr;
    corroborations = arr.value;
  }
  const out: { -readonly [K in keyof DistillationEvidence]?: DistillationEvidence[K] } = {};
  if (span.value !== undefined) out.span = span.value;
  if (corroborations !== undefined) out.corroborations = corroborations;
  return ok(out);
}

export function decodeAssertion(raw: unknown, at = ''): Decoded<Assertion> {
  const rec = requireRecord(raw, at);
  if (!rec.ok) return err([rec.error]);
  const r = rec.value;
  const errors: ContractError[] = [];

  const idRaw = take(requireString(r, 'id', at), errors);
  const id = idRaw === undefined ? undefined : take(parseAssertionId(idRaw, `${at}/id`), errors);
  const statement = take(requireString(r, 'statement', at, 8), errors);
  const klass = take(
    requireEnum(r, 'class', ASSERTION_CLASSES, at, `${SCHEMA}#/properties/class`),
    errors,
  );
  const enforcement = take(
    requireEnum(r, 'enforcement', ENFORCEMENTS, at, `${SCHEMA}#/properties/enforcement`),
    errors,
  );
  const status = take(
    requireEnum(r, 'status', ASSERTION_STATUSES, at, `${SCHEMA}#/properties/status`),
    errors,
  );
  const precision = take(parsePrecision(r['precision'], `${at}/precision`), errors);
  const budget = take(parseBudget(r['budget'], `${at}/budget`), errors);
  const halfLife = take(parseDuration(r['half_life'], `${at}/half_life`), errors);
  const precisionSeed = take(optionalNumber(r, 'precision_seed', at), errors);
  const evidence = take(decodeEvidence(r['evidence'], `${at}/evidence`), errors);

  const scopeRaw = take(requireStringArray(r, 'scope', at, 1), errors);
  const scope: PathGlob[] = [];
  if (scopeRaw !== undefined) {
    scopeRaw.forEach((g, i) => {
      const p = take(parsePathGlob(g, `${at}/scope/${i}`), errors);
      if (p !== undefined) scope.push(p);
    });
  }

  const provenance = take(requireStringArray(r, 'provenance', at, 1), errors);

  for (const key of Object.keys(r)) {
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
      errors.push({ code: 'strictness', message: `unknown field \`${key}\``, at: `${at}/${key}` });
    }
  }

  if (
    id === undefined ||
    statement === undefined ||
    klass === undefined ||
    enforcement === undefined ||
    status === undefined ||
    precision === undefined ||
    budget === undefined ||
    halfLife === undefined ||
    provenance === undefined
  ) {
    return err(errors.length > 0 ? errors : [{ code: 'missing-field', message: 'incomplete assertion', at }]);
  }

  if (!isNonEmpty(scope)) {
    errors.push({ code: 'wrong-type', message: 'scope requires minItems 1', at: `${at}/scope` });
    return err(errors);
  }
  if (!isNonEmpty(provenance)) {
    errors.push({
      code: 'missing-field',
      message: 'no assertion without provenance (spec 01 §4 rule 1)',
      at: `${at}/provenance`,
    });
    return err(errors);
  }

  const fields: AssertionFields = {
    statement,
    class: klass,
    scope,
    enforcement,
    precision,
    budget,
    half_life: halfLife,
    provenance,
    ...(precisionSeed !== undefined ? { precision_seed: precisionSeed } : {}),
    ...(evidence !== undefined ? { evidence } : {}),
  };

  if (isCandidateId(id)) {
    if (status !== 'inferred') {
      errors.push({
        code: 'invalid-enum',
        message: 'CAND-* assertions may only carry status `inferred` (spec 04 §4)',
        at: `${at}/status`,
        clause: `${SCHEMA}#/allOf/0`,
      });
      return err(errors);
    }
    if (errors.length > 0) return err(errors);
    const candidate: CandidateAssertion = { ...fields, id, status: 'inferred' };
    return ok(candidate);
  }

  if (errors.length > 0) return err(errors);
  const invariant: InvariantAssertion = { ...fields, id: id as InvariantId, status };
  return ok(invariant);
}

/** `.program/invariants.yaml` is a bare sequence of assertions; an empty file is legal. */
export function decodeInvariantsFile(raw: unknown, at = ''): Decoded<readonly Assertion[]> {
  if (raw === null || raw === undefined) return ok([]);
  const arr = requireArray(raw, at);
  if (!arr.ok) return err([arr.error]);
  return collectResults(arr.value.map((item, i) => decodeAssertion(item, `${at}/${i}`)));
}

export function encodeAssertion(a: Assertion): CanonicalObject {
  return {
    id: a.id,
    statement: a.statement,
    class: a.class,
    scope: [...a.scope],
    enforcement: a.enforcement,
    precision: a.precision,
    budget: a.budget,
    half_life: a.half_life.source,
    status: a.status,
    provenance: [...a.provenance],
    precision_seed: a.precision_seed,
    evidence:
      a.evidence === undefined
        ? undefined
        : {
            span: a.evidence.span,
            corroborations:
              a.evidence.corroborations === undefined ? undefined : [...a.evidence.corroborations],
          },
  };
}

/** The set of ids this assertion is keyed by, for accumulator lookup. */
export function assertionKey(a: Assertion): AssertionId {
  return a.id;
}
