// Implements tests for: scripts/check-inv001.ts — the deterministic INV-001 check
// (.program/invariants.yaml INV-001, seeds/SEED-01-scaffold.md deliverable 3).
//
// No git process is spawned and no fixture repository is created: a governance check that can
// only be tested by building repositories is a governance check nobody runs. `CommitRecord`
// exists so this file can hand the decision procedure a commit that never happened, and
// `GitPort` exists so it can hand `main()` a git that never ran — which is what makes the
// EXIT-CODE contract (0 clean · 1 violated · 2 could not look) testable at all.

import { describe, expect, it, vi } from 'vitest';
import {
  MACHINE_ACTOR_PATTERNS,
  PROGRAM_PATH_PREFIX,
  actorsOf,
  findInv001Violations,
  formatViolations,
  isProgramPath,
  machineActorMatches,
  main,
  parseCoAuthors,
  parseCommitHeader,
  parseNulPaths,
  parseRevList,
  planWalk,
  readCommits,
  resolveRangeRequest,
  type CommitRecord,
  type GitPort,
} from '../scripts/check-inv001.js';

const HUMAN = { name: 'Amr', email: 'amr.abdel@gmail.com' } as const;

function commit(over: Partial<CommitRecord> = {}): CommitRecord {
  return {
    sha: 'a'.repeat(40),
    authorName: HUMAN.name,
    authorEmail: HUMAN.email,
    committerName: HUMAN.name,
    committerEmail: HUMAN.email,
    message: 'ratify INV-001\n',
    paths: ['.program/invariants.yaml'],
    ...over,
  };
}

const BOT = {
  authorName: 'github-actions[bot]',
  authorEmail: '41898282+github-actions[bot]@users.noreply.github.com',
  committerName: 'github-actions[bot]',
  committerEmail: '41898282+github-actions[bot]@users.noreply.github.com',
} as const;

// ────────────────────────────────────────────────────────────────────────────────────────
// The five cases SEED-01 deliverable 3 names
// ────────────────────────────────────────────────────────────────────────────────────────

describe('findInv001Violations — the five required cases', () => {
  it('PASSES a human commit touching .program/ (that is the sanctioned write path)', () => {
    const commits = [commit({ paths: ['.program/invariants.yaml', '.program/charter.md'] })];
    expect(findInv001Violations(commits)).toEqual([]);
  });

  it('FAILS a bot commit touching .program/', () => {
    const commits = [commit({ ...BOT, paths: ['.program/scope.yaml'] })];
    const violations = findInv001Violations(commits);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.programPaths).toEqual(['.program/scope.yaml']);
    expect(violations[0]?.machineActors.map((m) => m.patternId)).toContain(
      'github-app-bot-noreply',
    );
  });

  it('PASSES a bot commit touching src/ only (bots writing code is the point of the project)', () => {
    const commits = [
      commit({ ...BOT, paths: ['src/core/event.ts', 'tests/core/event.test.ts', 'README.md'] }),
    ];
    expect(findInv001Violations(commits)).toEqual([]);
  });

  it('FAILS a human commit carrying a Claude Co-Authored-By trailer that touches .program/', () => {
    const commits = [
      commit({
        message:
          'claim src/** in scope.yaml\n\nWritten by an agent session.\n\n' +
          'Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\n',
        paths: ['.program/scope.yaml'],
      }),
    ];
    const violations = findInv001Violations(commits);
    expect(violations).toHaveLength(1);
    const match = violations[0]?.machineActors[0];
    expect(match?.patternId).toBe('anthropic-noreply');
    expect(match?.actor.role).toBe('co-authored-by');
    // The author and committer are a human; the trailer alone is what fires.
    expect(violations[0]?.commit.authorEmail).toBe(HUMAN.email);
  });

  it('PASSES an empty range', () => {
    expect(findInv001Violations([])).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// Machine-actor detection
// ────────────────────────────────────────────────────────────────────────────────────────

describe('MACHINE_ACTOR_PATTERNS', () => {
  it('has a unique, documented id for every entry', () => {
    const ids = MACHINE_ACTOR_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of MACHINE_ACTOR_PATTERNS) {
      expect(p.why.length).toBeGreaterThan(40);
      expect(p.pattern.flags).toContain('i');
      // No lastIndex state to leak between commits.
      expect(p.pattern.global).toBe(false);
    }
  });

  it.each([
    ['41898282+github-actions[bot]@users.noreply.github.com', 'github-app-bot-noreply'],
    ['49699333+dependabot[bot]@users.noreply.github.com', 'github-app-bot-noreply'],
    ['29139614+renovate[bot]@users.noreply.github.com', 'github-app-bot-noreply'],
    ['anything@bots.noreply.github.com', 'bots-noreply-domain'],
    ['actions@github.com', 'github-actions-default-committer'],
    ['Actions@GitHub.com', 'github-actions-default-committer'],
    ['noreply@anthropic.com', 'anthropic-noreply'],
  ])('flags %s as a machine actor via %s', (email, patternId) => {
    const matches = machineActorMatches(
      commit({ authorEmail: email, authorName: 'whatever', committerEmail: email }),
    );
    expect(matches.map((m) => m.patternId)).toContain(patternId);
  });

  it('flags a display name ending in [bot] whatever the email says', () => {
    const matches = machineActorMatches(
      commit({ authorName: 'some-forge-runner[bot]', authorEmail: 'ci@example.invalid' }),
    );
    expect(matches.map((m) => m.patternId)).toEqual(['bot-suffixed-name']);
  });

  it.each([
    ['bamr87@users.noreply.github.com', 'a human GitHub no-reply address'],
    ['abbott@example.com', 'a surname containing "bot"'],
    ['robotics@example.com', 'a word containing "bot"'],
    ['talbot@github.com', 'a github.com address that is not actions@'],
    ['someone@anthropic.com', 'a human at the same domain as the agent no-reply'],
  ])('does NOT flag %s (%s)', (email) => {
    expect(machineActorMatches(commit({ authorEmail: email, committerEmail: email }))).toEqual([]);
  });

  it('flags a bot COMMITTER even when the author is human (rebase/squash by CI)', () => {
    const matches = machineActorMatches(
      commit({ committerName: BOT.committerName, committerEmail: BOT.committerEmail }),
    );
    expect(matches).toHaveLength(2); // name pattern + email pattern, both on the committer
    expect(matches.every((m) => m.actor.role === 'committer')).toBe(true);
  });
});

describe('parseCoAuthors', () => {
  it('reads the trailer whatever its casing, and keeps name and email apart', () => {
    const actors = parseCoAuthors(
      'subject\n\nbody\n\n' +
        'Co-authored-by: Lower Case <a@bots.noreply.github.com>\n' +
        'CO-AUTHORED-BY: Shouty <b@example.com>\n' +
        '  Co-Authored-By: Indented <c@example.com>\n',
    );
    expect(actors.map((a) => a.email)).toEqual([
      'a@bots.noreply.github.com',
      'b@example.com',
      'c@example.com',
    ]);
    expect(actors.map((a) => a.name)).toEqual(['Lower Case', 'Shouty', 'Indented']);
    expect(actors.every((a) => a.role === 'co-authored-by')).toBe(true);
  });

  it('ignores Signed-off-by — attestation is not authorship', () => {
    expect(parseCoAuthors('subject\n\nSigned-off-by: A Bot <x@bots.noreply.github.com>\n')).toEqual(
      [],
    );
  });

  it('survives a trailer with no angle brackets', () => {
    const actors = parseCoAuthors('subject\n\nCo-Authored-By: nameless-runner[bot]\n');
    expect(actors).toEqual([{ role: 'co-authored-by', name: 'nameless-runner[bot]', email: '' }]);
    // …and the name backstop still catches it.
    expect(
      machineActorMatches(commit({ message: 'x\n\nCo-Authored-By: nameless-runner[bot]\n' })).map(
        (m) => m.patternId,
      ),
    ).toEqual(['bot-suffixed-name']);
  });

  it('returns nothing for a message with no trailers', () => {
    expect(parseCoAuthors('init')).toEqual([]);
  });
});

describe('actorsOf', () => {
  it('reports author, committer and every co-author, in that order', () => {
    const actors = actorsOf(commit({ message: 'x\n\nCo-Authored-By: C <c@example.com>\n' }));
    expect(actors.map((a) => a.role)).toEqual(['author', 'committer', 'co-authored-by']);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// Path scoping
// ────────────────────────────────────────────────────────────────────────────────────────

describe('isProgramPath', () => {
  it('claims exactly the root .program/ subtree', () => {
    expect(PROGRAM_PATH_PREFIX).toBe('.program/');
    for (const p of [
      '.program/charter.md',
      '.program/invariants.yaml',
      '.program/nested/deeper/x.yaml',
      './.program/scope.yaml',
    ]) {
      expect(isProgramPath(p)).toBe(true);
    }
  });

  it('does not claim lookalikes or nested program stores of other repos', () => {
    for (const p of [
      'src/core/program.ts',
      'docs/spec/01-core-memory.md',
      '.programrc',
      '.program-notes/x.yaml',
      'vendor/other-repo/.program/charter.md',
      'proposals/PROPOSED-program-amendment.md',
    ]) {
      expect(isProgramPath(p)).toBe(false);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// Reporting
// ────────────────────────────────────────────────────────────────────────────────────────

describe('formatViolations', () => {
  it('names the sha, both identities, the rule that fired and every .program/ path', () => {
    const c = commit({
      ...BOT,
      sha: '9f2c1d'.padEnd(40, '0'),
      paths: ['.program/scope.yaml', 'src/core/paths.ts', '.program/manifest.yaml'],
    });
    const report = formatViolations(findInv001Violations([c]));
    expect(report).toContain(c.sha);
    expect(report).toContain(BOT.authorEmail);
    expect(report).toContain('github-app-bot-noreply');
    expect(report).toContain('.program/scope.yaml');
    expect(report).toContain('.program/manifest.yaml');
    // Only the .program/ paths are listed — the rest of the diff is not INV-001's business.
    expect(report).not.toContain('src/core/paths.ts');
  });

  it('is empty when there is nothing to report', () => {
    expect(formatViolations([])).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// The git shell's parsers (still no subprocess)
//
// THE REGRESSION THESE GUARD. The previous framing read the whole range in one `git log`,
// splitting records on U+001E and fields on NUL — both of which live inside `%B`, which is
// text the commit's own author wrote. `git commit` cleans messages with `git stripspace`,
// which passes control bytes through untouched, so a bot could put one U+001E in its own
// message, split its own record, lose the `--name-only` tail, and be reported with `paths: []`
// — i.e. as a commit that touched nothing, i.e. as clean. Framing now comes from `git` itself
// (`rev-list` shas, `-z` path lists) and `%B` is last in its own invocation, so a message can
// only ever corrupt itself.
// ────────────────────────────────────────────────────────────────────────────────────────

const RS = String.fromCharCode(0x1e);
const NUL = String.fromCharCode(0x00);

/** Byte-faithful `git show --no-patch --format=%an%x00%ae%x00%cn%x00%ce%x00%B <sha>` output. */
function headerOutput(c: CommitRecord): string {
  return (
    [c.authorName, c.authorEmail, c.committerName, c.committerEmail].join(NUL) + NUL + c.message
  );
}

/** Byte-faithful `git show -c --no-renames --name-only -z --format= <sha>` output. */
function namesOutput(c: CommitRecord): string {
  return c.paths.length === 0 ? '' : c.paths.join(NUL) + NUL;
}

describe('parseRevList', () => {
  it('reads one sha per line and ignores blank lines', () => {
    expect(parseRevList(`${'1'.repeat(40)}\n${'2'.repeat(40)}\n\n`)).toEqual([
      '1'.repeat(40),
      '2'.repeat(40),
    ]);
    expect(parseRevList('')).toEqual([]);
  });

  it('RAISES on anything that is not a sha — an unreadable answer is not an empty one', () => {
    expect(() => parseRevList('fatal: bad revision\n')).toThrow(/not a commit sha/);
    expect(() => parseRevList('zzzz\n')).toThrow(/not a commit sha/);
  });
});

describe('parseCommitHeader', () => {
  it('keeps a multi-line message with trailers intact', () => {
    const c = commit({ message: 'one\n\nCo-Authored-By: X <x@y.z>\n' });
    const parsed = parseCommitHeader(c.sha, headerOutput(c));
    expect(parsed.authorEmail).toBe(c.authorEmail);
    expect(parsed.message).toContain('Co-Authored-By: X <x@y.z>');
  });

  it('is immune to a U+001E in the message — the byte that broke the old framing', () => {
    const c = commit({ message: `chore: ratify INV-007${RS}(hidden)\n` });
    const parsed = parseCommitHeader(c.sha, headerOutput(c));
    expect(parsed.message).toContain(RS);
    expect(parsed.committerEmail).toBe(c.committerEmail);
  });

  it('is immune to a NUL in the message: everything past the 4th separator is the message', () => {
    const c = commit({ message: `chore${NUL}bump${NUL}.program/invariants.yaml` });
    const parsed = parseCommitHeader(c.sha, headerOutput(c));
    expect(parsed.message).toBe(c.message);
    expect(parsed.authorName).toBe(c.authorName);
  });

  it('RAISES when git returns fewer than the four identity separators', () => {
    expect(() => parseCommitHeader('abc', 'Amr' + NUL + 'amr@example.com')).toThrow(
      /identity separators/,
    );
    expect(() => parseCommitHeader('abc', '')).toThrow(/identity separators/);
  });
});

describe('parseNulPaths', () => {
  it('reads git -z output, which is NUL-terminated and never quoted', () => {
    expect(parseNulPaths(`.program/charter.md${NUL}src/a.ts${NUL}`)).toEqual([
      '.program/charter.md',
      'src/a.ts',
    ]);
  });

  it('reads a commit that touched nothing as no paths', () => {
    expect(parseNulPaths('')).toEqual([]);
    expect(parseNulPaths('\n')).toEqual([]);
  });

  it('passes a path with a quote or a backslash through verbatim — -z does not escape', () => {
    expect(parseNulPaths(`src/we"ird.ts${NUL}src/back\\slash.ts${NUL}`)).toEqual([
      'src/we"ird.ts',
      'src/back\\slash.ts',
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// The shell, driven through GitPort: planWalk, readCommits, and the exit-code contract
// ────────────────────────────────────────────────────────────────────────────────────────

/**
 * A git that never ran. Each entry is matched by the FIRST argument plus, for `show`, whether
 * the invocation asked for names or for the header — which is exactly how the real shell
 * distinguishes its two calls per commit.
 */
function fakeGit(repo: {
  readonly resolve?: Readonly<Record<string, string | null>>;
  readonly roots?: readonly string[];
  readonly revList?: readonly string[];
  readonly commits?: Readonly<Record<string, CommitRecord>>;
  readonly fail?: readonly string[];
}): GitPort & { readonly calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run(args) {
      calls.push([...args]);
      const joined = args.join(' ');
      for (const f of repo.fail ?? []) {
        if (joined.includes(f)) throw new Error(`fake git refused: ${joined}`);
      }
      if (args[0] === 'rev-parse') {
        const rev = (args[3] ?? '').replace(/\^\{commit\}$/, '');
        const hit = repo.resolve?.[rev];
        if (hit === undefined || hit === null) throw new Error(`unknown revision ${rev}`);
        return hit + '\n';
      }
      if (args[0] === 'rev-list' && args[1] === '--max-parents=0') {
        return (repo.roots ?? []).join('\n') + '\n';
      }
      if (args[0] === 'rev-list') {
        return (repo.revList ?? []).join('\n') + '\n';
      }
      if (args[0] === 'show') {
        const sha = args.find((a) => /^[0-9a-f]{7,64}$/.test(a)) ?? '';
        const c = repo.commits?.[sha];
        if (c === undefined) throw new Error(`fake git has no commit ${sha}`);
        return args.includes('--name-only') ? namesOutput(c) : headerOutput(c);
      }
      throw new Error(`fake git does not implement: ${joined}`);
    },
  };
}

const HEAD_SHA = 'f'.repeat(40);
const BASE_SHA = '0'.repeat(39) + '1';

describe('planWalk', () => {
  it('walks base..head when both resolve', () => {
    const port = fakeGit({ resolve: { HEAD: HEAD_SHA, 'origin/main': BASE_SHA } });
    const plan = planWalk({ baseRev: 'origin/main', headRev: 'HEAD', source: 'test' }, port);
    expect(plan.kind).toBe('range');
    expect(plan.label).toContain('origin/main..HEAD');
  });

  it('degrades to the single ROOT commit when the base is missing and HEAD is a root', () => {
    const port = fakeGit({ resolve: { HEAD: HEAD_SHA }, roots: [HEAD_SHA] });
    const plan = planWalk({ baseRev: 'origin/main', headRev: 'HEAD', source: 'test' }, port);
    expect(plan.kind).toBe('single');
  });

  it('RAISES on an unresolvable base when HEAD is NOT a root — the shallow-clone case', () => {
    const port = fakeGit({ resolve: { HEAD: HEAD_SHA }, roots: ['9'.repeat(40)] });
    expect(() =>
      planWalk({ baseRev: 'origin/main', headRev: 'HEAD', source: 'test' }, port),
    ).toThrow(/shallow clone/);
  });

  it('RAISES when HEAD itself does not resolve', () => {
    const port = fakeGit({ resolve: {} });
    expect(() => planWalk({ baseRev: null, headRev: 'HEAD', source: 'test' }, port)).toThrow(
      /head revision/,
    );
  });
});

describe('readCommits', () => {
  it('asks git for each sha separately — two calls per commit, no shared framing', () => {
    const a = commit({ sha: '1'.repeat(40), paths: ['src/a.ts'] });
    const b = commit({ ...BOT, sha: '2'.repeat(40), paths: ['.program/charter.md'] });
    const port = fakeGit({
      revList: [a.sha, b.sha],
      commits: { [a.sha]: a, [b.sha]: b },
    });
    const commits = readCommits(
      { kind: 'range', base: BASE_SHA, head: HEAD_SHA, label: 'x' },
      port,
    );
    expect(commits.map((c) => c.sha)).toEqual([a.sha, b.sha]);
    expect(commits[1]?.paths).toEqual(['.program/charter.md']);
    expect(port.calls.filter((c) => c[0] === 'show')).toHaveLength(4);
  });

  it('reads exactly one commit for a single-commit plan', () => {
    const a = commit({ sha: '1'.repeat(40) });
    const port = fakeGit({ commits: { [a.sha]: a } });
    const commits = readCommits({ kind: 'single', head: a.sha, label: 'x', note: 'y' }, port);
    expect(commits).toHaveLength(1);
    expect(port.calls.some((c) => c[0] === 'rev-list')).toBe(false);
  });
});

describe('main() exit codes — 0 clean · 1 violated · 2 could not look', () => {
  const drive = (
    argv: readonly string[],
    env: NodeJS.ProcessEnv,
    port: GitPort,
  ): { code: number; out: string; err: string } => {
    const out: string[] = [];
    const err: string[] = [];
    const so = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
      out.push(String(c));
      return true;
    });
    const se = vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
      err.push(String(c));
      return true;
    });
    try {
      return { code: main(argv, env, '/nowhere', port), out: out.join(''), err: err.join('') };
    } finally {
      so.mockRestore();
      se.mockRestore();
    }
  };

  const RANGE = ['--range', `${BASE_SHA}..${HEAD_SHA}`];
  const resolve = { [BASE_SHA]: BASE_SHA, [HEAD_SHA]: HEAD_SHA };

  it('exits 0 when a human wrote to .program/', () => {
    const c = commit({ sha: '1'.repeat(40), paths: ['.program/charter.md'] });
    const r = drive(RANGE, {}, fakeGit({ resolve, revList: [c.sha], commits: { [c.sha]: c } }));
    expect(r.code).toBe(0);
    expect(r.out).toContain('INV-001 OK');
    expect(r.out).toContain('1 touched .program/');
  });

  it('exits 0 on an empty range', () => {
    const r = drive(RANGE, {}, fakeGit({ resolve, revList: [] }));
    expect(r.code).toBe(0);
    expect(r.out).toContain('nothing to check');
  });

  it('exits 1 when a bot wrote to .program/, and names the rule on stderr', () => {
    const c = commit({ ...BOT, sha: '2'.repeat(40), paths: ['.program/invariants.yaml'] });
    const r = drive(RANGE, {}, fakeGit({ resolve, revList: [c.sha], commits: { [c.sha]: c } }));
    expect(r.code).toBe(1);
    expect(r.err).toContain('INV-001 VIOLATED');
    expect(r.err).toContain('github-app-bot-noreply');
    expect(r.err).toContain('.program/invariants.yaml');
  });

  it('exits 1 END TO END for the U+001E evasion the old framing let through', () => {
    // Byte for byte the auditor's attack: the same bot, the same `.program/` write, one
    // U+001E in the commit message. Under the old cross-record framing this reported
    // `paths: []` and exit 0.
    const c = commit({
      ...BOT,
      sha: '3'.repeat(40),
      message: `chore: ratify INV-007${RS}(hidden)\n`,
      paths: ['.program/invariants.yaml'],
    });
    const r = drive(RANGE, {}, fakeGit({ resolve, revList: [c.sha], commits: { [c.sha]: c } }));
    expect(r.code).toBe(1);
    expect(r.err).toContain('.program/invariants.yaml');
  });

  it('exits 1 for the NUL evasion too', () => {
    const c = commit({
      ...BOT,
      sha: '4'.repeat(40),
      message: `chore${NUL}bump`,
      paths: ['.program/scope.yaml'],
    });
    const r = drive(RANGE, {}, fakeGit({ resolve, revList: [c.sha], commits: { [c.sha]: c } }));
    expect(r.code).toBe(1);
    expect(r.err).toContain('.program/scope.yaml');
  });

  it('exits 2 on a shallow clone rather than reporting clean', () => {
    const port = fakeGit({ resolve: { [HEAD_SHA]: HEAD_SHA }, roots: ['9'.repeat(40)] });
    const r = drive(RANGE, {}, port);
    expect(r.code).toBe(2);
    expect(r.err).toContain('shallow clone');
    expect(r.out).toBe('');
  });

  it('exits 2 when git itself fails', () => {
    const r = drive(RANGE, {}, fakeGit({ resolve, revList: [], fail: ['rev-list'] }));
    expect(r.code).toBe(2);
    expect(r.err).toContain('check-inv001:');
  });

  it('exits 2 when git output cannot be framed — never 0', () => {
    const port: GitPort = {
      run(args) {
        if (args[0] === 'rev-parse') return `${args[3]?.replace(/\^\{commit\}$/, '')}\n`;
        if (args[0] === 'rev-list') return `${'1'.repeat(40)}\n`;
        // A truncated header: git answered, but not with four identity separators.
        return args.includes('--name-only') ? '' : 'Amr';
      },
    };
    const r = drive(RANGE, {}, port);
    expect(r.code).toBe(2);
    expect(r.err).toContain('identity separators');
  });

  it('exits 2 on a malformed range rather than falling back to a default', () => {
    expect(drive(['--range', 'a...b'], {}, fakeGit({})).code).toBe(2);
    expect(drive(['--range', 'HEAD'], {}, fakeGit({})).code).toBe(2);
    expect(drive(['--nonsense'], {}, fakeGit({})).code).toBe(2);
  });

  it('exits 0 for --help without touching git', () => {
    const port = fakeGit({});
    const r = drive(['--help'], {}, port);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Exit codes:');
    expect(port.calls).toEqual([]);
  });

  it('announces the root-commit degradation on stderr instead of hiding it', () => {
    const c = commit({ sha: HEAD_SHA, paths: ['.program/charter.md'] });
    const port = fakeGit({
      resolve: { HEAD: HEAD_SHA },
      roots: [HEAD_SHA],
      commits: { [HEAD_SHA]: c },
    });
    const r = drive([], {}, port);
    expect(r.code).toBe(0);
    expect(r.err).toContain("root commit");
  });
});

describe('resolveRangeRequest', () => {
  it('prefers --range over everything', () => {
    const r = resolveRangeRequest(
      { range: 'abc..def' },
      { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'main', GWTP_INV001_RANGE: 'x..y' },
    );
    expect(r).toMatchObject({ baseRev: 'abc', headRev: 'def', source: '--range' });
  });

  it('turns --base into <ref>..HEAD', () => {
    expect(resolveRangeRequest({ base: 'origin/release' }, {})).toMatchObject({
      baseRev: 'origin/release',
      headRev: 'HEAD',
    });
  });

  it('reads GWTP_INV001_RANGE when no flag is given', () => {
    expect(resolveRangeRequest({}, { GWTP_INV001_RANGE: ' abc..def ' })).toMatchObject({
      baseRev: 'abc',
      headRev: 'def',
      source: 'GWTP_INV001_RANGE',
    });
  });

  it('derives origin/<base>..<sha> on a GitHub pull_request', () => {
    expect(
      resolveRangeRequest(
        {},
        { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'main', GITHUB_SHA: 'deadbeef' },
      ),
    ).toMatchObject({ baseRev: 'origin/main', headRev: 'deadbeef' });
  });

  it('falls back to origin/main..HEAD locally', () => {
    expect(resolveRangeRequest({}, {})).toMatchObject({
      baseRev: 'origin/main',
      headRev: 'HEAD',
    });
  });

  it('rejects the three-dot form — symmetric difference is not the PR range', () => {
    expect(() => resolveRangeRequest({ range: 'a...b' }, {})).toThrow(/three-dot/);
  });

  it('rejects a range with a missing endpoint or no `..` at all', () => {
    expect(() => resolveRangeRequest({ range: 'HEAD' }, {})).toThrow(/<base>\.\.<head>/);
    expect(() => resolveRangeRequest({ range: '..HEAD' }, {})).toThrow(/endpoint/);
    expect(() => resolveRangeRequest({ range: 'HEAD..' }, {})).toThrow(/endpoint/);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// Whole-range behaviour
// ────────────────────────────────────────────────────────────────────────────────────────

describe('findInv001Violations over a mixed range', () => {
  it('reports every offending commit and leaves the innocent ones alone', () => {
    const commits = [
      commit({ sha: '1'.repeat(40), paths: ['.program/charter.md'] }), // human, program → ok
      commit({ ...BOT, sha: '2'.repeat(40), paths: ['src/cli/index.ts'] }), // bot, code → ok
      commit({ ...BOT, sha: '3'.repeat(40), paths: ['.program/invariants.yaml'] }), // → VIOLATION
      commit({
        sha: '4'.repeat(40),
        message: 'x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n',
        paths: ['.program/manifest.yaml', 'src/core/program.ts'],
      }), // → VIOLATION
    ];
    const violations = findInv001Violations(commits);
    expect(violations.map((v) => v.commit.sha)).toEqual(['3'.repeat(40), '4'.repeat(40)]);
    expect(violations[1]?.programPaths).toEqual(['.program/manifest.yaml']);
  });

  it('is order-independent and free of cross-commit state', () => {
    const clean = commit({ paths: ['src/a.ts'], ...BOT });
    const dirty = commit({ ...BOT, sha: 'b'.repeat(40), paths: ['.program/x.yaml'] });
    expect(findInv001Violations([clean, dirty]).map((v) => v.commit.sha)).toEqual([dirty.sha]);
    expect(findInv001Violations([dirty, clean]).map((v) => v.commit.sha)).toEqual([dirty.sha]);
  });
});
