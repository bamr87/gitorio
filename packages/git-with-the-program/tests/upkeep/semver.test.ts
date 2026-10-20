// Implements tests for: docs/spec/06-upkeep.md §2.2 — tag precedence and the bump suggestion
// that versioning findings carry (src/upkeep/semver.ts).

import { describe, expect, it } from 'vitest';

import {
  classifyCommit,
  compareSemVer,
  formatSemVer,
  parseSemVer,
  semverTags,
  suggestBump,
} from '../../src/upkeep/semver.js';

const v = (s: string) => {
  const p = parseSemVer(s);
  if (p === null) throw new Error(`not semver: ${s}`);
  return p;
};

describe('parse, format, compare', () => {
  it('round-trips and rejects non-semver', () => {
    expect(formatSemVer(v('1.2.3'))).toBe('1.2.3');
    expect(formatSemVer(v('1.2.3-rc.1'))).toBe('1.2.3-rc.1');
    expect(parseSemVer('1.2')).toBeNull();
    expect(parseSemVer('01.2.3')).toBeNull();
  });

  it('orders by precedence, a prerelease below its release', () => {
    expect(compareSemVer(v('1.0.0'), v('0.9.9'))).toBeGreaterThan(0);
    expect(compareSemVer(v('1.0.0-rc.1'), v('1.0.0'))).toBeLessThan(0);
    expect(compareSemVer(v('0.10.0'), v('0.9.0'))).toBeGreaterThan(0);
  });

  it('semverTags keeps only prefixed semver tags, ascending', () => {
    const tags = semverTags(['v0.10.0', 'v0.2.0', 'nightly', '0.3.0', 'v1.0.0-rc.1'], 'v');
    expect(tags.map((t) => t.tag)).toEqual(['v0.2.0', 'v0.10.0', 'v1.0.0-rc.1']);
  });
});

describe('the bump a commit implies', () => {
  it.each([
    ['feat(cli): add upkeep', false, 'minor'],
    ['fix: off-by-one', false, 'patch'],
    ['refactor!: drop the v0 fold', false, 'major'],
    ['chore: tidy', true, 'major'],
    ['Build the judgment ladder: SEED-03', false, 'minor'],
    ['Bump vitest from 4 to 5', false, 'patch'],
    ['Fix brittle assertion', false, 'patch'],
  ] as const)('%s → %s', (subject, breaking, bump) => {
    expect(classifyCommit(subject, breaking)).toBe(bump);
  });

  it('merge commits ship nothing of their own', () => {
    expect(classifyCommit('Merge pull request #4 from x/y', false)).toBeNull();
  });
});

describe('suggestBump', () => {
  it('takes the largest bump and names the commits that decided it', () => {
    const s = suggestBump(v('1.4.2'), [
      { subject: 'fix: a', breaking: false },
      { subject: 'feat: b', breaking: false },
      { subject: 'docs: c', breaking: false },
    ]);
    expect(s?.bump).toBe('minor');
    expect(formatSemVer(s!.next)).toBe('1.5.0');
    expect(s?.because).toEqual(['feat: b']);
  });

  it('below 1.0.0 a breaking change bumps minor, not major', () => {
    const s = suggestBump(v('0.3.1'), [{ subject: 'feat!: new wire format', breaking: false }]);
    expect(s?.bump).toBe('minor');
    expect(formatSemVer(s!.next)).toBe('0.4.0');
  });

  it('at 1.0.0 and above a breaking change bumps major', () => {
    expect(formatSemVer(suggestBump(v('2.1.0'), [{ subject: 'x', breaking: true }])!.next)).toBe('3.0.0');
  });

  it('returns null when nothing ships', () => {
    expect(suggestBump(v('1.0.0'), [{ subject: 'Merge branch main', breaking: false }])).toBeNull();
  });
});
