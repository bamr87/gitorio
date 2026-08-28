// Implements: docs/spec/05-nexus.md §2 (the graph: node and edge kinds, ids, spans) and §1
// (politics: identity-free by construction), against schemas/nexus.schema.json and ADR-0007.
//
// The vocabulary of the perception layer. Everything here is PLAIN DATA with a line-span
// address, so any node can ground an INV-004 citation, and NOTHING here has a slot an author,
// a committer, a timestamp or a meter reading could occupy. That absence is the design (spec
// 05 §1.1): the nexus feeds evidence assembly, and a perception layer must not be a side
// channel for what a judge may not see (ADR-0003). `__NEXUS_BLINDNESS_PROOFS` at the bottom
// makes the absence a COMPILE-TIME fact, exactly as src/core/evidence.ts does for bundles.
//
// Import discipline, load-bearing: this module value-imports NOTHING (its one value export is
// a pure function over its own types), and its type imports reach only core/brand, core/paths
// and core/blindness — none of which is the sentencing branch. src/nexus/** is intended to
// join INV-003's blind scope by amendment (proposals/PROPOSED-nexus-amendment.md); until
// ratification, tests/nexus/blindness.test.ts holds the same boundary.

import type { Brand } from '../core/brand.js';
import type { IsBlind, Proof } from '../core/blindness.js';
import type { RepoPath } from '../core/paths.js';

// ---------------------------------------------------------------------------
// Ids and spans
// ---------------------------------------------------------------------------

/** `dir:<path>` | `module:<path>` | `def:<path>#<name>@<start-line>` | `ext:<specifier>`. */
export type NexusNodeId = Brand<string, 'NexusNodeId'>;

/**
 * 1-based, inclusive, in the module's post-image — the exact currency of an INV-004 citation
 * (`path:start-end`), so anything the nexus locates, a verdict can cite.
 */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export function directoryId(path: RepoPath): NexusNodeId {
  return `dir:${path}` as NexusNodeId;
}

export function moduleId(path: RepoPath): NexusNodeId {
  return `module:${path}` as NexusNodeId;
}

export function definitionId(path: RepoPath, name: string, startLine: number): NexusNodeId {
  return `def:${path}#${name}@${startLine}` as NexusNodeId;
}

export function externalId(specifier: string): NexusNodeId {
  return `ext:${specifier}` as NexusNodeId;
}

// ---------------------------------------------------------------------------
// Nodes (spec 05 §2, schemas/nexus.schema.json#/properties/nodes)
// ---------------------------------------------------------------------------

/** Languages the v0 extractor parses (spec 05 §3 P2). Anything else degrades to structure. */
export type NexusLanguage = 'typescript' | 'javascript';

export type DefinitionForm =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type-alias'
  | 'enum'
  | 'const';

export interface DirectoryNode {
  readonly id: NexusNodeId;
  readonly kind: 'directory';
  readonly path: RepoPath;
}

export interface ModuleNode {
  readonly id: NexusNodeId;
  readonly kind: 'module';
  readonly path: RepoPath;
  /** `null` = no extractor parses this file; it still serves ring `file` (spec 05 §3 P1). */
  readonly language: NexusLanguage | null;
  readonly parsed: boolean;
  readonly lines: number;
}

export interface DefinitionNode {
  readonly id: NexusNodeId;
  readonly kind: 'definition';
  readonly path: RepoPath;
  readonly name: string;
  readonly form: DefinitionForm;
  readonly span: Span;
  readonly exported: boolean;
}

/** An import target outside the snapshot — or a relative specifier that resolved to nothing. */
export interface ExternalNode {
  readonly id: NexusNodeId;
  readonly kind: 'external';
  readonly specifier: string;
}

export type NexusNode = DirectoryNode | ModuleNode | DefinitionNode | ExternalNode;

// ---------------------------------------------------------------------------
// Edges (spec 05 §2, schemas/nexus.schema.json#/properties/edges)
// ---------------------------------------------------------------------------

/**
 * Deliberately the same four words as `ImportForm` in src/judge/deterministic/imports.ts —
 * the graph and the import-boundary judge describe the same fact in the same vocabulary
 * (spec 05 §2). Declared independently rather than imported so src/nexus never depends on a
 * blind directory.
 */
export type NexusImportForm = 'value' | 'type-only' | 'dynamic' | 're-export';

/** How a call target was PROVED (spec 05 §3 P4). Unprovable calls are counted, never emitted. */
export type CallResolution = 'same-file' | 'imported';

export interface ContainsEdge {
  readonly kind: 'contains';
  readonly from: NexusNodeId;
  readonly to: NexusNodeId;
}

export interface DefinesEdge {
  readonly kind: 'defines';
  readonly from: NexusNodeId;
  readonly to: NexusNodeId;
}

export interface ImportsEdge {
  readonly kind: 'imports';
  readonly from: NexusNodeId;
  readonly to: NexusNodeId;
  /** The specifier as written, verbatim. */
  readonly specifier: string;
  readonly form: NexusImportForm;
  /** 1-based line of the statement that names the specifier. */
  readonly at: number;
}

export interface CallsEdge {
  readonly kind: 'calls';
  readonly from: NexusNodeId;
  readonly to: NexusNodeId;
  readonly resolution: CallResolution;
  /** 1-based line of the call site. */
  readonly at: number;
}

export interface HeritageEdge {
  readonly kind: 'extends' | 'implements';
  readonly from: NexusNodeId;
  readonly to: NexusNodeId;
  readonly at: number;
}

export type NexusEdge = ContainsEdge | DefinesEdge | ImportsEdge | CallsEdge | HeritageEdge;

// ---------------------------------------------------------------------------
// The graph and its artifact header
// ---------------------------------------------------------------------------

/**
 * Extraction identity — versioned like a judge's `model + prompt-hash` (spec 05 §1.5). A
 * behavior change without a version bump is a defect; tests/nexus/build.test.ts pins a golden
 * fixture hash so the omission fails loudly.
 */
export interface NexusExtractor {
  readonly name: string;
  readonly version: string;
  readonly languages: readonly string[];
}

/** Recall, stated: what was proved is in the graph; what was not is counted here (spec 05 §2). */
export interface NexusStats {
  readonly files: number;
  readonly parsed: number;
  readonly definitions: number;
  readonly imports: {
    readonly internal: number;
    readonly external: number;
    readonly unresolved: number;
  };
  readonly calls: {
    readonly resolved: number;
    /** Candidate call sites scanned inside definition spans; `resolved <= sites`, always. */
    readonly sites: number;
  };
}

/**
 * One tree state, perceived. Nodes sort by id, edges by (kind, from, to, at): same snapshot +
 * same extractor version => this value is BYTE-IDENTICAL under canonical serialization, which
 * is what makes the artifact content-addressable (spec 05 §3, the fold-purity obligation
 * applied to perception).
 */
export interface NexusGraph {
  readonly extractor: NexusExtractor;
  readonly stats: NexusStats;
  readonly nodes: readonly NexusNode[];
  readonly edges: readonly NexusEdge[];
}

// ---------------------------------------------------------------------------
// INV-003, extended to perception (spec 05 §1.1) — as a build-time obligation
// ---------------------------------------------------------------------------

/**
 * Zero runtime cost. Adding an author field, a committer time, an accumulator value, a
 * forbidden field name, or a callable anywhere transitively inside these types turns
 * `IsBlind<T>` into `false`, which violates `Proof<T extends true>` and fails tsc — the same
 * mechanism src/core/evidence.ts applies to evidence bundles, applied to percepts.
 */
export type __NEXUS_BLINDNESS_PROOFS = readonly [
  Proof<IsBlind<Span>>,
  Proof<IsBlind<NexusNode>>,
  Proof<IsBlind<NexusEdge>>,
  Proof<IsBlind<NexusExtractor>>,
  Proof<IsBlind<NexusStats>>,
  Proof<IsBlind<NexusGraph>>,
];
