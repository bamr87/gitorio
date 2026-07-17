// Deep-facts extractor for one workflow file — the Fleet Ops "machine inspection
// report" behind the audit rules, the metrics labeler, and the cockpit UI.
// `extractFacts` reuses parseWorkflow (name/triggers/sinks/cross-repo) and then mines
// everything else the WorkflowFacts contract asks for; `classifyDashType` is an exact
// port of the dash's ordered-substring cost classifier (actions_analytics.py);
// `classifyArchetype` maps the extracted signals onto the fleet's design-pattern
// taxonomy. PURE and total: no I/O, never throws on malformed input.
//
// Like parse.ts, structure (jobs, permissions, concurrency, dispatch inputs) is read
// via the `yaml` parser when the file parses, but most signals come from raw-text
// scans: in the real bamr87 fleet they live in `env:`/`run:` blocks and agent prompt
// strings as often as in the YAML tree. Notably, the dominant AI path is a local
// composite (./.github/actions/claude-run) invisible to naive `uses:` scans, and a PR
// sink is often declared only as a prompt obligation ("open exactly ONE pull
// request") with no `gh pr create` anywhere in the file.

import { parse } from 'yaml';
import { parseWorkflow } from './parse';
import type {
  ActionUse,
  AiFacts,
  Archetype,
  DashType,
  GuardKind,
  SinkKind,
  WorkflowFacts,
} from './types';

// ── small helpers ─────────────────────────────────────────────────────────────

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Parse the whole document defensively; null when the YAML does not parse. */
function parseDoc(yamlText: string): Dict | null {
  try {
    const parsed = parse(yamlText) as unknown;
    return isDict(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Unique first-capture-group values of a global regex, in scan order. */
function uniqueCaptures(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// ── dash type (cost-grouping) classifier ──────────────────────────────────────

// Ordered rules, matched against "<name> <path>" lowercased; the FIRST rule with any
// substring hit wins. Purpose-specific types precede the generic "ci".
const DASH_RULES: readonly (readonly [DashType, readonly string[]])[] = [
  ['dependencies', ['dependabot', 'dependency', 'renovate', 'update-deps', 'bump ', 'deps']],
  ['security', ['codeql', 'security', 'secret', 'scan', 'trivy', 'snyk', 'sast', 'audit']],
  [
    'ai',
    ['evolve', 'evolution', 'claude', 'agent', 'autopilot', 'quest', 'content-factory',
     'content-review', 'content-quality', 'content-auto', 'cms-', 'theme-scout', 'ai-',
     'llm', 'vally', 'skill-eval'],
  ],
  [
    'release',
    ['release', 'publish', 'semantic', 'changelog', 'adopt-release', 'version',
     'release-please', ' tag'],
  ],
  [
    'deploy',
    ['deploy', 'gh-pages', 'pages', 'vercel', 'netlify', 'build-dash', 'chat-proxy',
     'cd-', 'cd.'],
  ],
  [
    'docs',
    ['docs', 'mkdocs', 'jekyll', 'link-check', 'linkcheck', 'frontmatter',
     'sync-gh-pages', 'convert-notebook'],
  ],
  [
    'automation',
    ['auto-merge', 'automerge', 'issue', 'pr-auto', 'sync', 'dispatcher', 'cleanup',
     'stale', 'milestone', 'contributor', 'maintenance', 'refresh', 'drift',
     'standardize', 'submodule', 'giscus', 'triage', 'dispatch', 'self-repair',
     'new-feature'],
  ],
  [
    'ci',
    ['ci', 'test', 'lint', 'build', 'check', 'validate', 'quality', 'coverage',
     'actionlint', 'shellcheck', 'matrix', 'harness', 'install'],
  ],
];

/**
 * Exact port of the dash's ordered-substring workflow-type classifier: the first
 * rule with any keyword contained in `"<name> <path>".toLowerCase()` wins;
 * anything unmatched is 'other'. PURE.
 */
export function classifyDashType(name: string, path: string): DashType {
  const hay = `${name} ${path}`.toLowerCase();
  for (const [type, keys] of DASH_RULES) {
    if (keys.some((k) => hay.includes(k))) return type;
  }
  return 'other';
}

// ── uses: references ──────────────────────────────────────────────────────────

// Matches `uses:` at step level (`- uses: x`) and job level (reusable-workflow
// calls). Comment lines never match: `#` is not whitespace.
const USES_RE = /^\s*(?:-\s+)?uses:\s*['"]?([^\s'"#]+)/gm;

// A reusable-workflow call: owner/repo/.github/workflows/<file>[@ref].
const REUSABLE_RE = /^[\w.-]+\/[\w.-]+\/\.github\/workflows\/[^@\s]+/;

/** Classify how one `uses:` reference is pinned. */
function actionUseOf(uses: string): ActionUse {
  if (uses.startsWith('./')) return { action: uses, ref: null, pin: 'local' };
  const at = uses.indexOf('@');
  if (at === -1) return { action: uses, ref: null, pin: 'unpinned' };
  const action = uses.slice(0, at);
  const ref = uses.slice(at + 1);
  if (/^[0-9a-f]{40}$/.test(ref)) return { action, ref, pin: 'sha' };
  if (/^v?\d/.test(ref)) return { action, ref, pin: 'tag' };
  return { action, ref, pin: 'branch' };
}

// ── archetype classifier ──────────────────────────────────────────────────────

/** The pre-archetype subset of WorkflowFacts that classifyArchetype reads. */
export type ArchetypeSignals = Pick<
  WorkflowFacts,
  | 'path'
  | 'name'
  | 'triggers'
  | 'crons'
  | 'isReusable'
  | 'reusableCalls'
  | 'jobCount'
  | 'hasMatrix'
  | 'sinks'
  | 'crossRepoTargets'
  | 'ai'
  | 'guards'
  | 'generated'
>;

/**
 * First-match archetype classification, ground-truthed against the real fleet.
 * Name-flavored checks run against `"<name> <path>"` (not the raw text) because
 * real workflows *mention* their siblings constantly — zer0's auto-merge denylists
 * `release-please-config.json`, the UI audit describes the issue autopilot — and a
 * raw-text match on those words would misfile them. Raw text is only consulted for
 * signals that genuinely live in the body (the @claude mention, seeded-kit script
 * names, dispatch plans). PURE.
 */
export function classifyArchetype(f: ArchetypeSignals, rawText: string): Archetype {
  const hay = `${f.name} ${f.path}`.toLowerCase();
  const kinds = f.triggers.map((t) => t.kind);
  const has = (k: string): boolean => kinds.includes(k);
  const sink = (s: SinkKind): boolean => f.sinks.includes(s);

  if (f.generated !== null) return 'generated-line';
  if (/markdown-oneline|unwrap-prose/.test(rawText) || /markdown-oneline|unwrap-prose/.test(hay)) {
    return 'prose-kit';
  }
  if (has('issue_comment') && rawText.includes('@claude')) return 'mention-handler';
  if (
    !f.isReusable &&
    f.reusableCalls.length > 0 &&
    f.jobCount <= 2 &&
    f.reusableCalls.some((c) => /ci[^/]*\.ya?ml/i.test(c.split('/').pop() ?? ''))
  ) {
    return 'standard-ci-caller';
  }
  if (f.isReusable) return 'reusable-library';
  if (
    /release-please/.test(hay) ||
    /release\.ya?ml$/.test(f.path.toLowerCase()) ||
    f.reusableCalls.some((c) => /release|publish/i.test(c))
  ) {
    return 'release';
  }
  if (/codeql|secret-scan|evidence-gate|lint-workflows|trivy|snyk/.test(hay)) {
    return 'security-gate';
  }
  if (
    /dependabot|renovate|update-dep|fetch-metadata/.test(hay) ||
    rawText.includes('dependabot/fetch-metadata')
  ) {
    return 'dependency-bot';
  }
  if (
    /self-repair|auto-fix/.test(hay) ||
    (has('workflow_run') && (sink('commit') || f.ai.present) && f.guards.includes('attempt-limit'))
  ) {
    return 'self-repair';
  }
  if (sink('merge') && !f.ai.present) return 'auto-merge-bot';
  if (
    /autopilot/.test(hay) ||
    (f.crons.length > 0 && f.ai.present && sink('issue') && f.hasMatrix)
  ) {
    return 'issue-autopilot';
  }
  if (
    /ai-usage|actions-usage|usage[- ]refresh/.test(hay) ||
    (f.crons.length > 0 && (sink('commit') || sink('pr')) && !f.ai.present && /artifacts?/i.test(rawText))
  ) {
    return 'ledger';
  }
  if (
    /fromJSON\([^)]*plan/i.test(rawText) ||
    rawText.includes('dispatch.rb') ||
    (/dispatch/.test(hay) && kinds.length > 0 && kinds.every((k) => k === 'workflow_dispatch'))
  ) {
    return 'dispatch-hub';
  }
  if (f.crossRepoTargets.length > 0) return 'cross-repo-filer';
  if (/scout|explore/.test(hay)) return 'scout';
  if (/loop-tuner|agent-review|devops-audit|actions-review|loop_metrics|improvements\.ya?ml/.test(hay)) {
    return 'meta-loop';
  }
  if (f.crons.length > 0 && f.ai.present && sink('pr')) return 'content-factory';
  if (f.crons.length > 0 && sink('issue')) return 'nightly-audit';
  if (sink('deploy') || /wrangler|docker[^\n]*push|deploy/.test(hay)) return 'deploy';
  if (!f.ai.present && /create-pull-request|sync|convert/.test(hay)) return 'data-sync';
  if (
    has('push') &&
    has('pull_request') &&
    !sink('pr') &&
    !sink('issue') &&
    !sink('merge') &&
    !sink('deploy')
  ) {
    return 'ci-gate';
  }
  return 'other';
}

// ── extraction ────────────────────────────────────────────────────────────────

/**
 * Dormant automation: a commented-OUT `schedule:` list item — `# - cron: '…'` (the
 * disable-a-cron idiom seen across the fleet). Requires the comment to be a commented
 * YAML mapping entry (`#` then optional `- ` then `cron:` immediately followed by a
 * quoted value), so prose like `# runs on a cron: nightly` is not misread as a schedule.
 */
function dormantCronsOf(yamlText: string, activeCrons: string[]): string[] {
  const out: string[] = [];
  for (const line of yamlText.split('\n')) {
    const m = /^\s*#\s*-?\s*cron:\s*['"]([0-9*][^'"]*)['"]/.exec(line);
    if (m && !activeCrons.includes(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** AI invocation shapes, models, agents, turn caps, and the auth convention. */
function aiFactsOf(yamlText: string): AiFacts {
  const runners: AiFacts['runners'] = [];
  if (/anthropics\/claude-code-action/.test(yamlText)) runners.push('claude-code-action');
  if (/\bclaude\s+-p\b/.test(yamlText)) runners.push('claude-cli');
  if (/\.github\/actions\/claude-run/.test(yamlText)) runners.push('claude-run');
  if (/scripts\/ai\/run\.sh/.test(yamlText)) runners.push('run-sh');

  const models = [
    ...uniqueCaptures(yamlText, /--model[= ]([\w.-]+)/g),
    ...uniqueCaptures(yamlText, /(?<![_-])\bmodel:\s*['"]?([\w.-]+)/g),
  ].filter((m, i, all) => m !== 'model_hint' && all.indexOf(m) === i);

  const turns = uniqueCaptures(yamlText, /--max-turns[= ](\d+)/g).map(Number);

  const agents = [
    ...uniqueCaptures(yamlText, /\bagent:\s*['"]?([A-Za-z0-9_-]+)/g),
    ...uniqueCaptures(yamlText, /--agent[= ]([A-Za-z0-9_-]+)/g),
  ].filter((a, i, all) => all.indexOf(a) === i);

  const hasOauth = /CLAUDE_CODE_OAUTH_TOKEN/.test(yamlText);
  const hasKey = /ANTHROPIC_API_KEY/.test(yamlText);
  const authMode: AiFacts['authMode'] =
    hasOauth && hasKey ? 'oauth-first' : hasOauth ? 'oauth-only' : hasKey ? 'api-key-only' : 'none';

  return {
    present: runners.length > 0,
    runners,
    models,
    maxTurns: turns.length > 0 ? Math.max(...turns) : null,
    authMode,
    agents,
  };
}

/** Loop-safety / governance guard mechanisms, in GuardKind declaration order. */
function guardsOf(yamlText: string): GuardKind[] {
  const guards: GuardKind[] = [];
  if (/MAX_ATTEMPTS|auto-fix-attempt|attempt.?count/i.test(yamlText)) guards.push('attempt-limit');
  if (/if:[^\n]*label/i.test(yamlText)) guards.push('label-opt-in');
  if (/author_association|user\.login\s*==|sender\.type|user\.type/.test(yamlText)) {
    guards.push('actor-guard');
  }
  if (/gh run list[^\n]*--created/.test(yamlText) || /name:[^\n]*rate.?limit/i.test(yamlText)) {
    guards.push('rate-limiter');
  }
  if (/event\.action\s*[!=]=\s*'synchronize'/.test(yamlText)) guards.push('synchronize-skip');
  if (/classify_changes\.(rb|py)/.test(yamlText)) guards.push('smuggle-guard');
  if (/<!--\s*[\w-]+\s*-->/.test(yamlText)) guards.push('sticky-marker');
  if (/head_repository\.full_name\s*==|head\.repo\.full_name\s*==/.test(yamlText)) {
    guards.push('same-repo-only');
  }
  if (/contains\([^)]*@claude/.test(yamlText)) guards.push('mention-phrase');
  return guards;
}

// A pure token fallback chain: `${{ secrets.A || secrets.B || github.token }}` and
// nothing else in the expression — comparisons/ternaries (the OAuth-vs-key auth
// expression, `secrets.X != ''` probes) deliberately do not qualify.
const TOKEN_CHAIN_RE =
  /\$\{\{\s*((?:secrets\.[A-Za-z0-9_]+|github\.token)(?:\s*\|\|\s*(?:secrets\.[A-Za-z0-9_]+|github\.token))+)\s*\}\}/g;

/** Longest token fallback chain in the file, in privilege order. */
function tokenChainOf(yamlText: string): string[] {
  let longest: string[] = [];
  for (const m of yamlText.matchAll(TOKEN_CHAIN_RE)) {
    const names: string[] = [];
    for (const part of m[1].split('||')) {
      const name = part.trim();
      const entry = name === 'github.token' ? 'github.token' : name.replace(/^secrets\./, '');
      if (!names.includes(entry)) names.push(entry);
    }
    if (names.length > longest.length) longest = names;
  }
  return longest;
}

const KILL_SWITCH_SUFFIXES = ['_ENABLED', '_AUTOMERGE', '_SUBSTANTIVE'];

/**
 * Extract the full {@link WorkflowFacts} for one workflow file. PURE and total:
 * never throws — unparseable YAML degrades to raw-text signals (jobCount 0, raw
 * fallbacks for matrix/timeout/concurrency), exactly like parseWorkflow.
 */
export function extractFacts(path: string, yamlText: string): WorkflowFacts {
  const base = parseWorkflow(path, yamlText);
  const doc = parseDoc(yamlText);

  // triggers & scheduling — crons/isReusable ride parseWorkflow's trigger summaries.
  const crons: string[] = [];
  for (const t of base.triggers) {
    if (t.kind === 'schedule' && t.detail !== undefined) crons.push(t.detail);
  }
  const isReusable = base.triggers.some((t) => t.kind === 'workflow_call');
  const dormantCrons = dormantCronsOf(yamlText, crons);

  // uses: references (deduped, in file order).
  const usesRefs = uniqueCaptures(yamlText, USES_RE);
  const reusableCalls = usesRefs.filter((u) => REUSABLE_RE.test(u));
  const compositeLocals = usesRefs.filter((u) => u.startsWith('./.github/actions/'));
  const actions = usesRefs.map(actionUseOf);

  // structure — jobs tree, defensively.
  const jobsVal = doc?.jobs;
  const jobs = isDict(jobsVal) ? jobsVal : null;
  const jobCount = jobs ? Object.keys(jobs).length : 0;

  let hasMatrix = false;
  const timeouts: number[] = [];
  const runners: string[] = [];
  if (jobs) {
    for (const j of Object.values(jobs)) {
      if (!isDict(j)) continue;
      const strategy = j.strategy;
      if (isDict(strategy) && strategy.matrix !== undefined) hasMatrix = true;
      const timeout = j['timeout-minutes'];
      if (typeof timeout === 'number') timeouts.push(timeout);
      const runsOn = j['runs-on'];
      if (typeof runsOn === 'string' && !runners.includes(runsOn)) runners.push(runsOn);
      else if (Array.isArray(runsOn)) {
        for (const r of runsOn) {
          if (typeof r === 'string' && !runners.includes(r)) runners.push(r);
        }
      }
    }
  }
  if (!hasMatrix && doc === null && /\bmatrix:/.test(yamlText)) hasMatrix = true;
  if (timeouts.length === 0) {
    for (const m of yamlText.matchAll(/timeout-minutes:\s*(\d+)/g)) timeouts.push(Number(m[1]));
  }
  const timeoutMinutes = timeouts.length > 0 ? Math.max(...timeouts) : null;

  // concurrency.
  let concurrency: WorkflowFacts['concurrency'] = {
    present: false,
    group: null,
    cancelInProgress: 'unset',
  };
  const cVal = doc?.concurrency;
  if (cVal !== undefined) {
    let group: string | null = null;
    let cip: unknown;
    if (typeof cVal === 'string') group = cVal;
    else if (isDict(cVal)) {
      if (typeof cVal.group === 'string') group = cVal.group;
      cip = cVal['cancel-in-progress'];
    }
    concurrency = {
      present: true,
      group,
      cancelInProgress:
        cip === true ? 'always' : cip === false ? 'never' : typeof cip === 'string' ? 'conditional' : 'unset',
    };
  } else if (doc === null && /^concurrency:/m.test(yamlText)) {
    concurrency = {
      present: true,
      group: null,
      cancelInProgress: /cancel-in-progress:\s*true\b/.test(yamlText)
        ? 'always'
        : /cancel-in-progress:\s*false\b/.test(yamlText)
          ? 'never'
          : /cancel-in-progress:\s*\$\{\{/.test(yamlText)
            ? 'conditional'
            : 'unset',
    };
  }

  // permissions.
  const topPerms = doc?.permissions;
  let declared = topPerms !== undefined;
  if (!declared && jobs) {
    for (const j of Object.values(jobs)) {
      if (isDict(j) && j.permissions !== undefined) declared = true;
    }
  }
  if (!declared && doc === null && /^\s*permissions:/m.test(yamlText)) declared = true;
  const topLevelRead =
    topPerms === 'read-all' ||
    (isDict(topPerms) && Object.keys(topPerms).length === 1 && topPerms.contents === 'read');
  const topLevelWrite =
    topPerms === 'write-all' || (isDict(topPerms) && Object.values(topPerms).includes('write'));
  const writeScopes = uniqueCaptures(yamlText, /^\s*([a-z-]+):\s*write\s*$/gm);

  // governance.
  const varsUsed = uniqueCaptures(yamlText, /vars\.([A-Za-z0-9_]+)/g);
  const killSwitches = uniqueCaptures(yamlText, /vars\.([A-Z][A-Z0-9_]*)/g).filter((v) =>
    KILL_SWITCH_SUFFIXES.some((s) => v.endsWith(s)),
  );
  const secretsUsed = uniqueCaptures(yamlText, /secrets\.([A-Za-z0-9_]+)/g).filter(
    (s) => s !== 'GITHUB_TOKEN',
  );
  const guards = guardsOf(yamlText);
  const tokenChain = tokenChainOf(yamlText);

  // plan/apply dispatch duality.
  let planApply = false;
  const onVal = doc ? (doc.on ?? doc['true']) : undefined;
  if (isDict(onVal)) {
    const wd = onVal.workflow_dispatch;
    if (isDict(wd)) {
      const inputs = wd.inputs;
      if (isDict(inputs)) planApply = 'apply' in inputs || 'dry_run' in inputs;
    }
  }
  if (!planApply && doc === null) {
    planApply = /\b(apply|dry_run):\s*\n\s+(description|type|default)/.test(yamlText);
  }

  // outputs — parseWorkflow's sinks, plus the merge verb and the agent-obligation PR.
  const sinks: SinkKind[] = [...base.sinks];
  if (!sinks.includes('merge') && /gh pr merge|enablePullRequestAutoMerge/.test(yamlText)) {
    sinks.push('merge');
  }
  if (
    !sinks.includes('pr') &&
    /open\s+(exactly\s+)?one\s+(pull\s+request|pr\b)|peter-evans\/create-pull-request/i.test(yamlText)
  ) {
    sinks.push('pr');
  }

  // provenance.
  let generated: WorkflowFacts['generated'] = null;
  if (/GENERATED BY GITFACTORY/.test(yamlText)) {
    const bp = /blueprint:\s*(\S+)/.exec(yamlText);
    const hash = /hash:\s*([0-9a-f]+)/.exec(yamlText);
    generated = { blueprintPath: bp ? bp[1] : null, hash: hash ? hash[1] : null };
  }
  const manualEditMarkers = yamlText.match(/MANUAL EDIT/g)?.length ?? 0;

  const ai = aiFactsOf(yamlText);
  const signals: ArchetypeSignals = {
    path,
    name: base.name,
    triggers: base.triggers,
    crons,
    isReusable,
    reusableCalls,
    jobCount,
    hasMatrix,
    sinks,
    crossRepoTargets: base.crossRepoTargets,
    ai,
    guards,
    generated,
  };

  return {
    path,
    name: base.name,
    dashType: classifyDashType(base.name, path),
    archetype: classifyArchetype(signals, yamlText),
    triggers: base.triggers,
    crons,
    dormantCrons,
    isReusable,
    reusableCalls,
    jobCount,
    hasMatrix,
    timeoutMinutes,
    runners,
    concurrency,
    permissions: { declared, topLevelRead, topLevelWrite, writeScopes },
    actions,
    compositeLocals,
    ai,
    killSwitches,
    planApply,
    guards,
    tokenChain,
    secretsUsed,
    varsUsed,
    sinks,
    crossRepoTargets: base.crossRepoTargets,
    generated,
    manualEditMarkers,
  };
}
