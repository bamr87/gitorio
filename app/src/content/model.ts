// The headless-CMS content model: two repo-versioned data files the factory reads at runtime.
//
//   .factory/config.yml   — central knobs the content agents honor (model, budget, voice, paths).
//                           lifehacker.dev's `_data/ai.yml` idea: ONE place, not per-node (ADR-017).
//   .factory/backlog.yml  — the content work queue (kind/priority/status) the writer pulls from.
//
// Everything here is PURE and TOTAL: parsing never throws on malformed input — it coerces what
// it can and falls back to defaults — because these files are hand-editable and agent-editable.

import { parse, stringify } from 'yaml';

// ── central config (.factory/config.yml) ─────────────────────────────────

/**
 * A skill specialization the content agents can adopt per item — a named lens (technical
 * writer, tutorial author, security reviewer…) with a focus. Mirrors lifehacker.dev's
 * `.claude/skills/` idea, but configured centrally so the app can edit them (ADR-018).
 */
export interface SkillProfile {
  id: string;
  name: string;
  /** One line on what this specialist optimizes for — injected into the agent's instructions. */
  focus: string;
}

export interface FactoryConfig {
  /** Default model hint the content agents adopt (the one place to change it fleet-wide). */
  model: string;
  /** Soft budget/backpressure ceiling — how many content runs/day the factory should target. */
  maxDailyRuns: number;
  /** The brand voice/tone every content agent must honor. Injected via the prompt/config. */
  brandVoice: string;
  /** Where generated content lands (globs) — documents the CMS surface for humans + agents. */
  contentPaths: string[];
  /** Directory the docs-review factory scans (the `_docs` content collection). */
  docsDir: string;
  /** How many docs the reviewer improves per run (the "review N items each day" knob). */
  itemsPerRun: number;
  /** The reviewer's checklist — configurable acceptance criteria applied to every doc. */
  reviewCriteria: string[];
  /** Skill specializations the agent can adopt per item (see {@link SkillProfile}). */
  skills: SkillProfile[];
}

export const CONFIG_PATH = '.factory/config.yml';

export const DEFAULT_CONFIG: FactoryConfig = {
  model: 'claude-opus-4-8',
  maxDailyRuns: 4,
  brandVoice: '',
  contentPaths: ['pages/_posts/**'],
  docsDir: '_docs',
  itemsPerRun: 3,
  reviewCriteria: [
    'Accuracy: claims match the current code/behavior',
    'Clarity: skimmable structure, defined terms, no dead links',
    'Completeness: a runnable example or concrete step where it helps',
  ],
  skills: [
    { id: 'technical-writer', name: 'Technical Writer', focus: 'precise terminology, skimmable structure, correct examples' },
    { id: 'tutorial-author', name: 'Tutorial Author', focus: 'a reader new to the topic can follow it end to end' },
    { id: 'api-reference', name: 'API Reference', focus: 'exhaustive, exact signatures/options, no hand-waving' },
  ],
};

const asString = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback;

const asStringList = (v: unknown, fallback: string[]): string[] => {
  if (Array.isArray(v)) {
    const out = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    return out.length ? out : fallback;
  }
  if (typeof v === 'string' && v.trim() !== '') return [v.trim()];
  return fallback;
};

/** Coerce a list of `{id?,name,focus?}` entries into SkillProfiles, dropping nameless rows. */
function asSkills(v: unknown, fallback: SkillProfile[]): SkillProfile[] {
  if (!Array.isArray(v)) return fallback.map((s) => ({ ...s }));
  const out: SkillProfile[] = [];
  v.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const o = entry as Record<string, unknown>;
    const name = asString(o.name).trim();
    if (!name) return;
    out.push({
      id: asString(o.id).trim() || slugId(name, i + 1),
      name,
      focus: asString(o.focus).trim(),
    });
  });
  return out; // an explicit empty list is respected (the user cleared their skills)
}

/** Parse `.factory/config.yml` into a FactoryConfig, filling any missing/bad field with a default. */
export function parseConfig(yamlText: string): FactoryConfig {
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch {
    return structuredCloneConfig(DEFAULT_CONFIG);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return structuredCloneConfig(DEFAULT_CONFIG);
  const o = raw as Record<string, unknown>;
  const n = Number(o.maxDailyRuns);
  const items = Number(o.itemsPerRun);
  return {
    model: asString(o.model, DEFAULT_CONFIG.model),
    maxDailyRuns: Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CONFIG.maxDailyRuns,
    brandVoice: asString(o.brandVoice, DEFAULT_CONFIG.brandVoice),
    contentPaths: asStringList(o.contentPaths, DEFAULT_CONFIG.contentPaths),
    docsDir: asString(o.docsDir, DEFAULT_CONFIG.docsDir).trim() || DEFAULT_CONFIG.docsDir,
    itemsPerRun: Number.isFinite(items) && items > 0 ? Math.floor(items) : DEFAULT_CONFIG.itemsPerRun,
    reviewCriteria: 'reviewCriteria' in o ? asStringList(o.reviewCriteria, []) : DEFAULT_CONFIG.reviewCriteria,
    skills: 'skills' in o ? asSkills(o.skills, []) : DEFAULT_CONFIG.skills,
  };
}

/** Deep-copy the default config so callers can mutate the result freely (arrays/objects). */
function structuredCloneConfig(c: FactoryConfig): FactoryConfig {
  return {
    ...c,
    contentPaths: [...c.contentPaths],
    reviewCriteria: [...c.reviewCriteria],
    skills: c.skills.map((s) => ({ ...s })),
  };
}

/** A fresh, independently-mutable copy of the default config (arrays/objects deep-cloned). */
export function defaultConfig(): FactoryConfig {
  return structuredCloneConfig(DEFAULT_CONFIG);
}

/** Serialize a FactoryConfig to `.factory/config.yml` text (with a provenance header). */
export function serializeConfig(config: FactoryConfig): string {
  const header =
    '# GitFactory central config — honored by the content agents at runtime.\n' +
    '# Edit here (or in the Content tab); agents read this file, so changes need no recompile.\n';
  return header + stringify(config, { lineWidth: 0 });
}

// ── content backlog (.factory/backlog.yml) ───────────────────────────────

export type BacklogPriority = 'low' | 'normal' | 'high';
export type BacklogStatus = 'todo' | 'in-progress' | 'done';

export interface BacklogItem {
  id: string;
  /** Content kind, e.g. post | page | doc | hack | tool. Free-form; drives collection routing. */
  kind: string;
  title: string;
  brief: string;
  priority: BacklogPriority;
  status: BacklogStatus;
}

export const BACKLOG_PATH = '.factory/backlog.yml';

const PRIORITIES: BacklogPriority[] = ['low', 'normal', 'high'];
const STATUSES: BacklogStatus[] = ['todo', 'in-progress', 'done'];

const asPriority = (v: unknown): BacklogPriority =>
  typeof v === 'string' && (PRIORITIES as string[]).includes(v) ? (v as BacklogPriority) : 'normal';
const asStatus = (v: unknown): BacklogStatus =>
  typeof v === 'string' && (STATUSES as string[]).includes(v) ? (v as BacklogStatus) : 'todo';

/** A stable-ish id from a title (the caller can override). Not random — safe in pure/replay contexts. */
export function slugId(title: string, seq: number): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'item'}-${seq}`;
}

/** Parse `.factory/backlog.yml` into a list of items, tolerating a bare list or `{ items: [...] }`. */
export function parseBacklog(yamlText: string): BacklogItem[] {
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch {
    return [];
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).items)
      ? ((raw as Record<string, unknown>).items as unknown[])
      : [];
  const items: BacklogItem[] = [];
  list.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const o = entry as Record<string, unknown>;
    const title = asString(o.title).trim();
    if (!title) return; // a titleless row isn't actionable
    items.push({
      id: asString(o.id).trim() || slugId(title, i + 1),
      kind: asString(o.kind, 'post').trim() || 'post',
      title,
      brief: asString(o.brief).trim(),
      priority: asPriority(o.priority),
      status: asStatus(o.status),
    });
  });
  return items;
}

/** Serialize a backlog to `.factory/backlog.yml` text (with a provenance header). */
export function serializeBacklog(items: BacklogItem[]): string {
  const header =
    '# GitFactory content backlog — the work queue the content factory pulls from.\n' +
    '# Each item: {id, kind, title, brief, priority, status}. status: todo | in-progress | done.\n';
  return header + stringify({ items }, { lineWidth: 0 });
}

/** Count `todo` items per kind — a starvation signal the loop-tuner watches (0 todo = improvising). */
export function starvedKinds(items: BacklogItem[]): string[] {
  const kinds = new Set(items.map((it) => it.kind));
  const starved: string[] = [];
  for (const k of kinds) {
    if (!items.some((it) => it.kind === k && it.status === 'todo')) starved.push(k);
  }
  return starved.sort();
}
