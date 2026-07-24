// Tests for: src/judge/model/invariant_judge.ts and src/judge/model/prompt.ts — the LLM invariant
// judge (spec 03 §3-§4, §6, ADR-0005, INV-004). NETWORK-FREE: every LLM path runs through an
// injected FAKE ModelClient returning canned YAML; nothing here constructs a real client or makes
// a request. The shipped prompt file is read read-only to prove the real placeholders get filled.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  isViolation,
  judgeHash,
  parseAssertionId,
  parseCitation,
  parsePathGlob,
  parseRepoPath,
  sealEvidence,
  unwrap,
  type Hunk,
  type SealedEvidence,
} from '../../src/core/index.js';
import type { ModelClient, ModelRequest, ModelResponse } from '../../src/core/model.js';
import {
  modelInvariantJudge,
  modelInvariantJudgeRef,
} from '../../src/judge/model/invariant_judge.js';
import {
  INVARIANT_PROMPT_PLACEHOLDERS,
  citationsWithinShownHunks,
  extractYamlDocument,
  fillInvariantPrompt,
  fillTemplate,
  renderAssertionYaml,
} from '../../src/judge/model/prompt.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHIPPED_PROMPT = readFileSync(resolve(REPO_ROOT, 'prompts/invariant-judge.md'), 'utf8');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATEMENT = 'Engine core imports no forge-specific APIs; GitHub access lives in adapters/';

/** A hunk whose post-image spans lines 40..59, so a citation of 41-58 lies inside it. */
function fixtureHunk(): Hunk {
  return {
    path: unwrap(parseRepoPath('src/core/http.ts')),
    oldStart: 40,
    oldLines: 20,
    newStart: 40,
    newLines: 20,
    text: '+import reqwest from "reqwest";\n context line\n+const c = reqwest.client();',
  };
}

/** A real sealed bundle — the seal is the genuine one; nothing bypasses sealEvidence. */
function sealFixture(hunks: readonly Hunk[] = [fixtureHunk()]): SealedEvidence {
  return unwrap(
    sealEvidence({
      assertion: {
        id: unwrap(parseAssertionId('INV-005')),
        statement: STATEMENT,
        class: 'boundary',
        scope: [unwrap(parsePathGlob('src/core/**'))],
      },
      charterExcerpt: 'The engine stays forge-agnostic so a bare repo degrades gracefully.',
      hunks,
      ring: 'hunk' as const,
      precedent: null,
    }),
  );
}

type CannedReply = Partial<Pick<ModelResponse, 'text' | 'stopReason' | 'modelId'>>;

/** A fake ModelClient that hands back canned replies in order and records each request. */
function fakeModel(
  replies: readonly CannedReply[],
  modelId = 'claude-opus-4-8',
): { client: ModelClient; calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  let i = 0;
  const client: ModelClient = {
    modelId,
    async complete(req) {
      calls.push(req);
      const r = replies[Math.min(i, replies.length - 1)] ?? {};
      i += 1;
      return {
        text: r.text ?? '',
        stopReason: r.stopReason ?? 'complete',
        modelId: r.modelId ?? modelId,
      };
    },
  };
  return { client, calls };
}

const yamlReply = (body: string): CannedReply => ({ text: body, stopReason: 'complete' });

const DRIFT_YAML = [
  'assertion: INV-005',
  'verdict: drift',
  'severity: breach',
  'confidence: 0.8',
  'evidence:',
  '  - src/core/http.ts:41-58',
  'precedent: null',
  'rationale: >',
  '  Imports reqwest inside core/, bypassing the adapter boundary.',
].join('\n');

const ALIGNED_YAML = ['assertion: INV-005', 'verdict: aligned', 'confidence: 0.9'].join('\n');

const UNCITED_DRIFT_YAML = [
  'assertion: INV-005',
  'verdict: drift',
  'severity: breach',
  'confidence: 0.7',
  'precedent: null',
  'rationale: >',
  '  A forge dependency slipped into core.',
].join('\n');

// ---------------------------------------------------------------------------
// prompt.ts — plumbing
// ---------------------------------------------------------------------------

describe('prompt filling (spec 03 §3) is injection-safe', () => {
  it('substitutes known placeholders in a single pass and never re-scans replacement text', () => {
    // {{a}} expands to a literal "{{b}}", which must NOT then be treated as the b-placeholder.
    expect(fillTemplate('{{a}}-{{b}}', { a: '{{b}}', b: 'B' })).toBe('{{b}}-B');
  });

  it('leaves an unknown placeholder verbatim (it is template text the caller did not fill)', () => {
    expect(fillTemplate('x {{unknown}} y', {})).toBe('x {{unknown}} y');
  });

  it('fills every placeholder of the SHIPPED prompt from the sealed bundle, and only from it', () => {
    const filled = fillInvariantPrompt(SHIPPED_PROMPT, sealFixture());
    for (const p of INVARIANT_PROMPT_PLACEHOLDERS) {
      expect(filled.includes(`{{${p}}}`), `placeholder {{${p}}} was left unfilled`).toBe(false);
    }
    expect(filled).toContain('INV-005');
    expect(filled).toContain(STATEMENT);
    expect(filled).toContain('The engine stays forge-agnostic'); // charter excerpt
    expect(filled).toContain('src/core/http.ts'); // scoped hunk
  });

  it('renders the assertion projection and nothing else — no knobs (Q-21)', () => {
    const yaml = renderAssertionYaml(sealFixture().bundle.assertion);
    expect(yaml).toContain('id: INV-005');
    expect(yaml).toContain('class: boundary');
    expect(yaml).not.toContain('precision');
    expect(yaml).not.toContain('budget');
  });

  it('extracts a fenced YAML document if the model wrapped one', () => {
    expect(extractYamlDocument('here:\n```yaml\nverdict: aligned\n```\nthanks')).toBe(
      'verdict: aligned',
    );
    expect(extractYamlDocument('  verdict: aligned  ')).toBe('verdict: aligned');
  });

  it('enforces citations lie inside a shown hunk (INV-004 made mechanical)', () => {
    const sealed = sealFixture();
    expect(citationsWithinShownHunks(sealed, [unwrap(parseCitation('src/core/http.ts:41-58'))])).toBe(
      true,
    );
    expect(citationsWithinShownHunks(sealed, [unwrap(parseCitation('src/core/http.ts:200'))])).toBe(
      false,
    );
    expect(citationsWithinShownHunks(sealed, [unwrap(parseCitation('src/core/other.ts:41'))])).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// The judge — happy paths
// ---------------------------------------------------------------------------

describe('the LLM invariant judge — clean rulings pass straight through', () => {
  it('parses a well-formed drift reply into a drift Verdict with citation + anchored severity', async () => {
    const { client, calls } = fakeModel([yamlReply(DRIFT_YAML)]);
    const verdict = await modelInvariantJudge({ client, promptTemplate: SHIPPED_PROMPT })(sealFixture());

    expect(calls).toHaveLength(1); // no re-prompt on a clean ruling
    expect(verdict.verdict).toBe('drift');
    if (!isViolation(verdict)) throw new Error('narrowing');
    expect(verdict.severity).toBe('breach');
    expect(verdict.evidence.map((c) => c.source)).toEqual(['src/core/http.ts:41-58']);
    expect(verdict.rationale).toContain('reqwest');
  });

  it('parses a terse aligned reply into an aligned Verdict', async () => {
    const { client, calls } = fakeModel([yamlReply(ALIGNED_YAML)]);
    const verdict = await modelInvariantJudge({ client, promptTemplate: SHIPPED_PROMPT })(sealFixture());
    expect(calls).toHaveLength(1);
    expect(verdict.verdict).toBe('aligned');
    expect(isViolation(verdict)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The judge — the re-prompt / abstain ladder (INV-004, spec 03 §4)
// ---------------------------------------------------------------------------

describe('the re-prompt-once-then-abstain ladder', () => {
  it('re-prompts EXACTLY once on an uncited violation, then abstains', async () => {
    const { client, calls } = fakeModel([yamlReply(UNCITED_DRIFT_YAML), yamlReply(UNCITED_DRIFT_YAML)]);
    const verdict = await modelInvariantJudge({ client, promptTemplate: SHIPPED_PROMPT })(sealFixture());
    expect(calls).toHaveLength(2); // one re-prompt, and only one
    expect(verdict.verdict).toBe('abstain'); // never forced into a call
  });

  it('carries the correction into the re-prompt user turn', async () => {
    const { client, calls } = fakeModel([yamlReply(UNCITED_DRIFT_YAML), yamlReply(DRIFT_YAML)]);
    const verdict = await modelInvariantJudge({ client, promptTemplate: SHIPPED_PROMPT })(sealFixture());
    expect(calls).toHaveLength(2);
    expect(calls[1]?.user).not.toBe(calls[0]?.user); // the second turn is a correction, not a repeat
    expect(verdict.verdict).toBe('drift'); // the model fixed it and the fix is accepted
  });

  it('rejects a severity outside the four anchors (re-prompts), then accepts a fixed reply', async () => {
    const badSeverity = DRIFT_YAML.replace('severity: breach', 'severity: catastrophic');
    const { client, calls } = fakeModel([yamlReply(badSeverity), yamlReply(DRIFT_YAML)]);
    const verdict = await modelInvariantJudge({ client, promptTemplate: SHIPPED_PROMPT })(sealFixture());
    expect(calls).toHaveLength(2); // the off-anchor severity was rejected, not accepted
    expect(verdict.verdict).toBe('drift');
    if (!isViolation(verdict)) throw new Error('narrowing');
    expect(verdict.severity).toBe('breach');
  });

  it('rejects a hallucinated citation outside the shown hunks, then abstains', async () => {
    const hallucinated = DRIFT_YAML.replace('src/core/http.ts:41-58', 'src/core/http.ts:900-950');
    const { client, calls } = fakeModel([yamlReply(hallucinated), yamlReply(hallucinated)]);
    const verdict = await modelInvariantJudge({ client, promptTemplate: SHIPPED_PROMPT })(sealFixture());
    expect(calls).toHaveLength(2);
    expect(verdict.verdict).toBe('abstain');
  });

  it('re-prompts when the reply rules on the wrong assertion id', async () => {
    const wrongId = DRIFT_YAML.replace('assertion: INV-005', 'assertion: INV-999');
    const { client, calls } = fakeModel([yamlReply(wrongId), yamlReply(ALIGNED_YAML)]);
    const verdict = await modelInvariantJudge({ client, promptTemplate: SHIPPED_PROMPT })(sealFixture());
    expect(calls).toHaveLength(2);
    expect(verdict.verdict).toBe('aligned');
  });

  it('re-prompts on unparseable output, then abstains', async () => {
    const { client, calls } = fakeModel([yamlReply('this is not: yaml: at all: ['), yamlReply('still junk [')]);
    const verdict = await modelInvariantJudge({ client, promptTemplate: SHIPPED_PROMPT })(sealFixture());
    expect(calls).toHaveLength(2);
    expect(verdict.verdict).toBe('abstain');
  });
});

// ---------------------------------------------------------------------------
// Refusal (spec 03 §4: honest uncertainty, never a crash)
// ---------------------------------------------------------------------------

describe('a model refusal yields an abstain with a clear rationale — no crash, no re-prompt', () => {
  it('abstains immediately on stop_reason refusal', async () => {
    const { client, calls } = fakeModel([{ text: '', stopReason: 'refusal' }]);
    const verdict = await modelInvariantJudge({ client, promptTemplate: SHIPPED_PROMPT })(sealFixture());
    expect(calls).toHaveLength(1); // re-prompting a refusal is pointless
    expect(verdict.verdict).toBe('abstain');
    if (verdict.verdict !== 'abstain') throw new Error('narrowing');
    expect(verdict.rationale).toContain('refusal');
  });
});

// ---------------------------------------------------------------------------
// Judge identity (spec 03 §6): model id + prompt-file hash
// ---------------------------------------------------------------------------

describe('judge identity is the model id plus the prompt-file hash (spec 03 §6)', () => {
  const { client } = fakeModel([], 'claude-opus-4-8');

  it('stamps {kind: model, id, prompt: sha256:…}', () => {
    const ref = modelInvariantJudgeRef(client, SHIPPED_PROMPT);
    expect(ref.kind).toBe('model');
    expect(ref.id).toBe('claude-opus-4-8');
    expect(ref.prompt).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('judgeHash is stable for the same model id and prompt bytes', () => {
    const a = unwrap(judgeHash(modelInvariantJudgeRef(client, SHIPPED_PROMPT)));
    const b = unwrap(judgeHash(modelInvariantJudgeRef(client, SHIPPED_PROMPT)));
    expect(b).toBe(a);
  });

  it('judgeHash changes iff the model id changes', () => {
    const base = unwrap(judgeHash(modelInvariantJudgeRef(client, SHIPPED_PROMPT)));
    const { client: other } = fakeModel([], 'claude-opus-4-7');
    expect(unwrap(judgeHash(modelInvariantJudgeRef(other, SHIPPED_PROMPT)))).not.toBe(base);
  });

  it('judgeHash changes iff the prompt-file bytes change (editing the prompt re-seats the judge)', () => {
    const base = unwrap(judgeHash(modelInvariantJudgeRef(client, SHIPPED_PROMPT)));
    expect(unwrap(judgeHash(modelInvariantJudgeRef(client, `${SHIPPED_PROMPT}\n`)))).not.toBe(base);
  });
});
