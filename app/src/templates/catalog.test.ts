import { describe, expect, it } from 'vitest';
import { TEMPLATES } from './catalog';
import { compile } from '../compiler/compile';
import { machineDef } from '../machines/registry';

describe('template catalog', () => {
  it('has unique ids and non-empty metadata', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TEMPLATES) {
      expect(t.name).toBeTruthy();
      expect(t.icon).toBeTruthy();
      expect(t.blurb.length).toBeGreaterThan(10);
      expect(t.blueprint.nodes.length).toBeGreaterThan(0);
    }
  });

  it('every template references only real machine types', () => {
    for (const t of TEMPLATES) {
      for (const n of t.blueprint.nodes) {
        expect(machineDef(n.type), `${t.id} → ${n.type}`).toBeDefined();
      }
    }
  });

  it('issue-factory: two lines (batch + fix) behind ONE kill switch, sorter and fixer strictly separated', () => {
    const t = TEMPLATES.find((x) => x.id === 'issue-factory')!;
    const { workflows } = compile(t.blueprint);
    expect(workflows.map((w) => w.filename)).toEqual([
      'factory--issue-factory-1.yml',
      'factory--issue-factory-2.yml',
    ]);
    const [batch, fix] = workflows;
    // both lines armed/disarmed by the same repo variable
    expect(batch.yaml).toContain('ENABLED: ${{ vars.ISSUE_FACTORY_ENABLED }}');
    expect(fix.yaml).toContain('ENABLED: ${{ vars.ISSUE_FACTORY_ENABLED }}');
    // line 1 sorts (work orders), line 2 fixes (one PR) — capabilities must not bleed across
    expect(batch.yaml).toContain('issue_batcher');
    expect(batch.yaml).not.toContain('Bash(gh pr create:*)');
    expect(fix.yaml).toContain('.factory/prompts/issue-fixer.md');
    expect(fix.yaml).toContain('Bash(gh pr create:*)');
    expect(fix.yaml).not.toContain('Bash(gh pr merge:*)');
  });

  it('every template compiles with zero error-level diagnostics', () => {
    for (const t of TEMPLATES) {
      const { workflows, diagnostics } = compile(t.blueprint);
      const errors = [
        ...diagnostics.filter((d) => d.level === 'error'),
        ...workflows.flatMap((w) => w.diagnostics.filter((d) => d.level === 'error')),
      ];
      expect(errors, `${t.id}: ${errors.map((e) => e.message).join('; ')}`).toHaveLength(0);
      expect(workflows.length).toBeGreaterThan(0);
    }
  });
});
