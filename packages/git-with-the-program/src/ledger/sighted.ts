// Implements: docs/spec/02-ledger.md §5 (firing: dispersion decides direction — "author
// entropy: how many independent hands", "path entropy: one seam or many call sites"),
// docs/adr/0003-judge-blindness.md ("authorship is used only downstream, in dispersion
// statistics at firing time") and docs/adr/0004-committer-time-decay.md ("events referencing
// rebased-away SHAs are retained and marked orphaned — a rewritten commit is itself
// information").
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  SENTENCING-SIDE MODULE. THIS FILE READS AUTHOR IDENTITY.
//
//  It is the ONLY place in the engine that resolves a git author, and it does so only for
//  events that are already contributing to a firing. Nothing under `src/judge/**` or
//  `src/evidence/**` may import it — directly OR transitively. That is INV-003, and ADR-0003
//  calls a breach "a framework bug of the highest class".
//
//  The boundary is enforced three ways, none of which is a code-review convention:
//    1. `ActorId` is opaque (src/core/sentencing.ts): not a string, so it fits in no string
//       field of any evidence bundle.
//    2. `scripts/check-inv003.ts` fails CI on a value import of `../core/sentencing.js` from a
//       blind directory — and this module's own value import below is exactly that greppable
//       line, sitting on the permitted side of the boundary.
//    3. `tests/ledger/blindness-boundary.test.ts` walks the real import graph and asserts this
//       file is unreachable from every blind file. It is data-driven over the file tree, so it
//       keeps holding as SEED-03 lands actual judges.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Why authorship is re-derived from git rather than read from the ledger: the persisted event
// record has no author field and never will (src/core/event.ts, `EventSubject`). The ledger is
// identity-free storage; identity is a lookup performed once, at firing time, and discarded.
//
// INV-005: git is the substrate, not the forge. `git log` is not a GitHub API, so this module
// stays forge-agnostic. Anything that needs a forge (resolving a PR number to its commits —
// see Q-45) belongs in `src/adapters/github/**` behind a port declared in `src/core`.

import { execFile } from 'node:child_process';

import {
  type CommitSha,
  type CommitterTime,
  type ContractError,
  type Decoded,
  type EventId,
  type EvidenceLocus,
  type LedgerEvent,
  type Parsed,
  type RepoPath,
  err,
  fail,
  normalizeCommitterTime,
  ok,
  parseCommitSha,
  parseCommitterTime,
  parseRepoPath,
} from '../core/index.js';
// The greppable declassification import (INV-003). Legal here, fatal under src/judge/** or
// src/evidence/**. `actorId` TAINTS (string -> ActorId); `revealActor` UNTAINTS and therefore
// takes a `SentencingWarrant` it cannot mint.
import {
  type ActorId,
  type SentencingWarrant,
  type SightedCommit,
  type SightedCommitPort,
  actorId,
  revealActor,
} from '../core/sentencing.js';
import type { GitExec } from './git.js';

// ---------------------------------------------------------------------------
// The git shell — injectable, so nothing in the engine hard-codes a subprocess
// ---------------------------------------------------------------------------

export interface GitOutput {
  /** Process exit code; `-1` when git could not be executed at all (missing binary, timeout). */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The whole of this module's contact with the outside world, in one method. Injectable so the
 * resolver is testable without a repository, and so a caller that already has a git connection
 * (a daemon, a worker, a libgit2 binding) can supply it instead of forking a process.
 */
export interface GitRunner {
  run(args: readonly string[]): Promise<GitOutput>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

/**
 * `git -C <root> …`. Never throws: a non-zero exit and a missing binary both come back as
 * data, because this module sits on the path that decides whether the framework proposes
 * amending its own constitution, and an exception there would be an unhandled rejection
 * somewhere far away.
 */
export function gitCliRunner(repoRoot: string, timeoutMs = DEFAULT_TIMEOUT_MS): GitRunner {
  return {
    run: (args) =>
      new Promise<GitOutput>((resolvePromise) => {
        execFile(
          'git',
          ['-C', repoRoot, ...args],
          { timeout: timeoutMs, maxBuffer: MAX_BUFFER_BYTES, encoding: 'utf8' },
          (error, stdout, stderr) => {
            if (error === null) {
              resolvePromise({ code: 0, stdout, stderr });
              return;
            }
            const raw = (error as NodeJS.ErrnoException & { code?: number | string }).code;
            resolvePromise({
              code: typeof raw === 'number' ? raw : -1,
              stdout,
              stderr: stderr === '' ? error.message : stderr,
            });
          },
        );
      }),
  };
}

/**
 * The bridge to the OTHER git shell in this directory.
 *
 * `src/ledger/git.ts` owns `GitExec` — the plumbing seam the event store goes through — and this
 * module owns `GitRunner`, which is narrower on purpose: it never throws, because it sits on the
 * path that decides whether the framework proposes amending its own constitution. The two are not
 * a duplication to be deleted (the store NEEDS the throwing form, so that a failed `mktree` cannot
 * be mistaken for an empty tree), but a caller should not have to spawn two shells to hold both.
 * This adapts one to the other: `allowFailure` turns every non-zero exit into data, and a git that
 * cannot be spawned at all comes back as `code: -1`, exactly as `gitCliRunner` reports it.
 */
export function gitExecRunner(exec: GitExec): GitRunner {
  return {
    run: async (args) => {
      try {
        const r = await exec(args, { allowFailure: true });
        return { code: r.code, stdout: r.stdout, stderr: r.stderr };
      } catch (e) {
        return { code: -1, stdout: '', stderr: (e as Error).message };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The sighted port (src/core/sentencing.ts declares it; this implements it)
// ---------------------------------------------------------------------------

/**
 * A `SightedCommit` plus the one fact ADR-0004 needs and the core type has no room for:
 * whether any ref still reaches the commit. `reachable: false` with the object still present
 * is precisely "rebased away" — the event stays in the fold, marked orphaned.
 */
export interface SightedCommitRecord {
  readonly commit: SightedCommit;
  readonly reachable: boolean;
}

export interface SightedGitPort extends SightedCommitPort {
  lookupDetailed(shas: readonly CommitSha[]): Promise<ReadonlyMap<CommitSha, SightedCommitRecord>>;
}

export interface SightedPortOptions {
  /**
   * Orphan detection costs one extra `for-each-ref` per commit and is only meaningful in a
   * repository whose refs are actually present (a shallow CI clone reaches almost nothing).
   * Off means every resolvable commit is reported reachable.
   */
  readonly detectOrphans?: boolean;
}

/**
 * ASCII UNIT SEPARATOR / RECORD SEPARATOR. Field delimiters that cannot occur in a git author
 * name, an email or a path, so no quoting scheme is needed and no crafted commit message can
 * smuggle a delimiter in. Written as escapes rather than as literal control bytes, so the
 * source stays greppable and diffable.
 */
const UNIT = '\u001f';
const RECORD = '\u001e';
const COMMIT_FORMAT = `%H${UNIT}%aE${UNIT}%aN${UNIT}%cI${RECORD}`;

/**
 * `-c` asks a merge commit for its COMBINED diff — the content that differs from every parent,
 * i.e. what the merge itself introduced. An ordinary merge therefore contributes no paths
 * (correct: its content is already in the ledger as the individual commits), while a conflict
 * resolution that rewrote a file does. Same reading `scripts/check-inv001.ts` takes of "what a
 * commit touches"; see docs/spec/OPEN-QUESTIONS.md Q-33.
 *
 * `core.quotePath=false` keeps non-ASCII filenames unquoted so `parseRepoPath` sees the real
 * path. `--no-renames` reports the path as recorded rather than as detected — path entropy is
 * about where hands landed, not about what a similarity heuristic thinks they meant.
 */
function commitQueryArgs(sha: CommitSha): readonly string[] {
  return [
    '-c',
    'core.quotePath=false',
    'log',
    '-1',
    '-c',
    '--root',
    '--no-renames',
    `--format=${COMMIT_FORMAT}`,
    '--name-only',
    sha,
    '--',
  ];
}

interface ParsedCommit {
  readonly sha: CommitSha;
  readonly author: string;
  readonly committedAt: CommitterTime;
  readonly paths: readonly RepoPath[];
}

/** Pure: takes `git log` output, gives back a commit or the reason it is unreadable. */
export function parseCommitRecord(stdout: string): Parsed<ParsedCommit> {
  const cut = stdout.indexOf(RECORD);
  if (cut === -1) return fail('wrong-type', 'git produced no commit record');
  const fields = stdout.slice(0, cut).split(UNIT);
  const [hash, email, name, committedRaw] = fields;
  if (hash === undefined || email === undefined || name === undefined || committedRaw === undefined) {
    return fail('wrong-type', 'git commit record is missing fields');
  }
  const sha = parseCommitSha(hash.trim());
  if (!sha.ok) return sha;
  const committed = parseCommitterTime(committedRaw.trim());
  if (!committed.ok) return committed;
  const normalized = normalizeCommitterTime(committed.value);
  if (!normalized.ok) return normalized;

  const paths: RepoPath[] = [];
  for (const line of stdout.slice(cut + RECORD.length).split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const p = parseRepoPath(trimmed);
    if (!p.ok) return fail('invalid-path', `git reported an unreadable path: ${trimmed}`);
    paths.push(p.value);
  }

  // Email is the stable identity and the name is display text; a commit with neither is
  // attributed to its own sha, which is honest (an identity we cannot group is its own group)
  // and keeps author entropy from silently collapsing two anonymous hands into one.
  const handle = email.trim() !== '' ? email.trim().toLowerCase() : name.trim() !== '' ? name.trim() : hash.trim();

  return ok({ sha: sha.value, author: handle, committedAt: normalized.value, paths });
}

/**
 * The git implementation of `SightedCommitPort`. One `git log` per distinct sha — n is the
 * contributing-event count at a single firing, not the repository's history.
 */
export function gitSightedCommitPort(
  git: GitRunner,
  options: SightedPortOptions = {},
): SightedGitPort {
  const detectOrphans = options.detectOrphans ?? true;

  const reachableFromAnyRef = async (sha: CommitSha): Promise<boolean> => {
    const refs = await git.run(['for-each-ref', `--contains=${sha}`, '--count=1', '--format=%(refname)']);
    if (refs.code === 0) return refs.stdout.trim() !== '';
    // Older git has no `--contains` on for-each-ref. Fall back to the narrower question
    // ("reachable from HEAD"), which can only ever report MORE commits orphaned, never fewer —
    // and an over-reported orphan is a marked event, not a dropped one.
    const ancestor = await git.run(['merge-base', '--is-ancestor', sha, 'HEAD']);
    return ancestor.code === 0;
  };

  const lookupDetailed = async (
    shas: readonly CommitSha[],
  ): Promise<ReadonlyMap<CommitSha, SightedCommitRecord>> => {
    const out = new Map<CommitSha, SightedCommitRecord>();
    for (const sha of new Set(shas)) {
      const result = await git.run(commitQueryArgs(sha));
      if (result.code !== 0) continue; // absent from the object database entirely
      const parsed = parseCommitRecord(result.stdout);
      if (!parsed.ok) continue;
      const reachable = detectOrphans ? await reachableFromAnyRef(sha) : true;
      const author = actorId(parsed.value.author);
      out.set(sha, {
        commit: {
          sha: parsed.value.sha,
          committedAt: parsed.value.committedAt,
          paths: parsed.value.paths,
          author,
          // The event record carries no committer, and dispersion asks "how many independent
          // hands", which is an authorship question. Same identity in both slots rather than a
          // second `git log` for a field nothing downstream reads.
          committer: author,
        },
        reachable,
      });
    }
    return out;
  };

  return {
    lookupDetailed,
    lookup: async (shas) => {
      const detailed = await lookupDetailed(shas);
      return new Map([...detailed].map(([sha, record]) => [sha, record.commit]));
    },
  };
}

// ---------------------------------------------------------------------------
// Locus resolution (src/core/dispersion.ts owns EvidenceLocus; this fills it)
// ---------------------------------------------------------------------------

/**
 * `commit`          — resolved from a live commit.
 * `orphaned-commit` — the object survives but no ref reaches it: rebased away (ADR-0004).
 *                     The evidence is KEPT and folded, marked, never dropped.
 * `unattributed`    — an obsolescence event: nobody's hand, because obsolescence "accumulates
 *                     from silence" (spec 02 §7). Only produced under an explicit opt-in.
 */
export type LocusAttribution = 'commit' | 'orphaned-commit' | 'unattributed';

export interface ResolvedLocus {
  readonly locus: EvidenceLocus;
  readonly attribution: LocusAttribution;
  readonly commit: CommitSha | null;
  readonly committedAt: CommitterTime | null;
  /** ADR-0004's marker, as a fact rather than a discarded event. */
  readonly orphaned: boolean;
}

export type UnresolvedReason =
  | 'commit-missing'
  | 'unreadable-commit'
  | 'pr-only-subject'
  | 'silent-subject'
  | 'no-subject';

export interface UnresolvedLocus {
  readonly event: EventId;
  readonly reason: UnresolvedReason;
  readonly detail: string;
}

export interface LocusResolution {
  readonly resolved: ReadonlyMap<EventId, ResolvedLocus>;
  readonly unresolved: readonly UnresolvedLocus[];
}

/**
 * The handle stamped on an obsolescence locus under `silencePolicy: 'attribute-to-silence'`.
 * Deliberately not a plausible email: a reader of a proposal must be able to tell at a glance
 * that no human was attributed.
 */
export const SILENCE_ACTOR_HANDLE = 'gwtp:silence';

export interface ResolveLociOptions {
  /**
   * A `stale-claim` event from the obsolescence sweep has a `subject.path` and NO commit, so it
   * has no author at all — the sweep observes silence, not a hand (spec 02 §7). Dispersion
   * nevertheless demands one actor per contributing event.
   *
   * `'fail'` (default) is the least-committal reading: such an event is reported UNRESOLVED and
   * the firing fails loud rather than quietly attributing the silence to somebody.
   * `'attribute-to-silence'` is the explicit opt-in that lets obsolescence accumulators fire at
   * all, at the cost of one synthetic hand. See docs/spec/OPEN-QUESTIONS.md Q-45.
   */
  readonly silencePolicy?: 'fail' | 'attribute-to-silence';
}

/**
 * Resolves an `EvidenceLocus` per event: whose hand, and which paths. Pure apart from the
 * injected `GitRunner`.
 *
 * Nothing here drops an event silently. Every event either lands in `resolved` or lands in
 * `unresolved` with a reason, and `requireLoci` turns the second list into a loud failure —
 * because a missing locus biases dispersion toward "one hand, one seam", which is the
 * `refactor` verdict, which is the answer that leaves the law untouched. A statistic that
 * fails toward "the code is wrong" is not a neutral default.
 */
export async function resolveEvidenceLoci(
  events: readonly LedgerEvent[],
  port: SightedGitPort,
  options: ResolveLociOptions = {},
): Promise<LocusResolution> {
  const silencePolicy = options.silencePolicy ?? 'fail';

  const shas: CommitSha[] = [];
  for (const e of events) if (e.subject.commit !== undefined) shas.push(e.subject.commit);
  const commits = await port.lookupDetailed(shas);

  const resolved = new Map<EventId, ResolvedLocus>();
  const unresolved: UnresolvedLocus[] = [];

  for (const e of events) {
    const sha = e.subject.commit;

    if (sha !== undefined) {
      const record = commits.get(sha);
      if (record === undefined) {
        unresolved.push({
          event: e.event,
          reason: 'commit-missing',
          detail:
            `subject commit ${sha} is not in the object database. ADR-0004 keeps events whose ` +
            'SHA was rebased away, but a commit that has been garbage-collected can no longer ' +
            'testify to whose hand it was.',
        });
        continue;
      }
      // Two independent orphan signals: what git says today, and what the event itself
      // recorded when it was written (`subject.orphaned`, spec 02 §2). Either is sufficient —
      // the ledger's own note survives a later `gc`.
      const orphaned = !record.reachable || e.subject.orphaned === true;
      resolved.set(e.event, {
        locus: { event: e.event, actor: record.commit.author, paths: record.commit.paths },
        attribution: orphaned ? 'orphaned-commit' : 'commit',
        commit: record.commit.sha,
        committedAt: record.commit.committedAt,
        orphaned,
      });
      continue;
    }

    if (e.subject.pr !== undefined) {
      unresolved.push({
        event: e.event,
        reason: 'pr-only-subject',
        detail:
          `event ${e.event} names PR #${e.subject.pr} and no commit. `+
          '`EvidenceLocus` admits exactly ONE actor per event and a pull request admits many, ' +
          'so choosing which of its authors the event belongs to would be inventing a rule no ' +
          'spec states; and resolving a PR to its commits at all needs a forge port that would ' +
          'have to live in src/adapters (INV-005). See docs/spec/OPEN-QUESTIONS.md Q-45.',
      });
      continue;
    }

    if (e.subject.path !== undefined) {
      if (silencePolicy === 'fail') {
        unresolved.push({
          event: e.event,
          reason: 'silent-subject',
          detail:
            `event ${e.event} is a path-only observation (${e.subject.path}); obsolescence ` +
            'accumulates from silence and has no author (spec 02 §7). Pass ' +
            "silencePolicy: 'attribute-to-silence' to fire on it anyway. Q-45.",
        });
        continue;
      }
      resolved.set(e.event, {
        locus: { event: e.event, actor: actorId(SILENCE_ACTOR_HANDLE), paths: [e.subject.path] },
        attribution: 'unattributed',
        commit: null,
        committedAt: null,
        orphaned: false,
      });
      continue;
    }

    unresolved.push({
      event: e.event,
      reason: 'no-subject',
      detail: `event ${e.event} carries no commit, pr or path — it should not have decoded`,
    });
  }

  return { resolved, unresolved };
}

/** The `ReadonlyMap` shape `computeDispersion` consumes, projected out of a resolution. */
export function lociOf(resolution: LocusResolution): ReadonlyMap<EventId, EvidenceLocus> {
  return new Map([...resolution.resolved].map(([id, r]) => [id, r.locus]));
}

/**
 * FAIL LOUD. Turns any unresolved locus into `unresolved-locus` contract errors — the same code
 * `computeDispersion` raises — so the caller cannot proceed with statistics computed over a
 * biased subset. Two gates on the same door: this one names WHY each locus is missing, the one
 * in core catches anything that got past it.
 */
export function requireLoci(
  resolution: LocusResolution,
): Decoded<ReadonlyMap<EventId, EvidenceLocus>> {
  if (resolution.unresolved.length === 0) return ok(lociOf(resolution));
  const errors: ContractError[] = resolution.unresolved.map((u) => ({
    code: 'unresolved-locus' as const,
    message: `[${u.reason}] ${u.detail}`,
    at: `/events/${u.event}`,
  }));
  return err(errors);
}

/** How many of the resolved loci are ADR-0004 orphans; ships in the rendered proposal. */
export function orphanedCount(resolution: LocusResolution): number {
  let n = 0;
  for (const r of resolution.resolved.values()) if (r.orphaned) n += 1;
  return n;
}

export function unattributedCount(resolution: LocusResolution): number {
  let n = 0;
  for (const r of resolution.resolved.values()) if (r.attribution === 'unattributed') n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// The one declassification door in this module
// ---------------------------------------------------------------------------

export interface LocusDescription {
  readonly event: EventId;
  readonly actor: string;
  readonly paths: readonly string[];
}

/**
 * DECLASSIFIER — the only `ActorId -> string` in the ledger engine. For `gwtp ledger status`
 * and for a human reading a proposal's appendix; never for anything a judge can reach.
 *
 * It takes the `SentencingWarrant` from its CALLER rather than minting one, exactly as
 * `computeDispersion` and `toAccumulatorSnapshot` do: a declassification is a call with an
 * extra argument, and the only way to obtain that argument is `withSentencingWarrant`, which
 * `src/ledger/firing.ts` calls once, at firing time, under the name `atFiringTime`.
 */
export function describeEvidenceLocus(
  locus: EvidenceLocus,
  warrant: SentencingWarrant,
): LocusDescription {
  return {
    event: locus.event,
    actor: revealActor(locus.actor, warrant),
    paths: [...locus.paths],
  };
}

/** Type-level reminder for readers: this module hands out `ActorId`, and nothing else does. */
export type SightedActor = ActorId;
