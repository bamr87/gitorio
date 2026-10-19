// Implements: docs/spec/06-upkeep.md §4 (content requests: who may fill them, how a value is
// validated, and how an unfilled slot degrades to its deterministic fallback).
//
// ONE VALIDATOR, TWO AUTHORS. A content slot may be filled by `fillWithModel` (a ModelClient,
// src/core/model.ts — the Anthropic adapter in practice) or by an AI AGENT editing the plan file
// directly (the scheduled workflow's Claude Code step). Both land in the same `validateContent`,
// and `apply` re-runs it on every value it uses: a plan file is untrusted input by the time it
// comes back from an agent, however it was produced. The analogue is spec 03 §4 — a judge's
// output is parsed against the contract, never trusted for being well-meant.
//
// No citation, no finding (INV-004's posture, borrowed): a docs-review finding whose `quote`
// does not appear on the line it cites is dropped, not softened.

import type { ModelClient } from '../core/model.js';
import { normalizeDescription } from './plan.js';
import { STEWARD_SYSTEM_PROMPT } from './prompts.js';
import {
  type ContentKind,
  type ContentRequest,
  DESCRIPTION_MAX,
  type Finding,
  RELEASE_NOTES_MAX,
  TOPIC_PATTERN,
  TOPICS_MAX,
  type UpkeepPlan,
} from './types.js';

export interface DocsReviewItem {
  readonly path: string;
  readonly line: number;
  readonly quote: string;
  readonly issue: string;
  readonly suggestion?: string;
}

export type Validated =
  | { readonly ok: true; readonly value: unknown; readonly dropped?: number }
  | { readonly ok: false; readonly reason: string };

interface BriefFile {
  readonly path: string;
  readonly lines: readonly string[];
}

/** Lines in a docs-review brief are stored `"<n>: <text>"`; this recovers the text of line n. */
function briefLine(files: readonly BriefFile[], path: string, line: number): string | null {
  const f = files.find((x) => x.path === path);
  const raw = f?.lines[line - 1];
  if (raw === undefined) return null;
  const prefix = `${line}: `;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

export function validateContent(req: ContentRequest, value: unknown): Validated {
  switch (req.kind) {
    case 'description': {
      if (typeof value !== 'string') return { ok: false, reason: 'description must be a string' };
      if (/[\r\n]/.test(value)) return { ok: false, reason: 'description must be one line' };
      const v = normalizeDescription(value);
      if (v === '') return { ok: false, reason: 'description is empty' };
      if (value.trim().length > DESCRIPTION_MAX) {
        return { ok: false, reason: `description is ${value.trim().length} characters; the limit is ${DESCRIPTION_MAX}` };
      }
      return { ok: true, value: v };
    }
    case 'topics': {
      if (!Array.isArray(value)) return { ok: false, reason: 'topics must be an array of strings' };
      const bad = value.filter((t) => typeof t !== 'string' || !TOPIC_PATTERN.test(t));
      if (bad.length > 0) return { ok: false, reason: `invalid topic(s): ${JSON.stringify(bad.slice(0, 3))}` };
      if (value.length > TOPICS_MAX) return { ok: false, reason: `at most ${TOPICS_MAX} topics` };
      return { ok: true, value: [...new Set(value as string[])] };
    }
    case 'release-notes': {
      if (typeof value !== 'string') return { ok: false, reason: 'release notes must be a markdown string' };
      if (value.length > RELEASE_NOTES_MAX) return { ok: false, reason: `release notes exceed ${RELEASE_NOTES_MAX} characters` };
      return { ok: true, value: value.trim() };
    }
    case 'docs-review': {
      if (!Array.isArray(value)) return { ok: false, reason: 'docs review must be an array' };
      const files = (req.brief.context['files'] ?? []) as readonly BriefFile[];
      const kept: DocsReviewItem[] = [];
      let dropped = 0;
      for (const raw of value) {
        const r = raw as Partial<DocsReviewItem> | null;
        if (
          r === null ||
          typeof r !== 'object' ||
          typeof r.path !== 'string' ||
          typeof r.line !== 'number' ||
          !Number.isInteger(r.line) ||
          typeof r.quote !== 'string' ||
          r.quote.trim() === '' ||
          typeof r.issue !== 'string' ||
          r.issue.trim() === ''
        ) {
          dropped++;
          continue;
        }
        const text = briefLine(files, r.path, r.line);
        if (text === null || !text.includes(r.quote)) {
          dropped++;
          continue;
        }
        kept.push({
          path: r.path,
          line: r.line,
          quote: r.quote,
          issue: r.issue.trim(),
          ...(typeof r.suggestion === 'string' && r.suggestion.trim() !== '' ? { suggestion: r.suggestion.trim() } : {}),
        });
      }
      return { ok: true, value: kept, dropped };
    }
  }
}

/**
 * The value an action or a report should USE: the filled value when it validates, the
 * deterministic fallback otherwise. Never throws; `issue` explains a fallback.
 */
export function resolveContent(req: ContentRequest): { readonly value: unknown; readonly source: 'filled' | 'fallback'; readonly issue?: string } {
  if (req.status === 'filled') {
    const v = validateContent(req, req.value);
    if (v.ok) return { value: v.value, source: 'filled' };
    return { value: req.fallback, source: 'fallback', issue: v.reason };
  }
  return { value: req.fallback, source: 'fallback', ...(req.note !== undefined ? { issue: req.note } : {}) };
}

/** Every problem with the filled slots of a plan — what `gwtp upkeep check` reports. */
export function checkPlanContent(plan: UpkeepPlan): readonly string[] {
  const problems: string[] = [];
  const ids = new Set(plan.content.map((c) => c.id));
  for (const a of plan.actions) {
    if (a.content !== undefined && !ids.has(a.content)) problems.push(`${a.id}: references unknown content ${a.content}`);
  }
  for (const c of plan.content) {
    if (c.status === 'filled') {
      const v = validateContent(c, c.value);
      if (!v.ok) problems.push(`${c.id} (${c.kind}): ${v.reason}`);
      else if (v.dropped !== undefined && v.dropped > 0) {
        problems.push(`${c.id} (${c.kind}): ${v.dropped} finding(s) cite a line that does not contain their quote and will be dropped`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

function withContent(plan: UpkeepPlan, content: readonly ContentRequest[]): UpkeepPlan {
  return { ...plan, content };
}

/** Marks every requested slot as using its fallback. Deterministic; the no-AI path. */
export function fillWithTemplates(plan: UpkeepPlan): UpkeepPlan {
  return withContent(
    plan,
    plan.content.map((c) => (c.status === 'requested' ? { ...c, status: 'fallback', provider: 'template' } : c)),
  );
}

/** The user turn for one request: instructions, then the context as JSON data. */
export function contentPrompt(req: ContentRequest): string {
  return [
    req.brief.instructions,
    '',
    'Context (JSON data about the repository):',
    '```json',
    JSON.stringify(req.brief.context, null, 2),
    '```',
    '',
    'Reply with {"value": ...} only.',
  ].join('\n');
}

/** Pulls `{"value": …}` out of a reply that may be fenced or carry stray prose around it. */
export function parseValueReply(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return { ok: false, reason: 'reply contains no JSON object' };
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    if (typeof parsed !== 'object' || parsed === null || !('value' in parsed)) {
      return { ok: false, reason: 'reply JSON has no `value` field' };
    }
    return { ok: true, value: (parsed as { value: unknown }).value };
  } catch (e) {
    return { ok: false, reason: `reply is not valid JSON: ${(e as Error).message}` };
  }
}

const MAX_TOKENS: Readonly<Record<ContentKind, number>> = {
  description: 2_000,
  topics: 2_000,
  'release-notes': 8_000,
  'docs-review': 16_000,
};

/**
 * Fills every `requested` slot through a ModelClient, one call per slot. A refusal, a
 * truncation, unparseable output or a value that fails validation marks the slot `rejected`
 * with the reason — the run continues on the fallback. A thrown transport error does too: one
 * failed call must not cost the other slots.
 */
export async function fillWithModel(plan: UpkeepPlan, client: ModelClient): Promise<UpkeepPlan> {
  const out: ContentRequest[] = [];
  for (const c of plan.content) {
    if (c.status !== 'requested') {
      out.push(c);
      continue;
    }
    const provider = `model:${client.modelId}`;
    try {
      const res = await client.complete({ system: STEWARD_SYSTEM_PROMPT, user: contentPrompt(c), maxTokens: MAX_TOKENS[c.kind] });
      if (res.stopReason !== 'complete') {
        out.push({ ...c, status: 'rejected', provider, note: `model stopped: ${res.stopReason}` });
        continue;
      }
      const parsed = parseValueReply(res.text);
      if (!parsed.ok) {
        out.push({ ...c, status: 'rejected', provider, note: parsed.reason });
        continue;
      }
      const v = validateContent(c, parsed.value);
      if (!v.ok) {
        out.push({ ...c, status: 'rejected', provider, value: parsed.value, note: v.reason });
        continue;
      }
      out.push({ ...c, status: 'filled', provider: `model:${res.modelId}`, value: v.value });
    } catch (e) {
      out.push({ ...c, status: 'rejected', provider, note: `model call failed: ${(e as Error).message}` });
    }
  }
  return withContent(plan, out);
}

/** Docs-review results as in-tree findings, cited. Empty when the slot fell back. */
export function docsReviewFindings(plan: UpkeepPlan): readonly Finding[] {
  const out: Finding[] = [];
  for (const c of plan.content) {
    if (c.kind !== 'docs-review') continue;
    const r = resolveContent(c);
    const items = (Array.isArray(r.value) ? r.value : []) as readonly DocsReviewItem[];
    items.forEach((item, i) => {
      out.push({
        id: `docs.stale:${item.path}:${item.line}:${i}`,
        facet: 'docs',
        severity: 'warn',
        where: 'in-tree',
        summary: `${item.issue} — "${item.quote}"`,
        citation: { path: item.path, line: item.line },
        actions: [],
        remedy: item.suggestion !== undefined ? `Replace with: ${item.suggestion}` : 'Update the statement to match the repository.',
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The agent's write surface, enforced
// ---------------------------------------------------------------------------

/** The fields of a content slot an author may write. Everything else in a plan is the engine's. */
export const AUTHORED_FIELDS = ['status', 'value', 'provider', 'note'] as const;

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableJson(x)}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function engineOwned(c: ContentRequest): unknown {
  const rest: Record<string, unknown> = { ...c };
  for (const f of AUTHORED_FIELDS) delete rest[f];
  return rest;
}

/**
 * Everything that differs between the plan the ENGINE wrote and the plan an AGENT handed back,
 * outside the agent's write surface (AUTHORED_FIELDS on content slots). Empty = the agent only
 * authored. Non-empty = the plan was tampered with — an added action, a moved tag target, an
 * edited fallback — and must not be applied. This is what makes spec 06 §4.2's "an agent cannot
 * add an action or change a target" a check rather than an instruction.
 */
export function outsideAuthoredSurface(engine: UpkeepPlan, edited: UpkeepPlan): readonly string[] {
  const problems: string[] = [];
  for (const key of ['schema_version', 'generated_at', 'repository', 'mode', 'observed', 'findings', 'actions'] as const) {
    if (stableJson(engine[key]) !== stableJson(edited[key])) problems.push(`\`${key}\` was modified`);
  }
  const before = new Map(engine.content.map((c) => [c.id, c]));
  const after = new Map(edited.content.map((c) => [c.id, c]));
  for (const id of before.keys()) if (!after.has(id)) problems.push(`content ${id} was removed`);
  for (const [id, c] of after) {
    const orig = before.get(id);
    if (orig === undefined) problems.push(`content ${id} was added`);
    else if (stableJson(engineOwned(orig)) !== stableJson(engineOwned(c))) {
      problems.push(`content ${id}: fields other than ${AUTHORED_FIELDS.join('/')} were modified`);
    }
  }
  return problems;
}
