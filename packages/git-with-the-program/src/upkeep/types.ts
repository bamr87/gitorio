// Implements: docs/spec/06-upkeep.md §2 (the facets), §3 (the plan document) and §4 (content
// requests), against schemas/upkeep-config.schema.json and schemas/upkeep-plan.schema.json.
// The VOCABULARY of repository upkeep, and nothing else: no I/O, no forge, no model.
//
// The types mirror the serialized documents field-for-field (snake_case and all), because the
// plan is an INTERCHANGE document: the deterministic engine writes it, an AI agent fills its
// content slots, and `gwtp upkeep apply` reads it back. A camelCase twin would be one more
// mapping that could drift from the schema an agent is told to satisfy.
//
// THIRD STORE, THIRD POLITICS, again (spec 05 §0's table, extended in spec 06 §1): the upkeep
// plan is DERIVED like the nexus, but its subject is the repository's forge-side presentation
// (description, topics, tags, releases, labels) rather than its code. It is never normative:
// nothing here may write `.program/` (INV-001), and an action that would change in-tree bytes
// is not an action at all — it is an in-tree FINDING, handed to a human or an agent's PR.

export const UPKEEP_SCHEMA_VERSION = '0.1.0';

export const UPKEEP_CONFIG_SCHEMA_ID = 'gwtp/upkeep-config.schema.json';
export const UPKEEP_PLAN_SCHEMA_ID = 'gwtp/upkeep-plan.schema.json';

/** GitHub's own limits, restated so validation fails here rather than as a 422 at apply time. */
export const DESCRIPTION_MAX = 350;
export const TOPICS_MAX = 20;
export const TOPIC_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;
export const RELEASE_NOTES_MAX = 20_000;
export const LABEL_COLOR_PATTERN = /^[0-9a-fA-F]{6}$/;

// ---------------------------------------------------------------------------
// Config (.github/upkeep.yaml)
// ---------------------------------------------------------------------------

export type UpkeepMode = 'propose' | 'apply';

export type DescriptionSource =
  | { readonly from: 'literal'; readonly value: string }
  | { readonly from: 'package.json' }
  | { readonly from: 'readme' }
  | { readonly from: 'ai' };

export interface TopicsConfig {
  readonly include: readonly string[];
  readonly from_package_keywords: boolean;
  /** `merge` never removes a topic a human added; `exact` makes the config the whole truth. */
  readonly mode: 'merge' | 'exact';
  /** Below this many topics, an AI suggestion is requested to top the set up. 0 disables. */
  readonly min: number;
}

export interface MetadataConfig {
  readonly description?: DescriptionSource;
  /** A literal URL, `""` to clear, or absent to leave the homepage unmanaged. */
  readonly homepage?: string;
  readonly topics?: TopicsConfig;
  /** When package.json declares a license, require a LICENSE file in the tree. */
  readonly license_file?: boolean;
}

export interface VersionFile {
  readonly path: string;
  /** A regular expression with exactly one capture group: the version string. */
  readonly pattern: string;
}

export interface VersioningConfig {
  readonly tag_prefix: string;
  /** The FIRST entry is the source of truth; every other entry must agree with it. */
  readonly files: readonly VersionFile[];
  /** How many commits touching the source file to walk when locating where a version began. */
  readonly history_depth: number;
}

export interface ReleasesConfig {
  /** Ensure a release exists for this many of the most recent semver tags. */
  readonly backfill: number;
  readonly notes: 'ai' | 'template';
}

export interface LabelSpec {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

export interface LabelsConfig {
  readonly declared: readonly LabelSpec[];
  /** Also require every label the engine's own adapters file issues with. */
  readonly from_code: boolean;
}

/**
 * Where a reference rule's items come from. Exactly one of the two shapes:
 * a glob over tracked paths (with an optional capture group naming the item), or a regex
 * over one file's text (multiline, every match's first group is an item).
 */
export type ReferenceItems =
  | { readonly glob: string; readonly capture?: string }
  | { readonly file: string; readonly pattern: string };

export interface ReferenceRule {
  readonly id: string;
  /** The document that must mention every item. */
  readonly doc: string;
  readonly items: ReferenceItems;
  /** Template; `{item}` is replaced. Matched case-insensitively. */
  readonly mention: string;
}

export interface DocsReviewConfig {
  readonly files: readonly string[];
}

export interface AiConfig {
  readonly model?: string;
  /** Per-file cap on how much text a brief may carry. */
  readonly max_chars_per_file: number;
}

export interface UpkeepConfig {
  readonly schema_version: string;
  readonly repository?: string;
  readonly mode: UpkeepMode;
  readonly ai: AiConfig;
  readonly metadata: MetadataConfig;
  readonly versioning?: VersioningConfig;
  readonly releases?: ReleasesConfig;
  readonly labels?: LabelsConfig;
  readonly references: readonly ReferenceRule[];
  readonly docs_review?: DocsReviewConfig;
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

export interface CommitSummary {
  readonly sha: string;
  readonly subject: string;
  /** Whether the body declares `BREAKING CHANGE:` — the only body fact upkeep keeps. */
  readonly breaking: boolean;
}

export interface TagFact {
  readonly name: string;
  /** The peeled commit sha (annotated tags are dereferenced). */
  readonly sha: string;
}

export interface VersionFileFact {
  readonly path: string;
  readonly value: string | null;
  /** 1-based line of the match, for the citation. */
  readonly line: number | null;
}

/** A release-in-waiting: the tag, its commit, and the commits it would ship. */
export interface TagHistory {
  readonly tag: string;
  readonly sha: string;
  readonly previous: string | null;
  /** True when the tag does not exist yet — it is the version source's tag, to be created. */
  readonly pending: boolean;
  readonly commits: readonly CommitSummary[];
  /** Changed-path counts per top-level directory, for the release-notes brief. */
  readonly areas: Readonly<Record<string, number>>;
}

export interface ReferenceFact {
  readonly id: string;
  readonly doc: string;
  readonly doc_exists: boolean;
  readonly items: readonly string[];
  readonly mention: string;
  /** Items whose mention the doc does not contain. Computed by the gatherer (it holds the text). */
  readonly missing: readonly string[];
}

export interface DocFile {
  readonly path: string;
  readonly lines: readonly string[];
  readonly truncated: boolean;
}

/** Everything the tree and its history say. Identity-free: no author or committer field. */
export interface LocalFacts {
  readonly head: string;
  readonly branch: string | null;
  readonly package: {
    readonly name: string | null;
    readonly description: string | null;
    readonly keywords: readonly string[];
    readonly license: string | null;
  } | null;
  readonly readme: { readonly path: string; readonly tagline: string | null } | null;
  readonly license_file: string | null;
  readonly version: {
    readonly source: VersionFileFact;
    readonly others: readonly VersionFileFact[];
    /** Oldest commit of the contiguous run (back from HEAD) in which the source held this value. */
    readonly introduced_at: string | null;
  } | null;
  readonly tags: readonly TagFact[];
  /** Commits after the version's tag (or its introduction, when untagged). */
  readonly unreleased: readonly CommitSummary[];
  readonly history: readonly TagHistory[];
  readonly references: readonly ReferenceFact[];
  readonly docs: readonly DocFile[];
  /** Tracked paths per top-level directory — context for briefs, not a finding source. */
  readonly tree: Readonly<Record<string, number>>;
}

export interface HostRelease {
  readonly id: number;
  readonly tag: string;
  readonly name: string | null;
  readonly body_empty: boolean;
  readonly draft: boolean;
  readonly prerelease: boolean;
}

export interface HostLabel {
  readonly name: string;
  readonly color: string;
  readonly description: string | null;
}

/** What the forge says. Forge-neutral in shape; src/adapters/github fills it. */
export interface HostFacts {
  readonly host: string;
  readonly description: string | null;
  readonly homepage: string | null;
  readonly topics: readonly string[];
  readonly default_branch: string | null;
  readonly license: string | null;
  readonly releases: readonly HostRelease[];
  readonly labels: readonly HostLabel[];
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export type Facet = 'metadata' | 'versioning' | 'releases' | 'labels' | 'references' | 'docs';

export const FACETS: readonly Facet[] = [
  'metadata',
  'versioning',
  'releases',
  'labels',
  'references',
  'docs',
];

export type Severity = 'info' | 'warn' | 'error';

export interface Citation {
  readonly path: string;
  readonly line: number;
}

/**
 * One observed divergence. `where: remote` findings are resolved by the listed actions;
 * `where: in-tree` findings carry a `remedy` and are never resolved by `apply` — they are work
 * for a PR (spec 06 §5), because a machine committing to the tree on a schedule is exactly the
 * unreviewed write path this repository exists to forbid.
 */
export interface Finding {
  readonly id: string;
  readonly facet: Facet;
  readonly severity: Severity;
  readonly where: 'remote' | 'in-tree';
  readonly summary: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly citation?: Citation;
  readonly actions: readonly string[];
  readonly remedy?: string;
}

interface ActionBase {
  readonly id: string;
  readonly depends_on?: readonly string[];
  /** A content request whose value completes this action (spec 06 §4). */
  readonly content?: string;
}

export interface RepoUpdateAction extends ActionBase {
  readonly kind: 'repo.update';
  readonly description?: string | null;
  readonly homepage?: string;
  readonly current: { readonly description: string | null; readonly homepage: string | null };
}

export interface RepoTopicsAction extends ActionBase {
  readonly kind: 'repo.topics';
  readonly names: readonly string[];
  readonly current: readonly string[];
}

export interface LabelUpsertAction extends ActionBase {
  readonly kind: 'label.upsert';
  readonly name: string;
  readonly color: string;
  readonly description: string;
  readonly exists: boolean;
}

export interface TagCreateAction extends ActionBase {
  readonly kind: 'tag.create';
  readonly tag: string;
  readonly sha: string;
}

export interface ReleaseCreateAction extends ActionBase {
  readonly kind: 'release.create';
  readonly tag: string;
  readonly name: string;
  /** The deterministic changelog; an AI summary, when filled, is placed above it. */
  readonly changelog: string;
  readonly prerelease: boolean;
  readonly make_latest: boolean;
}

export interface ReleaseUpdateAction extends ActionBase {
  readonly kind: 'release.update';
  readonly release_id: number;
  readonly tag: string;
  readonly changelog: string;
}

export type UpkeepAction =
  | RepoUpdateAction
  | RepoTopicsAction
  | LabelUpsertAction
  | TagCreateAction
  | ReleaseCreateAction
  | ReleaseUpdateAction;

export type ActionKind = UpkeepAction['kind'];

export type ContentKind = 'description' | 'topics' | 'release-notes' | 'docs-review';

export type ContentStatus = 'requested' | 'filled' | 'fallback' | 'rejected';

/**
 * A slot only an author can fill. The engine states WHAT is needed and WHY (the brief), and
 * always ships a deterministic `fallback`, so an unfilled or rejected slot degrades the run
 * rather than stopping it. Whoever fills it — the model provider, or an agent editing the plan
 * file — sets `status: filled`, `value`, and `provider`; `gwtp upkeep check` and `apply` then
 * re-validate the value against the kind's contract (spec 06 §4.2) before anything uses it.
 */
export interface ContentRequest {
  readonly id: string;
  readonly kind: ContentKind;
  readonly brief: {
    readonly instructions: string;
    readonly context: Readonly<Record<string, unknown>>;
  };
  readonly status: ContentStatus;
  readonly value?: unknown;
  readonly fallback: unknown;
  readonly provider?: string;
  readonly note?: string;
}

export interface ObservedSnapshot {
  readonly head: string;
  readonly branch: string | null;
  readonly version: string | null;
  readonly latest_tag: string | null;
  readonly tags: readonly string[];
  readonly unreleased_commits: number;
  /** `null` when no forge was reachable: remote facets are UNOBSERVED, not clean. */
  readonly host: {
    readonly host: string;
    readonly description: string | null;
    readonly homepage: string | null;
    readonly topics: readonly string[];
    readonly releases: number;
    readonly labels: number;
  } | null;
  readonly host_error?: string;
}

export interface UpkeepPlan {
  readonly schema_version: string;
  readonly generated_at: string;
  readonly repository: string | null;
  readonly mode: UpkeepMode;
  readonly observed: ObservedSnapshot;
  readonly findings: readonly Finding[];
  readonly actions: readonly UpkeepAction[];
  readonly content: readonly ContentRequest[];
}

// ---------------------------------------------------------------------------
// Apply outcomes
// ---------------------------------------------------------------------------

/**
 * `blocked` is distinct from `failed` on purpose: a 403 on `PATCH /repos` means the token lacks
 * admin scope — a configuration fact with a known remedy — while a 500 is the forge's problem.
 */
export type OutcomeStatus = 'applied' | 'unchanged' | 'skipped' | 'blocked' | 'failed' | 'planned';

export interface ActionOutcome {
  readonly action: string;
  readonly kind: ActionKind;
  readonly status: OutcomeStatus;
  readonly detail: string;
}
