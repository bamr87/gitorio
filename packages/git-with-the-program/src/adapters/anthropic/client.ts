// Implements: docs/spec/03-judge.md §1 (the LLM rung of the judgment ladder) and
// .program/invariants.yaml INV-005 ("Engine core imports no forge-specific APIs; GitHub access
// lives in adapters/", read here as: no PROVIDER-specific APIs in the engine either). The
// Anthropic ModelClient adapter — the ONLY file that loads `@anthropic-ai/sdk`.
//
// It implements the provider-agnostic ModelClient PORT declared in src/core/model.ts: it shapes
// the request for claude-opus-5-5 (adaptive thinking, effort high, NO sampling params), parses
// the reply's content blocks into text, and maps the provider stop_reason onto the port's
// normalized union. Everything is injectable behind a one-method transport seam, so
// request-shaping and response-parsing are unit-tested against a FAKE transport returning canned
// YAML — never a live call, never a real `new Anthropic()`.
//
// SDK ISOLATION (Wire-phase note). `@anthropic-ai/sdk` is added by the single designated Wire
// agent; until then the dependency is absent. So this file names the SDK in exactly one place —
// `defaultAnthropicMessagesTransport` — behind a LAZY dynamic import whose specifier is typed
// `string`, so tsc does not resolve it and the whole module tree type-checks now, and vitest
// (which injects a fake transport) never executes that path. The Wire agent may replace that one
// line with a static `import Anthropic from '@anthropic-ai/sdk'` once the dependency is present.

import type { ModelClient, ModelRequest, ModelResponse, ModelStopReason } from '../../core/model.js';

// ---------------------------------------------------------------------------
// Provider constants (from the claude-api reference — used EXACTLY)
// ---------------------------------------------------------------------------

/** The seated model id. Exact string, no date suffix. */
export const DEFAULT_JUDGE_MODEL = 'claude-opus-5-5';

/** Output cap for one ruling. A YAML verdict is tiny; 4096 is ample and bounds cost. */
export const DEFAULT_MAX_TOKENS = 4096;

// ---------------------------------------------------------------------------
// Local minimal provider shapes (so parsing is testable without constructing the SDK)
// ---------------------------------------------------------------------------

export interface AnthropicContentBlock {
  readonly type: string;
  readonly text?: string;
}

export interface AnthropicMessageResult {
  readonly model: string;
  readonly stop_reason: string | null;
  readonly content: readonly AnthropicContentBlock[];
}

/**
 * The EXACT request this adapter sends. Adaptive thinking + effort high; NO temperature / top_p /
 * top_k / budget_tokens (all 400 on claude-opus-5-5), and no field where any of them could ride.
 */
export interface AnthropicMessageParams {
  readonly model: string;
  readonly max_tokens: number;
  readonly system: string;
  readonly thinking: { readonly type: 'adaptive' };
  readonly output_config: { readonly effort: 'high' };
  readonly messages: readonly { readonly role: 'user'; readonly content: string }[];
}

/** The one call this adapter makes, behind an injectable seam so tests use a fake, never the network. */
export interface AnthropicMessagesTransport {
  create(params: AnthropicMessageParams): Promise<AnthropicMessageResult>;
}

/**
 * The minimal structural surface this adapter uses off a live SDK client. Typed structurally
 * rather than as the SDK's `Anthropic` so this file compiles before the Wire phase installs
 * `@anthropic-ai/sdk`; a real `new Anthropic()` satisfies `.messages.create(...)` at runtime
 * (its Message carries `.model`, `.stop_reason`, and a `.content` array of typed blocks).
 */
export interface AnthropicMessagesApiClient {
  readonly messages: {
    create(params: AnthropicMessageParams): Promise<AnthropicMessageResult>;
  };
}

// ---------------------------------------------------------------------------
// Pure request/response mapping (the provider contract, pinned and testable)
// ---------------------------------------------------------------------------

/**
 * Builds the exact AnthropicMessageParams from a port ModelRequest plus the seated model /
 * max_tokens. Pure and testable; this is where the provider request contract is pinned.
 */
export function shapeRequest(
  req: ModelRequest,
  model: string,
  maxTokens: number,
): AnthropicMessageParams {
  return {
    model,
    max_tokens: req.maxTokens ?? maxTokens,
    system: req.system,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    messages: [{ role: 'user', content: req.user }],
  };
}

/**
 * Maps the provider stop_reason onto core's normalized union, so src/judge never string-matches a
 * provider concept. `refusal` -> `refusal` (the judge turns this into a safe abstain);
 * `end_turn` / `stop_sequence` -> `complete`; `max_tokens` -> `truncated`; anything else (incl.
 * `null` and `tool_use`, which this call cannot elicit) -> `other`.
 */
export function mapStopReason(raw: string | null): ModelStopReason {
  switch (raw) {
    case 'refusal':
      return 'refusal';
    case 'end_turn':
    case 'stop_sequence':
      return 'complete';
    case 'max_tokens':
      return 'truncated';
    default:
      return 'other';
  }
}

/** Concatenates the text of every `text` content block. Empty on a refusal (no text blocks). */
export function extractText(content: readonly AnthropicContentBlock[]): string {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

/**
 * Wraps a live SDK client's `messages.create` as the transport. The SDK type is named nowhere;
 * the Wire agent passes `new Anthropic()` (structurally compatible — cast if the installed SDK's
 * param types are stricter than AnthropicMessageParams, e.g. on `output_config`).
 */
export function anthropicMessagesTransport(
  client: AnthropicMessagesApiClient,
): AnthropicMessagesTransport {
  return {
    create: (params) => client.messages.create(params),
  };
}

/**
 * `new Anthropic()` — reads ANTHROPIC_API_KEY / auth profile from env; never hardcodes a key.
 * The one place the Anthropic SDK is loaded, kept behind a lazy dynamic import (specifier typed
 * `string`) so the module tree type-checks before the Wire phase installs the dependency. Never
 * reached in tests.
 */
export function defaultAnthropicMessagesTransport(): AnthropicMessagesTransport {
  let loaded: Promise<AnthropicMessagesTransport> | undefined;
  const load = (): Promise<AnthropicMessagesTransport> => {
    if (loaded === undefined) {
      const specifier: string = '@anthropic-ai/sdk';
      loaded = import(specifier).then(
        (mod: { readonly default: new () => AnthropicMessagesApiClient }) => {
          const Anthropic = mod.default;
          return anthropicMessagesTransport(new Anthropic());
        },
      );
    }
    return loaded;
  };
  return {
    async create(params: AnthropicMessageParams): Promise<AnthropicMessageResult> {
      return (await load()).create(params);
    },
  };
}

// ---------------------------------------------------------------------------
// The ModelClient
// ---------------------------------------------------------------------------

export interface AnthropicModelClientOptions {
  /** Defaults to defaultAnthropicMessagesTransport(); tests inject a fake. */
  readonly transport?: AnthropicMessagesTransport;
  /** Default DEFAULT_JUDGE_MODEL. */
  readonly model?: string;
  /** Default DEFAULT_MAX_TOKENS. */
  readonly maxTokens?: number;
}

/**
 * A ModelClient (src/core/model.ts) over the Anthropic Messages API. `complete` shapes the
 * request, awaits the transport, and returns { text, stopReason, modelId }. On a refusal it does
 * NOT crash — it surfaces stopReason `refusal` with the empty/partial text and lets the invariant
 * judge produce the abstain-with-reason.
 */
export function anthropicModelClient(options: AnthropicModelClientOptions = {}): ModelClient {
  const model = options.model ?? DEFAULT_JUDGE_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const transport = options.transport ?? defaultAnthropicMessagesTransport();

  return {
    modelId: model,
    async complete(req: ModelRequest): Promise<ModelResponse> {
      const result = await transport.create(shapeRequest(req, model, maxTokens));
      return {
        text: extractText(result.content),
        stopReason: mapStopReason(result.stop_reason),
        modelId: result.model,
      };
    },
  };
}
