// Implements: docs/spec/06-upkeep.md §2.2 (versioning: which tag is latest, and what the next
// version should be, read from the commits since). Pure.
//
// The bump is a SUGGESTION carried by an in-tree finding, never an action: choosing a version
// is a human's call (or a reviewed PR's), and a scheduled job that bumped versions on its own
// would be the machine writing the tree. Conventional-commit subjects are read when present;
// the rest fall back to a verb heuristic so a repository that never adopted the convention —
// this one, mostly — still gets a defensible suggestion with its reasons attached.

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | null;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemVer(raw: string): SemVer | null {
  const m = SEMVER.exec(raw.trim());
  if (m === null) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

export function formatSemVer(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}${v.prerelease !== null ? `-${v.prerelease}` : ''}`;
}

/** semver §11 precedence, simplified for prereleases to a string compare of the identifier. */
export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

/** `v1.2.3` with prefix `v` → 1.2.3; anything else → null. */
export function tagVersion(tag: string, prefix: string): SemVer | null {
  if (!tag.startsWith(prefix)) return null;
  return parseSemVer(tag.slice(prefix.length));
}

export interface VersionedTag {
  readonly tag: string;
  readonly version: SemVer;
}

/** Semver tags only, ascending by precedence. Non-semver tags are ignored, not errors. */
export function semverTags(tags: readonly string[], prefix: string): readonly VersionedTag[] {
  const out: VersionedTag[] = [];
  for (const tag of tags) {
    const version = tagVersion(tag, prefix);
    if (version !== null) out.push({ tag, version });
  }
  return out.sort((a, b) => compareSemVer(a.version, b.version));
}

export type Bump = 'major' | 'minor' | 'patch';

const RANK: Readonly<Record<Bump, number>> = { patch: 0, minor: 1, major: 2 };

const CONVENTIONAL = /^(\w+)(?:\([^)]*\))?(!)?:\s/;

const MINOR_TYPES = new Set(['feat']);
const MINOR_VERBS = /^(add|adds|added|build|builds|implement|implements|introduce|introduces|create|creates|support|supports|enable|enables|new)\b/i;

/** The bump one commit subject implies. `null` for subjects that ship nothing (merges, reverts of nothing). */
export function classifyCommit(subject: string, breaking: boolean): Bump | null {
  if (/^Merge (pull request|branch|remote-tracking)/.test(subject)) return null;
  const m = CONVENTIONAL.exec(subject);
  if (breaking || m?.[2] === '!') return 'major';
  if (m !== null) return MINOR_TYPES.has((m[1] as string).toLowerCase()) ? 'minor' : 'patch';
  return MINOR_VERBS.test(subject) ? 'minor' : 'patch';
}

export interface BumpSuggestion {
  readonly bump: Bump;
  readonly next: SemVer;
  /** The subjects that decided it — what a reviewer checks before accepting the suggestion. */
  readonly because: readonly string[];
}

/**
 * The largest bump any commit implies. Below 1.0.0 a breaking change bumps MINOR (semver §4:
 * "anything MAY change at any time" — the convention is that 0.x minor carries breaks).
 */
export function suggestBump(
  current: SemVer,
  commits: readonly { readonly subject: string; readonly breaking: boolean }[],
): BumpSuggestion | null {
  let best: Bump | null = null;
  const because: string[] = [];
  for (const c of commits) {
    const b = classifyCommit(c.subject, c.breaking);
    if (b === null) continue;
    if (best === null || RANK[b] > RANK[best]) {
      best = b;
      because.length = 0;
    }
    if (b === best && because.length < 3) because.push(c.subject);
  }
  if (best === null) return null;

  let effective = best;
  if (current.major === 0 && best === 'major') effective = 'minor';

  const next: SemVer =
    effective === 'major'
      ? { major: current.major + 1, minor: 0, patch: 0, prerelease: null }
      : effective === 'minor'
        ? { major: current.major, minor: current.minor + 1, patch: 0, prerelease: null }
        : { major: current.major, minor: current.minor, patch: current.patch + 1, prerelease: null };
  return { bump: effective, next, because };
}
