export const PACKAGES = [
  {
    id: "gitnexus",
    path: "gitnexus/",
    npm: "gitnexus",
    role: "CLI, MCP stdio server, HTTP API, ingestion pipeline, LadybugDB, embeddings, wiki, groups.",
  },
  {
    id: "web",
    path: "gitnexus-web/",
    npm: "private",
    role: "Vite + React thin client. Graph explorer + AI chat. All queries via `gitnexus serve` HTTP API. Optional in-browser WASM indexer.",
  },
  {
    id: "shared",
    path: "gitnexus-shared/",
    npm: "file:../gitnexus-shared",
    role: "Shared TypeScript types, language ids, ParsedFile, capture tags. Built first.",
  },
  {
    id: "claude",
    path: "gitnexus-claude-plugin/",
    npm: "marketplace",
    role: "Static Claude Code plugin manifest + shipped skills.",
  },
  {
    id: "cursor",
    path: "gitnexus-cursor-integration/",
    npm: "static",
    role: "Cursor integration metadata.",
  },
  {
    id: "eval",
    path: "eval/",
    npm: "harness",
    role: "Python evaluation harness (Docker + LLM API) for tool-use benchmarks.",
  },
];

export const LAYERS = [
  {
    name: "Ingestion",
    path: "gitnexus/src/core/ingestion/",
    body: "19-phase DAG (21 with --pdg). scan → structure → parse → resolve → cluster → processes. Worker pool is the sole parse path.",
  },
  {
    name: "Semantic model",
    path: "gitnexus/src/core/ingestion/model/",
    body: "Authoritative symbol store (by nodeId, simpleName, qualifiedName, filePath). Mutable during parse + scope-resolution + finalize; frozen afterward.",
  },
  {
    name: "Scope resolution",
    path: "gitnexus/src/core/ingestion/scope-resolution/",
    body: "Language-agnostic CALLS / ACCESSES / USES / INHERITS emission. Each language implements ScopeResolver and registers in SCOPE_RESOLVERS.",
  },
  {
    name: "Persistence",
    path: "gitnexus/src/core/lbug/",
    body: "LadybugDB adapter. Separate node tables, single CodeRelation table. CSV streaming load. FTS indexes. Optional Embedding table.",
  },
  {
    name: "Search",
    path: "gitnexus/src/core/search/",
    body: "Hybrid BM25 + 384D vectors, merged with Reciprocal Rank Fusion (K=60).",
  },
  {
    name: "Query backends",
    path: "gitnexus/src/mcp/ + src/cli/ + src/server/",
    body: "LocalBackend implements tools and resources. MCP stdio, Express HTTP, and CLI commands are three faces of the same code.",
  },
  {
    name: "Groups",
    path: "gitnexus/src/core/group/",
    body: "Contract registry + bridge graph. Cross-repo impact and trace hop a single ContractLink (MAX_SUPPORTED_CROSS_DEPTH = 1).",
  },
];

export const FLOWS = [
  {
    title: "Index → graph → tools",
    steps: [
      "CLI `analyze.ts` → `runFullAnalysis` (`run-analyze.ts`) → `runPipelineFromRepo` (`pipeline.ts`).",
      "19 phases build an in-memory KnowledgeGraph.",
      "Graph streams into LadybugDB under `<repo>/.gitnexus/`.",
      "Repo registered in `~/.gitnexus/registry.json`.",
      "MCP / HTTP / CLI open the DB lazily via LocalBackend.",
    ],
  },
  {
    title: "Full analysis percentages",
    steps: [
      "0% — skip if lastCommit == HEAD unless --force; cache prior embeddings.",
      "0–60% — pipeline DAG.",
      "60% — drop legacy KuzuDB files.",
      "60–85% — initLbug + CSV load.",
      "85–90% — FTS indexes (File, Function, Class, Method…).",
      "88–98% — restore then generate embeddings if --embeddings.",
      "98–100% — metadata, registry, .gitignore, AGENTS.md / CLAUDE.md / skills.",
    ],
  },
  {
    title: "Query path",
    steps: [
      "MCP stdio: `mcp.ts` → LocalBackend → tools.ts + resources.ts.",
      "HTTP: `serve.ts` → Express `api.ts` / `mcp-http.ts`.",
      "CLI: `gitnexus query|context|impact|cypher` in `tool.ts`.",
      "Staleness: `staleness.ts` compares indexed lastCommit to HEAD.",
    ],
  },
];

export const WHERE_TO_CHANGE = [
  { concern: "CLI commands / flags", start: "gitnexus/src/cli/ (index.ts + per-command modules)" },
  { concern: "Parsing / graph construction", start: "src/core/ingestion/pipeline-phases/ + pipeline.ts" },
  { concern: "Graph schema / DB", start: "src/core/lbug/ (schema.ts, lbug-adapter.ts)" },
  { concern: "MCP tools / resources", start: "src/mcp/server.ts, tools.ts, resources.ts" },
  { concern: "Cross-repo groups", start: "src/core/group/ (service, cross-impact, sync, bridge-db)" },
  { concern: "Search ranking", start: "src/core/search/" },
  { concern: "Embeddings", start: "src/core/embeddings/ + run-analyze.ts" },
  { concern: "Wiki generation", start: "src/core/wiki/" },
  { concern: "Language support", start: "ingestion/languages/ + tree-sitter-queries.ts + gitnexus-shared/src/languages.ts" },
  { concern: "Import resolution", start: "import-processor.ts + import-resolvers/configs/ + model/resolution-context.ts" },
  { concern: "Call / inheritance / MRO", start: "ingestion/scope-resolution/" },
  { concern: "Type extraction", start: "ingestion/type-extractors/" },
  { concern: "Worker pool", start: "ingestion/workers/" },
  { concern: "Web UI", start: "gitnexus-web/src/" },
  { concern: "CI", start: ".github/workflows + .github/actions/" },
];

export const STORAGE = {
  repo: [
    { path: ".gitnexus/lbug", note: "LadybugDB database" },
    { path: ".gitnexus/lbug.wal", note: "Write-ahead log" },
    { path: ".gitnexus/lbug.shadow", note: "Checkpoint staging" },
    { path: ".gitnexus/lbug.lock", note: "Single-writer lock" },
    { path: ".gitnexus/gitnexus.json", note: "lastCommit, indexedAt, stats" },
    { path: ".gitnexus/meta.json", note: "Legacy mirror, kept in sync" },
  ],
  global: [{ path: "~/.gitnexus/registry.json", note: "Global repo registry for MCP discovery" }],
};

export const ABSTRACTION_STACK = [
  "Unified graph schema — 31 node tables, 28 relation types (+ PDG opt-in)",
  "Scope-resolution pipeline — registry lookup, 3-tier import resolution, MRO",
  "Language providers — import semantics, type config, export checker, MRO strategy",
  "Tree-sitter queries — per-language S-expressions, unified capture tags",
];
