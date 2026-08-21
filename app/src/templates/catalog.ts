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
  {
    id: 'headless-cms',
    name: 'Headless CMS',
    icon: '📰',
    blurb:
      'An autonomous, configurable content factory: a daily AI writer drafts content as PRs a human merges, and a weekly loop-tuner reads the factory’s own telemetry and improves it. Both are default-OFF behind repo-variable kill switches; the writer’s manual runs are dry runs unless you tick “apply”.',
    blueprint: {
      version: 1,
      meta: {
        name: 'Headless CMS',
        description:
          'Daily AI content drafts (as reviewable PRs) + a weekly self-tuning feedback loop, all default-OFF behind enablement gates.',
      },
      nodes: [
        // Line 1 — content generation: scheduled + plan-first manual, kill-switched, rate-limited.
        T('cd', 'trigger.cron', 40, 80, { cron: '0 9 * * *' }),
        T('cm', 'trigger.manual', 40, 200, { mode: 'plan-first' }),
        T('cg', 'gate.enablement', 240, 140, { variable: 'CONTENT_FACTORY_ENABLED' }),
        T('crl', 'rate.limiter', 430, 140, { maxPerDay: 4 }),
        T('ca', 'agent.claude', 620, 140, { promptRef: '.factory/prompts/content-grow.md', model: 'claude-opus-4-8', maxTurns: 20 }),
        T('cpr', 'sink.open_pr', 860, 140, { branchHint: 'factory/content-*' }),
        // Line 2 — the feedback loop: weekly, kill-switched, tunes the factory itself.
        T('ld', 'trigger.cron', 40, 380, { cron: '23 6 * * 1' }),
        T('lg', 'gate.enablement', 300, 380, { variable: 'LOOP_TUNER_ENABLED' }),
        T('lf', 'processor.feedback_controller', 560, 380, {
          promptRef: '.factory/prompts/loop-tuner.md',
          model: 'claude-opus-4-8',
          ledgerPath: '.factory/metrics/improvements.yml',
          windowDays: 7,
          maxTurns: 30,
        }),
      ],
      edges: [
        E('e1', 'cd', 'cg'),
        E('e2', 'cm', 'cg'),
        E('e3', 'cg', 'crl'),
        E('e4', 'crl', 'ca'),
        E('e5', 'ca', 'cpr'),
        E('e6', 'ld', 'lg'),
        E('e7', 'lg', 'lf'),
      ],
    },
  },
  {
    id: 'docs-gardener',
    name: 'Docs Gardener',
    icon: '📖',
    blurb:
      'Each morning, scan the docs collection and improve a few items: a Claude agent picks the most-improvable docs, applies the review criteria + skill specializations from .factory/config.yml, and opens ONE PR you review. Default-OFF behind a kill switch; a manual run is a dry run unless you tick “apply”.',
    blueprint: {
      version: 1,
      meta: {
        name: 'Docs Gardener',
        description: 'Daily: review + improve a few docs from the collection, as a reviewable PR.',
      },
      nodes: [
        T('dd', 'trigger.cron', 40, 90, { cron: '0 8 * * *' }),
        T('dm', 'trigger.manual', 40, 210, { mode: 'plan-first' }),
        T('dg', 'gate.enablement', 250, 150, { variable: 'DOCS_GARDENER_ENABLED' }),
        T('drl', 'rate.limiter', 440, 150, { maxPerDay: 2 }),
        T('da', 'agent.claude', 630, 150, { promptRef: '.factory/prompts/docs-gardener.md', model: 'claude-opus-4-8', maxTurns: 24 }),
        T('dpr', 'sink.open_pr', 870, 150, { branchHint: 'factory/docs-*' }),
      ],
      edges: [
        E('e1', 'dd', 'dg'),
        E('e2', 'dm', 'dg'),
        E('e3', 'dg', 'drl'),
        E('e4', 'drl', 'da'),
        E('e5', 'da', 'dpr'),
      ],
    },
  },
  {
    id: 'label-gated-automerge',
    name: 'Label-Gated Automerge',
    icon: '🏷️',
    blurb:
      'The ADR-015 lesson as structure: when a human (or a vetting agent like the Dependency Warden) adds the gate label, a deterministic line merges the PR — no agent judgment in the merge path, auto-merge waits for required checks. Merge policy compiles to YAML instead of living as prose.',
    blueprint: {
      version: 1,
      meta: {
        name: 'Label-Gated Automerge',
        description: 'Adding the gate label merges the PR deterministically (auto-merge honors required checks).',
      },
      nodes: [
        T('lt', 'trigger.pr_opened', 40, 140, { fireOn: 'labeled', label: 'dep:safe-to-merge' }),
        T('lm', 'sink.merge_pr', 360, 140, { method: 'squash', when: 'auto' }),
      ],
      edges: [E('e1', 'lt', 'lm')],
    },
  },
  {
    id: 'ao-sdlc-autopilot',
    name: 'AO-SDLC Autopilot',
    icon: '♻️',
    blurb:
      'Weekly + on-demand: a Claude agent advances a spec-driven repo by one AO-SDLC cycle — pick the top BACKLOG item, run the specify→implement chain, and end in ONE reviewable PR (it never merges). Default-OFF behind a kill switch; a manual run plans only unless you tick “apply”. Pair with a BACKLOG.md + specs/ layout like gitorio’s or law-ai’s.',
    blueprint: {
      version: 1,
      meta: {
        name: 'AO-SDLC Autopilot',
        description: 'Weekly: advance the repo by one spec-driven cycle, as a reviewable PR.',
      },
      nodes: [
        T('ec', 'trigger.cron', 40, 90, { cron: '0 15 * * 1' }),
        T('em', 'trigger.manual', 40, 210, { mode: 'plan-first' }),
        T('eg', 'gate.enablement', 250, 150, { variable: 'AO_SDLC_AUTOPILOT_ENABLED' }),
        T('erl', 'rate.limiter', 440, 150, { maxPerDay: 1 }),
        T('ea', 'agent.claude', 630, 150, { promptRef: '.factory/prompts/evolve-pilot.md', model: 'claude-opus-4-8', maxTurns: 40 }),
        T('epr', 'sink.open_pr', 870, 150, { branchHint: 'factory/evolve-*' }),
      ],
      edges: [
        E('e1', 'ec', 'eg'),
        E('e2', 'em', 'eg'),
        E('e3', 'eg', 'erl'),
        E('e4', 'erl', 'ea'),
        E('e5', 'ea', 'epr'),
      ],
    },
  },
];
