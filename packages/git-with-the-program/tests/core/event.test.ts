// Implements tests for: docs/spec/02-ledger.md §1-3 (content-addressed events, supersession
// chains), docs/adr/0002-event-sourced-ledger.md, INV-002 (append-only).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { hashBlob } from '../../src/core/canonical.js';
import {
  canonicalEventBody,
  compareForFold,
  decodeLedgerEvent,
  eventBodyFromVerdict,
  eventFileName,
  eventFilePath,
  eventIdOf,
  isViolationEvent,
  judgeHash,
  resolveSupersessions,
  sealEvent,
  supersede,
  verifyEventId,
  type EventSubject,
  type JudgeRef,
  type LedgerEvent,
  type MintNonViolationInput,
  type MintViolationInput,
} from '../../src/core/event.js';
import {
  parseCommitSha,
  parseJudgeId,
  parsePullRequestNumber,
  parseRationaleRef,
  sha256RefHex,
  type EventId,
} from '../../src/core/ids.js';
import { unwrap } from '../../src/core/result.js';
import { parseCommitterTime } from '../../src/core/time.js';
import { decodeVerdict, type AlignedVerdict, type ViolationVerdict } from '../../src/core/verdict.js';
import { parsePrecision } from '../../src/core/assertion.js';

const t = (s: string) => unwrap(parseCommitterTime(s));

const JUDGE: JudgeRef = { kind: 'model', id: unwrap(parseJudgeId('claude-invariant-judge')) };

const SUBJECT: EventSubject = {
  commit: unwrap(parseCommitSha('9f2c1d')),
  pr: unwrap(parsePullRequestNumber(214)),
} as EventSubject;

const DRIFT = unwrap(
  decodeVerdict({
    assertion: 'INV-007',
    verdict: 'drift',
    severity: 'breach',
    confidence: 0.8,
    evidence: ['core/http.rs:41-58'],
    rationale: 'Imports reqwest inside core/, bypassing the adapter boundary.',
  }),
) as ViolationVerdict;

const ALIGNED = unwrap(
  decodeVerdict({ assertion: 'INV-007', verdict: 'aligned', confidence: 0.95 }),
) as AlignedVerdict;

const RATIONALE = unwrap(parseRationaleRef(hashBlob('the full rationale text')));
const PRECISION = unwrap(parsePrecision(0.9));

const violationInput: MintViolationInput = {
  verdict: DRIFT,
  subject: SUBJECT,
  judge: JUDGE,
  t: t('2026-07-21T14:03:00Z'),
  precision_at: PRECISION,
  rationale: RATIONALE,
};

const alignedInput: MintNonViolationInput = {
  verdict: ALIGNED,
  subject: SUBJECT,
  judge: JUDGE,
  t: t('2026-07-21T14:03:00Z'),
};

describe('spec 02 §2 — the observation record', () => {
  it('applies the ordinal -> numeric severity mapping exactly once, at mint time', () => {
    const body = eventBodyFromVerdict(violationInput);
    expect(body.verdict).toBe('drift');
    expect(body.severity).toBe(0.75);
    expect(body.precision_at).toBe(0.9);
    expect(body.rationale).toBe(RATIONALE);
  });

  it('carries the assertion key from the verdict, not from the caller', () => {
    expect(eventBodyFromVerdict(violationInput).assertion).toBe('INV-007');
  });

  it('gives aligned events no severity, no precision_at, no rationale', () => {
    const body = eventBodyFromVerdict(alignedInput);
    expect(body.severity).toBeUndefined();
    expect(body.precision_at).toBeUndefined();
    expect(body.rationale).toBeUndefined();
  });

  it('emits `supersedes: null` rather than omitting it, so absence has one spelling', () => {
    expect(eventBodyFromVerdict(alignedInput).supersedes).toBeNull();
    expect(canonicalEventBody(eventBodyFromVerdict(alignedInput))['supersedes']).toBeNull();
  });

  it("preserves spec 02 §2's `{commit, pr}` combined subject (anyOf, not oneOf)", () => {
    const s = canonicalEventBody(eventBodyFromVerdict(violationInput))['subject'] as Record<
      string,
      unknown
    >;
    expect(s['commit']).toBe('9f2c1d');
    expect(s['pr']).toBe(214);
  });

  it('drops `orphaned: false`, because absence and false mean the same fact', () => {
    const withFalse = eventBodyFromVerdict({
      ...violationInput,
      subject: { ...SUBJECT, orphaned: false } as EventSubject,
    });
    const without = eventBodyFromVerdict(violationInput);
    expect(unwrap(eventIdOf(withFalse))).toBe(unwrap(eventIdOf(without)));
  });

  it('keeps `orphaned: true`, because a rewritten commit is itself information (ADR-0004)', () => {
    const orphaned = eventBodyFromVerdict({
      ...violationInput,
      subject: { ...SUBJECT, orphaned: true } as EventSubject,
    });
    expect(unwrap(eventIdOf(orphaned))).not.toBe(unwrap(eventIdOf(eventBodyFromVerdict(violationInput))));
  });
});

describe('spec 02 §1 — content addressing is the idempotency key', () => {
  it('hashes to a schema-shaped event id', () => {
    expect(unwrap(eventIdOf(eventBodyFromVerdict(violationInput)))).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
  });

  it('is deterministic: the same judgment mints byte-identical bodies twice', () => {
    expect(unwrap(eventIdOf(eventBodyFromVerdict(violationInput)))).toBe(
      unwrap(eventIdOf(eventBodyFromVerdict(violationInput))),
    );
  });

  it('makes a double append a no-op by construction', () => {
    const a = unwrap(sealEvent(eventBodyFromVerdict(violationInput)));
    const b = unwrap(sealEvent(eventBodyFromVerdict(violationInput)));
    expect(a.event).toBe(b.event);
    expect(new Set([a.event, b.event]).size).toBe(1);
  });

  it('changes the id when any hashed field changes', () => {
    const base = unwrap(eventIdOf(eventBodyFromVerdict(violationInput)));
    const laterTime = unwrap(
      eventIdOf(eventBodyFromVerdict({ ...violationInput, t: t('2026-07-22T14:03:00Z') })),
    );
    const otherPrecision = unwrap(
      eventIdOf(
        eventBodyFromVerdict({ ...violationInput, precision_at: unwrap(parsePrecision(0.8)) }),
      ),
    );
    expect(new Set([base, laterTime, otherPrecision]).size).toBe(3);
  });

  it('verifies a sealed event and detects tampering', () => {
    const e = unwrap(sealEvent(eventBodyFromVerdict(violationInput)));
    expect(unwrap(verifyEventId(e))).toBe(true);

    const tampered = { ...e, severity: 0.25 } as LedgerEvent;
    const r = verifyEventId(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('hash-mismatch');
  });

  it('deep-freezes sealed events (INV-002 through an `any` alias)', () => {
    const e = unwrap(sealEvent(eventBodyFromVerdict(violationInput)));
    expect(Object.isFrozen(e)).toBe(true);
    expect(() => {
      (e as unknown as Record<string, unknown>)['severity'] = 0.25;
    }).toThrow();
  });

  it('names the file by bare hex, no `sha256:` prefix', () => {
    const e = unwrap(sealEvent(eventBodyFromVerdict(violationInput)));
    expect(eventFileName(e.event)).toBe(`${sha256RefHex(e.event)}.yaml`);
    expect(eventFilePath(e.event)).toBe(`events/${sha256RefHex(e.event)}.yaml`);
    expect(eventFileName(e.event)).not.toContain(':');
  });
});

describe('judge identity (spec 01 §7, spec 03 §6)', () => {
  it('changes when the model id changes', () => {
    const a = unwrap(judgeHash(JUDGE));
    const b = unwrap(judgeHash({ ...JUDGE, id: unwrap(parseJudgeId('other-model')) }));
    expect(a).not.toBe(b);
  });

  it('changes when the prompt hash changes — that is seating a new judge', () => {
    const withPrompt = unwrap(
      judgeHash({ ...JUDGE, prompt: unwrap(parseRationaleRef(hashBlob('prompt v1'))) as never }),
    );
    const other = unwrap(
      judgeHash({ ...JUDGE, prompt: unwrap(parseRationaleRef(hashBlob('prompt v2'))) as never }),
    );
    expect(withPrompt).not.toBe(other);
    expect(withPrompt).not.toBe(unwrap(judgeHash(JUDGE)));
  });
});

describe('INV-002 — corrections supersede, never mutate', () => {
  it('produces a NEW event pointing at the prior one', () => {
    const first = unwrap(sealEvent(eventBodyFromVerdict(violationInput)));
    const second = unwrap(supersede(first, alignedInput));
    expect(second.event).not.toBe(first.event);
    expect(second.supersedes).toBe(first.event);
    expect(first.supersedes).toBeNull();
  });

  it('leaves the prior event untouched', () => {
    const first = unwrap(sealEvent(eventBodyFromVerdict(violationInput)));
    const snapshot = JSON.stringify(canonicalEventBody(first));
    unwrap(supersede(first, alignedInput));
    expect(JSON.stringify(canonicalEventBody(first))).toBe(snapshot);
  });
});

describe('spec 02 §3 — the fold takes the tip of each supersession chain', () => {
  const chain = (): { a: LedgerEvent; b: LedgerEvent; c: LedgerEvent } => {
    const a = unwrap(sealEvent(eventBodyFromVerdict(violationInput)));
    const b = unwrap(supersede(a, { ...alignedInput, t: t('2026-07-22T09:00:00Z') }));
    const c = unwrap(
      supersede(b, {
        ...violationInput,
        t: t('2026-07-23T09:00:00Z'),
        precision_at: unwrap(parsePrecision(0.8)),
      }),
    );
    return { a, b, c };
  };

  it('keeps only the tip', () => {
    const { a, b, c } = chain();
    const r = resolveSupersessions([a, b, c]);
    expect(r.tips.map((e) => e.event)).toEqual([c.event]);
    expect(r.supersededBy.get(a.event)).toBe(b.event);
    expect(r.supersededBy.get(b.event)).toBe(c.event);
    expect(r.forks).toHaveLength(0);
  });

  it('is order-independent', () => {
    const { a, b, c } = chain();
    const orders = [
      [a, b, c],
      [c, b, a],
      [b, c, a],
    ];
    const results = orders.map((o) => resolveSupersessions(o).tips.map((e) => e.event));
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it('collapses a duplicate append of the same event', () => {
    const { a, b } = chain();
    expect(resolveSupersessions([a, a, b, b]).tips.map((e) => e.event)).toEqual([b.event]);
  });

  it('reports a fork rather than inventing a tie-break (OPEN-QUESTIONS Q-23)', () => {
    const a = unwrap(sealEvent(eventBodyFromVerdict(violationInput)));
    const b = unwrap(supersede(a, { ...alignedInput, t: t('2026-07-22T09:00:00Z') }));
    const c = unwrap(supersede(a, { ...alignedInput, t: t('2026-07-22T10:00:00Z') }));
    const r = resolveSupersessions([a, b, c]);
    expect(r.forks).toHaveLength(1);
    expect(r.forks[0]?.superseded).toBe(a.event);
    expect([...(r.forks[0]?.successors ?? [])].sort()).toEqual([b.event, c.event].sort());
    expect(r.tips.map((e) => e.event).sort()).toEqual([b.event, c.event].sort());
  });

  it('keeps an event whose `supersedes` points outside the set, and reports it', () => {
    const orphanTarget = 'sha256:' + 'f'.repeat(64);
    const a = unwrap(sealEvent(eventBodyFromVerdict(violationInput)));
    const dangling = unwrap(
      sealEvent({
        ...eventBodyFromVerdict(alignedInput),
        supersedes: orphanTarget as EventId,
      }),
    );
    const r = resolveSupersessions([a, dangling]);
    expect(r.dangling).toEqual([dangling.event]);
    expect(r.tips).toHaveLength(2);
  });
});

describe('compareForFold gives the event set a total order', () => {
  it('sorts by committer time, then by event id', () => {
    const early = unwrap(
      sealEvent(eventBodyFromVerdict({ ...violationInput, t: t('2026-01-01T00:00:00Z') })),
    );
    const late = unwrap(
      sealEvent(eventBodyFromVerdict({ ...violationInput, t: t('2026-12-01T00:00:00Z') })),
    );
    expect(compareForFold(early, late)).toBeLessThan(0);
    expect(compareForFold(late, early)).toBeGreaterThan(0);
    expect(compareForFold(early, early)).toBe(0);
  });

  it('breaks same-instant ties deterministically, so a shuffled set folds identically', () => {
    const same = t('2026-07-21T14:03:00Z');
    const events = [0.25, 0.5, 0.75, 1]
      .map((p) => parsePrecision(p))
      .map((r) => unwrap(r))
      .map((precision_at) =>
        unwrap(sealEvent(eventBodyFromVerdict({ ...violationInput, t: same, precision_at }))),
      );

    fc.assert(
      fc.property(fc.shuffledSubarray(events, { minLength: 4, maxLength: 4 }), (shuffled) => {
        const sorted = [...shuffled].sort(compareForFold).map((e) => e.event);
        const reference = [...events].sort(compareForFold).map((e) => e.event);
        expect(sorted).toEqual(reference);
      }),
    );
  });
});

describe('decodeLedgerEvent enforces schemas/event.schema.json', () => {
  const wire = (extra: Record<string, unknown> = {}): Record<string, unknown> => {
    const e = unwrap(sealEvent(eventBodyFromVerdict(violationInput)));
    return {
      event: e.event,
      subject: { commit: '9f2c1d', pr: 214 },
      assertion: 'INV-007',
      verdict: 'drift',
      severity: 0.75,
      precision_at: 0.9,
      judge: { kind: 'model', id: 'claude-invariant-judge' },
      rationale: RATIONALE,
      t: '2026-07-21T14:03:00Z',
      supersedes: null,
      ...extra,
    };
  };

  it('accepts a well-formed drift event', () => {
    const e = unwrap(decodeLedgerEvent(wire()));
    expect(isViolationEvent(e)).toBe(true);
    if (isViolationEvent(e)) expect(e.severity).toBe(0.75);
  });

  it('rejects a subject with none of commit | pr | path', () => {
    const r = decodeLedgerEvent(wire({ subject: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.map((x) => x.code)).toContain('invalid-subject');
  });

  it('rejects a violating event with no severity (allOf/0)', () => {
    const w = wire();
    delete w['severity'];
    expect(decodeLedgerEvent(w).ok).toBe(false);
  });

  it('rejects a violating event with no precision_at (allOf/0)', () => {
    const w = wire();
    delete w['precision_at'];
    const r = decodeLedgerEvent(w);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.map((x) => x.code)).toContain('missing-field');
  });

  it('rejects a violating event with no rationale blob ref (allOf/0)', () => {
    const w = wire();
    delete w['rationale'];
    expect(decodeLedgerEvent(w).ok).toBe(false);
  });

  it('rejects a rationale that is prose rather than a blob ref', () => {
    expect(decodeLedgerEvent(wire({ rationale: 'imports reqwest' })).ok).toBe(false);
  });

  it('rejects severity outside the four anchors', () => {
    const r = decodeLedgerEvent(wire({ severity: 0.6 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.map((x) => x.code)).toContain('invalid-severity');
  });

  it('rejects an aligned event carrying a severity', () => {
    const r = decodeLedgerEvent(
      wire({ verdict: 'aligned', severity: 0.75, precision_at: undefined }),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects observation time that is not RFC 3339', () => {
    expect(decodeLedgerEvent(wire({ t: 'yesterday' })).ok).toBe(false);
  });

  it('round-trips a sealed event through decode', () => {
    const sealed = unwrap(sealEvent(eventBodyFromVerdict(violationInput)));
    const wireForm = canonicalEventBody(sealed) as Record<string, unknown>;
    const decoded = unwrap(
      decodeLedgerEvent({ ...JSON.parse(JSON.stringify(wireForm)), event: sealed.event }),
    );
    expect(unwrap(verifyEventId(decoded))).toBe(true);
    expect(decoded.event).toBe(sealed.event);
  });
});
