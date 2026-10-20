// Implements: docs/spec/06-upkeep.md §2 (desired state per facet, derived from the config, the
// tree and its history) and §3 (the plan: findings, actions, content requests). PURE: the same
// facts, config and clock produce the same plan, byte for byte.
//
// CONVERGENCE IS THE CONTRACT. Run the plan, apply it, plan again: the second plan must be
// empty of remote actions. Three rules keep it so, and each one is a place a naive steward
// would oscillate:
//
//   1. AI-authored fields fill only what is EMPTY (a missing description, a missing release
//      body, a topic set below its minimum). A model asked every week to "improve" the
//      description would rewrite it every week.
//   2. Remote state is only ever ADDED to or SET — never pruned (src/upkeep/host.ts). Topics in
//      `merge` mode keep every topic a human added; labels are never deleted.
//   3. Whatever cannot be done by an API call is an IN-TREE finding with a remedy, not an
//      action. A version bump, a stale README line, a missing LICENSE: those are commits, and
//      commits arrive through reviewed PRs (spec 06 §5).

import { plainText } from './facts.js';
import { INSTRUCTIONS } from './prompts.js';
import { compareSemVer, formatSemVer, parseSemVer, semverTags, suggestBump } from './semver.js';
import {
  type ContentKind,
  type ContentRequest,
  DESCRIPTION_MAX,
  type Finding,
  type HostFacts,
  type LabelSpec,
  type LocalFacts,
  type ObservedSnapshot,
  type TagHistory,
  TOPIC_PATTERN,
  TOPICS_MAX,
  UPKEEP_SCHEMA_VERSION,
  type UpkeepAction,
  type UpkeepConfig,
  type UpkeepPlan,
} from './types.js';


export interface PlanInput {
  readonly config: UpkeepConfig;
  readonly local: LocalFacts;
  /** `null` = no forge reachable; remote facets are reported unobserved. */
  readonly host: HostFacts | null;
  readonly hostError?: string;
  /** Labels the engine's own adapters apply when they file issues (spec 02 §5). */
  readonly codeLabels: readonly LabelSpec[];
  readonly repository: string | null;
  readonly now: Date;
}

/** GitHub-shaped description: plain text, one line, ≤ 350 characters, cut at a word. */
export function normalizeDescription(raw: string): string {
  const text = plainText(raw);
  if (text.length <= DESCRIPTION_MAX) return text;
  const cut = text.slice(0, DESCRIPTION_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > DESCRIPTION_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/** A keyword as a topic, or `null` when nothing valid survives. */
export function normalizeTopic(raw: string): string | null {
  const t = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  return TOPIC_PATTERN.test(t) ? t : null;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** The deterministic changelog every release body ends with. Identity-free by construction. */
export function renderChangelog(h: TagHistory): string {
  const lines: string[] = [];
  const shipped = h.commits.filter((c) => !/^Merge (pull request|branch|remote-tracking)/.test(c.subject));
  lines.push(
    h.previous === null
      ? `### Changes (first tagged release — ${shipped.length} commit${shipped.length === 1 ? '' : 's'})`
      : `### Changes since ${h.previous}`,
  );
  lines.push('');
  const shown = shipped.slice(0, 100);
  for (const c of shown) lines.push(`- ${c.subject} (${c.sha.slice(0, 7)})`);
  if (shipped.length > shown.length) lines.push(`- …and ${shipped.length - shown.length} more`);
  if (shipped.length === 0) lines.push('- No non-merge commits in this range.');
  return lines.join('\n');
}

export function planUpkeep(input: PlanInput): UpkeepPlan {
  const { config, local, host } = input;
  const findings: Finding[] = [];
  const actions: UpkeepAction[] = [];
  const content: ContentRequest[] = [];

  let nextAction = 1;
  let nextContent = 1;
  const actionId = (): string => `A${nextAction++}`;
  const request = (
    kind: ContentKind,
    context: Readonly<Record<string, unknown>>,
    fallback: unknown,
  ): string => {
    const id = `C${nextContent++}`;
    content.push({ id, kind, brief: { instructions: INSTRUCTIONS[kind], context }, status: 'requested', fallback });
    return id;
  };

  const repoContext = {
    repository: input.repository,
    package: local.package,
    readme_tagline: local.readme?.tagline ?? null,
    tree: local.tree,
  };

  // ---------------------------------------------------------------------
  // Host reachability — unobserved is not clean
  // ---------------------------------------------------------------------
  if (host === null) {
    findings.push({
      id: 'host.unobserved',
      facet: 'metadata',
      severity: 'warn',
      where: 'remote',
      summary: `No forge observed${input.hostError !== undefined ? ` (${input.hostError})` : ''}; description, topics, releases and labels were not checked.`,
      actions: [],
      remedy: 'Run with `gh` authenticated or GITHUB_TOKEN set, and a resolvable owner/name (--repo, `repository:` in the config, or an origin remote).',
    });
  }

  // ---------------------------------------------------------------------
  // metadata: description, homepage, topics, license file
  // ---------------------------------------------------------------------
  const meta = config.metadata;
  let desiredDescription: string | null = null;
  if (host !== null && meta.description !== undefined) {
    const src = meta.description;
    const deterministic =
      src.from === 'literal'
        ? src.value
        : src.from === 'package.json'
          ? local.package?.description ?? null
          : src.from === 'readme'
            ? local.readme?.tagline ?? null
            : null;
    const current = host.description ?? '';
    const update: { description?: string | null; homepage?: string; content?: string } = {};
    // Findings resolved by the one repo.update action; their `actions` are set once its id exists.
    const pending: Omit<Finding, 'actions'>[] = [];

    if (src.from === 'ai') {
      if (current.trim() === '') {
        const fallback = local.readme?.tagline ?? local.package?.description ?? null;
        update.content = request(
          'description',
          { ...repoContext, current: host.description },
          fallback === null ? null : normalizeDescription(fallback),
        );
        update.description = fallback === null ? null : normalizeDescription(fallback);
        pending.push({
          id: 'metadata.description',
          facet: 'metadata',
          severity: 'warn',
          where: 'remote',
          summary: 'The repository has no description; one will be written from the README and package metadata.',
          actual: '(none)',
        });
      }
      desiredDescription = host.description;
    } else if (deterministic === null) {
      findings.push({
        id: 'metadata.description-source',
        facet: 'metadata',
        severity: 'warn',
        where: 'in-tree',
        summary: `The configured description source (${src.from}) yields nothing.`,
        actions: [],
        remedy: src.from === 'readme' ? 'Give the README a first paragraph under its title.' : 'Add a `description` to package.json.',
      });
    } else {
      desiredDescription = normalizeDescription(deterministic);
      if (desiredDescription !== current.trim()) {
        update.description = desiredDescription;
        pending.push({
          id: 'metadata.description',
          facet: 'metadata',
          severity: 'warn',
          where: 'remote',
          summary: `The repository description has drifted from its source (${src.from}).`,
          expected: desiredDescription,
          actual: host.description ?? '(none)',
        });
      }
    }

    if (meta.homepage !== undefined && meta.homepage !== (host.homepage ?? '')) {
      update.homepage = meta.homepage;
      pending.push({
        id: 'metadata.homepage',
        facet: 'metadata',
        severity: 'info',
        where: 'remote',
        summary: 'The repository homepage differs from the configured one.',
        expected: meta.homepage === '' ? '(none)' : meta.homepage,
        actual: host.homepage ?? '(none)',
      });
    }

    if ('description' in update || 'homepage' in update) {
      const id = actionId();
      actions.push({
        id,
        kind: 'repo.update',
        ...update,
        current: { description: host.description, homepage: host.homepage },
      });
      for (const f of pending) findings.push({ ...f, actions: [id] });
    }
  } else if (host !== null && meta.homepage !== undefined && meta.homepage !== (host.homepage ?? '')) {
    const id = actionId();
    actions.push({ id, kind: 'repo.update', homepage: meta.homepage, current: { description: host.description, homepage: host.homepage } });
    findings.push({
      id: 'metadata.homepage',
      facet: 'metadata',
      severity: 'info',
      where: 'remote',
      summary: 'The repository homepage differs from the configured one.',
      expected: meta.homepage === '' ? '(none)' : meta.homepage,
      actual: host.homepage ?? '(none)',
      actions: [id],
    });
  }

  if (host !== null && meta.topics !== undefined) {
    const t = meta.topics;
    const desired = new Set<string>();
    for (const x of t.include) desired.add(x);
    if (t.from_package_keywords) {
      for (const k of local.package?.keywords ?? []) {
        const n = normalizeTopic(k);
        if (n !== null) desired.add(n);
      }
    }
    const target = t.mode === 'exact' ? [...desired] : [...new Set([...host.topics, ...desired])];
    const names = target.slice(0, TOPICS_MAX).sort();
    const needsAi = t.min > 0 && names.length < t.min;
    if (!sameSet(names, host.topics) || needsAi) {
      const id = actionId();
      const contentId = needsAi
        ? request(
            'topics',
            {
              ...repoContext,
              description: desiredDescription ?? host.description,
              current: names,
              need: Math.min(t.min, TOPICS_MAX) - names.length,
            },
            [],
          )
        : undefined;
      actions.push({ id, kind: 'repo.topics', names, current: [...host.topics], ...(contentId !== undefined ? { content: contentId } : {}) });
      const added = names.filter((n) => !host.topics.includes(n));
      const removed = host.topics.filter((n) => !names.includes(n));
      findings.push({
        id: 'metadata.topics',
        facet: 'metadata',
        severity: host.topics.length === 0 ? 'warn' : 'info',
        where: 'remote',
        summary:
          added.length + removed.length > 0
            ? `Topics drifted: ${added.length} to add${removed.length > 0 ? `, ${removed.length} to remove (exact mode)` : ''}.`
            : `Only ${names.length} topic${names.length === 1 ? '' : 's'}; the config asks for at least ${t.min}.`,
        expected: names.join(', ') || '(none)',
        actual: host.topics.join(', ') || '(none)',
        actions: [id],
      });
    }
  }

  if (
    meta.license_file === true &&
    local.package?.license != null &&
    local.package.license !== 'UNLICENSED' &&
    local.license_file === null
  ) {
    findings.push({
      id: 'metadata.license-file',
      facet: 'metadata',
      severity: 'warn',
      where: 'in-tree',
      summary: `package.json declares the ${local.package.license} license but the tree has no LICENSE file, so GitHub detects no license.`,
      expected: `LICENSE (${local.package.license})`,
      actual: '(none)',
      actions: [],
      remedy: `Add a LICENSE file with the ${local.package.license} text at the repository root.`,
    });
  }

  // ---------------------------------------------------------------------
  // versioning: source of truth, consistency, tag, unreleased work
  // ---------------------------------------------------------------------
  const tagActionFor = new Map<string, string>();
  const v = config.versioning;
  if (v !== undefined && local.version !== null) {
    const src = local.version.source;
    const tags = semverTags(local.tags.map((t) => t.name), v.tag_prefix);
    const latest = tags.at(-1) ?? null;
    const sv = src.value === null ? null : parseSemVer(src.value);

    if (src.value === null) {
      findings.push({
        id: 'versioning.source',
        facet: 'versioning',
        severity: 'error',
        where: 'in-tree',
        summary: `Cannot read a version from ${src.path} with the configured pattern.`,
        actions: [],
        remedy: `Fix versioning.files[0] in the upkeep config, or the version field in ${src.path}.`,
      });
    } else if (sv === null) {
      findings.push({
        id: 'versioning.source',
        facet: 'versioning',
        severity: 'error',
        where: 'in-tree',
        summary: `${src.path} holds ${JSON.stringify(src.value)}, which is not a semantic version.`,
        ...(src.line !== null ? { citation: { path: src.path, line: src.line } } : {}),
        actions: [],
        remedy: 'Use MAJOR.MINOR.PATCH.',
      });
    }

    for (const o of local.version.others) {
      if (src.value !== null && o.value !== src.value) {
        findings.push({
          id: `versioning.consistency:${o.path}`,
          facet: 'versioning',
          severity: 'warn',
          where: 'in-tree',
          summary: `${o.path} says ${o.value === null ? '(no match)' : o.value}; the source of truth (${src.path}) says ${src.value}.`,
          expected: src.value,
          actual: o.value ?? '(no match)',
          ...(o.line !== null ? { citation: { path: o.path, line: o.line } } : {}),
          actions: [],
          remedy: `Set the version in ${o.path} to ${src.value}.`,
        });
      }
    }

    if (sv !== null && src.value !== null) {
      const tagName = `${v.tag_prefix}${src.value}`;
      const exists = local.tags.some((t) => t.name === tagName);
      if (!exists && latest !== null && compareSemVer(sv, latest.version) <= 0) {
        findings.push({
          id: 'versioning.behind',
          facet: 'versioning',
          severity: 'error',
          where: 'in-tree',
          summary: `${src.path} says ${src.value}, which is not newer than the latest tag ${latest.tag}.`,
          expected: `> ${formatSemVer(latest.version)}`,
          actual: src.value,
          ...(src.line !== null ? { citation: { path: src.path, line: src.line } } : {}),
          actions: [],
          remedy: `Bump ${src.path} past ${formatSemVer(latest.version)}.`,
        });
      } else if (!exists) {
        const sha = local.version.introduced_at ?? local.head;
        const id = actionId();
        tagActionFor.set(tagName, id);
        actions.push({ id, kind: 'tag.create', tag: tagName, sha });
        findings.push({
          id: 'versioning.untagged',
          facet: 'versioning',
          severity: 'warn',
          where: 'remote',
          summary: `Version ${src.value} has no ${tagName} tag; it will be tagged at the commit where it was introduced (${sha.slice(0, 7)}).`,
          expected: tagName,
          actual: latest === null ? '(no semver tags)' : `latest is ${latest.tag}`,
          actions: [id],
        });
      }

      const shipped = local.unreleased.filter((c) => !/^Merge /.test(c.subject));
      if (shipped.length > 0) {
        const s = suggestBump(sv, shipped);
        findings.push({
          id: 'versioning.unreleased',
          facet: 'versioning',
          severity: 'info',
          where: 'in-tree',
          summary: `${shipped.length} commit${shipped.length === 1 ? '' : 's'} since ${tagName}${exists ? '' : ' (once tagged)'} are unreleased${s !== null ? `; suggested next version ${formatSemVer(s.next)} (${s.bump})` : ''}.`,
          ...(s !== null ? { expected: formatSemVer(s.next), actual: src.value } : {}),
          ...(src.line !== null ? { citation: { path: src.path, line: src.line } } : {}),
          actions: [],
          remedy:
            s !== null
              ? `Bump every versioning file to ${formatSemVer(s.next)} in a PR (because: ${s.because.map((b) => JSON.stringify(b)).join('; ')}). The next upkeep run tags and releases it.`
              : 'Bump the version in a PR when these changes should ship.',
        });
      }
    }
  }

  // ---------------------------------------------------------------------
  // releases: every recent semver tag has a release with a body
  // ---------------------------------------------------------------------
  const rel = config.releases;
  if (host !== null && rel !== undefined && local.history.length > 0) {
    const byTag = new Map(host.releases.map((r) => [r.tag, r]));
    const last = local.history.at(-1)!;
    for (const h of local.history) {
      const existing = byTag.get(h.tag);
      const changelog = renderChangelog(h);
      const prerelease = parseSemVer(h.tag.replace(/^[^0-9]*/, ''))?.prerelease != null;
      const notesContent = (): string | undefined =>
        rel.notes === 'ai'
          ? request(
              'release-notes',
              {
                repository: input.repository,
                tag: h.tag,
                previous: h.previous,
                commits: h.commits.map((c) => c.subject),
                areas: h.areas,
                package: local.package,
              },
              '',
            )
          : undefined;
      const dependsOn = tagActionFor.get(h.tag);

      if (existing === undefined) {
        if (h.pending && dependsOn === undefined) continue; // the tag itself is not being created
        const id = actionId();
        const c = notesContent();
        actions.push({
          id,
          kind: 'release.create',
          tag: h.tag,
          name: h.tag,
          changelog,
          prerelease,
          make_latest: h === last && !prerelease,
          ...(dependsOn !== undefined ? { depends_on: [dependsOn] } : {}),
          ...(c !== undefined ? { content: c } : {}),
        });
        findings.push({
          id: `releases.missing:${h.tag}`,
          facet: 'releases',
          severity: 'warn',
          where: 'remote',
          summary: `Tag ${h.tag}${h.pending ? ' (being created)' : ''} has no GitHub release; ${h.commits.length} commit${h.commits.length === 1 ? '' : 's'} would ship in it.`,
          actions: [id],
        });
      } else if (existing.body_empty && !existing.draft) {
        const id = actionId();
        const c = notesContent();
        actions.push({
          id,
          kind: 'release.update',
          release_id: existing.id,
          tag: h.tag,
          changelog,
          ...(c !== undefined ? { content: c } : {}),
        });
        findings.push({
          id: `releases.empty:${h.tag}`,
          facet: 'releases',
          severity: 'info',
          where: 'remote',
          summary: `The ${h.tag} release has no notes.`,
          actions: [id],
        });
      }
    }
  }

  // ---------------------------------------------------------------------
  // labels: what the engine files with, plus what the config declares
  // ---------------------------------------------------------------------
  const lab = config.labels;
  if (host !== null && lab !== undefined) {
    const desired = new Map<string, { spec: LabelSpec; declared: boolean }>();
    if (lab.from_code) for (const l of input.codeLabels) desired.set(l.name.toLowerCase(), { spec: l, declared: false });
    for (const l of lab.declared) desired.set(l.name.toLowerCase(), { spec: l, declared: true });
    const hostByName = new Map(host.labels.map((l) => [l.name.toLowerCase(), l]));
    for (const [key, { spec, declared }] of desired) {
      const have = hostByName.get(key);
      if (have === undefined) {
        const id = actionId();
        actions.push({ id, kind: 'label.upsert', name: spec.name, color: spec.color, description: spec.description, exists: false });
        findings.push({
          id: `labels.missing:${spec.name}`,
          facet: 'labels',
          severity: 'warn',
          where: 'remote',
          summary: `Label ${JSON.stringify(spec.name)} does not exist${declared ? '' : ', but the engine files issues with it'}.`,
          actions: [id],
        });
      } else if (
        declared &&
        (have.color.toLowerCase() !== spec.color.toLowerCase() || (have.description ?? '') !== spec.description)
      ) {
        const id = actionId();
        actions.push({ id, kind: 'label.upsert', name: have.name, color: spec.color, description: spec.description, exists: true });
        findings.push({
          id: `labels.drift:${spec.name}`,
          facet: 'labels',
          severity: 'info',
          where: 'remote',
          summary: `Label ${JSON.stringify(spec.name)} differs from its declaration.`,
          expected: `#${spec.color} ${spec.description}`,
          actual: `#${have.color} ${have.description ?? ''}`,
          actions: [id],
        });
      }
    }
  }

  // ---------------------------------------------------------------------
  // references: every extracted item is mentioned where the config says
  // ---------------------------------------------------------------------
  for (const r of local.references) {
    if (!r.doc_exists) {
      findings.push({
        id: `references.${r.id}`,
        facet: 'references',
        severity: 'warn',
        where: 'in-tree',
        summary: `${r.doc} does not exist, so it cannot mention the ${r.items.length} item(s) rule ${r.id} extracts.`,
        actions: [],
        remedy: `Create ${r.doc}, or fix rule ${r.id}.`,
      });
    } else if (r.missing.length > 0) {
      const mentions = r.missing.map((i) => r.mention.replaceAll('{item}', i));
      findings.push({
        id: `references.${r.id}`,
        facet: 'references',
        severity: 'warn',
        where: 'in-tree',
        summary: `${r.doc} does not mention ${r.missing.length} of ${r.items.length} item(s) (${r.id}): ${mentions.map((m) => `\`${m}\``).join(', ')}.`,
        expected: mentions.join(', '),
        actions: [],
        remedy: `Document ${mentions.join(', ')} in ${r.doc}.`,
      });
    }
  }

  // ---------------------------------------------------------------------
  // docs: an AI review for statements the facts now contradict
  // ---------------------------------------------------------------------
  if (config.docs_review !== undefined && local.docs.length > 0) {
    request(
      'docs-review',
      {
        files: local.docs.map((d) => ({ path: d.path, truncated: d.truncated, lines: d.lines.map((l, i) => `${i + 1}: ${l}`) })),
        facts: {
          repository: input.repository,
          version: local.version?.source.value ?? null,
          tags: local.tags.map((t) => t.name),
          unreleased_commits: local.unreleased.length,
          tree: local.tree,
          references: Object.fromEntries(local.references.map((r) => [r.id, r.items])),
        },
      },
      [],
    );
  }

  const observed: ObservedSnapshot = {
    head: local.head,
    branch: local.branch,
    version: local.version?.source.value ?? null,
    latest_tag: v === undefined ? null : semverTags(local.tags.map((t) => t.name), v.tag_prefix).at(-1)?.tag ?? null,
    tags: local.tags.map((t) => t.name).sort(),
    unreleased_commits: local.unreleased.length,
    host:
      host === null
        ? null
        : {
            host: host.host,
            description: host.description,
            homepage: host.homepage,
            topics: [...host.topics],
            releases: host.releases.length,
            labels: host.labels.length,
          },
    ...(host === null && input.hostError !== undefined ? { host_error: input.hostError } : {}),
  };

  return {
    schema_version: UPKEEP_SCHEMA_VERSION,
    generated_at: input.now.toISOString(),
    repository: input.repository,
    mode: config.mode,
    observed,
    findings,
    actions,
    content,
  };
}
