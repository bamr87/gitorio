// Implements: docs/spec/06-upkeep.md §3.3 (applying a plan: order, dependencies, idempotency,
// and the honest classification of every outcome).
//
// `apply` is the only code in src/upkeep that changes anything, and everything it changes is
// FORGE-SIDE: a tag ref created through the API, a release, a label, a description, topics. It
// never writes the working tree, never commits, never pushes a branch — so it has no path to
// `.program/` (INV-001) and no path to the ledger ref (INV-002) by construction, not by care.
//
// Re-running is safe: every action re-checks against the `current` state the plan observed, and
// the forge's own "already exists" (422) is read as `unchanged`, not as failure. Two runs racing
// cannot double-create a tag or a release; the loser sees 422.

import { errorMessage, errorStatus, type RepoHostPort } from './host.js';
import { resolveContent } from './content.js';
import {
  type ActionKind,
  type ActionOutcome,
  type ContentRequest,
  TOPICS_MAX,
  type UpkeepAction,
  type UpkeepPlan,
} from './types.js';

/** Tags before the releases that name them; releases before metadata that might cite them. */
const ORDER: readonly ActionKind[] = ['tag.create', 'release.create', 'release.update', 'repo.update', 'repo.topics', 'label.upsert'];

export const ADMIN_REMEDY =
  'Repository description, homepage and topics need a token with administration:write on the repository ' +
  '(GITHUB_TOKEN in Actions cannot be granted it). Set the UPKEEP_TOKEN secret to a fine-grained token ' +
  'with "Administration: write", or apply these by hand.';

function contentFor(plan: UpkeepPlan, a: UpkeepAction): ContentRequest | undefined {
  return a.content === undefined ? undefined : plan.content.find((c) => c.id === a.content);
}

/** The concrete body a release action would send: the summary (when any) above the changelog. */
export function releaseBody(plan: UpkeepPlan, a: Extract<UpkeepAction, { kind: 'release.create' | 'release.update' }>): string {
  const c = contentFor(plan, a);
  const summary = c === undefined ? '' : String(resolveContent(c).value ?? '').trim();
  return summary === '' ? a.changelog : `${summary}\n\n${a.changelog}`;
}

/** The topic list a topics action would send. */
export function resolvedTopics(plan: UpkeepPlan, a: Extract<UpkeepAction, { kind: 'repo.topics' }>): readonly string[] {
  const c = contentFor(plan, a);
  const extra = c === undefined ? [] : ((resolveContent(c).value ?? []) as readonly string[]);
  const out = [...a.names];
  for (const t of extra) {
    if (out.length >= TOPICS_MAX) break;
    if (!out.includes(t)) out.push(t);
  }
  return out.sort();
}

/** The description a repo.update would send, or undefined when it would not set one. */
export function resolvedDescription(plan: UpkeepPlan, a: Extract<UpkeepAction, { kind: 'repo.update' }>): string | undefined {
  const c = contentFor(plan, a);
  const v = c !== undefined ? resolveContent(c).value : a.description;
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/** One line of what an action does — shared by dry runs and the report. */
export function describeAction(plan: UpkeepPlan, a: UpkeepAction): string {
  switch (a.kind) {
    case 'tag.create':
      return `create tag ${a.tag} at ${a.sha.slice(0, 7)}`;
    case 'release.create':
      return `create release ${a.tag}${a.make_latest ? ' (latest)' : ''}${a.prerelease ? ' (prerelease)' : ''}`;
    case 'release.update':
      return `write notes for release ${a.tag}`;
    case 'repo.update': {
      const parts: string[] = [];
      const d = resolvedDescription(plan, a);
      if (d !== undefined) parts.push(`description → ${JSON.stringify(d)}`);
      if (a.homepage !== undefined) parts.push(`homepage → ${a.homepage === '' ? '(cleared)' : a.homepage}`);
      return parts.length === 0 ? 'update repository metadata (nothing to set)' : `set ${parts.join('; ')}`;
    }
    case 'repo.topics':
      return `set topics → ${resolvedTopics(plan, a).join(', ') || '(none)'}`;
    case 'label.upsert':
      return `${a.exists ? 'update' : 'create'} label ${JSON.stringify(a.name)} (#${a.color})`;
  }
}

function classify(a: UpkeepAction, e: unknown): Omit<ActionOutcome, 'action' | 'kind'> {
  const status = errorStatus(e);
  const msg = errorMessage(e);
  if (status === 422 && /already[_ ]exists/i.test(msg)) {
    return { status: 'unchanged', detail: 'already exists on the forge' };
  }
  if (status === 401 || status === 403 || status === 404) {
    const admin = a.kind === 'repo.update' || a.kind === 'repo.topics';
    return {
      status: 'blocked',
      detail: `${status}: ${admin ? ADMIN_REMEDY : 'the token cannot perform this (needs contents:write for tags/releases, issues:write for labels)'}`,
    };
  }
  return { status: 'failed', detail: msg };
}

async function run(plan: UpkeepPlan, host: RepoHostPort, a: UpkeepAction): Promise<Omit<ActionOutcome, 'action' | 'kind'>> {
  switch (a.kind) {
    case 'tag.create':
      await host.createTag(a.tag, a.sha);
      return { status: 'applied', detail: describeAction(plan, a) };
    case 'release.create': {
      const url = await host.createRelease({
        tag: a.tag,
        name: a.name,
        body: releaseBody(plan, a),
        prerelease: a.prerelease,
        make_latest: a.make_latest,
      });
      return { status: 'applied', detail: `${describeAction(plan, a)}${url !== '' ? ` — ${url}` : ''}` };
    }
    case 'release.update':
      await host.updateReleaseBody(a.release_id, releaseBody(plan, a));
      return { status: 'applied', detail: describeAction(plan, a) };
    case 'repo.update': {
      const fields: { description?: string; homepage?: string } = {};
      const d = resolvedDescription(plan, a);
      if (d !== undefined && d !== (a.current.description ?? '')) fields.description = d;
      if (a.homepage !== undefined && a.homepage !== (a.current.homepage ?? '')) fields.homepage = a.homepage;
      if (Object.keys(fields).length === 0) return { status: 'unchanged', detail: 'already matches' };
      await host.updateMetadata(fields);
      return { status: 'applied', detail: describeAction(plan, a) };
    }
    case 'repo.topics': {
      const names = resolvedTopics(plan, a);
      const cur = new Set(a.current);
      if (names.length === a.current.length && names.every((n) => cur.has(n))) {
        return { status: 'unchanged', detail: 'topics already match' };
      }
      await host.replaceTopics(names);
      return { status: 'applied', detail: describeAction(plan, a) };
    }
    case 'label.upsert': {
      const spec = { name: a.name, color: a.color, description: a.description };
      if (a.exists) await host.updateLabel(spec);
      else await host.createLabel(spec);
      return { status: 'applied', detail: describeAction(plan, a) };
    }
  }
}

export interface ApplyOptions {
  /** Report what would happen; call nothing. */
  readonly dryRun: boolean;
}

export async function applyPlan(
  plan: UpkeepPlan,
  host: RepoHostPort | null,
  opts: ApplyOptions,
): Promise<readonly ActionOutcome[]> {
  const ordered = [...plan.actions].sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));
  const outcomes = new Map<string, ActionOutcome>();

  for (const a of ordered) {
    const done = (o: Omit<ActionOutcome, 'action' | 'kind'>): void => {
      outcomes.set(a.id, { action: a.id, kind: a.kind, ...o });
    };
    if (opts.dryRun) {
      done({ status: 'planned', detail: describeAction(plan, a) });
      continue;
    }
    if (host === null) {
      done({ status: 'skipped', detail: 'no forge configured' });
      continue;
    }
    const blockedBy = (a.depends_on ?? []).find((d) => {
      const s = outcomes.get(d)?.status;
      return s !== 'applied' && s !== 'unchanged';
    });
    if (blockedBy !== undefined) {
      done({ status: 'skipped', detail: `depends on ${blockedBy}, which did not apply` });
      continue;
    }
    try {
      done(await run(plan, host, a));
    } catch (e) {
      done(classify(a, e));
    }
  }

  // Report in plan order, which is the order the findings cite.
  return plan.actions.map((a) => outcomes.get(a.id) as ActionOutcome);
}

/** Exit status for an apply: 0 when nothing failed or was blocked. */
export function applyExitCode(outcomes: readonly ActionOutcome[]): number {
  return outcomes.some((o) => o.status === 'failed' || o.status === 'blocked') ? 1 : 0;
}
