#!/usr/bin/env node
// Implements: .program/invariants.yaml INV-001 ("Nothing writes to .program/ except
// human-ratified PRs; machine actors are excluded from the path"),
// docs/spec/01-core-memory.md §1 (two stores, two politics — "mixing them is how you end up
// with bots committing to governance files"), docs/adr/0001-two-store-split.md, and
// seeds/SEED-01-scaffold.md deliverable 3.
//
// INV-001 is `enforcement: deterministic`, `precision: 1.0`, `budget: 1.0` — a single breach
// of the constitution's write path fires immediately. So this check is deterministic: no
// model, no heuristics beyond a reviewable pattern list, no network. It reads git and nothing
// else, and it only ever READS git.
//
// Shape of the module (SEED-01 asks for this explicitly): the decision procedure is a pure
// function over already-collected commit records —
//
//     findInv001Violations(commits: readonly CommitRecord[]): readonly Inv001Violation[]
//
// — and everything below `// ── git I/O ──` is a thin shell that fills `CommitRecord`s from
// git and prints the report. The shell talks to git through a `GitPort`, so
// `tests/check-inv001.test.ts` drives BOTH halves — including all three exit codes — with
// recorded git output and no subprocess.
//
// Exit codes: 0 = clean, 1 = INV-001 violated, 2 = the check could not run (bad range,
// shallow clone, git missing, unparseable git output). 2 is distinct from 1 on purpose: "I
// found nothing" and "I could not look" must never be the same signal on a governance check.
//
// FRAMING, AND WHY THERE IS ONE GIT CALL PER COMMIT
//
// The first cut of this file read the whole range with a single
// `git log --format=%x1e%H%x00…%B%x00 --name-only`, splitting records on U+001E and fields on
// NUL. Both separators are inside `%B`, which is text the commit's own author wrote — and git
// keeps them: `git commit`'s cleanup filter is `git stripspace`, which strips trailing
// whitespace and collapses blank lines, and passes U+001E and other control bytes through
// untouched. So the actor this check exists to catch could put one U+001E in its own commit
// message, split its own record in two, lose the `--name-only` tail, and be reported as
// touching no paths at all. Zero violations, and a commit count that still looked right.
//
// The fix is not a better escape: it is to REMOVE cross-record framing. `git rev-list` yields
// the shas (hex, attacker-proof), then each commit is read on its own, with `%B` LAST in its
// own invocation — so a control byte in a message can only corrupt the message it is in, and
// the path list arrives from a separate `-z` call where git itself does the NUL-terminating.
// A commit whose header does not yield its four identity fields is a framing FAILURE and
// raises, i.e. exit 2. It is never silently a commit that touched nothing.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

// ────────────────────────────────────────────────────────────────────────────────────────
// The pure decision procedure
// ────────────────────────────────────────────────────────────────────────────────────────

/**
 * INV-001's scope is the glob `.program/**` — the program store at the repo root, and only
 * there. A nested `vendor/x/.program/` belongs to some other repo's constitution, not ours.
 *
 * `.program` itself (the directory entry, no trailing slash) is not a file git can report as
 * touched, so prefix matching on `.program/` is exactly the glob.
 */
export const PROGRAM_PATH_PREFIX = '.program/';

/** Which identity field a pattern is matched against. */
export type ActorField = 'email' | 'name';

export interface MachineActorPattern {
  /** Stable id, quoted in the failure report so a reviewer can find the rule that fired. */
  readonly id: string;
  readonly field: ActorField;
  readonly pattern: RegExp;
  /** Why this pattern is here. Reviewed as law, not as code — keep it truthful. */
  readonly why: string;
}

/**
 * The whole of machine-actor detection, in one exported const so it is reviewable as a list
 * rather than archaeology across a function body. Adding an entry here widens who is barred
 * from `.program/`; a reviewer should be able to read the diff and know exactly that.
 *
 * Deliberately CONSERVATIVE in both directions:
 *   - No generic `/bot/` substring rule. `robotics@…`, `Abbott`, `talbot@…` are people.
 *     Every entry below matches a full address, a full domain, or the literal `[bot]`
 *     convention — never a bare substring.
 *   - Matching is anchored and case-insensitive; git identities are compared after trimming.
 *     Email comparison ignores case even in the local part: forges do, and an attacker
 *     spelling `Actions@GitHub.com` is not a new actor.
 */
export const MACHINE_ACTOR_PATTERNS: readonly MachineActorPattern[] = [
  {
    id: 'github-app-bot-noreply',
    field: 'email',
    pattern: /^[^@\s]*\[bot\]@users\.noreply\.github\.com$/i,
    why:
      'GitHub Apps and the Actions bot commit as "<numeric-id>+<app-slug>[bot]@users.noreply.github.com" — ' +
      'github-actions[bot], dependabot[bot], renovate[bot]. The `[bot]` local-part suffix is the ' +
      'discriminator: a human on the same domain (e.g. "bamr87@users.noreply.github.com") is NOT matched, ' +
      'because humans commit under exactly that domain all day long.',
  },
  {
    id: 'bots-noreply-domain',
    field: 'email',
    pattern: /@bots\.noreply\.github\.com$/i,
    why:
      'The dedicated bot no-reply domain. Unlike users.noreply.github.com there is no human on it, ' +
      'so the entire domain matches regardless of local part.',
  },
  {
    id: 'github-actions-default-committer',
    field: 'email',
    pattern: /^actions@github\.com$/i,
    why:
      'The identity a workflow is conventionally told to configure before committing with GITHUB_TOKEN ' +
      '(`git config user.email actions@github.com`). It is CI writing, whatever name it wears.',
  },
  {
    id: 'anthropic-noreply',
    field: 'email',
    pattern: /^noreply@anthropic\.com$/i,
    why:
      'Claude Code signs its work with this address, as commit author or as a Co-Authored-By trailer. ' +
      'An agent session is a machine actor: it may propose an amendment ' +
      '(proposals/PROPOSED-program-amendment.md), it may not enact one.',
  },
  {
    id: 'bot-suffixed-name',
    field: 'name',
    pattern: /\[bot\]$/i,
    why:
      'The forge-independent convention: a display name ending in "[bot]". This is the backstop that ' +
      'catches a bot committing under an arbitrary email — the email patterns above all assume GitHub. ' +
      'Case-insensitive on purpose; "[BOT]" is the same claim.',
  },
];

/** Whose hands a commit passed through. */
export type ActorRole = 'author' | 'committer' | 'co-authored-by';

export interface Actor {
  readonly role: ActorRole;
  readonly name: string;
  readonly email: string;
}

export interface MachineActorMatch {
  readonly actor: Actor;
  /** `MachineActorPattern.id` that fired. */
  readonly patternId: string;
  /** The exact field value that matched, for the report. */
  readonly value: string;
  readonly field: ActorField;
}

/**
 * One commit, as much of it as INV-001 needs. Deliberately a plain data record with no git
 * types in it: the pure half of this module must be constructible from a test fixture.
 */
export interface CommitRecord {
  readonly sha: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly committerName: string;
  readonly committerEmail: string;
  /** Raw commit message, trailers included — that is where Co-Authored-By hides. */
  readonly message: string;
  /** Repo-relative paths the commit touched (POSIX separators). */
  readonly paths: readonly string[];
}

export interface Inv001Violation {
  readonly commit: CommitRecord;
  /** The subset of `commit.paths` under `.program/`. Non-empty by construction. */
  readonly programPaths: readonly string[];
  /** Why this commit counts as machine-written. Non-empty by construction. */
  readonly machineActors: readonly MachineActorMatch[];
}

export function isProgramPath(path: string): boolean {
  // git reports POSIX separators and repo-relative paths; normalize the two shapes that a
  // hand-written fixture or a Windows-ish caller might still hand us.
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized.startsWith(PROGRAM_PATH_PREFIX);
}

/** `Some One <some@one.example>` → `{name, email}`; a bare name keeps an empty email. */
function parseIdentity(raw: string, role: ActorRole): Actor {
  const m = /^(.*?)\s*<([^>]*)>\s*$/.exec(raw.trim());
  if (m === null) return { role, name: raw.trim(), email: '' };
  return { role, name: (m[1] ?? '').trim(), email: (m[2] ?? '').trim() };
}

/**
 * Co-Authored-By trailers, per the git trailer convention and the one Claude Code emits.
 *
 * Matched on any line of the message, case-insensitively, because trailer casing in the wild
 * is inconsistent ("Co-authored-by", "Co-Authored-By"). A commit a human pushed but an agent
 * wrote carries the agent in a trailer and a human in the author field — INV-001 excludes the
 * machine actor from the path, and a trailer is the machine actor saying so itself.
 *
 * Known gap, stated rather than papered over: `Signed-off-by:` and `On-Behalf-Of:` are NOT
 * treated as authorship. Sign-off is an attestation, not a write.
 */
export function parseCoAuthors(message: string): readonly Actor[] {
  const out: Actor[] = [];
  for (const line of message.split(/\r?\n/)) {
    const m = /^\s*co-authored-by\s*:\s*(.+?)\s*$/i.exec(line);
    if (m === null) continue;
    const value = m[1];
    if (value === undefined || value.length === 0) continue;
    out.push(parseIdentity(value, 'co-authored-by'));
  }
  return out;
}

/** Author, committer, and every Co-Authored-By trailer — in report order. */
export function actorsOf(commit: CommitRecord): readonly Actor[] {
  return [
    { role: 'author', name: commit.authorName, email: commit.authorEmail },
    { role: 'committer', name: commit.committerName, email: commit.committerEmail },
    ...parseCoAuthors(commit.message),
  ];
}

/** Every (actor, pattern) pair that fires. Empty means: as far as INV-001 can tell, a human. */
export function machineActorMatches(commit: CommitRecord): readonly MachineActorMatch[] {
  const matches: MachineActorMatch[] = [];
  for (const actor of actorsOf(commit)) {
    for (const p of MACHINE_ACTOR_PATTERNS) {
      const value = (p.field === 'email' ? actor.email : actor.name).trim();
      if (value.length === 0) continue;
      if (p.pattern.test(value)) {
        matches.push({ actor, patternId: p.id, value, field: p.field });
      }
    }
  }
  return matches;
}

/**
 * THE CHECK. A commit violates INV-001 when it touches `.program/**` AND any of its actors
 * is a machine. Both halves are required: a bot touching `src/**` is the whole point of the
 * project, and a human touching `.program/**` is the only sanctioned way that path changes.
 *
 * Pure: no git, no fs, no clock, no env. Same input, same violations, forever.
 */
export function findInv001Violations(
  commits: readonly CommitRecord[],
): readonly Inv001Violation[] {
  const violations: Inv001Violation[] = [];
  for (const commit of commits) {
    const programPaths = commit.paths.filter(isProgramPath);
    if (programPaths.length === 0) continue;
    const machineActors = machineActorMatches(commit);
    if (machineActors.length === 0) continue;
    violations.push({ commit, programPaths, machineActors });
  }
  return violations;
}

const shortSha = (sha: string): string => (sha.length > 12 ? sha.slice(0, 12) : sha);

/** Human-readable report. One block per offending commit; every path and every reason named. */
export function formatViolations(violations: readonly Inv001Violation[]): string {
  const lines: string[] = [];
  for (const v of violations) {
    const c = v.commit;
    lines.push(`  commit ${shortSha(c.sha)}  (${c.sha})`);
    lines.push(`    author     ${c.authorName} <${c.authorEmail}>`);
    lines.push(`    committer  ${c.committerName} <${c.committerEmail}>`);
    lines.push('    machine actor(s):');
    for (const m of v.machineActors) {
      lines.push(`      - ${m.actor.role} ${m.field} ${JSON.stringify(m.value)} matches ${m.patternId}`);
    }
    lines.push('    .program/ paths written:');
    for (const p of v.programPaths) lines.push(`      - ${p}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────────────────
// git I/O — the thin shell. Read-only git, always.
// ────────────────────────────────────────────────────────────────────────────────────────

const FIELD_SEP = '\u0000';

/**
 * The identity header for ONE commit, `%B` last.
 *
 * `%an %ae %cn %ce` cannot contain NUL or a newline: git's ident parser rejects both when the
 * object is written, so the first four fields are framed by separators that cannot appear
 * inside them. `%B` is the only attacker-controlled field and it is LAST, so whatever it
 * contains — U+001E, NUL, the text of this comment — it is simply the remainder.
 */
const HEADER_FORMAT = '%an%x00%ae%x00%cn%x00%ce%x00%B';

/**
 * The touched-path list for ONE commit, NUL-terminated by git rather than by us.
 *
 * `-c` makes MERGE commits report their combined diff — the files changed relative to ALL
 * parents, i.e. the evil-merge / conflict-resolution content the merge itself introduced.
 * Without it git reports no paths at all for a merge, and a bot could smuggle a `.program/`
 * edit through a conflict resolution.
 *
 * `--no-renames` so a rename OUT of `.program/` shows both the delete and the add. With rename
 * detection on, only the destination path is reported, and moving the charter out of the
 * program store would look like a change to some innocent file.
 *
 * `-z` means git NUL-terminates each path and never applies its C-style quoting, so a path
 * containing a quote, a backslash or a newline arrives verbatim and there is nothing to
 * unescape — one fewer parser between a governance check and the truth.
 */
const NAMES_FLAGS = ['-c', '--no-renames', '--name-only', '-z', '--format='];

export class CheckError extends Error {}

/**
 * Everything this check needs from git, as a port. `main()` takes one, so the whole shell —
 * range resolution, planning, reading, reporting and the exit code — is drivable from recorded
 * output with no subprocess and no fixture repository. A governance check whose "could not
 * look" path can only be tested by building repositories is a governance check nobody tests.
 */
export interface GitPort {
  /** Runs read-only git. MUST throw (any error) when git fails. */
  run(args: readonly string[]): string;
}

export function execGitPort(cwd: string): GitPort {
  return {
    run(args) {
      try {
        return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
          cwd,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) {
        const err = e as { status?: number; stderr?: string; message?: string };
        throw new CheckError(
          `git ${args.join(' ')} failed${err.status === undefined ? '' : ` (exit ${err.status})`}: ` +
            `${(err.stderr ?? err.message ?? '').toString().trim()}`,
        );
      }
    },
  };
}

function git(port: GitPort, args: readonly string[]): string {
  try {
    return port.run(args);
  } catch (e) {
    if (e instanceof CheckError) throw e;
    throw new CheckError(`git ${args.join(' ')} failed: ${(e as Error).message}`);
  }
}

/** `null` when the rev does not resolve to a commit in this clone. Never throws. */
function revParse(port: GitPort, rev: string): string | null {
  try {
    return git(port, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).trim() || null;
  } catch {
    return null;
  }
}

// ── The three pure parsers. One commit in, one commit out; no cross-record framing. ────────

const SHA_RE = /^[0-9a-f]{7,64}$/;

/**
 * `git rev-list` output: one 40-hex sha per line, newest first. Hex, so nothing an author
 * writes can appear here — which is exactly why the walk is driven from this list rather than
 * from a framed log.
 *
 * Anything that is not a sha raises: an unrecognized line means git said something this parser
 * does not understand, and the only safe reading of that is "could not look".
 */
export function parseRevList(raw: string): readonly string[] {
  const shas: string[] = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (s.length === 0) continue;
    if (!SHA_RE.test(s)) {
      throw new CheckError(
        `git rev-list produced a line that is not a commit sha: ${JSON.stringify(s.slice(0, 80))}`,
      );
    }
    shas.push(s);
  }
  return shas;
}

/**
 * One commit's `HEADER_FORMAT` output. Splits on the FIRST FOUR NULs only; everything after
 * the fourth is the message, NULs and all.
 *
 * Fewer than four NULs is a framing failure and RAISES. That is the whole point of the
 * rewrite: the old parser degraded a malformed record into `paths: []`, which reads as
 * "touched nothing", which reads as "clean". A check must fail loud, never quiet.
 */
export function parseCommitHeader(sha: string, raw: string): Omit<CommitRecord, 'paths'> {
  const fields: string[] = [];
  let rest = raw;
  for (let i = 0; i < 4; i += 1) {
    const at = rest.indexOf(FIELD_SEP);
    if (at === -1) {
      throw new CheckError(
        `commit ${sha}: git returned ${i} of the 4 identity separators expected from ` +
          `\`--format=${HEADER_FORMAT}\`. Refusing to guess at a commit's authorship.`,
      );
    }
    fields.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  return {
    sha,
    authorName: (fields[0] ?? '').trim(),
    authorEmail: (fields[1] ?? '').trim(),
    committerName: (fields[2] ?? '').trim(),
    committerEmail: (fields[3] ?? '').trim(),
    // `%B` is followed by nothing; git appends a trailing newline to the whole invocation.
    message: rest.replace(/\n$/, ''),
  };
}

/** One commit's `-z --name-only` output: NUL-terminated, unquoted, possibly empty. */
export function parseNulPaths(raw: string): readonly string[] {
  return raw
    .split(FIELD_SEP)
    .map((s) => s.replace(/^\n+/, '').trim())
    .filter((s) => s.length > 0);
}

export interface RangeRequest {
  readonly baseRev: string | null;
  readonly headRev: string;
  /** Where the range came from, echoed in the report so CI output is self-explaining. */
  readonly source: string;
}

const ZERO_SHA = '0000000000000000000000000000000000000000';

/**
 * Precedence, highest first:
 *   1. `--range <a>..<b>`
 *   2. `--base <ref>`            → `<ref>..HEAD`
 *   3. `$GWTP_INV001_RANGE`      → `<a>..<b>` (how .github/workflows/ci.yml passes a push range)
 *   4. GitHub Actions pull_request: `origin/$GITHUB_BASE_REF..$GITHUB_SHA`
 *   5. GitHub Actions push:      `<event.before>..$GITHUB_SHA` from $GITHUB_EVENT_PATH
 *   6. `origin/main..HEAD`       (local default)
 */
export function resolveRangeRequest(
  flags: { readonly range?: string | undefined; readonly base?: string | undefined },
  env: NodeJS.ProcessEnv,
): RangeRequest {
  const fromRangeString = (spec: string, source: string): RangeRequest => {
    if (spec.includes('...')) {
      throw new CheckError(
        `range ${JSON.stringify(spec)} uses the three-dot form. ` +
          '`git log a...b` is the symmetric difference, which would drag in commits from the ' +
          'base branch that this PR never touched. Use `a..b`.',
      );
    }
    const i = spec.indexOf('..');
    if (i === -1) {
      throw new CheckError(`range ${JSON.stringify(spec)} is not of the form <base>..<head>`);
    }
    const baseRev = spec.slice(0, i);
    const headRev = spec.slice(i + 2);
    if (baseRev.length === 0 || headRev.length === 0) {
      throw new CheckError(`range ${JSON.stringify(spec)} is missing an endpoint`);
    }
    return { baseRev, headRev, source };
  };

  if (flags.range !== undefined) return fromRangeString(flags.range, '--range');
  if (flags.base !== undefined) {
    return { baseRev: flags.base, headRev: 'HEAD', source: '--base' };
  }

  const envRange = env['GWTP_INV001_RANGE'];
  if (envRange !== undefined && envRange.trim().length > 0) {
    return fromRangeString(envRange.trim(), 'GWTP_INV001_RANGE');
  }

  if (env['GITHUB_ACTIONS'] === 'true') {
    const head = env['GITHUB_SHA'] ?? 'HEAD';
    const baseRef = env['GITHUB_BASE_REF'];
    if (baseRef !== undefined && baseRef.trim().length > 0) {
      // pull_request / pull_request_target: GITHUB_BASE_REF is the target BRANCH NAME.
      return {
        baseRev: `origin/${baseRef.trim()}`,
        headRev: head,
        source: `GitHub Actions pull_request (GITHUB_BASE_REF=${baseRef.trim()})`,
      };
    }
    const before = readPushBeforeSha(env);
    if (before !== null) {
      return { baseRev: before, headRev: head, source: 'GitHub Actions push (event.before)' };
    }
    return { baseRev: null, headRev: head, source: 'GitHub Actions (no base available)' };
  }

  return { baseRev: 'origin/main', headRev: 'HEAD', source: 'default (origin/main..HEAD)' };
}

/** `event.before` from the webhook payload; `null` for a branch-creation push (all zeros). */
function readPushBeforeSha(env: NodeJS.ProcessEnv): string | null {
  const path = env['GITHUB_EVENT_PATH'];
  if (path === undefined || path.length === 0) return null;
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8')) as { before?: unknown };
    const before = payload.before;
    if (typeof before !== 'string' || before.length === 0 || before === ZERO_SHA) return null;
    return before;
  } catch {
    return null;
  }
}

export type Plan =
  | { readonly kind: 'range'; readonly base: string; readonly head: string; readonly label: string }
  | { readonly kind: 'single'; readonly head: string; readonly label: string; readonly note: string };

/**
 * Turn a requested range into something git can actually walk, or fail loudly.
 *
 * The one degradation allowed: when the base does not resolve AND the head is a ROOT commit,
 * there is no history to compare against and the honest thing is to check that single commit.
 * That is the fresh-repo case (this repository, today: one commit, no `origin/main` yet).
 * Any other unresolvable base is exit 2 — a shallow clone must not read as "clean".
 */
export function planWalk(req: RangeRequest, port: GitPort): Plan {
  const head = revParse(port, req.headRev);
  if (head === null) {
    throw new CheckError(
      `head revision ${JSON.stringify(req.headRev)} does not resolve to a commit (source: ${req.source})`,
    );
  }

  const base = req.baseRev === null ? null : revParse(port, req.baseRev);
  if (base !== null) {
    return {
      kind: 'range',
      base,
      head,
      label: `${req.baseRev}..${req.headRev}  [${shortSha(base)}..${shortSha(head)}]`,
    };
  }

  const parents = parseRevList(git(port, ['rev-list', '--max-parents=0', head]));
  const headIsRoot = parents.includes(head);
  if (headIsRoot) {
    return {
      kind: 'single',
      head,
      label: `${shortSha(head)} (root commit)`,
      note:
        req.baseRev === null
          ? 'no base revision was available'
          : `base ${JSON.stringify(req.baseRev)} does not resolve in this clone`,
    };
  }

  throw new CheckError(
    `base revision ${JSON.stringify(req.baseRev)} does not resolve (source: ${req.source}).\n` +
      '  In CI this usually means a shallow clone — use actions/checkout with `fetch-depth: 0`,\n' +
      '  and fetch the base branch so `origin/<base>` exists.\n' +
      '  Locally, pass `--base <ref>` or `--range <a>..<b>`.',
  );
}

/**
 * Reads the plan's commits, ONE GIT CALL PER COMMIT for the header and one for the paths.
 *
 * That is 2N+1 subprocesses instead of 1, which is the price of having no cross-record
 * framing for an author to break. On the ranges this check actually walks — a PR's commits, a
 * push's commits — N is small, and INV-001 is `precision: 1.0, budget: 1.0`: one breach fires
 * immediately, so the check being right matters more than the check being fast.
 *
 * `--` terminates the rev list so a ref that looks like a path cannot be reinterpreted.
 */
export function readCommits(plan: Plan, port: GitPort): readonly CommitRecord[] {
  const shas =
    plan.kind === 'range'
      ? parseRevList(git(port, ['rev-list', `${plan.base}..${plan.head}`, '--']))
      : [plan.head];

  return shas.map((sha) => {
    const header = git(port, ['show', '--no-patch', `--format=${HEADER_FORMAT}`, sha, '--']);
    const names = git(port, ['show', ...NAMES_FLAGS, sha, '--']);
    return { ...parseCommitHeader(sha, header), paths: parseNulPaths(names) };
  });
}

// ────────────────────────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `check-inv001 — INV-001: nothing writes to .program/ except human-ratified PRs

Usage:
  tsx scripts/check-inv001.ts [--range <base>..<head>] [--base <ref>] [--help]

Range resolution, highest precedence first:
  --range <a>..<b>          explicit
  --base <ref>              <ref>..HEAD
  $GWTP_INV001_RANGE        <a>..<b>
  GitHub Actions            origin/$GITHUB_BASE_REF..$GITHUB_SHA (pull_request),
                            <event.before>..$GITHUB_SHA (push)
  default                   origin/main..HEAD

Exit codes:
  0  no machine actor wrote to .program/ in the range (or the range is empty)
  1  INV-001 violated
  2  the check could not run (bad range, shallow clone, git unavailable)
`;

/**
 * `port` is injectable so the exit-code contract is testable. It defaults to the real thing,
 * so nothing at the command line changes.
 */
export function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  port: GitPort = execGitPort(cwd),
): number {
  let flags: { range?: string | undefined; base?: string | undefined; help?: boolean | undefined };
  try {
    ({ values: flags } = parseArgs({
      args: [...argv],
      options: {
        range: { type: 'string' },
        base: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
      strict: true,
    }));
  } catch (e) {
    process.stderr.write(`check-inv001: ${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }

  if (flags.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }

  let plan: Plan;
  let commits: readonly CommitRecord[];
  try {
    const request = resolveRangeRequest(flags, env);
    plan = planWalk(request, port);
    if (plan.kind === 'single') {
      process.stderr.write(
        `check-inv001: ${plan.note}; HEAD is the repository's root commit, ` +
          'so the root commit itself is what gets checked.\n',
      );
    }
    commits = readCommits(plan, port);
  } catch (e) {
    if (e instanceof CheckError) {
      process.stderr.write(`check-inv001: ${e.message}\n`);
      return 2;
    }
    throw e;
  }

  if (commits.length === 0) {
    process.stdout.write(`check-inv001: range ${plan.label} is empty — nothing to check. INV-001 OK.\n`);
    return 0;
  }

  const violations = findInv001Violations(commits);
  const touched = commits.filter((c) => c.paths.some(isProgramPath)).length;

  if (violations.length === 0) {
    process.stdout.write(
      `check-inv001: ${commits.length} commit(s) in ${plan.label}; ` +
        `${touched} touched .program/; no machine actor among them. INV-001 OK.\n`,
    );
    return 0;
  }

  process.stderr.write(
    `check-inv001: INV-001 VIOLATED — ${violations.length} of ${commits.length} commit(s) in ` +
      `${plan.label} wrote to .program/ under a machine actor.\n\n` +
      formatViolations(violations) +
      '.program/ is the constitution: it changes only through a human-ratified PR ' +
      '(docs/spec/01-core-memory.md §1, ADR-0001).\n' +
      'If an agent produced this change, move it to proposals/PROPOSED-program-amendment.md ' +
      'and let a human apply it.\n',
  );
  return 1;
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return entry.endsWith('check-inv001.ts') || entry.endsWith('check-inv001.js');
}

if (isEntryPoint()) {
  process.exitCode = main(process.argv.slice(2), process.env, process.cwd());
}
