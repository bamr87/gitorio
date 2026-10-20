// Implements: docs/spec/03-judge.md §1 (the LLM rung of the judgment ladder) and §6 (a judge's
// identity is its model id + prompt hash), and .program/invariants.yaml INV-005 ("Engine core
// imports no forge-specific APIs; GitHub access lives in adapters/"). The PROVIDER-AGNOSTIC
// ModelClient PORT.
//
// Declared CORE-side on purpose. src/judge depends on this interface and never on a provider
// SDK: the LLM invariant judge (src/judge/model/**) type-imports `ModelClient` from here, and
// the Anthropic adapter (src/adapters/anthropic/**) — the ONLY place `@anthropic-ai/sdk` may be
// named (INV-005) — implements it. Nothing in this file imports anything, declassifies anything,
// or reaches a sentencing module, so it is safe to re-export wholesale from the core barrel and
// safe to VALUE-import from a blind module.
//
// The port is blind BY SHAPE, not merely by convention: a request carries a `system` string and
// a `user` string and nothing else, so there is no field an author identity (ActorId) or a
// running total (Surprise) could occupy, and both are opaque non-string handles that cannot be
// widened into either slot. This is the INV-003 story restated at the model boundary.

/**
 * One single-shot completion request. There is deliberately no message-history array: a
 * corrective re-prompt is a fresh `complete()` whose `user` turn folds in the correction, which
 * keeps the port minimal and the judge stateless.
 */
export interface ModelRequest {
  /** The system prompt (the filled invariant-judge template). */
  readonly system: string;
  /** The user turn. Non-empty — providers require a user message. */
  readonly user: string;
  /** Optional per-call output cap; the ModelClient applies its own default when omitted. */
  readonly maxTokens?: number;
}

/**
 * Core's OWN normalized stop-reason vocabulary. The adapter maps a provider string (Anthropic's
 * `end_turn` / `stop_sequence` / `max_tokens` / `refusal`, …) onto exactly these four values, so
 * src/judge never string-matches a provider concept. `refusal` is the value the invariant judge
 * turns into a safe abstain (spec 03 §4: honest uncertainty over a forced call).
 */
export type ModelStopReason = 'complete' | 'truncated' | 'refusal' | 'other';

/** Runtime twin of the union, for exhaustiveness tests and the adapter's round-trip checks. */
export const MODEL_STOP_REASONS = [
  'complete',
  'truncated',
  'refusal',
  'other',
] as const satisfies readonly ModelStopReason[];

/**
 * One completion reply. No slot for authorship or a running total — blind by shape.
 */
export interface ModelResponse {
  /** Concatenated text of the reply. Empty or partial on a refusal. */
  readonly text: string;
  readonly stopReason: ModelStopReason;
  /** The model that actually served the reply (may differ from `ModelClient.modelId` on a silent provider fallback). */
  readonly modelId: string;
}

/**
 * The only surface src/judge sees. src/adapters/anthropic implements it; src/judge never names
 * the SDK. `modelId` is the seated model id and is half of the judge's identity (spec 03 §6),
 * the other half being the sha256 of the prompt file.
 */
export interface ModelClient {
  readonly modelId: string;
  complete(req: ModelRequest): Promise<ModelResponse>;
}
