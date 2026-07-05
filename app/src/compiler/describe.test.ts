import { describe, expect, it } from 'vitest';
import { compile } from './compile';
import { describeWorkflow, describeTool } from './describe';
import type { Blueprint } from '../blueprint/types';

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id, type, position: { x: 0, y: 0 }, config,
});
const edge = (id: string, from: string, to: string) => ({
  id, from: { node: from, port: 'out' }, to: { node: to, port: 'in' },
});

describe('describeWorkflow', () => {
  it('extracts triggers, permissions, agent tools + obligations from a triage line', () => {
    const bp: Blueprint = {
      version: 1,
      meta: { name: 'Issue Triage Line' },
      nodes: [
        node('t', 'trigger.issue_opened'),
        node('a', 'agent.claude', { promptRef: '.factory/prompts/triage.md', model: 'claude-sonnet-4-6', maxTurns: 8 }),
        node('lb', 'sink.label', { labels: '' }),
        node('cm', 'sink.comment', { instruction: 'summarize' }),
      ],
      edges: [edge('e1', 't', 'a'), edge('e2', 'a', 'lb'), edge('e3', 'a', 'cm')],
    };
    const facts = describeWorkflow(compile(bp).workflows[0].yaml);
    expect(facts.name).toBe('Factory: Issue Triage Line');
    expect(facts.events.some((e) => e.startsWith('issues'))).toBe(true);
    expect(facts.permissions.issues).toBe('write');
    expect(facts.killSwitchVar).toBeNull();
    expect(facts.agent).not.toBeNull();
    expect(facts.agent!.model).toBe('claude-sonnet-4-6');
    expect(facts.agent!.maxTurns).toBe(8);
    expect(facts.agent!.promptRef).toBe('.factory/prompts/triage.md');
    expect(facts.agent!.tools).toContain('Bash(gh issue comment:*)');
    expect(facts.agent!.obligations.length).toBeGreaterThanOrEqual(2);
  });

  it('reads the kill-switch variable, cron, plan-first flag, and rate limit', () => {
    const bp: Blueprint = {
      version: 1,
      meta: { name: 'Docs Gardener' },
      nodes: [
        node('cd', 'trigger.cron', { cron: '0 8 * * *' }),
        node('cm', 'trigger.manual', { mode: 'plan-first' }),
        node('g', 'gate.enablement', { variable: 'DOCS_GARDENER_ENABLED' }),
        node('rl', 'rate.limiter', { maxPerDay: 2 }),
        node('a', 'agent.claude', { promptRef: '.factory/prompts/docs-gardener.md', model: 'claude-opus-4-8' }),
        node('pr', 'sink.open_pr', {}),
      ],
      edges: [edge('e1', 'cd', 'g'), edge('e2', 'cm', 'g'), edge('e3', 'g', 'rl'), edge('e4', 'rl', 'a'), edge('e5', 'a', 'pr')],
    };
    const facts = describeWorkflow(compile(bp).workflows[0].yaml);
    expect(facts.killSwitchVar).toBe('DOCS_GARDENER_ENABLED');
    expect(facts.crons).toEqual(['0 8 * * *']);
    expect(facts.planFirst).toBe(true);
    expect(facts.rateLimitPerDay).toBe(2);
    expect(facts.agent!.tools).toContain('Edit');
  });

  it('is total on malformed input', () => {
    expect(describeWorkflow('').agent).toBeNull();
    expect(describeWorkflow(': : not yaml').events).toEqual([]);
  });
});

describe('describeTool', () => {
  it('turns grants into readable phrases', () => {
    expect(describeTool('Bash(gh issue comment:*)')).toBe('comment on issues');
    expect(describeTool('Bash(gh pr merge:*)')).toBe('merge pull requests');
    expect(describeTool('Edit')).toBe('edit repository files');
    expect(describeTool('Bash(git commit:*)')).toBe('run git (branch/commit/push)');
    expect(describeTool('Bash(gh run list:*)')).toBe('read workflow-run telemetry');
    expect(describeTool('Bash(gh search issues:*)')).toBe('search issues');
    expect(describeTool('Bash(gh label list:*)')).toBe('list labels');
  });
});
