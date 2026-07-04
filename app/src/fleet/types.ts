// Observe-mode data model. A "fleet" is a read-only reverse-import of a repo's
// .github/workflows/*.yml — one node per workflow, belts for workflow_run chains and
// cross-repo `--repo` emissions. This is how GitFactory plugs into ANY repo (including
// hand-built ones like lifehacker.dev) without shoehorning them into the authoring
// machine types. Nothing here writes to the target repo.

import type { RepoRef } from '../github/types';

/** Coarse classification of what a workflow writes. */
export type SinkKind =
  | 'pr'
  | 'issue'
  | 'comment'
  | 'label'
  | 'commit'
  | 'deploy'
  | 'cross_repo_issue'
  | 'dispatch';

/** One entry from a workflow's `on:` block, summarized for display. */
export interface TriggerSummary {
  /** e.g. push | pull_request | issues | issue_comment | schedule | workflow_dispatch | workflow_run | repository_dispatch */
  kind: string;
  /** cron string, workflow_run source names, event types, etc. */
  detail?: string;
}

/** The AI step a workflow runs, if any. */
export interface AgentInfo {
  runner: 'claude-run' | 'claude-code-action' | 'run-sh' | 'unknown';
  /** named role from .claude/agents/<name> when passed via the `agent:` input. */
  agentName?: string;
  model?: string;
  /** --allowedTools string, when discoverable. */
  tools?: string;
}

/** One workflow file, reverse-imported. Node id on the canvas === `path`. */
export interface ImportedWorkflow {
  path: string; // .github/workflows/content-factory.yml
  name: string; // `name:` field, or the filename
  slug: string; // basename without extension
  triggers: TriggerSummary[];
  hasAgent: boolean;
  agent?: AgentInfo;
  sinks: SinkKind[];
  /** workflow NAMES this runs after (on.workflow_run.workflows); resolved to edges by buildFleet. */
  runAfterNames: string[];
  /** owner/name repos this workflow writes to via `gh … --repo`. */
  crossRepoTargets: string[];
  /** a `*_ENABLED`-style kill-switch variable, if the workflow gates on one. */
  gate?: string;
}

export type FleetEdgeKind = 'workflow_run' | 'cross_repo';

/** A belt between two fleet nodes. `to` is a workflow path or an external repo id `ext:owner/name`. */
export interface FleetEdge {
  id: string;
  from: string;
  to: string;
  kind: FleetEdgeKind;
  label?: string;
}

/** The full reverse-imported picture of one repo's automation. */
export interface Fleet {
  repo: RepoRef;
  workflows: ImportedWorkflow[];
  /** external repos targeted cross-repo, as `owner/name`. Canvas node id === `ext:owner/name`. */
  externalRepos: string[];
  edges: FleetEdge[];
  /** non-fatal parse notes (e.g. a workflow whose YAML could not be parsed). */
  warnings: string[];
}

/** Stable canvas node id for an external repo target. */
export const externalNodeId = (ownerName: string): string => `ext:${ownerName}`;
