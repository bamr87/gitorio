// Implements: docs/spec/02-ledger.md §1-2 ("hash of canonical body = filename = idempotency
// key") and docs/adr/0002-event-sourced-ledger.md. The primitive that makes events
// content-addressed, idempotent and tamper-evident.
//
// The ledger STORES YAML but MUST hash this JSON: YAML has no canonical form, so hashing the
// stored bytes would make event identity depend on the emitter's quoting and line wrapping.
//
// This is the only file in src/core that touches node:crypto — stdlib, not a forge API (INV-005).

import { createHash } from 'node:crypto';
import { fail, ok, type Parsed } from './result.js';
import { type Sha256Ref, sha256RefFromHex } from './ids.js';

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | CanonicalObject;

/**
 * `undefined` members are DROPPED by the encoder; `null` is RETAINED and meaningful
 * (`supersedes: null` in spec 02 §2's own record). That distinction is why the event minter
 * emits a fixed key set rather than relying on absence — see src/core/event.ts.
 */
export interface CanonicalObject {
  readonly [key: string]: CanonicalValue | undefined;
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainObject(v: object): boolean {
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function encode(v: CanonicalValue, at: string, out: string[]): Parsed<true> {
  if (v === null) {
    out.push('null');
    return ok(true);
  }
  switch (typeof v) {
    case 'boolean':
      out.push(v ? 'true' : 'false');
      return ok(true);
    case 'number': {
      if (!Number.isFinite(v)) {
        return fail('non-canonical-value', `non-finite number ${String(v)}`, at);
      }
      out.push(Object.is(v, -0) ? '0' : String(v));
      return ok(true);
    }
    case 'string':
      out.push(JSON.stringify(v));
      return ok(true);
    case 'object':
      break;
    default:
      return fail('non-canonical-value', `unserializable value of type ${typeof v}`, at);
  }

  if (Array.isArray(v)) {
    out.push('[');
    const arr = v as readonly CanonicalValue[];
    for (let i = 0; i < arr.length; i += 1) {
      if (i > 0) out.push(',');
      const r = encode(arr[i] as CanonicalValue, `${at}/${i}`, out);
      if (!r.ok) return r;
    }
    out.push(']');
    return ok(true);
  }

  const obj = v as Record<string, CanonicalValue | undefined>;
  if (!isPlainObject(obj)) {
    return fail('non-canonical-value', 'only plain objects are canonicalizable', at);
  }
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort(compareCodeUnits);
  out.push('{');
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i] as string;
    if (i > 0) out.push(',');
    out.push(JSON.stringify(k), ':');
    const r = encode(obj[k] as CanonicalValue, `${at}/${k}`, out);
    if (!r.ok) return r;
  }
  out.push('}');
  return ok(true);
}

/**
 * RFC-8785-shaped JSON canonicalization, restricted to what GWTP stores:
 *  - object keys sorted ascending by UTF-16 code unit; `undefined`-valued keys omitted
 *  - arrays keep order (order is significant)
 *  - numbers: finite only; `-0` normalized to `0`; shortest round-trip form
 *  - strings: JSON escaping (well-formed: lone surrogates escape as `\uXXXX`)
 *  - no insignificant whitespace anywhere
 *
 * Errors with `non-canonical-value` on NaN/Infinity or on a non-plain object (Date, Map,
 * class instance) rather than silently coercing.
 */
export function canonicalize(value: CanonicalValue): Parsed<string> {
  const out: string[] = [];
  const r = encode(value, '', out);
  return r.ok ? ok(out.join('')) : r;
}

/** UTF-8 encode, sha256, lowercase hex, no prefix. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** `sha256:` + sha256Hex(canonicalize(value)). The ledger filename and the idempotency key. */
export function contentHash(value: CanonicalValue): Parsed<Sha256Ref> {
  const c = canonicalize(value);
  if (!c.ok) return c;
  return sha256RefFromHex(sha256Hex(c.value));
}

/** For out-of-hot-path text blobs: rationale bodies (spec 02 §2) and prompt files (spec 01 §7). */
export function hashBlob(text: string): Sha256Ref {
  const r = sha256RefFromHex(sha256Hex(text));
  // Total by construction: sha256Hex always yields 64 lowercase hex characters.
  return r.ok ? r.value : (`sha256:${sha256Hex(text)}` as Sha256Ref);
}
