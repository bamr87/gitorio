// Implements: docs/spec/02-ledger.md §5 ("Every proposal ships its evidence … Refactoring
// recommendation (issue or patch PR) … Reprogramming proposal — a PR against `.program/`") and
// docs/vision.md non-goals ("Not forge-locked. Git is the substrate. GitHub PR/issue metadata
// enriches distillation and delivery through an adapter; a bare repo degrades gracefully to
// commits-only").
//
// INV-005 is a DELIVERABLE in this file, not an aspiration. A proposal has to leave the engine
// somehow, and "somehow" is the exact place a forge SDK gets imported into the core by
// accident. So the core declares the PORT — a document, a receipt, and one method — and every
// forge-shaped fact (repository coordinates, issue numbers, auth, HTTP) lives on the far side
// of it in src/adapters/**. Nothing in this file names GitHub, and nothing in this file can:
// `channel` and `locator` are opaque strings the adapter fills in for itself, precisely so
// core never has to enumerate the forges that exist.
//
// Note what is NOT here either: no author identity and no `Surprise`. A `DeliveryDocument` is
// the UNTAINTED product of rendering — plain strings by the time it reaches this type — which
// is why `__DELIVERY_BLINDNESS_PROOFS` below can hold. Reading the meter happens upstream, in
// the renderer, under a `SentencingWarrant` (ADR-0003); by the time a document exists the
// declassification has already been audited.

import type { Brand } from './brand.js';
import type { IsBlind, Proof } from './blindness.js';
import type { AccumulatorKey, EventId } from './ids.js';
import { sha256RefHex } from './ids.js';
import type { ProposalKind } from './proposal.js';
import { type Err, type Result, err, fail, ok, type Parsed } from './result.js';

// ---------------------------------------------------------------------------
// Identity: one firing, one delivery
// ---------------------------------------------------------------------------

/**
 * The idempotency key for a delivered proposal: **assertion + firing event id**, exactly as
 * SEED-02 deliverable 3 requires. Content addressing already makes the LEDGER idempotent
 * (spec 02 §1 property 1); nothing makes a forge idempotent, so re-running the fold after a CI
 * retry would file a second issue about the same firing unless the delivery path carries its
 * own key and looks before it writes.
 *
 * `ProposalKind` is deliberately NOT part of the key. A firing is classified exactly once
 * (`classifyFiring` is a total function of the dispersion at that instant), so folding the
 * kind in could only ever weaken the key — a re-classification under retuned thresholds would
 * silently earn a second issue about the same evidence.
 */
export type DeliveryKey = Brand<string, 'DeliveryKey'>;

export const DELIVERY_KEY_PREFIX = 'gwtp-proposal';

/**
 * `<assertion>@<64 hex>`. The event hex is fixed-width and anchored at the end, so the
 * assertion segment stays unambiguous even for a scope-claim key containing `@` or `/`
 * (`parseAccumulatorKey` admits any non-empty whitespace-free string — see OPEN-QUESTIONS Q-04).
 */
const DELIVERY_KEY_PATTERN = /^gwtp-proposal:(\S+)@([0-9a-f]{64})$/;

export function deliveryKey(key: AccumulatorKey, triggeredBy: EventId): DeliveryKey {
  return `${DELIVERY_KEY_PREFIX}:${key}@${sha256RefHex(triggeredBy)}` as DeliveryKey;
}

export function parseDeliveryKey(raw: unknown, at?: string): Parsed<DeliveryKey> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string delivery key', at);
  if (!DELIVERY_KEY_PATTERN.test(raw)) {
    return fail(
      'invalid-id',
      `expected ${DELIVERY_KEY_PATTERN.source}, got ${JSON.stringify(raw)}`,
      at,
    );
  }
  return ok(raw as DeliveryKey);
}

export interface DeliveryKeyParts {
  readonly assertion: string;
  /** Bare 64-hex of the firing event, no `sha256:` prefix (same convention as Q-10). */
  readonly eventHex: string;
}

export function deliveryKeyParts(k: DeliveryKey): DeliveryKeyParts | null {
  const m = DELIVERY_KEY_PATTERN.exec(k);
  if (m === null) return null;
  return { assertion: m[1] as string, eventHex: m[2] as string };
}

export const DELIVERY_MARKER_PREFIX = 'gwtp-delivery-key';

const DELIVERY_MARKER_PATTERN = /<!--\s*gwtp-delivery-key:\s*(\S+)\s*-->/;

/**
 * The key made carryable by a channel that stores only markdown. An HTML comment renders to
 * nothing on every markdown surface worth delivering to, survives edits to the visible prose,
 * and is greppable — which is what lets an adapter answer "have I already filed this firing?"
 * against a forge that has no notion of an idempotency key.
 */
export function deliveryMarker(k: DeliveryKey): string {
  return `<!-- ${DELIVERY_MARKER_PREFIX}: ${k} -->`;
}

export function findDeliveryMarker(text: string): DeliveryKey | null {
  const m = DELIVERY_MARKER_PATTERN.exec(text);
  if (m === null) return null;
  const parsed = parseDeliveryKey(m[1]);
  return parsed.ok ? parsed.value : null;
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * A change a HUMAN applies. The machine proposes; the human ratifies (spec 01 §4.2, INV-001) —
 * so a patch travels as text, never as a write. `path` is repo-relative.
 */
export interface DeliveryPatch {
  readonly path: string;
  /** A unified diff, `-p1`-shaped (`--- a/<path>` / `+++ b/<path>`). */
  readonly diff: string;
}

/**
 * What a proposal looks like once it has been rendered and before it has been delivered.
 * Channel-neutral by construction: an issue body, a file, a mailing-list post and a PR
 * description are all "a title, some markdown, some labels, maybe a patch".
 *
 * `body` MUST embed `deliveryMarker(key)`; a port that finds it missing is entitled to append
 * it, because without the marker idempotency is a claim rather than a mechanism.
 */
export interface DeliveryDocument {
  readonly key: DeliveryKey;
  readonly kind: ProposalKind;
  readonly title: string;
  /** Markdown. Self-contained: it repeats the title as its H1 so a file sink needs no wrapper. */
  readonly body: string;
  readonly labels: readonly string[];
  /** Empty for `refactor`. For `reprogram`, the `.program/` amendment (spec 02 §5). */
  readonly patches: readonly DeliveryPatch[];
}

// ---------------------------------------------------------------------------
// The receipt
// ---------------------------------------------------------------------------

/**
 * `existing` is a SUCCESS, not a failure: it is what idempotency looks like from the outside,
 * and the caller that fired twice needs to be able to tell "already filed" from "could not
 * file" without inspecting a message string.
 */
export type DeliveryStatus = 'created' | 'existing';

export interface DeliveryReceipt {
  readonly key: DeliveryKey;
  readonly status: DeliveryStatus;
  /** The adapter naming itself, e.g. an issue channel or a file channel. Core enumerates none. */
  readonly channel: string;
  /** Where a human reads it: a URL, an absolute path, a message id. */
  readonly locator: string;
  /** The channel's native handle, when it has one (an issue number, a file inode, …). */
  readonly reference?: string;
}

/**
 * Delivery fails for reasons the `ContractError` union has no business growing arms for — a
 * 502, an expired token, a body a forge refuses. Those are not contract violations, so this is
 * its own closed union rather than three more `ContractErrorCode`s.
 */
export type DeliveryFailureCode =
  | 'unconfigured'
  | 'unauthenticated'
  | 'not-found'
  | 'rate-limited'
  | 'transport'
  | 'rejected';

export interface DeliveryFailure {
  readonly code: DeliveryFailureCode;
  readonly message: string;
  /**
   * Whether the same call could succeed later untouched. Load-bearing for a governance tool:
   * a proposal lost to a 502 must be retried, and a proposal refused for its content must not
   * be, or CI hammers the forge forever.
   */
  readonly retryable: boolean;
  readonly detail?: string;
}

export type DeliveryOutcome = Result<DeliveryReceipt, DeliveryFailure>;

export function deliveryFailure(
  code: DeliveryFailureCode,
  message: string,
  retryable: boolean,
  detail?: string,
): Err<DeliveryFailure> {
  const f: { -readonly [K in keyof DeliveryFailure]?: DeliveryFailure[K] } = {
    code,
    message,
    retryable,
  };
  if (detail !== undefined) f.detail = detail;
  return err(f as DeliveryFailure);
}

export function deliveryReceipt(
  key: DeliveryKey,
  status: DeliveryStatus,
  channel: string,
  locator: string,
  reference?: string,
): DeliveryReceipt {
  const r: { -readonly [K in keyof DeliveryReceipt]?: DeliveryReceipt[K] } = {
    key,
    status,
    channel,
    locator,
  };
  if (reference !== undefined) r.reference = reference;
  return r as DeliveryReceipt;
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * ONE method, and it is not `createIssue`.
 *
 * The whole of INV-005's delivery half is the shape of this interface: `src/ledger` may hold a
 * `DeliveryPort` and call `deliver`, and there is no accessor on it through which a repository
 * slug, an API token or an issue number could reach the engine. A bare git repo satisfies this
 * interface with a file write (src/adapters/github/bare.ts); GitHub satisfies it with the REST
 * API (src/adapters/github/issues.ts); neither fact is visible from here.
 *
 * Failure is DATA, matching every other contract boundary in src/core (src/core/result.ts): a
 * scheduled sweep that files ten proposals must not lose nine of them to the first throw.
 */
export interface DeliveryPort {
  /** Stable name for logs and receipts. */
  readonly channel: string;
  deliver(doc: DeliveryDocument): Promise<DeliveryOutcome>;
}

/**
 * INV-003 as a BUILD-TIME OBLIGATION on the delivery path, mirroring
 * `src/core/evidence.ts.__INV003_PROOFS`. A `Surprise` or an `ActorId` finding its way into a
 * delivered document — or a field growing one of `ForbiddenKey`'s names — turns these to
 * `false` and fails tsc.
 *
 * It is a weaker guarantee than the evidence bundle's, and deliberately so: a proposal is
 * allowed to publish the meter reading, because publishing it is the point. What the proof
 * pins is that the reading arrives as text that a warrant already declassified, and never as a
 * live sentencing value that a later refactor could route somewhere blind.
 */
export type __DELIVERY_BLINDNESS_PROOFS = readonly [
  Proof<IsBlind<DeliveryDocument>>,
  Proof<IsBlind<DeliveryPatch>>,
  Proof<IsBlind<DeliveryReceipt>>,
];
