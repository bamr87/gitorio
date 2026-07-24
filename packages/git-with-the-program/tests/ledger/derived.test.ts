// Implements tests for: the three things SEED-02 deliverable 4 added to src/ledger so the CLI
// could be a thin shell over it —
//
//   `foldEventsPerKey`   (src/ledger/fold.ts)  — one set of knobs PER KEY, because `budget` and
//                                                `half_life` are fields of an ASSERTION and every
//                                                assertion has its own (spec 02 §4, Q-56).
//   `emitCanonicalYaml`  (src/ledger/store.ts) — the ONE YAML emitter in the ledger, now used by
//                                                `events/` and `accumulators/` alike (Q-48).
//   `writeDerivedFiles`  (src/ledger/store.ts) — the derived levels of the tree, and the path
//                                                guard that keeps `events/` out of reach (INV-002).
//
// Every git-writing test runs against a throwaway repository under `os.tmpdir()`.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  MILLIS_PER_DAY,
  REARM_FRACTION_DEFAULT,
  committerTimeFromEpochMillis,
  decodeVerdict,
  eventBodyFromVerdict,
  parseAccumulatorKey,
  parseBudget,
  parseCommitSha,
  parseDuration,
  parseJudgeId,
  parsePrecision,
  parseRationaleRef,
  sealEvent,
  unwrap,
  type AccumulatorKey,
  type CanonicalObject,
  type EventSubject,
  type FoldKnobs,
  type JudgeRef,
  type LedgerEvent,
  type MintViolationInput,
  type NonEmptyReadonlyArray,
  type ViolationVerdict,
} from '../../src/core/index.js';
import { hashBlob } from '../../src/core/canonical.js';
import { toAccumulatorSnapshot } from '../../src/core/accumulator.js';
import { revealSurprise, withSentencingWarrant } from '../../src/core/sentencing.js';
import { foldEvents, foldEventsPerKey, keyedFiringsFor } from '../../src/ledger/fold.js';
import { createGitExec } from '../../src/ledger/git.js';
import { gitExecRunner, gitSightedCommitPort } from '../../src/ledger/sighted.js';
import {
  GitRefEventStore,
  LEDGER_REF,
  emitCanonicalYaml,
  serializeEvent,
  writeDerivedFiles,
} from '../../src/ledger/store.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WARRANT = withSentencingWarrant((w) => w);
const HALF_LIFE_90D = unwrap(parseDuration('90d'));
const JUDGE: JudgeRef = { kind: 'deterministic', id: unwrap(parseJudgeId('derived-fixture')) };
const RATIONALE = unwrap(parseRationaleRef(hashBlob('the full rationale text')));
const EPOCH = Date.parse('2026-01-01T00:00:00Z');

const key = (s: string): AccumulatorKey => unwrap(parseAccumulatorKey(s));
const atDay = (day: number) => unwrap(committerTimeFromEpochMillis(EPOCH + day * MILLIS_PER_DAY));

function knobs(budget: number, overrides: Partial<FoldKnobs> = {}): FoldKnobs {
  return {
    halfLife: HALF_LIFE_90D,
    budget: unwrap(parseBudget(budget)),
    precisionOverride: null,
    rearmFraction: REARM_FRACTION_DEFAULT,
    ...overrides,
  };
}

/** A `drift` at `precision_at 0.8 · severity 0.75 = 0.6`, unique in `n`. */
function event(assertion: string, day: number, n: number): LedgerEvent {
  const verdict = unwrap(
    decodeVerdict({
      assertion,
      verdict: 'drift',
      severity: 'breach',
      evidence: ['src/core/http.ts:41-58'],
      rationale: 'imports a forge SDK inside core/',
    }),
  ) as ViolationVerdict;
  const input: MintViolationInput = {
    verdict,
    subject: { commit: unwrap(parseCommitSha((0x100000 + n).toString(16))) } as EventSubject,
    judge: JUDGE,
    t: atDay(day),
    precision_at: unwrap(parsePrecision(0.8)),
    rationale: RATIONALE,
  };
  return unwrap(sealEvent(eventBodyFromVerdict(input)));
}

const A = key('INV-007');
const B = key('INV-008');
const CLAIM = key('docs/**');

/** Two keys, three violations: A at day 0 and day 90, B at day 0. */
const EVENTS: readonly LedgerEvent[] = [
  event('INV-007', 0, 1),
  event('INV-007', 90, 2),
  event('INV-008', 0, 3),
];

const meter = (v: { readonly value: unknown }): number =>
  revealSurprise(v.value as never, WARRANT);

// ---------------------------------------------------------------------------
// foldEventsPerKey
// ---------------------------------------------------------------------------

describe('foldEventsPerKey — one set of knobs per key (spec 02 §4)', () => {
  it('agrees with `foldEvents` exactly when the resolver is constant', () => {
    const k = knobs(2);
    const one = unwrap(foldEvents(EVENTS, k));
    const many = unwrap(foldEventsPerKey(EVENTS, () => k));

    expect(many.keys).toEqual(one.keys);
    expect(many.eventCount).toBe(one.eventCount);
    expect(many.tips.map((e) => e.event)).toEqual(one.tips.map((e) => e.event));
    for (const key of one.keys) {
      expect(
        toAccumulatorSnapshot(many.states.get(key) as never, WARRANT),
      ).toEqual(toAccumulatorSnapshot(one.states.get(key) as never, WARRANT));
    }
    expect(many.firings.map((f) => [f.key, f.at])).toEqual(one.firings.map((f) => [f.key, f.at]));
  });

  it('measures each key against ITS OWN budget, not against somebody else\'s', () => {
    // A reaches 0.6·2^(-1) + 0.6 = 0.9; B reaches 0.6. Under A's budget of 2.0 and B's of 0.5,
    // exactly one of them fires — and it is the one with the SMALLER meter.
    const result = unwrap(
      foldEventsPerKey(EVENTS, (k) => (k === A ? knobs(2) : knobs(0.5))),
    );
    expect(meter(result.states.get(A) as never)).toBeCloseTo(0.9, 12);
    expect(meter(result.states.get(B) as never)).toBeCloseTo(0.6, 12);
    expect(keyedFiringsFor(result, A)).toEqual([]);
    expect(keyedFiringsFor(result, B)).toHaveLength(1);

    // Swap the budgets and the firing swaps with them: the knobs really are per key.
    const swapped = unwrap(
      foldEventsPerKey(EVENTS, (k) => (k === A ? knobs(0.5) : knobs(2))),
    );
    expect(keyedFiringsFor(swapped, A)).toHaveLength(1);
    expect(keyedFiringsFor(swapped, B)).toEqual([]);
  });

  it('records the knobs and their digest per key, so a cache cannot be believed across a retune', () => {
    const result = unwrap(foldEventsPerKey(EVENTS, (k) => (k === A ? knobs(2) : knobs(0.5))));
    expect(result.knobs.get(A)?.budget).toBe(2);
    expect(result.knobs.get(B)?.budget).toBe(0.5);
    expect(result.knobsDigest.get(A)).not.toBe(result.knobsDigest.get(B));
    expect(result.knobsDigest.get(A)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('reports a key with no knobs instead of folding or dropping it (Q-56)', () => {
    const events = [...EVENTS, event('docs/**', 30, 4)];
    const result = unwrap(foldEventsPerKey(events, (k) => (k === CLAIM ? null : knobs(2))));

    expect(result.unfolded).toEqual([CLAIM]);
    expect(result.keys).toEqual([A, B]);
    expect(result.states.has(CLAIM)).toBe(false);
    // Not dropped: the event is still in the set, still a tip, still counted.
    expect(result.eventCount).toBe(4);
    expect(result.tips.map((e) => e.assertion)).toContain(CLAIM);
  });

  it('is order-independent: the ledger is a SET, and the array order is an accident', () => {
    const resolver = (k: AccumulatorKey): FoldKnobs => (k === A ? knobs(2) : knobs(0.5));
    const fingerprint = (events: readonly LedgerEvent[]): string =>
      JSON.stringify(
        unwrap(foldEventsPerKey(events, resolver)).keys.map((k) => [
          k,
          toAccumulatorSnapshot(unwrap(foldEventsPerKey(events, resolver)).states.get(k) as never, WARRANT),
        ]),
      );
    const base = fingerprint(EVENTS);
    for (const permutation of [
      [EVENTS[2], EVENTS[0], EVENTS[1]],
      [EVENTS[1], EVENTS[2], EVENTS[0]],
      [...EVENTS].reverse(),
    ] as LedgerEvent[][]) {
      expect(fingerprint(permutation)).toBe(base);
    }
  });

  it('fails loudly on a knob the fold cannot use, rather than silently disarming a key', () => {
    const bad = foldEventsPerKey(EVENTS, () => knobs(2, { rearmFraction: 2 }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.at).toBe('/rearmFraction');
  });

  it('answers for an empty event set without inventing an accumulator', () => {
    const empty = unwrap(foldEventsPerKey([], () => knobs(2)));
    expect(empty.keys).toEqual([]);
    expect(empty.unfolded).toEqual([]);
    expect(empty.firings).toEqual([]);
    expect(empty.eventCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// emitCanonicalYaml
// ---------------------------------------------------------------------------

describe('emitCanonicalYaml — the ledger has ONE YAML emitter (Q-48)', () => {
  it('emits keys in ascending code-unit order, the order `canonicalize` hashes in', () => {
    const text = unwrap(emitCanonicalYaml({ b: 2, a: 1, C: 3 }));
    expect(text.split('\n').slice(0, 3)).toEqual(['C: 3', 'a: 1', 'b: 2']);
  });

  it('hoists `firstKeys` and emits each of them exactly once', () => {
    const text = unwrap(emitCanonicalYaml({ b: 2, a: 1, event: 'x' }, ['event']));
    expect(text).toBe('event: "x"\na: 1\nb: 2\n');
    expect(text.match(/^event:/gm)).toHaveLength(1);
  });

  it('drops `undefined`, keeps `null`, and ignores an absent `firstKey`', () => {
    const text = unwrap(emitCanonicalYaml({ a: null, b: undefined, c: 1 }, ['nope']));
    expect(text).toBe('a: null\nc: 1\n');
  });

  it('round-trips through a YAML parser, nesting and all', () => {
    const doc: CanonicalObject = {
      key: 'INV-007',
      nested: { z: 'last', a: [1, 2, 3], empty: [] },
      flag: false,
      zero: -0,
    };
    const text = unwrap(emitCanonicalYaml(doc));
    expect(parseYaml(text)).toEqual({
      key: 'INV-007',
      nested: { z: 'last', a: [1, 2, 3], empty: [] },
      flag: false,
      zero: 0,
    });
  });

  it('refuses a non-finite number rather than emitting a token YAML cannot round-trip', () => {
    const r = emitCanonicalYaml({ value: Number.POSITIVE_INFINITY });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('non-canonical-value');
  });

  it('still produces exactly the event bytes `serializeEvent` produced before it existed', () => {
    // The refactor that extracted this emitter must not have moved a single byte of `events/`:
    // the filename is the hash of the body, so a changed emitter changes nothing about identity
    // but everything about whether two writers agree on a blob (Q-48).
    const text = unwrap(serializeEvent(EVENTS[0] as LedgerEvent));
    expect(text.split('\n')[0]).toBe(`event: "${(EVENTS[0] as LedgerEvent).event}"`);
    const parsed = parseYaml(text) as Record<string, unknown>;
    expect(parsed['event']).toBe((EVENTS[0] as LedgerEvent).event);
    expect(parsed['assertion']).toBe('INV-007');
    expect(parsed['severity']).toBe(0.75);
    expect(parsed['supersedes']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// writeDerivedFiles
// ---------------------------------------------------------------------------

const temps: string[] = [];

function repoWithEvents(): string {
  const repo = mkdtempSync(join(tmpdir(), 'gwtp-derived-'));
  temps.push(repo);
  execFileSync('git', ['init', '--quiet', '.'], { cwd: repo });
  return repo;
}

function git(repo: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd: repo, encoding: 'utf8' }).trim();
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe('writeDerivedFiles — the derived levels, and nothing else (INV-002)', () => {
  it('refuses `events/` outright: append-only is a path guard, not a convention', async () => {
    const repo = repoWithEvents();
    await expect(
      writeDerivedFiles({ cwd: repo }, [{ path: 'events/deadbeef.yaml', content: 'x: 1\n' }]),
    ).rejects.toThrow(/append-only \(INV-002\)/);
    expect(git(repo, ['for-each-ref', 'refs/program'])).toBe('');
  });

  it('refuses a path that is not `<dir>/<name>` inside the tree', async () => {
    const repo = repoWithEvents();
    for (const path of ['accumulators/../events/x.yaml', 'loose.yaml', 'a/b/c.yaml', '../x.yaml']) {
      await expect(writeDerivedFiles({ cwd: repo }, [{ path, content: 'x: 1\n' }])).rejects.toThrow(
        /derived file lives at/,
      );
    }
  });

  it('refuses a batch that disagrees with itself about one path', async () => {
    const repo = repoWithEvents();
    await expect(
      writeDerivedFiles({ cwd: repo }, [
        { path: 'accumulators/INV-007.yaml', content: 'value: 1\n' },
        { path: 'accumulators/INV-007.yaml', content: 'value: 2\n' },
      ]),
    ).rejects.toThrow(/share a path but differ/);
  });

  it('creates the ref when it does not exist yet, and reports what it wrote', async () => {
    const repo = repoWithEvents();
    const first = await writeDerivedFiles({ cwd: repo }, [
      { path: 'accumulators/INV-007.yaml', content: 'value: 1\n' },
      { path: 'epochs/e0.snapshot.yaml', content: 'epoch: e0\n' },
    ]);
    expect([...first.written].sort()).toEqual(['accumulators/INV-007.yaml', 'epochs/e0.snapshot.yaml']);
    expect(first.commit).not.toBeNull();
    expect(git(repo, ['cat-file', 'blob', `${LEDGER_REF}:accumulators/INV-007.yaml`])).toBe('value: 1');
    expect(git(repo, ['cat-file', 'blob', `${LEDGER_REF}:epochs/e0.snapshot.yaml`])).toBe('epoch: e0');
  });

  it('makes no commit at all when every file is already byte-identical', async () => {
    const repo = repoWithEvents();
    const files = [{ path: 'accumulators/INV-007.yaml', content: 'value: 1\n' }];
    await writeDerivedFiles({ cwd: repo }, files);
    const tip = git(repo, ['rev-parse', LEDGER_REF]);

    const again = await writeDerivedFiles({ cwd: repo }, files);
    expect(again.commit).toBeNull();
    expect(again.written).toEqual([]);
    expect(again.unchanged).toEqual(['accumulators/INV-007.yaml']);
    expect(git(repo, ['rev-parse', LEDGER_REF])).toBe(tip);
  });

  it('REPLACES a derived file — that is the difference between derived and authoritative', async () => {
    const repo = repoWithEvents();
    await writeDerivedFiles({ cwd: repo }, [{ path: 'accumulators/INV-007.yaml', content: 'value: 1\n' }]);
    const second = await writeDerivedFiles({ cwd: repo }, [
      { path: 'accumulators/INV-007.yaml', content: 'value: 2\n' },
    ]);
    expect(second.written).toEqual(['accumulators/INV-007.yaml']);
    expect(git(repo, ['cat-file', 'blob', `${LEDGER_REF}:accumulators/INV-007.yaml`])).toBe('value: 2');
    // Two commits, and the first is still reachable: the cache was rewritten, its history was not.
    expect(git(repo, ['rev-list', '--count', LEDGER_REF])).toBe('2');
  });

  it('leaves `events/` byte-identical while rewriting the cache beside it', async () => {
    const repo = repoWithEvents();
    const store = new GitRefEventStore({ cwd: repo });
    await store.append(EVENTS as unknown as NonEmptyReadonlyArray<LedgerEvent>);
    const eventsTree = git(repo, ['rev-parse', `${LEDGER_REF}:events`]);

    await writeDerivedFiles({ cwd: repo }, [{ path: 'accumulators/INV-007.yaml', content: 'value: 1\n' }]);
    await writeDerivedFiles({ cwd: repo }, [{ path: 'accumulators/INV-007.yaml', content: 'value: 9\n' }]);

    expect(git(repo, ['rev-parse', `${LEDGER_REF}:events`])).toBe(eventsTree);
    expect((await store.list()).map((e) => e.event).sort()).toEqual(
      EVENTS.map((e) => e.event).sort(),
    );
  });

  it('writes nothing at all when handed nothing', async () => {
    const repo = repoWithEvents();
    const nothing = await writeDerivedFiles({ cwd: repo }, []);
    expect(nothing.commit).toBeNull();
    expect(git(repo, ['for-each-ref', 'refs/program'])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// gitExecRunner — the bridge between this directory's two git shells
// ---------------------------------------------------------------------------

describe('gitExecRunner — one git shell can serve both the store and the sighted port', () => {
  it('passes success through, and turns a non-zero exit into data rather than a throw', async () => {
    const repo = repoWithEvents();
    const runner = gitExecRunner(createGitExec({ cwd: repo }));

    const ok = await runner.run(['rev-parse', '--git-dir']);
    expect(ok.code).toBe(0);
    expect(ok.stdout.trim().length).toBeGreaterThan(0);

    // `GitExec` THROWS here; `GitRunner` may not, because it sits on the path that decides
    // whether the framework proposes amending its own constitution.
    const missing = await runner.run(['rev-parse', '--verify', 'refs/heads/nonesuch']);
    expect(missing.code).not.toBe(0);
    expect(missing.stderr.length).toBeGreaterThan(0);
  });

  it('reports a git that cannot be spawned at all as code -1, like gitCliRunner does', async () => {
    const repo = repoWithEvents();
    const runner = gitExecRunner(createGitExec({ cwd: repo, gitBin: 'gwtp-no-such-git' }));
    const result = await runner.run(['--version']);
    expect(result.code).toBe(-1);
    expect(result.stderr).toContain('gwtp-no-such-git');
  });

  it('drives the real sighted port, so the bridge is not merely well-typed', async () => {
    const repo = repoWithEvents();
    execFileSync('git', ['config', 'user.email', 'hand@gwtp.invalid'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'a hand'], { cwd: repo });
    execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'one'], { cwd: repo });
    const sha = unwrap(parseCommitSha(git(repo, ['rev-parse', 'HEAD'])));

    const port = gitSightedCommitPort(gitExecRunner(createGitExec({ cwd: repo })), {
      detectOrphans: false,
    });
    const found = (await port.lookup([sha])).get(sha);
    expect(found?.sha).toBe(sha);
    // The identity is present and OPAQUE: `ActorId` is not a string, and reading it needs a
    // warrant. This assertion deliberately checks only that dispersion COULD group by it.
    expect(found?.author).toBeDefined();
    expect(typeof (found?.author as unknown)).toBe('object');
  });
});
