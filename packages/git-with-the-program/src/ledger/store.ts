// Implements: docs/spec/02-ledger.md §1 (substrate: a dedicated ref, event-sourced; the
// `events/` tree layout; push-with-retry as fetch -> merge-as-set-union -> fast-forward),
// §2 (the observation record), §3 (rules that keep the fold safe), and
// docs/adr/0002-event-sourced-ledger.md. SEED-02 deliverable 1.
//
// GitRefEventStore implements the `EventStore` port declared in src/ledger/index.ts. Two
// methods, and NEITHER IS UPDATE OR DELETE — INV-002 is not a rule this class respects, it is
// the absence of a method through which it could be violated. There is no code path here that
// rewrites an existing event blob: `unionEventEntries` treats a same-name-different-blob pair
// as tamper evidence and refuses, and `updateRefCas` is the only ref writer.
//
// Contract owned by src/core and NOT re-derived here: `eventFileName` / `eventFilePath` (the
// naming, Q-10), `canonicalEventBody` (the byte ordering, Q-24), `eventIdOf` / `verifyEventId`
// (identity and tamper evidence), `decodeLedgerEvent` (the read contract), `compareForFold`
// (the total order, Q-11). The events tree's directory name is DERIVED from `eventFilePath`
// rather than spelled a second time, so the layout has exactly one definition.
//
// What is defined here and nowhere else is SUBSTRATE, not contract: the ref name, the YAML
// emitter, and the retry loops. `refs/program/ledger` is deliberately not a src/core constant —
// core describes the record and its identity, and is agnostic about whether the record lands in
// a git ref, an object store or a test double.
//
// INV-005: node builtins, `yaml`, src/core and src/ledger/git.ts. No forge API of any kind; a
// "remote" here is whatever `git` accepts, so a repository with no remote is local-only and
// everything except the push path still works.

import { parse as parseYaml } from 'yaml';

import type { EventBody, EventId, LedgerEvent, NonEmptyReadonlyArray } from '../core/index.js';
import type { CanonicalObject, CanonicalValue, ContractError } from '../core/index.js';
import {
  canonicalEventBody,
  compareForFold,
  decodeLedgerEvent,
  eventFileName,
  eventFilePath,
  fail,
  ok,
  parseEventId,
  unwrap,
  verifyEventId,
  type Parsed,
} from '../core/index.js';

import {
  BLOB_MODE,
  TREE_MODE,
  catFileBatch,
  commitTree,
  createGitExec,
  fetchRefToFetchHead,
  hashObject,
  hashObjectWrite,
  isAncestor,
  lsRemoteRef,
  lsTree,
  mktree,
  pushRef,
  revParse,
  unionTreeEntries,
  updateRefCas,
  withTreeEntry,
  type GitExec,
  type GitObjectId,
  type TreeEntry,
} from './git.js';
import type { AppendOutcome, EventStore } from './index.js';

// ---------------------------------------------------------------------------
// The substrate constants
// ---------------------------------------------------------------------------

/**
 * "The ledger lives at `refs/program/ledger` — its own commit chain, invisible to branch
 * listings, pushable by CI without touching working branches" (spec 02 §1).
 */
export const LEDGER_REF = 'refs/program/ledger';

/**
 * The `events/` level of the tree, derived from `eventFilePath` so the directory name has ONE
 * definition in the codebase. If src/core ever re-homes events, this follows without an edit.
 */
export const EVENTS_TREE_NAME: string = (() => {
  const probe = unwrap(parseEventId(`sha256:${'0'.repeat(64)}`));
  const path = eventFilePath(probe);
  const slash = path.lastIndexOf('/');
  if (slash <= 0) {
    throw new Error(`eventFilePath no longer yields a directory-qualified path: ${path}`);
  }
  return path.slice(0, slash);
})();

export const DEFAULT_IDENTITY = { name: 'gwtp', email: 'gwtp@localhost' } as const;

/**
 * Spec 02 §1.1 prescribes "retry" and states no bound. Bounded here, and the bound is small: a
 * ref that will not settle is a fault, not a slow path. See docs/spec/OPEN-QUESTIONS.md Q-50.
 */
export const DEFAULT_MAX_APPEND_ATTEMPTS = 16;
export const DEFAULT_MAX_PUSH_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

export type LedgerProblemCode =
  /** The blob named by the tree could not be read back out of the object database. */
  | 'unreadable'
  /** Not YAML, or YAML the event contract rejects. */
  | 'malformed'
  /** `verifyEventId` failed: the body does not hash to the id the file declares. */
  | 'hash-mismatch'
  /** The filename is not `eventFileName(declared id)`. */
  | 'name-mismatch'
  /** Something that is not an event blob is sitting in `events/`. */
  | 'unexpected-entry';

export interface LedgerProblem {
  /** Repo-relative path within the ledger tree, e.g. `events/<64-hex>.yaml`. */
  readonly path: string;
  readonly blob: GitObjectId | null;
  readonly code: LedgerProblemCode;
  readonly message: string;
  readonly errors?: readonly ContractError[];
}

/**
 * Tamper evidence, raised rather than returned. A ledger is only worth folding if reading it is
 * all-or-nothing: silently dropping the one blob whose hash does not match its content would
 * turn the single most important signal the store can produce — someone edited history — into a
 * quietly smaller event set.
 */
export class LedgerIntegrityError extends Error {
  readonly problems: readonly LedgerProblem[];

  constructor(ref: string, problems: readonly LedgerProblem[]) {
    super(
      `ledger ${ref} failed integrity checks (${problems.length} problem(s)):\n` +
        problems.map((p) => `  ${p.path} [${p.code}]: ${p.message}`).join('\n'),
    );
    this.name = 'LedgerIntegrityError';
    this.problems = problems;
  }
}

/** The bounded retry ran out. Distinct from a transport failure on purpose (Q-50). */
export class LedgerConcurrencyError extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = 'LedgerConcurrencyError';
    this.attempts = attempts;
  }
}

// ---------------------------------------------------------------------------
// Serialization: the bytes must be a pure function of the event
// ---------------------------------------------------------------------------

function isSafeYamlKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

function emitScalar(value: null | boolean | number | string, at: string): Parsed<string> {
  if (value === null) return ok('null');
  if (typeof value === 'boolean') return ok(value ? 'true' : 'false');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return fail('non-canonical-value', `non-finite number ${String(value)}`, at);
    }
    // Mirrors src/core/canonical.ts: `-0` normalizes to `0`, shortest round-trip form.
    return ok(Object.is(value, -0) ? '0' : String(value));
  }
  // A JSON string literal is a valid YAML 1.2 double-quoted scalar with identical escapes, so
  // this round-trips through `yaml`'s parser byte-for-byte and never needs quoting heuristics.
  return ok(JSON.stringify(value));
}

function definedKeys(obj: CanonicalObject): readonly string[] {
  // Same order src/core/canonical.ts hashes in: ascending UTF-16 code unit, `undefined` dropped.
  return Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function emitValue(
  key: string,
  value: CanonicalValue,
  indent: number,
  at: string,
  out: string[],
): Parsed<true> {
  const pad = ' '.repeat(indent);
  const label = isSafeYamlKey(key) ? key : JSON.stringify(key);

  if (Array.isArray(value)) {
    const items = value as readonly CanonicalValue[];
    if (items.length === 0) {
      out.push(`${pad}${label}: []`);
      return ok(true);
    }
    out.push(`${pad}${label}:`);
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i] as CanonicalValue;
      if (item !== null && typeof item === 'object') {
        // No array in the event body holds a composite today, and inventing a block-sequence
        // nesting convention for one would fix bytes the contract has not asked for.
        return fail('non-canonical-value', 'composite array items are not emitted', `${at}/${i}`);
      }
      const scalar = emitScalar(item, `${at}/${i}`);
      if (!scalar.ok) return scalar;
      out.push(`${pad}  - ${scalar.value}`);
    }
    return ok(true);
  }

  if (value !== null && typeof value === 'object') {
    const obj = value as CanonicalObject;
    const keys = definedKeys(obj);
    if (keys.length === 0) {
      out.push(`${pad}${label}: {}`);
      return ok(true);
    }
    out.push(`${pad}${label}:`);
    for (const k of keys) {
      const r = emitValue(k, obj[k] as CanonicalValue, indent + 2, `${at}/${k}`, out);
      if (!r.ok) return r;
    }
    return ok(true);
  }

  const scalar = emitScalar(value, at);
  if (!scalar.ok) return scalar;
  out.push(`${pad}${label}: ${scalar.value}`);
  return ok(true);
}

/**
 * The generic emitter: a `CanonicalObject` rendered to the block YAML this ledger stores.
 *
 * Exported because `accumulators/` needs exactly this and nothing else — a second emitter for the
 * derived cache would be a second answer to Q-48's question, and the two would drift on the day
 * one of them learned to quote something.
 *
 * `firstKeys` is emitted (when present) before the rest, which follow in the same
 * ascending-code-unit order `canonicalize` hashes in. It exists for one key: an event's `event`
 * field, which spec 02 §2's own record puts first and which cannot be part of what it addresses.
 */
export function emitCanonicalYaml(
  obj: CanonicalObject,
  firstKeys: readonly string[] = [],
): Parsed<string> {
  const out: string[] = [];
  const emitted = new Set<string>();

  for (const key of firstKeys) {
    const value = obj[key];
    if (value === undefined) continue;
    const r = emitValue(key, value, 0, `/${key}`, out);
    if (!r.ok) return r;
    emitted.add(key);
  }
  for (const key of definedKeys(obj)) {
    if (emitted.has(key)) continue;
    const r = emitValue(key, obj[key] as CanonicalValue, 0, `/${key}`, out);
    if (!r.ok) return r;
  }
  return ok(`${out.join('\n')}\n`);
}

/**
 * The stored bytes of one event, and a PURE FUNCTION OF THE EVENT — which is not a nicety. The
 * filename is the hash of the canonical body (spec 02 §1), so if two writers could render the
 * same event to different bytes, the same name would address two blobs and the set-union merge
 * would stop being total.
 *
 * Purity comes from `canonicalEventBody` (which fixes the key SET and drops `undefined`) plus
 * the key ORDER used here, which is the same ascending-code-unit order `canonicalize` hashes
 * in. The only key not from the canonical body is `event` itself — the id cannot be part of
 * what it addresses — and it is emitted first, matching spec 02 §2's own record.
 *
 * Q-24 fixed what is HASHED; nothing fixed what is STORED. See docs/spec/OPEN-QUESTIONS.md
 * Q-48 for the stored form and why it nevertheless has to be pinned.
 */
export function serializeEvent(event: LedgerEvent): Parsed<string> {
  const verified = verifyEventId(event);
  if (!verified.ok) return verified;

  const { event: id, ...rest } = event;
  const body = canonicalEventBody(rest as EventBody);
  return emitCanonicalYaml({ ...body, event: id }, ['event']);
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export interface GitRefEventStoreOptions {
  /** A path inside the repository whose ledger ref is being read and written. */
  readonly cwd: string;
  readonly ref?: string;
  readonly gitBin?: string;
  readonly identity?: { readonly name: string; readonly email: string };
  /** Injectable clock, so a test can pin ledger commit metadata. */
  readonly now?: () => Date;
  readonly maxAppendAttempts?: number;
  readonly maxPushAttempts?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export interface LedgerScan {
  readonly ref: string;
  readonly tip: GitObjectId | null;
  /** Sorted by `compareForFold` — committer time, then event id (Q-11). */
  readonly events: readonly LedgerEvent[];
  readonly problems: readonly LedgerProblem[];
}

export type MergeOutcome =
  | { readonly kind: 'remote-absent' }
  | { readonly kind: 'already-current'; readonly tip: GitObjectId }
  | { readonly kind: 'fast-forward'; readonly tip: GitObjectId }
  | { readonly kind: 'merged'; readonly tip: GitObjectId; readonly parents: readonly GitObjectId[] };

export interface PushResult {
  readonly pushed: boolean;
  readonly attempts: number;
  readonly tip: GitObjectId | null;
  readonly merges: readonly MergeOutcome[];
}

export interface PushOptions {
  readonly maxAttempts?: number;
  /**
   * Test seam. Called immediately before each `git push`, which is the only instant at which a
   * competing writer can be injected deterministically. Production callers pass nothing.
   */
  readonly beforePush?: (attempt: number) => Promise<void> | void;
}

interface PendingEvent {
  readonly id: EventId;
  readonly name: string;
  readonly bytes: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * One construction of the git shell, shared by the store and by the derived-cache writer below,
 * so "which repository, which binary, which environment" is answered in one place.
 */
function execFor(options: GitRefEventStoreOptions): GitExec {
  return createGitExec({
    cwd: options.cwd,
    ...(options.gitBin !== undefined ? { gitBin: options.gitBin } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
  });
}

function identityAt(options: GitRefEventStoreOptions): {
  name: string;
  email: string;
  date: string;
} {
  const now = options.now ?? ((): Date => new Date());
  return { ...(options.identity ?? DEFAULT_IDENTITY), date: now().toISOString() };
}

/**
 * The event store on `refs/program/ledger`.
 *
 * Everything is written with plumbing (`hash-object -w`, `mktree`, `commit-tree`,
 * `update-ref`), so an append touches no working tree, stages nothing and moves no branch — the
 * repository can be mid-rebase and the ledger still records.
 */
export class GitRefEventStore implements EventStore {
  readonly ref: string;

  readonly #git: GitExec;
  readonly #identity: { readonly name: string; readonly email: string };
  readonly #now: () => Date;
  readonly #maxAppendAttempts: number;
  readonly #maxPushAttempts: number;

  constructor(options: GitRefEventStoreOptions) {
    this.ref = options.ref ?? LEDGER_REF;
    this.#git = execFor(options);
    this.#identity = options.identity ?? DEFAULT_IDENTITY;
    this.#now = options.now ?? ((): Date => new Date());
    this.#maxAppendAttempts = options.maxAppendAttempts ?? DEFAULT_MAX_APPEND_ATTEMPTS;
    this.#maxPushAttempts = options.maxPushAttempts ?? DEFAULT_MAX_PUSH_ATTEMPTS;
  }

  /** The ledger's current tip commit, or `null` before the first append. */
  async tip(): Promise<GitObjectId | null> {
    return revParse(this.#git, this.ref);
  }

  // -------------------------------------------------------------------------
  // append
  // -------------------------------------------------------------------------

  /**
   * Appends events, skipping any whose blob already exists at its content-addressed path.
   *
   * THAT SKIP IS THE WHOLE IDEMPOTENCY STORY. The filename is the hash of the canonical body, so
   * "have I already recorded this observation?" is answered by a path lookup — no dedupe table,
   * no unique index, no clock. A repeated append is therefore a no-op that reports `deduped`
   * rather than an error (spec 02 §1, ADR-0002 "idempotent writes").
   *
   * One commit per successful attempt, adding every genuinely new blob at once. On a lost
   * compare-and-swap the whole attempt is re-derived against the winner's tip, which is why two
   * processes appending concurrently to the same ref converge instead of clobbering.
   */
  async append(events: NonEmptyReadonlyArray<LedgerEvent>): Promise<AppendOutcome> {
    const pending = this.#prepare(events);

    for (let attempt = 1; attempt <= this.#maxAppendAttempts; attempt += 1) {
      const tip = await revParse(this.#git, this.ref);
      const rootEntries = tip === null ? [] : await lsTree(this.#git, tip);
      const eventEntries =
        tip === null ? [] : await lsTree(this.#git, `${tip}:${EVENTS_TREE_NAME}`);
      // Keyed by name AND carrying the tree entry: a dedupe is only sound if the blob at the
      // content-addressed name IS this event. A filename-only skip reports a garbage or
      // wrong-typed occupant as `deduped` — a success — while the observation is never recorded
      // and nobody is told (the audit's store.ts:427 probe). So the occupant is verified below.
      const existing = new Map(eventEntries.map((e) => [e.name, e] as const));

      const written: EventId[] = [];
      const deduped: EventId[] = [];
      const fresh: PendingEvent[] = [];
      const seen = new Set<string>();
      const problems: LedgerProblem[] = [];

      for (const p of pending) {
        if (seen.has(p.name)) {
          // Same event twice in one batch. `#prepare` proved same name => same bytes, so this is
          // a genuine repeat, deduped once the first copy is accounted for.
          deduped.push(p.id);
          continue;
        }
        const occupant = existing.get(p.name);
        if (occupant !== undefined) {
          const path = `${EVENTS_TREE_NAME}/${p.name}`;
          if (occupant.type !== 'blob') {
            problems.push({
              path,
              blob: occupant.id,
              code: 'unexpected-entry',
              message:
                `${p.name} is a ${occupant.type}, not the event blob it is named for. An event ` +
                'cannot be recorded over a non-blob occupant, and this is not a dedupe (INV-002).',
            });
            continue;
          }
          const actual = await hashObject(this.#git, p.bytes);
          if (occupant.id !== actual) {
            problems.push({
              path,
              blob: occupant.id,
              code: 'hash-mismatch',
              message:
                `${p.name} already holds blob ${occupant.id}, which is NOT this event (whose ` +
                `canonical body hashes to ${actual}). The content-addressed slot is occupied by ` +
                'something other than the observation it names — tamper evidence, not a dedupe ' +
                '(spec 02 §1, INV-002).',
            });
            continue;
          }
          // The recorded blob IS this event: a genuine content-addressed no-op.
          deduped.push(p.id);
          continue;
        }
        seen.add(p.name);
        written.push(p.id);
        fresh.push(p);
      }

      // A slot occupied by anything other than the very event that belongs there is tamper
      // evidence, raised rather than swallowed — the same all-or-nothing contract `list()` holds.
      if (problems.length > 0) throw new LedgerIntegrityError(this.ref, problems);

      if (fresh.length === 0) return { written: [], deduped };

      const added: TreeEntry[] = [];
      for (const p of fresh) {
        const blob = await hashObjectWrite(this.#git, p.bytes);
        added.push({ mode: BLOB_MODE, type: 'blob', id: blob, name: p.name });
      }

      const eventsTree = await this.#mktreeEvents(eventEntries, added);
      const root = await mktree(
        this.#git,
        withTreeEntry(rootEntries, {
          mode: TREE_MODE,
          type: 'tree',
          id: eventsTree,
          name: EVENTS_TREE_NAME,
        }),
      );

      const commit = await commitTree(this.#git, {
        tree: root,
        parents: tip === null ? [] : [tip],
        message: `ledger: append ${fresh.length} event(s)`,
        identity: this.#identityAtNow(),
      });

      const update = await updateRefCas(this.#git, this.ref, commit, tip);
      if (update.ok) return { written, deduped };

      // Someone else moved the ref. The blobs we wrote are already in the object database and
      // are content-addressed, so re-deriving against the new tip costs nothing and loses
      // nothing — this is the local twin of push-with-retry.
      await sleep(2 + Math.floor(Math.random() * 12));
    }

    throw new LedgerConcurrencyError(
      `append to ${this.ref} lost the compare-and-swap ${this.#maxAppendAttempts} times; ` +
        'another writer is monopolising the ref',
      this.#maxAppendAttempts,
    );
  }

  // -------------------------------------------------------------------------
  // read
  // -------------------------------------------------------------------------

  /**
   * Every `events/*.yaml` at the tip, decoded and hash-verified. Throws `LedgerIntegrityError`
   * on ANY problem: "a blob whose name does not match its content hash is tamper evidence"
   * (spec 02 §1, and the check `gwtp validate` deliberately does not do — see Q-37).
   */
  async list(): Promise<readonly LedgerEvent[]> {
    const scan = await this.scan();
    if (scan.problems.length > 0) throw new LedgerIntegrityError(this.ref, scan.problems);
    return scan.events;
  }

  /** `list()` without the throw, for callers that want to report rather than abort. */
  async scan(): Promise<LedgerScan> {
    const tip = await revParse(this.#git, this.ref);
    if (tip === null) return { ref: this.ref, tip: null, events: [], problems: [] };

    const entries = await lsTree(this.#git, `${tip}:${EVENTS_TREE_NAME}`);
    const problems: LedgerProblem[] = [];
    const blobs: TreeEntry[] = [];

    for (const entry of entries) {
      const path = `${EVENTS_TREE_NAME}/${entry.name}`;
      if (entry.type !== 'blob') {
        problems.push({
          path,
          blob: entry.id,
          code: 'unexpected-entry',
          message: `expected a blob, found a ${entry.type}`,
        });
        continue;
      }
      blobs.push(entry);
    }

    const contents = await catFileBatch(
      this.#git,
      blobs.map((b) => b.id),
    );
    const events: LedgerEvent[] = [];

    for (const entry of blobs) {
      const path = `${EVENTS_TREE_NAME}/${entry.name}`;
      const text = contents.get(entry.id);
      if (text === undefined) {
        problems.push({
          path,
          blob: entry.id,
          code: 'unreadable',
          message: `blob ${entry.id} is named by the tree but missing from the object database`,
        });
        continue;
      }

      let raw: unknown;
      try {
        raw = parseYaml(text);
      } catch (e) {
        problems.push({
          path,
          blob: entry.id,
          code: 'malformed',
          message: `not YAML: ${(e as Error).message}`,
        });
        continue;
      }

      const decoded = decodeLedgerEvent(raw, path);
      if (!decoded.ok) {
        problems.push({
          path,
          blob: entry.id,
          code: 'malformed',
          message: decoded.error.map((x) => `${x.code}${x.at ?? ''}: ${x.message}`).join('; '),
          errors: decoded.error,
        });
        continue;
      }

      const event = decoded.value;
      const verified = verifyEventId(event);
      if (!verified.ok) {
        problems.push({
          path,
          blob: entry.id,
          code: 'hash-mismatch',
          message: verified.error.message,
          errors: [verified.error],
        });
        continue;
      }

      const expectedName = eventFileName(event.event);
      if (expectedName !== entry.name) {
        problems.push({
          path,
          blob: entry.id,
          code: 'name-mismatch',
          message: `event ${event.event} belongs at ${expectedName}, not ${entry.name}`,
        });
        continue;
      }

      events.push(event);
    }

    return {
      ref: this.ref,
      tip,
      events: [...events].sort(compareForFold),
      problems: problems.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    };
  }

  // -------------------------------------------------------------------------
  // convergence: fetch -> merge as set union -> fast-forward -> retry
  // -------------------------------------------------------------------------

  /**
   * Brings the remote's ledger into the local one WITHOUT losing anything on either side.
   *
   * Four cases, and only the last needs a merge commit: the remote has no ledger; the remote is
   * already an ancestor of ours; we are an ancestor of the remote (fast-forward); or the two
   * diverged, in which case the union of the `events/` trees is taken. The union is total
   * because an event's name is the hash of its body — two histories that both contain an event
   * necessarily agree on its bytes — so there is no conflict to resolve and no order in which
   * to resolve it.
   */
  async fetchAndMerge(remote: string): Promise<MergeOutcome> {
    const advertised = await lsRemoteRef(this.#git, remote, this.ref);
    if (advertised === null) return { kind: 'remote-absent' };

    const fetched = await fetchRefToFetchHead(this.#git, remote, this.ref);
    if (fetched === null) return { kind: 'remote-absent' };

    const local = await revParse(this.#git, this.ref);
    if (local === null) {
      const update = await updateRefCas(this.#git, this.ref, fetched, null);
      if (!update.ok) throw new LedgerConcurrencyError(update.message, 1);
      return { kind: 'fast-forward', tip: fetched };
    }
    if (local === fetched) return { kind: 'already-current', tip: local };
    if (await isAncestor(this.#git, fetched, local)) return { kind: 'already-current', tip: local };
    if (await isAncestor(this.#git, local, fetched)) {
      // A remote descendant is adopted wholesale ONLY when its `events/` set still CONTAINS ours.
      // Ancestry is not containment: a legitimately-shaped child commit can drop an event blob,
      // and fast-forwarding to it would delete that event from the local ledger with no error —
      // an INV-002 breach reached through the convergence path (the audit's store.ts:632 probe).
      // When containment fails, fall through to the union, which re-includes whatever the
      // descendant removed and loses nothing on either side (the union of a set with a superset
      // that dropped members is still the full set). Spec 02 §1.1; docs/spec/OPEN-QUESTIONS Q-49.
      if (await this.#eventsContain(fetched, local)) {
        const update = await updateRefCas(this.#git, this.ref, fetched, local);
        if (!update.ok) throw new LedgerConcurrencyError(update.message, 1);
        return { kind: 'fast-forward', tip: fetched };
      }
    }

    const merged = await this.#unionCommit(local, fetched);
    const update = await updateRefCas(this.#git, this.ref, merged, local);
    if (!update.ok) throw new LedgerConcurrencyError(update.message, 1);
    return { kind: 'merged', tip: merged, parents: [local, fetched] };
  }

  /**
   * Push-with-retry — "the property that makes concurrent CI runs safe" (spec 02 §1.1).
   *
   * fetch -> merge as set union -> fast-forward push -> retry on rejection, bounded. Nothing
   * here forces: a rejection means the remote grew events we have not merged, and the answer to
   * that is always to absorb them and try again, never to overwrite. Exhausting the bound
   * raises `LedgerConcurrencyError` rather than returning quietly, because a ledger write that
   * silently did not happen is worse than a failed CI step.
   */
  async pushWithRetry(remote: string, options: PushOptions = {}): Promise<PushResult> {
    const maxAttempts = options.maxAttempts ?? this.#maxPushAttempts;
    const merges: MergeOutcome[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      merges.push(await this.fetchAndMerge(remote));

      const local = await revParse(this.#git, this.ref);
      if (local === null) return { pushed: false, attempts: attempt, tip: null, merges };

      if (options.beforePush !== undefined) await options.beforePush(attempt);

      const outcome = await pushRef(this.#git, remote, local, this.ref);
      if (outcome.ok) return { pushed: true, attempts: attempt, tip: local, merges };
      if (!outcome.rejected) {
        throw new Error(`push of ${this.ref} to ${remote} failed: ${outcome.message}`);
      }
      await sleep(2 + Math.floor(Math.random() * 12));
    }

    throw new LedgerConcurrencyError(
      `push of ${this.ref} to ${remote} was rejected ${maxAttempts} times; ` +
        'the remote ledger is moving faster than this writer can merge it',
      maxAttempts,
    );
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  #identityAtNow(): { name: string; email: string; date: string } {
    return { ...this.#identity, date: this.#now().toISOString() };
  }

  /** The set of `events/*.yaml` names at one ledger tip. */
  async #eventNames(tip: GitObjectId): Promise<ReadonlySet<string>> {
    const entries = await lsTree(this.#git, `${tip}:${EVENTS_TREE_NAME}`);
    return new Set(entries.map((e) => e.name));
  }

  /**
   * Is `candidate`'s `events/` set a SUPERSET of `base`'s? The append-only test for a
   * fast-forward: a commit may only be adopted wholesale if it still records everything the ref
   * it replaces recorded. Cheap — two `ls-tree`s of one tree level, no blob reads.
   */
  async #eventsContain(candidate: GitObjectId, base: GitObjectId): Promise<boolean> {
    const [have, need] = await Promise.all([
      this.#eventNames(candidate),
      this.#eventNames(base),
    ]);
    for (const name of need) if (!have.has(name)) return false;
    return true;
  }

  /**
   * Serializes and validates the batch before a single git process is spawned, so a malformed
   * event fails before anything is written rather than half-way through a tree build.
   */
  #prepare(events: NonEmptyReadonlyArray<LedgerEvent>): readonly PendingEvent[] {
    const problems: LedgerProblem[] = [];
    const pending: PendingEvent[] = [];
    const byName = new Map<string, string>();

    for (const event of events) {
      const name = eventFileName(event.event);
      const path = `${EVENTS_TREE_NAME}/${name}`;

      if (eventFilePath(event.event) !== path) {
        problems.push({
          path,
          blob: null,
          code: 'name-mismatch',
          message: `eventFilePath disagrees with ${EVENTS_TREE_NAME}/ layout`,
        });
        continue;
      }

      const bytes = serializeEvent(event);
      if (!bytes.ok) {
        problems.push({
          path,
          blob: null,
          code: bytes.error.code === 'hash-mismatch' ? 'hash-mismatch' : 'malformed',
          message: bytes.error.message,
          errors: [bytes.error],
        });
        continue;
      }

      // Same name, different bytes would mean the serializer is not a pure function of the
      // event — the assumption the whole content-addressing scheme rests on. Refuse.
      const prior = byName.get(name);
      if (prior !== undefined && prior !== bytes.value) {
        problems.push({
          path,
          blob: null,
          code: 'hash-mismatch',
          message: `two events in one batch share ${name} but serialize differently`,
        });
        continue;
      }
      byName.set(name, bytes.value);
      pending.push({ id: event.event, name, bytes: bytes.value });
    }

    if (problems.length > 0) throw new LedgerIntegrityError(this.ref, problems);
    return pending;
  }

  /**
   * The one place a new `events/` tree is built, and the one place INV-002 could be broken.
   * A name already present with a different blob id means an existing event blob would be
   * REWRITTEN, which is exactly what append-only forbids — so it raises instead.
   */
  async #mktreeEvents(
    existing: readonly TreeEntry[],
    incoming: readonly TreeEntry[],
  ): Promise<GitObjectId> {
    const union = unionTreeEntries(existing, incoming);
    if (union.collisions.length > 0) {
      throw new LedgerIntegrityError(
        this.ref,
        union.collisions.map((c) => ({
          path: `${EVENTS_TREE_NAME}/${c.name}`,
          blob: c.ours,
          code: 'hash-mismatch' as const,
          message:
            `${c.name} already holds blob ${c.ours} and would be rewritten to ${c.theirs}. ` +
            'Events are append-only (INV-002); corrections supersede.',
        })),
      );
    }
    return mktree(this.#git, union.entries);
  }

  /** Builds the union tree of two ledger tips and commits it with both as parents. */
  async #unionCommit(ours: GitObjectId, theirs: GitObjectId): Promise<GitObjectId> {
    const ourEvents = await lsTree(this.#git, `${ours}:${EVENTS_TREE_NAME}`);
    const theirEvents = await lsTree(this.#git, `${theirs}:${EVENTS_TREE_NAME}`);
    const eventsTree = await this.#mktreeEvents(ourEvents, theirEvents);

    const ourRoot = await lsTree(this.#git, ours);
    const theirRoot = await lsTree(this.#git, theirs);
    // Spec 02 §1.1 specifies set union for `events/` and for nothing else. Outside it the tree
    // holds DERIVED caches — `accumulators/` is "recomputable at will, cacheable, never
    // authoritative" (ADR-0002) and `epochs/` is compaction output. A collision there needs no
    // reconciliation: keeping ours and letting the next fold rewrite it loses nothing, whereas
    // inventing a numeric merge for two accumulator snapshots would fabricate a state no fold
    // ever produced. See docs/spec/OPEN-QUESTIONS.md Q-49.
    const rootUnion = unionTreeEntries(ourRoot, theirRoot);
    const root = await mktree(
      this.#git,
      withTreeEntry(rootUnion.entries, {
        mode: TREE_MODE,
        type: 'tree',
        id: eventsTree,
        name: EVENTS_TREE_NAME,
      }),
    );

    return commitTree(this.#git, {
      tree: root,
      parents: [ours, theirs],
      message: 'ledger: set-union merge',
      identity: this.#identityAtNow(),
    });
  }
}

// ---------------------------------------------------------------------------
// The DERIVED levels of the tree (`accumulators/`, `epochs/`) — everything but `events/`
// ---------------------------------------------------------------------------

/** One derived file, at a `<dir>/<name>` path inside the ledger tree. */
export interface DerivedFile {
  readonly path: string;
  readonly content: string;
}

export interface DerivedWriteResult {
  readonly ref: string;
  /** Paths whose blob is new or changed. */
  readonly written: readonly string[];
  /** Paths already present with byte-identical content — the cache was already correct. */
  readonly unchanged: readonly string[];
  /** `null` when nothing changed and no commit was made. */
  readonly commit: GitObjectId | null;
}

const DERIVED_PATH = /^([A-Za-z0-9][A-Za-z0-9._%-]*)\/([A-Za-z0-9][A-Za-z0-9._%-]*)$/;

/**
 * Writes the DERIVED levels of the ledger tree and nothing else. Deliberately a free function
 * rather than a method: `GitRefEventStore`'s surface is `append | list | scan | tip |
 * fetchAndMerge | pushWithRetry` and INV-002 is the ABSENCE of anything else on it
 * (tests/ledger/store.test.ts asserts that list). A cache writer hanging off the same object
 * would put a rewrite next to the event store, one autocomplete away from the wrong caller.
 *
 * INV-002 is enforced HERE by a path guard, not by convention: any path under `events/` is
 * refused outright. What remains — `accumulators/`, `epochs/` — is what ADR-0002 calls
 * "recomputable at will, cacheable, never authoritative", so rewriting one loses nothing that
 * the next fold cannot regenerate. `unionTreeEntries` is deliberately NOT used: a derived file
 * is meant to be replaced by its newer computation, which is precisely the operation the
 * `events/` level forbids.
 *
 * Content-addressed idempotency, again for free: a file whose blob id already matches is
 * reported `unchanged`, and a batch in which every file is unchanged makes NO commit at all —
 * so `gwtp ledger fold --write` twice in a row leaves one commit, not two.
 */
export async function writeDerivedFiles(
  options: GitRefEventStoreOptions,
  files: readonly DerivedFile[],
  message = 'ledger: materialize derived cache',
): Promise<DerivedWriteResult> {
  const ref = options.ref ?? LEDGER_REF;
  const git = execFor(options);

  const problems: LedgerProblem[] = [];
  const byDir = new Map<string, Map<string, string>>();
  for (const file of files) {
    const m = DERIVED_PATH.exec(file.path);
    if (m === null) {
      problems.push({
        path: file.path,
        blob: null,
        code: 'unexpected-entry',
        message: 'a derived file lives at `<dir>/<name>` inside the ledger tree',
      });
      continue;
    }
    const dir = m[1] as string;
    if (dir === EVENTS_TREE_NAME) {
      problems.push({
        path: file.path,
        blob: null,
        code: 'unexpected-entry',
        message:
          `${EVENTS_TREE_NAME}/ is append-only (INV-002) and is written by \`append\` alone; ` +
          'corrections supersede, and nothing rewrites an event.',
      });
      continue;
    }
    const slot = byDir.get(dir) ?? new Map<string, string>();
    const prior = slot.get(m[2] as string);
    if (prior !== undefined && prior !== file.content) {
      problems.push({
        path: file.path,
        blob: null,
        code: 'unexpected-entry',
        message: 'two derived files in one batch share a path but differ in content',
      });
      continue;
    }
    slot.set(m[2] as string, file.content);
    byDir.set(dir, slot);
  }
  if (problems.length > 0) throw new LedgerIntegrityError(ref, problems);
  if (byDir.size === 0) return { ref, written: [], unchanged: [], commit: null };

  const tip = await revParse(git, ref);
  const rootEntries = tip === null ? [] : await lsTree(git, tip);
  let root = rootEntries;

  const written: string[] = [];
  const unchanged: string[] = [];

  for (const [dir, slot] of [...byDir].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const existing = tip === null ? [] : await lsTree(git, `${tip}:${dir}`);
    let entries = existing;
    for (const [name, content] of [...slot].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const blob = await hashObjectWrite(git, content);
      const prior = existing.find((e) => e.name === name);
      if (prior !== undefined && prior.id === blob && prior.type === 'blob') {
        unchanged.push(`${dir}/${name}`);
        continue;
      }
      written.push(`${dir}/${name}`);
      entries = withTreeEntry(entries, { mode: BLOB_MODE, type: 'blob', id: blob, name });
    }
    if (entries === existing) continue;
    const tree = await mktree(git, entries);
    root = withTreeEntry(root, { mode: TREE_MODE, type: 'tree', id: tree, name: dir });
  }

  if (written.length === 0) return { ref, written: [], unchanged, commit: null };

  const rootTree = await mktree(git, root);
  const commit = await commitTree(git, {
    tree: rootTree,
    parents: tip === null ? [] : [tip],
    message,
    identity: identityAt(options),
  });
  const update = await updateRefCas(git, ref, commit, tip);
  if (!update.ok) {
    throw new LedgerConcurrencyError(
      `writing the derived cache to ${ref} lost the compare-and-swap: ${update.message}. ` +
        'Accumulators are derived (ADR-0002) — re-fold and write again.',
      1,
    );
  }
  return { ref, written, unchanged, commit };
}
