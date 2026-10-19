// Tests for: src/adapters/anthropic/client.ts — the Anthropic ModelClient adapter (spec 03 §1,
// INV-005). NETWORK-FREE: every case runs against a FAKE transport that returns canned results;
// no real `new Anthropic()` is ever constructed. Asserts the request contract (claude-opus-5-5,
// adaptive thinking, effort high, and NO sampling params), content-block -> text extraction, and
// that a provider `refusal` stop_reason is surfaced on the port, not crashed on.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_JUDGE_MODEL,
  DEFAULT_MAX_TOKENS,
  anthropicModelClient,
  extractText,
  mapStopReason,
  shapeRequest,
  type AnthropicMessageParams,
  type AnthropicMessageResult,
  type AnthropicMessagesTransport,
} from '../../src/adapters/anthropic/client.js';

/** A fake transport that records the exact params it was handed and returns a canned reply. */
function fakeTransport(
  reply: AnthropicMessageResult,
): { transport: AnthropicMessagesTransport; calls: AnthropicMessageParams[] } {
  const calls: AnthropicMessageParams[] = [];
  return {
    calls,
    transport: {
      async create(params) {
        calls.push(params);
        return reply;
      },
    },
  };
}

const okReply = (text: string): AnthropicMessageResult => ({
  model: DEFAULT_JUDGE_MODEL,
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
});

describe('the Anthropic request contract (claude-api provider facts)', () => {
  it('sends claude-opus-5-5, adaptive thinking, effort high, and the user turn — verbatim', async () => {
    const { transport, calls } = fakeTransport(okReply('ok'));
    const client = anthropicModelClient({ transport });

    await client.complete({ system: 'SYSTEM PROMPT', user: 'USER TURN' });

    expect(calls).toHaveLength(1);
    const req = calls[0] as AnthropicMessageParams;
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(req.system).toBe('SYSTEM PROMPT');
    expect(req.thinking).toEqual({ type: 'adaptive' });
    expect(req.output_config).toEqual({ effort: 'high' });
    expect(req.messages).toEqual([{ role: 'user', content: 'USER TURN' }]);
  });

  it('sends NONE of temperature / top_p / top_k / budget_tokens (all 400 on this model)', () => {
    const req = shapeRequest({ system: 's', user: 'u' }, DEFAULT_JUDGE_MODEL, DEFAULT_MAX_TOKENS);
    for (const forbidden of ['temperature', 'top_p', 'top_k', 'budget_tokens']) {
      expect(req).not.toHaveProperty(forbidden);
    }
    // ...and none hiding inside `thinking` (where budget_tokens used to live).
    expect(req.thinking).not.toHaveProperty('budget_tokens');
    expect(Object.keys(req).sort()).toEqual(
      ['max_tokens', 'messages', 'model', 'output_config', 'system', 'thinking'].sort(),
    );
  });

  it('honours a per-request maxTokens override and the seated model id', async () => {
    const { transport, calls } = fakeTransport(okReply('ok'));
    const client = anthropicModelClient({ transport, model: 'claude-opus-5-5', maxTokens: 4096 });
    await client.complete({ system: 's', user: 'u', maxTokens: 1024 });
    expect((calls[0] as AnthropicMessageParams).max_tokens).toBe(1024);
    expect(client.modelId).toBe('claude-opus-5-5');
  });
});

describe('response parsing', () => {
  it('extracts and concatenates text from content blocks, ignoring non-text blocks', () => {
    expect(
      extractText([
        { type: 'thinking' },
        { type: 'text', text: 'one ' },
        { type: 'tool_use' },
        { type: 'text', text: 'two' },
      ]),
    ).toBe('one two');
    expect(extractText([])).toBe('');
  });

  it('reads modelId from the model that actually served, and text from the blocks', async () => {
    const { transport } = fakeTransport({
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'verdict: aligned' }],
    });
    const res = await anthropicModelClient({ transport }).complete({ system: 's', user: 'u' });
    expect(res.text).toBe('verdict: aligned');
    expect(res.stopReason).toBe('complete');
    expect(res.modelId).toBe('claude-opus-5-5');
  });
});

describe('stop_reason mapping onto the port union', () => {
  it('maps every provider value onto the four normalized reasons', () => {
    expect(mapStopReason('refusal')).toBe('refusal');
    expect(mapStopReason('end_turn')).toBe('complete');
    expect(mapStopReason('stop_sequence')).toBe('complete');
    expect(mapStopReason('max_tokens')).toBe('truncated');
    expect(mapStopReason('tool_use')).toBe('other');
    expect(mapStopReason(null)).toBe('other');
  });

  it('surfaces a refusal on the port with empty/partial text — it does NOT crash', async () => {
    const { transport } = fakeTransport({
      model: DEFAULT_JUDGE_MODEL,
      stop_reason: 'refusal',
      content: [],
    });
    const res = await anthropicModelClient({ transport }).complete({ system: 's', user: 'u' });
    expect(res.stopReason).toBe('refusal');
    expect(res.text).toBe('');
  });
});
