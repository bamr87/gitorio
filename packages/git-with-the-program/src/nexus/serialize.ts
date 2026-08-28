// Implements: docs/spec/05-nexus.md §4 (storage and interchange: the artifact is `nexus` +
// `extractor` + `stats` + `nodes` + `edges` and DELIBERATELY nothing else — no timestamp, no
// host path, no builder identity) and §3 (the self-addressing discipline: `nexus` is the
// content hash of the canonical body MINUS that field, mirroring ledger events, spec 02 §1 /
// Q-24). Validates against schemas/nexus.schema.json; tests/nexus/serialize.test.ts holds the
// two implementations of that contract (this file and the schema) against each other with ajv.

import { type CanonicalObject, type CanonicalValue, contentHash } from '../core/canonical.js';
import { type Sha256Ref, parseSha256Ref } from '../core/ids.js';
import type { RepoPath } from '../core/paths.js';
import { fail, ok, type Parsed } from '../core/result.js';
import type {
  NexusEdge,
  NexusExtractor,
  NexusGraph,
  NexusNode,
  NexusNodeId,
  NexusStats,
} from './types.js';

export const NEXUS_SCHEMA_ID = 'gwtp/nexus.schema.json';

/** The stored artifact: the graph plus its own address. */
export interface NexusDocument {
  readonly nexus: Sha256Ref;
  readonly extractor: NexusExtractor;
  readonly stats: NexusStats;
  readonly nodes: readonly NexusNode[];
  readonly edges: readonly NexusEdge[];
}

// ---------------------------------------------------------------------------
// Canonical body and hash (spec 05 §3)
// ---------------------------------------------------------------------------

function canonicalNode(n: NexusNode): CanonicalObject {
  switch (n.kind) {
    case 'directory':
      return { id: n.id, kind: n.kind, path: n.path };
    case 'module':
      return {
        id: n.id,
        kind: n.kind,
        path: n.path,
        language: n.language,
        parsed: n.parsed,
        lines: n.lines,
      };
    case 'definition':
      return {
        id: n.id,
        kind: n.kind,
        path: n.path,
        name: n.name,
        form: n.form,
        span: { start: n.span.start, end: n.span.end },
        exported: n.exported,
      };
    case 'external':
      return { id: n.id, kind: n.kind, specifier: n.specifier };
  }
}

function canonicalEdge(e: NexusEdge): CanonicalObject {
  switch (e.kind) {
    case 'contains':
    case 'defines':
      return { kind: e.kind, from: e.from, to: e.to };
    case 'imports':
      return { kind: e.kind, from: e.from, to: e.to, specifier: e.specifier, form: e.form, at: e.at };
    case 'calls':
      return { kind: e.kind, from: e.from, to: e.to, resolution: e.resolution, at: e.at };
    case 'extends':
    case 'implements':
      return { kind: e.kind, from: e.from, to: e.to, at: e.at };
  }
}

/** The canonical body the `nexus` field addresses — everything but the field itself. */
export function canonicalNexusBody(graph: NexusGraph): CanonicalValue {
  return {
    extractor: {
      name: graph.extractor.name,
      version: graph.extractor.version,
      languages: [...graph.extractor.languages],
    },
    stats: {
      files: graph.stats.files,
      parsed: graph.stats.parsed,
      definitions: graph.stats.definitions,
      imports: {
        internal: graph.stats.imports.internal,
        external: graph.stats.imports.external,
        unresolved: graph.stats.imports.unresolved,
      },
      calls: { resolved: graph.stats.calls.resolved, sites: graph.stats.calls.sites },
    },
    nodes: graph.nodes.map(canonicalNode),
    edges: graph.edges.map(canonicalEdge),
  };
}

/** The artifact's address: contentHash over the canonical body (spec 05 §3). */
export function nexusHash(graph: NexusGraph): Parsed<Sha256Ref> {
  return contentHash(canonicalNexusBody(graph));
}

export function sealNexusDocument(graph: NexusGraph): Parsed<NexusDocument> {
  const h = nexusHash(graph);
  if (!h.ok) return h;
  return ok({
    nexus: h.value,
    extractor: graph.extractor,
    stats: graph.stats,
    nodes: graph.nodes,
    edges: graph.edges,
  });
}

/**
 * The stored bytes: pretty JSON with the key order this module writes, `nexus` first (the one
 * key the canonical body cannot contain, exactly as ledger events put `event:` first —
 * Q-48's rule). The HASH never depends on these bytes; re-encoding is always safe.
 */
export function encodeNexusDocument(doc: NexusDocument): string {
  return `${JSON.stringify(
    {
      nexus: doc.nexus,
      extractor: doc.extractor,
      stats: doc.stats,
      nodes: doc.nodes.map(canonicalNode),
      edges: doc.edges.map(canonicalEdge),
    },
    null,
    2,
  )}\n`;
}

// ---------------------------------------------------------------------------
// Reading a stored artifact back
// ---------------------------------------------------------------------------

const NODE_KINDS = new Set(['directory', 'module', 'definition', 'external']);
const EDGE_KINDS = new Set(['contains', 'defines', 'imports', 'calls', 'extends', 'implements']);
const DEF_FORMS = new Set(['function', 'class', 'method', 'interface', 'type-alias', 'enum', 'const']);
const IMPORT_FORMS = new Set(['value', 'type-only', 'dynamic', 're-export']);
const RESOLUTIONS = new Set(['same-file', 'imported']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/**
 * Structural decode of a stored artifact. ajv against schemas/nexus.schema.json stays the
 * authoritative INV-006-style validator (the Q-29 split, applied here); this decoder is the
 * engine-side reader: strict enough that no later pass can be surprised, and it REJECTS
 * rather than repairs — a cache that cannot be read is rebuilt, never trusted (spec 05 §4).
 */
export function decodeNexusDocument(raw: unknown): Parsed<NexusDocument> {
  if (!isRecord(raw)) return fail('wrong-type', 'expected a nexus artifact object');
  const nexus = parseSha256Ref(raw['nexus'], '/nexus');
  if (!nexus.ok) return nexus;

  const ex = raw['extractor'];
  if (
    !isRecord(ex) ||
    typeof ex['name'] !== 'string' ||
    typeof ex['version'] !== 'string' ||
    !Array.isArray(ex['languages']) ||
    !ex['languages'].every((l) => typeof l === 'string')
  ) {
    return fail('wrong-type', 'malformed extractor', '/extractor');
  }

  const st = raw['stats'];
  const imports = isRecord(st) ? st['imports'] : undefined;
  const calls = isRecord(st) ? st['calls'] : undefined;
  if (
    !isRecord(st) ||
    !nonNegInt(st['files']) ||
    !nonNegInt(st['parsed']) ||
    !nonNegInt(st['definitions']) ||
    !isRecord(imports) ||
    !nonNegInt(imports['internal']) ||
    !nonNegInt(imports['external']) ||
    !nonNegInt(imports['unresolved']) ||
    !isRecord(calls) ||
    !nonNegInt(calls['resolved']) ||
    !nonNegInt(calls['sites'])
  ) {
    return fail('wrong-type', 'malformed stats', '/stats');
  }
  const stats: NexusStats = {
    files: st['files'],
    parsed: st['parsed'],
    definitions: st['definitions'],
    imports: {
      internal: imports['internal'],
      external: imports['external'],
      unresolved: imports['unresolved'],
    },
    calls: { resolved: calls['resolved'], sites: calls['sites'] },
  };

  if (!Array.isArray(raw['nodes'])) return fail('wrong-type', 'nodes must be an array', '/nodes');
  const nodes: NexusNode[] = [];
  for (let i = 0; i < raw['nodes'].length; i += 1) {
    const n = raw['nodes'][i];
    const at = `/nodes/${i}`;
    if (!isRecord(n) || typeof n['id'] !== 'string' || typeof n['kind'] !== 'string') {
      return fail('wrong-type', 'malformed node', at);
    }
    if (!NODE_KINDS.has(n['kind'])) return fail('invalid-enum', `unknown node kind ${String(n['kind'])}`, at);
    const id = n['id'] as NexusNodeId;
    switch (n['kind']) {
      case 'directory': {
        if (typeof n['path'] !== 'string') return fail('missing-field', 'directory.path', at);
        nodes.push({ id, kind: 'directory', path: n['path'] as RepoPath });
        break;
      }
      case 'module': {
        if (
          typeof n['path'] !== 'string' ||
          typeof n['parsed'] !== 'boolean' ||
          !nonNegInt(n['lines']) ||
          !(n['language'] === null || n['language'] === 'typescript' || n['language'] === 'javascript')
        ) {
          return fail('wrong-type', 'malformed module node', at);
        }
        nodes.push({
          id,
          kind: 'module',
          path: n['path'] as RepoPath,
          language: n['language'],
          parsed: n['parsed'],
          lines: n['lines'],
        });
        break;
      }
      case 'definition': {
        const span = n['span'];
        if (
          typeof n['path'] !== 'string' ||
          typeof n['name'] !== 'string' ||
          typeof n['form'] !== 'string' ||
          !DEF_FORMS.has(n['form']) ||
          typeof n['exported'] !== 'boolean' ||
          !isRecord(span) ||
          !nonNegInt(span['start']) ||
          !nonNegInt(span['end'])
        ) {
          return fail('wrong-type', 'malformed definition node', at);
        }
        nodes.push({
          id,
          kind: 'definition',
          path: n['path'] as RepoPath,
          name: n['name'],
          form: n['form'] as never,
          span: { start: span['start'], end: span['end'] },
          exported: n['exported'],
        });
        break;
      }
      case 'external': {
        if (typeof n['specifier'] !== 'string') return fail('missing-field', 'external.specifier', at);
        nodes.push({ id, kind: 'external', specifier: n['specifier'] });
        break;
      }
      default:
        return fail('invalid-enum', 'unreachable node kind', at);
    }
  }

  if (!Array.isArray(raw['edges'])) return fail('wrong-type', 'edges must be an array', '/edges');
  const edges: NexusEdge[] = [];
  for (let i = 0; i < raw['edges'].length; i += 1) {
    const e = raw['edges'][i];
    const at = `/edges/${i}`;
    if (
      !isRecord(e) ||
      typeof e['kind'] !== 'string' ||
      typeof e['from'] !== 'string' ||
      typeof e['to'] !== 'string'
    ) {
      return fail('wrong-type', 'malformed edge', at);
    }
    if (!EDGE_KINDS.has(e['kind'])) return fail('invalid-enum', `unknown edge kind ${String(e['kind'])}`, at);
    const from = e['from'] as NexusNodeId;
    const to = e['to'] as NexusNodeId;
    switch (e['kind']) {
      case 'contains':
      case 'defines':
        edges.push({ kind: e['kind'], from, to });
        break;
      case 'imports': {
        if (
          typeof e['specifier'] !== 'string' ||
          typeof e['form'] !== 'string' ||
          !IMPORT_FORMS.has(e['form']) ||
          !nonNegInt(e['at'])
        ) {
          return fail('wrong-type', 'malformed imports edge', at);
        }
        edges.push({ kind: 'imports', from, to, specifier: e['specifier'], form: e['form'] as never, at: e['at'] });
        break;
      }
      case 'calls': {
        if (typeof e['resolution'] !== 'string' || !RESOLUTIONS.has(e['resolution']) || !nonNegInt(e['at'])) {
          return fail('wrong-type', 'malformed calls edge', at);
        }
        edges.push({ kind: 'calls', from, to, resolution: e['resolution'] as never, at: e['at'] });
        break;
      }
      case 'extends':
      case 'implements': {
        if (!nonNegInt(e['at'])) return fail('wrong-type', 'malformed heritage edge', at);
        edges.push({ kind: e['kind'], from, to, at: e['at'] });
        break;
      }
      default:
        return fail('invalid-enum', 'unreachable edge kind', at);
    }
  }

  return ok({
    nexus: nexus.value,
    extractor: { name: ex['name'], version: ex['version'], languages: ex['languages'] as string[] },
    stats,
    nodes,
    edges,
  });
}

/**
 * Tamper / staleness evidence: does the document's `nexus` field hash its own body? A
 * mismatch is a rebuild signal, never something to repair in place (spec 05 §4).
 */
export function verifyNexusDocument(doc: NexusDocument): Parsed<true> {
  const h = nexusHash({
    extractor: doc.extractor,
    stats: doc.stats,
    nodes: doc.nodes,
    edges: doc.edges,
  });
  if (!h.ok) return h;
  if (h.value !== doc.nexus) {
    return fail('hash-mismatch', `stored ${doc.nexus} != recomputed ${h.value}`, '/nexus');
  }
  return ok(true);
}
