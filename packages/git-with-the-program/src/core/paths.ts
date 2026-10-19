// Implements: docs/spec/01-core-memory.md §3 (`scope`: "Path globs the assertion governs"),
// §6 (scope.yaml / trajectory `implies_obsolete`), and docs/spec/03-judge.md §3 ("the diff
// hunks intersecting the assertion's scope"). Pure, dependency-free glob matching: no
// picomatch, no minimatch — src/core stays forge-agnostic AND dependency-free (INV-005).

import type { Brand, NonEmptyReadonlyArray } from './brand.js';
import { fail, ok, type Parsed } from './result.js';

/** Repo-relative, POSIX separators, no leading `./` or `/`, no `..` segment. */
export type RepoPath = Brand<string, 'RepoPath'>;

/** An `Assertion.scope` / `scope.yaml` / `implies_obsolete` entry. */
export type PathGlob = Brand<string, 'PathGlob'>;

export function parseRepoPath(raw: unknown, at?: string): Parsed<RepoPath> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string path', at);
  if (raw.length === 0) return fail('invalid-path', 'path must be non-empty', at);
  if (raw.includes('\\')) return fail('invalid-path', 'path must use POSIX separators', at);
  if (raw.startsWith('/')) return fail('invalid-path', 'path must be repo-relative', at);
  const segments = raw.split('/');
  if (segments.some((s) => s === '..' || s === '.' || s === '')) {
    return fail('invalid-path', 'path must not contain empty, `.` or `..` segments', at);
  }
  return ok(raw as RepoPath);
}

/**
 * The supported glob subset, deliberately small (see docs/spec/OPEN-QUESTIONS.md Q-12):
 *   `**` — zero or more whole path segments; `a/**` matches `a/b` and `a/b/c`, not `a`
 *   `*`  — zero or more characters within one segment; never crosses `/`
 *   `?`  — exactly one character, never `/`
 * No braces, no negation, no character classes, no extglob. Anything else is REJECTED at
 * load time, so an unsupported pattern fails loudly rather than silently never matching.
 */
const UNSUPPORTED_GLOB_SYNTAX = /[[\]{}!()|\\]/;

export function parsePathGlob(raw: unknown, at?: string): Parsed<PathGlob> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string glob', at);
  if (raw.length === 0) return fail('invalid-glob', 'glob must be non-empty', at);
  if (UNSUPPORTED_GLOB_SYNTAX.test(raw)) {
    return fail(
      'invalid-glob',
      `glob uses syntax outside the supported subset (** * ?): ${JSON.stringify(raw)}`,
      at,
    );
  }
  return ok(raw as PathGlob);
}

const REGEX_META = /[.+^$]/g;
const globCache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const cached = globCache.get(glob);
  if (cached !== undefined) return cached;

  let out = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const atSegmentStart = i === 0 || glob[i - 1] === '/';
        if (atSegmentStart && glob[i + 2] === '/') {
          // `**/` — zero or more whole segments
          out += '(?:[^/]+/)*';
          i += 3;
          continue;
        }
        if (atSegmentStart && i + 2 === glob.length) {
          // trailing `**` — one or more segments; `a/**` does not match `a`
          out += '.+';
          i += 2;
          continue;
        }
        // `**` in a non-segment position degrades to `*`
        out += '[^/]*';
        i += 2;
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    out += c.replace(REGEX_META, '\\$&');
    i += 1;
  }

  const re = new RegExp(`^${out}$`);
  globCache.set(glob, re);
  return re;
}

export function matchesGlob(glob: PathGlob, path: RepoPath): boolean {
  return globToRegExp(glob).test(path);
}

/** The primitive behind scope intersection (spec 03 §3) and obsolescence sweeps (spec 02 §7). */
export function matchesScope(scope: readonly PathGlob[], path: RepoPath): boolean {
  return scope.some((g) => matchesGlob(g, path));
}

export function scopeIntersects(
  scope: NonEmptyReadonlyArray<PathGlob>,
  paths: readonly RepoPath[],
): boolean {
  return paths.some((p) => matchesScope(scope, p));
}
