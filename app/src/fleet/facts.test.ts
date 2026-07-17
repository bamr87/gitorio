import { describe, expect, it } from 'vitest';
import { classifyArchetype, classifyDashType, extractFacts } from './facts';
import type { ArchetypeSignals } from './facts';

// ── fixtures: verbatim real fleet workflows (see fixtures/README.md) ─────────
// The path passed to extractFacts is the file's real in-repo path — the repo
// prefix (zm--/lh--/ij--/cv--/hub--) exists only in the fixture filename.

import cvMarkdownOneline from './fixtures/cv--markdown-oneline.yml?raw';
import hubStandardCi from './fixtures/hub--standard-ci.yml?raw';
import ijContentFactory from './fixtures/ij--content-factory.yml?raw';
import ijDependabotAutoMerge from './fixtures/ij--dependabot-auto-merge.yml?raw';
import lhAiUsage from './fixtures/lh--ai-usage.yml?raw';
import lhAutoFix from './fixtures/lh--auto-fix.yml?raw';
import lhAutoMerge from './fixtures/lh--auto-merge.yml?raw';
import lhCi from './fixtures/lh--ci.yml?raw';
import lhContentFactory from './fixtures/lh--content-factory.yml?raw';
import lhIssueFactory from './fixtures/lh--factory--issue-factory-2.yml?raw';
import lhPipeline from './fixtures/lh--pipeline.yml?raw';
import lhThemeScout from './fixtures/lh--theme-scout.yml?raw';
import zmAutoMerge from './fixtures/zm--auto-merge.yml?raw';
import zmCi from './fixtures/zm--ci.yml?raw';
import zmCiSelfRepair from './fixtures/zm--ci-self-repair.yml?raw';
import zmClaude from './fixtures/zm--claude.yml?raw';
import zmIssueAutopilot from './fixtures/zm--issue-autopilot.yml?raw';
import zmRelease from './fixtures/zm--release.yml?raw';
import zmUiAudit from './fixtures/zm--ui-audit.yml?raw';

/** Extract with the fixture's real in-repo path (prefix stripped). */
function facts(file: string, text: string) {
  return extractFacts(`.github/workflows/${file}`, text);
}

// ── zer0-mistakes ─────────────────────────────────────────────────────────────

describe('extractFacts — zm ci.yml (tiered CI pipeline)', () => {
  const f = facts('ci.yml', zmCi);

  it('classifies as a ci-gate of dash type ci, with no AI', () => {
    expect(f.archetype).toBe('ci-gate');
    expect(f.dashType).toBe('ci');
    expect(f.ai.present).toBe(false);
  });

  it('reads structure: jobs, matrix, timeouts, composites, concurrency, permissions', () => {
    expect(f.jobCount).toBeGreaterThanOrEqual(5);
    expect(f.hasMatrix).toBe(true);
    expect(f.timeoutMinutes).toBe(30);
    expect(f.compositeLocals).toContain('./.github/actions/quality-checks');
    expect(f.concurrency.present).toBe(true);
    expect(f.concurrency.cancelInProgress).toBe('conditional');
    expect(f.permissions.declared).toBe(true);
    expect(f.permissions.topLevelRead).toBe(true);
  });
});

describe('extractFacts — zm claude.yml (@claude mention handler)', () => {
  const f = facts('claude.yml', zmClaude);

  it('classifies as the ai mention-handler', () => {
    expect(f.archetype).toBe('mention-handler');
    expect(f.dashType).toBe('ai');
    expect(f.guards).toContain('mention-phrase');
  });

  it('finds exactly the claude-code-action runner, wired oauth-first', () => {
    expect(f.ai.present).toBe(true);
    expect(f.ai.runners).toEqual(['claude-code-action']);
    expect(f.ai.authMode).toBe('oauth-first');
  });

  it('has no concurrency block', () => {
    expect(f.concurrency.present).toBe(false);
  });
});

describe('extractFacts — zm auto-merge.yml (label-gated native auto-merge)', () => {
  const f = facts('auto-merge.yml', zmAutoMerge);

  it('classifies as an auto-merge-bot despite mentioning release/evidence files', () => {
    expect(f.archetype).toBe('auto-merge-bot');
    expect(f.ai.present).toBe(false);
  });

  it('sees the merge sink, the pull_request_target trigger, and the label opt-in', () => {
    expect(f.sinks).toContain('merge');
    expect(f.triggers.map((t) => t.kind)).toContain('pull_request_target');
    expect(f.guards).toContain('label-opt-in');
  });
});

describe('extractFacts — zm issue-autopilot.yml', () => {
  const f = facts('issue-autopilot.yml', zmIssueAutopilot);

  it('classifies as the issue-autopilot with a serialized matrix', () => {
    expect(f.archetype).toBe('issue-autopilot');
    expect(f.hasMatrix).toBe(true);
  });

  it('collects all four lane kill switches', () => {
    expect(f.killSwitches).toContain('ISSUE_AUTOPILOT_ENABLED');
    expect(f.killSwitches).toContain('ISSUE_RESOLVE_ENABLED');
    expect(f.killSwitches.length).toBeGreaterThanOrEqual(4);
  });

  it('sees the claude-run composite (the naive-scan-invisible AI path)', () => {
    expect(f.ai.present).toBe(true);
    expect(f.ai.runners).toContain('claude-run');
  });
});

describe('extractFacts — zm ui-audit.yml (weekly sweep + agent review)', () => {
  const f = facts('ui-audit.yml', zmUiAudit);

  it('classifies as a nightly-audit with a sticky-marker issue upsert', () => {
    expect(f.archetype).toBe('nightly-audit');
    expect(f.guards).toContain('sticky-marker');
  });

  it('reads the claude CLI invocation: model, turn cap, api-key-only auth', () => {
    expect(f.ai.runners).toContain('claude-cli');
    expect(f.ai.models).toContain('claude-sonnet-4-6');
    expect(f.ai.maxTurns).toBe(40);
    expect(f.ai.authMode).toBe('api-key-only');
  });
});

describe('extractFacts — zm release.yml (release-please pipeline)', () => {
  const f = facts('release.yml', zmRelease);

  it('classifies as release with two branch-pinned reusable calls', () => {
    expect(f.archetype).toBe('release');
    expect(f.reusableCalls).toHaveLength(2);
    expect(f.reusableCalls).toContain('bamr87/.github/.github/workflows/release-please.yml@main');
    const calls = f.actions.filter((a) => a.action.includes('/.github/workflows/'));
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.pin).toBe('branch');
  });
});

describe('extractFacts — zm ci-self-repair.yml', () => {
  const f = facts('ci-self-repair.yml', zmCiSelfRepair);

  it('classifies as self-repair off a workflow_run trigger', () => {
    expect(f.archetype).toBe('self-repair');
    expect(f.triggers.map((t) => t.kind)).toContain('workflow_run');
  });

  it('sees the retry budget and the fork fence', () => {
    expect(f.guards).toContain('attempt-limit');
    expect(f.guards).toContain('same-repo-only');
  });

  it('runs the claude CLI on the API key only', () => {
    expect(f.ai.runners).toContain('claude-cli');
    expect(f.ai.authMode).toBe('api-key-only');
  });
});

// ── lifehacker.dev ────────────────────────────────────────────────────────────

describe('extractFacts — lh pipeline.yml (tiered gate with embedded agents)', () => {
  const f = facts('pipeline.yml', lhPipeline);

  it('stays a ci-gate even though agents ride inside it', () => {
    expect(f.archetype).toBe('ci-gate');
    expect(f.ai.present).toBe(true);
  });

  it('sees the loop-breaker, the token chain, and conditional cancellation', () => {
    expect(f.guards).toContain('synchronize-skip');
    expect(f.tokenChain).toContain('FLEET_TOKEN');
    expect(f.concurrency.cancelInProgress).toBe('conditional');
  });
});

describe('extractFacts — lh ci.yml (thin standard-ci caller)', () => {
  const f = facts('ci.yml', lhCi);

  it('classifies as a standard-ci-caller of the hub reusable workflow', () => {
    expect(f.archetype).toBe('standard-ci-caller');
    expect(f.reusableCalls[0]).toContain('bamr87/bamr87/.github/workflows/standard-ci.yml');
  });
});

describe('extractFacts — lh content-factory.yml', () => {
  const f = facts('content-factory.yml', lhContentFactory);

  it('classifies as a content-factory (cron + agent + PR obligation)', () => {
    expect(f.archetype).toBe('content-factory');
    expect(f.hasMatrix).toBe(true);
    // The PR sink is declared only as a prompt obligation — no `gh pr create`.
    expect(f.sinks).toContain('pr');
  });

  it('is gated by its kill switch and names its agent role', () => {
    expect(f.killSwitches).toContain('CONTENT_FACTORY_ENABLED');
    expect(f.ai.agents).toContain('grow-lifehacker');
  });
});

describe('extractFacts — lh auto-fix.yml', () => {
  const f = facts('auto-fix.yml', lhAutoFix);

  it('classifies as self-repair with an attempt budget and a kill switch', () => {
    expect(f.archetype).toBe('self-repair');
    expect(f.guards).toContain('attempt-limit');
    expect(f.killSwitches).toContain('AUTO_FIX_ENABLED');
  });

  it('detects the run.sh universal AI runner', () => {
    expect(f.ai.runners).toContain('run-sh');
  });
});

describe('extractFacts — lh theme-scout.yml (upstream filer)', () => {
  const f = facts('theme-scout.yml', lhThemeScout);

  it('classifies as a cross-repo-filer targeting the theme repo', () => {
    expect(f.archetype).toBe('cross-repo-filer');
    expect(f.crossRepoTargets).toContain('bamr87/zer0-mistakes');
  });

  it('is kill-switched and exposes the plan/apply dispatch duality', () => {
    expect(f.killSwitches).toContain('THEME_SCOUT_ENABLED');
    expect(f.planApply).toBe(true);
  });
});

describe('extractFacts — lh factory--issue-factory-2.yml (GitFactory output)', () => {
  const f = facts('factory--issue-factory-2.yml', lhIssueFactory);

  it('classifies as a generated-line with blueprint provenance', () => {
    expect(f.archetype).toBe('generated-line');
    expect(f.generated).not.toBeNull();
    expect(f.generated?.blueprintPath).toBe('.factory/issue-factory.blueprint.json');
  });

  it('reads the compiled agent step: runner, model, auth, guards, gate', () => {
    expect(f.ai.runners).toContain('claude-code-action');
    expect(f.ai.models).toContain('claude-opus-4-8');
    expect(f.ai.authMode).toBe('oauth-first');
    expect(f.guards).toContain('rate-limiter');
    expect(f.killSwitches).toContain('ISSUE_FACTORY_ENABLED');
  });
});

describe('extractFacts — lh ai-usage.yml (ledger with a disabled cron)', () => {
  const f = facts('ai-usage.yml', lhAiUsage);

  it('classifies as a ledger gated by its kill switch', () => {
    expect(f.archetype).toBe('ledger');
    expect(f.killSwitches).toContain('AI_USAGE_ENABLED');
  });

  it('surfaces the commented-out schedule as a dormant cron', () => {
    expect(f.crons).toEqual([]);
    expect(f.dormantCrons.length).toBeGreaterThan(0);
    expect(f.dormantCrons).toContain('17 8 * * *');
  });
});

describe('extractFacts — lh auto-merge.yml (smuggle-guarded sweep)', () => {
  const f = facts('auto-merge.yml', lhAutoMerge);

  it('classifies as an auto-merge-bot with the diff re-classification guard', () => {
    expect(f.archetype).toBe('auto-merge-bot');
    expect(f.sinks).toContain('merge');
    expect(f.guards).toContain('smuggle-guard');
    expect(f.killSwitches).toContain('AUTO_MERGE_ENABLED');
  });
});

// ── it-journey ────────────────────────────────────────────────────────────────

describe('extractFacts — ij content-factory.yml (sha-pinned)', () => {
  const f = facts('content-factory.yml', ijContentFactory);

  it('classifies as a content-factory with sha-pinned actions', () => {
    expect(f.archetype).toBe('content-factory');
    expect(f.killSwitches).toContain('CONTENT_FACTORY_ENABLED');
    expect(f.actions.some((a) => a.pin === 'sha')).toBe(true);
  });
});

describe('extractFacts — ij dependabot-auto-merge.yml', () => {
  const f = facts('dependabot-auto-merge.yml', ijDependabotAutoMerge);

  it('classifies as a dependency-bot guarded on the actor', () => {
    expect(f.archetype).toBe('dependency-bot');
    expect(f.guards).toContain('actor-guard');
    expect(f.sinks).toContain('merge');
  });

  it('extracts the elevated-token fallback chain', () => {
    expect(f.tokenChain.length).toBeGreaterThanOrEqual(2);
    expect(f.tokenChain).toContain('AUTO_PR_GITHUB_TOKEN');
  });
});

// ── cv-builder-pro + hub ──────────────────────────────────────────────────────

describe('extractFacts — cv markdown-oneline.yml (seeded prose kit)', () => {
  const f = facts('markdown-oneline.yml', cvMarkdownOneline);

  it('classifies as the seeded prose-kit with no AI', () => {
    expect(f.archetype).toBe('prose-kit');
    expect(f.ai.present).toBe(false);
    // The dash's exact classifier has no keyword matching "markdown-oneline",
    // so this one falls through to 'other' (not 'docs').
    expect(f.dashType).toBe('other');
  });
});

describe('extractFacts — hub standard-ci.yml (reusable library)', () => {
  const f = facts('standard-ci.yml', hubStandardCi);

  it('classifies as a reusable-library via workflow_call', () => {
    expect(f.isReusable).toBe(true);
    expect(f.archetype).toBe('reusable-library');
  });
});

// ── malformed / edge inputs ───────────────────────────────────────────────────

describe('extractFacts — robustness', () => {
  it('yields empty-but-total facts for an empty file', () => {
    const f = facts('empty.yml', '');
    expect(f.name).toBe('empty');
    expect(f.triggers).toEqual([]);
    expect(f.jobCount).toBe(0);
    expect(f.timeoutMinutes).toBeNull();
    expect(f.concurrency.present).toBe(false);
    expect(f.ai.present).toBe(false);
    expect(f.generated).toBeNull();
    expect(f.archetype).toBe('other');
  });

  it('still mines signals from unparseable YAML via raw-text fallbacks', () => {
    const broken = [
      'name: [broken',
      'uses: anthropics/claude-code-action@v1',
      'timeout-minutes: 45',
      'strategy:',
      '  matrix:',
      "if: ${{ vars.NIGHTLY_ENABLED == 'true' }}",
      'env:',
      '  KEY: ${{ secrets.ANTHROPIC_API_KEY }}',
      'run: gh pr merge --squash',
      '',
    ].join('\n');
    const f = facts('broken.yml', broken);
    expect(f.name).toBe('broken');
    expect(f.jobCount).toBe(0);
    expect(f.hasMatrix).toBe(true);
    expect(f.timeoutMinutes).toBe(45);
    expect(f.ai.runners).toContain('claude-code-action');
    expect(f.ai.authMode).toBe('api-key-only');
    expect(f.killSwitches).toEqual(['NIGHTLY_ENABLED']);
    expect(f.sinks).toContain('merge');
  });

  it('falls back to the filename when no name: is present', () => {
    const f = facts('no-name.yml', 'on: push\n');
    expect(f.name).toBe('no-name');
    expect(f.triggers).toEqual([{ kind: 'push' }]);
  });

  it('keeps active crons out of the dormant list', () => {
    const mixed = [
      'name: sweep',
      'on:',
      '  schedule:',
      "    - cron: '0 9 * * *'",
      '# retired schedule:',
      "#   - cron: '0 9 * * *' (mirror of the active one)",
      "#   - cron: '30 3 * * 0'",
      '',
    ].join('\n');
    const f = facts('sweep.yml', mixed);
    expect(f.crons).toEqual(['0 9 * * *']);
    expect(f.dormantCrons).toEqual(['30 3 * * 0']);
  });

  it('does not flag prose comments mentioning a cron as dormant schedules', () => {
    const prosey = [
      'name: docs',
      'on: [push]',
      "# This job used to run on a cron: '0 6 * * 1' but we moved it to push.",
      '#   see the cron: syntax docs for the schedule field',
      'jobs:',
      '  build: { runs-on: ubuntu-latest }',
      '',
    ].join('\n');
    const f = facts('docs.yml', prosey);
    // The cron token lives inside prose, not a commented-out `# - cron:` list item.
    expect(f.dormantCrons).toEqual([]);
  });

  it('flags a commented-out schedule item (with or without the list dash) as dormant', () => {
    const bare = ['on: [workflow_dispatch]', "  # cron: '0 4 * * *'", ''].join('\n');
    expect(facts('x.yml', bare).dormantCrons).toEqual(['0 4 * * *']);
  });
});

// ── classifyDashType (direct) ─────────────────────────────────────────────────

describe('classifyDashType — ordered substring rules', () => {
  it('earlier rules win: dependabot beats security, deploy beats docs', () => {
    expect(classifyDashType('Dependabot security scan', 'x.yml')).toBe('dependencies');
    expect(classifyDashType('Deploy docs', 'deploy-docs.yml')).toBe('deploy');
  });

  it('honors the trailing space in "bump " ahead of the release rule', () => {
    expect(classifyDashType('Version bump', 'x.yml')).toBe('dependencies');
  });

  it('falls back to other when nothing matches', () => {
    expect(classifyDashType('mystery', 'mystery.yml')).toBe('other');
  });
});

// ── classifyArchetype (direct) ────────────────────────────────────────────────

/** Minimal blank signal set for direct archetype tests. */
function signals(extra: Partial<ArchetypeSignals> = {}): ArchetypeSignals {
  return {
    path: '.github/workflows/x.yml',
    name: 'x',
    triggers: [],
    crons: [],
    isReusable: false,
    reusableCalls: [],
    jobCount: 1,
    hasMatrix: false,
    sinks: [],
    crossRepoTargets: [],
    ai: { present: false, runners: [], models: [], maxTurns: null, authMode: 'none', agents: [] },
    guards: [],
    generated: null,
    ...extra,
  };
}

describe('classifyArchetype — precedence', () => {
  it('the generated header outranks every other signal', () => {
    const s = signals({ generated: { blueprintPath: null, hash: null }, isReusable: true });
    expect(classifyArchetype(s, '')).toBe('generated-line');
  });

  it('workflow_call makes a reusable-library', () => {
    expect(classifyArchetype(signals({ isReusable: true }), '')).toBe('reusable-library');
  });

  it('nothing matched falls through to other', () => {
    expect(classifyArchetype(signals(), '')).toBe('other');
  });
});
