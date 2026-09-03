// The fleet/v1 manifest as text (specs/014, FR-6): a `fleet.manifest.yml` document for a
// blueprint, and the small deterministic YAML emitter behind it (the demo hub's fixture files
// use it too). Kept apart from lanes.ts so the floor's passports — which only need the
// blueprint → lanes direction — do not carry the emitter.

import type { Blueprint } from '../blueprint/types';
import { toFleetLanes } from './lanes';

/** A `fleet.manifest.yml` document for a blueprint (lanes + the token contract), as text. */
export function toFleetManifestYaml(bp: Blueprint, repo: string): string {
  const lanes = toFleetLanes(bp);
  const tokens = [...new Set(lanes.flatMap((l) => l.uses_tokens))].sort();
  const doc = {
    spec_version: 'fleet/v1',
    repo,
    provenance: 'derived',
    summary: bp.meta.description || bp.meta.name,
    lanes,
    tokens: tokens.map((name) => ({
      name,
      scope: 'fleet',
      required: name === 'CLAUDE_CODE_OAUTH_TOKEN',
      purpose: TOKEN_PURPOSE[name] ?? 'Declared by a machine on the floor.',
      used_by: lanes.filter((l) => l.uses_tokens.includes(name)).map((l) => l.id),
    })),
  };
  return `# fleet.manifest.yml — this repository's AI fleet, in the shared 'fleet/v1' vocabulary.\n# Compiled by GitFactory from the blueprint; the lanes are the assembly lines.\n${yamlDump(doc)}`;
}

const TOKEN_PURPOSE: Record<string, string> = {
  CLAUDE_CODE_OAUTH_TOKEN:
    'Preferred Claude auth (house convention: OAuth first). Produced by `claude setup-token`.',
  ANTHROPIC_API_KEY: 'Fallback Claude auth, used only when the OAuth token is absent.',
  FLEET_TOKEN: 'Fine-grained PAT for cross-repo writes.',
};

/** A small, deterministic YAML emitter for the manifest (block style, quoted where needed). */
export function yamlDump(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]\n`;
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const body = yamlDump(item, indent + 1).replace(/^\s*/, '');
          return `${pad}- ${body}`;
        }
        return `${pad}- ${scalar(item)}\n`;
      })
      .join('');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        if (v && typeof v === 'object') {
          if (Array.isArray(v) && !v.length) return `${pad}${k}: []\n`;
          return `${pad}${k}:\n${yamlDump(v, indent + 1)}`;
        }
        return `${pad}${k}: ${scalar(v)}\n`;
      })
      .join('');
  }
  return `${pad}${scalar(value)}\n`;
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  return /^[A-Za-z0-9_./@-][A-Za-z0-9_./@ -]*$/.test(s) && !/^(true|false|null|yes|no)$/i.test(s)
    ? s
    : JSON.stringify(s);
}
