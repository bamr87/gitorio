// Implements tests for: docs/spec/02-ledger.md §1.1 ("Conflict-free concurrency. Concurrent CI
// runs pushing simultaneously merge as set union — content-addressed events cannot conflict.
// Push with fetch → fast-forward → retry") and docs/adr/0002-event-sourced-ledger.md
// ("conflict-free merges (set union), idempotent writes").
//
// SEED-02 acceptance covered here: set-union merge of two DIVERGENT ledger refs, and simulated
// concurrent writers converging to one event set.
//
// The suite is in two halves on purpose. The first is PURE: `unionTreeEntries` is the whole
// merge, it is arithmetic on tree entries, and its commutativity is the property the "concurrent
// CI runs cannot conflict" claim actually rests on — so it is proved with generated inputs and
// no repository at all. The second half is integration, against THROWAWAY repositories under the
// OS temp directory; nothing here touches the repository this suite is checked into.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';

import {
  decodeVerdict,
  eventBodyFromVerdict,
  eventFileName,
  hashBlob,
  isNonEmpty,
  parseCommitSha,
  parseCommitterTime,
  parseJudgeId,
  parsePrecision,
  parseRationaleRef,
  sealEvent,
  unwrap,
  type EventSubject,
  type JudgeRef,
  type LedgerEvent,
  type NonEmptyReadonlyArray,
  type ViolationVerdict,
} from '../../src/core/index.js';
import {
  BLOB_MODE,
  unionTreeEntries,
  type GitObjectId,
  type TreeEntry,
} from '../../src/ledger/git.js';
import {
  EVENTS_TREE_NAME,
  GitRefEventStore,
  LEDGER_REF,
  LedgerConcurrencyError,
  LedgerIntegrityError,
} from '../../src/ledger/store.js';

// ---------------------------------------------------------------------------
// The pure half: set union of two tree levels
// ---------------------------------------------------------------------------

/**
 * Models the real invariant: an event's NAME is the hash of its body and its bytes are a pure
 * function of that body, so the name determines the blob id. Two ledgers that both contain an
 * event necessarily agree on it, which is precisely why union needs no conflict resolution.
 */
function contentAddressed(name: string): TreeEntry {
  return { mode: BLOB_MODE, type: 'blob', id: name.slice(0, 40) as GitObjectId, name };
}

const nameArb = fc
  .integer({ min: 0, max: 24 })
  .map((n) => `${n.toString(16).padStart(64, '0')}.yaml`);

const entriesArb = fc
  .uniqueArray(nameArb, { maxLength: 12 })
  .map((names) => names.map(contentAddressed));

describe('unionTreeEntries (spec 02 §1.1, pure — no repository, no network)', () => {
  it('is commutative over content-addressed entries', () => {
    fc.assert(
      fc.property(entriesArb, entriesArb, (ours, theirs) => {
        const ab = unionTreeEntries(ours, theirs);
        const ba = unionTreeEntries(theirs, ours);
        expect(ab.collisions).toEqual([]);
        expect(ba.collisions).toEqual([]);
        expect(ab.entries).toEqual(ba.entries);
      }),
    );
  });

  it('is idempotent and loses nothing from either side', () => {
    fc.assert(
      fc.property(entriesArb, entriesArb, (ours, theirs) => {
        const union = unionTreeEntries(ours, theirs);
        const names = new Set(union.entries.map((e) => e.name));
        for (const e of [...ours, ...theirs]) expect(names.has(e.name)).toBe(true);
        expect(names.size).toBe(new Set([...ours, ...theirs].map((e) => e.name)).size);
        expect(unionTreeEntries(union.entries, union.entries).entries).toEqual(union.entries);
      }),
    );
  });

  it('is associative, so a three-way convergence has no preferred order', () => {
    fc.assert(
      fc.property(entriesArb, entriesArb, entriesArb, (a, b, c) => {
        const left = unionTreeEntries(unionTreeEntries(a, b).entries, c).entries;
        const right = unionTreeEntries(a, unionTreeEntries(b, c).entries).entries;
        expect(left).toEqual(right);
      }),
    );
  });

  it('reports a same-name-different-blob pair instead of silently picking one', () => {
    const name = `${'a'.repeat(64)}.yaml`;
    const ours = contentAddressed(name);
    const theirs: TreeEntry = { ...ours, id: 'b'.repeat(40) as GitObjectId };
    const union = unionTreeEntries([ours], [theirs]);
    expect(union.collisions).toEqual([{ name, ours: ours.id, theirs: theirs.id }]);
    expect(union.entries).toEqual([ours]);
  });
});

// ---------------------------------------------------------------------------
// Throwaway repositories
// ---------------------------------------------------------------------------

/**
 * Every test below this point spawns real `git` processes, several per assertion. Vitest's
 * default 5s budget measures how busy the machine is rather than whether convergence happened,
 * so the integration half carries an explicit generous one. The pure half above keeps the
 * default, because a property that needs a subprocess is not a pure property.
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

function bareOrigin(name: string): string {
  const dir = workspace(name);
  git(dir, ['init', '-q', '--bare', '.']);
  return dir;
}

/**
 * A working repository wired to `origin`. Note what is NOT here: any fetch configuration for
 * `refs/program/*`. Non-default refs do not travel by default (spec 02 §8), which is exactly the
 * situation push-with-retry has to work in.
 */
function clone(name: string, origin: string): string {
  const dir = workspace(name);
  git(dir, ['init', '-q', '-b', 'main', '.']);
  git(dir, ['config', 'user.email', 'fixture@localhost']);
  git(dir, ['config', 'user.name', 'fixture']);
  git(dir, ['remote', 'add', 'origin', origin]);
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

function batch(events: readonly LedgerEvent[]): NonEmptyReadonlyArray<LedgerEvent> {
  if (!isNonEmpty(events)) throw new Error('empty batch');
  return events;
}

const idsOf = (events: readonly LedgerEvent[]): readonly string[] =>
  [...events.map((e) => e.event)].sort();

/** The event set actually on the remote, read straight off the bare repository. */
function remoteEventNames(origin: string): readonly string[] {
  const out = git(origin, ['ls-tree', '--name-only', `${LEDGER_REF}:${EVENTS_TREE_NAME}`]);
  return out === '' ? [] : out.split('\n').sort();
}

const expectedNames = (events: readonly LedgerEvent[]): readonly string[] =>
  [...events.map((e) => eventFileName(e.event))].sort();

// ---------------------------------------------------------------------------
// Divergent refs converge to the union
// ---------------------------------------------------------------------------

/**
 * Two clones append DIFFERENT events with no common ledger ancestor, then converge. `first` says
 * which one reaches the remote first; everything else is identical, so running it both ways is
 * the order-independence experiment.
 */
async function convergeTwo(
  label: string,
  first: 'a' | 'b',
): Promise<{ readonly a: readonly string[]; readonly b: readonly string[]; readonly origin: readonly string[] }> {
  const origin = bareOrigin(`${label}-origin`);
  const storeA = new GitRefEventStore({ cwd: clone(`${label}-a`, origin) });
  const storeB = new GitRefEventStore({ cwd: clone(`${label}-b`, origin) });

  await storeA.append(batch([driftEvent(1), driftEvent(2)]));
  await storeB.append(batch([driftEvent(3)]));

  const [lead, trail] = first === 'a' ? [storeA, storeB] : [storeB, storeA];
  expect((await lead.pushWithRetry('origin')).pushed).toBe(true);
  expect((await trail.pushWithRetry('origin')).pushed).toBe(true);
  // The leader now pulls the union back down; convergence is symmetric.
  await lead.fetchAndMerge('origin');

  return {
    a: idsOf(await storeA.list()),
    b: idsOf(await storeB.list()),
    origin: remoteEventNames(origin),
  };
}

describe('set-union merge of two divergent ledger refs (spec 02 §1.1)', () => {
  it(
    'converges to the union, whichever ref reaches the remote first',
    async () => {
      const all = [driftEvent(1), driftEvent(2), driftEvent(3)];

      const aFirst = await convergeTwo('div-a', 'a');
      const bFirst = await convergeTwo('div-b', 'b');

      for (const run of [aFirst, bFirst]) {
        expect(run.a).toEqual(idsOf(all));
        expect(run.b).toEqual(idsOf(all));
        expect(run.origin).toEqual(expectedNames(all));
      }
      // Order independence, stated as the equality it is.
      expect(aFirst).toEqual(bFirst);
    },
    GIT_TEST_TIMEOUT,
  );

  it(
    'merges rather than fast-forwards when both sides have unique events',
    async () => {
      const origin = bareOrigin('merge-shape-origin');
      const a = clone('merge-shape-a', origin);
      const b = clone('merge-shape-b', origin);
      const storeA = new GitRefEventStore({ cwd: a });
      const storeB = new GitRefEventStore({ cwd: b });

      await storeA.append(batch([driftEvent(11)]));
      await storeA.pushWithRetry('origin');
      await storeB.append(batch([driftEvent(12)]));

      const outcome = await storeB.fetchAndMerge('origin');
      expect(outcome.kind).toBe('merged');
      // A real two-parent merge commit, so the subsequent push is a fast-forward for the remote
      // and nothing has to be forced.
      const tip = git(b, ['rev-parse', LEDGER_REF]);
      expect(git(b, ['rev-list', '--parents', '-n', '1', tip]).split(' ')).toHaveLength(3);
      expect((await storeB.pushWithRetry('origin')).pushed).toBe(true);
      expect(remoteEventNames(origin)).toEqual(expectedNames([driftEvent(11), driftEvent(12)]));
    },
    GIT_TEST_TIMEOUT,
  );

  it(
    'treats an identical event on both sides as one event, not a conflict',
    async () => {
      const origin = bareOrigin('same-event-origin');
      const storeA = new GitRefEventStore({ cwd: clone('same-event-a', origin) });
      const storeB = new GitRefEventStore({ cwd: clone('same-event-b', origin) });

      // Two CI runs judging the same commit against the same assertion mint the same event.
      await storeA.append(batch([driftEvent(21), driftEvent(22)]));
      await storeB.append(batch([driftEvent(21), driftEvent(23)]));
      await storeA.pushWithRetry('origin');
      await storeB.pushWithRetry('origin');

      expect(remoteEventNames(origin)).toEqual(
        expectedNames([driftEvent(21), driftEvent(22), driftEvent(23)]),
      );
      expect(idsOf(await storeB.list())).toEqual(
        idsOf([driftEvent(21), driftEvent(22), driftEvent(23)]),
      );
    },
    GIT_TEST_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// Concurrent writers on one ref
// ---------------------------------------------------------------------------

describe('simulated concurrent writers (spec 02 §1.1, ADR-0002)', () => {
  it(
    'converges to one event set with nothing lost',
    async () => {
      const repo = clone('racers', bareOrigin('racers-origin'));
      const writers = 6;
      // Independent store instances, exactly as independent CI jobs would be: no shared state,
      // no lock of our own, only the ref's compare-and-swap.
      const stores = Array.from({ length: writers }, () => new GitRefEventStore({ cwd: repo }));
      const events = Array.from({ length: writers }, (_, i) => driftEvent(100 + i));

      await Promise.all(stores.map((s, i) => s.append(batch([events[i] as LedgerEvent]))));

      const listed = await stores[0]!.list();
      expect(idsOf(listed)).toEqual(idsOf(events));
      // Every winner wrote its own commit; nobody's blob was dropped by a lost race.
      const commits = Number.parseInt(git(repo, ['rev-list', '--count', LEDGER_REF]), 10);
      expect(commits).toBeGreaterThanOrEqual(1);
      expect(commits).toBeLessThanOrEqual(writers);
    },
    GIT_TEST_TIMEOUT,
  );

  it(
    'stays idempotent under a race: the same event appended by everyone lands once',
    async () => {
      const repo = clone('racers-same', bareOrigin('racers-same-origin'));
      const stores = Array.from({ length: 6 }, () => new GitRefEventStore({ cwd: repo }));
      const event = driftEvent(200);

      const outcomes = await Promise.all(stores.map((s) => s.append(batch([event]))));

      expect(idsOf(await stores[0]!.list())).toEqual([event.event]);
      const totalWritten = outcomes.reduce((n, o) => n + o.written.length, 0);
      // At most one writer can have observed the ref without the blob; the rest dedupe.
      expect(totalWritten).toBeGreaterThanOrEqual(1);
      expect(totalWritten).toBeLessThanOrEqual(stores.length);
      expect(git(repo, ['ls-tree', `${LEDGER_REF}:${EVENTS_TREE_NAME}`]).split('\n')).toHaveLength(
        1,
      );
    },
    GIT_TEST_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// Push-with-retry
// ---------------------------------------------------------------------------

describe('push-with-retry (spec 02 §1.1: fetch -> merge -> fast-forward -> retry)', () => {
  it(
    'absorbs a writer that wins the race mid-push and retries',
    async () => {
      const origin = bareOrigin('retry-origin');
      const storeA = new GitRefEventStore({ cwd: clone('retry-a', origin) });
      const storeB = new GitRefEventStore({ cwd: clone('retry-b', origin) });
      const storeC = new GitRefEventStore({ cwd: clone('retry-c', origin) });

      await storeA.append(batch([driftEvent(31)]));
      await storeA.pushWithRetry('origin');

      await storeB.append(batch([driftEvent(32)]));
      await storeC.append(batch([driftEvent(33)]));

      const result = await storeB.pushWithRetry('origin', {
        beforePush: async (attempt) => {
          // C lands between B's merge and B's push, which is the only instant at which a real
          // race is observable. B's first push must be rejected, not forced through.
          if (attempt === 1) await storeC.pushWithRetry('origin');
        },
      });

      expect(result.pushed).toBe(true);
      expect(result.attempts).toBe(2);
      expect(remoteEventNames(origin)).toEqual(
        expectedNames([driftEvent(31), driftEvent(32), driftEvent(33)]),
      );
    },
    GIT_TEST_TIMEOUT,
  );

  it(
    'fails loudly and bounded when the remote will not stop moving, losing nothing',
    async () => {
      const origin = bareOrigin('bounded-origin');
      const storeB = new GitRefEventStore({ cwd: clone('bounded-b', origin) });
      const storeC = new GitRefEventStore({ cwd: clone('bounded-c', origin) });

      await storeB.append(batch([driftEvent(41)]));
      const injected: LedgerEvent[] = [];

      await expect(
        storeB.pushWithRetry('origin', {
          maxAttempts: 2,
          beforePush: async (attempt) => {
            const event = driftEvent(50 + attempt);
            injected.push(event);
            await storeC.append(batch([event]));
            await storeC.pushWithRetry('origin');
          },
        }),
      ).rejects.toBeInstanceOf(LedgerConcurrencyError);

      // A failed push is not a lost event: B still holds everything it merged, the remote still
      // holds everything C landed, and a later push reconciles the two.
      expect(injected).toHaveLength(2);
      expect(remoteEventNames(origin)).toEqual(expectedNames(injected));
      expect((await storeB.pushWithRetry('origin')).pushed).toBe(true);
      expect(remoteEventNames(origin)).toEqual(expectedNames([driftEvent(41), ...injected]));
    },
    GIT_TEST_TIMEOUT,
  );

  it(
    'pushes a ledger to a remote that has none yet',
    async () => {
      const origin = bareOrigin('firstpush-origin');
      const store = new GitRefEventStore({ cwd: clone('firstpush-a', origin) });
      await store.append(batch([driftEvent(61)]));

      const result = await store.pushWithRetry('origin');
      expect(result.pushed).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.merges).toEqual([{ kind: 'remote-absent' }]);
      expect(remoteEventNames(origin)).toEqual(expectedNames([driftEvent(61)]));
    },
    GIT_TEST_TIMEOUT,
  );

  it(
    'reports nothing to push when the ledger is empty',
    async () => {
      const origin = bareOrigin('nopush-origin');
      const store = new GitRefEventStore({ cwd: clone('nopush-a', origin) });
      const result = await store.pushWithRetry('origin');
      expect(result).toEqual({ pushed: false, attempts: 1, tip: null, merges: [{ kind: 'remote-absent' }] });
    },
    GIT_TEST_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// The merge is where INV-002 can actually be broken
// ---------------------------------------------------------------------------

describe('INV-002 across a merge', () => {
  it(
    'refuses to merge two ledgers that disagree about one event name',
    async () => {
      const origin = bareOrigin('tamper-merge-origin');
      const a = clone('tamper-merge-a', origin);
      const b = clone('tamper-merge-b', origin);
      const storeA = new GitRefEventStore({ cwd: a });
      const storeB = new GitRefEventStore({ cwd: b });

      const shared = driftEvent(71);
      await storeA.append(batch([shared, driftEvent(72)]));
      await storeB.append(batch([shared, driftEvent(73)]));

      // B's copy of the shared event is edited in place with raw plumbing — something the store
      // itself has no method to do. Now the same name addresses two different blobs.
      const name = eventFileName(shared.event);
      const tip = git(b, ['rev-parse', LEDGER_REF]);
      const original = git(b, ['cat-file', 'blob', `${tip}:${EVENTS_TREE_NAME}/${name}`]);
      const blob = git(
        b,
        ['hash-object', '-w', '--stdin'],
        original.replace('severity: 0.75', 'severity: 0.5'),
      );
      const lines = git(b, ['ls-tree', `${tip}:${EVENTS_TREE_NAME}`])
        .split('\n')
        .map((line) => (line.endsWith(`\t${name}`) ? `${BLOB_MODE} blob ${blob}\t${name}` : line));
      const eventsTree = git(b, ['mktree'], `${lines.join('\n')}\n`);
      const root = git(b, ['mktree'], `040000 tree ${eventsTree}\t${EVENTS_TREE_NAME}\n`);
      git(b, ['update-ref', LEDGER_REF, git(b, ['commit-tree', root, '-p', tip, '-m', 'tamper'])]);

      await storeA.pushWithRetry('origin');
      // Union of a tampered ledger and an honest one is not a merge decision to make: it is
      // evidence that one of them lied about a content address.
      await expect(storeB.pushWithRetry('origin')).rejects.toBeInstanceOf(LedgerIntegrityError);
      // And the honest remote is untouched by the attempt.
      expect(remoteEventNames(origin)).toEqual(expectedNames([shared, driftEvent(72)]));
    },
    GIT_TEST_TIMEOUT,
  );
});
