// Implements: docs/spec/01-core-memory.md §2 (`.program/` layout) and INV-006 (everything
// validates against schemas/). Field-reading helpers shared by every document decoder in
// src/core, so a decoder is a list of field rules rather than a wall of typeof checks.
//
// ajv remains authoritative for INV-006 in `gwtp validate`; these decoders add the
// cross-field rules and range invariants a draft-07 schema cannot project into types.

import { fail, ok, type ContractError, type Parsed } from './result.js';

export function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === 'object' && u !== null && !Array.isArray(u);
}

export function requireRecord(u: unknown, at: string): Parsed<Record<string, unknown>> {
  if (!isRecord(u)) return fail('wrong-type', 'expected an object', at);
  return ok(u);
}

export function requireArray(u: unknown, at: string): Parsed<readonly unknown[]> {
  if (!Array.isArray(u)) return fail('wrong-type', 'expected an array', at);
  return ok(u as readonly unknown[]);
}

/**
 * `Object.hasOwn`, never `key in rec`: `in` walks the prototype chain, so a document that
 * simply omits `constructor`/`toString`/`valueOf` would "have" them, and the decoder would
 * hand a native function to the next rule. Parsed YAML is untrusted input; own keys only.
 */
export function requireField(
  rec: Record<string, unknown>,
  key: string,
  at: string,
): Parsed<unknown> {
  if (!Object.hasOwn(rec, key) || rec[key] === undefined || rec[key] === null) {
    return fail('missing-field', `required field \`${key}\` is absent`, `${at}/${key}`);
  }
  return ok(rec[key]);
}

export function requireString(
  rec: Record<string, unknown>,
  key: string,
  at: string,
  minLength = 0,
): Parsed<string> {
  const f = requireField(rec, key, at);
  if (!f.ok) return f;
  if (typeof f.value !== 'string') {
    return fail('wrong-type', `field \`${key}\` must be a string`, `${at}/${key}`);
  }
  if (f.value.length < minLength) {
    return fail(
      'wrong-type',
      `field \`${key}\` must have minLength ${minLength}`,
      `${at}/${key}`,
    );
  }
  return ok(f.value);
}

export function optionalString(
  rec: Record<string, unknown>,
  key: string,
  at: string,
): Parsed<string | undefined> {
  const v = rec[key];
  if (v === undefined || v === null) return ok(undefined);
  if (typeof v !== 'string') {
    return fail('wrong-type', `field \`${key}\` must be a string`, `${at}/${key}`);
  }
  return ok(v);
}

export function requireNumber(
  rec: Record<string, unknown>,
  key: string,
  at: string,
): Parsed<number> {
  const f = requireField(rec, key, at);
  if (!f.ok) return f;
  if (typeof f.value !== 'number' || !Number.isFinite(f.value)) {
    return fail('wrong-type', `field \`${key}\` must be a finite number`, `${at}/${key}`);
  }
  return ok(f.value);
}

export function optionalNumber(
  rec: Record<string, unknown>,
  key: string,
  at: string,
): Parsed<number | undefined> {
  const v = rec[key];
  if (v === undefined || v === null) return ok(undefined);
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return fail('wrong-type', `field \`${key}\` must be a finite number`, `${at}/${key}`);
  }
  return ok(v);
}

export function optionalBoolean(
  rec: Record<string, unknown>,
  key: string,
  at: string,
): Parsed<boolean | undefined> {
  const v = rec[key];
  if (v === undefined || v === null) return ok(undefined);
  if (typeof v !== 'boolean') {
    return fail('wrong-type', `field \`${key}\` must be a boolean`, `${at}/${key}`);
  }
  return ok(v);
}

export function requireEnum<T extends string>(
  rec: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  at: string,
  clause?: string,
): Parsed<T> {
  const f = requireField(rec, key, at);
  if (!f.ok) return f;
  const hit = allowed.find((a) => a === f.value);
  if (hit === undefined) {
    return fail(
      'invalid-enum',
      `field \`${key}\` must be one of ${allowed.join(' | ')}, got ${JSON.stringify(f.value)}`,
      `${at}/${key}`,
      clause,
    );
  }
  return ok(hit);
}

export function requireStringArray(
  rec: Record<string, unknown>,
  key: string,
  at: string,
  minItems = 0,
): Parsed<readonly string[]> {
  const f = requireField(rec, key, at);
  if (!f.ok) return f;
  const arr = requireArray(f.value, `${at}/${key}`);
  if (!arr.ok) return arr;
  const out: string[] = [];
  for (let i = 0; i < arr.value.length; i += 1) {
    const item = arr.value[i];
    if (typeof item !== 'string') {
      return fail('wrong-type', 'expected a string', `${at}/${key}/${i}`);
    }
    out.push(item);
  }
  if (out.length < minItems) {
    return fail(
      'wrong-type',
      `field \`${key}\` requires minItems ${minItems}`,
      `${at}/${key}`,
    );
  }
  return ok(out);
}

/**
 * Collects a scalar parse into an error accumulator and yields the value or `undefined`.
 * Lets a decoder read every field before returning, so `gwtp validate` reports them all.
 */
export function take<T>(r: Parsed<T>, errors: ContractError[]): T | undefined {
  if (r.ok) return r.value;
  errors.push(r.error);
  return undefined;
}

/** Rejects properties the contract does not know about, so typos surface instead of vanishing. */
export function rejectUnknownKeys(
  rec: Record<string, unknown>,
  known: readonly string[],
  at: string,
  errors: ContractError[],
  code: 'strictness' | 'wrong-type' = 'strictness',
): void {
  for (const key of Object.keys(rec)) {
    if (!known.includes(key)) {
      errors.push({
        code,
        message: `unknown field \`${key}\``,
        at: `${at}/${key}`,
      });
    }
  }
}
