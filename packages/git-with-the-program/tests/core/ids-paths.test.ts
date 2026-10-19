// Implements tests for: docs/spec/01-core-memory.md §3 & §5 (stable ids), §6 (scope globs),
// docs/spec/02-ledger.md §1-2, and the id patterns in schemas/*.schema.json.

import { describe, expect, it } from 'vitest';
import {
  ASSERTION_ID_PATTERN,
  COMMIT_SHA_PATTERN,
  PRECEDENT_ID_PATTERN,
  SHA256_REF_PATTERN,
  epochOrdinal,
  isCandidateId,
  isInvariantId,
  parseAccumulatorKey,
  parseAssertionId,
  parseCandidateId,
  parseCommitSha,
  parseEpochId,
  parseInvariantId,
  parseJudgeId,
  parsePrecedentId,
  parsePullRequestNumber,
  parseSha256Ref,
  parseTrajectoryId,
  sha256RefHex,
  isAssertionKey,
} from '../../src/core/ids.js';
import {
  globToRegExp,
  matchesGlob,
  matchesScope,
  parsePathGlob,
  parseRepoPath,
  type PathGlob,
  type RepoPath,
} from '../../src/core/paths.js';
import { unwrap } from '../../src/core/result.js';

const glob = (s: string): PathGlob => unwrap(parsePathGlob(s));
const path = (s: string): RepoPath => unwrap(parseRepoPath(s));

describe('id patterns mirror schemas/ verbatim', () => {
  it('assertion id', () => {
    expect(ASSERTION_ID_PATTERN.source).toBe('^(INV|CAND)-[0-9]{3,}$');
  });
  it('precedent id', () => {
    expect(PRECEDENT_ID_PATTERN.source).toBe('^PRE-[0-9]{3,}$');
  });
  it('sha256 ref', () => {
    expect(SHA256_REF_PATTERN.source).toBe('^sha256:[a-f0-9]{64}$');
  });
});

describe('assertion ids', () => {
  it.each(['INV-001', 'CAND-014', 'INV-1234'])('accepts %s', (id) => {
    expect(parseAssertionId(id).ok).toBe(true);
  });

  it.each(['INV-1', 'INV-abc', 'inv-001', 'PRE-001', 'INV_001', '', 'INV-001 ', 42, null])(
    'rejects %p',
    (bad) => {
      expect(parseAssertionId(bad).ok).toBe(false);
    },
  );

  it('separates INV from CAND, which is what pins CAND status to `inferred`', () => {
    const inv = unwrap(parseAssertionId('INV-007'));
    const cand = unwrap(parseAssertionId('CAND-014'));
    expect(isInvariantId(inv)).toBe(true);
    expect(isCandidateId(inv)).toBe(false);
    expect(isInvariantId(cand)).toBe(false);
    expect(isCandidateId(cand)).toBe(true);
  });

  it('narrowing parsers refuse the wrong arm', () => {
    expect(parseInvariantId('CAND-014').ok).toBe(false);
    expect(parseCandidateId('INV-007').ok).toBe(false);
    expect(parseInvariantId('INV-007').ok).toBe(true);
    expect(parseCandidateId('CAND-014').ok).toBe(true);
  });
});

describe('accumulator keys (spec 02 §7 keys stale-claim events by scope claim)', () => {
  it('recognises assertion ids', () => {
    const k = unwrap(parseAccumulatorKey('INV-003'));
    expect(isAssertionKey(k)).toBe(true);
  });

  it('accepts a non-assertion claim key, because event.assertion is an unconstrained string', () => {
    const k = unwrap(parseAccumulatorKey('scope:docs/**'));
    expect(isAssertionKey(k)).toBe(false);
  });

  it.each(['', 'has space', 42, null])('rejects %p', (bad) => {
    expect(parseAccumulatorKey(bad).ok).toBe(false);
  });
});

describe('other ids', () => {
  it('precedent ids', () => {
    expect(parsePrecedentId('PRE-003').ok).toBe(true);
    expect(parsePrecedentId('PRE-3').ok).toBe(false);
    expect(parsePrecedentId('INV-003').ok).toBe(false);
  });

  it('sha256 refs, and strips the prefix', () => {
    const hex = 'a'.repeat(64);
    const ref = unwrap(parseSha256Ref(`sha256:${hex}`));
    expect(sha256RefHex(ref)).toBe(hex);
    expect(parseSha256Ref(`sha256:${'A'.repeat(64)}`).ok).toBe(false);
    expect(parseSha256Ref(`sha1:${hex}`).ok).toBe(false);
    expect(parseSha256Ref(hex).ok).toBe(false);
  });

  it("commit shas accept spec 02 §2's own 6-char example", () => {
    expect(COMMIT_SHA_PATTERN.test('9f2c1d')).toBe(true);
    expect(parseCommitSha('9f2c1d').ok).toBe(true);
    expect(parseCommitSha('abc123').ok).toBe(true);
    expect(parseCommitSha('a'.repeat(40)).ok).toBe(true);
    expect(parseCommitSha('ABC123').ok).toBe(false);
    expect(parseCommitSha('abc').ok).toBe(false);
  });

  it('epoch ids order, because spec 04 §3 recency asymmetry needs it', () => {
    expect(parseEpochId('e0').ok).toBe(true);
    expect(parseEpochId('e6').ok).toBe(true);
    expect(parseEpochId('epoch6').ok).toBe(false);
    expect(epochOrdinal(unwrap(parseEpochId('e6')))).toBe(6);
    expect(epochOrdinal(unwrap(parseEpochId('e0')))).toBe(0);
  });

  it('trajectory ids', () => {
    expect(parseTrajectoryId('TRJ-001').ok).toBe(true);
    expect(parseTrajectoryId('TRJ-1').ok).toBe(false);
  });

  it('judge ids', () => {
    expect(parseJudgeId('invariant-judge').ok).toBe(true);
    expect(parseJudgeId('').ok).toBe(false);
    expect(parseJudgeId('two words').ok).toBe(false);
  });

  it('PR numbers are positive integers', () => {
    expect(parsePullRequestNumber(214).ok).toBe(true);
    expect(parsePullRequestNumber(0).ok).toBe(false);
    expect(parsePullRequestNumber(-1).ok).toBe(false);
    expect(parsePullRequestNumber(2.5).ok).toBe(false);
    expect(parsePullRequestNumber('214').ok).toBe(false);
  });
});

describe('repo paths', () => {
  it.each(['src/core/index.ts', '.program/charter.md', 'a'])('accepts %s', (p) => {
    expect(parseRepoPath(p).ok).toBe(true);
  });

  it.each(['/abs/path', '../escape', './rel', 'a//b', 'a\\b', ''])('rejects %p', (p) => {
    expect(parseRepoPath(p).ok).toBe(false);
  });
});

describe('glob subset (OPEN-QUESTIONS Q-12: ** * ? only)', () => {
  it.each(['src/**', '.program/**', '**/*.ts', 'src/core/*.ts', 'a?c'])('accepts %s', (g) => {
    expect(parsePathGlob(g).ok).toBe(true);
  });

  it.each(['src/{a,b}', '!src/**', 'src/[abc].ts', 'a\\b', ''])(
    'rejects unsupported syntax %p',
    (g) => {
      const r = parsePathGlob(g);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(['invalid-glob', 'wrong-type']).toContain(r.error.code);
    },
  );

  it('`a/**` matches descendants but not `a` itself', () => {
    const g = glob('src/**');
    expect(matchesGlob(g, path('src/core/index.ts'))).toBe(true);
    expect(matchesGlob(g, path('src/cli/commands/validate.ts'))).toBe(true);
    expect(matchesGlob(g, path('src/a.ts'))).toBe(true);
    expect(matchesGlob(g, path('src'))).toBe(false);
    expect(matchesGlob(g, path('docs/spec/01.md'))).toBe(false);
  });

  it('`**/x` spans zero or more whole segments', () => {
    const g = glob('**/*.ts');
    expect(matchesGlob(g, path('a.ts'))).toBe(true);
    expect(matchesGlob(g, path('src/a.ts'))).toBe(true);
    expect(matchesGlob(g, path('src/core/a.ts'))).toBe(true);
    expect(matchesGlob(g, path('src/core/a.js'))).toBe(false);
  });

  it('`*` never crosses a slash', () => {
    const g = glob('src/*.ts');
    expect(matchesGlob(g, path('src/a.ts'))).toBe(true);
    expect(matchesGlob(g, path('src/core/a.ts'))).toBe(false);
  });

  it('`?` matches exactly one non-slash character', () => {
    const g = glob('a?c.ts');
    expect(matchesGlob(g, path('abc.ts'))).toBe(true);
    expect(matchesGlob(g, path('ac.ts'))).toBe(false);
    expect(matchesGlob(g, path('a/c.ts'))).toBe(false);
  });

  it('escapes regex metacharacters in literal segments', () => {
    expect(globToRegExp('.program/**').source).toContain('\\.program');
    expect(matchesGlob(glob('.program/**'), path('.program/charter.md'))).toBe(true);
    expect(matchesGlob(glob('.program/**'), path('Xprogram/charter.md'))).toBe(false);
  });

  it("matches this repo's own shipped scope claims", () => {
    const claims = ['docs/**', 'schemas/**', '.program/**', 'seeds/**', 'prompts/**'].map(glob);
    expect(matchesScope(claims, path('docs/spec/01-core-memory.md'))).toBe(true);
    expect(matchesScope(claims, path('schemas/event.schema.json'))).toBe(true);
    // src/** is NOT yet claimed — that claim is a .program/ amendment (INV-001), proposed in
    // proposals/PROPOSED-program-amendment.md rather than written by this session.
    expect(matchesScope(claims, path('src/core/index.ts'))).toBe(false);
  });

  it("matches this repo's own invariant scopes", () => {
    expect(matchesGlob(glob('src/core/**'), path('src/core/event.ts'))).toBe(true);
    expect(matchesGlob(glob('src/judge/**'), path('src/judge/index.ts'))).toBe(true);
    expect(matchesGlob(glob('src/ledger/**'), path('src/ledger/index.ts'))).toBe(true);
    expect(matchesGlob(glob('src/judge/stub/**'), path('src/judge/index.ts'))).toBe(false);
  });
});
