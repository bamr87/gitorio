// Single source of truth for the Claude model IDs the app offers.
// Latest model per tier, per Anthropic's models overview / GET /v1/models (2026-10).
// When Anthropic ships a new generation, change it here only.
export const CLAUDE_MODELS = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
} as const;

export type ClaudeModelId = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

/** Picker order: most capable first. */
export const CLAUDE_MODEL_OPTIONS: readonly ClaudeModelId[] = [
  CLAUDE_MODELS.opus,
  CLAUDE_MODELS.sonnet,
  CLAUDE_MODELS.haiku,
];
