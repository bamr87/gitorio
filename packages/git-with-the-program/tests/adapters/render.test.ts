// Implements tests for: docs/spec/02-ledger.md §5 ("Every proposal ships its evidence:
// contributing events, dispersion stats, compliance ratio, decay-weighted total"),
// docs/spec/01-core-memory.md §4.2 (`contested` mutes enforcement), docs/vision.md ("the
// bidirectional hinge"), docs/adr/0003-judge-blindness.md (authorship is used ONLY in
// dispersion statistics, and dispersion ships entropy — never names).
//
// The identity test is the load-bearing one. It builds the dispersion statistics from loci that
// really do carry names and email addresses, renders the proposal those statistics produced,
// and asserts that not one character of the identity survives — plus the structural half, that
// this module could not have rendered one even if it wanted to, because it never imports the
// vocabulary in which an identity is spelled.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { ContributingEvent, FoldKnobs } from '../../src/core/accumulator.js';
import { REARM_FRACTION_DEFAULT } from '../../src/core/accumulator.js';
import { decodeAssertion, isInvariantAssertion, parseBudget } from '../../src/core/assertion.js';
import type { NonEmptyReadonlyArray } from '../../src/core/brand.js';
import { findDeliveryMarker, deliveryKey } from '../../src/core/delivery.js';
import { computeDispersion, type EvidenceLocus } from '../../src/core/dispersion.js';
import type { DispersionStats } from '../../src/core/dispersion.js';
import type { AccumulatorKey, EventId } from '../../src/core/ids.js';
import { parseAccumulatorKey, parseEventId } from '../../src/core/ids.js';
import { parseRepoPath } from '../../src/core/paths.js';
import type { Proposal, ProposalKind } from '../../src/core/proposal.js';
import { unwrap } from '../../src/core/result.js';
import { actorGroupKey, actorId, surprise, withSentencingWarrant } from '../../src/core/sentencing.js';
import { MILLIS_PER_DAY, parseCommitterTime, parseDuration } from '../../src/core/time.js';
import type { CommitterTime } from '../../src/core/time.js';

import {
  appendFlowSequence,
  buildAmendment,
  findAssertionBlock,
  INVARIANTS_PATH,
  replacementDiff,
  yamlScalar,
} from '../../src/adapters/github/amendment.js';
import {
  MAX_RENDERED_EVENTS,
  formatSpan,
  proposalLabels,
  renderProposal,
  replayCommand,
  shortEvent,
} from '../../src/adapters/github/render.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A test file is not under `src/judge/**` or `src/evidence/**`, so it may hold a warrant —
 * that is precisely where `scripts/check-inv003.ts` draws the line (Q-39, Q-40).
 */
const WARRANT = withSentencingWarrant((w) => w);

const KEY = unwrap(parseAccumulatorKey('INV-007')) as AccumulatorKey;
const t = (s: string): CommitterTime => unwrap(parseCommitterTime(s));
/** Distinct in the FIRST 12 hex, so `shortEvent` abbreviations differ the way real ids do. */
const evid = (n: number): EventId =>
  unwrap(parseEventId(`sha256:${n.toString(16).padStart(8, 'a')}${'0'.repeat(56)}`));
const rp = (s: string) => unwrap(parseRepoPath(s));

/** Prose assertions run on flattened whitespace: content, not line wrapping (SEED-02 tests). */
const flat = (s: string): string => s.replace(/\s+/g, ' ');

const dayAt = (day: number): CommitterTime =>
  t(new Date(Date.UTC(2026, 0, 1) + day * MILLIS_PER_DAY).toISOString().replace(/\.\d{3}Z$/, 'Z'));

const KNOBS: FoldKnobs = {
  halfLife: unwrap(parseDuration('90d')),
  budget: unwrap(parseBudget(3)),
  precisionOverride: null,
  rearmFraction: REARM_FRACTION_DEFAULT,
};

const ASSERTION = unwrap(
  decodeAssertion({
    id: 'INV-007',
    statement: 'Core stays dependency-free; adapters own all third-party imports',
    class: 'boundary',
    scope: ['src/core/**'],
    enforcement: 'judgment',
    precision: 0.9,
    budget: 3.0,
    half_life: '90d',
    status: 'ratified',
    provenance: ['pr#41', 'adr-0003'],
  }),
);

interface Spec {
  readonly n: number;
  readonly day: number;
  readonly who: string;
  readonly path: string;
  readonly weight: number;
}

function contributing(specs: readonly Spec[]): NonEmptyReadonlyArray<ContributingEvent> {
  const events = specs.map(
    (s): ContributingEvent => ({
      event: evid(s.n),
      key: KEY,
      t: dayAt(s.day),
      verdict: 'drift',
      rawWeight: s.weight,
      residualWeight: surprise(s.weight * 0.8),
    }),
  );
  return events as unknown as NonEmptyReadonlyArray<ContributingEvent>;
}

function loci(specs: readonly Spec[]): ReadonlyMap<EventId, EvidenceLocus> {
  return new Map(
    specs.map((s) => [
      evid(s.n),
      { event: evid(s.n), actor: actorId(s.who), paths: [rp(s.path)] } satisfies EvidenceLocus,
    ]),
  );
}

function statsFor(specs: readonly Spec[], complianceCount: number): DispersionStats {
  return unwrap(
    computeDispersion(
      { key: KEY, contributing: contributing(specs), loci: loci(specs), complianceCount },
      WARRANT,
    ),
  );
}

/** One hand, one seam, a tight window — the refactor signature (spec 02 §5). */
const CONCENTRATED: readonly Spec[] = [
  { n: 1, day: 1, who: 'Amr Abdelaziz <amr.abdel@example.com>', path: 'src/core/http.ts', weight: 1 },
  { n: 2, day: 2, who: 'Amr Abdelaziz <amr.abdel@example.com>', path: 'src/core/http.ts', weight: 1 },
  { n: 3, day: 4, who: 'Amr Abdelaziz <amr.abdel@example.com>', path: 'src/core/http.ts', weight: 1 },
];

/** Many hands, many seams, sustained over months — the reprogram signature. */
const DISPERSED: readonly Spec[] = Array.from({ length: 6 }, (_, i) => ({
  n: 10 + i,
  day: i * 32,
  who: `contributor-${i}@example.com`,
  path: `src/core/module-${i}.ts`,
  weight: 1,
}));

function proposalFor(kind: ProposalKind, specs: readonly Spec[], complianceCount: number): Proposal {
  return {
    kind,
    key: KEY,
    firedAt: dayAt(200),
    triggeredBy: evid(999),
    evidence: {
      contributing: contributing(specs),
      dispersion: statsFor(specs, complianceCount),
      violationCount: specs.length,
      complianceCount,
      accumulated: surprise(3.12),
      budget: KNOBS.budget,
      knobs: KNOBS,
    },
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');

const FIXTURE_YAML = [
  '# GWTP invariants fixture.',
  '',
  '- id: INV-006',
  '  statement: Something earlier',
  '  class: convention',
  '  scope: ["schemas/**"]',
  '  enforcement: deterministic',
  '  precision: 0.7',
  '  budget: 3.0',
  '  half_life: 90d',
  '  status: ratified',
  '  provenance: [seeds/SEED-01-scaffold.md]',
  '',
  '- id: INV-007',
  '  statement: Core stays dependency-free; adapters own all third-party imports',
  '  class: boundary',
  '  scope: ["src/core/**"]',
  '  enforcement: judgment',
  '  precision: 0.9',
  '  budget: 3.0            # accumulated surprise before a proposal fires',
  '  half_life: 90d',
  '  status: ratified',
  '  provenance: [pr#41, adr-0003]',
  '',
  '- id: INV-008',
  '  statement: Something later',
  '  class: behavior',
  '  scope: ["src/**"]',
  '  enforcement: hybrid',
  '  precision: 0.5',
  '  budget: 2.0',
  '  half_life: 30d',
  '  status: ratified',
  '  provenance: [design-thread-2026-07]',
  '',
].join('\n');

function amendmentFor(specs: readonly Spec[] = DISPERSED) {
  const assertion = ASSERTION;
  if (!isInvariantAssertion(assertion)) throw new Error('fixture is not an invariant assertion');
  const proposal = proposalFor('reprogram', specs, 2);
  return unwrap(
    buildAmendment({
      assertion,
      currentText: FIXTURE_YAML,
      triggeredBy: proposal.triggeredBy,
      firedAt: proposal.firedAt,
    }),
  );
}

// ---------------------------------------------------------------------------
// Rendering — the refactor arm
// ---------------------------------------------------------------------------

describe('renderProposal — refactor: "the assertion stands, the change is wrong"', () => {
  const doc = unwrap(
    renderProposal(
      { proposal: proposalFor('refactor', CONCENTRATED, 12), assertion: ASSERTION, amendment: null },
      WARRANT,
    ),
  );

  it('titles and labels itself as a refactoring recommendation', () => {
    expect(doc.kind).toBe('refactor');
    expect(doc.title).toContain('Refactoring recommendation');
    expect(doc.title).toContain('INV-007');
    expect(doc.labels).toContain('gwtp-proposal');
    expect(doc.labels).toContain('gwtp:refactor');
  });

  it('reads as an argument that the CODE is wrong and the law stands', () => {
    expect(doc.body).toContain('The assertion stands. The change is wrong.');
    expect(doc.body).toContain('attributes the drift to the **code**');
    expect(doc.body).toContain('does not question `INV-007`');
    expect(doc.body).toContain('nothing under `.program/` changes');
  });

  it('quotes the assertion and its statement (spec 01 §3)', () => {
    expect(doc.body).toContain('INV-007');
    expect(doc.body).toContain('Core stays dependency-free; adapters own all third-party imports');
    expect(doc.body).toContain('src/core/**');
    expect(doc.body).toContain('status: ratified');
  });

  it('ships the decay-weighted total against the budget (spec 02 §5)', () => {
    expect(doc.body).toContain('decay-weighted total at firing');
    expect(doc.body).toContain('3.120');
    expect(doc.body).toContain('| budget | 3.000 |');
    expect(doc.body).toContain('over budget by');
    expect(doc.body).toContain('A ← A · 2^(−Δt / half_life) + precision_at · severity');
  });

  it('ships every contributing event with its committer time and residual weight', () => {
    expect(doc.body).toContain('## Contributing events');
    for (const s of CONCENTRATED) {
      expect(doc.body).toContain(shortEvent(evid(s.n)));
      expect(doc.body).toContain(dayAt(s.day));
    }
    // residualWeight is 0.8 * rawWeight in the fixture; the raw term is 1.
    expect(doc.body).toContain('| 1.000 | 0.800 |');
    expect(doc.body).toContain('Committer time, not observation time (ADR-0004)');
  });

  it('ships all four dispersion statistics (spec 02 §5)', () => {
    expect(doc.body).toContain('## Dispersion (spec 02 §5)');
    expect(doc.body).toContain('author entropy');
    expect(doc.body).toContain('path entropy');
    expect(doc.body).toContain('time spread');
    expect(doc.body).toContain('compliance ratio');
    // One hand, one seam: zero entropy either way.
    expect(doc.body).toContain('0.000 normalized (0.000 bits over 1 distinct hands)');
    expect(doc.body).toContain('0.000 normalized (0.000 bits over 1 distinct paths)');
    // 12 aligned out of 15 observations (Q-19's bounded reading).
    expect(doc.body).toContain('80.0% (12 aligned / 15 observed)');
  });

  it('ships the knobs it folded with, plus the digest that invalidates the cache', () => {
    expect(doc.body).toContain('## Knobs used');
    expect(doc.body).toContain('`half_life` | `90d`');
    expect(doc.body).toContain('re-arm fraction');
    expect(doc.body).toContain('knobs digest');
    expect(doc.body).toMatch(/knobs digest \| `sha256:[0-9a-f]{64}`/);
  });

  it('ships the replay command that reproduces the firing', () => {
    // Flags must be ones `gwtp ledger replay` actually accepts (REPLAY_OPTIONS): --key selects the
    // accumulator, --half-life/--budget/--precision are the retunable knobs. --assertion and --rearm
    // are NOT replay flags — a bundle that emitted them shipped a command the CLI rejects.
    expect(doc.body).toContain('gwtp ledger replay --key INV-007');
    expect(doc.body).toContain('--half-life 90d');
    expect(doc.body).toContain('--budget 3');
    expect(doc.body).not.toContain('--rearm');
    expect(doc.body).not.toContain('--assertion');
    expect(doc.body).not.toContain('--precision');
  });

  it('carries no patch: a refactor never touches the constitution', () => {
    expect(doc.patches).toEqual([]);
    expect(doc.body).not.toContain('```diff');
  });

  it('embeds the delivery marker, keyed on assertion + firing event id', () => {
    expect(findDeliveryMarker(doc.body)).toBe(doc.key);
    expect(doc.key).toBe(deliveryKey(KEY, evid(999)));
    expect(doc.key).toContain('INV-007');
  });

  it('is self-contained: the body repeats its own title as an H1', () => {
    expect(doc.body.startsWith('# ')).toBe(true);
    expect(doc.body.split('\n')[0]).toContain('Refactoring recommendation');
  });
});

// ---------------------------------------------------------------------------
// Rendering — the reprogram arm
// ---------------------------------------------------------------------------

describe('renderProposal — reprogram: "the law is wrong"', () => {
  const amendment = amendmentFor();
  const doc = unwrap(
    renderProposal(
      { proposal: proposalFor('reprogram', DISPERSED, 2), assertion: ASSERTION, amendment },
      WARRANT,
    ),
  );

  it('titles and labels itself as a reprogramming proposal', () => {
    expect(doc.kind).toBe('reprogram');
    expect(doc.title).toContain('Reprogramming proposal');
    expect(doc.labels).toContain('gwtp:reprogram');
  });

  it('reads as an argument that the LAW is wrong, not that a rule was broken', () => {
    const body = flat(doc.body);
    expect(body).toContain('The law is wrong.');
    expect(body).toContain(
      'This is not a report that `INV-007` was violated. It is an argument that `INV-007` should not say what it says.',
    );
    expect(body).toContain('already outvoted the statute in practice');
    expect(body).toContain('bidirectional hinge');
    expect(body).toContain('a nag, not a governor');
  });

  it('states that the assertion goes `contested` and that enforcement MUTES (spec 01 §4.2)', () => {
    const body = flat(doc.body);
    expect(body).toContain('`status: contested`');
    expect(body).toContain('**enforcement mutes** while it is contested');
    expect(body).toContain(
      'GWTP stops citing violations of `INV-007` until a human ratifies or rejects the amendment',
    );
    expect(body).toContain('You do not keep citing someone for a law under active renegotiation');
  });

  it('states the post-fire lifecycle in full (spec 02 §6)', () => {
    const body = flat(doc.body);
    expect(body).toContain('Hysteresis, not reset');
    expect(body).toContain('the assertion goes `amended`, the accumulator zeroes');
    expect(body).toContain('an `affirmed` precedent is written');
    expect(body).toContain('*rises*');
    expect(body).toContain('governance debt');
  });

  it('cites the dispersion that justifies the direction', () => {
    const body = flat(doc.body);
    expect(body).toContain('6 independent hands');
    expect(body).toContain('6 distinct paths');
    expect(body).toContain(`sustained over ${formatSpan(160 * MILLIS_PER_DAY)}`);
  });

  it('ships the `.program/` patch, as a patch and never as a commit (INV-001)', () => {
    expect(doc.patches).toHaveLength(1);
    expect(doc.patches[0]?.path).toBe(INVARIANTS_PATH);
    expect(doc.body).toContain('```diff');
    expect(doc.body).toContain('-  status: ratified');
    expect(doc.body).toContain('+  status: contested');
    expect(doc.body).toContain('patch, not a commit');
    expect(doc.body).toContain('git apply');
  });

  it('still ships the full evidence bundle — a reprogram is an argument FROM evidence', () => {
    expect(doc.body).toContain('## The meter');
    expect(doc.body).toContain('## Contributing events');
    expect(doc.body).toContain('## Dispersion (spec 02 §5)');
    expect(doc.body).toContain('## Knobs used');
    expect(doc.body).toContain('gwtp ledger replay');
  });

  it('says so plainly when no patch could be generated', () => {
    const orphan = unwrap(
      renderProposal(
        { proposal: proposalFor('reprogram', DISPERSED, 2), assertion: null, amendment: null },
        WARRANT,
      ),
    );
    expect(orphan.patches).toEqual([]);
    expect(orphan.body).toContain('No `.program/` patch could be generated');
    expect(orphan.body).toContain('scope claim');
  });
});

// ---------------------------------------------------------------------------
// INV-003 — dispersion ships entropy, not names
// ---------------------------------------------------------------------------

describe('INV-003: no author identity can reach rendered output', () => {
  /**
   * Derived from the fixtures rather than hand-listed, so the test cannot rot into checking a
   * stale subset: EVERY handle the loci carried, plus each of its parts, because "leaks the
   * email but not the display name" is still a leak.
   */
  function identitiesIn(specs: readonly Spec[]): readonly string[] {
    const out = new Set<string>();
    for (const s of specs) {
      out.add(s.who);
      for (const part of s.who.split(/[<>\s]+/)) if (part.length > 2) out.add(part);
    }
    return [...out];
  }

  it.each(['refactor', 'reprogram'] as const)(
    'renders a %s proposal whose loci carried names and emails, and leaks neither',
    (kind) => {
      const specs = kind === 'refactor' ? CONCENTRATED : DISPERSED;
      const doc = unwrap(
        renderProposal(
          {
            proposal: proposalFor(kind, specs, 4),
            assertion: ASSERTION,
            amendment: kind === 'reprogram' ? amendmentFor(specs) : null,
          },
          WARRANT,
        ),
      );
      const everything = `${doc.title}\n${doc.body}\n${doc.labels.join('\n')}\n${JSON.stringify(
        doc.patches,
      )}`;

      const identities = identitiesIn(specs);
      expect(identities.length).toBeGreaterThan(0);
      for (const identity of identities) {
        expect(everything, `rendered output leaked ${identity}`).not.toContain(identity);
      }

      // And it is not vacuous. The identity really was live in the pipeline that produced
      // these statistics: the value the loci carried still spells the handle out in full.
      for (const s of specs) {
        expect(actorGroupKey(actorId(s.who))).toContain(s.who);
      }
      // Dispersion saw enough of them to count: the cardinality survives, the handles do not.
      expect(doc.body).toContain(
        `${statsFor(specs, 4).authorEntropy.distinct} distinct hands`,
      );
    },
  );

  it('publishes the CARDINALITY of hands, which is what spec 02 §5 asks for', () => {
    const doc = unwrap(
      renderProposal(
        { proposal: proposalFor('reprogram', DISPERSED, 2), assertion: ASSERTION, amendment: amendmentFor() },
        WARRANT,
      ),
    );
    expect(doc.body).toContain('6 distinct hands');
    expect(doc.body).toContain('No contributor is named here, and none can be');
  });

  it('is structural: render.ts never names the vocabulary an identity is spelled in', () => {
    const source = readFileSync(join(REPO_ROOT, 'src/adapters/github/render.ts'), 'utf8');
    // Strip the module header's prose, which discusses these names on purpose.
    const code = source.slice(source.indexOf("import type { ContributingEvent"));
    for (const forbidden of ['EvidenceLocus', 'actorId', 'revealActor', 'SightedCommit', 'ActorId']) {
      expect(code, `render.ts names ${forbidden}`).not.toContain(forbidden);
    }
    // The one declassifier it DOES hold, so the audit stays a grep (ADR-0003).
    expect(code).toContain('revealSurprise');
    expect(code).toContain('SentencingWarrant');
  });

  it('takes the warrant from its caller rather than minting one', () => {
    const source = readFileSync(join(REPO_ROOT, 'src/adapters/github/render.ts'), 'utf8');
    expect(source).not.toContain('withSentencingWarrant(');
    expect(renderProposal.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Rendering — guards and helpers
// ---------------------------------------------------------------------------

describe('renderProposal guards', () => {
  it('refuses an assertion that is not the one that fired', () => {
    const other = unwrap(
      decodeAssertion({
        ...JSON.parse(JSON.stringify({})),
        id: 'INV-999',
        statement: 'A different law entirely',
        class: 'behavior',
        scope: ['src/**'],
        enforcement: 'judgment',
        precision: 0.5,
        budget: 2.0,
        half_life: '30d',
        status: 'ratified',
        provenance: ['design-thread-2026-07'],
      }),
    );
    const r = renderProposal(
      { proposal: proposalFor('refactor', CONCENTRATED, 1), assertion: other, amendment: null },
      WARRANT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-id');
  });

  it('refuses an "amendment" that points outside .program/', () => {
    const bad = { ...amendmentFor(), path: 'src/core/index.ts' };
    const r = renderProposal(
      { proposal: proposalFor('reprogram', DISPERSED, 1), assertion: ASSERTION, amendment: bad },
      WARRANT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-path');
  });

  it('caps the event table and says so rather than truncating evidence silently', () => {
    const many: Spec[] = Array.from({ length: MAX_RENDERED_EVENTS + 7 }, (_, i) => ({
      n: 1000 + i,
      day: i,
      who: `dev-${i}`,
      path: `src/core/f${i}.ts`,
      weight: 1,
    }));
    const doc = unwrap(
      renderProposal(
        { proposal: proposalFor('refactor', many, 0), assertion: ASSERTION, amendment: null },
        WARRANT,
      ),
    );
    expect(doc.body).toContain('and 7 further event(s), omitted');
    expect(doc.body).toContain('the replay command below recomputes the full set');
  });

  it('emits --precision only for a counterfactual replay (spec 02 §1 property 3)', () => {
    expect(replayCommand(KEY, KNOBS)).not.toContain('--precision');
    expect(
      replayCommand(KEY, { ...KNOBS, precisionOverride: 0.5 as FoldKnobs['precisionOverride'] }),
    ).toContain('--precision 0.5');
  });

  it('formats a span in human units, never in raw milliseconds', () => {
    expect(formatSpan(160 * MILLIS_PER_DAY)).toBe('160d 0h');
    expect(formatSpan(3 * 3_600_000 + 12 * 60_000)).toBe('3h 12m');
    expect(formatSpan(0)).toBe('0m');
  });

  it('never duplicates a label', () => {
    expect(proposalLabels('refactor', ['gwtp-proposal', 'triage'])).toEqual([
      'gwtp-proposal',
      'gwtp:refactor',
      'triage',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The amendment patch
// ---------------------------------------------------------------------------

describe('buildAmendment — the machine proposes, the human ratifies', () => {
  const patch = amendmentFor();

  it('targets .program/invariants.yaml and nothing else', () => {
    expect(patch.path).toBe(INVARIANTS_PATH);
    expect(patch.diff).toContain('--- a/.program/invariants.yaml');
    expect(patch.diff).toContain('+++ b/.program/invariants.yaml');
    expect(patch.diff.split('\n').filter((l) => l.startsWith('--- '))).toHaveLength(1);
  });

  it('sets status to contested — automatic under spec 01 §4.2, not a proposal', () => {
    expect(patch.diff).toContain('-  status: ratified');
    expect(patch.diff).toContain('+  status: contested');
    expect(patch.changes.map((c) => c.field)).toContain('status');
  });

  it('cites the firing event in provenance (spec 01 §4 rule 1)', () => {
    expect(patch.diff).toContain('-  provenance: [pr#41, adr-0003]');
    expect(patch.diff).toContain('"ledger-event:');
    expect(patch.provenance).toContain('fired by ledger event');
    expect(patch.provenance).toContain(evid(999));
    expect(patch.provenance).toContain('INV-007');
  });

  it('touches only the assertion that fired, not its neighbours', () => {
    // CONTEXT lines are allowed to mention a neighbour — three lines of context either side is
    // what makes the hunk applyable, and `- id: INV-008` legitimately appears as one. What must
    // never appear is a CHANGED line outside the block that fired.
    const changed = patch.diff
      .split('\n')
      .filter((l) => /^[-+]/.test(l) && !l.startsWith('---') && !l.startsWith('+++'));
    expect(changed.filter((l) => l.startsWith('-'))).toHaveLength(2);
    expect(changed.filter((l) => l.startsWith('+'))).toHaveLength(2);
    for (const line of changed) {
      expect(line, `an edit escaped INV-007's block: ${line}`).not.toContain('INV-006');
      expect(line, `an edit escaped INV-007's block: ${line}`).not.toContain('INV-008');
    }
    // Exactly the two fields spec 01 §4.2 and §4 rule 1 make mandatory, and no third.
    expect(changed.map((l) => l.slice(1).trim().split(':')[0]).sort()).toEqual([
      'provenance',
      'provenance',
      'status',
      'status',
    ]);
  });

  it('explains itself, and says why it is a patch rather than a commit', () => {
    expect(patch.rationale).toContain('INV-001');
    expect(patch.rationale).toContain('patch, not a commit');
    expect(patch.rationale).toContain('affirmed');
    expect(patch.rationale).toContain('| field | current | proposed | why |');
  });

  it('carries a counter-statement and retuned knobs when the proposal argues for them', () => {
    const assertion = ASSERTION;
    if (!isInvariantAssertion(assertion)) throw new Error('fixture');
    const p = unwrap(
      buildAmendment({
        assertion,
        currentText: FIXTURE_YAML,
        triggeredBy: evid(999),
        firedAt: dayAt(200),
        proposedStatement: 'Core stays dependency-free except for well-audited stdlib shims',
        proposedKnobs: { precision: 0.6, budget: 6, halfLife: '180d' },
      }),
    );
    expect(p.diff).toContain('+  statement: Core stays dependency-free except for well-audited stdlib shims');
    expect(p.diff).toContain('+  precision: 0.6');
    expect(p.diff).toContain('+  budget: 6');
    expect(p.diff).toContain('+  half_life: 180d');
    // `status` and `provenance` are unconditional (spec 01 §4.2, §4 rule 1); the other three
    // are the counter-proposal the caller supplied. Nothing is inferred from the evidence (Q-52).
    expect(p.changes.map((c) => c.field).sort()).toEqual([
      'budget',
      'half_life',
      'precision',
      'provenance',
      'statement',
      'status',
    ]);
  });

  it('preserves a trailing comment on a knob line it rewrites', () => {
    const assertion = ASSERTION;
    if (!isInvariantAssertion(assertion)) throw new Error('fixture');
    const p = unwrap(
      buildAmendment({
        assertion,
        currentText: FIXTURE_YAML,
        triggeredBy: evid(999),
        firedAt: dayAt(200),
        proposedKnobs: { budget: 6 },
      }),
    );
    // The fixture's budget line carries `# accumulated surprise before a proposal fires`.
    // In-place scalar rewriting keeps the value AND drops nothing a human wrote as context.
    expect(p.diff).toContain('-  budget: 3.0            # accumulated surprise before a proposal fires');
    expect(p.diff).toContain('+  budget: 6');
  });

  it('fails loudly when the assertion is not in the file', () => {
    const assertion = ASSERTION;
    if (!isInvariantAssertion(assertion)) throw new Error('fixture');
    const r = buildAmendment({
      assertion,
      currentText: '- id: INV-001\n  status: ratified\n  provenance: [x]\n',
      triggeredBy: evid(999),
      firedAt: dayAt(200),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('missing-field');
  });

  it('refuses to aim a constitutional amendment outside .program/', () => {
    const assertion = ASSERTION;
    if (!isInvariantAssertion(assertion)) throw new Error('fixture');
    const r = buildAmendment({
      assertion,
      currentText: FIXTURE_YAML,
      path: 'src/core/index.ts',
      triggeredBy: evid(999),
      firedAt: dayAt(200),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-path');
  });
});

describe('the diff generator', () => {
  it('emits a correct hunk header for an in-place replacement', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const after = [...before];
    after[4] = 'E';
    const d = unwrap(replacementDiff('f.txt', before, after, 3));
    expect(d).toContain('@@ -2,7 +2,7 @@');
    expect(d).toContain('-e');
    expect(d).toContain('+E');
    expect(d.split('\n').filter((l) => l.startsWith('@@'))).toHaveLength(1);
  });

  it('splits distant changes into separate hunks and merges near ones', () => {
    const before = Array.from({ length: 40 }, (_, i) => `l${i}`);
    const near = [...before];
    near[5] = 'X';
    near[8] = 'Y';
    expect(unwrap(replacementDiff('f', before, near)).split('\n').filter((l) => l.startsWith('@@'))).toHaveLength(1);

    const far = [...before];
    far[5] = 'X';
    far[30] = 'Y';
    expect(unwrap(replacementDiff('f', before, far)).split('\n').filter((l) => l.startsWith('@@'))).toHaveLength(2);
  });

  it('is empty when nothing changed, and refuses unequal line counts', () => {
    expect(unwrap(replacementDiff('f', ['a'], ['a']))).toBe('');
    expect(replacementDiff('f', ['a'], ['a', 'b']).ok).toBe(false);
  });

  it('locates an assertion block by id, bounded by the next list item', () => {
    const lines = FIXTURE_YAML.split('\n');
    const block = findAssertionBlock(lines, 'INV-007');
    expect(block).not.toBeNull();
    expect(lines[block?.start ?? -1]).toBe('- id: INV-007');
    expect(lines[(block?.end ?? 0) - 1]).toBe('');
    expect(findAssertionBlock(lines, 'INV-404')).toBeNull();
  });

  it('quotes a YAML scalar only when a plain one would be ambiguous', () => {
    expect(yamlScalar('90d')).toBe('90d');
    expect(yamlScalar('Core stays dependency-free')).toBe('Core stays dependency-free');
    expect(yamlScalar('a: b')).toBe('"a: b"');
    expect(yamlScalar('# not a comment')).toBe('"# not a comment"');
  });

  it('appends to a flow sequence idempotently, and declines a block sequence', () => {
    expect(appendFlowSequence('[a, b]', '"c"')).toBe('[a, b, "c"]');
    expect(appendFlowSequence('[]', '"c"')).toBe('["c"]');
    expect(appendFlowSequence('[a, "c"]', '"c"')).toBe('[a, "c"]');
    expect(appendFlowSequence('', '"c"')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The patch has to actually apply — verified in a THROWAWAY repo under $TMPDIR
// ---------------------------------------------------------------------------

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!gitAvailable())('the amendment is a real patch', () => {
  /**
   * Against the repository's OWN `.program/invariants.yaml`, read-only, in a scratch clone
   * under $TMPDIR. Deliberately epoch-independent per OPEN-QUESTIONS Q-38: it asserts that
   * whatever the current status is, the patch applies and the result is `contested` — never
   * that the current status is any particular value.
   */
  it('applies cleanly to this repo\'s real .program/invariants.yaml via `git apply --check`', () => {
    const assertion = ASSERTION;
    if (!isInvariantAssertion(assertion)) throw new Error('fixture');

    const realText = readFileSync(join(REPO_ROOT, '.program/invariants.yaml'), 'utf8');
    const firstId = /^- id: (\S+)$/m.exec(realText)?.[1];
    expect(firstId).toBeDefined();

    const target = unwrap(
      decodeAssertion({
        id: firstId,
        statement: 'placeholder statement, long enough',
        class: 'boundary',
        scope: ['**'],
        enforcement: 'deterministic',
        precision: 1.0,
        budget: 1.0,
        half_life: '365d',
        status: 'ratified',
        provenance: ['x'],
      }),
    );
    if (!isInvariantAssertion(target)) throw new Error('fixture');

    const patch = unwrap(
      buildAmendment({
        assertion: target,
        currentText: realText,
        triggeredBy: evid(999),
        firedAt: dayAt(200),
      }),
    );
    expect(patch.diff).toContain('+  status: contested');

    // THROWAWAY repo. Nothing here touches the repository under test.
    const scratch = mkdtempSync(join(tmpdir(), 'gwtp-amendment-'));
    execFileSync('git', ['init', '--quiet', scratch], { stdio: 'ignore' });
    mkdirSync(join(scratch, '.program'), { recursive: true });
    writeFileSync(join(scratch, '.program/invariants.yaml'), realText, 'utf8');
    const patchFile = join(scratch, 'amendment.patch');
    writeFileSync(patchFile, patch.diff, 'utf8');

    expect(() =>
      execFileSync('git', ['apply', '--check', '-p1', patchFile], {
        cwd: scratch,
        stdio: 'pipe',
      }),
    ).not.toThrow();

    // And the applied result really does read `contested`.
    execFileSync('git', ['apply', '-p1', patchFile], { cwd: scratch, stdio: 'pipe' });
    const applied = readFileSync(join(scratch, '.program/invariants.yaml'), 'utf8');
    const block = findAssertionBlock(applied.split('\n'), firstId as string);
    const blockText = applied
      .split('\n')
      .slice(block?.start ?? 0, block?.end ?? 0)
      .join('\n');
    expect(blockText).toContain('status: contested');
    expect(blockText).toContain('ledger-event:');
  });
});
