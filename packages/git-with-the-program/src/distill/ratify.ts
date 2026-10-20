// Implements: docs/spec/04-distillation.md §4 ("Distillation may only emit `inferred`"), §5
// (empirical precision seeding — evidence strength ranks candidates) and §6 (the ratification
// ritual): a PR PROPOSING `.program/`, provenance rendered as commit/thread links, a per-assertion
// accept / edit / reject checklist, top ~12 by evidence (constitutional minimalism), and
// rejections recorded as `ruling: coincidence` tombstones so the next walk cannot resurrect a law
// the humans already declined. SEED-04 deliverable 5.
//
// THE MACHINE PROPOSES; THE HUMAN RATIFIES. This module is a pure renderer plus a file sink under
// `proposals/` — it never writes `.program/`, exactly as src/adapters/github/amendment.ts and
// src/ledger/firing.ts never do. INV-001 (`.program/` is human-ratified PRs only, `budget: 1.0`)
// is enforced HERE by the ABSENCE of any `.program/` write path: `buildRatificationProposal`
// returns a `DeliveryPatch` (a diff a human applies), and `writeRatificationProposal` refuses any
// output directory that resolves under `.program/` (the same guard bare.ts applies, reused).
//
// TWO STRUCTURAL GUARANTEES the type system carries for free:
//   1. The input is `CandidateAssertion[]`, whose `status` is pinned to the literal `'inferred'`
//      (schemas/assertion.schema.json allOf/0; spec 04 §4). There is no way to spell a ratified
//      output here — the miner cannot self-ratify even by mistake.
//   2. TOMBSTONES ARE BINDING (spec 04 §6). `buildRatificationProposal` filters out every
//      candidate whose regularity is already a `ruling: coincidence` precedent (isTombstone) or a
//      prior run's rejection BEFORE ranking, so "reject a candidate, re-run, it is not re-proposed"
//      is an idempotence property rather than a hope. The link between a rejection and a re-run is
//      the `RegularityKey`: a content hash of the regularity's own `{class, scope, statement}`, so
//      the same candidate keys to the same tombstone across walks.
//
// INV-005 / constraint: this module names no provider SDK. `@anthropic-ai/sdk` never appears here;
// ratification is deterministic text work over already-synthesized candidates. The text mechanics
// (`unifiedDiff`, `appendPrecedentYaml`, `nextPrecedentId`) are reused from src/ledger, and the
// forge-agnostic file sink (`BareFileSystem`, `targetsConstitution`) from src/adapters/github/bare.

import type {
  CandidateAssertion,
  ContractError,
  DeliveryKey,
  DeliveryPatch,
  EventId,
  NonEmptyReadonlyArray,
  Parsed,
  Precedent,
  PrecedentId,
  PrecedentRuling,
  ProvenanceRef,
} from '../core/index.js';
import {
  REGULARITY_MARKER_PREFIX,
  findRegularityMarker,
  normalizeStatement,
  regularityMarker,
  statementRegularityKey,
  type RegularityKey,
} from './factbase.js';
import {
  contentHash,
  deliveryKey,
  deliveryMarker,
  fail,
  findDeliveryMarker,
  isTombstone,
  ok,
  parseAccumulatorKey,
  parseEventId,
  sha256RefHex,
  unwrap,
} from '../core/index.js';
import {
  appendPrecedentYaml,
  nextPrecedentId,
  unifiedDiff,
} from '../ledger/index.js';
import {
  type BareFileSystem,
  nodeBareFileSystem,
  targetsConstitution,
} from '../adapters/github/bare.js';

// ---------------------------------------------------------------------------
// Constants — reviewable as data
// ---------------------------------------------------------------------------

/**
 * "Rank candidates by evidence and ship only the top ~12" (spec 04 §6). The tilde is the spec's;
 * 12 exactly is this engine's, exported as a named constant because it is a soft number — the same
 * treatment `MAX_RENDERED_EVENTS = 50` gets in src/adapters/github/render.ts and
 * `REARM_FRACTION_DEFAULT = 0.5` gets in src/core/accumulator.ts. A sixty-assertion day-one program
 * gets skimmed, a twelve-assertion one gets read. Overridable per run via `RatifyInput.limit`.
 */
export const MAX_RATIFICATION_CANDIDATES = 12;

export const INVARIANTS_PATH = '.program/invariants.yaml';
export const PRECEDENTS_PATH = '.program/precedents.yaml';

/**
 * The accumulator-key stand-in for a ratification delivery. A ratification is not keyed by an
 * assertion (it proposes several at once), so it borrows a scope-claim-shaped key
 * (`parseAccumulatorKey` admits any non-empty whitespace-free string — Q-04). The delivery key
 * pairs this with a content hash of the proposed set, so re-running with the same proposal yields
 * the same key and the same file (idempotent, like every other delivery — spec 02 §1).
 */
export const RATIFICATION_KEY = 'distill-ratification';

/** Where a ratification proposal lands when there is no forge. NEVER `.program/` (INV-001). */
export const DEFAULT_RATIFICATION_DIR = 'proposals';

// ---------------------------------------------------------------------------
// Regularity identity — what binds a rejection to a re-run (spec 04 §6)
// ---------------------------------------------------------------------------
//
// The normalization, the statement-based `RegularityKey`, and the tombstone marker all come from
// ./factbase.js — ONE derivation shared with synthesis (pass two), so a tombstone recorded by
// either layer binds in the other, and a human tombstone with cosmetic case/punctuation variance
// cannot slip past the ratify gate and be re-proposed.

/**
 * The run-INDEPENDENT id a candidate is tombstoned by — its statement's canonical key. Identical to
 * synthesis's `statementRegularityKey(candidate.statement)`, so the two layers share one key space
 * (a candidate keyed by class+scope as well would never match a human tombstone, which carries only
 * a `pattern` text — statement identity is the granularity spec 04 §6 actually needs).
 */
export function candidateRegularityKey(candidate: CandidateAssertion): RegularityKey {
  return statementRegularityKey(candidate.statement);
}

// ---------------------------------------------------------------------------
// Tombstone checking (spec 04 §6 — tombstones are binding)
// ---------------------------------------------------------------------------

/** Why a candidate was withheld: which tombstone matched it. */
export type TombstoneSource =
  | { readonly kind: 'precedent'; readonly id: PrecedentId }
  | { readonly kind: 'prior-run'; readonly regularity: RegularityKey };

/**
 * Does a coincidence tombstone already cover this regularity? Two ways a match is found, in
 * priority order:
 *   1. STRUCTURAL — a `ruling: coincidence` precedent carries this regularity's marker in its
 *      pattern, rationale or evidence (the shape `rejectCandidate` emits below).
 *   2. TEXTUAL — a coincidence precedent whose `pattern` normalizes to this candidate's statement.
 *      Covers a human-authored tombstone that predates the marker convention.
 * A prior run's rejection ledger (`priorRejections: RegularityKey[]`) is checked last.
 */
export function tombstoneFor(
  candidate: CandidateAssertion,
  regularity: RegularityKey,
  precedents: readonly Precedent[],
  priorRejections: readonly RegularityKey[],
): TombstoneSource | null {
  const marker = regularityMarker(regularity);
  const normStatement = normalizeStatement(candidate.statement);

  for (const p of precedents) {
    if (!isTombstone(p)) continue;
    const haystack = [p.pattern, p.rationale ?? '', ...p.evidence].join('\n');
    if (haystack.includes(marker)) return { kind: 'precedent', id: p.id };
    if (normalizeStatement(p.pattern) === normStatement) return { kind: 'precedent', id: p.id };
  }
  if (priorRejections.some((r) => r === regularity)) {
    return { kind: 'prior-run', regularity };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ranking by evidence (spec 04 §5)
// ---------------------------------------------------------------------------

/**
 * Evidence strength, dominated by the DERIVED precision seed (spec 04 §5 — itself a function of
 * violation-free span, corroboration count and cross-epoch persistence), then corroboration
 * breadth, then a violation-free-span bonus, then provenance depth. Bounded secondary weights keep
 * the ordering effectively lexicographic and hand-checkable; ties break on id, ascending, so the
 * ranking is deterministic across runs.
 */
export function evidenceScore(candidate: CandidateAssertion): number {
  const seed = candidate.precision_seed ?? (candidate.precision as number);
  const corroborations = candidate.evidence?.corroborations?.length ?? 0;
  const hasSpan =
    candidate.evidence?.span !== undefined && candidate.evidence.span.trim().length > 0 ? 1 : 0;
  const provenance = Math.min(candidate.provenance.length, 9);
  return seed + 0.001 * corroborations + 0.0005 * hasSpan + 0.00001 * provenance;
}

export interface RankedCandidate {
  readonly candidate: CandidateAssertion;
  readonly regularity: RegularityKey;
  readonly score: number;
}

export interface SuppressedCandidate {
  readonly candidate: CandidateAssertion;
  readonly regularity: RegularityKey;
  readonly tombstone: TombstoneSource;
}

/** Sorts by evidence score descending, then by id ascending. Pure, deterministic. */
export function rankCandidates(candidates: readonly CandidateAssertion[]): readonly RankedCandidate[] {
  return candidates
    .map((candidate) => ({
      candidate,
      regularity: candidateRegularityKey(candidate),
      score: evidenceScore(candidate),
    }))
    .sort((a, b) => b.score - a.score || (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// The ratification proposal
// ---------------------------------------------------------------------------

export interface RatifyInput {
  /** Candidate assertions from pass-two synthesis. All `status: inferred` by their type. */
  readonly candidates: readonly CandidateAssertion[];
  /** The program's precedents corpus. Coincidence entries are tombstones (spec 04 §6). */
  readonly precedents?: readonly Precedent[];
  /** A prior distillation run's rejection ledger, keyed by regularity. */
  readonly priorRejections?: readonly RegularityKey[];
  /** Current text of `.program/invariants.yaml`, supplied by the caller. Never read from disk here. */
  readonly invariantsYaml: string;
  /** Top-N cap. Defaults to MAX_RATIFICATION_CANDIDATES. */
  readonly limit?: number;
  /** Base URL for rendering provenance refs as links, e.g. `https://github.com/owner/repo`. */
  readonly repoUrl?: string;
  readonly labels?: readonly string[];
}

export interface RatificationProposal {
  readonly key: DeliveryKey;
  readonly title: string;
  /** Markdown: provenance links + a per-assertion accept/edit/reject checklist. Carries the marker. */
  readonly body: string;
  /** The proposed `.program/invariants.yaml` diff. Empty when nothing is proposable. */
  readonly patches: readonly DeliveryPatch[];
  /** The top ≤ limit candidates, ranked by evidence (spec 04 §5). */
  readonly proposed: readonly RankedCandidate[];
  /** Candidates withheld because a tombstone already covers them (spec 04 §6). */
  readonly suppressed: readonly SuppressedCandidate[];
  /** Ranked-but-cut candidates below the top-N line — "the long tail arrives by amendment" (§6). */
  readonly deferred: readonly RankedCandidate[];
  readonly labels: readonly string[];
  /** The full text `.program/invariants.yaml` would become. For a reviewer who prefers the result. */
  readonly result: string;
}

/**
 * Builds the ratification proposal: filter tombstoned candidates, rank the rest by evidence, take
 * the top ~12, render the accept/edit/reject checklist and the proposed `.program/invariants.yaml`
 * diff. Pure and total; writes nothing.
 */
export function buildRatificationProposal(input: RatifyInput): Parsed<RatificationProposal> {
  const precedents = input.precedents ?? [];
  const priorRejections = input.priorRejections ?? [];
  const limit = input.limit ?? MAX_RATIFICATION_CANDIDATES;

  const suppressed: SuppressedCandidate[] = [];
  const eligible: CandidateAssertion[] = [];
  for (const candidate of input.candidates) {
    // spec 01 §4 rule 1 — no assertion without provenance. `CandidateAssertion` types provenance as
    // non-empty and every producer enforces it, so reaching here empty needs a type-bypassing cast;
    // the ratify gate defends the rule independently anyway rather than render `provenance: []` into
    // a proposed patch the constitution could never absorb.
    if (candidate.provenance.length === 0) continue;
    const regularity = candidateRegularityKey(candidate);
    const tombstone = tombstoneFor(candidate, regularity, precedents, priorRejections);
    if (tombstone === null) {
      eligible.push(candidate);
    } else {
      suppressed.push({ candidate, regularity, tombstone });
    }
  }

  const ranked = rankCandidates(eligible);
  const proposed = ranked.slice(0, Math.max(0, limit));
  const deferred = ranked.slice(Math.max(0, limit));

  const appended = appendAssertionBlocks(
    input.invariantsYaml,
    proposed.map((r) => renderCandidateBlock(r.candidate)),
  );
  if (!appended.ok) return appended;
  const result = appended.value;

  const diff = unifiedDiff(INVARIANTS_PATH, input.invariantsYaml, result);
  const patches: DeliveryPatch[] = diff === null ? [] : [{ path: INVARIANTS_PATH, diff }];

  const key = ratificationDeliveryKey(proposed);
  const labels = ratificationLabels(input.labels ?? []);
  const title = `[GWTP] Ratification — ${proposed.length} inferred assertion(s) proposed for ${INVARIANTS_PATH}`;
  const body = renderRatificationBody({
    key,
    title,
    proposed,
    suppressed,
    deferred,
    consideredCount: input.candidates.length,
    limit,
    patch: patches[0] ?? null,
    repoUrl: input.repoUrl,
  });

  return ok({ key, title, body, patches, proposed, suppressed, deferred, labels, result });
}

function ratificationDeliveryKey(proposed: readonly RankedCandidate[]): DeliveryKey {
  const digest = contentHash({
    candidates: proposed.map((r) => r.candidate.id),
    regularities: proposed.map((r) => sha256RefHex(r.regularity)),
  });
  const eventId: EventId = digest.ok
    ? unwrap(parseEventId(digest.value))
    : unwrap(parseEventId(`sha256:${'0'.repeat(64)}`));
  return deliveryKey(unwrap(parseAccumulatorKey(RATIFICATION_KEY)), eventId);
}

export function ratificationLabels(extra: readonly string[] = []): readonly string[] {
  const base = ['gwtp-proposal', 'gwtp:ratification', 'gwtp:distillation'];
  const seen = new Set(base);
  for (const l of extra) {
    if (!seen.has(l)) {
      seen.add(l);
      base.push(l);
    }
  }
  return base;
}

// ---------------------------------------------------------------------------
// Rejection → a coincidence tombstone (spec 04 §6)
// ---------------------------------------------------------------------------

export interface RejectInput {
  readonly candidate: CandidateAssertion;
  /** Current text of `.program/precedents.yaml`, supplied by the caller. */
  readonly precedentsYaml: string;
  /** Every `PRE-*` id already in use, so the new one does not collide. */
  readonly existingPrecedentIds?: readonly PrecedentId[];
  /** Why the human rejected it. Becomes the tombstone's rationale. */
  readonly rationale?: string;
  /** Overrides the default evidence (marker + candidate provenance). */
  readonly evidence?: NonEmptyReadonlyArray<ProvenanceRef>;
}

export interface RejectedCandidate {
  /** `ruling: coincidence` — a human's rejection of an inferred regularity (spec 04 §6). */
  readonly precedent: Precedent;
  readonly regularity: RegularityKey;
  /** The proposed `.program/precedents.yaml` diff. Never written. */
  readonly patch: DeliveryPatch;
  /** The full text `.program/precedents.yaml` would become. */
  readonly result: string;
}

/**
 * Turns a rejected candidate into a `ruling: coincidence` tombstone (spec 04 §6): a precedent
 * whose evidence carries the candidate's regularity marker, so the NEXT ratification run's
 * `tombstoneFor` withholds the same candidate. Emitted as a PROPOSED `precedents.yaml` diff — the
 * machine records a tombstone the way it records everything else about `.program/`: as a patch a
 * human applies, never a write.
 */
export function rejectCandidate(input: RejectInput): Parsed<RejectedCandidate> {
  const regularity = candidateRegularityKey(input.candidate);
  const marker = regularityMarker(regularity);

  const idResult = nextPrecedentId(input.existingPrecedentIds ?? []);
  if (!idResult.ok) return idResult;

  const ruling: PrecedentRuling = 'coincidence';
  const evidence: NonEmptyReadonlyArray<ProvenanceRef> =
    input.evidence ?? [marker, ...input.candidate.provenance];
  const precedent: Precedent = {
    id: idResult.value,
    pattern: input.candidate.statement,
    ruling,
    rationale:
      input.rationale ??
      `Human declined inferred candidate ${input.candidate.id} at ratification (spec 04 §6): ` +
        `a regularity ruled coincidence, not statute. Tombstoned by ${marker} so re-distillation ` +
        'cannot resurrect it.',
    evidence,
  };

  const after = appendPrecedentYaml(input.precedentsYaml, precedent);
  if (!after.ok) return after;
  const diff = unifiedDiff(PRECEDENTS_PATH, input.precedentsYaml, after.value);
  if (diff === null) {
    return fail(
      'wrong-type',
      `recording ${precedent.id} produced no change to ${PRECEDENTS_PATH}; refusing an empty tombstone`,
    );
  }

  return ok({ precedent, regularity, patch: { path: PRECEDENTS_PATH, diff }, result: after.value });
}

// ---------------------------------------------------------------------------
// Delivery — a file under proposals/, never .program/
// ---------------------------------------------------------------------------

export interface RatificationWriteOptions {
  /** Configurable output directory. Defaults to DEFAULT_RATIFICATION_DIR. NEVER `.program/`. */
  readonly directory?: string;
  readonly fs?: BareFileSystem;
  /** Where the "I filed this" line goes. Defaults to stderr — stdout belongs to a CLI's data. */
  readonly log?: (line: string) => void;
}

export type RatificationWriteStatus = 'created' | 'existing';

export interface RatificationWriteReceipt {
  readonly key: DeliveryKey;
  readonly path: string;
  readonly status: RatificationWriteStatus;
}

const UNSAFE_FILENAME = /[^A-Za-z0-9._-]+/g;

function ratificationFileName(key: DeliveryKey): string {
  return `${key.replace(UNSAFE_FILENAME, '-').replace(/^-+|-+$/g, '')}.md`;
}

function joinPath(dir: string, file: string): string {
  return dir.endsWith('/') ? `${dir}${file}` : `${dir}/${file}`;
}

/**
 * Renders the whole ratification document a file (or an issue) would carry: the checklist body,
 * then each proposed `.program/` patch as a fenced diff with apply instructions.
 */
export function renderRatificationDocument(proposal: RatificationProposal): string {
  const parts: string[] = [proposal.body];
  for (const patch of proposal.patches) {
    parts.push(
      [
        `## Proposed patch — \`${patch.path}\``,
        '',
        'INV-001 forbids a machine writing `.program/`, so this arrives as a **patch, not a commit**.',
        'A human applies it under their own name, in a reviewed PR.',
        '',
        '```diff',
        patch.diff.replace(/\n$/, ''),
        '```',
        '',
        '```bash',
        `git apply path/to/${ratificationFileName(proposal.key).replace(/\.md$/, '.patch')}   # from the repo root`,
        '```',
      ].join('\n'),
    );
  }
  return parts.join('\n\n');
}

/**
 * Writes the ratification proposal to a file under `proposals/` and logs where it went. Refuses any
 * directory that resolves under `.program/` (INV-001), reusing the guard bare.ts applies. Idempotent
 * via the delivery marker: a re-run of the same proposal finds its own file and writes nothing.
 */
export async function writeRatificationProposal(
  proposal: RatificationProposal,
  opts: RatificationWriteOptions = {},
): Promise<Parsed<RatificationWriteReceipt>> {
  const directory = opts.directory ?? DEFAULT_RATIFICATION_DIR;
  const fs = opts.fs ?? nodeBareFileSystem();
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  if (targetsConstitution(directory)) {
    return fail(
      'invalid-path',
      `refusing to write a ratification proposal into ${directory}: that path is under ` +
        '.program/, which INV-001 excludes machine actors from (spec 04 §6). Deliver to a directory ' +
        'outside the constitution, or open the ratification PR by hand.',
    );
  }

  const path = joinPath(directory, ratificationFileName(proposal.key));
  const document = renderRatificationDocument(proposal);

  try {
    if (await fs.exists(path)) {
      const found = findDeliveryMarker(await fs.read(path));
      if (found === proposal.key) {
        log(`gwtp: ratification proposal ${proposal.key} already filed at ${path} (no duplicate written)`);
        return ok({ key: proposal.key, path, status: 'existing' });
      }
      return fail(
        'invalid-path',
        `refusing to overwrite ${path}: it carries delivery key ${found ?? '<none>'}, not ` +
          `${proposal.key}. Pass a different \`directory\` or file this proposal by hand.`,
      );
    }
    await fs.mkdirp(directory);
    const body = document.endsWith('\n') ? document : `${document}\n`;
    await fs.write(path, body);
    log(`gwtp: ratification proposal written to ${path} — read it, then open a PR proposing .program/.`);
    return ok({ key: proposal.key, path, status: 'created' });
  } catch (e) {
    return fail('invalid-path', `could not write ${path}: ${(e as Error)?.message ?? String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

interface RatificationBodyInput {
  readonly key: DeliveryKey;
  readonly title: string;
  readonly proposed: readonly RankedCandidate[];
  readonly suppressed: readonly SuppressedCandidate[];
  readonly deferred: readonly RankedCandidate[];
  readonly consideredCount: number;
  readonly limit: number;
  readonly patch: DeliveryPatch | null;
  readonly repoUrl?: string;
}

function renderRatificationBody(input: RatificationBodyInput): string {
  const out: string[] = [];
  out.push(`# ${input.title.replace(/^\[GWTP\] /, '')}`);
  out.push('');
  out.push(
    'These assertions were **inferred** by the distillation walk (spec 04) from this repository\'s ' +
      'own history — the loop run in reverse. Every one is `status: inferred`: not enforced, not ' +
      'self-ratifying. **You are the constitutional author** (spec 04 §4). Accept, edit or reject ' +
      'each below.',
  );
  out.push('');
  out.push(
    `Ranked by evidence strength and capped at **${input.limit}** (constitutional minimalism, ` +
      'spec 04 §6): a twelve-assertion program gets read, a sixty-assertion one gets skimmed. ' +
      `${input.consideredCount} candidate(s) were considered; ${input.proposed.length} are proposed ` +
      `here${input.deferred.length > 0 ? `, ${input.deferred.length} deferred to the long tail` : ''}` +
      `${input.suppressed.length > 0 ? `, ${input.suppressed.length} withheld as already-declined` : ''}.`,
  );
  out.push('');

  if (input.proposed.length === 0) {
    out.push('_No candidate is proposable in this run._');
  }
  for (const [i, r] of input.proposed.entries()) {
    out.push(...renderCandidateSection(i + 1, r, input.repoUrl));
    out.push('');
  }

  if (input.deferred.length > 0) {
    out.push('## Deferred (the long tail)');
    out.push('');
    out.push(
      'Ranked below the top-N line. Not rejected — they arrive by amendment once the live loop runs ' +
        '(spec 04 §6).',
    );
    out.push('');
    for (const r of input.deferred) {
      out.push(`- \`${r.candidate.id}\` (score ${r.score.toFixed(4)}) — ${r.candidate.statement}`);
    }
    out.push('');
  }

  if (input.suppressed.length > 0) {
    out.push('## Withheld — already declined (tombstoned)');
    out.push('');
    out.push(
      'A human already ruled each of these `coincidence, not statute` (spec 04 §6). Re-distillation ' +
        'must not resurrect them, so they are not re-proposed here.',
    );
    out.push('');
    for (const s of input.suppressed) {
      const src =
        s.tombstone.kind === 'precedent'
          ? `precedent \`${s.tombstone.id}\``
          : "a prior run's rejection ledger";
      out.push(`- \`${s.candidate.id}\` — withheld by ${src}: ${s.candidate.statement}`);
    }
    out.push('');
  }

  out.push('## How to apply');
  out.push('');
  out.push(
    'This is a **proposal against `.program/`**, not a write to it (INV-001, spec 04 §6). Check ' +
      '`accept` / `edit` / `reject` above, then:',
  );
  out.push('');
  out.push(
    '- **accept** any assertion to keep it — apply the patch below and change its `status` to ' +
      '`ratified` in your PR;',
  );
  out.push('- **edit** to accept with changes — adjust the statement, scope or knobs before ratifying;');
  out.push(
    '- **reject** any assertion to decline it — record a `ruling: coincidence` tombstone (this ' +
      'engine can generate that patch too), so the next walk cannot resurrect it.',
  );
  out.push('');
  out.push('---');
  out.push('');
  out.push(
    '_Filed by GWTP distillation (spec 04). The machine proposes; the human ratifies — nothing under ' +
      '`.program/` was written._',
  );
  out.push('');
  out.push(deliveryMarker(input.key));
  return out.join('\n');
}

function renderCandidateSection(
  n: number,
  r: RankedCandidate,
  repoUrl?: string,
): readonly string[] {
  const c = r.candidate;
  const out: string[] = [];
  out.push(`## ${n}. \`${c.id}\` — ${c.statement}`);
  out.push('');
  out.push(
    `- **class** \`${c.class}\` · **enforcement** \`${c.enforcement}\` · ` +
      `**scope** ${c.scope.map((g) => `\`${g}\``).join(', ')}`,
  );
  out.push(
    `- **precision seed** \`${c.precision_seed ?? (c.precision as number)}\` · ` +
      `**budget** \`${c.budget as number}\` · **half-life** \`${c.half_life.source}\` · ` +
      `**evidence score** \`${r.score.toFixed(4)}\``,
  );
  if (c.evidence?.span !== undefined && c.evidence.span.trim().length > 0) {
    out.push(`- **violation-free span** ${c.evidence.span}`);
  }
  const corroborations = c.evidence?.corroborations ?? [];
  if (corroborations.length > 0) {
    out.push(`- **corroborations** ${corroborations.map((ref) => renderProvenanceRef(ref, repoUrl)).join(', ')}`);
  }
  out.push(`- **provenance** ${c.provenance.map((ref) => renderProvenanceRef(ref, repoUrl)).join(', ')}`);
  out.push('');
  out.push(`- [ ] **accept** \`${c.id}\` — ratify as-is (set \`status: ratified\`)`);
  out.push(`- [ ] **edit** \`${c.id}\` — accept with changes, then ratify`);
  out.push(`- [ ] **reject** \`${c.id}\` — decline; records a \`ruling: coincidence\` tombstone (${regularityMarker(r.regularity)})`);
  return out;
}

/**
 * Renders a provenance ref as a link when its shape is recognized and a `repoUrl` is supplied
 * (`pr#41`/`#41` → the PR, `commit abc123`/`revert abc123` → the commit); otherwise a code span.
 * Residual hole, stated: a ref is free text (Q-09), so only known shapes linkify.
 */
export function renderProvenanceRef(ref: ProvenanceRef, repoUrl?: string): string {
  if (repoUrl === undefined) return `\`${ref}\``;
  const base = repoUrl.replace(/\/+$/, '');
  const pr = /^(?:pr#|#)(\d+)$/.exec(ref);
  if (pr !== null) return `[${ref}](${base}/pull/${pr[1]})`;
  const commit = /^(?:commit|revert)\s+([0-9a-f]{7,40})$/.exec(ref);
  if (commit !== null) return `[${ref}](${base}/commit/${commit[1]})`;
  return `\`${ref}\``;
}

// ---------------------------------------------------------------------------
// YAML rendering for the proposed invariants diff
// ---------------------------------------------------------------------------

/** JSON strings are valid YAML double-quoted scalars, escapes and all. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** Natural spelling for a numeric knob (`0.85`, `3`), matching how it reads in YAML. */
function formatNumber(n: number): string {
  return Number.isFinite(n) ? String(n) : 'null';
}

/**
 * One CAND-* assertion block, decodable by `decodeAssertion`. `status: inferred` is emitted
 * unconditionally — the ONLY status a candidate may carry (schemas/assertion.schema.json allOf/0,
 * spec 04 §4). No trailing newline; `appendAssertionBlocks` joins with newlines.
 */
export function renderCandidateBlock(candidate: CandidateAssertion): string {
  const lines: string[] = [
    `- id: ${candidate.id}`,
    `  statement: ${yamlString(candidate.statement)}`,
    `  class: ${candidate.class}`,
    `  scope: [${candidate.scope.map((g) => yamlString(g)).join(', ')}]`,
    `  enforcement: ${candidate.enforcement}`,
    `  precision: ${formatNumber(candidate.precision as number)}`,
    `  budget: ${formatNumber(candidate.budget as number)}`,
    `  half_life: ${candidate.half_life.source}`,
    `  status: inferred`,
    `  provenance: [${candidate.provenance.map((p) => yamlString(p)).join(', ')}]`,
  ];
  if (candidate.precision_seed !== undefined) {
    lines.push(`  precision_seed: ${formatNumber(candidate.precision_seed)}`);
  }
  if (candidate.evidence !== undefined) {
    lines.push('  evidence:');
    if (candidate.evidence.span !== undefined) {
      lines.push(`    span: ${yamlString(candidate.evidence.span)}`);
    }
    if (candidate.evidence.corroborations !== undefined) {
      lines.push(
        `    corroborations: [${candidate.evidence.corroborations.map((c) => yamlString(c)).join(', ')}]`,
      );
    }
  }
  return lines.join('\n');
}

const TOP_LEVEL_ITEM = /^-\s/;

/**
 * Appends assertion blocks to `.program/invariants.yaml`. Mirrors `appendPrecedentYaml`
 * (src/ledger/firing.ts): a shipped file whose body is the empty flow sequence `[]` has that token
 * REPLACED (a `[]` and a `- id:` cannot coexist); a file that already holds items is appended to; a
 * comment-only/empty file becomes the sequence. Returns the input unchanged when `blocks` is empty.
 */
export function appendAssertionBlocks(yaml: string, blocks: readonly string[]): Parsed<string> {
  if (blocks.length === 0) return ok(yaml);
  const body = `${blocks.join('\n\n')}\n`;
  const lines = yaml.split('\n');

  let emptyAt = -1;
  let hasItems = false;
  for (let i = 0; i < lines.length; i += 1) {
    const t = (lines[i] as string).trim();
    if (t === '' || t.startsWith('#')) continue;
    if (t === '[]') {
      emptyAt = i;
      continue;
    }
    if (TOP_LEVEL_ITEM.test(t) || t === '-') hasItems = true;
  }

  if (emptyAt !== -1 && hasItems) {
    return fail('wrong-type', `${INVARIANTS_PATH} holds both \`[]\` and sequence items`, '/');
  }
  if (emptyAt !== -1) {
    const next = [...lines];
    next.splice(emptyAt, 1, ...body.replace(/\n$/, '').split('\n'));
    return ok(next.join('\n'));
  }
  if (hasItems) {
    const base = yaml.endsWith('\n') ? yaml : `${yaml}\n`;
    return ok(base + body);
  }
  // Comment-only or empty: the candidates become the whole sequence, keeping any header comments.
  const base = yaml.length === 0 ? '' : yaml.endsWith('\n') ? yaml : `${yaml}\n`;
  return ok(base + body);
}
