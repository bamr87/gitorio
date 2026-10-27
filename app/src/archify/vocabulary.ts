// The shared vocabulary between GitFactory's machines and archify's semantic component
// types (ADR-034, specs/010-archify-maps). Archify has exactly seven colours and insists
// colour carries meaning; this table decides, once, what each machine kind MEANS on a map
// so the editor, the maps, and (later) the design tokens all agree. Pure: no I/O.

import { MACHINES } from '../machines/registry';

/** Archify's `componentType` enum (vendor/archify/schemas/common.schema.json). */
export type ComponentType =
  'frontend' | 'backend' | 'database' | 'cloud' | 'security' | 'messagebus' | 'external';

/** Swimlane a machine belongs to on a workflow map. */
export type LaneId = 'triggers' | 'policy' | 'agent' | 'sinks';

export interface VocabularyEntry {
  component: ComponentType;
  lane: LaneId;
  /** ≤ 12 characters — the renderer's 92 px node fits about that much at its label size. */
  label: string;
}

/** Lane order on the map: what starts it, what governs it, what thinks, what it emits. */
export const LANES: { id: LaneId; label: string }[] = [
  { id: 'triggers', label: 'Triggers' },
  { id: 'policy', label: 'Gates & limits' },
  { id: 'agent', label: 'Processing' },
  { id: 'sinks', label: 'Outputs' },
];

/**
 * How the seven archify colours read on a GitFactory map. Overrides archify's default
 * legend words ("Frontend", "Backend"…) with the factory metaphor.
 */
export const LEGEND: Record<ComponentType, string> = {
  external: 'Trigger',
  security: 'Gate / guard',
  backend: 'Agent',
  database: 'Ledger / evidence',
  frontend: 'Output',
  messagebus: 'Dispatch belt',
  cloud: 'Cross-repo',
};

export const VOCABULARY: Record<string, VocabularyEntry> = {
  'trigger.issue_opened': { component: 'external', lane: 'triggers', label: 'Issue opened' },
  'trigger.issue_labeled': { component: 'external', lane: 'triggers', label: 'Issue label' },
  'trigger.pr_opened': { component: 'external', lane: 'triggers', label: 'PR opened' },
  'trigger.comment': { component: 'external', lane: 'triggers', label: 'Comment' },
  'trigger.cron': { component: 'external', lane: 'triggers', label: 'Schedule' },
  'trigger.manual': { component: 'external', lane: 'triggers', label: 'Manual lever' },
  'trigger.workflow_run': { component: 'external', lane: 'triggers', label: 'After run' },
  'trigger.repository_dispatch': {
    component: 'messagebus',
    lane: 'triggers',
    label: 'Dispatch in',
  },
  'agent.claude': { component: 'backend', lane: 'agent', label: 'Claude agent' },
  'filter.condition': { component: 'security', lane: 'policy', label: 'Condition' },
  'processor.dependabot_meta': { component: 'backend', lane: 'agent', label: 'Dependabot' },
  'gate.approval': { component: 'security', lane: 'policy', label: 'Approval' },
  'rate.limiter': { component: 'security', lane: 'policy', label: 'Rate limit' },
  'gate.enablement': { component: 'security', lane: 'policy', label: 'Kill switch' },
  'processor.ledger': { component: 'database', lane: 'agent', label: 'Ledger' },
  'gate.budget': { component: 'security', lane: 'policy', label: 'Budget gate' },
  'processor.evidence': { component: 'database', lane: 'agent', label: 'Evidence' },
  'gate.verified_fix': { component: 'security', lane: 'policy', label: 'Verified fix' },
  'processor.feedback_controller': { component: 'backend', lane: 'agent', label: 'Loop tuner' },
  'processor.issue_batcher': { component: 'backend', lane: 'agent', label: 'Issue sorter' },
  'sink.comment': { component: 'frontend', lane: 'sinks', label: 'Comment' },
  'sink.label': { component: 'frontend', lane: 'sinks', label: 'Label' },
  'sink.create_issue': { component: 'frontend', lane: 'sinks', label: 'Create issue' },
  'sink.open_pr': { component: 'frontend', lane: 'sinks', label: 'Open PR' },
  'sink.repository_dispatch': { component: 'messagebus', lane: 'sinks', label: 'Dispatch out' },
  'sink.cross_repo_issue': { component: 'cloud', lane: 'sinks', label: 'Cross-repo' },
  'sink.merge_pr': { component: 'frontend', lane: 'sinks', label: 'Merge PR' },
  'sink.commit_files': { component: 'frontend', lane: 'sinks', label: 'Commit files' },
};

/** Lookup with a prefix fallback so an unmapped future machine still renders somewhere sane. */
export function vocabularyFor(type: string): VocabularyEntry {
  const hit = VOCABULARY[type];
  if (hit) return hit;
  const head = type.split('.')[0];
  const tail = (type.split('.')[1] ?? type).replace(/_/g, ' ');
  const label = tail.length > 12 ? tail.slice(0, 12) : tail;
  if (head === 'trigger') return { component: 'external', lane: 'triggers', label };
  if (head === 'sink') return { component: 'frontend', lane: 'sinks', label };
  if (head === 'gate' || head === 'rate' || head === 'filter') {
    return { component: 'security', lane: 'policy', label };
  }
  return { component: 'backend', lane: 'agent', label };
}

/** Registry types that have no explicit entry — the drift guard asserts this is empty. */
export function unmappedMachineTypes(): string[] {
  return MACHINES.map((m) => m.type).filter((t) => !(t in VOCABULARY));
}

/** Triggers whose events an agent's own writes can re-emit (ADR-009's loop condition). */
export const LOOP_PRONE_TRIGGERS = new Set([
  'trigger.issue_opened',
  'trigger.issue_labeled',
  'trigger.pr_opened',
  'trigger.comment',
]);

/** The canvas/palette CSS modifier for a machine kind — the same colour the maps use. */
export function machineTone(type: string): `c-${ComponentType}` {
  return `c-${vocabularyFor(type).component}`;
}
