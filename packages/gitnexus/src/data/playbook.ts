export type Task = {
  id: string;
  title: string;
  doneHint: string;
};

export type Milestone = {
  id: string;
  phase: string;
  title: string;
  goal: string;
  depends: string[];
  files: string[];
  tasks: Task[];
};

export const PLAYBOOK: Milestone[] = [
  {
    id: "m0",
    phase: "M0",
    title: "Monorepo skeleton",
    goal: "Three packages compile. Shared is built first. Node engine pinned. Lint/format/husky live.",
    depends: [],
    files: [
      "package.json (workspaces)",
      "gitnexus/package.json",
      "gitnexus-web/package.json",
      "gitnexus-shared/package.json + tsconfig",
      "eslint.config.mjs",
      ".husky/pre-commit",
    ],
    tasks: [
      { id: "m0-ws", title: "Create gitnexus, gitnexus-web, gitnexus-shared with TypeScript project references.", doneHint: "tsc -b at root typechecks all three." },
      { id: "m0-eng", title: "Pin engines.node to ^22.18.0 || >=24.11.0 on the CLI package.", doneHint: "package.json engines set." },
      { id: "m0-lint", title: "Prettier + ESLint + husky lint-staged on ts/tsx.", doneHint: "Pre-commit formats staged files." },
    ],
  },
  {
    id: "m1",
    phase: "M1",
    title: "Shared contracts",
    goal: "SupportedLanguages, capture tags, ParsedFile, node/edge unions live in gitnexus-shared. CLI and web import them directly — no barrel re-exports that hide drift.",
    depends: ["m0"],
    files: [
      "gitnexus-shared/src/languages.ts",
      "gitnexus-shared/src/scope-resolution/parsed-file.ts",
      "gitnexus-shared/src/graph-types.ts",
    ],
    tasks: [
      { id: "m1-lang", title: "Define SupportedLanguages and extension maps.", doneHint: "Adding a language without a provider is a compile error later in M3." },
      { id: "m1-pf", title: "Specify ParsedFile (defs, refs, imports, callable sites, receiverChain v2).", doneHint: "JSON-serializable — workers must be able to postMessage it." },
      { id: "m1-rel", title: "Union of node table names and relation types including PDG opt-in set.", doneHint: "VALID_RELATION_TYPES excludes PDG by default." },
    ],
  },
  {
    id: "m2",
    phase: "M2",
    title: "In-memory KnowledgeGraph",
    goal: "A graph accumulator with typed addNode/addEdge, by-type iteration, and CSV dump. No DB yet.",
    depends: ["m1"],
    files: ["gitnexus/src/core/graph/"],
    tasks: [
      { id: "m2-kg", title: "Implement KnowledgeGraph with Map storage and iterRelationshipsByType.", doneHint: "Unit tests: idempotent ids, type filters." },
      { id: "m2-csv", title: "CSV serializers matching LadybugDB COPY format (one file per node table + relations).", doneHint: "Round-trip fixture in tests." },
    ],
  },
  {
    id: "m3",
    phase: "M3",
    title: "LanguageProvider + TS/JS parse workers",
    goal: "Worker pool is the only parse path. TypeScript and JavaScript extract unified captures into ParsedFile.",
    depends: ["m1"],
    files: [
      "ingestion/language-provider.ts",
      "ingestion/languages/typescript/",
      "ingestion/workers/worker-pool.ts",
      "ingestion/workers/parse-worker.ts",
      "tree-sitter-queries.ts",
    ],
    tasks: [
      { id: "m3-lp", title: "LanguageProvider interface + TS/JS implementations.", doneHint: "Query captures @definition.* @call.name @import.source @reference.inherits." },
      { id: "m3-pool", title: "Worker pool with byte-budget chunks (~20 MB). Reject workers=0.", doneHint: "Actionable error if GITNEXUS_WORKER_POOL_SIZE=0." },
      { id: "m3-store", title: "Disk-backed ParsedFile store so the main thread never re-parses.", doneHint: "Large-fixture test does not grow native RSS unboundedly." },
    ],
  },
  {
    id: "m4",
    phase: "M4",
    title: "Pipeline DAG runner + scan/structure/parse",
    goal: "Typed phase runner with Kahn validation. Three root phases produce File/Folder/symbol nodes.",
    depends: ["m2", "m3"],
    files: [
      "ingestion/pipeline.ts",
      "ingestion/pipeline-phases/runner.ts",
      "ingestion/pipeline-phases/scan.ts",
      "ingestion/pipeline-phases/structure.ts",
      "ingestion/pipeline-phases/parse.ts",
    ],
    tasks: [
      { id: "m4-run", title: "runner.ts: topo sort, cycle error with path, typed getPhaseOutput.", doneHint: "Cycle A→B→C→A fails with that path." },
      { id: "m4-scan", title: "scan + structure honor .gitignore / ignore library. CONTAINS edges.", doneHint: "node_modules absent from graph." },
      { id: "m4-parse", title: "parse phase consumes worker results, synthesizes wildcard bindings.", doneHint: "A TS file yields Function/Class/Method nodes with DEFINES." },
    ],
  },
  {
    id: "m5",
    phase: "M5",
    title: "Scope resolution (TS/JS)",
    goal: "CALLS, IMPORTS, EXTENDS/IMPLEMENTS, ACCESSES, USES emitted through the language-agnostic pipeline.",
    depends: ["m4"],
    files: [
      "scope-resolution/contract/scope-resolver.ts",
      "scope-resolution/pipeline/run.ts",
      "scope-resolution/pipeline/registry.ts",
      "scope-resolution/passes/*.ts",
      "languages/typescript/scope-resolver.ts",
    ],
    tasks: [
      { id: "m5-sr", title: "Implement ScopeResolver for TypeScript/JavaScript and register it.", doneHint: "Cross-file named import call resolves with confidence 0.9." },
      { id: "m5-ord", title: "Emit receiver-bound calls before free-call fallback before unique-name last resort.", doneHint: "Tests lock emit order." },
      { id: "m5-ep", title: "Record unresolved in-program receivers. impact/context later read epistemic bounds.", doneHint: "svc.getUser().x on an in-graph type increments the census." },
    ],
  },
  {
    id: "m6",
    phase: "M6",
    title: "Routes, communities, processes",
    goal: "A Next.js/Express fixture produces Route + HANDLES_ROUTE, Leiden communities, and Process flows from those entries.",
    depends: ["m5"],
    files: [
      "pipeline-phases/routes.ts",
      "route-extractors/",
      "pipeline-phases/communities.ts",
      "pipeline-phases/processes.ts",
      "pipeline-phases/prune-local-symbols.ts",
      "pipeline-phases/mro.ts",
    ],
    tasks: [
      { id: "m6-rt", title: "Filesystem + decorator + dispatch-guard extractors. Drop unproven paths.", doneHint: "if (method==='GET' && pathname==='/api/x') becomes a Route. startsWith does not." },
      { id: "m6-ld", title: "Leiden communities → Community + MEMBER_OF.", doneHint: "Non-trivial fixture yields >1 community." },
      { id: "m6-pr", title: "Processes from routes/tools/mains with STEP_IN_PROCESS.", doneHint: "context on a handler lists the process." },
    ],
  },
  {
    id: "m7",
    phase: "M7",
    title: "LadybugDB persistence + registry",
    goal: "Pipeline output lands in <repo>/.gitnexus/lbug. Repo appears in ~/.gitnexus/registry.json. FTS indexes exist.",
    depends: ["m2", "m6"],
    files: [
      "core/lbug/schema.ts",
      "core/lbug/lbug-adapter.ts",
      "core/repo-manager.ts",
      "core/run-analyze.ts",
    ],
    tasks: [
      { id: "m7-sch", title: "schema.ts: one table per node type, single CodeRelation, optional BasicBlock.", doneHint: "Cypher MATCH (f:Function) RETURN count(f) works." },
      { id: "m7-load", title: "CSV streaming load + FTS on File/Function/Class/Method.", doneHint: "analyze on a fixture, then reopen the DB in a new process." },
      { id: "m7-reg", title: "registry.json write, lastCommit skip unless --force, .gitignore update.", doneHint: "Second analyze no-ops when HEAD matches." },
    ],
  },
  {
    id: "m8",
    phase: "M8",
    title: "Search + embeddings",
    goal: "query returns fused BM25 + vector hits. Embeddings opt-in and incremental.",
    depends: ["m7"],
    files: ["core/search/", "core/embeddings/", "cli/embeddings.ts"],
    tasks: [
      { id: "m8-bm", title: "BM25 over FTS with kind filters.", doneHint: "query 'save user' hits Repo.save." },
      { id: "m8-em", title: "arctic-embed-xs 384D, SHA1 cache, skip >50k nodes.", doneHint: "--embeddings on a tiny repo writes Embedding rows; second run restores them." },
      { id: "m8-rrf", title: "RRF K=60 fusion.", doneHint: "Hybrid ranking beats BM25-only on a labeled fixture." },
    ],
  },
  {
    id: "m9",
    phase: "M9",
    title: "LocalBackend + MCP + CLI tools",
    goal: "stdio MCP server exposes list_repos, query, context, impact, trace, cypher. CLI mirrors them.",
    depends: ["m7", "m8"],
    files: [
      "mcp/server.ts",
      "mcp/tools.ts",
      "mcp/resources.ts",
      "mcp/local/local-backend.ts",
      "cli/mcp.ts",
      "cli/tool.ts",
      "cli/index.ts",
    ],
    tasks: [
      { id: "m9-be", title: "LocalBackend with lazy DB open + connection pool.", doneHint: "Two concurrent context calls share the pool." },
      { id: "m9-tools", title: "Implement the core 8 tools with zod input schemas.", doneHint: "MCP inspector lists them; impact returns callers." },
      { id: "m9-res", title: "Resources: repos, setup, context, schema at minimum.", doneHint: "Read gitnexus://repos returns the fixture." },
    ],
  },
  {
    id: "m10",
    phase: "M10",
    title: "CLI product surface",
    goal: "analyze, setup, mcp, serve, list, status, clean, doctor work end-to-end.",
    depends: ["m9"],
    files: ["cli/analyze.ts", "cli/setup.ts", "cli/serve.ts", "cli/status.ts", "cli/doctor.ts", "editor-targets.ts"],
    tasks: [
      { id: "m10-an", title: "analyze flags: --force --embeddings --skills --skip-git --workers --verbose.", doneHint: "commander help matches the spec." },
      { id: "m10-su", title: "setup writes MCP config for Claude Code and Cursor.", doneHint: "A dry-run prints the files it would write." },
      { id: "m10-sv", title: "serve starts Express with the same LocalBackend.", doneHint: "GET /api/repos returns the registry." },
    ],
  },
  {
    id: "m11",
    phase: "M11",
    title: "Web explorer",
    goal: "Thin React client: graph canvas, symbol pane, chat against the HTTP API. WASM indexer is a later stretch.",
    depends: ["m10"],
    files: ["gitnexus-web/src/App.tsx", "components/graph/", "services/api.ts"],
    tasks: [
      { id: "m11-api", title: "HTTP client for repos, subgraph, query, context.", doneHint: "Opening the UI against gitnexus serve shows the fixture graph." },
      { id: "m11-sig", title: "Sigma.js + Graphology render with kind colors and cluster layout.", doneHint: "Click a node opens context." },
      { id: "m11-chat", title: "LangChain ReAct loop calling the same tools over HTTP.", doneHint: "A prompt 'who calls save?' returns impact/context output." },
    ],
  },
  {
    id: "m12",
    phase: "M12",
    title: "Languages beyond TS/JS",
    goal: "Python, then Java/Go/Rust. Each is a provider + resolver. Shared code stays language-neutral.",
    depends: ["m5"],
    files: ["ingestion/languages/python/", "csharp/", "go/", "rust/", "java/"],
    tasks: [
      { id: "m12-py", title: "Python ScopeResolver with namespace imports and C3 MRO.", doneHint: "Django-style fixture resolves a view → service CALLS." },
      { id: "m12-more", title: "Add Go (wildcard-leaf) and Java (named + Spring hooks later).", doneHint: "languages/index.ts satisfies Record<SupportedLanguages, LanguageProvider>." },
    ],
  },
  {
    id: "m13",
    phase: "M13",
    title: "Groups, PDG, wiki, skills",
    goal: "Cross-repo contracts, optional PDG, wiki command, shipped agent skills.",
    depends: ["m9", "m10"],
    files: ["core/group/", "ingestion/cfg/", "core/wiki/", "gitnexus/skills/", "cli/skill-gen.ts"],
    tasks: [
      { id: "m13-gr", title: "group create/add/sync + @group routing on query/impact/trace.", doneHint: "Two-repo fixture traces across one CONTRACT_LINK." },
      { id: "m13-pdg", title: "TS/JS cfgVisitor, --pdg layers, explain + pdg_query.", doneHint: "Default graph without --pdg is byte-identical to pre-flag." },
      { id: "m13-sk", title: "Ship explore/debug/impact/plan/work/review/lfg skills. Generate cluster skills with --skills.", doneHint: "shipped-skills-sync test passes." },
    ],
  },
];
