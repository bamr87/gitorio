// Implements: docs/spec/02-ledger.md §2 (the observation record) and §3 (rules that keep the
// fold safe), against schemas/event.schema.json. THE LEDGER EVENT RECORD: numeric severity,
// blob-ref rationale, committer time, post-mapping. Holds the single sanctioned
// Verdict -> LedgerEvent transition.
//
// INV-002 lives here as the ABSENCE of things: there is no exported function that takes a
// LedgerEvent and returns a modified LedgerEvent with the same id, and `supersede` reads its
// input and constructs a new event.

import { deepFreeze, type AtLeastOne } from './brand.js';
import { type CanonicalObject, contentHash } from './canonical.js';
import {
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireEnum,
  requireRecord,
  requireString,
  take,
} from './decode.js';
import {
  type AccumulatorKey,
  type CommitSha,
  type EventId,
  type JudgeHash,
  type JudgeId,
  type PromptHash,
  type PullRequestNumber,
  type RationaleRef,
  parseAccumulatorKey,
  parseCommitSha,
  parseEventId,
  parseJudgeId,
  parsePromptHash,
  parsePullRequestNumber,
  parseRationaleRef,
  sha256RefHex,
} from './ids.js';
import { type RepoPath, parseRepoPath } from './paths.js';
import { type ContractError, err, fail, ok, type Decoded, type Parsed } from './result.js';
import { type SeverityWeight, parseSeverityWeight, severityWeight } from './severity.js';
import { type CommitterTime, compareCommitterTime, parseCommitterTime } from './time.js';
import type { Precision } from './assertion.js';
import {
  type AbstainVerdict,
  type AlignedVerdict,
  type VerdictKind,
  type ViolationVerdict,
  type ViolationVerdictKind,
  VERDICT_KINDS,
  isViolation,
  isViolationKind,
} from './verdict.js';

const SCHEMA = 'gwtp/event.schema.json';

// ---------------------------------------------------------------------------
// Judge identity
// ---------------------------------------------------------------------------

/** The rungs of the ladder that can produce a recorded fact (spec 03 §1). */
export type JudgeKind = 'deterministic' | 'model' | 'panel' | 'human';

/**
 * Ascending cost order (spec 03 §1). `hybrid` is an Enforcement, not a JudgeKind: a hybrid
 * prescreen emits `kind: deterministic` and escalates to `kind: model`.
 */
export const JUDGE_LADDER = [
  'deterministic',
  'model',
  'panel',
  'human',
] as const satisfies readonly JudgeKind[];

export interface JudgeRef {
  readonly kind: JudgeKind;
  /** Spec 02 §2's example carries the MODEL id here; manifest.yaml seats by SEAT id. Q-15. */
  readonly id: JudgeId;
  /** sha256 of the prompt file; part of judge identity (spec 03 §6). */
  readonly prompt?: PromptHash;
}

/**
 * Changing model id OR prompt hash changes this, which is precisely what spec 03 §6 calls
 * seating a new judge and gates on a passing bar exam.
 */
export function judgeHash(j: JudgeRef): Parsed<JudgeHash> {
  const r = contentHash({ kind: j.kind, id: j.id, prompt: j.prompt });
  return r.ok ? ok(r.value as JudgeHash) : r;
}

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

export interface EventSubjectFields {
  readonly commit?: CommitSha;
  readonly pr?: PullRequestNumber;
  /** "For stale-claim events from obsolescence sweeps" (spec 02 §7). */
  readonly path?: RepoPath;
  /** "True when the referenced SHA was rebased away; event is retained" (ADR-0004). */
  readonly orphaned?: boolean;
}

/**
 * gwtp/event.schema.json#/properties/subject/anyOf: at least one of commit | pr | path.
 * `anyOf`, not `oneOf` — combinations are legal, and spec 02 §2's own example uses
 * `{commit, pr}`. `AtLeastOne` models exactly that; a three-arm discriminated union would
 * have forbidden it.
 *
 * Note what has no field here and never will: the author. The persisted ledger is
 * identity-free, so dispersion re-derives authorship from git at firing time. That is not an
 * accident of the schema; it is the storage-level expression of ADR-0003.
 */
export type EventSubject = AtLeastOne<EventSubjectFields, 'commit' | 'pr' | 'path'>;

export function decodeEventSubject(raw: unknown, at = ''): Decoded<EventSubject> {
  const rec = requireRecord(raw, at);
  if (!rec.ok) return err([rec.error]);
  const r = rec.value;
  const errors: ContractError[] = [];

  let commit: CommitSha | undefined;
  if (r['commit'] !== undefined && r['commit'] !== null) {
    commit = take(parseCommitSha(r['commit'], `${at}/commit`), errors);
  }
  let pr: PullRequestNumber | undefined;
  if (r['pr'] !== undefined && r['pr'] !== null) {
    pr = take(parsePullRequestNumber(r['pr'], `${at}/pr`), errors);
  }
  let path: RepoPath | undefined;
  if (r['path'] !== undefined && r['path'] !== null) {
    path = take(parseRepoPath(r['path'], `${at}/path`), errors);
  }
  const orphaned = take(optionalBoolean(r, 'orphaned', at), errors);

  if (commit === undefined && pr === undefined && path === undefined) {
    errors.push({
      code: 'invalid-subject',
      message: 'subject requires at least one of commit | pr | path',
      at,
      clause: `${SCHEMA}#/properties/subject/anyOf`,
    });
  }
  if (errors.length > 0) return err(errors);

  return ok({
    ...(commit !== undefined ? { commit } : {}),
    ...(pr !== undefined ? { pr } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(orphaned !== undefined ? { orphaned } : {}),
  } as EventSubject);
}

// ---------------------------------------------------------------------------
// Dispersion snapshot (the shape stored INSIDE the hashed body)
// ---------------------------------------------------------------------------

/**
 * Present only on firing events. gwtp/event.schema.json leaves `dispersion_snapshot` an
 * unconstrained object whose description names four fields; since it lives inside the hashed
 * body the shape must be pinned for idempotency. See docs/spec/OPEN-QUESTIONS.md Q-13.
 *
 * Note what is NOT here: no author identities, only their entropy.
 */
export interface DispersionSnapshot {
  readonly author_entropy: number;
  readonly path_entropy: number;
  readonly time_spread: number;
  readonly compliance_ratio: number | null;
}

// ---------------------------------------------------------------------------
// The event body and the record
// ---------------------------------------------------------------------------

export interface EventBodyCommon {
  readonly subject: EventSubject;
  /** Unconstrained string in the schema: an assertion id, or a scope claim key (spec 02 §7). */
  readonly assertion: AccumulatorKey;
  readonly judge: JudgeRef;
  /** Committer time, not observation time (ADR-0004). The type will not accept anything else. */
  readonly t: CommitterTime;
  /**
   * Always PRESENT, `null` when this is not a re-judgment. A fixed key set is what makes
   * "same judgment -> same bytes -> same id" structural rather than incidental: without it,
   * `supersedes: null` and an omitted `supersedes` would hash two different ways.
   */
  readonly supersedes: EventId | null;
  readonly dispersion_snapshot?: DispersionSnapshot;
}

/** gwtp/event.schema.json#/allOf/0: drift|regression|stale-claim require the three below. */
export interface ViolationEventBody extends EventBodyCommon {
  readonly verdict: ViolationVerdictKind;
  /** Numeric, post-mapping. The ordinal lives on the Verdict; it does not survive here. */
  readonly severity: SeverityWeight;
  /**
   * "Assertion precision frozen at observation time." Deliberately `number` and not
   * `Precision`: the event schema places no bounds on it, so the write path stays typed
   * (Precision is a branded number and flows in freely) while the read path does not reject
   * a third-party event the schema would have accepted.
   */
  readonly precision_at: number;
  /** A blob ref, not prose. The full text is retained out of the hot path (spec 02 §2). */
  readonly rationale: RationaleRef;
}

export interface NonViolationEventBody extends EventBodyCommon {
  readonly verdict: Exclude<VerdictKind, ViolationVerdictKind>;
  readonly severity?: never;
  readonly precision_at?: never;
  readonly rationale?: never;
}

/** The record minus its own hash. This — canonicalized — is what gets hashed (spec 02 §2). */
export type EventBody = ViolationEventBody | NonViolationEventBody;

export interface ViolationEvent extends ViolationEventBody {
  readonly event: EventId;
}

export interface NonViolationEvent extends NonViolationEventBody {
  readonly event: EventId;
}

export type LedgerEvent = ViolationEvent | NonViolationEvent;

/** The fold's gate: only these three accumulate (spec 02 §4). */
export function isViolationEvent(e: LedgerEvent): e is ViolationEvent {
  return isViolationKind(e.verdict);
}

export function isViolationBody(b: EventBody): b is ViolationEventBody {
  return isViolationKind(b.verdict);
}

// ---------------------------------------------------------------------------
// Minting: the single sanctioned Verdict -> LedgerEvent transition
// ---------------------------------------------------------------------------

interface MintCommon {
  readonly subject: EventSubject;
  readonly judge: JudgeRef;
  readonly t: CommitterTime;
  readonly supersedes?: EventId | null;
}

/**
 * Everything the judge was NOT allowed to know, supplied by the caller at record time:
 * which commit it was, when it landed, which judge sat, and what the precision was.
 * That the extra facts are exactly the blind ones makes ADR-0003 visible in a signature.
 */
export interface MintViolationInput extends MintCommon {
  readonly verdict: ViolationVerdict;
  /** Assertion precision frozen at observation time (spec 02 §2). */
  readonly precision_at: Precision;
  /** Mandatory: a violation's rationale is always retained out of the hot path. */
  readonly rationale: RationaleRef;
  readonly dispersion_snapshot?: DispersionSnapshot;
}

export interface MintNonViolationInput extends MintCommon {
  readonly verdict: AlignedVerdict | AbstainVerdict;
}

export type MintEventInput = MintViolationInput | MintNonViolationInput;

function isViolationMint(i: MintEventInput): i is MintViolationInput {
  return isViolation(i.verdict);
}

/**
 * The single normalizing minter, and the ONLY place ADR-0005's ordinal -> numeric mapping is
 * applied in the whole engine. Total and pure: both inputs are already typed, so there is
 * nothing left to reject.
 *
 * Because `MintEventInput` is a union, a violation cannot be minted without a rationale blob
 * and a frozen precision, and an aligned verdict has nowhere to put a severity.
 */
export function eventBodyFromVerdict(input: MintEventInput): EventBody {
  const common: EventBodyCommon = {
    subject: input.subject,
    assertion: input.verdict.assertion,
    judge: input.judge,
    t: input.t,
    supersedes: input.supersedes ?? null,
  };
  if (isViolationMint(input)) {
    return {
      ...common,
      ...(input.dispersion_snapshot !== undefined
        ? { dispersion_snapshot: input.dispersion_snapshot }
        : {}),
      verdict: input.verdict.verdict,
      severity: severityWeight(input.verdict.severity),
      precision_at: input.precision_at,
      rationale: input.rationale,
    };
  }
  return { ...common, verdict: input.verdict.verdict };
}

/**
 * The canonical wire body: snake_case keys matching schemas/event.schema.json, absent fields
 * omitted rather than nulled, `supersedes` always present. Excludes `event` — the id cannot
 * be part of what it addresses.
 */
export function canonicalEventBody(body: EventBody): CanonicalObject {
  const subject: CanonicalObject = {
    commit: body.subject.commit,
    pr: body.subject.pr,
    path: body.subject.path,
    // `orphaned` only when true: `orphaned: false` and absence mean the same thing, and two
    // spellings of the same fact would hash two ways.
    orphaned: body.subject.orphaned === true ? true : undefined,
  };
  return {
    assertion: body.assertion,
    // `prompt ?? undefined` so an explicit null and an absent prompt hash IDENTICALLY: the encoder
    // drops undefined but retains null (src/core/canonical.ts), and `decodeJudgeRef` reads a
    // `prompt: null` back as absent — so without this a judge with `prompt: null` would seal at one
    // address and verify at another, and a single such blob makes list() reject the whole ledger
    // (the audit's store.ts:285 probe). Same treatment `orphaned` already gets above.
    judge: { kind: body.judge.kind, id: body.judge.id, prompt: body.judge.prompt ?? undefined },
    subject,
    t: body.t,
    verdict: body.verdict,
    supersedes: body.supersedes,
    severity: isViolationBody(body) ? body.severity : undefined,
    precision_at: isViolationBody(body) ? body.precision_at : undefined,
    rationale: isViolationBody(body) ? body.rationale : undefined,
    dispersion_snapshot:
      body.dispersion_snapshot === undefined
        ? undefined
        : {
            author_entropy: body.dispersion_snapshot.author_entropy,
            path_entropy: body.dispersion_snapshot.path_entropy,
            time_spread: body.dispersion_snapshot.time_spread,
            compliance_ratio: body.dispersion_snapshot.compliance_ratio,
          },
  };
}

export function eventIdOf(body: EventBody): Parsed<EventId> {
  const r = contentHash(canonicalEventBody(body));
  return r.ok ? ok(r.value as EventId) : r;
}

/**
 * Idempotent by construction: sealing the same body twice yields the same id, so a double
 * append is a no-op at the filesystem level (spec 02 §1 property 1). The result is
 * deep-frozen, so INV-002 holds even through an `any`-typed alias.
 */
export function sealEvent(body: EventBody): Parsed<LedgerEvent> {
  const id = eventIdOf(body);
  if (!id.ok) return id;
  return ok(deepFreeze({ ...body, event: id.value } as LedgerEvent));
}

export type SupersedingInput =
  | Omit<MintViolationInput, 'supersedes'>
  | Omit<MintNonViolationInput, 'supersedes'>;

/**
 * INV-002 in one signature: re-judging READS an existing event and produces a NEW one
 * carrying `supersedes: prior.event`. The `Omit<'supersedes'>` stops a caller from pointing
 * the link anywhere other than the event they passed. Never an edit, never a deletion.
 */
export function supersede(prior: LedgerEvent, revision: SupersedingInput): Parsed<LedgerEvent> {
  const base = { ...revision, supersedes: prior.event } as MintEventInput;
  return sealEvent(eventBodyFromVerdict(base));
}

/** Tamper evidence for events read off the ref, where the types guarantee nothing. */
export function verifyEventId(e: LedgerEvent): Parsed<true> {
  const { event: _id, ...body } = e;
  const recomputed = eventIdOf(body as EventBody);
  if (!recomputed.ok) return recomputed;
  if (recomputed.value !== e.event) {
    return fail(
      'hash-mismatch',
      `event id ${e.event} does not match the hash of its body (${recomputed.value})`,
    );
  }
  return ok(true);
}

/** `<64-hex>.yaml` — bare hex, no `sha256:` prefix (colons are hostile on Windows). Q-10. */
export function eventFileName(id: EventId): string {
  return `${sha256RefHex(id)}.yaml`;
}

export function eventFilePath(id: EventId): string {
  return `events/${eventFileName(id)}`;
}

/**
 * Total order for the fold: committer time ascending, then EventId lexicographically.
 * A leaky integrator is order-sensitive but the ledger is a content-addressed SET
 * (ADR-0002), so sorting by this comparator before folding is what makes
 * "same event set -> same state" true rather than aspirational. See OPEN-QUESTIONS Q-11.
 */
export function compareForFold(a: LedgerEvent, b: LedgerEvent): number {
  return compareCommitterTime(a.t, b.t) || (a.event < b.event ? -1 : a.event > b.event ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Supersession chains (spec 02 §3)
// ---------------------------------------------------------------------------

/** Two concurrent CI runs re-judged the same event. Not an error — reported, not resolved. */
export interface SupersessionFork {
  readonly superseded: EventId;
  readonly successors: readonly EventId[];
}

export interface SupersessionResolution {
  /** Events superseded by nothing. The fold consumes exactly these. */
  readonly tips: readonly LedgerEvent[];
  readonly supersededBy: ReadonlyMap<EventId, EventId>;
  readonly forks: readonly SupersessionFork[];
  /** `supersedes` pointing at an id not in the input set; the event is kept as a tip. */
  readonly dangling: readonly EventId[];
}

/**
 * Collapses duplicate `event` ids (identical bodies by construction), then keeps every event
 * that no other event supersedes. Degenerates to "tip of each chain" (spec 02 §3) in the
 * normal case WITHOUT inventing a fork tie-break rule the spec never specified.
 * Pure and order-independent.
 */
export function resolveSupersessions(events: readonly LedgerEvent[]): SupersessionResolution {
  // Keep the FIRST object seen for an id, never the last. Content addressing guarantees same id ⟹
  // same canonical body, so for VERIFIED events (list() runs verifyEventId on every one) the choice
  // is immaterial and the fold is order-independent. Last-write-wins made the result depend on array
  // order the instant a caller passed two objects sharing an id but differing in body — a tampered
  // or hand-built pair the fold should never silently reorder (the audit's event.ts:430 probe).
  const byId = new Map<EventId, LedgerEvent>();
  for (const e of events) if (!byId.has(e.event)) byId.set(e.event, e);

  const successors = new Map<EventId, EventId[]>();
  const dangling: EventId[] = [];
  for (const e of byId.values()) {
    if (e.supersedes === null) continue;
    if (!byId.has(e.supersedes)) {
      dangling.push(e.event);
      continue;
    }
    const list = successors.get(e.supersedes);
    if (list === undefined) successors.set(e.supersedes, [e.event]);
    else list.push(e.event);
  }

  const supersededBy = new Map<EventId, EventId>();
  const forks: SupersessionFork[] = [];
  for (const [superseded, succ] of successors) {
    const sorted = [...succ].sort();
    supersededBy.set(superseded, sorted[0] as EventId);
    if (sorted.length > 1) forks.push({ superseded, successors: sorted });
  }

  const tips = [...byId.values()].filter((e) => !supersededBy.has(e.event)).sort(compareForFold);
  return {
    tips,
    supersededBy,
    forks: forks.sort((a, b) => (a.superseded < b.superseded ? -1 : 1)),
    dangling: dangling.sort(),
  };
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

const KNOWN_KEYS = [
  'event',
  'subject',
  'assertion',
  'verdict',
  'severity',
  'precision_at',
  'judge',
  'rationale',
  't',
  'supersedes',
  'dispersion_snapshot',
] as const;

const JUDGE_KEYS = ['kind', 'id', 'prompt'] as const;

function decodeJudgeRef(raw: unknown, at: string, errors: ContractError[]): JudgeRef | undefined {
  const rec = requireRecord(raw, at);
  if (!rec.ok) {
    errors.push(rec.error);
    return undefined;
  }
  const kind = take(
    requireEnum(rec.value, 'kind', JUDGE_LADDER, at, `${SCHEMA}#/properties/judge/properties/kind`),
    errors,
  );
  const idRaw = take(requireString(rec.value, 'id', at), errors);
  const id = idRaw === undefined ? undefined : take(parseJudgeId(idRaw, `${at}/id`), errors);
  let prompt: PromptHash | undefined;
  if (rec.value['prompt'] !== undefined && rec.value['prompt'] !== null) {
    prompt = take(parsePromptHash(rec.value['prompt'], `${at}/prompt`), errors);
  }
  for (const key of Object.keys(rec.value)) {
    if (!(JUDGE_KEYS as readonly string[]).includes(key)) {
      errors.push({ code: 'strictness', message: `unknown field \`${key}\``, at: `${at}/${key}` });
    }
  }
  if (kind === undefined || id === undefined) return undefined;
  return { kind, id, ...(prompt !== undefined ? { prompt } : {}) };
}

function decodeDispersionSnapshot(
  raw: unknown,
  at: string,
  errors: ContractError[],
): DispersionSnapshot | undefined {
  const rec = requireRecord(raw, at);
  if (!rec.ok) {
    errors.push(rec.error);
    return undefined;
  }
  const authorEntropy = take(optionalNumber(rec.value, 'author_entropy', at), errors) ?? 0;
  const pathEntropy = take(optionalNumber(rec.value, 'path_entropy', at), errors) ?? 0;
  const timeSpread = take(optionalNumber(rec.value, 'time_spread', at), errors) ?? 0;
  const complianceRatioRaw = rec.value['compliance_ratio'];
  const complianceRatio =
    complianceRatioRaw === null || complianceRatioRaw === undefined
      ? null
      : (take(optionalNumber(rec.value, 'compliance_ratio', at), errors) ?? null);
  return {
    author_entropy: authorEntropy,
    path_entropy: pathEntropy,
    time_spread: timeSpread,
    compliance_ratio: complianceRatio,
  };
}

export function decodeLedgerEvent(raw: unknown, at = ''): Decoded<LedgerEvent> {
  const rec = requireRecord(raw, at);
  if (!rec.ok) return err([rec.error]);
  const r = rec.value;
  const errors: ContractError[] = [];

  const eventIdRaw = take(requireString(r, 'event', at), errors);
  const eventId =
    eventIdRaw === undefined ? undefined : take(parseEventId(eventIdRaw, `${at}/event`), errors);

  const subjectDecoded = decodeEventSubject(r['subject'], `${at}/subject`);
  const subject = subjectDecoded.ok ? subjectDecoded.value : undefined;
  if (!subjectDecoded.ok) errors.push(...subjectDecoded.error);

  const assertionRaw = take(requireString(r, 'assertion', at), errors);
  const assertion =
    assertionRaw === undefined
      ? undefined
      : take(parseAccumulatorKey(assertionRaw, `${at}/assertion`), errors);

  const kind = take(
    requireEnum(r, 'verdict', VERDICT_KINDS, at, `${SCHEMA}#/properties/verdict`),
    errors,
  );
  const judge = decodeJudgeRef(r['judge'], `${at}/judge`, errors);
  const t = take(parseCommitterTime(r['t'], `${at}/t`), errors);

  let supersedes: EventId | null = null;
  if (r['supersedes'] !== undefined && r['supersedes'] !== null) {
    supersedes = take(parseEventId(r['supersedes'], `${at}/supersedes`), errors) ?? null;
  }

  let dispersion: DispersionSnapshot | undefined;
  if (r['dispersion_snapshot'] !== undefined && r['dispersion_snapshot'] !== null) {
    dispersion = decodeDispersionSnapshot(
      r['dispersion_snapshot'],
      `${at}/dispersion_snapshot`,
      errors,
    );
  }

  for (const key of Object.keys(r)) {
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
      errors.push({ code: 'strictness', message: `unknown field \`${key}\``, at: `${at}/${key}` });
    }
  }

  if (
    eventId === undefined ||
    subject === undefined ||
    assertion === undefined ||
    kind === undefined ||
    judge === undefined ||
    t === undefined
  ) {
    return err(errors.length > 0 ? errors : [{ code: 'missing-field', message: 'incomplete event', at }]);
  }

  const common: EventBodyCommon = {
    subject,
    assertion,
    judge,
    t,
    supersedes,
    ...(dispersion !== undefined ? { dispersion_snapshot: dispersion } : {}),
  };

  if (isViolationKind(kind)) {
    const severity = take(parseSeverityWeight(r['severity'], `${at}/severity`), errors);
    const precisionAt = take(optionalNumber(r, 'precision_at', at), errors);
    if (precisionAt === undefined) {
      errors.push({
        code: 'missing-field',
        message: `${kind} events require precision_at`,
        at: `${at}/precision_at`,
        clause: `${SCHEMA}#/allOf/0`,
      });
    }
    const rationaleRaw = take(optionalString(r, 'rationale', at), errors);
    const rationale =
      rationaleRaw === undefined
        ? undefined
        : take(parseRationaleRef(rationaleRaw, `${at}/rationale`), errors);
    if (rationaleRaw === undefined) {
      errors.push({
        code: 'missing-field',
        message: `${kind} events require a rationale blob ref`,
        at: `${at}/rationale`,
        clause: `${SCHEMA}#/allOf/0`,
      });
    }
    if (
      errors.length > 0 ||
      severity === undefined ||
      precisionAt === undefined ||
      rationale === undefined
    ) {
      return err(errors);
    }
    return ok(
      deepFreeze({
        ...common,
        event: eventId,
        verdict: kind,
        severity,
        precision_at: precisionAt,
        rationale,
      }),
    );
  }

  if (r['severity'] !== undefined && r['severity'] !== null) {
    errors.push({
      code: 'strictness',
      message: `\`${kind}\` events carry no severity (spec 02 §4)`,
      at: `${at}/severity`,
    });
  }
  if (r['rationale'] !== undefined && r['rationale'] !== null) {
    errors.push({
      code: 'strictness',
      message: `\`${kind}\` events carry no rationale (spec 03 §4)`,
      at: `${at}/rationale`,
    });
  }
  if (errors.length > 0) return err(errors);

  return ok(
    deepFreeze({
      ...common,
      event: eventId,
      verdict: kind as Exclude<VerdictKind, ViolationVerdictKind>,
    }),
  );
}
