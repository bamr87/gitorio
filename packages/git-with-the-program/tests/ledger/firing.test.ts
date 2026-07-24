// Implements tests for: docs/spec/02-ledger.md §5 (firing: dispersion decides direction) and
// §6 (post-fire lifecycle), docs/adr/0003-judge-blindness.md (authorship read only at firing
// time) and docs/adr/0004-committer-time-decay.md (an event whose SHA was rebased away is kept
// and marked orphaned, never dropped).
//
// SEED-02 acceptance covered here: "a synthetic event stream crosses budget and files a
// correctly-bundled issue; a rejected proposal path writes an `affirmed` precedent and raises
// precision" — minus the filing, which is `src/adapters/github/**` (INV-005), and minus the
// writing, which INV-001 forbids a machine to do at all.
//
// THREE THINGS THIS SUITE IS DELIBERATELY STRICT ABOUT.
//
//  1. The classifier's failure mode. Every degenerate input — a missing locus, an empty
//     contributing set, a mismatched trigger — must FAIL, not quietly classify. A statistic
//     computed over a biased subset reads as "few hands, few seams", which is `refactor`, which
//     is the answer that leaves the constitution untouched. A classifier whose error path is
//     "never propose amending the law" is not neutral; it is conservative by accident, and it
//     would be invisible in every green test suite ever written for it.
//  2. The conjunction. spec 02 §5's table needs ALL of high author entropy, enough distinct
//     hands, high path entropy and a sustained window. Each threshold is swept independently, at
//     the boundary and one epsilon past it, so no future refactor can quietly turn the AND into
//     an OR and stay green.
//  3. The diffs. `onProposalRejected` and `onProposalAccepted` hand a human a patch against the
//     repository's own constitution. A patch that does not apply is worse than no patch, so the
//     diffs are run through real `git apply` — in a THROWAWAY repository under $TMPDIR. This
//     suite never writes to this repository's `.program/`, which is the whole point of INV-001.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  MILLIS_PER_DAY,
  PROVISIONAL_DISPERSION_POLICY,
  REARM_FRACTION_DEFAULT,
  classifyFiring,
  committerTimeFromEpochMillis,
  decodeInvariantsFile,
  decodeLedgerEvent,
  decodeVerdict,
  eventBodyFromVerdict,
  hashBlob,
  isEnforced,
  isNonEmpty,
  parseAccumulatorKey,
  parseBudget,
  parseCommitSha,
  parseDuration,
  parseJudgeId,
  parsePrecedentId,
  parsePrecision,
  parseRationaleRef,
  parseRepoPath,
  sealEvent,
  unwrap,
  verifyEventId,
  type AbstainVerdict,
  type AccumulatorKey,
  type AccumulatorState,
  type Assertion,
  type DispersionPolicy,
  type EventId,
  type EventSubject,
  type EvidenceLocus,
  type Firing,
  type FoldKnobs,
  type InvariantAssertion,
  type JudgeRef,
  type LedgerEvent,
  type NonEmptyReadonlyArray,
  type Precision,
  type ProvenanceRef,
  type SeverityOrdinal,
  type ViolationVerdict,
} from '../../src/core/index.js';
import { computeDispersion, toDispersionSnapshot } from '../../src/core/dispersion.js';
import {
  actorId,
  revealSurprise,
  withSentencingWarrant,
  type SentencingWarrant,
} from '../../src/core/sentencing.js';
import { loadSchemaRegistry } from '../../src/cli/commands/validate.js';
import { foldEvents, foldKnobs } from '../../src/ledger/fold.js';
import {
  DEFAULT_FIRING_JUDGE,
  FIRING_EVENT_VERDICT,
  PRECISION_RAISE_RULE,
  appendPrecedentYaml,
  assembleFiring,
  atFiringTime,
  governanceDebt,
  isFiringEvent,
  nextPrecedentId,
  onProposalAccepted,
  onProposalRejected,
  proposalTitle,
  raisePrecision,
  renderGovernanceDebt,
  renderPrecedentBlock,
  renderProposal,
  replaceAssertionField,
  unifiedDiff,
  zeroAccumulator,
  type AssembledFiring,
  type FiringAssemblyInput,
  type IgnoredProposal,
} from '../../src/ledger/firing.js';
import {
  SILENCE_ACTOR_HANDLE,
  describeEvidenceLocus,
  gitCliRunner,
  gitSightedCommitPort,
  lociOf,
  orphanedCount,
  parseCommitRecord,
  requireLoci,
  resolveEvidenceLoci,
  unattributedCount,
} from '../../src/ledger/sighted.js';

// ---------------------------------------------------------------------------
// Warrant, repository root, temp workspaces
// ---------------------------------------------------------------------------

/**
 * A test file is not a blind directory (`scripts/check-inv003.ts` → `BLIND_DIRS`), so it may
 * hold a warrant. Every `revealX` below is deliberate and confined to assertions.
 */
const WARRANT: SentencingWarrant = withSentencingWarrant((w) => w);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Subprocess tests measure how busy the machine is, not whether the code is correct. */
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

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    // Piped rather than inherited: one assertion below deliberately expects git to FAIL, and a
    // passing suite should not print its diagnostics as if something had gone wrong.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'fixture',
      GIT_AUTHOR_EMAIL: 'fixture@localhost',
      GIT_COMMITTER_NAME: 'fixture',
      GIT_COMMITTER_EMAIL: 'fixture@localhost',
    },
  }).trim();
}

/** A throwaway repository. NEVER this one — the ledger is surveillance (spec 02 §8). */
function initRepo(name: string): string {
  const dir = workspace(name);
  git(dir, ['init', '-q', '-b', 'main', '.']);
  git(dir, ['config', 'user.email', 'fixture@localhost']);
  git(dir, ['config', 'user.name', 'fixture']);
  return dir;
}

interface CommitSpec {
  readonly files: Readonly<Record<string, string>>;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly message?: string;
}

function commitFiles(dir: string, spec: CommitSpec): string {
  for (const [path, contents] of Object.entries(spec.files)) {
    const abs = join(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  git(dir, ['add', '-A']);
  execFileSync(
    'git',
    ['commit', '-q', '-m', spec.message ?? 'fixture'],
    {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: spec.authorName,
        GIT_AUTHOR_EMAIL: spec.authorEmail,
        GIT_COMMITTER_NAME: 'ci',
        GIT_COMMITTER_EMAIL: 'ci@localhost',
      },
    },
  );
  return git(dir, ['rev-parse', 'HEAD']);
}

// ---------------------------------------------------------------------------
// Event and locus fixtures
// ---------------------------------------------------------------------------

const HALF_LIFE = unwrap(parseDuration('365d'));
const JUDGE: JudgeRef = { kind: 'model', id: unwrap(parseJudgeId('claude-invariant-judge')) };
const RATIONALE = unwrap(parseRationaleRef(hashBlob('the full rationale text')));
const KEY = unwrap(parseAccumulatorKey('INV-007'));
const EPOCH = Date.parse('2026-01-01T00:00:00Z');

const atDay = (day: number) => unwrap(committerTimeFromEpochMillis(EPOCH + day * MILLIS_PER_DAY));
const shaOf = (n: number): string => (0x100000 + n).toString(16);
const repoPath = (p: string) => unwrap(parseRepoPath(p));

interface Sample {
  readonly day: number;
  readonly n: number;
  readonly author: string;
  readonly path: string;
  readonly severity?: SeverityOrdinal;
}

function driftEvent(s: Sample): LedgerEvent {
  const verdict = unwrap(
    decodeVerdict({
      assertion: KEY,
      verdict: 'drift',
      severity: s.severity ?? 'entrenches',
      evidence: [`${s.path}:41-58`],
      rationale: 'imports a forge SDK inside core/',
    }),
  ) as ViolationVerdict;
  return unwrap(
    sealEvent(
      eventBodyFromVerdict({
        verdict,
        subject: { commit: unwrap(parseCommitSha(shaOf(s.n))) } as EventSubject,
        judge: JUDGE,
        t: atDay(s.day),
        precision_at: unwrap(parsePrecision(0.9)),
        rationale: RATIONALE,
      }),
    ),
  );
}

const knobsWith = (budget: number, overrides: Partial<FoldKnobs> = {}): FoldKnobs => ({
  halfLife: HALF_LIFE,
  budget: unwrap(parseBudget(budget)),
  precisionOverride: null,
  rearmFraction: REARM_FRACTION_DEFAULT,
  ...overrides,
});

/**
 * A synthetic event stream that crosses budget, with the loci a git resolver would have
 * produced. Everything downstream reads only these two, so a scenario is fully described by its
 * samples — which is what lets the conjunction sweep below vary one statistic at a time.
 */
interface Scenario {
  readonly events: readonly LedgerEvent[];
  readonly loci: ReadonlyMap<EventId, EvidenceLocus>;
  readonly firing: Firing;
  readonly trigger: LedgerEvent;
  readonly knobs: FoldKnobs;
}

function scenario(samples: readonly Sample[], budget: number): Scenario {
  const events = samples.map(driftEvent);
  const loci = new Map<EventId, EvidenceLocus>(
    events.map((e, i) => {
      const s = samples[i] as Sample;
      return [e.event, { event: e.event, actor: actorId(s.author), paths: [repoPath(s.path)] }];
    }),
  );
  const knobs = knobsWith(budget);
  const result = unwrap(foldEvents(events, knobs));
  const firing = result.firings.at(-1);
  if (firing === undefined) throw new Error('the fixture never crossed budget');
  const trigger = events.find((e) => e.event === firing.triggeredBy);
  if (trigger === undefined) throw new Error('the firing named an event outside the fixture');
  return { events, loci, firing, trigger, knobs };
}

function assemble(s: Scenario, extra: Partial<FiringAssemblyInput> = {}): AssembledFiring {
  return atFiringTime((w) =>
    unwrap(
      assembleFiring(
        { firing: s.firing, trigger: s.trigger, loci: s.loci, complianceCount: 0, knobs: s.knobs, ...extra },
        w,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// The three scenarios spec 02 §5's table describes
// ---------------------------------------------------------------------------

/** One author, one path, three days: "the code is wrong". */
const CONCENTRATED: readonly Sample[] = [0, 1, 3].map((day, i) => ({
  day,
  n: i + 1,
  author: 'sam@example.com',
  path: 'src/core/http.ts',
}));

/**
 * Five authors, eight paths, six months: "the org outvoting the statute". The 20-day stride and
 * the 365d half-life keep every residual weight within ~30% of the newest, so the entropies below
 * are dispersion and not a decay artifact (Q-18: the default weighting is `residual`).
 */
const DIFFUSE: readonly Sample[] = Array.from({ length: 10 }, (_, i) => ({
  day: i * 20,
  n: i + 1,
  author: `dev${i % 5}@example.com`,
  path: `src/mod${i % 8}/handler.ts`,
}));

/** Diffuse in every respect EXCEPT the count of hands: two authors, below `minDistinctAuthors`. */
const TWO_HANDS: readonly Sample[] = DIFFUSE.map((s, i) => ({ ...s, author: `dev${i % 2}@example.com` }));

// ---------------------------------------------------------------------------

describe('classification (spec 02 §5: dispersion decides direction)', () => {
  it('concentrated evidence — one hand, one seam, a three-day window — is `refactor`', () => {
    const s = scenario(CONCENTRATED, 2);
    const a = assemble(s);
    const d = a.proposal.evidence.dispersion;

    expect(a.proposal.kind).toBe('refactor');
    expect(d.authorEntropy.distinct).toBe(1);
    expect(d.authorEntropy.normalized).toBe(0);
    expect(d.pathEntropy.distinct).toBe(1);
    expect(d.timeSpread.spanMs).toBe(3 * MILLIS_PER_DAY);
    expect(a.proposal.evidence.contributing).toHaveLength(3);
    // The assertion stands: nothing here proposes touching `.program/`.
    expect(proposalTitle(a)).toBe('[GWTP] Refactoring recommendation: INV-007');
  });

  it('diffuse evidence — five hands, eight seams, six months — is `reprogram`', () => {
    const s = scenario(DIFFUSE, 7.5);
    const a = assemble(s);
    const d = a.proposal.evidence.dispersion;

    expect(a.proposal.kind).toBe('reprogram');
    expect(a.proposal.evidence.contributing).toHaveLength(10);
    expect(d.authorEntropy.distinct).toBe(5);
    expect(d.pathEntropy.distinct).toBe(8);
    expect(d.timeSpread.spanMs).toBe(180 * MILLIS_PER_DAY);

    // Each of the four conditions independently met, so the sweep below is measuring a real
    // conjunction rather than three constants and one variable.
    expect(d.authorEntropy.normalized).toBeGreaterThanOrEqual(PROVISIONAL_DISPERSION_POLICY.authorEntropyMin);
    expect(d.authorEntropy.distinct).toBeGreaterThanOrEqual(PROVISIONAL_DISPERSION_POLICY.minDistinctAuthors);
    expect(d.pathEntropy.normalized).toBeGreaterThanOrEqual(PROVISIONAL_DISPERSION_POLICY.pathEntropyMin);
    expect(d.timeSpread.spanMs).toBeGreaterThanOrEqual(PROVISIONAL_DISPERSION_POLICY.timeSpreadMinMs);

    expect(proposalTitle(a)).toBe('[GWTP] Reprogramming proposal: INV-007');
  });

  it('two hands over eight seams and six months is still `refactor` — the count of hands is a term', () => {
    const s = scenario(TWO_HANDS, 7.5);
    const a = assemble(s);
    const d = a.proposal.evidence.dispersion;

    // Entropy alone would have said "diffuse": two evenly-used authors normalize to 1.0.
    expect(d.authorEntropy.normalized).toBeGreaterThanOrEqual(PROVISIONAL_DISPERSION_POLICY.authorEntropyMin);
    expect(d.authorEntropy.distinct).toBe(2);
    expect(a.proposal.kind).toBe('refactor');
  });

  describe('the conjunction is real: each threshold, at the boundary and one epsilon past it', () => {
    const s = scenario(DIFFUSE, 7.5);
    const measured = assemble(s).proposal.evidence.dispersion;

    const cases: readonly {
      readonly name: string;
      readonly at: DispersionPolicy;
      readonly just: DispersionPolicy;
    }[] = [
      {
        name: 'authorEntropyMin',
        at: { ...PROVISIONAL_DISPERSION_POLICY, authorEntropyMin: measured.authorEntropy.normalized },
        just: {
          ...PROVISIONAL_DISPERSION_POLICY,
          authorEntropyMin: measured.authorEntropy.normalized + 1e-6,
        },
      },
      {
        name: 'minDistinctAuthors',
        at: { ...PROVISIONAL_DISPERSION_POLICY, minDistinctAuthors: measured.authorEntropy.distinct },
        just: { ...PROVISIONAL_DISPERSION_POLICY, minDistinctAuthors: measured.authorEntropy.distinct + 1 },
      },
      {
        name: 'pathEntropyMin',
        at: { ...PROVISIONAL_DISPERSION_POLICY, pathEntropyMin: measured.pathEntropy.normalized },
        just: { ...PROVISIONAL_DISPERSION_POLICY, pathEntropyMin: measured.pathEntropy.normalized + 1e-6 },
      },
      {
        name: 'timeSpreadMinMs',
        at: { ...PROVISIONAL_DISPERSION_POLICY, timeSpreadMinMs: measured.timeSpread.spanMs },
        just: { ...PROVISIONAL_DISPERSION_POLICY, timeSpreadMinMs: measured.timeSpread.spanMs + 1 },
      },
    ];

    for (const c of cases) {
      it(`${c.name}: met exactly -> reprogram, missed by one epsilon -> refactor`, () => {
        expect(assemble(s, { policy: c.at }).proposal.kind).toBe('reprogram');
        expect(assemble(s, { policy: c.just }).proposal.kind).toBe('refactor');
        // …and the same answer straight out of src/core, so the wrapper adds no opinion.
        expect(classifyFiring(measured, c.at)).toBe('reprogram');
        expect(classifyFiring(measured, c.just)).toBe('refactor');
      });
    }
  });

  it('uses PROVISIONAL_DISPERSION_POLICY when the caller supplies none, and says which it used', () => {
    const s = scenario(DIFFUSE, 7.5);
    expect(assemble(s).policy).toEqual(PROVISIONAL_DISPERSION_POLICY);
    expect(assemble(s).policyStatus).toBe('provisional');

    const ratified: DispersionPolicy = { ...PROVISIONAL_DISPERSION_POLICY, minDistinctAuthors: 4 };
    expect(assemble(s, { policy: ratified }).policyStatus).toBe('caller-supplied');
    // A caller who passes the provisional constant back in is still told it is provisional:
    // the banner tracks the NUMBERS, not the calling convention.
    expect(assemble(s, { policy: { ...PROVISIONAL_DISPERSION_POLICY } }).policyStatus).toBe('provisional');
  });

  it('honours an explicit `uniform` weighting and records it on the stats (Q-18)', () => {
    const s = scenario(DIFFUSE, 7.5);
    expect(assemble(s).proposal.evidence.dispersion.weighting).toBe('residual');
    expect(assemble(s, { weighting: 'uniform' }).proposal.evidence.dispersion.weighting).toBe('uniform');
  });
});

describe('failing loud rather than biasing toward `refactor`', () => {
  /**
   * The load-bearing test of the whole file. An unresolved locus removes evidence, and removed
   * evidence always looks LESS dispersed than the evidence that produced it — fewer hands, fewer
   * seams, a narrower window. So the silent-degradation bug does not look like a bug: it looks
   * like a `refactor` recommendation, which is the outcome that leaves the law alone. The fixture
   * is built so that dropping ONE locus turns a genuine `reprogram` into a textbook `refactor`,
   * and the requirement is that the engine refuses to answer at all.
   */
  it('an unresolved locus is an error, and NOT a quietly-concentrated `refactor`', () => {
    const s = scenario(DIFFUSE, 7.5);
    const orphanedId = (s.events[0] as LedgerEvent).event;
    const missing = new Map(s.loci);
    missing.delete(orphanedId);

    const result = atFiringTime((w) =>
      assembleFiring(
        { firing: s.firing, trigger: s.trigger, loci: missing, complianceCount: 0, knobs: s.knobs },
        w,
      ),
    );

    expect(result.ok).toBe(false);
    const errors = result.ok ? [] : result.error;
    expect(errors.map((e) => e.code)).toContain('unresolved-locus');
    expect(errors.some((e) => e.message.includes(orphanedId))).toBe(true);

    // The counterfactual that makes the assertion meaningful: with every locus present this same
    // firing is a `reprogram`. The failure is therefore not "there was nothing to say".
    expect(assemble(s).proposal.kind).toBe('reprogram');
  });

  it('degrading to the resolvable subset would have flipped the verdict — which is why it must not', () => {
    // Same firing, but the loci map keeps only the events belonging to one hand and one seam.
    const s = scenario(DIFFUSE, 7.5);
    const survivors = s.firing.contributing.slice(0, 1);
    if (!isNonEmpty(survivors)) throw new Error('the fixture must contribute at least one event');
    const oneHand = new Map<EventId, EvidenceLocus>();
    for (const c of survivors) oneHand.set(c.event, s.loci.get(c.event) as EvidenceLocus);

    const degraded = computeDispersion(
      { key: s.firing.key, contributing: survivors, loci: oneHand, complianceCount: 0 },
      WARRANT,
    );
    expect(degraded.ok && classifyFiring(degraded.value, PROVISIONAL_DISPERSION_POLICY)).toBe('refactor');

    // And the real call, over the real contributing set with a hole in it, refuses.
    const held = atFiringTime((w) =>
      assembleFiring(
        { firing: s.firing, trigger: s.trigger, loci: oneHand, complianceCount: 0, knobs: s.knobs },
        w,
      ),
    );
    expect(held.ok).toBe(false);
  });

  it('rejects a trigger that is not the event the firing names', () => {
    const s = scenario(DIFFUSE, 7.5);
    const wrong = s.events.find((e) => e.event !== s.firing.triggeredBy) as LedgerEvent;
    const result = atFiringTime((w) =>
      assembleFiring(
        { firing: s.firing, trigger: wrong, loci: s.loci, complianceCount: 0, knobs: s.knobs },
        w,
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.error.map((e) => e.code)).toContain('invalid-id');
  });

  it('rejects a trigger keyed to another accumulator', () => {
    const s = scenario(CONCENTRATED, 2);
    const otherKey = unwrap(parseAccumulatorKey('INV-008'));
    const foreign = { ...s.trigger, assertion: otherKey } as LedgerEvent;
    const result = atFiringTime((w) =>
      assembleFiring(
        { firing: s.firing, trigger: foreign, loci: s.loci, complianceCount: 0, knobs: s.knobs },
        w,
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.error.map((e) => e.at)).toContain('/trigger/assertion');
  });

  it('rejects a firing with no contributing events — a proposal must ship its evidence', () => {
    const s = scenario(CONCENTRATED, 2);
    const empty: Firing = { ...s.firing, contributing: [] };
    const result = atFiringTime((w) =>
      assembleFiring(
        { firing: empty, trigger: s.trigger, loci: s.loci, complianceCount: 0, knobs: s.knobs },
        w,
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.error.map((e) => e.code)).toContain('missing-field');
  });
});

describe('the firing is itself a ledger event (spec 02 §6: outcomes are events too)', () => {
  const s = scenario(DIFFUSE, 7.5);
  const a = assemble(s);

  it('carries the dispersion snapshot, and nothing else does', () => {
    const stats = a.proposal.evidence.dispersion;
    expect(a.event.dispersion_snapshot).toEqual(toDispersionSnapshot(stats, WARRANT));
    expect(a.snapshot.author_entropy).toBe(stats.authorEntropy.normalized);
    expect(a.snapshot.path_entropy).toBe(stats.pathEntropy.normalized);
    expect(a.snapshot.time_spread).toBe(stats.timeSpread.spanMs);
    expect(a.snapshot.compliance_ratio).toBe(stats.complianceRatio);

    expect(isFiringEvent(a.event)).toBe(true);
    expect(s.events.some(isFiringEvent)).toBe(false);
  });

  it('publishes the ENTROPY of the hands and never the hands (ADR-0003)', () => {
    // `DispersionSnapshot` is four scalars by construction (Q-13). Assert it structurally, so a
    // future field that smuggled an identity in would fail here rather than in review.
    expect(Object.keys(a.event.dispersion_snapshot ?? {}).sort()).toEqual([
      'author_entropy',
      'compliance_ratio',
      'path_entropy',
      'time_spread',
    ]);
    const serialized = JSON.stringify(a.event);
    for (const sample of DIFFUSE) expect(serialized).not.toContain(sample.author);
  });

  it('is sealed, content-addressed and self-verifying', () => {
    expect(unwrap(verifyEventId(a.event))).toBe(true);
    expect(a.event.event).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(a.event)).toBe(true);
    // Idempotent by construction: assembling the same firing twice is the same event id, so a
    // retried CI run cannot double-record the spike (spec 02 §1 property 1).
    expect(assemble(s).event.event).toBe(a.event.event);
  });

  it('inherits the trigger subject, is keyed to the accumulator, and supersedes nothing', () => {
    expect(a.event.subject).toEqual(s.trigger.subject);
    expect(a.event.assertion).toBe(s.firing.key);
    expect(a.event.t).toBe(s.firing.at);
    expect(a.event.supersedes).toBeNull();
    expect(a.event.judge).toEqual(DEFAULT_FIRING_JUDGE);
    expect(a.event.judge.kind).toBe('deterministic');
  });

  it('carries the inert verdict, so recording an outcome cannot perturb the fold that produced it', () => {
    expect(a.event.verdict).toBe(FIRING_EVENT_VERDICT);
    // The proof that "inert" is not a claim: folding the firing event back in with the stream
    // changes the meter by nothing at all, only the abstention census.
    const before = unwrap(foldEvents(s.events, s.knobs));
    const after = unwrap(foldEvents([...s.events, a.event], s.knobs));
    const meterOf = (f: typeof before): number =>
      revealSurprise((f.states.get(KEY) as AccumulatorState).value, WARRANT);
    expect(meterOf(after)).toBe(meterOf(before));
    expect(after.firings).toHaveLength(before.firings.length);
    expect((after.states.get(KEY) as AccumulatorState).abstentionCount).toBe(1);
  });

  it('validates against schemas/event.schema.json and re-decodes to the same record', () => {
    const validate = loadSchemaRegistry(join(REPO_ROOT, 'schemas')).validator('event');
    const wire = JSON.parse(JSON.stringify(a.event)) as unknown;
    expect(validate(wire), JSON.stringify(validate.errors)).toBe(true);
    expect(unwrap(decodeLedgerEvent(wire))).toEqual(a.event);
  });
});

describe('the rendered proposal (spec 02 §5: every proposal ships its evidence)', () => {
  const s = scenario(DIFFUSE, 7.5);
  const a = assemble(s, { complianceCount: 4, evidenceNotes: ['2 of 10 commits were rebased away (ADR-0004)'] });
  const text = atFiringTime((w) => renderProposal(a, w));

  it('ships contributing events, dispersion, compliance ratio, the decay-weighted total and the knobs', () => {
    for (const c of a.proposal.evidence.contributing) expect(text).toContain(c.event);
    expect(text).toContain('author entropy');
    expect(text).toContain('path entropy');
    expect(text).toContain('time spread');
    expect(text).toContain('compliance ratio');
    expect(text).toContain(
      revealSurprise(a.proposal.evidence.accumulated, WARRANT).toFixed(3),
    );
    expect(text).toContain(a.proposal.evidence.knobs.halfLife.source);
    expect(text).toContain(a.event.event);
    expect(text).toContain('2 of 10 commits were rebased away');
  });

  it('marks the provisional thresholds as provisional, loudly, above the conclusion', () => {
    expect(text).toContain('PROVISIONAL thresholds, not by ratified law');
    expect(text).toContain('Q-22');
    // The banner must precede the numbers it qualifies: a reader who stops at the table has
    // still been told the table is not law.
    expect(text.indexOf('PROVISIONAL thresholds')).toBeLessThan(text.indexOf('| Statistic |'));
  });

  it('says so differently when the caller supplied its own policy', () => {
    const ratified: DispersionPolicy = { ...PROVISIONAL_DISPERSION_POLICY, minDistinctAuthors: 4 };
    const other = atFiringTime((w) => renderProposal(assemble(s, { policy: ratified }), w));
    expect(other).not.toContain('PROVISIONAL thresholds, not by ratified law');
    expect(other).toContain('caller-supplied dispersion policy');
  });

  it('names no author, in either direction', () => {
    for (const sample of DIFFUSE) expect(text).not.toContain(sample.author);
    expect(text).toContain('author identities are never published, only their entropy');
  });

  it('states the direction in words, not only as a kind', () => {
    expect(text).toContain('**The evidence says the law is wrong.**');
    const concentrated = atFiringTime((w) => renderProposal(assemble(scenario(CONCENTRATED, 2)), w));
    expect(concentrated).toContain('**The evidence says the code is wrong.**');
  });

  it('truncates a very long evidence list rather than emitting an unbounded document', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      day: i,
      n: i + 1,
      author: `dev${i % 5}@example.com`,
      path: `src/mod${i % 8}/handler.ts`,
    }));
    const big = scenario(many, 40);
    const rendered = atFiringTime((w) => renderProposal(assemble(big), w));
    expect(big.firing.contributing.length).toBeGreaterThan(25);
    expect(rendered).toContain('more*');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Post-fire lifecycle (spec 02 §6)
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * The real constitution, read (never written) so the diffs are proved against the document a
 * human would actually apply them to. Nothing here asserts a current `status` or `precision`
 * value — those change by amendment, which is the point of the system (Q-38). Every assertion
 * below is about the RELATION between the input text and the patched text.
 */
const INVARIANTS_TEXT = readFileSync(join(REPO_ROOT, '.program', 'invariants.yaml'), 'utf8');
const PRECEDENTS_TEXT = readFileSync(join(REPO_ROOT, '.program', 'precedents.yaml'), 'utf8');
const PROGRAM: readonly Assertion[] = unwrap(decodeInvariantsFile(parseYaml(INVARIANTS_TEXT)));

/** Data-driven: whichever enforced assertion happens to come first, today or after an amendment. */
const SUBJECT_ASSERTION: InvariantAssertion = (() => {
  const a = PROGRAM.find((x) => isEnforced(x) && (x.precision as number) < 1);
  if (a === undefined) {
    throw new Error(
      'no ratified assertion with precision below the schema ceiling; the precision-raise ' +
        'fixture needs one to have somewhere to rise to (Q-26)',
    );
  }
  return a as InvariantAssertion;
})();

const EVIDENCE = ['pr#214', 'commit 9f2c1d'] as unknown as NonEmptyReadonlyArray<ProvenanceRef>;

/** `git apply` in a THROWAWAY repository. The only honest test of a patch a human must apply. */
function appliesCleanly(path: string, before: string, diff: string): string {
  const dir = initRepo('apply');
  const abs = join(dir, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, before);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'before']);
  writeFileSync(join(dir, 'patch.diff'), diff);
  git(dir, ['apply', '--whitespace=nowarn', 'patch.diff']);
  return readFileSync(abs, 'utf8');
}

function rejection(overrides: Partial<Parameters<typeof onProposalRejected>[0]> = {}) {
  const s = scenario(DIFFUSE, 7.5);
  const proposal = assemble(s).proposal;
  return onProposalRejected({
    proposal: { ...proposal, key: SUBJECT_ASSERTION.id },
    assertion: SUBJECT_ASSERTION,
    invariantsYaml: INVARIANTS_TEXT,
    precedentsYaml: PRECEDENTS_TEXT,
    existingPrecedentIds: [],
    pattern: 'a forge SDK imported inside src/core/',
    rationale: 'the boundary held; the call sites were wrong',
    evidence: EVIDENCE,
    ...overrides,
  });
}

describe('proposal REJECTED — an affirmed precedent, and precision rises (spec 02 §6)', () => {
  it('mints a precedent with `ruling: affirmed` and the next free id', () => {
    const r = unwrap(rejection());
    expect(r.precedent.ruling).toBe('affirmed');
    expect(r.precedent.id).toBe(unwrap(parsePrecedentId('PRE-001')));
    expect(r.precedent.pattern).toBe('a forge SDK imported inside src/core/');
    expect(r.precedent.evidence).toEqual(EVIDENCE);

    const later = unwrap(
      rejection({ existingPrecedentIds: [unwrap(parsePrecedentId('PRE-007'))] }),
    );
    expect(later.precedent.id).toBe(unwrap(parsePrecedentId('PRE-008')));
  });

  it('proposes the precedent as a DIFF against `.program/`, never as a write (INV-001)', () => {
    const r = unwrap(rejection());
    const amendment = r.amendments[0];
    expect(amendment?.path).toBe('.program/precedents.yaml');
    expect(amendment?.diff).not.toBeNull();
    expect(amendment?.rationale).toContain('INV-001 forbids a machine writing this file');

    const applied = appliesCleanly('.program/precedents.yaml', PRECEDENTS_TEXT, amendment?.diff as string);
    expect(applied).toBe(amendment?.result);
    // `[]` is replaced, not appended beside — the two cannot coexist in one YAML document.
    expect(parseYaml(applied)).toHaveLength(1);
    expect((parseYaml(applied) as { id: string }[])[0]?.id).toBe('PRE-001');
    // …and this repository's own file is untouched.
    expect(readFileSync(join(REPO_ROOT, '.program', 'precedents.yaml'), 'utf8')).toBe(PRECEDENTS_TEXT);
  });

  it('raises precision by the shipped rule, as a second diff, and states the rule', () => {
    const r = unwrap(rejection());
    const amendment = r.amendments[1];
    expect(amendment?.path).toBe('.program/invariants.yaml');
    expect(r.raisedPrecision).toBe(unwrap(raisePrecision(SUBJECT_ASSERTION.precision)));
    expect(amendment?.rationale).toContain(PRECISION_RAISE_RULE);
    expect(amendment?.rationale).toContain('Q-47');

    const applied = appliesCleanly('.program/invariants.yaml', INVARIANTS_TEXT, amendment?.diff as string);
    const after = unwrap(decodeInvariantsFile(parseYaml(applied)));
    const patched = after.find((x) => x.id === SUBJECT_ASSERTION.id);
    expect(patched?.precision).toBe(r.raisedPrecision);

    // EXACTLY one field of exactly one assertion moved. A governance patch that also nudged a
    // budget, a half-life or another assertion's precision would be legislating by accident.
    expect(after).toHaveLength(PROGRAM.length);
    for (const [i, a] of after.entries()) {
      const before = PROGRAM[i] as Assertion;
      expect(a.id).toBe(before.id);
      expect({ ...a, precision: 0 }).toEqual({ ...before, precision: 0 });
      if (a.id !== SUBJECT_ASSERTION.id) expect(a.precision).toBe(before.precision);
    }
  });

  it('halves the distance to the ceiling, monotonically, forever, without ever reaching it', () => {
    expect(unwrap(raisePrecision(unwrap(parsePrecision(0.7))))).toBe(0.85);
    expect(unwrap(raisePrecision(unwrap(parsePrecision(0.85))))).toBe(0.925);
    expect(unwrap(raisePrecision(unwrap(parsePrecision(0.925))))).toBe(0.9625);

    fc.assert(
      fc.property(fc.double({ min: 1e-6, max: 1 - 1e-5, noNaN: true }), (p) => {
        const before = unwrap(parsePrecision(p));
        const after = raisePrecision(before);
        expect(after.ok).toBe(true);
        if (!after.ok) return;
        expect(after.value as number).toBeGreaterThan(before as number);
        expect(after.value as number).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });

  it('refuses at the schema ceiling rather than clamping into a silent no-op (Q-26)', () => {
    const ceiling = unwrap(parsePrecision(1));
    expect(raisePrecision(ceiling).ok).toBe(false);

    const maxed: InvariantAssertion = { ...SUBJECT_ASSERTION, precision: ceiling };
    const r = unwrap(rejection({ assertion: maxed }));
    expect(r.raisedPrecision).toBeNull();
    expect(r.amendments[1]?.diff).toBeNull();
    expect(r.amendments[1]?.note).toContain('already at the schema ceiling');
    // The precedent still lands: the law was still affirmed under fire.
    expect(r.precedent.ruling).toBe('affirmed');
  });

  it('raises nothing for a scope-claim accumulator, which has no precision knob (Q-04)', () => {
    const claim = unwrap(parseAccumulatorKey('src/**'));
    const s = scenario(DIFFUSE, 7.5);
    const proposal = { ...assemble(s).proposal, key: claim };
    const r = unwrap(
      onProposalRejected({
        proposal,
        assertion: { ...SUBJECT_ASSERTION, id: claim } as unknown as Assertion,
        invariantsYaml: INVARIANTS_TEXT,
        precedentsYaml: PRECEDENTS_TEXT,
        existingPrecedentIds: [],
        pattern: 'the claim went stale',
        rationale: 'the claim is still live',
        evidence: EVIDENCE,
      }),
    );
    expect(r.raisedPrecision).toBeNull();
    expect(r.amendments[1]?.diff).toBeNull();
    expect(r.amendments[1]?.note).toContain('scope claim');
  });

  it('refuses when the assertion does not match the accumulator the proposal fired on', () => {
    // Raising the wrong law's precision on the strength of another law's evidence would be a
    // silent miscarriage, so the mismatch is checked rather than assumed away by the types.
    const other = PROGRAM.find((a) => a.id !== SUBJECT_ASSERTION.id) as Assertion;
    const mismatched = rejection({ assertion: other });
    expect(mismatched.ok).toBe(false);
    expect(mismatched.ok ? [] : mismatched.error.map((e) => e.at)).toContain('/assertion/id');
  });

  it('refuses a precedent with no pattern — an unlitigated pattern is not case law', () => {
    expect(rejection({ pattern: '   ' }).ok).toBe(false);
  });
});

describe('proposal ACCEPTED — the assertion is amended, the accumulator zeroes (spec 02 §6)', () => {
  const s = scenario(DIFFUSE, 7.5);
  const accepted = unwrap(
    onProposalAccepted({
      proposal: { ...assemble(s).proposal, key: SUBJECT_ASSERTION.id },
      assertion: SUBJECT_ASSERTION,
      invariantsYaml: INVARIANTS_TEXT,
      rationale: 'the boundary moved when the adapter split landed',
    }),
  );

  it('emits a status diff and nothing else — the substance of the amendment is the humans\' argument', () => {
    expect(accepted.nextStatus).toBe('amended');
    expect(accepted.amendments).toHaveLength(1);
    expect(accepted.amendments[0]?.path).toBe('.program/invariants.yaml');
    expect(accepted.amendments[0]?.rationale).toContain('is the reviewer');

    const applied = appliesCleanly('.program/invariants.yaml', INVARIANTS_TEXT, accepted.amendments[0]?.diff as string);
    const after = unwrap(decodeInvariantsFile(parseYaml(applied)));
    expect(after.find((x) => x.id === SUBJECT_ASSERTION.id)?.status).toBe('amended');
    for (const [i, a] of after.entries()) {
      const before = PROGRAM[i] as Assertion;
      expect({ ...a, status: 'x' }).toEqual({ ...before, status: 'x' });
      if (a.id !== SUBJECT_ASSERTION.id) expect(a.status).toBe(before.status);
    }
    // An amended assertion stops being enforced: the mute is a consequence of the patch, not an
    // extra thing the engine has to remember to do (spec 01 §4.2).
    expect(isEnforced(after.find((x) => x.id === SUBJECT_ASSERTION.id) as Assertion)).toBe(false);
  });

  it('refuses to amend a scope claim, which has no status', () => {
    const claim = unwrap(parseAccumulatorKey('src/**'));
    const r = onProposalAccepted({
      proposal: { ...assemble(s).proposal, key: claim },
      assertion: { ...SUBJECT_ASSERTION, id: claim } as unknown as Assertion,
      invariantsYaml: INVARIANTS_TEXT,
      rationale: 'x',
    });
    expect(r.ok).toBe(false);
  });

  it('zeroes the METER and re-arms, and keeps the CENSUS the next proposal ships as evidence', () => {
    const fired = unwrap(foldEvents(s.events, s.knobs)).states.get(KEY);
    if (fired === undefined) throw new Error('no state');
    expect(fired.arm.kind).toBe('fired');
    expect(revealSurprise(fired.value, WARRANT)).toBeGreaterThan(0);

    const zeroed = zeroAccumulator(fired);
    expect(revealSurprise(zeroed.value, WARRANT)).toBe(0);
    expect(zeroed.contributing).toEqual([]);
    expect(zeroed.arm.kind).toBe('armed');

    expect(zeroed.violationCount).toBe(fired.violationCount);
    expect(zeroed.complianceCount).toBe(fired.complianceCount);
    expect(zeroed.abstentionCount).toBe(fired.abstentionCount);
    expect(zeroed.asOf).toBe(fired.asOf);
    expect(zeroed.lastEventAt).toBe(fired.lastEventAt);
    expect(zeroed.knobs).toBe(fired.knobs);
    expect(zeroed.key).toBe(fired.key);
  });

  it('is idempotent, and leaves the state it was given untouched', () => {
    const fired = unwrap(foldEvents(s.events, s.knobs)).states.get(KEY);
    if (fired === undefined) throw new Error('no state');
    const once = zeroAccumulator(fired);
    expect(zeroAccumulator(once)).toEqual(once);
    expect(revealSurprise(fired.value, WARRANT)).toBeGreaterThan(0);
  });

  it('a zeroed accumulator can fire again on new evidence rather than staying silent', () => {
    const fired = unwrap(foldEvents(s.events, s.knobs)).states.get(KEY);
    if (fired === undefined) throw new Error('no state');
    // Waiting for hysteresis would never re-arm a zeroed meter: there is nothing left to decay
    // below 50% of. Zeroing therefore re-arms explicitly (Q-54).
    expect(zeroAccumulator(fired).arm.kind).toBe('armed');
  });
});

describe('proposal IGNORED — governance debt (GLOSSARY, spec 02 §6)', () => {
  const key = (id: string): AccumulatorKey => unwrap(parseAccumulatorKey(id));

  /** The meter measures silence, so the triggering event's content is irrelevant — only its id. */
  const open = (id: string, day: number, kind: 'refactor' | 'reprogram'): IgnoredProposal => {
    const trigger = unwrap(
      sealEvent(
        eventBodyFromVerdict({
          verdict: unwrap(decodeVerdict({ assertion: id, verdict: 'abstain' })) as AbstainVerdict,
          subject: { commit: unwrap(parseCommitSha(shaOf(day))) } as EventSubject,
          judge: JUDGE,
          t: atDay(day),
        }),
      ),
    );
    return { key: key(id), kind, firedAt: atDay(day), triggeredBy: trigger.event };
  };

  it('measures proposal-days, and nothing more clever than that', () => {
    const debt = governanceDebt(
      [open('INV-007', 0, 'reprogram'), open('INV-008', 90, 'refactor')],
      atDay(100),
    );
    expect(debt.openCount).toBe(2);
    expect(debt.proposalDays).toBeCloseTo(110, 9); // 100 unanswered + 10 unanswered
    expect(debt.byKind.reprogram).toBeCloseTo(100, 9);
    expect(debt.byKind.refactor).toBeCloseTo(10, 9);
    expect(debt.oldestAgeDays).toBeCloseTo(100, 9);
    expect(debt.oldestFiredAt).toBe(atDay(0));
  });

  it('is coarse on purpose: ten proposals for a day reads the same as one for ten days', () => {
    const spread = Array.from({ length: 10 }, (_, i) => open(`INV-0${i}0`, 9, 'refactor'));
    const single = [open('INV-007', 0, 'refactor')];
    expect(governanceDebt(spread, atDay(10)).proposalDays).toBeCloseTo(
      governanceDebt(single, atDay(10)).proposalDays,
      9,
    );
  });

  it('does NOT decay — unlike surprise, an ignored proposal is not forgiven by time', () => {
    const p = [open('INV-007', 0, 'reprogram')];
    const early = governanceDebt(p, atDay(30)).proposalDays;
    const late = governanceDebt(p, atDay(3000)).proposalDays;
    expect(late).toBeGreaterThan(early);
    expect(late).toBeCloseTo(3000, 6);
    // Strictly increasing in the observation instant, at any horizon.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 1, max: 5000 }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(governanceDebt(p, atDay(hi)).proposalDays).toBeGreaterThanOrEqual(
          governanceDebt(p, atDay(lo)).proposalDays,
        );
      }),
      { numRuns: 200 },
    );
  });

  it('never runs backwards: a proposal dated after the observation contributes zero, not a credit', () => {
    const debt = governanceDebt([open('INV-007', 500, 'refactor')], atDay(0));
    expect(debt.proposalDays).toBe(0);
    expect(debt.byKind.refactor).toBe(0);
    expect(debt.openCount).toBe(1);
  });

  it('reports zero for an answered backlog, and says so in words', () => {
    const empty = governanceDebt([], atDay(10));
    expect(empty.proposalDays).toBe(0);
    expect(empty.oldestFiredAt).toBeNull();
    expect(renderGovernanceDebt(empty)).toContain('0 proposal-days');
    expect(renderGovernanceDebt(governanceDebt([open('INV-007', 0, 'reprogram')], atDay(10)))).toContain(
      'This meter does not decay',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Text mechanics — the diff and the line-level YAML edit
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('unifiedDiff', () => {
  it('returns null for a no-op rather than an empty patch', () => {
    expect(unifiedDiff('f.yaml', 'a\n', 'a\n')).toBeNull();
  });

  it('produces a patch `git apply` accepts, for a replacement, an insertion and an append', () => {
    const cases: readonly (readonly [string, string, string])[] = [
      ['one\ntwo\nthree\n', 'one\nTWO\nthree\n', 'replacement'],
      ['one\ntwo\n', 'one\ninserted\ntwo\n', 'insertion'],
      ['one\ntwo\n', 'one\ntwo\nthree\n', 'append'],
      ['one\ntwo\n', 'two\n', 'deletion'],
      ['a\n'.repeat(40), `${'a\n'.repeat(20)}b\n${'a\n'.repeat(19)}`, 'mid-file, beyond context'],
      ['no trailing newline', 'no trailing newline!', 'no trailing newline'],
    ];
    for (const [before, after, name] of cases) {
      const diff = unifiedDiff('f.txt', before, after);
      expect(diff, name).not.toBeNull();
      expect(appliesCleanly('f.txt', before, diff as string), name).toBe(after);
    }
  });

  it('names the file on both sides, so the patch is copy-pasteable as-is', () => {
    const diff = unifiedDiff('.program/invariants.yaml', 'a\n', 'b\n') as string;
    expect(diff.startsWith('--- a/.program/invariants.yaml\n+++ b/.program/invariants.yaml\n')).toBe(true);
    expect(diff.endsWith('\n')).toBe(true);
  });
});

describe('replaceAssertionField — a line edit, because the comments are load-bearing law', () => {
  it('preserves indentation and a trailing comment', () => {
    const patched = unwrap(
      replaceAssertionField(INVARIANTS_TEXT, unwrap(parseAccumulatorKey('INV-001')), 'budget', '2.0'),
    );
    expect(patched).toContain('  budget: 2.0            # a single breach');
    expect(patched.split('\n')).toHaveLength(INVARIANTS_TEXT.split('\n').length);
  });

  it('refuses rather than guessing when the id is absent, duplicated, or lacks the field', () => {
    expect(replaceAssertionField(INVARIANTS_TEXT, unwrap(parseAccumulatorKey('INV-999')), 'precision', '1.0').ok).toBe(false);
    const doubled = `${INVARIANTS_TEXT}\n${INVARIANTS_TEXT.slice(INVARIANTS_TEXT.indexOf('- id: INV-001'))}`;
    expect(replaceAssertionField(doubled, unwrap(parseAccumulatorKey('INV-001')), 'precision', '1.0').ok).toBe(false);
    expect(replaceAssertionField(INVARIANTS_TEXT, unwrap(parseAccumulatorKey('INV-001')), 'nonesuch', 'x').ok).toBe(false);
  });

  it('edits the named assertion and no other', () => {
    const patched = unwrap(
      replaceAssertionField(INVARIANTS_TEXT, unwrap(parseAccumulatorKey('INV-006')), 'status', 'contested'),
    );
    const after = unwrap(decodeInvariantsFile(parseYaml(patched)));
    for (const a of after) {
      const before = PROGRAM.find((x) => x.id === a.id) as Assertion;
      expect(a.status).toBe(a.id === 'INV-006' ? 'contested' : before.status);
    }
  });
});

describe('precedent YAML', () => {
  const precedent = unwrap(rejection()).precedent;

  it('replaces the shipped `[]` on the first append and appends beside items afterwards', () => {
    const first = unwrap(appendPrecedentYaml(PRECEDENTS_TEXT, precedent));
    expect(first).not.toContain('[]');
    const second = unwrap(
      appendPrecedentYaml(first, { ...precedent, id: unwrap(parsePrecedentId('PRE-002')) }),
    );
    expect(parseYaml(second)).toHaveLength(2);
    // The header comments survive both appends: they are law, not decoration.
    expect(second).toContain("# Case law accrues here");
  });

  it('refuses a document that is neither empty nor a sequence', () => {
    expect(appendPrecedentYaml('# just a comment\n', precedent).ok).toBe(false);
    expect(appendPrecedentYaml('[]\n- id: PRE-001\n', precedent).ok).toBe(false);
  });

  it('quotes rationale and pattern so a colon or a `#` cannot break the document', () => {
    const nasty = { ...precedent, pattern: 'a: b # c', rationale: 'x: y' };
    const block = renderPrecedentBlock(nasty);
    expect(parseYaml(block)).toEqual([
      { id: nasty.id, pattern: 'a: b # c', ruling: 'affirmed', rationale: 'x: y', evidence: [...EVIDENCE] },
    ]);
  });

  it('picks the lowest free three-digit id above every existing one', () => {
    expect(unwrap(nextPrecedentId([]))).toBe('PRE-001');
    expect(
      unwrap(nextPrecedentId(['PRE-001', 'PRE-009', 'PRE-004'].map((s) => unwrap(parsePrecedentId(s))))),
    ).toBe('PRE-010');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// The sighted port (src/ledger/sighted.ts) — real git, throwaway repositories
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('resolveEvidenceLoci — the only authorship read in the engine (ADR-0003)', () => {
  interface Fixture {
    readonly dir: string;
    readonly live: string;
    readonly orphaned: string;
  }

  let fixture: Fixture | null = null;

  function repo(): Fixture {
    if (fixture !== null) return fixture;
    const dir = initRepo('sighted');
    commitFiles(dir, {
      files: { 'README.md': 'base\n' },
      authorName: 'Base',
      authorEmail: 'base@example.com',
    });
    const live = commitFiles(dir, {
      files: { 'src/core/http.ts': 'export const x = 1;\n', 'src/core/util.ts': 'export const y = 2;\n' },
      authorName: 'Sam Drift',
      authorEmail: 'Sam.Drift@Example.COM',
      message: 'two files, one hand',
    });

    // A commit that no ref reaches any more: the ADR-0004 case. The object survives, the branch
    // does not — exactly what a rebase or a force-push leaves behind.
    git(dir, ['checkout', '-q', '-b', 'doomed']);
    const orphaned = commitFiles(dir, {
      files: { 'src/core/gone.ts': 'export const z = 3;\n' },
      authorName: 'Rebased Away',
      authorEmail: 'rebased@example.com',
      message: 'about to be rewritten',
    });
    git(dir, ['checkout', '-q', 'main']);
    git(dir, ['branch', '-q', '-D', 'doomed']);

    fixture = { dir, live, orphaned };
    return fixture;
  }

  const eventOn = (sha: string, n: number): LedgerEvent =>
    unwrap(
      sealEvent(
        eventBodyFromVerdict({
          verdict: unwrap(
            decodeVerdict({
              assertion: KEY,
              verdict: 'drift',
              severity: 'breach',
              evidence: ['src/core/http.ts:1-1'],
              rationale: 'r',
            }),
          ) as ViolationVerdict,
          subject: { commit: unwrap(parseCommitSha(sha)) } as EventSubject,
          judge: JUDGE,
          t: atDay(n),
          precision_at: unwrap(parsePrecision(0.9)),
          rationale: RATIONALE,
        }),
      ),
    );

  const port = (dir: string) => gitSightedCommitPort(gitCliRunner(dir));

  it(
    'resolves the hand and the seams a live commit touched',
    async () => {
      const f = repo();
      const e = eventOn(f.live, 1);
      const resolution = await resolveEvidenceLoci([e], port(f.dir));

      expect(resolution.unresolved).toEqual([]);
      const r = resolution.resolved.get(e.event);
      expect(r?.attribution).toBe('commit');
      expect(r?.orphaned).toBe(false);
      expect(orphanedCount(resolution)).toBe(0);

      const described = describeEvidenceLocus(r?.locus as EvidenceLocus, WARRANT);
      // Email is the stable identity, lower-cased so `Sam.Drift@Example.COM` and
      // `sam.drift@example.com` are one hand and not two.
      expect(described.actor).toBe('sam.drift@example.com');
      expect([...described.paths].sort()).toEqual(['src/core/http.ts', 'src/core/util.ts']);
    },
    GIT_TEST_TIMEOUT,
  );

  it(
    'KEEPS a commit that was rebased away, marked orphaned (ADR-0004)',
    async () => {
      const f = repo();
      const e = eventOn(f.orphaned, 2);
      const resolution = await resolveEvidenceLoci([e], port(f.dir));

      expect(resolution.unresolved).toEqual([]);
      const r = resolution.resolved.get(e.event);
      expect(r?.orphaned).toBe(true);
      expect(r?.attribution).toBe('orphaned-commit');
      expect(orphanedCount(resolution)).toBe(1);
      // Kept means KEPT: it still carries a hand and a seam, so it still counts toward entropy.
      expect(describeEvidenceLocus(r?.locus as EvidenceLocus, WARRANT).paths).toEqual([
        'src/core/gone.ts',
      ]);
      expect(requireLoci(resolution).ok).toBe(true);
    },
    GIT_TEST_TIMEOUT,
  );

  it(
    "trusts the event's own `orphaned` marker even when git can still reach the commit",
    async () => {
      // The ledger's note survives a later `gc` that the object does not. Either signal marks it.
      const f = repo();
      const base = eventOn(f.live, 3);
      const marked = unwrap(
        sealEvent({ ...base, subject: { ...base.subject, orphaned: true } } as never),
      );
      const resolution = await resolveEvidenceLoci([marked], port(f.dir));
      expect(resolution.resolved.get(marked.event)?.orphaned).toBe(true);
    },
    GIT_TEST_TIMEOUT,
  );

  it(
    'reports a garbage-collected commit as UNRESOLVED rather than attributing it to nobody',
    async () => {
      const f = repo();
      const e = eventOn('deadbeef', 4);
      const resolution = await resolveEvidenceLoci([e], port(f.dir));

      expect(resolution.resolved.size).toBe(0);
      expect(resolution.unresolved[0]?.reason).toBe('commit-missing');
      const required = requireLoci(resolution);
      expect(required.ok).toBe(false);
      expect(required.ok ? [] : required.error.map((x) => x.code)).toEqual(['unresolved-locus']);
      expect(required.ok ? '' : (required.error[0]?.at as string)).toBe(`/events/${e.event}`);
    },
    GIT_TEST_TIMEOUT,
  );

  it(
    'refuses to pick one of a pull request\'s many authors (INV-005 + Q-45)',
    async () => {
      const f = repo();
      const e = unwrap(
        sealEvent(
          eventBodyFromVerdict({
            verdict: unwrap(decodeVerdict({ assertion: KEY, verdict: 'abstain' })) as never,
            subject: { pr: 214 } as EventSubject,
            judge: JUDGE,
            t: atDay(5),
          }),
        ),
      );
      const resolution = await resolveEvidenceLoci([e], port(f.dir));
      expect(resolution.unresolved[0]?.reason).toBe('pr-only-subject');
      expect(resolution.unresolved[0]?.detail).toContain('Q-45');
    },
    GIT_TEST_TIMEOUT,
  );

  it(
    'fails by default on an obsolescence event, and attributes it to SILENCE only on request',
    async () => {
      const f = repo();
      const sweep = unwrap(
        sealEvent(
          eventBodyFromVerdict({
            verdict: unwrap(
              decodeVerdict({
                assertion: 'src/**',
                verdict: 'stale-claim',
                severity: 'bends',
                evidence: ['src/legacy:1-1'],
                rationale: 'nothing has touched this claim in two epochs',
              }),
            ) as ViolationVerdict,
            subject: { path: repoPath('src/legacy') } as EventSubject,
            judge: JUDGE,
            t: atDay(6),
            precision_at: unwrap(parsePrecision(0.7)),
            rationale: RATIONALE,
          }),
        ),
      );

      const strict = await resolveEvidenceLoci([sweep], port(f.dir));
      expect(strict.unresolved[0]?.reason).toBe('silent-subject');
      expect(requireLoci(strict).ok).toBe(false);

      const permissive = await resolveEvidenceLoci([sweep], port(f.dir), {
        silencePolicy: 'attribute-to-silence',
      });
      expect(permissive.unresolved).toEqual([]);
      expect(unattributedCount(permissive)).toBe(1);
      const locus = permissive.resolved.get(sweep.event)?.locus as EvidenceLocus;
      expect(describeEvidenceLocus(locus, WARRANT).actor).toBe(SILENCE_ACTOR_HANDLE);
      // Not a plausible email: a reader must be able to see at a glance that nobody was blamed.
      expect(SILENCE_ACTOR_HANDLE).not.toContain('@');
      expect(lociOf(permissive).size).toBe(1);
    },
    GIT_TEST_TIMEOUT,
  );

  it(
    'reports every unresolved event, not just the first — one pass, every problem',
    async () => {
      const f = repo();
      const events = [eventOn('deadbeef', 7), eventOn('cafebabe', 8), eventOn(f.live, 9)];
      const resolution = await resolveEvidenceLoci(events, port(f.dir));
      expect(resolution.unresolved).toHaveLength(2);
      expect(resolution.resolved.size).toBe(1);
      const required = requireLoci(resolution);
      expect(required.ok ? [] : required.error).toHaveLength(2);
    },
    GIT_TEST_TIMEOUT,
  );

  it(
    'survives a repository that is not a repository at all, without throwing',
    async () => {
      const empty = workspace('not-a-repo');
      const resolution = await resolveEvidenceLoci([eventOn('deadbeef', 10)], port(empty));
      expect(resolution.unresolved[0]?.reason).toBe('commit-missing');
    },
    GIT_TEST_TIMEOUT,
  );

  it(
    'feeds a real end-to-end firing: git -> loci -> dispersion -> proposal',
    async () => {
      const dir = initRepo('e2e');
      const samples: Sample[] = [];
      const events: LedgerEvent[] = [];
      for (let i = 0; i < 10; i += 1) {
        const sha = commitFiles(dir, {
          files: { [`src/mod${i % 8}/handler.ts`]: `export const v${i} = ${i};\n` },
          authorName: `Dev ${i % 5}`,
          authorEmail: `dev${i % 5}@example.com`,
        });
        samples.push({ day: i * 20, n: i, author: `dev${i % 5}@example.com`, path: `src/mod${i % 8}/handler.ts` });
        events.push(
          unwrap(
            sealEvent(
              eventBodyFromVerdict({
                verdict: unwrap(
                  decodeVerdict({
                    assertion: KEY,
                    verdict: 'drift',
                    severity: 'entrenches',
                    evidence: [`src/mod${i % 8}/handler.ts:1-1`],
                    rationale: 'r',
                  }),
                ) as ViolationVerdict,
                subject: { commit: unwrap(parseCommitSha(sha)) } as EventSubject,
                judge: JUDGE,
                t: atDay(i * 20),
                precision_at: unwrap(parsePrecision(0.9)),
                rationale: RATIONALE,
              }),
            ),
          ),
        );
      }

      const knobs = foldKnobs({ budget: unwrap(parseBudget(7.5)), half_life: HALF_LIFE });
      const result = unwrap(foldEvents(events, knobs));
      const firing = result.firings.at(-1) as Firing;
      const trigger = events.find((e) => e.event === firing.triggeredBy) as LedgerEvent;

      const resolution = await resolveEvidenceLoci(events, gitSightedCommitPort(gitCliRunner(dir)));
      const loci = unwrap(requireLoci(resolution));

      const assembled = atFiringTime((w) =>
        unwrap(
          assembleFiring(
            {
              firing,
              trigger,
              loci,
              complianceCount: 3,
              knobs,
              evidenceNotes: [`${orphanedCount(resolution)} of ${events.length} commits were rebased away`],
            },
            w,
          ),
        ),
      );

      expect(assembled.proposal.kind).toBe('reprogram');
      expect(assembled.proposal.evidence.dispersion.authorEntropy.distinct).toBe(5);
      expect(assembled.proposal.evidence.dispersion.pathEntropy.distinct).toBe(8);
      expect(assembled.proposal.evidence.complianceCount).toBe(3);
      expect(assembled.proposal.evidence.dispersion.complianceRatio).toBeCloseTo(3 / 13, 12);
      expect(unwrap(verifyEventId(assembled.event))).toBe(true);

      const rendered = atFiringTime((w) => renderProposal(assembled, w));
      for (const s of samples) expect(rendered).not.toContain(s.author);
      expect(rendered).toContain('reprogram');

      // And the ledger of the repository this suite lives in is untouched: no `refs/program/*`
      // was created anywhere but the throwaway.
      expect(() => git(dir, ['rev-parse', '--verify', 'refs/program/ledger'])).toThrow();
    },
    GIT_TEST_TIMEOUT,
  );
});

describe('parseCommitRecord — pure, so a malformed git response is data and not a crash', () => {
  // The same ASCII UNIT / RECORD separators src/ledger/sighted.ts asks git for, written as
  // escapes rather than literal control bytes so the source stays greppable and diffable.
  const UNIT = '\u001f';
  const RECORD = '\u001e';
  const record = (fields: readonly string[], paths: readonly string[] = []): string =>
    `${fields.join(UNIT)}${RECORD}${paths.join('\n')}\n`;

  it('reads sha, author, committer time and touched paths', () => {
    const r = parseCommitRecord(
      record(['a'.repeat(40), 'Sam@Example.com', 'Sam', '2026-07-21T14:03:00Z'], ['a.ts', 'b.ts']),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.author).toBe('sam@example.com');
    expect(r.value.paths).toEqual(['a.ts', 'b.ts']);
    // Normalized to the mint form, so two resolvers agree byte-for-byte (src/core/time.ts).
    expect(r.value.committedAt).toBe('2026-07-21T14:03:00Z');
  });

  it('falls back to the display name, then to the sha, rather than collapsing anonymous hands', () => {
    const hash = 'b'.repeat(40);
    expect(parseCommitRecord(record([hash, '', 'Nameless', '2026-01-01T00:00:00Z'])).ok).toBe(true);
    const named = parseCommitRecord(record([hash, '', 'Nameless', '2026-01-01T00:00:00Z']));
    expect(named.ok && named.value.author).toBe('Nameless');
    const anonymous = parseCommitRecord(record([hash, '', '', '2026-01-01T00:00:00Z']));
    expect(anonymous.ok && anonymous.value.author).toBe(hash);
  });

  it('fails on a truncated record, a bad sha, a bad timestamp and an unreadable path', () => {
    expect(parseCommitRecord('no record separator').ok).toBe(false);
    expect(parseCommitRecord(record(['a'.repeat(40), 'a@b', 'A'])).ok).toBe(false);
    expect(parseCommitRecord(record(['not-hex', 'a@b', 'A', '2026-01-01T00:00:00Z'])).ok).toBe(false);
    expect(parseCommitRecord(record(['a'.repeat(40), 'a@b', 'A', 'never'])).ok).toBe(false);
    const badPath = parseCommitRecord(
      record(['a'.repeat(40), 'a@b', 'A', '2026-01-01T00:00:00Z'], ['../escape.ts']),
    );
    expect(badPath.ok).toBe(false);
    expect(badPath.ok ? '' : badPath.error.code).toBe('invalid-path');
  });

  it('ignores blank lines in the path list, which git emits between records', () => {
    const r = parseCommitRecord(
      record(['c'.repeat(40), 'a@b', 'A', '2026-01-01T00:00:00Z'], ['a.ts', '', '  ', 'b.ts']),
    );
    expect(r.ok && r.value.paths).toEqual(['a.ts', 'b.ts']);
  });
});
