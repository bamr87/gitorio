// The `fleet/v1` lane — the interchange contract between GitFactory and the hub (specs/014,
// FR-6). Every fleet repo commits a `fleet.manifest.yml` in this vocabulary (bamr87/wtd's
// FLEET-SPEC; `wtd fleet adopt` derives it, the hub reads it), so a harness designed here and
// a harness inventoried there can be the same record: `toFleetLanes` compiles a blueprint's
// assembly lines to lanes, `parseFleetManifest` reads any repo's manifest tolerantly, and one
// `HarnessCard` renders a lane wherever it appears. Pure; manifest text is untrusted data.

import { parse as parseYaml } from 'yaml';
import type { Blueprint, BlueprintNode } from '../blueprint/types';
import { assemblyLines, type AssemblyLine } from '../compiler/compile';

export type LaneKind =
  | 'content'
  | 'triage'
  | 'review'
  | 'maintenance'
  | 'analysis'
  | 'orchestrator'
  | 'fanout'
  | 'mention'
  | 'other';
export const LANE_KINDS: LaneKind[] = [
  'content',
  'triage',
  'review',
  'maintenance',
  'analysis',
  'orchestrator',
  'fanout',
  'mention',
  'other',
];

export type LaneHarness = 'claude-code-action' | 'claude-cli' | 'wtd-fleet' | 'engine' | 'none';
export const LANE_HARNESSES: LaneHarness[] = ['claude-code-action', 'claude-cli', 'wtd-fleet', 'engine', 'none'];

export type LaneTrigger =
  | { kind: 'schedule'; cron: string }
  | { kind: 'dispatch' }
  | { kind: 'event'; events: string[] };

export interface LaneGuardrails {
  never_merges: boolean;
  opens_pull_requests?: boolean;
  writable_paths?: string[];
  max_writes_per_run?: number;
}

export interface FleetLane {
  id: string;
  kind: LaneKind;
  harness: LaneHarness;
  implementation: string;
  description: string;
  triggers: LaneTrigger[];
  /** The repo variable that switches the lane, or null. */
  switch: string | null;
  uses_tokens: string[];
  guardrails: LaneGuardrails;
  state_paths?: string[];
}

export interface FleetManifest {
  spec_version: string;
  repo: string;
  provenance: 'declared' | 'derived' | 'unknown';
  summary: string;
  lanes: FleetLane[];
  /** Lines the parser could not read as lanes (kept as counts, never as content). */
  skipped: number;
}

// ── blueprint → lanes ───────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const AGENT_TYPES = new Set(['agent.claude', 'processor.feedback_controller', 'processor.issue_batcher']);
const EVENT_OF: Record<string, string> = {
  'trigger.issue_opened': 'issues',
  'trigger.issue_labeled': 'issues',
  'trigger.pr_opened': 'pull_request',
  'trigger.comment': 'issue_comment',
  'trigger.workflow_run': 'workflow_run',
  'trigger.repository_dispatch': 'repository_dispatch',
};

/**
 * The lane kind a line's machines imply. `wtd fleet adopt` reads names and prompts, so a
 * derived manifest may say `other` where the structure says `triage`; the interchange
 * fields the hub relies on (id, harness, implementation, switch, tokens, guardrails) do not
 * depend on this table, and the parity test compares only those.
 */
export function laneKindFor(nodes: BlueprintNode[]): LaneKind {
  const types = new Set(nodes.map((n) => n.type));
  const has = (...t: string[]) => t.some((x) => types.has(x));
  const hasAgent = nodes.some((n) => AGENT_TYPES.has(n.type));
  if (has('trigger.comment')) return 'mention';
  if (has('sink.repository_dispatch', 'sink.cross_repo_issue')) return 'fanout';
  if (has('processor.ledger', 'processor.evidence', 'gate.verified_fix')) return 'maintenance';
  if (has('processor.feedback_controller')) return 'analysis';
  if (has('processor.issue_batcher')) return 'triage';
  if (has('trigger.pr_opened', 'processor.dependabot_meta')) return 'review';
  if (has('trigger.issue_opened', 'trigger.issue_labeled') && has('sink.label', 'sink.comment'))
    return 'triage';
  if (has('trigger.cron') && has('sink.open_pr', 'sink.commit_files') && hasAgent) return 'content';
  if (has('trigger.cron') && hasAgent) return 'maintenance';
  return 'other';
}

/** One assembly line as a `fleet/v1` lane. */
export function laneForLine(bp: Blueprint, line: AssemblyLine): FleetLane {
  const byId = new Map(bp.nodes.map((n) => [n.id, n]));
  const nodes = line.nodeIds.map((id) => byId.get(id)).filter((n): n is BlueprintNode => !!n);
  const types = new Set(nodes.map((n) => n.type));
  const hasAgent = nodes.some((n) => AGENT_TYPES.has(n.type));

  const triggers: LaneTrigger[] = [];
  const events: string[] = [];
  for (const n of nodes) {
    if (n.type === 'trigger.cron') {
      const cron = str(n.config.cron).trim();
      triggers.push({ kind: 'schedule', cron });
    } else if (n.type === 'trigger.manual') {
      triggers.push({ kind: 'dispatch' });
    } else if (EVENT_OF[n.type]) {
      const ev = EVENT_OF[n.type];
      if (!events.includes(ev)) events.push(ev);
    }
  }
  if (events.length) triggers.push({ kind: 'event', events: events.sort() });

  const gate = nodes.find((n) => n.type === 'gate.enablement');
  const tokens = new Set<string>();
  if (hasAgent) {
    tokens.add('ANTHROPIC_API_KEY');
    tokens.add('CLAUDE_CODE_OAUTH_TOKEN');
  }
  for (const n of nodes) {
    if (n.type === 'sink.cross_repo_issue' || n.type === 'sink.repository_dispatch') {
      tokens.add(str(n.config.tokenSecret).trim() || 'FLEET_TOKEN');
    }
  }

  return {
    // Lane ids are workflow-file basenames by convention (`factory--<slug>`), as `wtd` records them.
    id: line.filename.replace(/\.ya?ml$/i, ''),
    kind: laneKindFor(nodes),
    harness: hasAgent ? 'claude-code-action' : 'engine',
    implementation: `.github/workflows/${line.filename}`,
    description: line.name,
    triggers,
    switch: gate ? str(gate.config.variable).trim() || null : null,
    uses_tokens: [...tokens].sort(),
    guardrails: {
      never_merges: !types.has('sink.merge_pr'),
      opens_pull_requests: types.has('sink.open_pr'),
    },
  };
}

/** Every assembly line of a blueprint as lanes — what `fleet.manifest.yml` would record. */
export function toFleetLanes(bp: Blueprint): FleetLane[] {
  return assemblyLines(bp).map((line) => laneForLine(bp, line));
}

// ── manifest → lanes ────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function laneFrom(v: unknown): FleetLane | null {
  if (!isRecord(v) || typeof v.id !== 'string' || !v.id.trim()) return null;
  const kind = LANE_KINDS.includes(v.kind as LaneKind) ? (v.kind as LaneKind) : 'other';
  const harness = LANE_HARNESSES.includes(v.harness as LaneHarness)
    ? (v.harness as LaneHarness)
    : 'none';
  const triggers: LaneTrigger[] = [];
  for (const t of Array.isArray(v.triggers) ? v.triggers : []) {
    if (!isRecord(t)) continue;
    if (t.kind === 'schedule' && typeof t.cron === 'string') triggers.push({ kind: 'schedule', cron: t.cron });
    else if (t.kind === 'dispatch') triggers.push({ kind: 'dispatch' });
    else if (t.kind === 'event') triggers.push({ kind: 'event', events: strList(t.events) });
  }
  const g = isRecord(v.guardrails) ? v.guardrails : {};
  const guardrails: LaneGuardrails = { never_merges: g.never_merges !== false };
  if (typeof g.opens_pull_requests === 'boolean') guardrails.opens_pull_requests = g.opens_pull_requests;
  if (Array.isArray(g.writable_paths)) guardrails.writable_paths = strList(g.writable_paths);
  if (typeof g.max_writes_per_run === 'number') guardrails.max_writes_per_run = g.max_writes_per_run;
  return {
    id: v.id.trim(),
    kind,
    harness,
    implementation: typeof v.implementation === 'string' ? v.implementation : '',
    description: typeof v.description === 'string' ? v.description : v.id.trim(),
    triggers,
    switch: typeof v.switch === 'string' && v.switch.trim() ? v.switch.trim() : null,
    uses_tokens: strList(v.uses_tokens).sort(),
    guardrails,
    ...(Array.isArray(v.state_paths) ? { state_paths: strList(v.state_paths) } : {}),
  };
}

/** Parse a `fleet.manifest.yml`. Never throws: junk yields an empty manifest with `skipped`. */
export function parseFleetManifest(text: string): FleetManifest {
  let doc: unknown = null;
  try {
    doc = parseYaml(text);
  } catch {
    doc = null;
  }
  const root = isRecord(doc) ? doc : {};
  const rawLanes = Array.isArray(root.lanes) ? root.lanes : [];
  const lanes = rawLanes.map(laneFrom).filter((l): l is FleetLane => !!l);
  const provenance =
    root.provenance === 'declared' || root.provenance === 'derived' ? root.provenance : 'unknown';
  return {
    spec_version: typeof root.spec_version === 'string' ? root.spec_version : '',
    repo: typeof root.repo === 'string' ? root.repo : '',
    provenance,
    summary: typeof root.summary === 'string' ? root.summary : '',
    lanes,
    skipped: rawLanes.length - lanes.length,
  };
}

/** The lane whose implementation is this workflow path, or whose id is its basename. */
export function laneForPath(manifest: FleetManifest | null, path: string): FleetLane | null {
  if (!manifest) return null;
  const base = path.split('/').pop()?.replace(/\.ya?ml$/i, '') ?? path;
  return (
    manifest.lanes.find((l) => l.implementation === path) ??
    manifest.lanes.find((l) => l.id === base) ??
    null
  );
}
