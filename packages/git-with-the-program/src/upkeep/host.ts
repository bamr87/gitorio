// Implements: docs/spec/06-upkeep.md §1.2 (forge-neutral port; GitHub lives in adapters/) —
// INV-005's posture carried into upkeep even though src/upkeep is outside INV-005's literal
// scope (`src/core/**`): the engine names CAPABILITIES (a description, topics, a release), and
// src/adapters/github/repo-host.ts maps them onto REST routes.
//
// No forge at all is a first-class outcome: `RepoHostPort | null`. With `null`, remote facets
// are reported UNOBSERVED (not clean — that distinction is the whole point of the
// `observed.host === null` field) and only in-tree findings are produced. "A bare git repo
// degrades gracefully to commits-only" (docs/vision.md).

import type { HostFacts, LabelSpec } from './types.js';

export interface CreateReleaseInput {
  readonly tag: string;
  readonly name: string;
  readonly body: string;
  readonly prerelease: boolean;
  readonly make_latest: boolean;
}

/**
 * Deliberately WITHOUT a delete method of any kind. Upkeep converges a repository toward its
 * config by ADDING (a missing tag, release, label, topic) and by SETTING (a description); it
 * never removes a label a human made or a release a human wrote. The narrowness is the same
 * argument `GitHubIssuesClient` makes (src/adapters/github/issues.ts): a port that can retract
 * is a port through which a bad plan does damage no review saw.
 */
export interface RepoHostPort {
  readonly host: string;
  read(): Promise<HostFacts>;
  updateMetadata(fields: { readonly description?: string; readonly homepage?: string }): Promise<void>;
  replaceTopics(names: readonly string[]): Promise<void>;
  createLabel(label: LabelSpec): Promise<void>;
  updateLabel(label: LabelSpec): Promise<void>;
  createTag(tag: string, sha: string): Promise<void>;
  createRelease(input: CreateReleaseInput): Promise<string>;
  updateReleaseBody(id: number, body: string): Promise<void>;
}

/** The HTTP-ish status an adapter error carries, if any — read structurally, never by class. */
export function errorStatus(e: unknown): number | null {
  if (typeof e === 'object' && e !== null && 'status' in e) {
    const s = (e as { status: unknown }).status;
    if (typeof s === 'number') return s;
  }
  return null;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
