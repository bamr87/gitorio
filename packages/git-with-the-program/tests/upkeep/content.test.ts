// Implements tests for: docs/spec/06-upkeep.md §4 — one validator for two authors (a model and
// an agent editing the plan file), fallbacks that keep the run alive, and "no citation, no
// finding" for the docs review (src/upkeep/content.ts).

import { describe, expect, it } from 'vitest';

import type { ModelClient, ModelRequest, ModelResponse } from '../../src/core/model.js';
import {
  checkPlanContent,
  docsReviewFindings,
  fillWithModel,
  fillWithTemplates,
  outsideAuthoredSurface,
  parseValueReply,
  resolveContent,
  validateContent,
} from '../../src/upkeep/content.js';
import { planUpkeep } from '../../src/upkeep/plan.js';
import { STEWARD_SYSTEM_PROMPT } from '../../src/upkeep/prompts.js';
import type { ContentRequest, UpkeepPlan } from '../../src/upkeep/types.js';
import { config, hostFacts, localFacts, planInput } from './fixtures.js';

const req = (kind: ContentRequest['kind'], context: Record<string, unknown> = {}): ContentRequest => ({
  id: 'C1',
  kind,
  brief: { instructions: 'x', context },
  status: 'requested',
  fallback: kind === 'description' ? 'fallback text' : kind === 'release-notes' ? '' : [],
});

const DOCS = req('docs-review', {
  files: [{ path: 'README.md', lines: ['1: # Title', '2: Implementation not started.'] }],
});

describe('validateContent', () => {
  it('description: one line, ≤ 350, normalized', () => {
    expect(validateContent(req('description'), '**Hi** there')).toEqual({ ok: true, value: 'Hi there' });
    expect(validateContent(req('description'), 'a\nb').ok).toBe(false);
    expect(validateContent(req('description'), 'x'.repeat(351)).ok).toBe(false);
    expect(validateContent(req('description'), 42).ok).toBe(false);
  });

  it('topics: GitHub-valid, ≤ 20, de-duplicated', () => {
    expect(validateContent(req('topics'), ['a', 'a', 'b-c'])).toEqual({ ok: true, value: ['a', 'b-c'] });
    expect(validateContent(req('topics'), ['Not Valid']).ok).toBe(false);
    expect(validateContent(req('topics'), Array.from({ length: 21 }, (_, i) => `t${i}`)).ok).toBe(false);
  });

  it('release notes: a bounded markdown string', () => {
    expect(validateContent(req('release-notes'), '  Summary.  ')).toEqual({ ok: true, value: 'Summary.' });
    expect(validateContent(req('release-notes'), 'x'.repeat(20_001)).ok).toBe(false);
  });

  it('docs review: a finding whose quote is not on the cited line is dropped', () => {
    const v = validateContent(DOCS, [
      { path: 'README.md', line: 2, quote: 'not started', issue: 'it has started' },
      { path: 'README.md', line: 1, quote: 'not started', issue: 'wrong line' },
      { path: 'OTHER.md', line: 1, quote: 'x', issue: 'wrong file' },
      { path: 'README.md', line: 2, quote: 'not started' },
    ]);
    expect(v).toEqual({
      ok: true,
      dropped: 3,
      value: [{ path: 'README.md', line: 2, quote: 'not started', issue: 'it has started' }],
    });
  });
});

describe('resolveContent and fallbacks', () => {
  it('uses a valid filled value, else the fallback with the reason', () => {
    expect(resolveContent({ ...req('description'), status: 'filled', value: 'Good.', provider: 'agent' })).toEqual({ value: 'Good.', source: 'filled' });
    const bad = resolveContent({ ...req('description'), status: 'filled', value: 'a\nb', provider: 'agent' });
    expect(bad).toMatchObject({ value: 'fallback text', source: 'fallback' });
    expect(bad.issue).toContain('one line');
    expect(resolveContent(req('description'))).toEqual({ value: 'fallback text', source: 'fallback' });
  });

  it('fillWithTemplates marks only requested slots', () => {
    const plan = { ...planUpkeep(planInput()), content: [req('topics'), { ...req('description'), id: 'C2', status: 'filled' as const, value: 'x', provider: 'agent' }] };
    const out = fillWithTemplates(plan as UpkeepPlan);
    expect(out.content.map((c) => [c.status, c.provider])).toEqual([['fallback', 'template'], ['filled', 'agent']]);
  });

  it('docs-review findings are cited in-tree findings', () => {
    const plan = {
      ...planUpkeep(planInput()),
      content: [{ ...DOCS, status: 'filled' as const, provider: 'agent', value: [{ path: 'README.md', line: 2, quote: 'not started', issue: 'stale', suggestion: 'Implemented.' }] }],
    };
    expect(docsReviewFindings(plan as UpkeepPlan)).toEqual([
      expect.objectContaining({ facet: 'docs', where: 'in-tree', citation: { path: 'README.md', line: 2 }, remedy: 'Replace with: Implemented.' }),
    ]);
  });

  it('checkPlanContent reports invalid slots and dangling references', () => {
    const base = planUpkeep(planInput({ host: hostFacts({ description: null }), config: config({ metadata: { ...config().metadata, description: { from: 'ai' } } }) }));
    expect(checkPlanContent(base)).toEqual([]);
    const broken: UpkeepPlan = {
      ...base,
      content: base.content.map((c) => ({ ...c, status: 'filled' as const, provider: 'agent', value: 7 })),
      actions: [...base.actions, { id: 'A9', kind: 'repo.topics', names: [], current: [], content: 'C99' }],
    };
    const problems = checkPlanContent(broken);
    expect(problems.some((p) => p.includes('C99'))).toBe(true);
    expect(problems.some((p) => p.includes('must be a string'))).toBe(true);
  });
});

describe('the model provider', () => {
  const plan = (): UpkeepPlan =>
    planUpkeep(
      planInput({
        host: hostFacts({ description: null, releases: [] }),
        local: localFacts(),
        config: config({ metadata: { ...config().metadata, description: { from: 'ai' } }, releases: { backfill: 3, notes: 'ai' } }),
      }),
    );

  function fake(replies: readonly (string | Error | ModelResponse)[]): ModelClient & { calls: ModelRequest[] } {
    const calls: ModelRequest[] = [];
    let i = 0;
    return {
      modelId: 'claude-test',
      calls,
      async complete(r) {
        calls.push(r);
        const next = replies[i++];
        if (next instanceof Error) throw next;
        if (typeof next === 'string') return { text: next, stopReason: 'complete', modelId: 'claude-test' };
        return next!;
      },
    };
  }

  it('fills valid replies and sends the shared system prompt with the brief as data', async () => {
    const client = fake(['{"value": "A demo."}', '```json\n{"value": "Notes."}\n```']);
    const out = await fillWithModel(plan(), client);
    expect(out.content.map((c) => [c.kind, c.status, c.value, c.provider])).toEqual([
      ['description', 'filled', 'A demo.', 'model:claude-test'],
      ['release-notes', 'filled', 'Notes.', 'model:claude-test'],
    ]);
    expect(client.calls[0]!.system).toBe(STEWARD_SYSTEM_PROMPT);
    expect(client.calls[0]!.user).toContain('Context (JSON data about the repository)');
  });

  it('a refusal, bad JSON, an invalid value or a thrown error each reject ONE slot and the run continues', async () => {
    for (const first of [
      { text: '', stopReason: 'refusal', modelId: 'claude-test' } as ModelResponse,
      'no json here',
      '{"value": "line one\\nline two"}',
      new Error('network down'),
    ]) {
      const out = await fillWithModel(plan(), fake([first, '{"value": "Notes."}']));
      expect(out.content[0]!.status).toBe('rejected');
      expect(out.content[0]!.note).toBeTruthy();
      expect(out.content[1]!.status).toBe('filled');
    }
  });

  it('parseValueReply tolerates prose around the object', () => {
    expect(parseValueReply('Sure! {"value": [1]} hope that helps')).toEqual({ ok: true, value: [1] });
    expect(parseValueReply('{"other": 1}').ok).toBe(false);
  });
});

describe("the agent's write surface (spec 06 §4.2)", () => {
  const engine = (): UpkeepPlan =>
    planUpkeep(
      planInput({
        host: hostFacts({ description: null, releases: [] }),
        config: config({ metadata: { ...config().metadata, description: { from: 'ai' } }, releases: { backfill: 3, notes: 'ai' } }),
      }),
    );

  it('filling content (status, value, provider, note) is inside the surface — key order notwithstanding', async () => {
    const before = engine();
    const filled: UpkeepPlan = JSON.parse(JSON.stringify({
      ...before,
      content: before.content.map((c) => ({ provider: 'agent', value: 'x', ...c, status: 'filled', note: 'ok' })),
    })) as UpkeepPlan;
    expect(outsideAuthoredSurface(before, filled)).toEqual([]);
  });

  it('an added action, a moved target, an edited fallback or brief are all caught', () => {
    const before = engine();
    const tag = { id: 'A99', kind: 'tag.create' as const, tag: 'v9.9.9', sha: 'b'.repeat(40) };
    expect(outsideAuthoredSurface(before, { ...before, actions: [...before.actions, tag] })).toEqual(['`actions` was modified']);
    const moved = { ...before, actions: before.actions.map((a) => (a.kind === 'repo.update' ? { ...a, homepage: 'https://evil.test' } : a)) };
    expect(outsideAuthoredSurface(before, moved)).toEqual(['`actions` was modified']);
    const fb = { ...before, content: before.content.map((c, i) => (i === 0 ? { ...c, fallback: 'injected' } : c)) };
    expect(outsideAuthoredSurface(before, fb)).toEqual([`content ${before.content[0]!.id}: fields other than status/value/provider/note were modified`]);
    const dropped = { ...before, content: before.content.slice(1) };
    expect(outsideAuthoredSurface(before, dropped)).toEqual([`content ${before.content[0]!.id} was removed`]);
  });
});
