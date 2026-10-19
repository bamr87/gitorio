// Implements: docs/spec/04-distillation.md §2 (the deterministic fact base — the exhaustive,
// replayable record types), §5 (empirical precision seeding: the violation-free span), §7 (cost
// control) and §8 (the watermark: "manifest.yaml records the last SHA walked"). Also the
// type-level shadow of INV-001 (spec 01 §1): the fact base is EVIDENCE ABOUT the law, not the
// law, so it is written under `.gwtp/`, never `.program/`, and `assertNotProgramPath` refuses any
// output directory that resolves into the program store.
//
// PURE DATA + (DE)SERIALIZATION ONLY. No git, no walk logic — that is `src/distill/miner.ts`.
// The load-bearing structural choice lives here: the fact base is split into SYNTHESIZABLE facts
// (author-free; a pass-two model prompt may read them) and DISPERSION facts (author-bearing;
// INV-003 keeps them out of any model prompt). Neither partition is assignable to the other, and
// `AuthorHandle` is branded so an author name cannot be widened into a synthesizable string by
// accident.
//
// INV-005: imports src/core and node builtins only. Nothing provider-specific.

import {
  basename as pathBasename,
  dirname as pathDirname,
  join as pathJoin,
  resolve as pathResolve,
  sep as pathSep,
} from 'node:path';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';

import {
  canonicalize,
  contentHash,
  fail,
  ok,
  parsePathGlob,
  sha256RefFromHex,
  sha256RefHex,
  unwrap,
} from '../core/index.js';
import type {
  Brand,
  CanonicalObject,
  CanonicalValue,
  CommitSha,
  CommitterTime,
  ContractError,
  EpochId,
  Parsed,
  PathGlob,
  RepoPath,
  Sha256Ref,
} from '../core/index.js';

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  §7 — cost control (the walk cost-guard)
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * The pass-one-shaped analogue of the LLM cost guard (spec 04 §7). Pass one makes ZERO model
 * calls, so the thing that can run away is the exhaustive git walk itself; this bounds it.
 * Exceeding any cap stops-and-reports (`BudgetExceeded`), never silently spends.
 */
export interface WalkBudget {
  /** Hard cap on commits the walk will read before stopping and reporting. */
  readonly maxCommits: number;
  /** Hard cap on total blob bytes read for import/manifest/absence mining. */
  readonly maxBlobBytes: number;
  /** Hard cap on tree entries read across all boundary snapshots + name-status diffs. */
  readonly maxTreeEntries: number;
}

/**
 * The typed stop-and-report, carried as the Err arm out of the miner. Loud, typed, and DISTINCT
 * from a git transport error (a `GitError`, which propagates as a thrown exception instead).
 */
export interface BudgetExceeded {
  readonly reason: 'budget-exceeded';
  readonly limit: keyof WalkBudget;
  readonly seen: number;
  readonly cap: number;
}

/**
 * Conservative but generous: a real mid-size OSS repo fits inside them; a pathological one trips
 * the guard. Overridable per run.
 */
export const DEFAULT_WALK_BUDGET: WalkBudget = {
  maxCommits: 200_000,
  maxBlobBytes: 512 * 1024 * 1024,
  maxTreeEntries: 2_000_000,
};

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  §2 — the deterministic fact-base configuration (registries as reviewable lists)
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Which dependency-manifest grammar a `ManifestMatcher` parses with. `generic` is a line-set
 * diff (lockfiles, `requirements.txt`) that needs no per-ecosystem parser.
 *
 * v1 SCOPE: only `npm` is parsed structurally (package.json → the four dependency maps). Every
 * other ecosystem is routed through the `generic` line-set differ — a `DependencyDelta` whose
 * `name` is the trimmed manifest line and whose `kind` is `unknown`. Genuinely ambiguous (the
 * spec names no grammar); the least-committal choice is documented at
 * docs/spec/OPEN-QUESTIONS.md Q-62 rather than inventing a TOML/mod/gemspec parser here.
 */
export type Ecosystem = 'npm' | 'pip' | 'cargo' | 'go' | 'gem' | 'maven' | 'generic';

export interface ManifestMatcher {
  readonly glob: PathGlob;
  readonly ecosystem: Ecosystem;
}

/** Classifies the doc snapshots spec 04 §2 requires (README, ADRs, CONTRIBUTING). */
export type DocKind = 'readme' | 'adr' | 'contributing' | 'charter' | 'other';

export interface DocMatcher {
  readonly glob: PathGlob;
  readonly kind: DocKind;
}

/**
 * The negative-space registry: "the strongest laws live in negative space" (spec 04 §2). "No
 * external import ever crossed into `core/`" is a `BoundaryProbe`; the miner proves it
 * exhaustively over every commit's added/modified scoped source files.
 */
export interface BoundaryProbe {
  /** Stable id quoted in the proof, so a reviewer can find the rule that was proven. */
  readonly id: string;
  /** The subtree whose import boundary is proven held (e.g. `core/**`). */
  readonly scope: PathGlob;
  /** What must NEVER have been introduced into `scope` across the whole range. */
  readonly forbid: 'external-import' | 'forge-import';
  readonly why: string;
}

export interface FactBaseConfig {
  /** Output directory. Default `DEFAULT_FACT_BASE_OUT_DIR`. NEVER under `.program/` (INV-001). */
  readonly outDir: string;
  readonly budget: WalkBudget;
  readonly manifestFiles: readonly ManifestMatcher[];
  readonly docPaths: readonly DocMatcher[];
  readonly boundaryProbes: readonly BoundaryProbe[];
  /** File extensions the whole-file import scanner reads (`.ts`, `.tsx`, `.js`, …). */
  readonly sourceExtensions: readonly string[];
  /** Pass `-M` to diff-tree so directory renames are detectable (spec 04 §2 lifecycles). */
  readonly detectRenames: boolean;
}

/**
 * Under `.gwtp/` (machine observations), mirroring `bare.ts` `DEFAULT_BARE_DELIVERY_DIR =
 * '.gwtp/proposals'`. Deliberately NOT `.program/`: the fact base is evidence ABOUT the law, not
 * the law (spec 01 §1).
 */
export const DEFAULT_FACT_BASE_OUT_DIR = '.gwtp/distill/facts';

/** The one path segment the writer must refuse. Named so the guard is greppable. */
export const PROGRAM_STORE_DIR = '.program';

/** The single file `writeFactBase` emits under `outDir`. */
export const FACT_BASE_FILENAME = 'fact-base.json';

const pg = (s: string): PathGlob => unwrap(parsePathGlob(s));

export const DEFAULT_FACT_BASE_CONFIG: FactBaseConfig = {
  outDir: DEFAULT_FACT_BASE_OUT_DIR,
  budget: DEFAULT_WALK_BUDGET,
  manifestFiles: [
    { glob: pg('**/package.json'), ecosystem: 'npm' },
    { glob: pg('**/package-lock.json'), ecosystem: 'generic' },
    { glob: pg('**/requirements.txt'), ecosystem: 'pip' },
    { glob: pg('**/Cargo.toml'), ecosystem: 'cargo' },
    { glob: pg('**/go.mod'), ecosystem: 'go' },
    { glob: pg('**/Gemfile'), ecosystem: 'gem' },
    { glob: pg('**/pom.xml'), ecosystem: 'maven' },
  ],
  docPaths: [
    { glob: pg('**/README*'), kind: 'readme' },
    { glob: pg('docs/adr/**'), kind: 'adr' },
    { glob: pg('**/CONTRIBUTING*'), kind: 'contributing' },
    { glob: pg('.program/charter.md'), kind: 'charter' },
  ],
  boundaryProbes: [
    {
      id: 'core-external-purity',
      scope: pg('core/**'),
      forbid: 'external-import',
      why:
        'spec 04 §2: "No third-party import ever crossing into core/ … is a firmer statute than ' +
        'anything written down." Absence is exactly what a deterministic pass can prove ' +
        'exhaustively — it seeds precision (spec 04 §5).',
    },
  ],
  sourceExtensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
  detectRenames: true,
};

/**
 * Resolves a path to an absolute one, realpath-ing the nearest EXISTING ancestor so a symlink
 * pointing into `.program/` cannot slip a fact-base write into the program store.
 */
function resolveWithSymlinks(p: string): string {
  const abs = pathResolve(p);
  let existing = abs;
  const tail: string[] = [];
  while (!existsSync(existing)) {
    const parent = pathDirname(existing);
    if (parent === existing) break;
    tail.unshift(pathBasename(existing));
    existing = parent;
  }
  let real = existing;
  try {
    real = realpathSync(existing);
  } catch {
    real = existing;
  }
  return tail.length > 0 ? pathJoin(real, ...tail) : real;
}

/**
 * STRUCTURAL INV-001 GUARD. Resolves `outDir` (normalization, symlink-resolution, `..` collapse)
 * and FAILS with `invalid-path` if any segment equals `PROGRAM_STORE_DIR`. `writeFactBase` calls
 * this before touching the filesystem, so there is no code path through which the fact base lands
 * in the program store. Returns the resolved absolute directory on success.
 */
export function assertNotProgramPath(outDir: string): Parsed<string> {
  const resolved = resolveWithSymlinks(outDir);
  const segments = resolved.split(pathSep).filter((s) => s.length > 0);
  if (segments.includes(PROGRAM_STORE_DIR)) {
    return fail(
      'invalid-path',
      `fact-base outDir ${JSON.stringify(outDir)} resolves under ${PROGRAM_STORE_DIR}/ ` +
        `(${resolved}); distillation may never write the program store (INV-001, spec 04 §1/§4)`,
    );
  }
  return ok(resolved);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  §2 — the record types
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * An opaque `name <email>` identity. Branded so it cannot be widened into a model-prompt string
 * by accident, and confined to `DispersionFacts` (INV-003). The miner makes NO model calls, so
 * this is pass-one's structural enforcement of "author identity never reaches a synthesizable
 * fact" (spec 04 §2 mines an author-file matrix; a pass-two prompt must not carry it).
 */
export type AuthorHandle = Brand<string, 'AuthorHandle'>;

export function authorHandle(nameEmail: string): AuthorHandle {
  return nameEmail as AuthorHandle;
}

/**
 * A stable, run-INDEPENDENT id for a mined regularity (content hash of the regularity's own
 * canonical content). It is what binds a `ruling: coincidence` tombstone (spec 04 §6) across
 * re-runs: a rejection recorded last run keys to the same `RegularityKey` this run, so
 * "reject a candidate, re-run, it is not re-proposed" holds regardless of walk order or SHAs.
 */
export type RegularityKey = Brand<Sha256Ref, 'RegularityKey'>;

/** Content-hash a regularity's semantic content into a run-independent key. */
export function regularityKey(content: CanonicalValue): RegularityKey {
  return unwrap(contentHash(content)) as RegularityKey;
}

// ---------------------------------------------------------------------------
// Canonical regularity identity — ONE derivation shared by pass two (synthesis)
// and ratification, so a tombstone binds across BOTH layers and across runs.
//
// spec 04 §6: "the next walk can't resurrect a law the humans already declined." A human
// declines a LAW by its STATEMENT text, so statement identity is what binds a hand-authored
// tombstone — the strongest normalization wins. Both layers previously carried their own
// normalizeStatement (one whitespace-only, one lower+punctuation), which let a tombstone with a
// leading capital or trailing period slip through the ratify gate and be re-proposed. This is the
// single source of truth; ratify.ts and synthesis.ts import it and keep no local copy.
// ---------------------------------------------------------------------------

/** Lower-case, collapse whitespace, drop trailing sentence punctuation — the identity of a law. */
export function normalizeStatement(statement: string): string {
  return statement
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.;:\s]+$/, '');
}

/**
 * The run-independent tombstone key of a law, computed from its STATEMENT alone (normalized). Two
 * candidates with the same statement are the same law and tombstone together; a human tombstone
 * (which carries only a `pattern` text) keys the same way, so cosmetic case/punctuation/whitespace
 * variance can never resurrect a declined law.
 */
export function statementRegularityKey(statement: string): RegularityKey {
  return regularityKey({ statement: normalizeStatement(statement) });
}

/** Marker embedded in a machine-written coincidence tombstone so a re-run matches it structurally. */
export const REGULARITY_MARKER_PREFIX = 'gwtp-regularity';

const REGULARITY_MARKER_PATTERN = /gwtp-regularity:([0-9a-f]{64})/;

export function regularityMarker(key: RegularityKey): string {
  return `${REGULARITY_MARKER_PREFIX}:${sha256RefHex(key)}`;
}

export function findRegularityMarker(text: string): RegularityKey | null {
  const m = REGULARITY_MARKER_PATTERN.exec(text);
  if (m === null) return null;
  const ref = sha256RefFromHex(m[1] as string);
  return ref.ok ? (ref.value as RegularityKey) : null;
}

/**
 * Supplied by the epoch-segmentation slice (SEED-04 deliverable 2). Boundary-dependent facts
 * (import graphs, doc snapshots) consume these; whole-range facts do not, so pass one stays
 * runnable even before segmentation lands.
 */
export interface EpochBoundary {
  readonly epoch: EpochId;
  /** The boundary commit; tree snapshots (imports, docs) are taken here. */
  readonly at: CommitSha;
}

export interface FactBaseWatermark {
  /** Exclusive lower bound resolved, or null when walked from root. */
  readonly firstWalked: CommitSha | null;
  /** spec 04 §8: "the last SHA walked". Advancing `manifest.watermark` is a PROPOSAL, not a write. */
  readonly lastWalked: CommitSha;
  readonly commitsWalked: number;
  readonly mergesWalked: number;
  /** Content hash of the ordered SHA list — the replay identity of this walk. */
  readonly rangeDigest: Sha256Ref;
}

// ── file co-change graph ─────────────────────────────────────────────────────────────────────

export interface CoChangeEdge {
  /** `a < b` lexicographically (canonical undirected order). */
  readonly a: RepoPath;
  readonly b: RepoPath;
  readonly coChanges: number;
  readonly aChanges: number;
  readonly bChanges: number;
  /** coChanges / commitsConsidered. */
  readonly support: number;
  /** coChanges / min(aChanges, bChanges). */
  readonly confidence: number;
}

export interface CoChangeGraph {
  readonly nodes: readonly RepoPath[];
  readonly edges: readonly CoChangeEdge[];
  readonly commitsConsidered: number;
}

// ── import graphs at epoch boundaries ─────────────────────────────────────────────────────────

export interface ImportEdge {
  readonly from: RepoPath;
  readonly toSpecifier: string;
  /** Resolved intra-repo target, or null when external/builtin/unresolvable. */
  readonly toPath: RepoPath | null;
  readonly kind: 'value' | 'type-only' | 'dynamic' | 're-export';
  readonly external: boolean;
}

export interface ImportGraphSnapshot {
  readonly epoch: EpochId;
  readonly at: CommitSha;
  readonly edges: readonly ImportEdge[];
  readonly modulesScanned: number;
  readonly unresolvedSpecifiers: number;
}

// ── negative space (the marquee) ──────────────────────────────────────────────────────────────

/** The single counterexample that refutes a negative-space proof, cited concretely. */
export interface BoundaryBreach {
  readonly at: CommitSha;
  readonly committerTime: CommitterTime;
  readonly path: RepoPath;
  readonly line: number;
  readonly specifier: string;
}

/**
 * "No third-party import ever crossed into core/ across the whole history" is `held: true` with
 * `commitsChecked = commitsWalked` and `spanFrom..spanTo` the violation-free duration — a firmer
 * statute than anything written down (spec 04 §2), and exactly what a deterministic pass proves
 * exhaustively. Carries a `RegularityKey` so a human's rejection tombstones it (spec 04 §6).
 */
export interface NegativeSpaceProof {
  readonly probe: BoundaryProbe;
  /** true = the forbidden thing was NEVER introduced across the whole range. */
  readonly held: boolean;
  /** Exhaustiveness witness: how many commits were checked to prove it. */
  readonly commitsChecked: number;
  /** How many in-scope source files were scanned (the size of the proof). */
  readonly filesScanned: number;
  /** The violation-free span, feeding the empirical precision seed (spec 04 §5). */
  readonly spanFrom: CommitterTime | null;
  readonly spanTo: CommitterTime | null;
  /** null iff held; otherwise the first commit that broke the boundary. */
  readonly firstBreach: BoundaryBreach | null;
  readonly regularity: RegularityKey;
}

// ── dependency-manifest diffs over time ───────────────────────────────────────────────────────

export interface DependencyDelta {
  readonly name: string;
  readonly change: 'added' | 'removed' | 'version-changed';
  readonly from: string | null;
  readonly to: string | null;
  readonly kind: 'runtime' | 'dev' | 'peer' | 'optional' | 'unknown';
}

export interface ManifestEvent {
  readonly at: CommitSha;
  readonly committerTime: CommitterTime;
  readonly manifest: RepoPath;
  readonly ecosystem: Ecosystem;
  readonly deltas: readonly DependencyDelta[];
  /** `deltas.length` — upheaval magnitude, a change-point signal for the segmenter. */
  readonly churn: number;
}

export interface ManifestTimeline {
  readonly manifests: readonly RepoPath[];
  readonly events: readonly ManifestEvent[];
}

// ── litigated history: revert pairs + fix→issue links ─────────────────────────────────────────

export interface RevertFact {
  readonly revert: CommitSha;
  /** Parsed from `This reverts commit <sha>.` */
  readonly reverted: CommitSha;
  /** Resolved in-repo (a full walked sha sharing this prefix), or null when out of range. */
  readonly revertedResolved: CommitSha | null;
  readonly committerTime: CommitterTime;
  readonly subject: string;
  readonly regularity: RegularityKey;
}

export interface IssueLink {
  readonly at: CommitSha;
  readonly committerTime: CommitterTime;
  readonly issue: number;
  readonly relation: 'fixes' | 'closes' | 'refs';
  readonly subject: string;
}

export interface LitigationFacts {
  readonly reverts: readonly RevertFact[];
  readonly issueLinks: readonly IssueLink[];
}

// ── directory lifecycles ──────────────────────────────────────────────────────────────────────

export interface DirectoryEvent {
  readonly kind: 'created' | 'renamed' | 'deleted';
  readonly at: CommitSha;
  readonly committerTime: CommitterTime;
  readonly dir: RepoPath;
  readonly fromDir?: RepoPath;
}

export interface DirectoryLifecycle {
  readonly dir: RepoPath;
  readonly createdAt: CommitSha | null;
  readonly deletedAt: CommitSha | null;
  readonly renames: readonly DirectoryEvent[];
  readonly alive: boolean;
}

export interface DirectoryFacts {
  readonly lifecycles: readonly DirectoryLifecycle[];
  readonly events: readonly DirectoryEvent[];
}

// ── doc snapshots at epoch boundaries ─────────────────────────────────────────────────────────

export interface DocSnapshot {
  readonly epoch: EpochId;
  readonly at: CommitSha;
  readonly path: RepoPath;
  readonly kind: DocKind;
  readonly present: boolean;
  readonly contentHash: Sha256Ref | null;
  readonly text: string | null;
}

export interface DocFacts {
  readonly snapshots: readonly DocSnapshot[];
}

// ── author-file matrix (DISPERSION-SIDE, INV-003) ─────────────────────────────────────────────

export interface AuthorFileCell {
  readonly author: AuthorHandle;
  readonly path: RepoPath;
  readonly touches: number;
  readonly firstTouch: CommitterTime;
  readonly lastTouch: CommitterTime;
}

export interface AuthorFileMatrix {
  readonly cells: readonly AuthorFileCell[];
  readonly authors: number;
  readonly paths: number;
}

/**
 * The marker that says this partition is dispersion-side and MUST NOT reach any model prompt
 * (INV-003). Purely documentary at runtime; the real enforcement is that `AuthorFileMatrix` lives
 * ONLY here and never inside `SynthesizableFacts`.
 */
export const DISPERSION_MARKER =
  'author-bearing dispersion facts — never a model-prompt input (INV-003, spec 04 §2)' as const;

export interface DispersionFacts {
  readonly marker: typeof DISPERSION_MARKER;
  readonly authorFileMatrix: AuthorFileMatrix;
}

/**
 * The author-free partition. Everything here MAY reach a pass-two synthesis prompt (spec 04 §3).
 * `DispersionFacts` is deliberately NOT reachable from this type.
 */
export interface SynthesizableFacts {
  readonly coChange: CoChangeGraph;
  readonly importGraphs: readonly ImportGraphSnapshot[];
  readonly negativeSpace: readonly NegativeSpaceProof[];
  readonly manifests: ManifestTimeline;
  readonly litigation: LitigationFacts;
  readonly directories: DirectoryFacts;
  readonly docs: DocFacts;
}

/**
 * The whole fact base — a PURE function of (repo, range, boundaries, config). Two runs with the
 * same four inputs produce byte-identical `serializeFactBase` output.
 */
export interface FactBase {
  readonly version: 1;
  /** Content hash of the config that produced it — part of the replay identity. */
  readonly configDigest: Sha256Ref;
  readonly range: { readonly from: CommitSha | null; readonly to: CommitSha };
  readonly boundaries: readonly EpochBoundary[];
  readonly watermark: FactBaseWatermark;
  readonly synthesizable: SynthesizableFacts;
  readonly dispersion: DispersionFacts;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  Serialization — a PURE function of the fact base (determinism: spec 04 §2, §8)
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Object keys are sorted by `canonicalize` (RFC-8785 shaped); ARRAY order is significant and is
// fixed by the miner (every array is sorted deterministically before it lands in a FactBase). So
// `serializeFactBase` is a pure function of the FactBase value: same value → byte-identical bytes.

function coEdgeToCanonical(e: CoChangeEdge): CanonicalObject {
  return {
    a: e.a,
    b: e.b,
    coChanges: e.coChanges,
    aChanges: e.aChanges,
    bChanges: e.bChanges,
    support: e.support,
    confidence: e.confidence,
  };
}

function importEdgeToCanonical(e: ImportEdge): CanonicalObject {
  return {
    from: e.from,
    toSpecifier: e.toSpecifier,
    toPath: e.toPath,
    kind: e.kind,
    external: e.external,
  };
}

function probeToCanonical(p: BoundaryProbe): CanonicalObject {
  return { id: p.id, scope: p.scope, forbid: p.forbid, why: p.why };
}

function negativeSpaceToCanonical(n: NegativeSpaceProof): CanonicalObject {
  return {
    probe: probeToCanonical(n.probe),
    held: n.held,
    commitsChecked: n.commitsChecked,
    filesScanned: n.filesScanned,
    spanFrom: n.spanFrom,
    spanTo: n.spanTo,
    firstBreach:
      n.firstBreach === null
        ? null
        : {
            at: n.firstBreach.at,
            committerTime: n.firstBreach.committerTime,
            path: n.firstBreach.path,
            line: n.firstBreach.line,
            specifier: n.firstBreach.specifier,
          },
    regularity: n.regularity,
  };
}

function manifestEventToCanonical(m: ManifestEvent): CanonicalObject {
  return {
    at: m.at,
    committerTime: m.committerTime,
    manifest: m.manifest,
    ecosystem: m.ecosystem,
    churn: m.churn,
    deltas: m.deltas.map(
      (d): CanonicalObject => ({
        name: d.name,
        change: d.change,
        from: d.from,
        to: d.to,
        kind: d.kind,
      }),
    ),
  };
}

function directoryEventToCanonical(e: DirectoryEvent): CanonicalObject {
  return {
    kind: e.kind,
    at: e.at,
    committerTime: e.committerTime,
    dir: e.dir,
    fromDir: e.fromDir,
  };
}

/** The pure projection of a fact base to canonical JSON values. */
export function factBaseToCanonical(fb: FactBase): CanonicalObject {
  const s = fb.synthesizable;
  return {
    version: fb.version,
    configDigest: fb.configDigest,
    range: { from: fb.range.from, to: fb.range.to },
    boundaries: fb.boundaries.map((b): CanonicalObject => ({ epoch: b.epoch, at: b.at })),
    watermark: {
      firstWalked: fb.watermark.firstWalked,
      lastWalked: fb.watermark.lastWalked,
      commitsWalked: fb.watermark.commitsWalked,
      mergesWalked: fb.watermark.mergesWalked,
      rangeDigest: fb.watermark.rangeDigest,
    },
    synthesizable: {
      coChange: {
        nodes: [...s.coChange.nodes],
        edges: s.coChange.edges.map(coEdgeToCanonical),
        commitsConsidered: s.coChange.commitsConsidered,
      },
      importGraphs: s.importGraphs.map(
        (g): CanonicalObject => ({
          epoch: g.epoch,
          at: g.at,
          modulesScanned: g.modulesScanned,
          unresolvedSpecifiers: g.unresolvedSpecifiers,
          edges: g.edges.map(importEdgeToCanonical),
        }),
      ),
      negativeSpace: s.negativeSpace.map(negativeSpaceToCanonical),
      manifests: {
        manifests: [...s.manifests.manifests],
        events: s.manifests.events.map(manifestEventToCanonical),
      },
      litigation: {
        reverts: s.litigation.reverts.map(
          (r): CanonicalObject => ({
            revert: r.revert,
            reverted: r.reverted,
            revertedResolved: r.revertedResolved,
            committerTime: r.committerTime,
            subject: r.subject,
            regularity: r.regularity,
          }),
        ),
        issueLinks: s.litigation.issueLinks.map(
          (l): CanonicalObject => ({
            at: l.at,
            committerTime: l.committerTime,
            issue: l.issue,
            relation: l.relation,
            subject: l.subject,
          }),
        ),
      },
      directories: {
        lifecycles: s.directories.lifecycles.map(
          (d): CanonicalObject => ({
            dir: d.dir,
            createdAt: d.createdAt,
            deletedAt: d.deletedAt,
            alive: d.alive,
            renames: d.renames.map(directoryEventToCanonical),
          }),
        ),
        events: s.directories.events.map(directoryEventToCanonical),
      },
      docs: {
        snapshots: s.docs.snapshots.map(
          (d): CanonicalObject => ({
            epoch: d.epoch,
            at: d.at,
            path: d.path,
            kind: d.kind,
            present: d.present,
            contentHash: d.contentHash,
            text: d.text,
          }),
        ),
      },
    },
    dispersion: {
      marker: fb.dispersion.marker,
      authorFileMatrix: {
        authors: fb.dispersion.authorFileMatrix.authors,
        paths: fb.dispersion.authorFileMatrix.paths,
        cells: fb.dispersion.authorFileMatrix.cells.map(
          (c): CanonicalObject => ({
            author: c.author,
            path: c.path,
            touches: c.touches,
            firstTouch: c.firstTouch,
            lastTouch: c.lastTouch,
          }),
        ),
      },
    },
  };
}

/** Canonical, byte-stable serialization. Same fact base → identical bytes, forever. */
export function serializeFactBase(fb: FactBase): Parsed<string> {
  return canonicalize(factBaseToCanonical(fb));
}

/** The content hash of a config value — the fact base's `configDigest`. */
export function configDigest(config: FactBaseConfig): Sha256Ref {
  return unwrap(
    contentHash({
      manifestFiles: config.manifestFiles.map((m) => ({ glob: m.glob, ecosystem: m.ecosystem })),
      docPaths: config.docPaths.map((d) => ({ glob: d.glob, kind: d.kind })),
      boundaryProbes: config.boundaryProbes.map((p) => probeToCanonical(p)),
      sourceExtensions: [...config.sourceExtensions],
      detectRenames: config.detectRenames,
      budget: {
        maxCommits: config.budget.maxCommits,
        maxBlobBytes: config.budget.maxBlobBytes,
        maxTreeEntries: config.budget.maxTreeEntries,
      },
    }),
  );
}

// ── read path ─────────────────────────────────────────────────────────────────────────────────
//
// Structural re-hydration guarded by the canonical-JSON invariant. The serialized form is a pure
// projection of a FactBase; parsing validates the top-level shape and re-projects through
// `factBaseToCanonical`, so `serialize(parse(serialize(fb)))` is byte-identical to `serialize(fb)`
// (the round-trip the miner test asserts). Deep field-by-field decoding would duplicate the whole
// type tree for no additional guarantee, since branded strings are erased at runtime.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parse a serialized fact base back into a `FactBase`. Fails loud on a shape it cannot read. */
export function parseFactBase(text: string): Parsed<FactBase> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return fail('wrong-type', `fact base is not valid JSON: ${(e as Error).message}`);
  }
  if (!isRecord(parsed)) return fail('wrong-type', 'fact base must be a JSON object');
  if (parsed['version'] !== 1) {
    return fail('wrong-type', `unsupported fact-base version ${JSON.stringify(parsed['version'])}`);
  }
  for (const key of ['range', 'watermark', 'synthesizable', 'dispersion'] as const) {
    if (!isRecord(parsed[key])) {
      return fail('missing-field', `fact base is missing object \`${key}\``, `/${key}`);
    }
  }
  if (!Array.isArray(parsed['boundaries'])) {
    return fail('missing-field', 'fact base is missing array `boundaries`', '/boundaries');
  }
  // The shape is sound; re-project so the returned value is a normalized FactBase whatever the
  // stored bytes carried. Branded strings are erased at runtime, so this cast is honest.
  const errors: ContractError[] = [];
  const re = parsed as unknown as FactBase;
  try {
    factBaseToCanonical(re);
  } catch (e) {
    errors.push({ code: 'wrong-type', message: `fact base is structurally unreadable: ${(e as Error).message}` });
  }
  if (errors.length > 0) return { ok: false, error: errors[0] as ContractError };
  return ok(re);
}

/**
 * Writes the fact base under `config.outDir`, REFUSING first if that resolves into `.program/`
 * (INV-001). Returns the file path written. The only fs-writing function in `src/distill`, and it
 * cannot reach the program store.
 */
export function writeFactBase(config: FactBaseConfig, fb: FactBase): Parsed<string> {
  const guarded = assertNotProgramPath(config.outDir);
  if (!guarded.ok) return guarded;
  const bytes = serializeFactBase(fb);
  if (!bytes.ok) return bytes;
  mkdirSync(guarded.value, { recursive: true });
  const file = pathJoin(guarded.value, FACT_BASE_FILENAME);
  writeFileSync(file, bytes.value, 'utf8');
  return ok(file);
}

/** Reads and parses a fact base written by `writeFactBase`. */
export function readFactBase(path: string): Parsed<FactBase> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return fail('wrong-type', `cannot read fact base at ${path}: ${(e as Error).message}`);
  }
  return parseFactBase(text);
}
