// Implements tests for: seeds/SEED-02-ledger-engine.md deliverable 4 — `gwtp ledger
// append|fold|replay|status` — against docs/spec/02-ledger.md §1 (the ref and its tree layout),
// §4 (the leaky integrator), §5 (firing) and §6 (hysteresis, governance debt).
//
// EVERY GIT-WRITING TEST RUNS AGAINST A THROWAWAY REPOSITORY under `os.tmpdir()`. Nothing here
// touches the repository the suite is running in: no `refs/program/*` is created, nothing under
// `.program/` is written, and the two guards at the bottom assert both of those as facts rather
// than as intentions.
//
// The numbers are HAND-COMPUTED and the fixture is built to make them exact. Every event sits on
// a 90-day grid against a 90-day half-life, so every decay factor is a power of ½ and the whole
// fold can be checked in your head:
//
//   increment = precision_at · severity = 0.8 · 0.75 = 0.6           (spec 02 §4)
//   INV-777 at day 0:                     A = 0.6
//   INV-777 at day 90:  A = 0.6·2^(-1) + 0.6 = 0.3 + 0.6 = 0.9
//
// so `0.9` is not a golden value copied out of a passing run — it is arithmetic, and if the fold
// ever disagrees with it the fold is wrong.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../../src/cli/index.js';
import { LEDGER_REF, writeDerivedFiles } from '../../src/ledger/index.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

let stdout: string;
let stderr: string;

beforeEach(() => {
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function json<T = Record<string, unknown>>(): T {
  return JSON.parse(stdout) as T;
}

// ---------------------------------------------------------------------------
// The throwaway repository
// ---------------------------------------------------------------------------

const temps: string[] = [];

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim();
}

const INVARIANTS = `# throwaway fixture — not this repository's constitution
- id: INV-777
  statement: Every ledger fixture assertion needs a statement of at least eight characters
  class: behavior
  scope: ["src/**"]
  enforcement: deterministic
  precision: 0.8
  budget: 2.0
  half_life: 90d
  status: ratified
  provenance: [seed-02-test]

- id: INV-778
  statement: A second fixture assertion, with a budget one event can cross on its own
  class: boundary
  scope: ["src/**"]
  enforcement: deterministic
  precision: 0.8
  budget: 0.5
  half_life: 90d
  status: ratified
  provenance: [seed-02-test]
`;

const DAY0 = '2026-01-01T00:00:00Z';
/** Exactly 90 days after DAY0: 31 (Jan) + 28 (Feb, 2026 is not a leap year) + 31 (Mar). */
const DAY90 = '2026-04-01T00:00:00Z';

function violation(assertion: string, t: string, rationaleByte: string): string {
  return [
    `- subject: {commit: 0f0f0f0f}`,
    `  assertion: ${assertion}`,
    `  verdict: drift`,
    `  severity: 0.75`,
    `  precision_at: 0.8`,
    `  judge: {kind: deterministic, id: fixture-judge}`,
    `  rationale: sha256:${rationaleByte.repeat(64)}`,
    `  t: ${t}`,
    `  supersedes: null`,
  ].join('\n');
}

const EVENTS = [
  violation('INV-777', DAY0, '1'),
  violation('INV-777', DAY90, '2'),
  [
    `- subject: {commit: 0f0f0f0f}`,
    `  assertion: INV-777`,
    `  verdict: aligned`,
    `  judge: {kind: deterministic, id: fixture-judge}`,
    `  t: ${DAY90}`,
    `  supersedes: null`,
  ].join('\n'),
  violation('INV-778', DAY0, '3'),
  [
    `- subject: {path: "posts/ancient.md"}`,
    `  assertion: "docs/**"`,
    `  verdict: stale-claim`,
    `  severity: 0.5`,
    `  precision_at: 0.7`,
    `  judge: {kind: deterministic, id: obsolescence-sweep}`,
    `  rationale: sha256:${'4'.repeat(64)}`,
    `  t: ${DAY90}`,
    `  supersedes: null`,
  ].join('\n'),
].join('\n');

interface Fixture {
  readonly repo: string;
  readonly events: string;
}

/** A fresh repository with a `.program/` and an events file, and nothing appended yet. */
function makeRepo(): Fixture {
  const repo = mkdtempSync(join(tmpdir(), 'gwtp-cli-ledger-'));
  temps.push(repo);
  git(repo, ['init', '--quiet', '.']);
  git(repo, ['config', 'user.email', 'fixture@gwtp.invalid']);
  git(repo, ['config', 'user.name', 'gwtp fixture']);
  mkdirSync(join(repo, '.program'), { recursive: true });
  writeFileSync(join(repo, '.program', 'invariants.yaml'), INVARIANTS, 'utf8');
  const events = join(repo, 'events.yaml');
  writeFileSync(events, `${EVENTS}\n`, 'utf8');
  // Committed, so `git status --porcelain` is empty at rest and the INV-001 guard below is
  // measuring the command rather than measuring the fixture.
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'fixture']);
  return { repo, events };
}

/** The `value:` a written accumulator snapshot carries, as a number. */
function snapshotValue(yaml: string): number {
  const m = /^value: (\S+)$/m.exec(yaml);
  expect(m, `no \`value:\` line in\n${yaml}`).not.toBeNull();
  return Number((m as RegExpExecArray)[1]);
}

/** A repository whose ledger already holds the five fixture events. */
async function seeded(): Promise<Fixture> {
  const f = makeRepo();
  expect(await main(['ledger', 'append', '--repo', f.repo, f.events, '--json'])).toBe(0);
  stdout = '';
  return f;
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The command surface
// ---------------------------------------------------------------------------

describe('gwtp ledger — the command surface', () => {
  it('prints usage and exits nonzero when no subcommand is given', async () => {
    expect(await main(['ledger'])).toBe(2);
    expect(stdout).toContain('Usage:');
    for (const sub of ['append', 'fold', 'replay', 'status']) expect(stdout).toContain(sub);
  });

  it('names both write policies, because both constrain what it may do', async () => {
    await main(['ledger', '--help']);
    expect(stdout).toContain('INV-001');
    expect(stdout).toContain('INV-002');
  });

  it('rejects an unknown subcommand with a usage exit code', async () => {
    expect(await main(['ledger', 'compact'])).toBe(2);
    expect(stderr).toContain('unknown subcommand');
  });

  it.each(['append', 'fold', 'replay', 'status'])('`%s --help` documents its own flags', async (sub) => {
    expect(await main(['ledger', sub, '--help'])).toBe(0);
    expect(stdout).toContain(`gwtp ledger ${sub}`);
    for (const flag of ['--repo', '--ledger-ref', '--json', '--help']) {
      expect(stdout, `${sub} --help does not document ${flag}`).toContain(flag);
    }
  });

  it.each(['append', 'fold', 'replay', 'status'])('`%s` exits 2 on an unknown flag', async (sub) => {
    expect(await main(['ledger', sub, '--nonesuch'])).toBe(2);
    expect(stderr).toContain(`gwtp ledger ${sub}:`);
  });

  it.each(['append', 'fold', 'replay', 'status'])(
    '`%s` refuses a --repo that is not a git repository, instead of reporting an empty ledger',
    async (sub) => {
      // Every read in src/ledger answers "absent ref" and "absent repository" identically. A CLI
      // that passed that through would tell someone who mistyped a path that their ledger is
      // empty, which is the one wrong answer a governance tool must not give.
      const notARepo = mkdtempSync(join(tmpdir(), 'gwtp-not-a-repo-'));
      temps.push(notARepo);
      expect(await main(['ledger', sub, '--repo', notARepo])).toBe(2);
      expect(stderr).toContain('is not a git repository');

      stderr = '';
      expect(await main(['ledger', sub, '--repo', join(notARepo, 'nowhere')])).toBe(2);
      expect(stderr).toContain('does not exist');
    },
  );

  it('defaults the ref to refs/program/ledger and honours --ledger-ref', async () => {
    const f = makeRepo();
    expect(await main(['ledger', 'status', '--repo', f.repo, '--json'])).toBe(0);
    expect(json<{ ref: string }>().ref).toBe(LEDGER_REF);

    stdout = '';
    expect(
      await main(['ledger', 'status', '--repo', f.repo, '--ledger-ref', 'refs/program/other', '--json']),
    ).toBe(0);
    expect(json<{ ref: string }>().ref).toBe('refs/program/other');
  });
});

// ---------------------------------------------------------------------------
// append
// ---------------------------------------------------------------------------

describe('gwtp ledger append (spec 02 §1: content-addressed, idempotent)', () => {
  it('seals events with no `event:` field — the id is the hash of the body, not a writer\'s choice', async () => {
    const f = makeRepo();
    expect(await main(['ledger', 'append', '--repo', f.repo, f.events, '--json'])).toBe(0);
    const result = json<{ written: string[]; deduped: string[] }>();
    expect(result.written).toHaveLength(5);
    expect(result.deduped).toHaveLength(0);
    for (const id of result.written) expect(id).toMatch(/^sha256:[0-9a-f]{64}$/);

    // The filename IS the id (Q-10), and the ref now carries exactly those five blobs.
    const tree = git(f.repo, ['ls-tree', '--name-only', `${LEDGER_REF}:events`]);
    expect(tree.split('\n').sort()).toEqual(
      result.written.map((id) => `${id.slice('sha256:'.length)}.yaml`).sort(),
    );
  });

  it('is idempotent: appending the same file twice writes nothing the second time', async () => {
    const f = await seeded();
    const before = git(f.repo, ['rev-parse', LEDGER_REF]);

    expect(await main(['ledger', 'append', '--repo', f.repo, f.events, '--json'])).toBe(0);
    const result = json<{ written: string[]; deduped: string[] }>();
    expect(result.written).toEqual([]);
    expect(result.deduped).toHaveLength(5);
    expect(git(f.repo, ['rev-parse', LEDGER_REF])).toBe(before);
  });

  it('accepts a supplied `event:` id, and refuses one that is not the hash of the body', async () => {
    const f = makeRepo();
    expect(await main(['ledger', 'append', '--repo', f.repo, f.events, '--dry-run', '--json'])).toBe(0);
    const sealed = json<{ sealed: { event: string }[] }>().sealed;
    const id = sealed[0]?.event as string;

    // Round-trips when the id is the real one…
    const good = join(f.repo, 'with-id.yaml');
    writeFileSync(good, `${violation('INV-777', DAY0, '1')}\n  event: ${id}\n`, 'utf8');
    stdout = '';
    expect(await main(['ledger', 'append', '--repo', f.repo, good, '--dry-run', '--json'])).toBe(0);
    expect(json<{ sealed: { event: string }[] }>().sealed[0]?.event).toBe(id);

    // …and is refused when it is not, rather than trusted.
    const bad = join(f.repo, 'wrong-id.yaml');
    writeFileSync(bad, `${violation('INV-777', DAY0, '1')}\n  event: sha256:${'0'.repeat(64)}\n`, 'utf8');
    stdout = '';
    stderr = '';
    expect(await main(['ledger', 'append', '--repo', f.repo, bad, '--json'])).toBe(1);
    const problems = json<{ problems: { errors: { code: string }[] }[] }>().problems;
    expect(problems[0]?.errors[0]?.code).toBe('hash-mismatch');
    expect(git(f.repo, ['for-each-ref', 'refs/program'])).toBe('');
  });

  it('refuses the whole batch when any document does not decode — no partial ledger', async () => {
    const f = makeRepo();
    const mixed = join(f.repo, 'mixed.yaml');
    writeFileSync(
      mixed,
      `${violation('INV-777', DAY0, '1')}\n${violation('INV-777', DAY0, '2').replace('verdict: drift', 'verdict: breach')}\n`,
      'utf8',
    );
    expect(await main(['ledger', 'append', '--repo', f.repo, mixed])).toBe(1);
    expect(stderr).toContain('refusing to write');
    expect(stderr).toContain('invalid-enum');
    // The ref was never created: a batch that half-applied would be the worst outcome available.
    expect(execFileSync('git', ['for-each-ref', 'refs/program'], { cwd: f.repo, encoding: 'utf8' })).toBe(
      '',
    );
  });

  it('--dry-run seals and reports, and writes nothing', async () => {
    const f = makeRepo();
    expect(await main(['ledger', 'append', '--repo', f.repo, f.events, '--dry-run'])).toBe(0);
    expect(stdout).toContain('nothing written');
    expect(execFileSync('git', ['for-each-ref', 'refs/program'], { cwd: f.repo, encoding: 'utf8' })).toBe(
      '',
    );
  });

  it('reads from stdin, in a real child process rather than a mocked one', () => {
    const f = makeRepo();
    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', join(REPO_ROOT, 'src/cli/index.ts'), 'ledger', 'append', '--repo', f.repo, '--json'],
      { cwd: REPO_ROOT, encoding: 'utf8', input: readFileSync(f.events, 'utf8') },
    );
    expect((JSON.parse(out) as { written: string[] }).written).toHaveLength(5);
    expect(git(f.repo, ['ls-tree', '--name-only', `${LEDGER_REF}:events`]).split('\n')).toHaveLength(5);
  });

  it('reports a missing file instead of silently appending nothing', async () => {
    const f = makeRepo();
    expect(await main(['ledger', 'append', '--repo', f.repo, join(f.repo, 'nope.yaml')])).toBe(1);
    expect(stderr).toContain('no such file');
  });
});

// ---------------------------------------------------------------------------
// fold — the arithmetic
// ---------------------------------------------------------------------------

interface Row {
  key: string;
  value: number;
  budget: number | null;
  percentOfBudget: number | null;
  armed: boolean;
  violationCount: number;
  complianceCount: number;
  abstentionCount: number;
  contributing: number;
  halfLife: string | null;
  firings: number;
}

interface FoldJson {
  accumulators: Row[];
  firings: { key: string; value: number; budget: number; at: string }[];
  unfolded: string[];
  eventCount: number;
  ok: boolean;
  write: { written: string[]; unchanged: string[]; commit: string | null } | null;
}

async function fold(repo: string, extra: readonly string[] = []): Promise<FoldJson> {
  stdout = '';
  const code = await main(['ledger', 'fold', '--repo', repo, '--json', ...extra]);
  expect(code, stderr).toBe(0);
  return json<FoldJson>();
}

describe('gwtp ledger append --push (spec 02 §1.1: concurrent CI writers converge)', () => {
  it('two writers pushing to one bare origin converge to the set union, never last-writer-wins', async () => {
    const origin = mkdtempSync(join(tmpdir(), 'gwtp-cli-origin-'));
    temps.push(origin);
    git(origin, ['init', '--bare', '--quiet', '.']);

    // Two independent working repos, each appending a DIFFERENT event (distinct content → distinct
    // content-addressed name). If append --push only wrote a private local ref, origin would end
    // holding whichever writer pushed last. The union path is what this test exists to prove.
    const a = makeRepo();
    const b = makeRepo();
    const eaFile = join(a.repo, 'a-event.yaml');
    const ebFile = join(b.repo, 'b-event.yaml');
    writeFileSync(eaFile, `${violation('INV-777', DAY0, '1')}\n`, 'utf8');
    writeFileSync(ebFile, `${violation('INV-778', DAY0, '3')}\n`, 'utf8');

    expect(
      await main(['ledger', 'append', '--repo', a.repo, eaFile, '--push', origin, '--json']),
      stderr,
    ).toBe(0);
    stdout = '';

    // B's push must FETCH A's event, union it in, and push the union — never overwrite A.
    expect(
      await main(['ledger', 'append', '--repo', b.repo, ebFile, '--push', origin, '--json']),
      stderr,
    ).toBe(0);
    expect(json<{ pushed: boolean }>().pushed).toBe(true);
    stdout = '';

    const names = git(origin, ['ls-tree', '-r', '--name-only', 'refs/program/ledger'])
      .split('\n')
      .filter((l) => l.startsWith('events/'));
    expect(names.length, 'origin ledger must hold BOTH events after two --push writers').toBe(2);
  });
});

describe('gwtp ledger fold (spec 02 §4: A <- A·2^(-Δt/half_life) + precision_at·severity)', () => {
  it('reproduces the hand-computed fold: 0.6·2^(-1) + 0.6 = 0.9 over a 90-day grid', async () => {
    const f = await seeded();
    const result = await fold(f.repo);
    const row = result.accumulators.find((r) => r.key === 'INV-777') as Row;

    expect(row.value).toBeCloseTo(0.9, 12);
    expect(row.budget).toBe(2);
    expect(row.percentOfBudget).toBeCloseTo(45, 12);
    expect(row.halfLife).toBe('90d');
    expect(row.violationCount).toBe(2);
    expect(row.contributing).toBe(2);
    expect(row.armed).toBe(true);
    expect(row.firings).toBe(0);
  });

  it('counts compliances and never subtracts them — decay is the only forgiveness (spec 02 §4)', async () => {
    const f = await seeded();
    const row = (await fold(f.repo)).accumulators.find((r) => r.key === 'INV-777') as Row;
    expect(row.complianceCount).toBe(1);
    // The aligned event sits at DAY90, on top of the second violation. If it paid anything down,
    // or advanced the meter's reference instant, `value` could not still be exactly 0.9.
    expect(row.value).toBeCloseTo(0.9, 12);
  });

  it('fires when A >= budget and does not re-arm above the re-arm fraction (spec 02 §5, §6)', async () => {
    const f = await seeded();
    const result = await fold(f.repo);
    const row = result.accumulators.find((r) => r.key === 'INV-778') as Row;

    expect(row.value).toBeCloseTo(0.6, 12);
    expect(row.budget).toBe(0.5);
    expect(row.armed).toBe(false);
    expect(row.firings).toBe(1);

    expect(result.firings).toHaveLength(1);
    expect(result.firings[0]?.key).toBe('INV-778');
    expect(result.firings[0]?.at).toBe(DAY0);
    expect(result.firings[0]?.value).toBeCloseTo(0.6, 12);
  });

  it('ages the meter to --as-of without changing what the fold recorded (ADR-0004)', async () => {
    const f = await seeded();
    // 90 days past the last event: exactly one half-life, so exactly half of 0.9.
    const projected = await fold(f.repo, ['--as-of', '2026-06-30T00:00:00Z']);
    const row = projected.accumulators.find((r) => r.key === 'INV-777') as Row;
    expect(row.value).toBeCloseTo(0.45, 12);
    expect(row.violationCount).toBe(2);

    const plain = await fold(f.repo);
    expect((plain.accumulators.find((r) => r.key === 'INV-777') as Row).value).toBeCloseTo(0.9, 12);
  });

  it('reports a key with no assertion instead of folding it against a guessed budget (Q-56)', async () => {
    const f = await seeded();
    const result = await fold(f.repo);
    expect(result.unfolded).toEqual(['docs/**']);
    expect(result.accumulators.map((r) => r.key)).toEqual(['INV-777', 'INV-778']);
  });

  it('restricts to --key, and exits nonzero for a key this ledger has never seen', async () => {
    const f = await seeded();
    const result = await fold(f.repo, ['--key', 'INV-777']);
    expect(result.accumulators.map((r) => r.key)).toEqual(['INV-777']);

    stdout = '';
    expect(await main(['ledger', 'fold', '--repo', f.repo, '--key', 'INV-999', '--json'])).toBe(1);
    expect(json<{ unknownKeys: string[] }>().unknownKeys).toEqual(['INV-999']);
  });

  it('is deterministic: two folds of one event set agree exactly', async () => {
    const f = await seeded();
    const a = await fold(f.repo);
    const b = await fold(f.repo);
    expect(b.accumulators).toEqual(a.accumulators);
    expect(b.firings).toEqual(a.firings);
  });

  it('answers for an empty ledger rather than failing', async () => {
    const f = makeRepo();
    const result = await fold(f.repo);
    expect(result.eventCount).toBe(0);
    expect(result.accumulators).toEqual([]);
    expect(stderr).toBe('');
  });
});

// ---------------------------------------------------------------------------
// fold --write — the derived cache
// ---------------------------------------------------------------------------

describe('gwtp ledger fold --write (spec 02 §1: accumulators/ is a derived cache)', () => {
  it('materializes accumulators/ and leaves events/ byte-identical (INV-002)', async () => {
    const f = await seeded();
    const eventsBefore = git(f.repo, ['rev-parse', `${LEDGER_REF}:events`]);

    const result = await fold(f.repo, ['--write']);
    expect(result.write?.written.sort()).toEqual([
      'accumulators/INV-777.yaml',
      'accumulators/INV-778.yaml',
    ]);
    expect(git(f.repo, ['rev-parse', `${LEDGER_REF}:events`])).toBe(eventsBefore);

    const snapshot = git(f.repo, ['cat-file', 'blob', `${LEDGER_REF}:accumulators/INV-777.yaml`]);
    expect(snapshot).toContain('key: "INV-777"');
    expect(snapshot).toContain('violation_count: 2');
    expect(snapshot).toContain('compliance_count: 1');
    expect(snapshot).toContain('armed: true');
    expect(snapshotValue(snapshot)).toBeCloseTo(0.9, 12);
  });

  it('writes the UNPROJECTED fold even under --as-of, so the cache never records a clock', async () => {
    const f = await seeded();
    await fold(f.repo, ['--write', '--as-of', '2026-06-30T00:00:00Z']);
    // The table said 0.45; the file must still say 0.9, because `accumulators/` is a pure
    // function of `events/` and the knobs (ADR-0002) and nothing else.
    const snapshot = git(f.repo, ['cat-file', 'blob', `${LEDGER_REF}:accumulators/INV-777.yaml`]);
    expect(snapshotValue(snapshot)).toBeCloseTo(0.9, 12);
    expect(snapshot).toContain(`as_of: "${DAY90}"`);
  });

  it('is idempotent: a second --write with the same events makes no commit at all', async () => {
    const f = await seeded();
    await fold(f.repo, ['--write']);
    const tip = git(f.repo, ['rev-parse', LEDGER_REF]);

    const again = await fold(f.repo, ['--write']);
    expect(again.write?.commit).toBeNull();
    expect(again.write?.written).toEqual([]);
    expect(again.write?.unchanged).toHaveLength(2);
    expect(git(f.repo, ['rev-parse', LEDGER_REF])).toBe(tip);
  });

  it('the written cache is exactly what a fresh fold recomputes', async () => {
    const f = await seeded();
    await fold(f.repo, ['--write']);
    const cached = git(f.repo, ['cat-file', 'blob', `${LEDGER_REF}:accumulators/INV-778.yaml`]);
    expect(cached).toContain('armed: false');
    expect(cached).toContain(`last_fired_at: "${DAY0}"`);
    // …and re-folding after the cache exists changes neither the answer nor the cache.
    const after = await fold(f.repo, ['--write']);
    expect(after.write?.commit).toBeNull();
  });

  it('refuses to write anything under events/ — INV-002 as a path guard, not a convention', async () => {
    const f = await seeded();
    await expect(
      writeDerivedFiles({ cwd: f.repo }, [{ path: 'events/whatever.yaml', content: 'x: 1\n' }]),
    ).rejects.toThrow(/append-only \(INV-002\)/);
    await expect(
      writeDerivedFiles({ cwd: f.repo }, [{ path: '../escape.yaml', content: 'x: 1\n' }]),
    ).rejects.toThrow(/derived file lives at/);
  });
});

// ---------------------------------------------------------------------------
// replay
// ---------------------------------------------------------------------------

interface ReplayJson {
  overrides: { halfLife: string | null; budget: number | null; precision: number | null };
  comparison: {
    key: string;
    recorded: Row | null;
    counterfactual: Row | null;
    delta: { value: number | null; firings: number | null; armed: boolean | null };
  }[];
  wrote: null;
  note: string;
}

async function replay(repo: string, extra: readonly string[]): Promise<ReplayJson> {
  stdout = '';
  const code = await main(['ledger', 'replay', '--repo', repo, '--json', ...extra]);
  expect(code, stderr).toBe(0);
  return json<ReplayJson>();
}

describe('gwtp ledger replay (spec 02 §1.3: counterfactuals without losing anything)', () => {
  it('shows recorded beside counterfactual, and fires under a lowered budget', async () => {
    const f = await seeded();
    const result = await replay(f.repo, ['--budget', '0.8']);
    const row = result.comparison.find((c) => c.key === 'INV-777');

    expect(row?.recorded?.budget).toBe(2);
    expect(row?.recorded?.firings).toBe(0);
    expect(row?.counterfactual?.budget).toBe(0.8);
    // A = 0.6 at day 0 (below 0.8), then 0.9 at day 90 (at or above 0.8): exactly one firing.
    expect(row?.counterfactual?.firings).toBe(1);
    expect(row?.counterfactual?.value).toBeCloseTo(0.9, 12);
    expect(row?.delta.firings).toBe(1);
    expect(row?.delta.armed).toBe(true);
  });

  it('substitutes precision at READ time; the frozen precision_at is never touched', async () => {
    const f = await seeded();
    const before = git(f.repo, ['rev-parse', `${LEDGER_REF}:events`]);

    // precision 1.0 · severity 0.75 = 0.75 per event: 0.75·2^(-1) + 0.75 = 1.125.
    const result = await replay(f.repo, ['--precision', '1.0']);
    const row = result.comparison.find((c) => c.key === 'INV-777');
    expect(row?.counterfactual?.value).toBeCloseTo(1.125, 12);
    expect(row?.recorded?.value).toBeCloseTo(0.9, 12);
    expect(row?.delta.value).toBeCloseTo(0.225, 12);

    expect(git(f.repo, ['rev-parse', `${LEDGER_REF}:events`])).toBe(before);
  });

  it('halves the meter when the half-life halves — 0.6·2^(-2) + 0.6 = 0.75', async () => {
    const f = await seeded();
    const result = await replay(f.repo, ['--half-life', '45d']);
    expect(
      result.comparison.find((c) => c.key === 'INV-777')?.counterfactual?.value,
    ).toBeCloseTo(0.75, 12);
  });

  it('WRITES NOTHING — not the ref, not the cache, not .program/', async () => {
    const f = await seeded();
    const tip = git(f.repo, ['rev-parse', LEDGER_REF]);
    const program = readFileSync(join(f.repo, '.program', 'invariants.yaml'), 'utf8');

    const result = await replay(f.repo, ['--budget', '0.1', '--half-life', '1d', '--precision', '1.0']);
    expect(result.wrote).toBeNull();
    expect(result.note).toContain('nothing was written');
    expect(git(f.repo, ['rev-parse', LEDGER_REF])).toBe(tip);
    expect(readFileSync(join(f.repo, '.program', 'invariants.yaml'), 'utf8')).toBe(program);

    stdout = '';
    await main(['ledger', 'replay', '--repo', f.repo, '--budget', '0.1']);
    expect(stdout).toContain('NOTHING WAS WRITTEN');
  });

  it('gives knobs to a keyless accumulator only when BOTH --half-life and --budget are supplied (Q-56)', async () => {
    const f = await seeded();
    const partial = await replay(f.repo, ['--budget', '1.0']);
    expect(partial.comparison.some((c) => c.key === 'docs/**')).toBe(false);

    const complete = await replay(f.repo, ['--budget', '1.0', '--half-life', '90d']);
    const claim = complete.comparison.find((c) => c.key === 'docs/**');
    expect(claim?.recorded).toBeNull();
    // 0.7 · 0.5 = 0.35, undecayed: it is the only event on that key.
    expect(claim?.counterfactual?.value).toBeCloseTo(0.35, 12);
  });

  it('rejects an unreadable knob with a usage exit code rather than folding on a guess', async () => {
    const f = await seeded();
    expect(await main(['ledger', 'replay', '--repo', f.repo, '--budget', 'soon'])).toBe(2);
    expect(stderr).toContain('invalid-budget');

    stderr = '';
    expect(await main(['ledger', 'replay', '--repo', f.repo, '--half-life', '3 fortnights'])).toBe(2);
    expect(stderr).toContain('invalid-duration');

    stderr = '';
    expect(await main(['ledger', 'replay', '--repo', f.repo, '--precision', '2'])).toBe(2);
    expect(stderr).toContain('invalid-precision');
  });
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

interface StatusJson {
  refPresent: boolean;
  tip: string | null;
  events: { total: number; violations: number; compliances: number; abstentions: number; firingEvents: number };
  accumulators: Row[];
  nearBudget: Row[];
  lastFiring: { key: string; at: string; value: number; budget: number } | null;
  governanceDebt: {
    openCount: number;
    proposalDays: number;
    oldestAgeDays: number;
    byKind: Record<string, number>;
  };
  unfolded: string[];
  ok: boolean;
}

describe('gwtp ledger status — one screen', () => {
  it('reports an absent ref as absent rather than as an error', async () => {
    const f = makeRepo();
    expect(await main(['ledger', 'status', '--repo', f.repo, '--json'])).toBe(0);
    const s = json<StatusJson>();
    expect(s.refPresent).toBe(false);
    expect(s.tip).toBeNull();
    expect(s.events.total).toBe(0);
    expect(s.lastFiring).toBeNull();
    expect(s.governanceDebt.proposalDays).toBe(0);
  });

  it('censuses the events, names what is near budget, and names the last firing', async () => {
    const f = await seeded();
    expect(await main(['ledger', 'status', '--repo', f.repo, '--as-of', DAY90, '--json'])).toBe(0);
    const s = json<StatusJson>();

    expect(s.refPresent).toBe(true);
    expect(s.events).toMatchObject({ total: 5, violations: 4, compliances: 1, abstentions: 0 });
    expect(s.unfolded).toEqual(['docs/**']);

    // At DAY90, INV-778's meter has decayed 0.6 -> 0.3, which is 60% of its 0.5 budget: still
    // above the 50% re-arm line, so it is both "near budget" and still disarmed.
    const hot = s.nearBudget.find((r) => r.key === 'INV-778');
    expect(hot?.value).toBeCloseTo(0.3, 12);
    expect(hot?.percentOfBudget).toBeCloseTo(60, 12);
    expect(hot?.armed).toBe(false);

    expect(s.lastFiring?.key).toBe('INV-778');
    expect(s.lastFiring?.at).toBe(DAY0);
  });

  it('measures governance debt in proposal-days and does not decay it (spec 02 §6, Q-55/Q-57)', async () => {
    const f = await seeded();
    expect(await main(['ledger', 'status', '--repo', f.repo, '--as-of', '2026-01-11T00:00:00Z', '--json'])).toBe(0);
    const ten = json<StatusJson>().governanceDebt;
    expect(ten.openCount).toBe(1);
    expect(ten.proposalDays).toBeCloseTo(10, 9);
    expect(ten.byKind['unrecorded']).toBeCloseTo(10, 9);
    expect(ten.byKind['refactor']).toBe(0);

    stdout = '';
    expect(await main(['ledger', 'status', '--repo', f.repo, '--as-of', '2026-03-02T00:00:00Z', '--json'])).toBe(0);
    // 60 days on, the debt is SIX TIMES larger. Surprise decays; an ignored proposal does not.
    expect(json<StatusJson>().governanceDebt.proposalDays).toBeCloseTo(60, 9);
  });

  it('prints a one-screen human summary naming every section', async () => {
    const f = await seeded();
    expect(await main(['ledger', 'status', '--repo', f.repo, '--as-of', DAY90])).toBe(0);
    for (const section of ['ledger', 'events', 'program', 'as of', 'near budget', 'last firing', 'governance debt']) {
      expect(stdout, `status does not report ${section}`).toContain(section);
    }
  });

  it('reports a repository with no .program/ instead of pretending it folded', async () => {
    const f = await seeded();
    rmSync(join(f.repo, '.program'), { recursive: true, force: true });
    expect(await main(['ledger', 'status', '--repo', f.repo, '--json'])).toBe(0);
    const s = json<StatusJson>();
    expect(s.accumulators).toEqual([]);
    expect([...s.unfolded].sort()).toEqual(['INV-777', 'INV-778', 'docs/**'].sort());
  });
});

// ---------------------------------------------------------------------------
// Tamper evidence
// ---------------------------------------------------------------------------

describe('a tampered ledger is reported, never quietly folded (spec 02 §1, Q-37)', () => {
  it('exits nonzero from fold and status when a blob does not hash to its name', async () => {
    const f = await seeded();
    const events = git(f.repo, ['ls-tree', `${LEDGER_REF}:events`]).split('\n');
    const first = (events[0] as string).split('\t');
    const name = first[1] as string;
    const blobId = (first[0] as string).split(' ')[2] as string;

    const body = execFileSync('git', ['cat-file', 'blob', blobId], { cwd: f.repo, encoding: 'utf8' });
    const tampered = execFileSync('git', ['hash-object', '-w', '-t', 'blob', '--stdin'], {
      cwd: f.repo,
      encoding: 'utf8',
      input: body.replace('severity: 0.75', 'severity: 0.5'),
    }).trim();
    const entries = events
      .map((line) => (line.includes(name) ? `100644 blob ${tampered}\t${name}` : line))
      .join('\n');
    const eventsTree = execFileSync('git', ['mktree'], { cwd: f.repo, encoding: 'utf8', input: `${entries}\n` }).trim();
    const root = execFileSync('git', ['mktree'], {
      cwd: f.repo,
      encoding: 'utf8',
      input: `040000 tree ${eventsTree}\tevents\n`,
    }).trim();
    const commit = git(f.repo, ['commit-tree', root, '-p', git(f.repo, ['rev-parse', LEDGER_REF]), '-m', 'tamper']);
    git(f.repo, ['update-ref', LEDGER_REF, commit]);

    expect(await main(['ledger', 'fold', '--repo', f.repo])).toBe(1);
    expect(stderr).toContain('tamper evidence');
    expect(stderr).toContain('hash-mismatch');

    stdout = '';
    stderr = '';
    expect(await main(['ledger', 'status', '--repo', f.repo, '--json'])).toBe(1);
    expect(json<{ ok: boolean; problems: { code: string }[] }>().ok).toBe(false);

    // `fold --write` must REFUSE on a tampered ledger and leave the ref where it is. The fold ran
    // over the events MINUS the tampered blob, so materializing would persist a cache that agrees
    // with the tamperer and move the ref onto it — the one thing a derived level may never do.
    stdout = '';
    stderr = '';
    const tipBefore = git(f.repo, ['rev-parse', LEDGER_REF]);
    expect(await main(['ledger', 'fold', '--repo', f.repo, '--write'])).toBe(1);
    expect(stderr).toContain('refusing to materialize');
    // No accumulators/ tree was written, and the ref did not advance onto a materialize commit.
    expect(git(f.repo, ['rev-parse', LEDGER_REF])).toBe(tipBefore);
    expect(git(f.repo, ['ls-tree', '--name-only', LEDGER_REF])).not.toContain('accumulators');
  });
});

// ---------------------------------------------------------------------------
// The two standing guards
// ---------------------------------------------------------------------------

describe('what this command may never do', () => {
  it('never writes .program/ — no subcommand has a path to it (INV-001)', async () => {
    const f = await seeded();
    const before = readFileSync(join(f.repo, '.program', 'invariants.yaml'), 'utf8');
    for (const argv of [
      ['ledger', 'append', '--repo', f.repo, f.events],
      ['ledger', 'fold', '--repo', f.repo, '--write'],
      ['ledger', 'replay', '--repo', f.repo, '--budget', '0.1'],
      ['ledger', 'status', '--repo', f.repo],
    ]) {
      stdout = '';
      await main(argv);
    }
    expect(readFileSync(join(f.repo, '.program', 'invariants.yaml'), 'utf8')).toBe(before);
    expect(git(f.repo, ['status', '--porcelain'])).toBe('');
  });

  it('reads no author identity: the CLI cannot reach the sighted port (INV-003, ADR-0003)', () => {
    // The declassification audit for this file, as data. `withSentencingWarrant` is the only
    // issuer of a warrant, and the meter is the only thing this command unwraps — never a hand.
    const source = readFileSync(join(REPO_ROOT, 'src/cli/commands/ledger.ts'), 'utf8');
    const imports = source.slice(0, source.indexOf('// ---'));

    // Exactly ONE call site. The name also appears in two comments and in the import clause,
    // which is why the paren is part of the pattern: it counts doors, not mentions.
    expect(source.match(/withSentencingWarrant\(/g) ?? []).toHaveLength(1);
    expect(imports).toContain("from '../../core/sentencing.js'");
    expect(source).not.toContain('sighted.js');
    for (const declassifier of ['revealActor', 'actorId', 'actorGroupKey', 'computeDispersion']) {
      expect(source, `the ledger CLI names ${declassifier}`).not.toContain(`${declassifier}(`);
    }
  });
});
