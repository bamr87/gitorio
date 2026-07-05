// Ready-made factory blueprints — stamp one onto the canvas to start from a proven shape
// instead of a blank floor. Each compiles to zero error-level diagnostics (catalog.test.ts).
// Mirrors the real factories dogfooded on this repo (Dependency Warden) + seed-06 patterns.

import type { Blueprint } from '../blueprint/types';

export interface FactoryTemplate {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  blueprint: Blueprint;
}

const T = (
  id: string,
  type: string,
  x: number,
  y: number,
  config: Record<string, unknown> = {},
) => ({ id, type, position: { x, y }, config });
const E = (id: string, from: string, to: string) => ({
  id,
  from: { node: from, port: 'out' },
  to: { node: to, port: 'in' },
});

export const TEMPLATES: FactoryTemplate[] = [
  {
    id: 'issue-triage',
    name: 'Issue Triage Line',
    icon: '📥',
    blurb: 'New issues get triaged: a Claude agent labels them and posts a 3-line summary.',
    blueprint: {
      version: 1,
      meta: { name: 'Issue Triage Line', description: 'Label + summarize every new issue.' },
      nodes: [
        T('t', 'trigger.issue_opened', 40, 140),
        T('a', 'agent.claude', 340, 140, { promptRef: '.factory/prompts/triage.md', model: 'claude-sonnet-4-6', maxTurns: 8 }),
        T('lb', 'sink.label', 660, 60, { labels: '' }),
        T('cm', 'sink.comment', 660, 220, { instruction: 'summarizes the triage decision in 3 lines and links any duplicates' }),
      ],
      edges: [E('e1', 't', 'a'), E('e2', 'a', 'lb'), E('e3', 'a', 'cm')],
    },
  },
  {
    id: 'dependency-warden',
    name: 'Dependency Warden',
    icon: '🛡',
    blurb: 'Weekly + on-demand: review open Dependabot PRs, comment a verdict, label, and auto-merge the safe ones.',
    blueprint: {
      version: 1,
      meta: { name: 'Dependency Warden', description: 'Review + auto-merge low-risk dependency updates.' },
      nodes: [
        T('wm', 'trigger.manual', 40, 120),
        T('wc', 'trigger.cron', 40, 240, { cron: '0 6 * * 1' }),
        T('wa', 'agent.claude', 340, 180, { promptRef: '.factory/prompts/dependency-warden.md', model: 'claude-sonnet-4-6', maxTurns: 25 }),
        T('cm', 'sink.comment', 660, 60, { instruction: 'records the merge-risk verdict (bump size, breaking-change check, recommendation)' }),
        T('lb', 'sink.label', 660, 200, { labels: '' }),
        T('mg', 'sink.merge_pr', 660, 320, { method: 'squash', when: 'auto' }),
      ],
      edges: [E('e1', 'wm', 'wa'), E('e2', 'wc', 'wa'), E('e3', 'wa', 'cm'), E('e4', 'wa', 'lb'), E('e5', 'wa', 'mg')],
    },
  },
  {
    id: 'ci-failure-alarm',
    name: 'CI Failure Alarm',
    icon: '🚨',
    blurb: 'When CI fails, a Claude agent diagnoses the run from its logs and files a tracking issue.',
    blueprint: {
      version: 1,
      meta: { name: 'CI Failure Alarm', description: 'Diagnose CI failures and open an issue.' },
      nodes: [
        T('t', 'trigger.workflow_run', 40, 140, { workflow: 'CI', conclusion: 'failure' }),
        T('a', 'agent.claude', 340, 140, { promptRef: '.factory/prompts/ci-triage.md', model: 'claude-sonnet-4-6', maxTurns: 10 }),
        T('s', 'sink.create_issue', 660, 140, { titleHint: 'CI failed on main' }),
      ],
      edges: [E('e1', 't', 'a'), E('e2', 'a', 's')],
    },
  },
  {
    id: 'dependabot-automerge',
    name: 'Dependabot Auto-merge',
    icon: '✅',
    blurb: 'Deterministic (no agent/secrets): auto-merge patch & minor Dependabot PRs once their checks pass.',
    blueprint: {
      version: 1,
      meta: { name: 'Dependabot Auto-merge', description: 'Auto-merge low-risk Dependabot updates.' },
      nodes: [
        T('t', 'trigger.pr_opened', 40, 140),
        T('m', 'processor.dependabot_meta', 340, 140, { allow: 'patch-and-minor' }),
        T('s', 'sink.merge_pr', 660, 140, { method: 'squash', when: 'auto' }),
      ],
      edges: [E('e1', 't', 'm'), E('e2', 'm', 's')],
    },
  },
  {
    id: 'watchdog',
    name: 'Watchdog',
    icon: '🐕',
    blurb: 'A daily agent scans the repo for trouble and files an alarm issue — rate-limited so it can never runaway.',
    blueprint: {
      version: 1,
      meta: { name: 'Watchdog', description: 'Daily health scan → alarm issue, rate-limited.' },
      nodes: [
        T('t', 'trigger.cron', 40, 160, { cron: '0 7 * * *' }),
        T('rl', 'rate.limiter', 240, 160, { maxPerDay: 4 }),
        T('a', 'agent.claude', 440, 160, { promptRef: '.factory/prompts/watchdog.md', model: 'claude-sonnet-4-6', maxTurns: 12 }),
        T('s', 'sink.create_issue', 720, 160, { titleHint: 'Factory alarm' }),
      ],
      edges: [E('e1', 't', 'rl'), E('e2', 'rl', 'a'), E('e3', 'a', 's')],
    },
  },
];
