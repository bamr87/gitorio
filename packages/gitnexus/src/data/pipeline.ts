export type Phase = {
  id: string;
  file: string;
  deps: string[];
  output: string;
  band: number;
  col: number;
};

export const PHASES: Phase[] = [
  { id: "scan", file: "scan.ts", deps: [], output: "File paths + sizes", band: 0, col: 1 },
  { id: "structure", file: "structure.ts", deps: ["scan"], output: "File/Folder nodes, CONTAINS, allPathSet", band: 1, col: 1 },
  { id: "springConfig", file: "spring-config.ts", deps: ["structure"], output: "Spring configuration-property nodes", band: 2, col: 0 },
  { id: "markdown", file: "markdown.ts", deps: ["structure"], output: "Section nodes + cross-links from .md/.mdx", band: 2, col: 1 },
  { id: "cobol", file: "cobol.ts", deps: ["structure"], output: "COBOL program/paragraph/section (regex, no tree-sitter)", band: 2, col: 2 },
  { id: "parse", file: "parse.ts + parse-impl.ts", deps: ["structure", "markdown", "cobol"], output: "Symbol nodes, IMPORTS/CALLS/EXTENDS, extracted routes/tools/ORM", band: 3, col: 1 },
  { id: "routes", file: "routes.ts", deps: ["parse"], output: "Route nodes + HANDLES_ROUTE", band: 4, col: 0 },
  { id: "tools", file: "tools.ts", deps: ["parse"], output: "Tool nodes + HANDLES_TOOL", band: 4, col: 1 },
  { id: "orm", file: "orm.ts", deps: ["parse"], output: "QUERIES edges (Prisma, Supabase)", band: 4, col: 2 },
  { id: "crossFile", file: "cross-file.ts", deps: ["parse", "routes", "tools", "orm"], output: "Cross-file type propagation in import order", band: 5, col: 1 },
  { id: "scopeResolution", file: "scope-resolution/pipeline/phase.ts", deps: ["parse", "crossFile", "structure"], output: "Binding/reference + inheritance edges", band: 6, col: 1 },
  { id: "springAutoConfiguration", file: "spring-auto-configuration.ts", deps: ["structure", "scopeResolution"], output: "DECLARES + CONDITIONAL_ON", band: 7, col: 0 },
  { id: "springAop", file: "spring-aop.ts", deps: ["scopeResolution"], output: "ADVISED_BY + pointcut evidence", band: 7, col: 2 },
  { id: "pruneLocalSymbols", file: "prune-local-symbols.ts", deps: ["scopeResolution"], output: "Drop inert block-local Const/Variable/Static", band: 8, col: 1 },
  { id: "mro", file: "mro.ts", deps: ["crossFile", "scopeResolution", "pruneLocalSymbols", "structure"], output: "METHOD_OVERRIDES + METHOD_IMPLEMENTS", band: 9, col: 1 },
  { id: "springAopInheritance", file: "spring-aop.ts", deps: ["springAop", "mro"], output: "Propagate advice through heritage", band: 10, col: 2 },
  { id: "di", file: "di.ts", deps: ["mro"], output: "INJECTS edges (framework-neutral)", band: 11, col: 0 },
  { id: "communities", file: "communities.ts", deps: ["mro", "pruneLocalSymbols", "structure"], output: "Community nodes + MEMBER_OF (Leiden)", band: 12, col: 1 },
  { id: "processes", file: "processes.ts", deps: ["communities", "routes", "tools", "pruneLocalSymbols", "structure"], output: "Process nodes + STEP_IN_PROCESS", band: 13, col: 1 },
];

export const PDG_PHASES = [
  { id: "taintSummaries", note: "Added with --pdg. Source→sink findings for `explain`." },
  { id: "callSummaries", note: "Added with --pdg. Intra-procedural dependence for `pdg_query`." },
];

export const RUNNER_RULES = [
  "Static phase graph. No plugins. Compile-time typed PipelinePhase<T>.",
  "Validation via Kahn topological sort. Rejects duplicate names, missing deps, cycles (DFS prints the cycle).",
  "Sequential execution in topo order. Each phase gets ctx (mutable KnowledgeGraph) and only its declared deps.",
  "getPhaseOutput<T>(deps, 'name') for type-safe upstream results.",
  "BindingAccumulator created in parse, disposed by crossFile in finally.",
  "skipGraphPhases omits MRO/di/communities/processes for faster tests. pruneLocalSymbols still runs.",
  "skipWorkers / --workers 0 / GITNEXUS_WORKER_POOL_SIZE=0 is rejected. Workers are the only parse path.",
];

export const PARSE_CHUNK = [
  "parse processes files in ~20 MB byte-budget chunks to bound memory.",
  "Worker pool dispatches files. Each worker: detect language → load grammar → run queries → ParseWorkerResult.",
  "Wildcard synthesis, then import resolution, then BindingAccumulator collection.",
  "Inheritance edges are NOT emitted during parse — scope-resolution owns them.",
  "Workers serialize ParsedFile + capture side-channel to a disk-backed store so the main thread never re-parses (tree-sitter buffers leak native memory).",
  "Warm cache-hit runs replay cached worker output without spawning workers.",
];

export const SCOPE_STAGES = [
  "ParsedFile[] via extractParsedFile per file",
  "finalizeScopeModel (+ provider hooks) → ScopeResolutionIndexes",
  "resolveReferenceSites via MethodRegistry.lookup → ReferenceIndex",
  "emitReceiverBoundCalls FIRST",
  "emitFreeCallFallback THEN",
  "emitReferencesViaLookup (handledSites + deferred skip set)",
  "emitPropertyDispatchCalls (registration USES + conservative CALLS)",
  "emitCallableValueFlow (assigned/passed callable invocation CALLS)",
  "emitImportedValueReferences",
  "emitUniqueNamePropertyAccesses LAST-RESORT",
  "emitImportEdges → KnowledgeGraph (IMPORTS / CALLS / ACCESSES / INHERITS / USES)",
];

export const IMPORT_TIERS = [
  { tier: "1 — same-file", confidence: "0.95", mechanism: "Symbol table for the caller's file" },
  { tier: "2 — import-scoped", confidence: "0.90", mechanism: "NamedImportMap chains, or all files in importMap for wildcards" },
  { tier: "3 — global", confidence: "0.50", mechanism: "O(1) class/impl/callable index. Fallback only." },
];

export const IMPORT_STRATEGIES = [
  { strategy: "named", langs: "TS, JS, Java, C#, Rust, PHP, Kotlin", behavior: "Only explicitly imported names visible" },
  { strategy: "wildcard-leaf", langs: "Go, Ruby, Swift, Dart", behavior: "Whole-package import, no transitive re-exports" },
  { strategy: "wildcard-transitive", langs: "C, C++", behavior: "#include closure chains through re-exports" },
  { strategy: "namespace", langs: "Python", behavior: "Module aliases resolved at the call site" },
];

export const MRO = [
  { strategy: "first-wins", langs: "Java, C#, C++, TS, Ruby, Go" },
  { strategy: "c3", langs: "Python (C3 linearization)" },
  { strategy: "ruby-mixin", langs: "Ruby mixin-aware linearization" },
  { strategy: "none", langs: "Single-inheritance languages" },
];

export const ROUTE_SOURCES = [
  { source: "Filesystem convention", shape: "path → URL, no parsing", examples: "Next.js app/, Expo, PHP" },
  { source: "Single-file framework route", shape: "isRouteFile + worker extraction", examples: "Laravel routes/*.php" },
  { source: "Cross-file framework route", shape: "discoverRootRouteFiles + extractRoutes", examples: "Django urlpatterns" },
  { source: "AST-level in a normal file", shape: "extractDecoratorRoutes + dispatch-guard", examples: "Spring, FastAPI, NestJS, node:http if/pathname tables" },
];

export const PDG_LAYERS = [
  { id: "M1 CFG", note: "BasicBlock nodes + CFG edges. Kind (seq/cond-true/loop-back) rides reason." },
  { id: "M2 REACHING_DEF", note: "GEN/KILL def→use. Variable name rides reason." },
  { id: "M3/M4 Taint", note: "TAINTED / SANITIZES / TAINT_PATH. Feeds `explain`." },
  { id: "M5 CDG", note: "Ferrante control dependence over CHK post-dominator tree. Skipped if EXIT unreachable." },
  { id: "M6 Read surface", note: "pdg_query mode=controls (CDG) or flows (REACHING_DEF). Always anchored + LIMIT-bounded." },
];
