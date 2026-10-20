// Implements: docs/spec/06-upkeep.md §2 (the config and its defaults) against
// schemas/upkeep-config.schema.json.
//
// Two passes, the Q-29 split again: ajv against the schema is AUTHORITATIVE for shape (the CLI
// runs it first), and this module applies defaults and checks the rules draft-07 cannot state —
// that a `pattern` actually compiles and has exactly one capture group, that reference ids are
// unique, that a literal description fits GitHub's 350 characters. Every problem is reported in
// one pass, as data (src/core/result.ts).

import { type Result, err, ok } from '../core/result.js';
import {
  type DescriptionSource,
  DESCRIPTION_MAX,
  LABEL_COLOR_PATTERN,
  type ReferenceItems,
  type ReferenceRule,
  TOPIC_PATTERN,
  UPKEEP_SCHEMA_VERSION,
  type UpkeepConfig,
  type VersionFile,
} from './types.js';

export const DEFAULT_CONFIG_PATH = '.github/upkeep.yaml';

export const DEFAULT_MAX_CHARS_PER_FILE = 12_000;

/** The config a repository with no `.github/upkeep.yaml` gets: observe, propose, touch nothing. */
export function defaultConfig(): UpkeepConfig {
  return {
    schema_version: UPKEEP_SCHEMA_VERSION,
    mode: 'propose',
    ai: { max_chars_per_file: DEFAULT_MAX_CHARS_PER_FILE },
    metadata: {
      description: { from: 'package.json' },
      topics: { include: [], from_package_keywords: true, mode: 'merge', min: 0 },
      license_file: true,
    },
    versioning: {
      tag_prefix: 'v',
      files: [{ path: 'package.json', pattern: '"version"\\s*:\\s*"([^"]+)"' }],
      history_depth: 200,
    },
    releases: { backfill: 3, notes: 'template' },
    labels: { declared: [], from_code: true },
    references: [],
  };
}

type Raw = Readonly<Record<string, unknown>>;

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function strings(v: unknown): readonly string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Compiles `pattern` and counts its capture groups; `null` when it does not compile. */
export function captureGroups(pattern: string): number | null {
  try {
    // An empty alternative matches the empty string, so exec('') always returns a match whose
    // length is groups + 1 — a way to count groups without parsing the regex ourselves.
    const m = new RegExp(`${pattern}|`).exec('');
    return m === null ? null : m.length - 1;
  } catch {
    return null;
  }
}

/**
 * Applies defaults to a document that has ALREADY passed ajv, and reports the rules ajv cannot
 * state. Returns every problem, not the first.
 */
export function resolveConfig(raw: unknown): Result<UpkeepConfig, readonly string[]> {
  const base = defaultConfig();
  if (raw === null || raw === undefined) return ok(base);
  if (!isRecord(raw)) return err(['config: expected a mapping at the top level']);

  const problems: string[] = [];

  // --- metadata -----------------------------------------------------------
  const m = isRecord(raw['metadata']) ? raw['metadata'] : {};
  let description: DescriptionSource | undefined = base.metadata.description;
  if ('description' in m) {
    const d = m['description'];
    if (d === null) {
      description = undefined;
    } else if (isRecord(d)) {
      const from = str(d['from']);
      if (from === 'literal') {
        const value = str(d['value']) ?? '';
        if (value.trim() === '') problems.push('metadata.description: `literal` needs a non-empty `value`');
        if (value.length > DESCRIPTION_MAX) {
          problems.push(`metadata.description: literal is ${value.length} characters; GitHub's limit is ${DESCRIPTION_MAX}`);
        }
        description = { from: 'literal', value };
      } else if (from === 'package.json' || from === 'readme' || from === 'ai') {
        description = { from };
      } else {
        problems.push(`metadata.description.from: unknown source ${JSON.stringify(from)}`);
      }
    }
  }

  const baseTopics = base.metadata.topics!;
  const t = isRecord(m['topics']) ? m['topics'] : undefined;
  const topics =
    m['topics'] === null
      ? undefined
      : {
          include: t !== undefined ? strings(t['include']) : baseTopics.include,
          from_package_keywords:
            typeof t?.['from_package_keywords'] === 'boolean'
              ? (t['from_package_keywords'] as boolean)
              : baseTopics.from_package_keywords,
          mode: t?.['mode'] === 'exact' ? ('exact' as const) : ('merge' as const),
          min: num(t?.['min'], baseTopics.min),
        };
  for (const topic of topics?.include ?? []) {
    if (!TOPIC_PATTERN.test(topic)) {
      problems.push(`metadata.topics.include: ${JSON.stringify(topic)} is not a valid GitHub topic (${TOPIC_PATTERN.source})`);
    }
  }

  const homepage = str(m['homepage']);
  const metadata = {
    ...(description !== undefined ? { description } : {}),
    ...(homepage !== undefined ? { homepage } : {}),
    ...(topics !== undefined ? { topics } : {}),
    license_file: typeof m['license_file'] === 'boolean' ? (m['license_file'] as boolean) : true,
  };

  // --- versioning ---------------------------------------------------------
  let versioning = base.versioning;
  if (raw['versioning'] === null) {
    versioning = undefined;
  } else if (isRecord(raw['versioning'])) {
    const v = raw['versioning'];
    const files: VersionFile[] = Array.isArray(v['files'])
      ? v['files'].filter(isRecord).map((f) => ({ path: str(f['path']) ?? '', pattern: str(f['pattern']) ?? '' }))
      : [...base.versioning!.files];
    files.forEach((f, i) => {
      const groups = captureGroups(f.pattern);
      if (groups === null) problems.push(`versioning.files[${i}].pattern does not compile`);
      else if (groups !== 1) problems.push(`versioning.files[${i}].pattern must have exactly one capture group (has ${groups})`);
    });
    if (files.length === 0) problems.push('versioning.files: at least one file (the source of truth) is required');
    versioning = {
      tag_prefix: str(v['tag_prefix']) ?? base.versioning!.tag_prefix,
      files,
      history_depth: num(v['history_depth'], base.versioning!.history_depth),
    };
  }

  // --- releases -----------------------------------------------------------
  let releases = base.releases;
  if (raw['releases'] === null) {
    releases = undefined;
  } else if (isRecord(raw['releases'])) {
    const r = raw['releases'];
    releases = {
      backfill: num(r['backfill'], base.releases!.backfill),
      notes: r['notes'] === 'ai' ? 'ai' : 'template',
    };
  }

  // --- labels -------------------------------------------------------------
  let labels = base.labels;
  if (raw['labels'] === null) {
    labels = undefined;
  } else if (isRecord(raw['labels'])) {
    const l = raw['labels'];
    const declared = Array.isArray(l['declared'])
      ? l['declared'].filter(isRecord).map((d) => ({
          name: str(d['name']) ?? '',
          color: (str(d['color']) ?? 'ededed').replace(/^#/, '').toLowerCase(),
          description: str(d['description']) ?? '',
        }))
      : [];
    declared.forEach((d, i) => {
      if (!LABEL_COLOR_PATTERN.test(d.color)) problems.push(`labels.declared[${i}].color must be six hex digits`);
    });
    labels = {
      declared,
      from_code: typeof l['from_code'] === 'boolean' ? (l['from_code'] as boolean) : true,
    };
  }

  // --- references ---------------------------------------------------------
  const references: ReferenceRule[] = [];
  const seen = new Set<string>();
  const rawRefs = Array.isArray(raw['references']) ? raw['references'].filter(isRecord) : [];
  rawRefs.forEach((r, i) => {
    const id = str(r['id']) ?? `REF-${i + 1}`;
    if (seen.has(id)) problems.push(`references[${i}].id ${JSON.stringify(id)} is not unique`);
    seen.add(id);
    const it = isRecord(r['items']) ? r['items'] : {};
    let items: ReferenceItems;
    const glob = str(it['glob']);
    const capture = str(it['capture']);
    if (glob !== undefined) {
      items = capture !== undefined ? { glob, capture } : { glob };
      if (capture !== undefined && captureGroups(capture) !== 1) {
        problems.push(`references[${i}].items.capture must compile with exactly one capture group`);
      }
    } else {
      items = { file: str(it['file']) ?? '', pattern: str(it['pattern']) ?? '' };
      if (captureGroups(items.pattern) !== 1) {
        problems.push(`references[${i}].items.pattern must compile with exactly one capture group`);
      }
    }
    const mention = str(r['mention']) ?? '{item}';
    if (!mention.includes('{item}')) problems.push(`references[${i}].mention must contain {item}`);
    references.push({ id, doc: str(r['doc']) ?? '', items, mention });
  });

  // --- docs review / ai ---------------------------------------------------
  const dr = isRecord(raw['docs_review']) ? { files: strings(raw['docs_review']['files']) } : undefined;
  const aiRaw = isRecord(raw['ai']) ? raw['ai'] : {};
  const model = str(aiRaw['model']);
  const ai = {
    ...(model !== undefined ? { model } : {}),
    max_chars_per_file: num(aiRaw['max_chars_per_file'], DEFAULT_MAX_CHARS_PER_FILE),
  };

  if (problems.length > 0) return err(problems);

  const repository = str(raw['repository']);
  return ok({
    schema_version: str(raw['schema_version']) ?? UPKEEP_SCHEMA_VERSION,
    ...(repository !== undefined ? { repository } : {}),
    mode: raw['mode'] === 'apply' ? 'apply' : 'propose',
    ai,
    metadata,
    ...(versioning !== undefined ? { versioning } : {}),
    ...(releases !== undefined ? { releases } : {}),
    ...(labels !== undefined ? { labels } : {}),
    references,
    ...(dr !== undefined ? { docs_review: dr } : {}),
  });
}
