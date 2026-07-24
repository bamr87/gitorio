// Implements tests for: docs/spec/02-ledger.md §1 (the ledger ref, the `events/` tree layout,
// content-addressed idempotent writes), §2 (the observation record), and INV-002
// ("Ledger writes are append-only content-addressed events; corrections supersede, never mutate
// or delete").
//
// SEED-02 acceptance covered here: idempotent double-append, and tamper detection.
//
// EVERY git-writing test runs against a THROWAWAY repository under the OS temp directory. This
// suite never creates `refs/program/ledger` in the repository it is checked into — the ledger is
// surveillance, and a test suite that surveilled its own project would be writing history it was
// not asked to write.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  decodeLedgerEvent,
  decodeVerdict,
  eventBodyFromVerdict,
  eventFileName,
  eventFilePath,
  hashBlob,
  isNonEmpty,
  parseCommitSha,
  parseCommitterTime,
  parseJudgeId,
  parsePrecision,
  parseRationaleRef,
  sealEvent,
  supersede,
  unwrap,
  verifyEventId,
  type AlignedVerdict,
  type EventSubject,
  type JudgeRef,
  type LedgerEvent,
  type NonEmptyReadonlyArray,
  type ViolationVerdict,
} from '../../src/core/index.js';
import {
  BLOB_MODE,
  formatTreeEntries,
  parseTreeEntries,
  type GitObjectId,
  type TreeEntry,
} from '../../src/ledger/git.js';
import {
  EVENTS_TREE_NAME,
  GitRefEventStore,
  LEDGER_REF,
  LedgerIntegrityError,
  serializeEvent,
} from '../../src/ledger/store.js';

// ---------------------------------------------------------------------------
// Throwaway repositories
// ---------------------------------------------------------------------------

/**
 * Every test that touches a repository spawns real `git` processes. Vitest's default 5s budget
 * measures how busy the machine is, not whether the store is correct, so subprocess tests carry
 * an explicit generous one. The pure tests keep the default.
 */
const GIT_TEST_TIMEOUT = 120_000;

const workspaces: string[] = [];

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

function workspace(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `gwtp-${name}-`));
  workspaces.push(dir);
  return dir;
}

/** Raw git, for arranging fixtures and for the tamper tests the store itself refuses to do. */
function git(cwd: string, args: readonly string[], input?: string): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    ...(input !== undefined ? { input } : {}),
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'fixture',
      GIT_AUTHOR_EMAIL: 'fixture@localhost',
      GIT_COMMITTER_NAME: 'fixture',
      GIT_COMMITTER_EMAIL: 'fixture@localhost',
    },
  }).trim();
}

function initRepo(name: string): string {
  const dir = workspace(name);
  git(dir, ['init', '-q', '-b', 'main', '.']);
  git(dir, ['config', 'user.email', 'fixture@localhost']);
  git(dir, ['config', 'user.name', 'fixture']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'base']);
  return dir;
}

// ---------------------------------------------------------------------------
// Event fixtures
// ---------------------------------------------------------------------------

const JUDGE: JudgeRef = { kind: 'model', id: unwrap(parseJudgeId('claude-invariant-judge')) };
const PRECISION = unwrap(parsePrecision(0.9));

function driftEvent(n: number): LedgerEvent {
  const verdict = unwrap(
    decodeVerdict({
      assertion: 'INV-007',
      verdict: 'drift',
      severity: 'breach',
      confidence: 0.8,
      evidence: [`core/http.rs:${n}-${n + 5}`],
      rationale: `imports reqwest inside core/ (${n})`,
    }),
  ) as ViolationVerdict;

  return unwrap(
    sealEvent(
      eventBodyFromVerdict({
        verdict,
        subject: {
          commit: unwrap(parseCommitSha(n.toString(16).padStart(6, '0'))),
        } as EventSubject,
        judge: JUDGE,
        t: unwrap(parseCommitterTime(`2026-07-${String((n % 27) + 1).padStart(2, '0')}T14:03:00Z`)),
        precision_at: PRECISION,
        rationale: unwrap(parseRationaleRef(hashBlob(`rationale ${n}`))),
      }),
    ),
  );
}

function alignedEvent(n: number): LedgerEvent {
  const verdict = unwrap(
    decodeVerdict({ assertion: 'INV-007', verdict: 'aligned', confidence: 0.95 }),
  ) as AlignedVerdict;

  return unwrap(
    sealEvent(
      eventBodyFromVerdict({
        verdict,
        // `orphaned` is emitted only when TRUE — absence and `false` are the same fact and must
        // not hash two ways (src/core/event.ts, Q-24) — so the fixture never sets it to `false`.
        subject: {
          path: `src/core/file-${n}.ts`,
          ...(n % 2 === 0 ? { orphaned: true } : {}),
        } as EventSubject,
        judge: JUDGE,
        t: unwrap(parseCommitterTime(`2026-06-${String((n % 27) + 1).padStart(2, '0')}T09:00:00Z`)),
      }),
    ),
  );
}

function batch(events: readonly LedgerEvent[]): NonEmptyReadonlyArray<LedgerEvent> {
  if (!isNonEmpty(events)) throw new Error('empty batch');
  return events;
}

const ids = (events: readonly LedgerEvent[]): readonly string[] => [...events.map((e) => e.event)].sort();

function eventTreeLines(repo: string, ref = LEDGER_REF): readonly string[] {
  const out = git(repo, ['ls-tree', `${ref}:${EVENTS_TREE_NAME}`]);
  return out === '' ? [] : out.split('\n');
}

// ---------------------------------------------------------------------------
// Serialization — the bytes are a pure function of the event
// ---------------------------------------------------------------------------

describe('serializeEvent (spec 02 §1: filename = hash of canonical body)', () => {
  it('is a pure function of the event', () => {
    const event = driftEvent(1);
    const a = unwrap(serializeEvent(event));
    const b = unwrap(serializeEvent(event));
    // A structurally identical, independently sealed event must serialize identically too:
    // if it did not, one observation would address two blobs and set-union would stop being
    // total.
    const c = unwrap(serializeEvent(driftEvent(1)));
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('round-trips through the read contract with its id intact', () => {
    for (const event of [driftEvent(3), alignedEvent(4), alignedEvent(5)]) {
      const bytes = unwrap(serializeEvent(event));
      const decoded = unwrap(decodeLedgerEvent(parseYaml(bytes)));
      expect(decoded).toEqual(event);
      expect(unwrap(verifyEventId(decoded))).toBe(true);
    }
  });

  it('leads with `event` and then emits canonical key order', () => {
    const bytes = unwrap(serializeEvent(driftEvent(1)));
    const topLevel = bytes
      .split('\n')
      .filter((l) => l !== '' && !l.startsWith(' '))
      .map((l) => l.slice(0, l.indexOf(':')));
    expect(topLevel[0]).toBe('event');
    expect(topLevel.slice(1)).toEqual([...topLevel.slice(1)].sort());
  });

  it('keeps `supersedes` present and null rather than absent (Q-24)', () => {
    const bytes = unwrap(serializeEvent(driftEvent(1)));
    expect(bytes).toContain('supersedes: null');
    const supersession = unwrap(
      supersede(driftEvent(1), {
        verdict: unwrap(
          decodeVerdict({ assertion: 'INV-007', verdict: 'aligned', confidence: 0.9 }),
        ) as AlignedVerdict,
        subject: { commit: unwrap(parseCommitSha('000001')) } as EventSubject,
        judge: JUDGE,
        t: unwrap(parseCommitterTime('2026-07-22T10:00:00Z')),
      }),
    );
    expect(unwrap(serializeEvent(supersession))).toContain(
      `supersedes: "${driftEvent(1).event}"`,
    );
  });

  it('refuses to serialize an event whose id does not hash its body', () => {
    const forged = { ...driftEvent(1), severity: 0.25 } as LedgerEvent;
    const r = serializeEvent(forged);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('hash-mismatch');
  });
});

// ---------------------------------------------------------------------------
// Tree plumbing — pure, no repository involved
// ---------------------------------------------------------------------------

describe('tree entry plumbing (pure)', () => {
  const entry = (name: string, id: string): TreeEntry => ({
    mode: BLOB_MODE,
    type: 'blob',
    id: id.padEnd(40, '0') as GitObjectId,
    name,
  });

  it('round-trips ls-tree output', () => {
    const entries = [entry('b.yaml', 'bb'), entry('a.yaml', 'aa')];
    const text = formatTreeEntries(entries);
    expect(text).toBe(
      `${BLOB_MODE} blob ${'aa'.padEnd(40, '0')}\ta.yaml\n` +
        `${BLOB_MODE} blob ${'bb'.padEnd(40, '0')}\tb.yaml\n`,
    );
    expect(unwrap(parseTreeEntries(text))).toEqual([entry('a.yaml', 'aa'), entry('b.yaml', 'bb')]);
  });

  it('rejects a line it cannot read rather than dropping it', () => {
    const r = parseTreeEntries('100644 blob deadbeef a.yaml\n');
    expect(r.ok).toBe(false);
  });

  it('reads a real ls-tree listing', () => {
    const repo = initRepo('lstree');
    const blob = git(repo, ['hash-object', '-w', '--stdin'], 'x\n');
    const tree = git(repo, ['mktree'], `${BLOB_MODE} blob ${blob}\ta.yaml\n`);
    expect(unwrap(parseTreeEntries(git(repo, ['ls-tree', tree])))).toEqual([
      { mode: BLOB_MODE, type: 'blob', id: blob, name: 'a.yaml' },
    ]);
  }, GIT_TEST_TIMEOUT);
});

// ---------------------------------------------------------------------------
// append
// ---------------------------------------------------------------------------

describe('GitRefEventStore.append (spec 02 §1)', () => {
  it('writes to the ledger ref without touching the working tree or any branch', async () => {
    const repo = initRepo('append-isolation');
    const headBefore = git(repo, ['rev-parse', 'HEAD']);
    const branchesBefore = git(repo, ['branch', '--list']);

    const store = new GitRefEventStore({ cwd: repo });
    expect(await store.tip()).toBeNull();
    await store.append(batch([driftEvent(1)]));

    expect(git(repo, ['rev-parse', 'HEAD'])).toBe(headBefore);
    expect(git(repo, ['branch', '--list'])).toBe(branchesBefore);
    expect(git(repo, ['branch', '--show-current'])).toBe('main');
    expect(git(repo, ['status', '--porcelain'])).toBe('');
    // The ledger is its own chain: invisible to branch listings (spec 02 §1).
    expect(git(repo, ['branch', '--all'])).not.toContain('program');
    expect(await store.tip()).not.toBeNull();
  }, GIT_TEST_TIMEOUT);

  it('lands the event at events/<64-hex>.yaml', async () => {
    const repo = initRepo('append-layout');
    const event = driftEvent(2);
    await new GitRefEventStore({ cwd: repo }).append(batch([event]));

    const paths = git(repo, ['ls-tree', '-r', '--name-only', LEDGER_REF]).split('\n');
    expect(paths).toEqual([eventFilePath(event.event)]);
    expect(paths[0]).toMatch(/^events\/[0-9a-f]{64}\.yaml$/);

    const stored = git(repo, ['cat-file', 'blob', `${LEDGER_REF}:${eventFilePath(event.event)}`]);
    expect(unwrap(decodeLedgerEvent(parseYaml(stored)))).toEqual(event);
  }, GIT_TEST_TIMEOUT);

  it('is idempotent: a second append of the same event is deduped, not rewritten', async () => {
    const repo = initRepo('append-idempotent');
    const store = new GitRefEventStore({ cwd: repo });
    const event = driftEvent(7);

    const first = await store.append(batch([event]));
    expect(first).toEqual({ written: [event.event], deduped: [] });

    const tipAfterFirst = await store.tip();
    const blobAfterFirst = git(repo, ['rev-parse', `${LEDGER_REF}:${eventFilePath(event.event)}`]);

    const second = await store.append(batch([event]));
    expect(second).toEqual({ written: [], deduped: [event.event] });

    // Exactly one blob, unchanged, and no second commit: a dedupe is a genuine no-op.
    expect(eventTreeLines(repo)).toHaveLength(1);
    expect(git(repo, ['rev-parse', `${LEDGER_REF}:${eventFilePath(event.event)}`])).toBe(
      blobAfterFirst,
    );
    expect(await store.tip()).toBe(tipAfterFirst);
    expect(git(repo, ['rev-list', '--count', LEDGER_REF])).toBe('1');
    expect(await store.list()).toEqual([event]);
  }, GIT_TEST_TIMEOUT);

  it('property: any two batches from a pool converge to the set union, idempotently (spec 02 §1)', async () => {
    // The acceptance clause "idempotent double-append" as a GENERATED property, not one hand-picked
    // case: for arbitrary batches B1, B2 drawn from a pool (dupes allowed), append(B1); append(B2)
    // leaves `events/` equal to the union of names; `written ∪ deduped` equals the batch's ids on
    // every call; exactly one commit lands per append that wrote a fresh event; and re-appending B1
    // writes nothing. Each run gets its own throwaway repo.
    const POOL = 6;
    const pool = Array.from({ length: POOL }, (_, i) => driftEvent(1000 + i));
    const idxBatch = fc.array(fc.integer({ min: 0, max: POOL - 1 }), { minLength: 1, maxLength: 9 });
    let run = 0;

    await fc.assert(
      fc.asyncProperty(idxBatch, idxBatch, async (ia, ib) => {
        const repo = initRepo(`append-prop-${run++}`);
        const store = new GitRefEventStore({ cwd: repo });
        const b1 = ia.map((i) => pool[i] as LedgerEvent);
        const b2 = ib.map((i) => pool[i] as LedgerEvent);
        const idSet = (es: readonly LedgerEvent[]): Set<string> => new Set(es.map((e) => e.event));

        const o1 = await store.append(batch(b1));
        expect(new Set([...o1.written, ...o1.deduped])).toEqual(idSet(b1));

        const o2 = await store.append(batch(b2));
        expect(new Set([...o2.written, ...o2.deduped])).toEqual(idSet(b2));

        // `events/` holds exactly the union of the two batches' names — order-independent.
        const names = new Set(eventTreeLines(repo).map((l) => l.split('\t')[1]));
        const expected = new Set([...b1, ...b2].map((e) => eventFileName(e.event)));
        expect(names).toEqual(expected);

        // One commit per append that wrote at least one fresh event; a deduped-only append is a no-op.
        const writingAppends = (o1.written.length > 0 ? 1 : 0) + (o2.written.length > 0 ? 1 : 0);
        expect(Number(git(repo, ['rev-list', '--count', LEDGER_REF]).trim())).toBe(writingAppends);

        // Idempotency: re-appending B1 writes nothing new and dedupes exactly B1's ids.
        const o3 = await store.append(batch(b1));
        expect(o3.written).toEqual([]);
        expect(new Set(o3.deduped)).toEqual(idSet(b1));
        expect(new Set(eventTreeLines(repo).map((l) => l.split('\t')[1]))).toEqual(expected);
      }),
      { numRuns: 12 },
    );
  }, GIT_TEST_TIMEOUT);

  it('dedupes repeats inside a single batch', async () => {
    const repo = initRepo('append-batch-dupes');
    const store = new GitRefEventStore({ cwd: repo });
    const a = driftEvent(11);
    const b = driftEvent(12);

    const outcome = await store.append(batch([a, b, a, b, a]));
    expect(outcome.written).toEqual([a.event, b.event]);
    expect(outcome.deduped).toEqual([a.event, b.event, a.event]);
    expect(eventTreeLines(repo)).toHaveLength(2);
  }, GIT_TEST_TIMEOUT);

  it('creates exactly one commit per append call, whatever the batch size', async () => {
    const repo = initRepo('append-one-commit');
    const store = new GitRefEventStore({ cwd: repo });

    await store.append(batch([driftEvent(21), driftEvent(22), driftEvent(23)]));
    expect(git(repo, ['rev-list', '--count', LEDGER_REF])).toBe('1');

    await store.append(batch([driftEvent(24), alignedEvent(25)]));
    expect(git(repo, ['rev-list', '--count', LEDGER_REF])).toBe('2');
    expect(eventTreeLines(repo)).toHaveLength(5);
  }, GIT_TEST_TIMEOUT);

  it('appends onto an existing ledger without disturbing what is already there', async () => {
    const repo = initRepo('append-additive');
    const store = new GitRefEventStore({ cwd: repo });
    const first = driftEvent(31);
    await store.append(batch([first]));
    const firstBlob = git(repo, ['rev-parse', `${LEDGER_REF}:${eventFilePath(first.event)}`]);

    await store.append(batch([driftEvent(32)]));
    expect(git(repo, ['rev-parse', `${LEDGER_REF}:${eventFilePath(first.event)}`])).toBe(firstBlob);
    expect(ids(await store.list())).toEqual(ids([first, driftEvent(32)]));
  }, GIT_TEST_TIMEOUT);

  it('rejects a mis-sealed event before writing anything', async () => {
    const repo = initRepo('append-misseal');
    const store = new GitRefEventStore({ cwd: repo });
    const forged = { ...driftEvent(41), precision_at: 0.1 } as LedgerEvent;

    await expect(store.append(batch([forged]))).rejects.toBeInstanceOf(LedgerIntegrityError);
    expect(await store.tip()).toBeNull();
  }, GIT_TEST_TIMEOUT);
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('GitRefEventStore.list (spec 02 §3, Q-11)', () => {
  it('is empty before the first append', async () => {
    const store = new GitRefEventStore({ cwd: initRepo('list-empty') });
    expect(await store.list()).toEqual([]);
    expect(await store.scan()).toEqual({ ref: LEDGER_REF, tip: null, events: [], problems: [] });
  }, GIT_TEST_TIMEOUT);

  it('returns every event in the fold order, verified', async () => {
    const repo = initRepo('list-order');
    const store = new GitRefEventStore({ cwd: repo });
    const events = [driftEvent(5), driftEvent(1), alignedEvent(3), driftEvent(9)];
    await store.append(batch(events));

    const listed = await store.list();
    expect(ids(listed)).toEqual(ids(events));
    // compareForFold: committer time ascending, then event id.
    const times = listed.map((e) => e.t);
    expect(times).toEqual([...times].sort());
    for (const e of listed) expect(unwrap(verifyEventId(e))).toBe(true);
  }, GIT_TEST_TIMEOUT);
});

// ---------------------------------------------------------------------------
// Tamper detection
// ---------------------------------------------------------------------------

/**
 * Rewrites one blob in the ledger tree using raw plumbing. The store has no method that can do
 * this — that absence is INV-002 — so tampering must be staged from outside it.
 */
function rewriteLedgerBlob(repo: string, fileName: string, content: string): void {
  const tip = git(repo, ['rev-parse', LEDGER_REF]);
  const blob = git(repo, ['hash-object', '-w', '--stdin'], content);
  const lines = eventTreeLines(repo).map((line) =>
    line.endsWith(`\t${fileName}`) ? `${BLOB_MODE} blob ${blob}\t${fileName}` : line,
  );
  const eventsTree = git(repo, ['mktree'], `${lines.join('\n')}\n`);
  const root = git(repo, ['mktree'], `040000 tree ${eventsTree}\t${EVENTS_TREE_NAME}\n`);
  const commit = git(repo, ['commit-tree', root, '-p', tip, '-m', 'tamper']);
  git(repo, ['update-ref', LEDGER_REF, commit]);
}

function renameLedgerBlob(repo: string, from: string, to: string): void {
  const tip = git(repo, ['rev-parse', LEDGER_REF]);
  const lines = eventTreeLines(repo).map((line) =>
    line.endsWith(`\t${from}`) ? line.replace(`\t${from}`, `\t${to}`) : line,
  );
  const eventsTree = git(repo, ['mktree'], `${lines.join('\n')}\n`);
  const root = git(repo, ['mktree'], `040000 tree ${eventsTree}\t${EVENTS_TREE_NAME}\n`);
  const commit = git(repo, ['commit-tree', root, '-p', tip, '-m', 'rename']);
  git(repo, ['update-ref', LEDGER_REF, commit]);
}

describe('tamper evidence (spec 02 §1: content-addressed, tamper-evident)', () => {
  it('reports a blob whose content no longer hashes to its name', async () => {
    const repo = initRepo('tamper-content');
    const store = new GitRefEventStore({ cwd: repo });
    const event = driftEvent(51);
    await store.append(batch([event, driftEvent(52)]));

    const name = eventFileName(event.event);
    const original = git(repo, ['cat-file', 'blob', `${LEDGER_REF}:${EVENTS_TREE_NAME}/${name}`]);
    // Still perfectly valid YAML, still a schema-legal event — only the severity moved. That is
    // exactly the edit a plausible attacker makes, and the only thing that catches it is the
    // hash.
    const doctored = original.replace('severity: 0.75', 'severity: 0.25');
    expect(doctored).not.toBe(original);
    rewriteLedgerBlob(repo, name, doctored);

    const scan = await store.scan();
    expect(scan.problems).toHaveLength(1);
    expect(scan.problems[0]?.code).toBe('hash-mismatch');
    expect(scan.problems[0]?.path).toBe(`${EVENTS_TREE_NAME}/${name}`);
    // The untampered sibling still reads; the store does not lose the good events, it refuses
    // to hand back a set it cannot vouch for.
    expect(scan.events).toHaveLength(1);

    await expect(store.list()).rejects.toBeInstanceOf(LedgerIntegrityError);
    await expect(store.list()).rejects.toThrow(/hash-mismatch/);
  }, GIT_TEST_TIMEOUT);

  it('reports a well-formed event filed under the wrong name', async () => {
    const repo = initRepo('tamper-name');
    const store = new GitRefEventStore({ cwd: repo });
    const event = driftEvent(61);
    await store.append(batch([event]));

    renameLedgerBlob(repo, eventFileName(event.event), `${'f'.repeat(64)}.yaml`);

    const scan = await store.scan();
    expect(scan.problems.map((p) => p.code)).toEqual(['name-mismatch']);
    expect(scan.events).toEqual([]);
    await expect(store.list()).rejects.toThrow(/name-mismatch/);
  }, GIT_TEST_TIMEOUT);

  it('reports a blob that is not a readable event at all', async () => {
    const repo = initRepo('tamper-garbage');
    const store = new GitRefEventStore({ cwd: repo });
    const event = driftEvent(71);
    await store.append(batch([event]));

    rewriteLedgerBlob(repo, eventFileName(event.event), 'this: [is not: an event\n');
    const scan = await store.scan();
    expect(scan.problems.map((p) => p.code)).toEqual(['malformed']);
    await expect(store.list()).rejects.toBeInstanceOf(LedgerIntegrityError);
  }, GIT_TEST_TIMEOUT);

  it('never repairs or rewrites a tampered blob on a later append (INV-002)', async () => {
    const repo = initRepo('tamper-rewrite');
    const store = new GitRefEventStore({ cwd: repo });
    const event = driftEvent(81);
    await store.append(batch([event]));

    const name = eventFileName(event.event);
    const original = git(repo, ['cat-file', 'blob', `${LEDGER_REF}:${EVENTS_TREE_NAME}/${name}`]);
    rewriteLedgerBlob(repo, name, original.replace('severity: 0.75', 'severity: 0.5'));
    const tamperedBlob = git(repo, ['rev-parse', `${LEDGER_REF}:${EVENTS_TREE_NAME}/${name}`]);

    // Re-appending the SAME event is NOT a dedupe now that its slot is tampered: the slot holds a
    // blob that does not hash to this event, so reporting `deduped` would certify a lie. append
    // REFUSES, loudly — the same all-or-nothing contract list() holds — rather than rewrite the
    // slot (which would breach INV-002) or pretend the observation is already recorded.
    await expect(store.append(batch([event]))).rejects.toBeInstanceOf(LedgerIntegrityError);

    // A DIFFERENT event lands in a clean slot and still appends: append verifies only the slots it
    // writes, it does not audit the whole ledger, so one tampered blob does not brick every write.
    await store.append(batch([driftEvent(82)]));

    // INV-002: neither call rewrote the tampered blob — it survives byte-for-byte, to be reported.
    expect(git(repo, ['rev-parse', `${LEDGER_REF}:${EVENTS_TREE_NAME}/${name}`])).toBe(
      tamperedBlob,
    );
    const scan = await store.scan();
    expect(scan.problems.map((p) => p.code)).toEqual(['hash-mismatch']);
    expect(scan.events.map((e) => e.event)).toEqual([driftEvent(82).event]);
  }, GIT_TEST_TIMEOUT);
});

// ---------------------------------------------------------------------------
// INV-002, as the absence of a method
// ---------------------------------------------------------------------------

describe('INV-002: append-only by construction', () => {
  it('exposes no method through which an event could be updated or deleted', () => {
    const surface = Object.getOwnPropertyNames(GitRefEventStore.prototype).filter(
      (n) => n !== 'constructor',
    );
    expect(surface.sort()).toEqual(
      ['append', 'fetchAndMerge', 'list', 'pushWithRetry', 'scan', 'tip'].sort(),
    );
    for (const name of surface) {
      expect(name).not.toMatch(/update|delete|remove|rewrite|overwrite|mutate|drop|truncate|set/i);
    }
  });
});
