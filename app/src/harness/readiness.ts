// Design readiness (specs/014, FR-8): the hub's six-layer harness model, evaluated at design
// time over a blueprint. The hub's `docs/HARNESS.md` maps a running control plane onto the
// playbook's layers — guides, sensors, the bounded loop, memory, permissions, observability —
// and scores it against a twelve-row production-readiness checklist. GitFactory's machines
// are those layers as parts: a promptRef is a guide, `checks` and the verified-fix gate are
// sensors, `maxTurns` + a rate limiter bound the loop, the ledger is memory, the enablement
// gate and computed permissions are the boundary, the compiled `factory--*.yml` is what the
// telemetry observes. Pure: reads the blueprint and the compiler's facts, nothing else.

import type { Blueprint, BlueprintNode } from '../blueprint/types';
import { assemblyLines, compile, type AssemblyLine } from '../compiler/compile';
import { describeWorkflow } from '../compiler/describe';
import { LOOP_PRONE_TRIGGERS } from '../archify/vocabulary';

export type LayerId = 'guides' | 'sensors' | 'loop' | 'memory' | 'permissions' | 'observability';
export type LayerStatus = 'ok' | 'warn' | 'missing' | 'n/a';

export interface LayerReport {
  id: LayerId;
  label: string;
  status: LayerStatus;
  /** What was found — machine ids and facts, as short phrases. */
  evidence: string[];
  /** What is missing, phrased as the fix. */
  gaps: string[];
}

export interface LineReadiness {
  line: AssemblyLine;
  hasAgent: boolean;
  layers: LayerReport[];
  /** 0–100: ok = full, warn = half, missing = none, n/a excluded. */
  score: number;
}

export interface ChecklistRow {
  n: number;
  requirement: string;
  status: 'ok' | 'warn' | 'missing';
  note: string;
}

export interface BlueprintReadiness {
  lines: LineReadiness[];
  checklist: ChecklistRow[];
  /** Mean of the agent lines' scores (deterministic lines are not harnesses). */
  score: number;
}

export const LAYERS: { id: LayerId; label: string }[] = [
  { id: 'guides', label: 'Guides' },
  { id: 'sensors', label: 'Sensors' },
  { id: 'loop', label: 'Bounded loop' },
  { id: 'memory', label: 'Memory' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'observability', label: 'Observability' },
];

const AGENT_TYPES = new Set(['agent.claude', 'processor.feedback_controller']);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const numOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function layer(
  id: LayerId,
  evidence: string[],
  gaps: string[],
  opts: { na?: boolean; warnWhen?: boolean } = {},
): LayerReport {
  const label = LAYERS.find((l) => l.id === id)!.label;
  let status: LayerStatus;
  if (opts.na) status = 'n/a';
  else if (gaps.length === 0) status = 'ok';
  else if (evidence.length > 0 || opts.warnWhen) status = 'warn';
  else status = 'missing';
  return { id, label, status, evidence, gaps };
}

/** One line's six layers. */
export function lineReadiness(
  bp: Blueprint,
  line: AssemblyLine,
  compiledYaml: string | undefined,
): LineReadiness {
  const byId = new Map(bp.nodes.map((n) => [n.id, n]));
  const nodes = line.nodeIds.map((id) => byId.get(id)).filter((n): n is BlueprintNode => !!n);
  const of = (type: string) => nodes.filter((n) => n.type === type);
  const has = (...types: string[]) => nodes.some((n) => types.includes(n.type));
  const agents = nodes.filter((n) => AGENT_TYPES.has(n.type));
  const hasAgent = agents.length > 0;
  const facts = compiledYaml ? describeWorkflow(compiledYaml) : null;
  const tag = (n: BlueprintNode) => `${n.type} · ${n.id}`;

  // Guides — the prompt file is the guide; the checks list is the guide's build/test line.
  const withPrompt = agents.filter((a) => str(a.config.promptRef).trim());
  const guides = layer(
    'guides',
    withPrompt.map((a) => `promptRef ${str(a.config.promptRef)} (${a.id})`),
    agents.filter((a) => !str(a.config.promptRef).trim()).map((a) => `give ${a.id} a promptRef under .factory/prompts/`),
    { na: !hasAgent },
  );

  // Sensors — computational checks before anything inferential.
  const sensorEvidence = [
    ...agents.filter((a) => str(a.config.checks).trim()).map((a) => `checks declared on ${a.id}`),
    ...of('gate.verified_fix').map(tag),
    ...of('processor.evidence').map(tag),
    ...of('filter.condition').map(tag),
  ];
  const sensors = layer(
    'sensors',
    sensorEvidence,
    sensorEvidence.length ? [] : ['add a verification: `checks` on the agent, or an evidence seal + verified-fix gate'],
    { na: !hasAgent },
  );

  // Bounded loop — a turn budget, a run cap, and the actor guard where the loop could re-trigger.
  const turns = agents.map((a) => numOf(a.config.maxTurns)).filter((t): t is number => t !== null);
  const loopProne = nodes.some((n) => LOOP_PRONE_TRIGGERS.has(n.type)) && has('sink.comment', 'sink.label', 'sink.create_issue', 'sink.open_pr');
  const loopEvidence = [
    ...(turns.length ? [`max turns ${turns.join('/')}`] : []),
    ...of('rate.limiter').map((n) => `rate limiter ≤ ${numOf(n.config.maxPerDay) ?? '?'}/day`),
    ...of('gate.budget').map((n) => `budget gate ≤ ${numOf(n.config.maxOpenPrs) ?? '?'} open PRs`),
    ...(loopProne ? ['bot-actor guard (compiler)'] : []),
  ];
  const loopGaps = [
    ...(hasAgent && !turns.length ? ['set maxTurns on the agent'] : []),
    ...(hasAgent && !has('rate.limiter', 'gate.budget') && has('trigger.cron') ? ['add a rate limiter or budget gate to a scheduled agent line'] : []),
  ];
  const loop = layer('loop', loopEvidence, loopGaps, { na: !hasAgent });

  // Memory — a committed ledger or state the line writes back.
  const memoryEvidence = [...of('processor.ledger').map((n) => `ledger ${str(n.config.ledgerPath) || '(path unset)'}`), ...of('sink.commit_files').map(tag)];
  const memory = layer('memory', memoryEvidence, memoryEvidence.length ? [] : ['no committed state: add a ledger or commit-files sink when runs should compound'], { na: !hasAgent, warnWhen: true });

  // Permissions — least privilege computed by the compiler, a kill switch, no merge grant on agent lines.
  const perms = facts ? Object.entries(facts.permissions) : [];
  // id-token:write is claude-code-action's own OIDC need, not a sink's reach — never a scope to question.
  const writes = perms.filter(([k, v]) => v === 'write' && k !== 'id-token').map(([k]) => k);
  const permEvidence = [
    ...(facts ? [`permissions: ${perms.length ? perms.map(([k, v]) => `${k}:${v}`).join(' ') : 'read-only'}`] : []),
    ...(facts?.killSwitchVar ? [`kill switch vars.${facts.killSwitchVar}`] : []),
    ...(loopProne ? ['actor guard'] : []),
  ];
  const permGaps = [
    ...(hasAgent && !facts?.killSwitchVar && has('trigger.cron') ? ['put the scheduled line behind a gate.enablement switch (default-OFF)'] : []),
    ...(hasAgent && has('sink.merge_pr') ? ['an agent line carries a merge sink — merge policy belongs to a deterministic label-gated line (ADR-015)'] : []),
    ...(writes.length > 2 ? [`${writes.length} write scopes — check the sinks are all needed`] : []),
  ];
  const permissions = layer('permissions', permEvidence, permGaps);

  // Observability — the compiled line is what telemetry polls; a name is what the fleet sees.
  const obsEvidence = [
    ...(compiledYaml ? [`compiles to ${line.filename}`] : []),
    ...(facts?.crons.length ? [`schedule ${facts.crons.join(', ')}`] : []),
  ];
  const observability = layer('observability', obsEvidence, compiledYaml ? [] : ['the line does not compile — fix its diagnostics'], { warnWhen: true });

  const layers = [guides, sensors, loop, memory, permissions, observability];
  const scored = layers.filter((l) => l.status !== 'n/a');
  const points = scored.reduce((s, l) => s + (l.status === 'ok' ? 1 : l.status === 'warn' ? 0.5 : 0), 0);
  const score = scored.length ? Math.round((100 * points) / scored.length) : 0;
  return { line, hasAgent, layers, score };
}

/** The hub's twelve-row production-readiness checklist (docs/HARNESS.md, playbook Table XIII). */
export function checklist(lines: LineReadiness[]): ChecklistRow[] {
  const agentLines = lines.filter((l) => l.hasAgent);
  const st = (id: LayerId) => agentLines.map((l) => l.layers.find((x) => x.id === id)!.status);
  const all = (id: LayerId) => agentLines.length > 0 && st(id).every((s) => s === 'ok');
  const any = (id: LayerId) => st(id).some((s) => s === 'ok' || s === 'warn');
  const row = (n: number, requirement: string, ok: boolean, some: boolean, note: string): ChecklistRow => ({
    n,
    requirement,
    status: ok ? 'ok' : some ? 'warn' : 'missing',
    note,
  });
  const none = agentLines.length === 0;
  return [
    row(1, 'Guide file with build/test/lint', all('guides'), any('guides'), none ? 'no agent lines' : 'promptRef on every agent'),
    row(2, '5+ guide rules from failures', any('guides'), any('guides'), 'the prompt file carries the rules; count them there'),
    row(3, 'Computational sensor per task', all('sensors'), any('sensors'), 'checks / evidence seal / verified-fix gate'),
    row(4, 'Bounded retry + escalation', all('loop'), any('loop'), 'max turns, rate limiter or budget gate, actor guard'),
    row(5, 'State checkpoint to filesystem', all('memory'), any('memory'), 'ledger or committed files'),
    row(6, 'Permission boundary', lines.every((l) => l.layers.find((x) => x.id === 'permissions')!.status === 'ok'), true, 'computed least-privilege permissions; no merge on agent lines'),
    row(7, 'Token and cost budget', agentLines.every((l) => l.layers.find((x) => x.id === 'loop')!.evidence.some((e) => e.startsWith('max turns'))), any('loop'), 'turn budgets enforced; dollar budgets are the hub’s shadow price'),
    row(8, 'Structured logging', lines.every((l) => l.layers.find((x) => x.id === 'observability')!.status === 'ok'), true, 'every line compiles to a named workflow the telemetry polls'),
    row(9, 'Trip wire on cost/error rate', true, true, 'the hub’s six wires run over this fleet (Harness tab)'),
    row(10, 'Trusted/untrusted input split', true, true, 'the compiler passes entity numbers, never bodies (ARCHITECTURE § 8)'),
    row(11, 'Emergency stop + state preserve', agentLines.every((l) => l.layers.find((x) => x.id === 'permissions')!.evidence.some((e) => e.startsWith('kill switch'))), agentLines.some((l) => l.layers.find((x) => x.id === 'permissions')!.evidence.some((e) => e.startsWith('kill switch'))), 'gate.enablement kill switch on every autonomous line'),
    row(12, '3 successful unattended runs', false, false, 'read from telemetry once deployed — the Monitor tab'),
  ];
}

/** The whole blueprint: every line's layers, the checklist, and one score. */
export function blueprintReadiness(bp: Blueprint): BlueprintReadiness {
  const compiled = compile(bp);
  const yamlByFile = new Map(compiled.workflows.map((w) => [w.filename, w.yaml]));
  const lines = assemblyLines(bp).map((line) => lineReadiness(bp, line, yamlByFile.get(line.filename) || undefined));
  const agentLines = lines.filter((l) => l.hasAgent);
  const score = agentLines.length
    ? Math.round(agentLines.reduce((s, l) => s + l.score, 0) / agentLines.length)
    : 0;
  return { lines, checklist: checklist(lines), score };
}
