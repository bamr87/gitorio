// Implements: docs/spec/01-core-memory.md §5 (precedents — the regression memory), against
// schemas/precedent.schema.json. Serves three masters: the regression judge's retrieval
// corpus (spec 03 §7), the judges' bar exam (spec 03 §6), and distillation tombstones
// (spec 04 §6).

import type { NonEmptyReadonlyArray } from './brand.js';
import { isNonEmpty } from './brand.js';
import type { CanonicalObject } from './canonical.js';
import {
  optionalString,
  requireArray,
  requireEnum,
  requireRecord,
  requireString,
  requireStringArray,
  take,
} from './decode.js';
import { type PrecedentId, type ProvenanceRef, parsePrecedentId } from './ids.js';
import { type ContractError, collectResults, err, ok, type Decoded } from './result.js';

const SCHEMA = 'gwtp/precedent.schema.json';

/**
 * `killed`      — the regression judge's retrieval corpus (spec 03 §7).
 * `affirmed`    — written when a reprogramming proposal is rejected; precision rises (spec 02 §6).
 * `coincidence` — a human's rejection of an inferred regularity: a tombstone against
 *                 re-distillation (spec 04 §6).
 */
export type PrecedentRuling = 'killed' | 'affirmed' | 'coincidence';

export const PRECEDENT_RULINGS = [
  'killed',
  'affirmed',
  'coincidence',
] as const satisfies readonly PrecedentRuling[];

export interface Precedent {
  readonly id: PrecedentId;
  readonly pattern: string;
  readonly ruling: PrecedentRuling;
  /**
   * Genuinely optional here (not in the schema's `required`), unlike on a violation verdict
   * where it is mandatory. The types keep that asymmetry rather than smoothing it.
   */
  readonly rationale?: string;
  /** minItems 1. "Doubles as the judges' bar-exam corpus." */
  readonly evidence: NonEmptyReadonlyArray<ProvenanceRef>;
}

/** The retrieval corpus for the regression judge (spec 03 §7 step 1). */
export function isKilledPattern(p: Precedent): boolean {
  return p.ruling === 'killed';
}

/**
 * `coincidence` — a human's rejection of an inferred regularity. Distillation MUST check
 * tombstones before proposing any candidate (spec 04 §6).
 */
export function isTombstone(p: Precedent): boolean {
  return p.ruling === 'coincidence';
}

/**
 * What the regression judge sees (prompts/regression-judge.md's slots). No evidence links:
 * they name authors and PR threads, and blindness is structural (ADR-0003). Settled case law
 * is normative and the regression judge is REQUIRED to read it — case law yes, running case
 * history no.
 */
export interface PrecedentView {
  readonly id: PrecedentId;
  readonly pattern: string;
  readonly ruling: PrecedentRuling;
  readonly rationale: string;
}

export function precedentView(p: Precedent): PrecedentView {
  return {
    id: p.id,
    pattern: p.pattern,
    ruling: p.ruling,
    rationale: p.rationale ?? '',
  };
}

const KNOWN_KEYS = ['id', 'pattern', 'ruling', 'rationale', 'evidence'] as const;

export function decodePrecedent(raw: unknown, at = ''): Decoded<Precedent> {
  const rec = requireRecord(raw, at);
  if (!rec.ok) return err([rec.error]);
  const r = rec.value;
  const errors: ContractError[] = [];

  const idRaw = take(requireString(r, 'id', at), errors);
  const id = idRaw === undefined ? undefined : take(parsePrecedentId(idRaw, `${at}/id`), errors);
  const pattern = take(requireString(r, 'pattern', at, 1), errors);
  const ruling = take(
    requireEnum(r, 'ruling', PRECEDENT_RULINGS, at, `${SCHEMA}#/properties/ruling`),
    errors,
  );
  const rationale = take(optionalString(r, 'rationale', at), errors);
  const evidence = take(requireStringArray(r, 'evidence', at, 1), errors);

  for (const key of Object.keys(r)) {
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
      errors.push({ code: 'strictness', message: `unknown field \`${key}\``, at: `${at}/${key}` });
    }
  }

  if (id === undefined || pattern === undefined || ruling === undefined || evidence === undefined) {
    return err(errors.length > 0 ? errors : [{ code: 'missing-field', message: 'incomplete precedent', at }]);
  }
  if (!isNonEmpty(evidence)) {
    errors.push({ code: 'wrong-type', message: 'evidence requires minItems 1', at: `${at}/evidence` });
    return err(errors);
  }
  if (errors.length > 0) return err(errors);

  return ok({
    id,
    pattern,
    ruling,
    ...(rationale !== undefined ? { rationale } : {}),
    evidence,
  });
}

/** `.program/precedents.yaml` ships as `[]`; the empty case is legal and load-bearing. */
export function decodePrecedentsFile(raw: unknown, at = ''): Decoded<readonly Precedent[]> {
  if (raw === null || raw === undefined) return ok([]);
  const arr = requireArray(raw, at);
  if (!arr.ok) return err([arr.error]);
  return collectResults(arr.value.map((item, i) => decodePrecedent(item, `${at}/${i}`)));
}

export function encodePrecedent(p: Precedent): CanonicalObject {
  return {
    id: p.id,
    pattern: p.pattern,
    ruling: p.ruling,
    rationale: p.rationale,
    evidence: [...p.evidence],
  };
}
