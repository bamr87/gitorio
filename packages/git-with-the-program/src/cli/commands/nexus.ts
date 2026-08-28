// Implements: docs/spec/05-nexus.md §4 (build/status over the `.gwtp/nexus/` cache), §5 (the
// ring inspector), §6 (seams) and §7 (import queries) — the CLI surface of the perception
// layer, per ADR-0007. Thin shell over src/nexus: this file parses flags, walks the worktree
// snapshot, and renders; every graph fact is computed in src/nexus.
//
// READ-MOSTLY. `build` writes exactly one file, the gitignored cache under `.gwtp/nexus/`
// (spec 05 §1.3: derived, disposable, machine-overwritable — the one store whose politics
// allow this). Nothing here touches `.program/` (INV-001), the ledger ref (INV-002), or the
// worktree it perceives.
//
// Verbs:
//   build      perceive the worktree; write the cache artifact
//   status     read the cache back, re-perceive in memory, compare hashes (spec 05 §4:
//              staleness is answered by REBUILDING, never by trusting a marker)
//   defs       definitions of one module, with citable spans
//   imports    outgoing imports of one module (resolved / external / unresolved)
//   importers  modules importing one module
//   callers    resolved callers of a definition (`<path>#<name>` or `<path>:<line>`)
//   seams      the import-connected partition of the tree (spec 05 §6)
//   ring       what evidence each context ring would grant a diff (spec 05 §5) — the
//              inspection half of `gwtp judge --ring`

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  type ContextRing,
  type PathGlob,
  type RepoPath,
  CONTEXT_RINGS,
  matchesGlob,
  parsePathGlob,
  parseRepoPath,
  parseUnifiedDiff,
} from '../../core/index.js';
import {
  type DefinitionNode,
  type NexusDocument,
  type NexusGraph,
  type NexusIndex,
  buildNexus,
  callersOf,
  collectTreeSnapshot,
  definitionsIn,
  enclosingDefinition,
  importersOf,
  importsOf,
  indexNexus,
  nexusCachePath,
  readNexusCache,
  ringHunks,
  seams,
  sealNexusDocument,
  snapshotMap,
  writeNexusCache,
} from '../../nexus/index.js';

// ---------------------------------------------------------------------------
// Output helpers (the same shape gwtp judge / gwtp validate print)
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

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

interface CommonValues {
  help?: boolean | undefined;
  repo?: string | undefined;
  json?: boolean | undefined;
}

const COMMON_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  repo: { type: 'string' },
  json: { type: 'boolean' },
} as const;

function repoRootOf(values: CommonValues): { root: string } | { error: string } {
  const root = resolve(values.repo ?? process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return { error: `--repo ${displayPath(root)} is not a directory` };
  }
  return { root };
}

interface Perceived {
  readonly graph: NexusGraph;
  readonly ix: NexusIndex;
  readonly files: ReadonlyMap<string, string>;
}

/** One in-memory perception of the worktree — spec 05 §1.1: tree bytes in, graph out. */
function perceive(root: string): Perceived {
  const snapshot = collectTreeSnapshot(root);
  const graph = buildNexus(snapshot);
  return { graph, ix: indexNexus(graph), files: snapshotMap(snapshot) };
}

function statsLines(graph: NexusGraph): readonly string[] {
  const s = graph.stats;
  return [
    `extractor    ${graph.extractor.name}@${graph.extractor.version} (${graph.extractor.languages.join(', ')})`,
    `files        ${s.files} (${s.parsed} parsed)`,
    `definitions  ${s.definitions}`,
    `imports      ${s.imports.internal} internal, ${s.imports.external} external, ${s.imports.unresolved} unresolved`,
    `calls        ${s.calls.resolved} resolved of ${s.calls.sites} sites`,
  ];
}

function parseModuleArg(raw: string | undefined, usage: string): Parsed2<RepoPath> {
  if (raw === undefined) return { ok: false, code: 2, message: `missing <path>\n\n${usage}` };
  const p = parseRepoPath(raw);
  if (!p.ok) return { ok: false, code: 2, message: `not a repo path: ${raw} (${p.error.message})` };
  return { ok: true, value: p.value };
}

type Parsed2<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: number; readonly message: string };

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

function buildUsage(): string {
  return [
    'gwtp nexus build — perceive the worktree into a code knowledge graph (spec 05 §3, §4)',
    '',
    'Usage:',
    '  gwtp nexus build [--repo <dir>] [--json]',
    '',
    'Walks the worktree (skipping .git, node_modules, dist, coverage, .gwtp), builds the graph',
    'through passes P1-P4, and writes the canonical artifact to .gwtp/nexus/graph.json — a',
    'derived, gitignored cache: rebuildable at will, authoritative for nothing (spec 05 §1).',
    '',
    'Options:',
    '  --repo <dir>   repository root to perceive (default: cwd)',
    '  --json         machine-readable output',
    '  -h, --help     show this message',
    '',
    'Exit codes: 0 built and cached · 1 processing error · 2 usage error.',
    '',
  ].join('\n');
}

async function runBuild(argv: readonly string[]): Promise<number> {
  let values: CommonValues;
  try {
    ({ values } = parseArgs({ args: [...argv], options: COMMON_OPTIONS, allowPositionals: false, strict: true }));
  } catch (e) {
    errOut(`gwtp nexus build: ${(e as Error).message}\n\n${buildUsage()}`);
    return 2;
  }
  if (values.help === true) {
    out(buildUsage());
    return 0;
  }
  const at = repoRootOf(values);
  if ('error' in at) {
    errOut(`gwtp nexus build: ${at.error}`);
    return 2;
  }
  const { graph } = perceive(at.root);
  const doc = sealNexusDocument(graph);
  if (!doc.ok) {
    errOut(`gwtp nexus build: could not seal the artifact: ${doc.error.message}`);
    return 1;
  }
  const written = writeNexusCache(at.root, doc.value);
  if (values.json === true) {
    emitJson({
      command: 'nexus build',
      repo: at.root,
      cache: displayPath(written),
      nexus: doc.value.nexus,
      extractor: graph.extractor,
      stats: graph.stats,
      ok: true,
    });
    return 0;
  }
  out(`nexus        ${doc.value.nexus}`);
  for (const line of statsLines(graph)) out(line);
  out(`cache        ${displayPath(written)}`);
  return 0;
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function statusUsage(): string {
  return [
    'gwtp nexus status — is the cached perception the tree it claims to be? (spec 05 §4)',
    '',
    'Usage:',
    '  gwtp nexus status [--repo <dir>] [--json]',
    '',
    'Reads .gwtp/nexus/graph.json, re-perceives the worktree IN MEMORY, and compares content',
    'hashes. Staleness is answered by rebuilding, never by trusting a marker — the same posture',
    'the ledger takes toward accumulator caches (spec 02 §1.2). Nothing is written.',
    '',
    'Options:',
    '  --repo <dir>   repository root (default: cwd)',
    '  --json         machine-readable output',
    '  -h, --help     show this message',
    '',
    'Exit codes: 0 cache fresh · 1 cache missing, unreadable or stale · 2 usage error.',
    '',
  ].join('\n');
}

async function runStatus(argv: readonly string[]): Promise<number> {
  let values: CommonValues;
  try {
    ({ values } = parseArgs({ args: [...argv], options: COMMON_OPTIONS, allowPositionals: false, strict: true }));
  } catch (e) {
    errOut(`gwtp nexus status: ${(e as Error).message}\n\n${statusUsage()}`);
    return 2;
  }
  if (values.help === true) {
    out(statusUsage());
    return 0;
  }
  const at = repoRootOf(values);
  if ('error' in at) {
    errOut(`gwtp nexus status: ${at.error}`);
    return 2;
  }
  const json = values.json === true;

  const cached = readNexusCache(at.root);
  const { graph } = perceive(at.root);
  const fresh = sealNexusDocument(graph);
  if (!fresh.ok) {
    errOut(`gwtp nexus status: could not perceive the worktree: ${fresh.error.message}`);
    return 1;
  }

  let cacheState: 'missing' | 'unreadable' | 'stale' | 'fresh';
  let cachedDoc: NexusDocument | null = null;
  let cacheNote: string | null = null;
  if (cached === null) {
    cacheState = 'missing';
    cacheNote = `no cache at ${displayPath(nexusCachePath(at.root))} — run \`gwtp nexus build\``;
  } else if (!cached.ok) {
    cacheState = 'unreadable';
    cacheNote = cached.error.message;
  } else {
    cachedDoc = cached.value.doc;
    cacheState = cachedDoc.nexus === fresh.value.nexus ? 'fresh' : 'stale';
  }

  if (json) {
    emitJson({
      command: 'nexus status',
      repo: at.root,
      cache: {
        path: displayPath(nexusCachePath(at.root)),
        state: cacheState,
        ...(cachedDoc === null ? {} : { nexus: cachedDoc.nexus }),
        ...(cacheNote === null ? {} : { note: cacheNote }),
      },
      worktree: { nexus: fresh.value.nexus, stats: graph.stats },
      ok: cacheState === 'fresh',
    });
    return cacheState === 'fresh' ? 0 : 1;
  }

  out(`worktree     ${fresh.value.nexus}`);
  for (const line of statsLines(graph)) out(line);
  out('');
  if (cacheState === 'fresh') {
    out(`cache        FRESH — ${displayPath(nexusCachePath(at.root))} matches the worktree`);
    return 0;
  }
  out(`cache        ${cacheState.toUpperCase()}${cachedDoc === null ? '' : ` — cached ${cachedDoc.nexus}`}`);
  if (cacheNote !== null) out(`             ${cacheNote}`);
  else out('             re-run `gwtp nexus build` to refresh (a stale cache is a rebuild, never a repair)');
  return 1;
}

// ---------------------------------------------------------------------------
// defs / imports / importers
// ---------------------------------------------------------------------------

function moduleVerbUsage(verb: string, line1: string): string {
  return [
    `gwtp nexus ${verb} — ${line1}`,
    '',
    'Usage:',
    `  gwtp nexus ${verb} <path> [--repo <dir>] [--json]`,
    '',
    'Options:',
    '  --repo <dir>   repository root (default: cwd)',
    '  --json         machine-readable output',
    '  -h, --help     show this message',
    '',
    'Exit codes: 0 answered (an empty answer is an answer) · 1 processing error · 2 usage error.',
    '',
  ].join('\n');
}

async function runModuleVerb(
  verb: 'defs' | 'imports' | 'importers',
  argv: readonly string[],
): Promise<number> {
  const usage = moduleVerbUsage(
    verb,
    verb === 'defs'
      ? 'definitions of one module, with citable spans (spec 05 §2)'
      : verb === 'imports'
        ? 'outgoing imports of one module (spec 05 §7)'
        : 'modules that import this one (spec 05 §7)',
  );
  let values: CommonValues;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      options: COMMON_OPTIONS,
      allowPositionals: true,
      strict: true,
    }));
  } catch (e) {
    errOut(`gwtp nexus ${verb}: ${(e as Error).message}\n\n${usage}`);
    return 2;
  }
  if (values.help === true) {
    out(usage);
    return 0;
  }
  const at = repoRootOf(values);
  if ('error' in at) {
    errOut(`gwtp nexus ${verb}: ${at.error}`);
    return 2;
  }
  const arg = parseModuleArg(positionals[0], usage);
  if (!arg.ok) {
    errOut(`gwtp nexus ${verb}: ${arg.message}`);
    return arg.code;
  }
  const path = arg.value;
  const { ix } = perceive(at.root);
  if (!ix.moduleByPath.has(path)) {
    errOut(`gwtp nexus ${verb}: no module \`${path}\` in the perceived tree`);
    return 2;
  }
  const json = values.json === true;

  if (verb === 'defs') {
    const defs = definitionsIn(ix, path);
    if (json) {
      emitJson({
        command: 'nexus defs',
        path,
        definitions: defs.map((d) => ({
          name: d.name,
          form: d.form,
          span: d.span,
          exported: d.exported,
          citation: `${d.path}:${d.span.start}-${d.span.end}`,
        })),
        ok: true,
      });
      return 0;
    }
    out(`${path} — ${defs.length} definition(s)`);
    for (const d of defs) {
      out(
        `  ${d.path}:${String(d.span.start)}-${String(d.span.end)}  ${d.form}  ${d.name}${d.exported ? '  (exported)' : ''}`,
      );
    }
    return 0;
  }

  if (verb === 'imports') {
    const answers = importsOf(ix, path);
    if (json) {
      emitJson({
        command: 'nexus imports',
        path,
        imports: answers.map((a) => ({
          specifier: a.edge.specifier,
          form: a.edge.form,
          at: a.edge.at,
          target:
            a.target === null
              ? null
              : a.target.kind === 'module'
                ? { kind: 'module', path: a.target.path }
                : { kind: 'external', specifier: (a.target as { specifier: string }).specifier },
        })),
        ok: true,
      });
      return 0;
    }
    out(`${path} — ${answers.length} import(s)`);
    for (const a of answers) {
      const target =
        a.target === null
          ? '(unknown)'
          : a.target.kind === 'module'
            ? a.target.path
            : `external ${(a.target as { specifier: string }).specifier}`;
      out(`  :${a.edge.at}  ${a.edge.form.padEnd(9)}  ${a.edge.specifier}  ->  ${target}`);
    }
    return 0;
  }

  const importers = importersOf(ix, path);
  if (json) {
    emitJson({
      command: 'nexus importers',
      path,
      importers: importers.map((r) => ({ path: r.module.path, at: r.edge.at, form: r.edge.form })),
      ok: true,
    });
    return 0;
  }
  out(`${path} — imported by ${importers.length} module(s)`);
  for (const r of importers) out(`  ${r.module.path}:${r.edge.at}  (${r.edge.form})`);
  return 0;
}

// ---------------------------------------------------------------------------
// callers
// ---------------------------------------------------------------------------

function callersUsage(): string {
  return [
    'gwtp nexus callers — resolved callers of one definition (spec 03 §3\'s "nearest callers")',
    '',
    'Usage:',
    '  gwtp nexus callers <path>#<name> [--repo <dir>] [--json]',
    '  gwtp nexus callers <path>:<line> [--repo <dir>] [--json]',
    '',
    'The first form names a definition; the second finds the INNERMOST definition enclosing a',
    'line (spec 05 §2). Only PROVED calls appear — an empty answer means "none proved", not',
    '"none exist" (spec 05 §3.1 states the recall gaps).',
    '',
    'Exit codes: 0 answered · 1 processing error · 2 usage error.',
    '',
  ].join('\n');
}

async function runCallers(argv: readonly string[]): Promise<number> {
  let values: CommonValues;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      options: COMMON_OPTIONS,
      allowPositionals: true,
      strict: true,
    }));
  } catch (e) {
    errOut(`gwtp nexus callers: ${(e as Error).message}\n\n${callersUsage()}`);
    return 2;
  }
  if (values.help === true) {
    out(callersUsage());
    return 0;
  }
  const at = repoRootOf(values);
  if ('error' in at) {
    errOut(`gwtp nexus callers: ${at.error}`);
    return 2;
  }
  const ref = positionals[0];
  if (ref === undefined) {
    errOut(`gwtp nexus callers: missing <path>#<name> or <path>:<line>\n\n${callersUsage()}`);
    return 2;
  }

  const { ix } = perceive(at.root);
  let targets: readonly DefinitionNode[] = [];
  const hashAt = ref.indexOf('#');
  if (hashAt !== -1) {
    const p = parseRepoPath(ref.slice(0, hashAt));
    if (!p.ok) {
      errOut(`gwtp nexus callers: not a repo path in \`${ref}\``);
      return 2;
    }
    const name = ref.slice(hashAt + 1);
    targets = definitionsIn(ix, p.value).filter((d) => d.name === name);
  } else {
    const colonAt = ref.lastIndexOf(':');
    const line = colonAt === -1 ? Number.NaN : Number.parseInt(ref.slice(colonAt + 1), 10);
    if (!Number.isInteger(line) || line < 1) {
      errOut(`gwtp nexus callers: \`${ref}\` is neither <path>#<name> nor <path>:<line>`);
      return 2;
    }
    const p = parseRepoPath(ref.slice(0, colonAt));
    if (!p.ok) {
      errOut(`gwtp nexus callers: not a repo path in \`${ref}\``);
      return 2;
    }
    const d = enclosingDefinition(ix, p.value, line);
    targets = d === null ? [] : [d];
  }

  if (targets.length === 0) {
    errOut(`gwtp nexus callers: no definition matches \`${ref}\``);
    return 2;
  }

  const answer = targets.map((d) => ({
    definition: { name: d.name, citation: `${d.path}:${d.span.start}-${d.span.end}` },
    callers: callersOf(ix, d).map((c) => ({
      name: c.definition.name,
      at: `${c.definition.path}:${c.edge.at}`,
      span: `${c.definition.path}:${c.definition.span.start}-${c.definition.span.end}`,
    })),
  }));

  if (values.json === true) {
    emitJson({ command: 'nexus callers', ref, definitions: answer, ok: true });
    return 0;
  }
  for (const a of answer) {
    out(`${a.definition.citation}  ${a.definition.name} — ${a.callers.length} resolved caller(s)`);
    for (const c of a.callers) out(`  ${c.at}  ${c.name}  (body ${c.span})`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// seams
// ---------------------------------------------------------------------------

function seamsUsage(): string {
  return [
    'gwtp nexus seams — the import-connected partition of the tree (spec 05 §6)',
    '',
    'Usage:',
    '  gwtp nexus seams [--repo <dir>] [--json]',
    '',
    'A seam is a connected component of the undirected internal import graph — the structural',
    'answer to spec 02 §5\'s "one seam or many call sites". Seams are DERIVED and presentation-',
    'side only: they never enter the fold (spec 05 §6).',
    '',
    'Exit codes: 0 answered · 2 usage error.',
    '',
  ].join('\n');
}

async function runSeams(argv: readonly string[]): Promise<number> {
  let values: CommonValues;
  try {
    ({ values } = parseArgs({ args: [...argv], options: COMMON_OPTIONS, allowPositionals: false, strict: true }));
  } catch (e) {
    errOut(`gwtp nexus seams: ${(e as Error).message}\n\n${seamsUsage()}`);
    return 2;
  }
  if (values.help === true) {
    out(seamsUsage());
    return 0;
  }
  const at = repoRootOf(values);
  if ('error' in at) {
    errOut(`gwtp nexus seams: ${at.error}`);
    return 2;
  }
  const { ix } = perceive(at.root);
  const partition = seams(ix);
  if (values.json === true) {
    emitJson({
      command: 'nexus seams',
      seams: partition.map((s) => ({ id: s.id, size: s.members.length, members: s.members })),
      ok: true,
    });
    return 0;
  }
  out(`${partition.length} seam(s)`);
  for (const s of partition) {
    out(`  ${s.id}  (${s.members.length} module(s))`);
    if (s.members.length > 1) {
      for (const m of s.members.slice(0, 8)) out(`    ${m}`);
      if (s.members.length > 8) out(`    … ${s.members.length - 8} more`);
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// ring
// ---------------------------------------------------------------------------

const RING_OPTIONS = {
  ...COMMON_OPTIONS,
  diff: { type: 'string' },
  scope: { type: 'string', multiple: true },
} as const;

function ringUsage(): string {
  return [
    'gwtp nexus ring — what evidence each context ring would grant a diff (spec 05 §5)',
    '',
    'Usage:',
    `  gwtp nexus ring <${CONTEXT_RINGS.join('|')}> --diff <file|-> [--scope <glob>]…`,
    '',
    'The inspection half of `gwtp judge --ring`: parse a unified diff, widen it over the',
    'perceived worktree, and show exactly which hunks a judge would be shown at that ring —',
    'diff hunks as-is, granted context as `-`-free, ` `-prefixed spans no deterministic judge',
    'can mint an offence from (spec 05 §5 rule 1). --scope applies the assertion-scope filter',
    '(rule 2); repeat it for multiple globs; default is every path.',
    '',
    'Options:',
    '  --diff <file|->  the unified diff to widen; `-` reads stdin (required)',
    '  --scope <glob>   scope filter, repeatable (default: match everything)',
    '  --repo <dir>     repository root perceived for context (default: cwd)',
    '  --json           machine-readable output',
    '  -h, --help       show this message',
    '',
    'Exit codes: 0 answered · 1 processing error · 2 usage error.',
    '',
  ].join('\n');
}

async function runRing(argv: readonly string[]): Promise<number> {
  let values: CommonValues & { diff?: string | undefined; scope?: string[] | undefined };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      options: RING_OPTIONS,
      allowPositionals: true,
      strict: true,
    }));
  } catch (e) {
    errOut(`gwtp nexus ring: ${(e as Error).message}\n\n${ringUsage()}`);
    return 2;
  }
  if (values.help === true) {
    out(ringUsage());
    return 0;
  }
  const ringName = positionals[0];
  if (ringName === undefined || !(CONTEXT_RINGS as readonly string[]).includes(ringName)) {
    errOut(`gwtp nexus ring: expected one of ${CONTEXT_RINGS.join(' | ')}\n\n${ringUsage()}`);
    return 2;
  }
  const ring = ringName as ContextRing;
  if (values.diff === undefined) {
    errOut(`gwtp nexus ring: --diff <file|-> is required\n\n${ringUsage()}`);
    return 2;
  }
  const at = repoRootOf(values);
  if ('error' in at) {
    errOut(`gwtp nexus ring: ${at.error}`);
    return 2;
  }

  let diffText: string;
  if (values.diff === '-') {
    if (process.stdin.isTTY === true) {
      errOut('gwtp nexus ring: no diff on stdin — pipe a unified diff, or pass --diff <file>');
      return 2;
    }
    diffText = readFileSync(0, 'utf8');
  } else {
    const file = resolve(values.diff);
    if (!existsSync(file)) {
      errOut(`gwtp nexus ring: --diff ${displayPath(file)} does not exist`);
      return 2;
    }
    diffText = readFileSync(file, 'utf8');
  }

  const scope: PathGlob[] = [];
  for (const raw of values.scope ?? []) {
    const g = parsePathGlob(raw);
    if (!g.ok) {
      errOut(`gwtp nexus ring: ${g.error.message}`);
      return 2;
    }
    scope.push(g.value);
  }

  const base = parseUnifiedDiff(diffText);
  const { ix, files } = perceive(at.root);
  const widened = ringHunks(ix, files, base, ring);
  const offered =
    scope.length === 0 ? widened : widened.filter((h) => scope.some((g) => matchesGlob(g, h.path)));

  const rows = offered.map((h) => ({
    path: h.path,
    lines: `${h.newStart}-${h.newStart + Math.max(h.newLines, 1) - 1}`,
    kind: base.includes(h) ? 'diff' : 'context',
  }));

  if (values.json === true) {
    emitJson({
      command: 'nexus ring',
      ring,
      scope,
      hunks: rows,
      counts: { diff: rows.filter((r) => r.kind === 'diff').length, context: rows.filter((r) => r.kind === 'context').length },
      ok: true,
    });
    return 0;
  }
  out(`ring ${ring} — ${rows.length} hunk(s) offered${scope.length > 0 ? ` (scope: ${scope.join(', ')})` : ''}`);
  for (const r of rows) out(`  ${r.kind.padEnd(7)}  ${r.path}:${r.lines}`);
  return 0;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

function usage(): string {
  return [
    'gwtp nexus — the perception layer: a code knowledge graph over one tree state (spec 05)',
    '',
    'Usage:',
    '  gwtp nexus build     [--repo <dir>] [--json]',
    '  gwtp nexus status    [--repo <dir>] [--json]',
    '  gwtp nexus defs      <path> [--repo <dir>] [--json]',
    '  gwtp nexus imports   <path> [--repo <dir>] [--json]',
    '  gwtp nexus importers <path> [--repo <dir>] [--json]',
    '  gwtp nexus callers   <path>#<name> | <path>:<line> [--repo <dir>] [--json]',
    '  gwtp nexus seams     [--repo <dir>] [--json]',
    `  gwtp nexus ring      <${CONTEXT_RINGS.join('|')}> --diff <file|-> [--scope <glob>]…`,
    '',
    'The program prescribes, the ledger remembers, the nexus perceives. The graph is derived',
    'from tree bytes only, carries no authorship anywhere (spec 05 §1), and is cached under',
    '.gwtp/nexus/ — gitignored, disposable, authoritative for nothing.',
    '',
    'Run `gwtp nexus <verb> --help` for a verb\'s own options.',
    '',
    'Exit codes: 0 success · 1 processing error (or stale cache, for `status`) · 2 usage error.',
    '',
  ].join('\n');
}

export async function run(argv: readonly string[]): Promise<number> {
  const first = argv[0];
  if (first === '--help' || first === '-h') {
    out(usage());
    return 0;
  }
  if (first === undefined) {
    errOut(usage());
    return 2;
  }
  const rest = argv.slice(1);
  switch (first) {
    case 'build':
      return runBuild(rest);
    case 'status':
      return runStatus(rest);
    case 'defs':
    case 'imports':
    case 'importers':
      return runModuleVerb(first, rest);
    case 'callers':
      return runCallers(rest);
    case 'seams':
      return runSeams(rest);
    case 'ring':
      return runRing(rest);
    default:
      errOut(`gwtp nexus: unknown verb \`${first}\`\n\n${usage()}`);
      return 2;
  }
}
