// Implements tests for: src/distill/synthesis.ts — pass-two synthesis
// (docs/spec/04-distillation.md §3–§6). NETWORK-FREE: every test injects a fake `ModelClient`
// (the core provider-agnostic port, INV-005) returning canned candidates. No @anthropic-ai/sdk,
// no real git, no clock beyond the committer-time endpoints a proof carries.

import { describe, expect, it } from 'vitest';
import { parseCommitSha, parseEpochId } from '../../src/core/ids.js';
import type { ModelClient, ModelRequest, ModelResponse, ModelStopReason } from '../../src/core/model.js';
import { decodePrecedent } from '../../src/core/precedent.js';
import type { Result } from '../../src/core/result.js';
import { unwrap } from '../../src/core/result.js';
import { MILLIS_PER_DAY, committerTimeFromEpochMillis } from '../../src/core/time.js';
import {
  type EpochSynthesisInput,
  type NegativeSpaceProofView,
  type SynthesisCapExceeded,
  type SynthesisResult,
  buildEpochPrompt,
  buildTombstoneCorpus,
  statementRegularityKey,
  synthesize,
} from '../../src/distill/synthesis.js';

// ───────────────────────────── fixtures ─────────────────────────────

interface Scripted {
  readonly text: string;
  readonly stopReason?: ModelStopReason;
}

interface FakeModel extends ModelClient {
  calls: number;
}

/** A fake ModelClient that replays scripted replies in call order. No network. */
function makeModel(replies: readonly (string | Scripted)[]): FakeModel {
  let i = 0;
  const client: FakeModel = {
    modelId: 'fake-model',
    calls: 0,
    async complete(_req: ModelRequest): Promise<ModelResponse> {
      client.calls += 1;
      const raw = replies[i] ?? '';
      i += 1;
      const s = typeof raw === 'string' ? { text: raw } : raw;
      return { text: s.text, stopReason: s.stopReason ?? 'complete', modelId: client.modelId };
    },
  };
  return client;
}

function reply(candidates: readonly object[]): string {
  return JSON.stringify({ candidates });
}

function proof(scope: string, days: number): NegativeSpaceProofView {
  return {
    scope,
    held: true,
    commitsChecked: 100,
    spanFrom: unwrap(committerTimeFromEpochMillis(0)),
    spanTo: unwrap(committerTimeFromEpochMillis(days * MILLIS_PER_DAY)),
    regularity: statementRegularityKey(`proof:${scope}`),
  };
}

function epoch(id: string, isFinal: boolean, proofs: readonly NegativeSpaceProofView[] = []): EpochSynthesisInput {
  return {
    epoch: unwrap(parseEpochId(id)),
    boundary: unwrap(parseCommitSha('abc123')),
    isFinal,
    docs: [{ path: 'README.md', kind: 'readme', present: true, text: 'The core imports only the standard library.' }],
    topChurnDiffs: [],
    aggregates: { negativeSpaceProofs: proofs, manifestChurn: [], coChangeTopEdges: [] },
  };
}

function expectOk(r: Result<SynthesisResult, SynthesisCapExceeded>): SynthesisResult {
  if (!r.ok) throw new Error(`expected Ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

function only<T>(arr: readonly T[]): T {
  expect(arr).toHaveLength(1);
  const x = arr[0];
  if (x === undefined) throw new Error('empty array');
  return x;
}

const noTombstones = buildTombstoneCorpus([]);

// ───────────────────────────── provenance ─────────────────────────────

describe('provenance is mandatory (spec 01 §4 rule 1)', () => {
  it('drops a candidate with no provenance before it can be proposed, keeps its cited sibling', async () => {
    const model = makeModel([
      reply([
        { statement: 'core imports stdlib only always', class: 'boundary', scope: ['core/**'], kind: 'statute', provenance: ['commit abc123'] },
        { statement: 'adapters own third party deps here', class: 'dependency', scope: ['adapters/**'], kind: 'statute' }, // no provenance
      ]),
    ]);
    const res = expectOk(await synthesize(model, { epochs: [epoch('e0', true)], tombstones: noTombstones }));
    const kept = only(res.candidates);
    expect(kept.assertion.provenance).toEqual(['commit abc123']);
    expect(res.dropped.some((d) => d.reason === 'missing-provenance')).toBe(true);
  });

  it('every emitted candidate carries non-empty provenance', async () => {
    const model = makeModel([
      reply([{ statement: 'core imports stdlib only always', class: 'boundary', scope: ['core/**'], kind: 'statute', provenance: ['commit abc123', 'pr#7'] }]),
    ]);
    const res = expectOk(await synthesize(model, { epochs: [epoch('e0', true)], tombstones: noTombstones }));
    for (const c of res.candidates) expect(c.assertion.provenance.length).toBeGreaterThan(0);
  });
});

// ───────────────────────────── status: inferred ─────────────────────────────

describe('distillation emits only status: inferred (spec 04 §4)', () => {
  it('every candidate is inferred at runtime AND the type pins it', async () => {
    const model = makeModel([
      reply([{ statement: 'core imports stdlib only always', class: 'boundary', scope: ['core/**'], kind: 'statute', provenance: ['commit abc123'] }]),
    ]);
    const res = expectOk(await synthesize(model, { epochs: [epoch('e0', true)], tombstones: noTombstones }));
    for (const c of res.candidates) {
      // Compile-time proof: assigning to the literal type only type-checks because
      // CandidateAssertion.status is pinned to 'inferred'. Self-ratification is unrepresentable.
      const pinned: 'inferred' = c.assertion.status;
      expect(pinned).toBe('inferred');
      // And CAND-* id shape.
      expect(c.assertion.id.startsWith('CAND-')).toBe(true);
    }
  });
});

// ───────────────────────────── recency asymmetry ─────────────────────────────

describe('recency asymmetry (spec 04 §3)', () => {
  it('downgrades an early-epoch statute to precedent but keeps a final-epoch statute', async () => {
    const model = makeModel([
      reply([{ statement: 'early era retry logic lives inline', class: 'behavior', scope: ['handlers/**'], kind: 'statute', provenance: ['commit e0aaaa'] }]),
      reply([{ statement: 'core imports stdlib only always', class: 'boundary', scope: ['core/**'], kind: 'statute', provenance: ['commit e1bbbb'] }]),
    ]);
    const res = expectOk(await synthesize(model, { epochs: [epoch('e0', false), epoch('e1', true)], tombstones: noTombstones }));
    const early = res.candidates.find((c) => c.assertion.statement.includes('early era'));
    const final = res.candidates.find((c) => c.assertion.statement.includes('core imports'));
    expect(early).toBeDefined();
    expect(final).toBeDefined();
    expect(early?.kind).toBe('precedent');
    expect(final?.kind).toBe('statute');
  });
});

// ───────────────────────────── merge across epochs ─────────────────────────────

describe('cross-epoch merge (spec 04 §3, §5)', () => {
  const STMT = 'core imports stdlib only; adapters own deps';

  it('merges the same law in 3 epochs into one candidate with combined provenance and higher evidence', async () => {
    const p = proof('core/**', 365);
    const epochs = [epoch('e0', false, [p]), epoch('e1', false, [p]), epoch('e2', true, [p])];

    const merged = expectOk(
      await synthesize(
        makeModel([
          reply([{ statement: STMT, class: 'boundary', scope: ['core/**'], kind: 'statute', provenance: ['commit aaa111'] }]),
          reply([{ statement: STMT, class: 'boundary', scope: ['core/**'], kind: 'statute', provenance: ['pr#42'] }]),
          reply([{ statement: STMT, class: 'boundary', scope: ['core/**'], kind: 'statute', provenance: ['revert bbb222'] }]),
        ]),
        { epochs, tombstones: noTombstones },
      ),
    );
    const one = only(merged.candidates);
    expect(one.epochs).toEqual(['e0', 'e1', 'e2']);
    expect(one.assertion.provenance).toEqual(['commit aaa111', 'pr#42', 'revert bbb222']);
    expect(one.kind).toBe('statute'); // final epoch wins
    // corr 3/5=0.6, persist 3/3=1, span 365 → 0.5 + 0.45·(0.4+0.18+0.3) = 0.896
    expect(one.assertion.precision_seed).toBe(0.896);
    expect(one.assertion.precision).toBe(0.896);
    expect(one.assertion.evidence?.corroborations).toEqual(['commit aaa111', 'pr#42', 'revert bbb222']);

    // Control: the SAME law seen in only one of three epochs is weaker and singly-cited.
    const single = expectOk(
      await synthesize(
        makeModel([
          reply([{ statement: STMT, class: 'boundary', scope: ['core/**'], kind: 'statute', provenance: ['commit aaa111'] }]),
          reply([]),
          reply([]),
        ]),
        { epochs, tombstones: noTombstones },
      ),
    );
    const lone = only(single.candidates);
    expect(lone.assertion.provenance).toHaveLength(1);
    // corr 1/5=0.2, persist 1/3, span 365 → 0.5 + 0.45·(0.4+0.06+0.1) = 0.752
    expect(lone.assertion.precision_seed).toBe(0.752);
    expect(one.assertion.precision_seed).toBeGreaterThan(lone.assertion.precision_seed ?? 0);
  });
});

// ───────────────────────────── tombstones ─────────────────────────────

describe('tombstones are binding (spec 04 §6)', () => {
  const STMT = 'core imports stdlib only always here';
  const mk = () =>
    makeModel([reply([{ statement: STMT, class: 'boundary', scope: ['core/**'], kind: 'statute', provenance: ['commit abc123'] }])]);

  it('does not re-propose a candidate whose regularity a prior run rejected', async () => {
    const first = expectOk(await synthesize(mk(), { epochs: [epoch('e0', true)], tombstones: noTombstones }));
    const rejected = only(first.candidates).regularity;

    const second = expectOk(await synthesize(mk(), { epochs: [epoch('e0', true)], tombstones: buildTombstoneCorpus([], [rejected]) }));
    expect(second.candidates).toHaveLength(0);
    expect(second.dropped.some((d) => d.reason === 'tombstoned')).toBe(true);
  });

  it('honours a coincidence precedent whose pattern is the rejected statement', async () => {
    const tomb = unwrap(decodePrecedent({ id: 'PRE-001', pattern: STMT, ruling: 'coincidence', evidence: ['revert 9f2c1d'] }));
    const res = expectOk(await synthesize(mk(), { epochs: [epoch('e0', true)], tombstones: buildTombstoneCorpus([tomb]) }));
    expect(res.candidates).toHaveLength(0);
    expect(res.dropped.some((d) => d.reason === 'tombstoned')).toBe(true);
  });

  it('leaves a non-tombstoned law untouched', async () => {
    const tombOther = unwrap(decodePrecedent({ id: 'PRE-002', pattern: 'some unrelated rejected regularity', ruling: 'coincidence', evidence: ['revert deadbe'] }));
    const res = expectOk(await synthesize(mk(), { epochs: [epoch('e0', true)], tombstones: buildTombstoneCorpus([tombOther]) }));
    expect(res.candidates).toHaveLength(1);
  });
});

// ───────────────────────────── cost guard ─────────────────────────────

describe('LLM cost guard (spec 04 §7)', () => {
  it('stops and reports before spending a single call when epochs exceed the model-call cap', async () => {
    const model = makeModel([reply([]), reply([]), reply([])]);
    const res = await synthesize(model, {
      epochs: [epoch('e0', false), epoch('e1', false), epoch('e2', true)],
      tombstones: noTombstones,
      budget: { maxModelCalls: 2 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected cap-exceeded');
    expect(res.error.reason).toBe('model-call-cap-exceeded');
    expect(res.error.cap).toBe(2);
    expect(res.error.requested).toBe(3);
    expect(model.calls).toBe(0); // never spent
  });

  it('makes exactly one model call per epoch under the cap', async () => {
    const model = makeModel([reply([]), reply([])]);
    const res = expectOk(await synthesize(model, { epochs: [epoch('e0', false), epoch('e1', true)], tombstones: noTombstones }));
    expect(model.calls).toBe(2);
    expect(res.modelCalls).toBe(2);
  });
});

// ───────────────────────────── refusal ─────────────────────────────

describe('an abstaining model yields nothing rather than a hallucinated law', () => {
  it('records a model-refusal and emits no candidate for that epoch', async () => {
    const model = makeModel([{ text: '', stopReason: 'refusal' }]);
    const res = expectOk(await synthesize(model, { epochs: [epoch('e0', true)], tombstones: noTombstones }));
    expect(res.candidates).toHaveLength(0);
    expect(res.dropped.some((d) => d.reason === 'model-refusal')).toBe(true);
  });
});

// ───────────────────────────── INV-003: no author in the prompt ─────────────────────────────

describe('INV-003 — the synthesis prompt carries no author identity', () => {
  it('has no channel to carry an author handle into the model request', () => {
    const author = 'Jane Hacker <jane@example.com>';
    // `author` is deliberately NOT placed in any EpochSynthesisInput field — the type has no
    // author-bearing slot (the author-file matrix is dispersion-side). The prompt is a pure
    // function of the author-free views, so identity cannot leak.
    const prompt = buildEpochPrompt(epoch('e0', true, [proof('core/**', 365)]));
    expect(prompt.user).not.toContain(author);
    expect(prompt.user).not.toContain('jane@example.com');
    expect(prompt.system).not.toContain('jane@example.com');
    // It DID consume the author-free doc evidence.
    expect(prompt.user).toContain('README.md');
    expect(prompt.user).toContain('core/**');
  });
});
