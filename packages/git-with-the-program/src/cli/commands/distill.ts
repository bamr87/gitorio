// Implements: docs/spec/04-distillation.md — the `gwtp distill` command surface over the SEED-04
// distillation walk (src/distill/**). Five read-first subcommands mirroring the two passes:
//
//   facts       pass one: build the deterministic fact base and WRITE it (never under .program/).
//   epochs      segment the history into epochs (change-point detection, spec 04 §1) and print them.
//   candidates  what the walk would propose. OFFLINE BY DEFAULT: with no ModelClient seated it emits
//               only the MODEL-FREE candidates the deterministic fact base supports (proven
//               negative-space boundaries, spec 04 §2/§5) and reports that full synthesis (naming
//               behavioral/interface laws) needs a seated model. It NEVER makes a live model call.
//   ratify      render the ratification PROPOSAL (spec 04 §6) to proposals/ or stdout, honoring
//               tombstones. Never writes .program/ (INV-001) — the human is the constitutional author.
//   backfill    replay the CURRENT epoch through the seated DETERMINISTIC judges into the ledger
//               (spec 04 §7) and print the PROPOSED watermark advance (spec 04 §8).
//
// OFFLINE BY DEFAULT (SEED-04 task 4): no subcommand constructs a live ModelClient. `candidates` and
// `ratify` run the deterministic half only; a real synthesis pass is a future, explicitly-seated
// path. Every subcommand: --help, --json, a nonzero exit on error, and a hard cost cap where a
// judged merge is involved (`backfill --max-judged`).
//
// READ-ONLY against the checked-in project: git access is the read-only `GitExec` seam, and the only
// writes are (a) the fact base under an explicit --out (guarded against .program/), (b) a proposal
// file under proposals/, and (c) ledger events on an explicit --ledger-ref of the TARGET --repo.
// Exit codes: 0 success · 1 failure · 2 usage error.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { parse as parseYaml } from 'yaml';

import type {
  Assertion,
  AssertionClass,
  CandidateAssertion,
  CommitterTime,
  ContractError,
  Hunk,
  Judge,
  JudgeRef,
  Precedent,
  RatifiedAssertion,
} from '../../core/index.js';
import {
  decodeInvariantsFile,
  decodePrecedentsFile,
  isEnforceable,
  parseUnifiedDiff,
} from '../../core/index.js';
import { GitRefEventStore, createGitExec, type GitExec } from '../../ledger/index.js';
import {
  IMPORT_BOUNDARY_JUDGE,
  PATH_BOUNDARY_JUDGE,
  SCHEMA_CONFORMANCE_JUDGE,
  importBoundaryJudge,
  pathBoundaryJudge,
  schemaConformanceJudge,
} from '../../judge/index.js';
import {
  DEFAULT_BACKFILL_BUDGET,
  DEFAULT_FACT_BASE_CONFIG,
  DEFAULT_FACT_BASE_OUT_DIR,
  backfillLedger,
  backfillTierOf,
  buildRatificationProposal,
  deterministicCandidates,
  distillWalk,
  renderRatificationDocument,
  segmentWalk,
  walkCommits,
  writeFactBase,
  writeRatificationProposal,
  type BackfillCommit,
  type CommitRange,
  type Epoch,
  type FactBaseConfig,
  type SeatedBackfillJudge,
  type Segmentation,
  type WalkedCommit,
} from '../../distill/index.js';

// ---------------------------------------------------------------------------
// Output helpers (the shape gwtp validate / gwtp ledger / gwtp judge print)
// ---------------------------------------------------------------------------

function out(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}
function errOut(text: string): void {
  process.stderr.write(text.endsWith('\n') ? text : `${text}\n`);
}
function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
function displayPath(file: string): string {
  const rel = relative(process.cwd(), file);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? file : rel;
}
function formatContractError(e: ContractError): string {
  return `${e.code}${e.at === undefined || e.at === '' ? '' : ` at ${e.at}`}: ${e.message}`;
}

// ---------------------------------------------------------------------------
// Common flag resolution
// ---------------------------------------------------------------------------

interface CommonArgs {
  readonly repo: string;
  readonly range: CommitRange;
  readonly out: string | undefined;
  readonly json: boolean;
}

/** `a..b` → {from:a, to:b}; `b` → {from:null, to:b}; absent → {from:null, to:'HEAD'}. */
function resolveRange(raw: string | undefined): CommitRange {
  if (raw === undefined || raw.trim() === '') return { from: null, to: 'HEAD' };
  const spec = raw.trim();
  const idx = spec.indexOf('..');
  if (idx === -1) return { from: null, to: spec };
  const from = spec.slice(0, idx).trim();
  const to = spec.slice(idx + 2).trim();
  return { from: from === '' ? null : from, to: to === '' ? 'HEAD' : to };
}

/** Resolve an --out to an absolute path UNDER the repo (or absolute as given); default `defaultRel`. */
function resolveOut(rawOut: string | undefined, repo: string, defaultRel: string): string {
  const chosen = rawOut === undefined || rawOut.trim() === '' ? defaultRel : rawOut.trim();
  return isAbsolute(chosen) ? chosen : join(repo, chosen);
}

function requireRepo(repo: string): { ok: true } | { ok: false; message: string } {
  if (!existsSync(repo) || !statSync(repo).isDirectory()) {
    return { ok: false, message: `--repo ${displayPath(repo)} is not a directory` };
  }
  // A worktree or bare checkout need not have a literal `.git` dir, so we do not require one here;
  // the read-only git plumbing fails loudly below if `repo` is not a repository.
  return { ok: true };
}

const FACTS_CONFIG: FactBaseConfig = DEFAULT_FACT_BASE_CONFIG;

// ---------------------------------------------------------------------------
// Reading the target repo's program store
// ---------------------------------------------------------------------------

type Loaded<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: number; readonly message: string };

function readProgramFile(repo: string, name: string): string | null {
  const p = join(repo, '.program', name);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function loadInvariants(repo: string): Loaded<readonly Assertion[]> {
  const text = readProgramFile(repo, 'invariants.yaml');
  if (text === null) {
    return { ok: false, code: 2, message: `no .program/invariants.yaml under ${displayPath(repo)}` };
  }
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    return { ok: false, code: 1, message: `.program/invariants.yaml is not valid YAML: ${(e as Error).message}` };
  }
  const decoded = decodeInvariantsFile(raw, '');
  if (!decoded.ok) {
    return {
      ok: false,
      code: 1,
      message: `.program/invariants.yaml did not decode:\n${decoded.error.map((e) => `  ${formatContractError(e)}`).join('\n')}`,
    };
  }
  return { ok: true, value: decoded.value };
}

function loadPrecedents(repo: string): readonly Precedent[] {
  const text = readProgramFile(repo, 'precedents.yaml');
  if (text === null) return [];
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch {
    return [];
  }
  const decoded = decodePrecedentsFile(raw, '');
  return decoded.ok ? decoded.value : [];
}

// ---------------------------------------------------------------------------
// Subcommand: facts — build + write the deterministic fact base (pass one)
// ---------------------------------------------------------------------------

const FACTS_USAGE = [
  'gwtp distill facts — build the deterministic fact base and write it (spec 04 §2)',
  '',
  'Usage:',
  '  gwtp distill facts --repo <dir> [--range <a..b>] [--out <dir>] [--json]',
  '',
  'Walks the range read-only, segments epochs, mines the fact base (co-change, import graphs,',
  'negative-space proofs, manifest timeline, reverts, directory lifecycles, doc snapshots) and',
  'writes it to <out>/fact-base.json (default <repo>/' + DEFAULT_FACT_BASE_OUT_DIR + '). Never .program/.',
  '',
].join('\n');

async function runFacts(argv: readonly string[]): Promise<number> {
  const parsed = parseCommon(argv, FACTS_USAGE);
  if (parsed.kind !== 'ok') return parsed.code;
  const { repo, range, out: outDir, json } = parsed.args;

  const git = createGitExec({ cwd: repo });
  const config: FactBaseConfig = { ...FACTS_CONFIG, outDir: resolveOut(outDir, repo, DEFAULT_FACT_BASE_OUT_DIR) };

  const walk = await distillWalk(git, range, { config });
  if (!walk.ok) {
    errOut(`gwtp distill facts: walk stopped — ${walk.error.detail} (raise the budget or narrow --range)`);
    return 1;
  }
  const { factBase, segmentation } = walk.value;

  const written = writeFactBase(config, factBase);
  if (!written.ok) {
    errOut(`gwtp distill facts: ${formatContractError(written.error)}`);
    return 1;
  }

  const s = factBase.synthesizable;
  const summary = {
    path: written.value,
    commitsWalked: factBase.watermark.commitsWalked,
    mergesWalked: factBase.watermark.mergesWalked,
    epochs: segmentation.epochs.length,
    negativeSpaceProofs: s.negativeSpace.map((n) => ({ scope: n.probe.scope, held: n.held, commitsChecked: n.commitsChecked })),
    reverts: s.litigation.reverts.length,
    manifestEvents: s.manifests.events.length,
    docSnapshots: s.docs.snapshots.length,
    lastWalked: factBase.watermark.lastWalked,
  };

  if (json) {
    emitJson(summary);
    return 0;
  }
  out(`fact base written to ${displayPath(written.value)}`);
  out(`  commits walked   ${summary.commitsWalked} (${summary.mergesWalked} merge(s))`);
  out(`  epochs           ${summary.epochs}`);
  out(`  negative space   ${summary.negativeSpaceProofs.map((p) => `${p.scope}=${p.held ? 'held' : 'BREACHED'}`).join(', ') || '(none)'}`);
  out(`  reverts          ${summary.reverts}`);
  out(`  manifest events  ${summary.manifestEvents}`);
  out(`  doc snapshots    ${summary.docSnapshots}`);
  out(`  last walked      ${summary.lastWalked}`);
  return 0;
}

// ---------------------------------------------------------------------------
// Subcommand: epochs — segment the history and print the epochs (spec 04 §1)
// ---------------------------------------------------------------------------

const EPOCHS_USAGE = [
  'gwtp distill epochs — segment the history into structural epochs (spec 04 §1)',
  '',
  'Usage:',
  '  gwtp distill epochs --repo <dir> [--range <a..b>] [--json]',
  '',
  'Change-point detection over the repo\'s own statistics (doc rewrites, manifest upheavals,',
  'directory renames, churn spikes). Prints each epoch with its boundary, the break that opened it,',
  'volatility and the recency weight (the final epoch writes statute; earlier epochs are case law).',
  '',
].join('\n');

async function segmentRepo(git: GitExec, range: CommitRange): Promise<{ ok: true; walked: readonly WalkedCommit[]; segmentation: Segmentation } | { ok: false; detail: string }> {
  const walked = await walkCommits(git, range, { order: 'oldest-first', detectRenames: FACTS_CONFIG.detectRenames, maxCommits: FACTS_CONFIG.budget.maxCommits });
  if (!walked.ok) return { ok: false, detail: `${walked.error.limit}: ${walked.error.seen} > ${walked.error.cap}` };
  return { ok: true, walked: walked.value, segmentation: segmentWalk(walked.value, FACTS_CONFIG) };
}

function epochRow(e: Epoch): Record<string, unknown> {
  return {
    id: e.id,
    commits: e.commitCount,
    startIndex: e.startIndex,
    endIndex: e.endIndex,
    startSha: e.startSha,
    endSha: e.endSha,
    isFinal: e.isFinal,
    volatility: round4(e.volatility),
    recencyWeight: round4(e.recencyWeight),
    openedBy: e.openedBy === null ? null : e.openedBy.triggers.map((t) => ({ signal: t.signal, z: round4(t.z) })),
  };
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

async function runEpochs(argv: readonly string[]): Promise<number> {
  const parsed = parseCommon(argv, EPOCHS_USAGE);
  if (parsed.kind !== 'ok') return parsed.code;
  const { repo, range, json } = parsed.args;

  const git = createGitExec({ cwd: repo });
  const seg = await segmentRepo(git, range);
  if (!seg.ok) {
    errOut(`gwtp distill epochs: walk stopped — ${seg.detail}`);
    return 1;
  }
  const rows = seg.segmentation.epochs.map(epochRow);

  if (json) {
    emitJson({ detector: seg.segmentation.detector, epochs: rows });
    return 0;
  }
  out(`${rows.length} epoch(s) — detector ${seg.segmentation.detector}`);
  for (const r of rows) {
    const opened = r.openedBy === null ? 'opens history' : `break ${(r.openedBy as { signal: string; z: number }[]).map((t) => `${t.signal} z=${t.z}`).join(', ')}`;
    out(`  ${r.id}${r.isFinal ? ' (final)' : ''}  commits ${r.commits} [${r.startIndex}..${r.endIndex}]  recency ${r.recencyWeight}  volatility ${r.volatility}`);
    out(`      ${String(r.startSha).slice(0, 12)}..${String(r.endSha).slice(0, 12)}  ${opened}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Subcommand: candidates — model-free candidates + a note that synthesis needs a model
// ---------------------------------------------------------------------------

const CANDIDATES_USAGE = [
  'gwtp distill candidates — the candidates the walk supports (OFFLINE by default)',
  '',
  'Usage:',
  '  gwtp distill candidates --repo <dir> [--range <a..b>] [--json]',
  '',
  'With NO ModelClient seated (the default), this emits ONLY the model-free candidates the',
  'deterministic fact base proves — the negative-space boundaries (spec 04 §2/§5), each a',
  '`status: inferred` candidate with a precision seeded from its violation-free span. Full',
  'synthesis (naming behavioral / interface laws) needs a seated model; this never makes a live call.',
  '',
].join('\n');

function candidateRow(c: CandidateAssertion): Record<string, unknown> {
  return {
    id: c.id,
    statement: c.statement,
    class: c.class,
    scope: [...c.scope],
    enforcement: c.enforcement,
    status: c.status,
    precision_seed: c.precision_seed ?? (c.precision as number),
    provenance: [...c.provenance],
    ...(c.evidence?.span !== undefined ? { span: c.evidence.span } : {}),
  };
}

async function runCandidates(argv: readonly string[]): Promise<number> {
  const parsed = parseCommon(argv, CANDIDATES_USAGE);
  if (parsed.kind !== 'ok') return parsed.code;
  const { repo, range, json } = parsed.args;

  const git = createGitExec({ cwd: repo });
  const walk = await distillWalk(git, range, { config: FACTS_CONFIG });
  if (!walk.ok) {
    errOut(`gwtp distill candidates: walk stopped — ${walk.error.detail}`);
    return 1;
  }
  const { factBase, segmentation } = walk.value;
  const candidates = deterministicCandidates(factBase, segmentation);
  const rows = candidates.map(candidateRow);
  const note =
    'No ModelClient is seated; distillation ran OFFLINE. Emitting only the model-free candidates the ' +
    'deterministic fact base supports (proven negative-space boundaries). Pass-two synthesis — naming ' +
    'behavioral, interface and convention laws — needs a seated model (spec 04 §3).';

  if (json) {
    emitJson({ mode: 'offline-deterministic', note, epochs: segmentation.epochs.length, candidates: rows });
    return 0;
  }
  out(note);
  out('');
  if (rows.length === 0) {
    out('No model-free candidates: no negative-space boundary was proven held over this range.');
    return 0;
  }
  out(`${rows.length} model-free candidate(s), strongest first:`);
  for (const r of rows) {
    out(`  ${r.id}  precision_seed ${r.precision_seed}  class ${r.class}  scope ${(r.scope as string[]).join(', ')}`);
    out(`      ${r.statement}`);
    out(`      provenance: ${(r.provenance as string[]).join(', ')}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Subcommand: ratify — render the ratification PROPOSAL (spec 04 §6)
// ---------------------------------------------------------------------------

const RATIFY_USAGE = [
  'gwtp distill ratify — render the ratification PROPOSAL (spec 04 §6)',
  '',
  'Usage:',
  '  gwtp distill ratify --repo <dir> [--range <a..b>] [--out <dir>] [--json]',
  '',
  'Ranks the model-free candidates by evidence, takes the top ~12 (constitutional minimalism),',
  'renders a per-assertion accept/edit/reject checklist, and proposes the `.program/invariants.yaml`',
  'diff. Honors tombstones: a `ruling: coincidence` precedent (or a re-run) suppresses a declined',
  'candidate. With --out it writes the proposal under that directory (never .program/); otherwise it',
  'prints the proposal to stdout. NEVER writes .program/ — the human is the constitutional author.',
  '',
].join('\n');

async function runRatify(argv: readonly string[]): Promise<number> {
  const parsed = parseCommon(argv, RATIFY_USAGE);
  if (parsed.kind !== 'ok') return parsed.code;
  const { repo, range, out: outDir, json } = parsed.args;

  const git = createGitExec({ cwd: repo });
  const walk = await distillWalk(git, range, { config: FACTS_CONFIG });
  if (!walk.ok) {
    errOut(`gwtp distill ratify: walk stopped — ${walk.error.detail}`);
    return 1;
  }
  const { factBase, segmentation } = walk.value;
  const candidates = deterministicCandidates(factBase, segmentation);
  const precedents = loadPrecedents(repo);
  const invariantsYaml = readProgramFile(repo, 'invariants.yaml') ?? '[]\n';

  const proposalR = buildRatificationProposal({ candidates, precedents, invariantsYaml });
  if (!proposalR.ok) {
    errOut(`gwtp distill ratify: ${formatContractError(proposalR.error)}`);
    return 1;
  }
  const proposal = proposalR.value;

  // --out → write a proposal file (never .program/); otherwise print the document to stdout.
  let writtenPath: string | null = null;
  if (outDir !== undefined) {
    const receipt = await writeRatificationProposal(proposal, { directory: resolveOut(outDir, repo, 'proposals'), log: () => {} });
    if (!receipt.ok) {
      errOut(`gwtp distill ratify: ${formatContractError(receipt.error)}`);
      return 1;
    }
    writtenPath = receipt.value.path;
  }

  if (json) {
    emitJson({
      proposed: proposal.proposed.map((r) => ({ id: r.candidate.id, score: round4(r.score), statement: r.candidate.statement })),
      suppressed: proposal.suppressed.map((s) => ({ id: s.candidate.id, by: s.tombstone.kind })),
      deferred: proposal.deferred.map((r) => r.candidate.id),
      patches: proposal.patches.map((p) => p.path),
      writtenPath,
    });
    return 0;
  }

  if (writtenPath !== null) {
    out(`ratification proposal written to ${displayPath(writtenPath)}`);
    out(`  proposed ${proposal.proposed.length}, suppressed ${proposal.suppressed.length}, deferred ${proposal.deferred.length}`);
    out('  read it, then open a PR proposing .program/ — nothing under .program/ was written (INV-001).');
    return 0;
  }
  out(renderRatificationDocument(proposal));
  return 0;
}

// ---------------------------------------------------------------------------
// Subcommand: backfill — replay the current epoch through deterministic judges (spec 04 §7/§8)
// ---------------------------------------------------------------------------

const BACKFILL_USAGE = [
  'gwtp distill backfill — replay the current epoch into the ledger (spec 04 §7/§8)',
  '',
  'Usage:',
  '  gwtp distill backfill --repo <dir> --ledger-ref <ref> [--range <a..b>] [--max-judged <n>] [--json]',
  '',
  'Replays the CURRENT (final) epoch through the seated DETERMINISTIC judges — one per ratified,',
  'deterministic-class invariant — minting events that carry committer time, so the fold ages each',
  'observation to its real place in history (backfill is safe by construction, spec 04 §7). Events',
  'are appended to --ledger-ref of --repo. Prints the PROPOSED manifest watermark advance (spec 04',
  '§8), never writing .program/. --max-judged caps judged merges (default ' + DEFAULT_BACKFILL_BUDGET.maxJudgedMerges + ').',
  '',
].join('\n');

/** spec 03 §1: one deterministic magistrate per assertion class (mirrors src/cli/commands/judge.ts). */
const DETERMINISTIC_BY_CLASS: Partial<Record<AssertionClass, { readonly ref: JudgeRef; readonly judge: Judge }>> = {
  boundary: { ref: PATH_BOUNDARY_JUDGE, judge: pathBoundaryJudge },
  dependency: { ref: IMPORT_BOUNDARY_JUDGE, judge: importBoundaryJudge },
  convention: { ref: SCHEMA_CONFORMANCE_JUDGE, judge: schemaConformanceJudge },
};

async function showHunks(git: GitExec, sha: string): Promise<readonly Hunk[]> {
  const r = await git(['-c', 'core.quotePath=false', 'show', '--format=', '--no-renames', '--no-color', '-U3', sha]);
  return parseUnifiedDiff(r.stdout);
}

interface BackfillArgs extends CommonArgs {
  readonly ledgerRef: string;
  readonly maxJudged: number;
}

async function runBackfill(argv: readonly string[]): Promise<number> {
  let values: {
    repo?: string;
    range?: string;
    out?: string;
    json?: boolean;
    help?: boolean;
    'ledger-ref'?: string;
    'max-judged'?: string;
  };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        repo: { type: 'string' },
        range: { type: 'string' },
        out: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        'ledger-ref': { type: 'string' },
        'max-judged': { type: 'string' },
      },
      allowPositionals: false,
      strict: true,
    }));
  } catch (e) {
    errOut(`gwtp distill backfill: ${(e as Error).message}\n\n${BACKFILL_USAGE}`);
    return 2;
  }
  if (values.help === true) {
    out(BACKFILL_USAGE);
    return 0;
  }
  const repo = resolve(values.repo ?? process.cwd());
  const repoCheck = requireRepo(repo);
  if (!repoCheck.ok) {
    errOut(`gwtp distill backfill: ${repoCheck.message}`);
    return 2;
  }
  const ledgerRef = values['ledger-ref'];
  if (ledgerRef === undefined || ledgerRef.trim() === '') {
    errOut(`gwtp distill backfill: --ledger-ref <ref> is required\n\n${BACKFILL_USAGE}`);
    return 2;
  }
  let maxJudged = DEFAULT_BACKFILL_BUDGET.maxJudgedMerges;
  if (values['max-judged'] !== undefined) {
    const n = Number(values['max-judged']);
    if (!Number.isInteger(n) || n < 0) {
      errOut('gwtp distill backfill: --max-judged must be a non-negative integer');
      return 2;
    }
    maxJudged = n;
  }
  const args: BackfillArgs = { repo, range: resolveRange(values.range), out: values.out, json: values.json === true, ledgerRef: ledgerRef.trim(), maxJudged };

  const git = createGitExec({ cwd: repo });

  // Seat one deterministic judge per RATIFIED, deterministic-class invariant.
  const invariants = loadInvariants(repo);
  if (!invariants.ok) {
    errOut(`gwtp distill backfill: ${invariants.message}`);
    return invariants.code;
  }
  const seated: SeatedBackfillJudge[] = [];
  const skipped: { id: string; why: string }[] = [];
  for (const a of invariants.value) {
    if (!isEnforceable(a)) {
      skipped.push({ id: a.id, why: `status ${a.status} (only ratified is replayed)` });
      continue;
    }
    const ratified: RatifiedAssertion = a;
    if (ratified.enforcement !== 'deterministic') {
      skipped.push({ id: ratified.id, why: `enforcement ${ratified.enforcement} needs a seated model (offline backfill replays deterministic only)` });
      continue;
    }
    const seat = DETERMINISTIC_BY_CLASS[ratified.class];
    if (seat === undefined) {
      skipped.push({ id: ratified.id, why: `class ${ratified.class} has no deterministic judge` });
      continue;
    }
    seated.push({ assertion: ratified, tier: backfillTierOf(ratified.enforcement), ref: seat.ref, judge: seat.judge });
  }
  if (seated.length === 0) {
    errOut(`gwtp distill backfill: no ratified deterministic-class invariant to replay under ${displayPath(repo)}/.program/invariants.yaml`);
    if (skipped.length > 0) errOut(`  skipped: ${skipped.map((s) => `${s.id} (${s.why})`).join('; ')}`);
    return 1;
  }

  // The CURRENT epoch: segment, take the final epoch's commits, build BackfillCommit[] with hunks.
  const seg = await segmentRepo(git, args.range);
  if (!seg.ok) {
    errOut(`gwtp distill backfill: walk stopped — ${seg.detail}`);
    return 1;
  }
  const finalEpoch = seg.segmentation.finalEpoch;
  if (finalEpoch === null) {
    errOut('gwtp distill backfill: the range is empty — nothing to replay');
    return 1;
  }
  const epochCommits: readonly WalkedCommit[] = seg.walked.slice(finalEpoch.startIndex, finalEpoch.endIndex + 1);
  const backfillCommits: BackfillCommit[] = [];
  for (const wc of epochCommits) {
    const hunks = wc.meta.isMerge ? [] : await showHunks(git, wc.meta.sha);
    backfillCommits.push({ sha: wc.meta.sha, committerTime: wc.meta.committerTime as CommitterTime, isMerge: wc.meta.isMerge, hunks });
  }

  const store = new GitRefEventStore({ cwd: repo, ref: args.ledgerRef, now: () => new Date(0) });
  const manifestYaml = readProgramFile(repo, 'manifest.yaml') ?? undefined;

  const result = await backfillLedger({
    commits: backfillCommits,
    judges: seated,
    store,
    budget: { maxJudgedMerges: args.maxJudged },
    ...(manifestYaml !== undefined ? { manifestYaml } : {}),
    lastEpoch: finalEpoch.id,
  });
  if (!result.ok) {
    errOut(
      `gwtp distill backfill: judged-merge cap of ${result.error.cap} reached after ${result.error.judgedSoFar} ` +
        `merge(s); stopped at ${result.error.stoppedAt}. Nothing was overspent — raise --max-judged to continue.`,
    );
    return 1;
  }

  const { result: replay, append, watermark } = result.value;
  const summary = {
    epoch: finalEpoch.id,
    commitsReplayed: replay.commitsReplayed,
    deterministicJudgements: replay.deterministicJudgements,
    judgedMerges: replay.judgedMerges,
    eventsWritten: append.written.length,
    eventsDeduped: append.deduped.length,
    ledgerRef: args.ledgerRef,
    seated: seated.map((s) => s.assertion.id),
    skipped,
    watermark: watermark === null ? null : { path: watermark.path, lastWalked: watermark.lastWalked, lastEpoch: watermark.lastEpoch },
  };

  if (args.json) {
    emitJson({ ...summary, watermarkDiff: watermark?.diff ?? null });
    return 0;
  }
  out(`backfilled the current epoch ${finalEpoch.id} into ${args.ledgerRef}`);
  out(`  commits replayed        ${summary.commitsReplayed}`);
  out(`  deterministic judgements ${summary.deterministicJudgements}`);
  out(`  judged merges           ${summary.judgedMerges} (cap ${args.maxJudged})`);
  out(`  events written          ${summary.eventsWritten} (${summary.eventsDeduped} deduped)`);
  out(`  seated                  ${summary.seated.join(', ')}`);
  if (skipped.length > 0) out(`  skipped                 ${skipped.map((s) => `${s.id} (${s.why})`).join('; ')}`);
  if (watermark !== null) {
    out('');
    out(`proposed watermark advance to ${watermark.lastWalked} (spec 04 §8) — a PATCH, not a write to .program/:`);
    out('');
    out('```diff');
    out(watermark.diff.replace(/\n$/, ''));
    out('```');
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Common flag parsing for the read-only subcommands (facts / epochs / candidates / ratify)
// ---------------------------------------------------------------------------

type ParsedCommon =
  | { readonly kind: 'ok'; readonly args: CommonArgs }
  | { readonly kind: 'exit'; readonly code: number };

function parseCommon(argv: readonly string[], usageText: string): ParsedCommon {
  let values: { repo?: string; range?: string; out?: string; json?: boolean; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        repo: { type: 'string' },
        range: { type: 'string' },
        out: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
      strict: true,
    }));
  } catch (e) {
    errOut(`gwtp distill: ${(e as Error).message}\n\n${usageText}`);
    return { kind: 'exit', code: 2 };
  }
  if (values.help === true) {
    out(usageText);
    return { kind: 'exit', code: 0 };
  }
  const repo = resolve(values.repo ?? process.cwd());
  const check = requireRepo(repo);
  if (!check.ok) {
    errOut(`gwtp distill: ${check.message}`);
    return { kind: 'exit', code: 2 };
  }
  return { kind: 'ok', args: { repo, range: resolveRange(values.range), out: values.out, json: values.json === true } };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

interface SubSpec {
  readonly summary: string;
  readonly run: (argv: readonly string[]) => Promise<number>;
}

const SUBCOMMANDS: Readonly<Record<string, SubSpec>> = {
  facts: { summary: 'build + write the deterministic fact base (pass one)', run: runFacts },
  epochs: { summary: 'segment the history into structural epochs and print them', run: runEpochs },
  candidates: { summary: 'the candidates the walk supports (offline by default)', run: runCandidates },
  ratify: { summary: 'render the ratification PROPOSAL (never writes .program/)', run: runRatify },
  backfill: { summary: 'replay the current epoch through deterministic judges into the ledger', run: runBackfill },
};

function usage(): string {
  const width = Math.max(...Object.keys(SUBCOMMANDS).map((n) => n.length));
  return [
    'gwtp distill — the cold-start distillation walk (docs/spec/04-distillation.md)',
    '',
    'The detection loop run in reverse: infer the model from the repository\'s own history.',
    '',
    'Usage:',
    '  gwtp distill <subcommand> [options]',
    '',
    'Subcommands:',
    ...Object.entries(SUBCOMMANDS).map(([name, s]) => `  ${name.padEnd(width)}  ${s.summary}`),
    '',
    'Common options:',
    '  --repo <dir>         repository to walk and whose .program/ to read (default: cwd)',
    '  --range <a..b>       commit range to walk (default: the whole history to HEAD)',
    '  --out <dir>          where to write output (fact base / proposal); never .program/',
    '  --json               machine-readable output',
    '  -h, --help           show a subcommand\'s own options',
    '',
    'Distillation emits `status: inferred` only and never writes .program/ (INV-001): the',
    'ratification PR and the watermark advance are DELIVERED AS PROPOSALS. It is OFFLINE by default —',
    'no subcommand makes a live model call. The human is the constitutional author (spec 04 §4/§6).',
    '',
    'Exit codes: 0 success · 1 failure · 2 usage error.',
    '',
  ].join('\n');
}

export async function run(argv: readonly string[]): Promise<number> {
  const first = argv[0];
  if (first === undefined) {
    out(usage());
    return 2;
  }
  if (first === '--help' || first === '-h') {
    out(usage());
    return 0;
  }
  const spec = SUBCOMMANDS[first];
  if (spec === undefined) {
    errOut(`gwtp distill: unknown subcommand \`${first}\`\n\n${usage()}`);
    return 2;
  }
  try {
    return await spec.run(argv.slice(1));
  } catch (e) {
    errOut(`gwtp distill ${first}: ${(e as Error).message}`);
    return 1;
  }
}
