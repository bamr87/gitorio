// Implements: docs/spec/06-upkeep.md §3.4 (the report: one markdown document a human — or the
// in-tree agent — can act on without opening the plan JSON).
//
// The report is written for two readers at once. A human skims the summary table and the
// in-tree checklist. The `tend` agent (.github/workflows/upkeep.yml) reads the in-tree section
// as its work order, so every in-tree line carries its remedy and, when one exists, its
// `path:line` citation.

import { describeAction } from './apply.js';
import { docsReviewFindings, resolveContent } from './content.js';
import { FACETS, type ActionOutcome, type Finding, type UpkeepPlan } from './types.js';

/** Findings from the plan plus those the docs-review slot produced. */
export function allFindings(plan: UpkeepPlan): readonly Finding[] {
  return [...plan.findings, ...docsReviewFindings(plan)];
}

export function inTreeFindings(plan: UpkeepPlan): readonly Finding[] {
  return allFindings(plan).filter((f) => f.where === 'in-tree');
}

const MARK: Readonly<Record<Finding['severity'], string>> = { error: '**error**', warn: 'warn', info: 'info' };

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderReport(plan: UpkeepPlan, outcomes?: readonly ActionOutcome[]): string {
  const findings = allFindings(plan);
  const remote = findings.filter((f) => f.where === 'remote');
  const inTree = findings.filter((f) => f.where === 'in-tree');
  const out: string[] = [];

  out.push(`# Repository upkeep${plan.repository !== null ? ` — ${plan.repository}` : ''}`);
  out.push('');
  const host = plan.observed.host;
  out.push(
    [
      `HEAD \`${plan.observed.head.slice(0, 7)}\`${plan.observed.branch !== null ? ` on \`${plan.observed.branch}\`` : ''}`,
      `version ${plan.observed.version ?? '(unknown)'}`,
      `latest tag ${plan.observed.latest_tag ?? '(none)'}`,
      `forge: ${host === null ? `**unobserved**${plan.observed.host_error !== undefined ? ` (${plan.observed.host_error})` : ''}` : host.host}`,
      `mode: ${plan.mode}`,
      `generated ${plan.generated_at}`,
    ].join(' · '),
  );
  out.push('');

  if (findings.length === 0) {
    out.push('No drift. The repository matches its upkeep config.');
    out.push('');
    return out.join('\n');
  }

  out.push('| Facet | Findings | Remote (auto-fixable) | In-tree (needs a PR) |');
  out.push('|---|---:|---:|---:|');
  for (const facet of FACETS) {
    const fs = findings.filter((f) => f.facet === facet);
    if (fs.length === 0) continue;
    out.push(`| ${facet} | ${fs.length} | ${fs.filter((f) => f.where === 'remote').length} | ${fs.filter((f) => f.where === 'in-tree').length} |`);
  }
  out.push('');

  if (remote.length > 0) {
    out.push('## Remote drift');
    out.push('');
    for (const f of remote) {
      const detail = f.expected !== undefined ? ` — expected \`${cell(f.expected)}\`, found \`${cell(f.actual ?? '')}\`` : '';
      out.push(`- ${MARK[f.severity]} ${f.summary}${detail}${f.actions.length > 0 ? ` → ${f.actions.join(', ')}` : ''}`);
      if (f.remedy !== undefined) out.push(`  - ${f.remedy}`);
    }
    out.push('');
  }

  if (plan.actions.length > 0) {
    const byId = new Map((outcomes ?? []).map((o) => [o.action, o]));
    out.push('## Actions');
    out.push('');
    out.push(outcomes === undefined ? '| Id | Action |' : '| Id | Action | Outcome |');
    out.push(outcomes === undefined ? '|---|---|' : '|---|---|---|');
    for (const a of plan.actions) {
      const o = byId.get(a.id);
      const row = `| ${a.id} | ${cell(describeAction(plan, a))} |`;
      out.push(outcomes === undefined ? row : `${row} ${o === undefined ? '—' : `${o.status}${o.status === 'applied' || o.status === 'planned' ? '' : `: ${cell(o.detail)}`}`} |`);
    }
    out.push('');
  }

  if (inTree.length > 0) {
    out.push('## In-tree work (needs a reviewed PR)');
    out.push('');
    out.push('Upkeep never commits to the tree. Each item below is a change for a human or the `tend` agent to make in a PR.');
    out.push('');
    for (const f of inTree) {
      const where = f.citation !== undefined ? ` (\`${f.citation.path}:${f.citation.line}\`)` : '';
      out.push(`- [ ] ${MARK[f.severity]} ${f.summary}${where}`);
      if (f.remedy !== undefined) out.push(`  - ${f.remedy}`);
    }
    out.push('');
  }

  if (plan.content.length > 0) {
    out.push('## Authored content');
    out.push('');
    out.push('| Slot | Kind | Source | Note |');
    out.push('|---|---|---|---|');
    for (const c of plan.content) {
      const r = resolveContent(c);
      const source = r.source === 'filled' ? `filled by ${c.provider ?? 'unknown'}` : `fallback (${c.status})`;
      out.push(`| ${c.id} | ${c.kind} | ${cell(source)} | ${cell(r.issue ?? '')} |`);
    }
    out.push('');
  }

  return out.join('\n');
}
