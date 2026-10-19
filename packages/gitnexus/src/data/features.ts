import type { FeatureLayer, FeatureStatus } from "./types";

export type Feature = {
  id: string;
  name: string;
  layer: FeatureLayer;
  status: FeatureStatus;
  summary: string;
  details: string[];
};

export const FEATURES: Feature[] = [
  {
    id: "index",
    name: "Repository indexing",
    layer: "ingestion",
    status: "core",
    summary: "Walk a git repo or folder, honor ignore rules, emit File/Folder nodes, parse every supported source file through the worker pool.",
    details: [
      "`gitnexus analyze [path]` is the entry. `--force` rebuilds even if HEAD matches lastCommit.",
      "Workers are mandatory. Chunked ~20 MB to bound RAM. Disk-backed ParsedFile store for large repos (Linux kernel class).",
      "`--skip-git` indexes without reading git metadata. `--default-branch` pins the branch name stored in the registry.",
    ],
  },
  {
    id: "ast",
    name: "Tree-sitter AST extraction",
    layer: "ingestion",
    status: "core",
    summary: "Per-language S-expression queries produce unified capture tags. Downstream extractors never switch on language names.",
    details: [
      "Native tree-sitter in CLI, WASM in the browser.",
      "Optional grammars (Dart, Proto, Swift, Kotlin) skippable via GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1.",
      "COBOL is regex-only — no tree-sitter, ScopeResolver in callable-flow-only mode.",
    ],
  },
  {
    id: "resolve",
    name: "Import, call, and heritage resolution",
    layer: "ingestion",
    status: "core",
    summary: "3-tier import resolution, receiver-bound then free-call emission, MRO, interface-dispatch with generic-instantiation awareness.",
    details: [
      "ScopeResolver hooks: populateOwners, buildMro, resolveImportTarget, arityCompatibility, elementTypeOf, stripTypePreservingDecoration.",
      "Callable-value flow is language-neutral inclusion analysis. Cap 32 targets. No partial CALLS on exhaustion.",
      "Unresolved in-program receivers are counted and published as epistemic: exact | lower-bound on impact/context.",
    ],
  },
  {
    id: "routes",
    name: "Route extraction",
    layer: "ingestion",
    status: "core",
    summary: "Four independent sources converge on a (method, url) registry: filesystem convention, single-file framework, cross-file framework, AST/dispatch-guard.",
    details: [
      "Next.js app/, Expo, PHP, Laravel, Django, Spring, FastAPI, NestJS, raw node:http dispatch tables.",
      "Precision-weighted: startsWith namespace tests, verb-less pathname === '/', and untranslatable regex are dropped.",
      "Same-file constant folding (one alias hop, string literals only) to keep template paths.",
    ],
  },
  {
    id: "clusters",
    name: "Leiden communities",
    layer: "graph",
    status: "core",
    summary: "Functional clusters via Leiden on the resolved graph. Community nodes + MEMBER_OF. Feeds generated skills and the clusters resource.",
    details: ["graphology + leiden. Cohesion scores exposed on gitnexus://repo/{name}/clusters."],
  },
  {
    id: "processes",
    name: "Execution processes",
    layer: "graph",
    status: "core",
    summary: "Walk from entry points (routes, tools, mains) to produce Process nodes and STEP_IN_PROCESS edges.",
    details: ["Surfaced as gitnexus://repo/{name}/processes and in the `context` tool."],
  },
  {
    id: "search",
    name: "Hybrid search",
    layer: "search",
    status: "core",
    summary: "BM25 full-text over FTS tables plus 384D arctic-embed-xs vectors, fused with RRF K=60.",
    details: [
      "Embeddings opt-in (`--embeddings`), skipped above ~50k nodes, incremental by SHA1.",
      "Embeddable kinds: File, Function, Class, Method, Interface.",
      "Group-mode query merges per-repo lists with RRF.",
    ],
  },
  {
    id: "mcp-tools",
    name: "MCP tool surface",
    layer: "mcp",
    status: "core",
    summary: "17 tools over stdio. Same LocalBackend as HTTP and CLI. Per-repo tools accept repo, branch, maxTokens.",
    details: ["See MCP Surface. Resources and two prompts (detect_impact, generate_map) ship alongside tools."],
  },
  {
    id: "impact",
    name: "Blast-radius impact",
    layer: "mcp",
    status: "core",
    summary: "Upstream/downstream walk with risk summary, confidence, epistemic bounds.",
    details: [
      "direction, minConfidence, maxDepth, relationTypes, includeTests, summaryOnly.",
      "Group mode: local walk then Contract Bridge fan-out (MAX_SUPPORTED_CROSS_DEPTH = 1).",
      "HIGH/CRITICAL blocks agent edits. UNKNOWN requires human confirmation.",
    ],
  },
  {
    id: "rename",
    name: "Graph-assisted rename",
    layer: "mcp",
    status: "core",
    summary: "Multi-file rename using graph occurrences, with dry_run preview. Agents must not find-and-replace.",
    details: ["Parameters: symbol_name, new_name, dry_run, repo, branch."],
  },
  {
    id: "detect",
    name: "detect_changes",
    layer: "mcp",
    status: "core",
    summary: "Map a git diff to affected symbols and processes. Required before commit in agent skills.",
    details: ["scope, git_ref / base_ref. scope: compare for regression review."],
  },
  {
    id: "api",
    name: "API intelligence",
    layer: "mcp",
    status: "core",
    summary: "route_map, tool_map, shape_check, api_impact — handler↔consumer mapping and response-shape mismatch.",
    details: ["shape_check compares an API response against consumer property access."],
  },
  {
    id: "cypher",
    name: "Ad-hoc Cypher",
    layer: "mcp",
    status: "core",
    summary: "Raw Cypher against LadybugDB using the documented schema. Schema resource is gitnexus://repo/{name}/schema.",
    details: ["Also `gitnexus cypher` on the CLI."],
  },
  {
    id: "cli",
    name: "CLI product",
    layer: "cli",
    status: "cli-only",
    summary: "analyze, setup, mcp, serve, wiki, group, doctor, list, status, clean, uninstall, plus direct tool commands.",
    details: ["Bin: dist/cli/index.js. commander. i18n help. Global install recommended so MCP startup is fast."],
  },
  {
    id: "setup",
    name: "Editor auto-setup",
    layer: "cli",
    status: "cli-only",
    summary: "gitnexus setup writes MCP config for Claude Code, Cursor, and peers. uninstall previews then removes.",
    details: ["-c to select agents. Skills copied into .claude/skills and .agents/skills when those dirs exist."],
  },
  {
    id: "web-graph",
    name: "Web graph explorer",
    layer: "web",
    status: "web-only",
    summary: "Sigma.js + Graphology WebGL explorer. Clusters, processes, symbol inspect, mermaid in chat.",
    details: [
      "Thin client. Local backend via gitnexus serve, or WASM indexer in-browser (memory-capped ~5k files).",
      "LangChain ReAct chat with Anthropic / OpenAI / Gemini / Ollama.",
      "i18n. DOMPurify on markdown. No source upload in WASM mode.",
    ],
  },
  {
    id: "groups",
    name: "Multi-repo groups",
    layer: "groups",
    status: "core",
    summary: "Named groups, contract registry, bridge graph. query/context/impact/trace accept repo: @group.",
    details: [
      "No group_* query tools — group state is resources: gitnexus://group/{name}/contracts|status.",
      "Cross-repo trace stitches one CONTRACT_LINK hop on Contract.symbolUid.",
      "PDG enrichment at a boundary is intra-procedural only.",
    ],
  },
  {
    id: "pdg",
    name: "CFG / PDG / taint",
    layer: "pdg",
    status: "opt-in",
    summary: "`analyze --pdg` emits CFG, REACHING_DEF, CDG, taint layers. Tools: explain, pdg_query.",
    details: [
      "Currently CFG visitors for TypeScript and JavaScript.",
      "Off by default so the default graph is byte-identical. Folded into the parse-cache key.",
      "PDG types stay out of VALID_RELATION_TYPES / the web schema.",
    ],
  },
  {
    id: "wiki",
    name: "Graph-backed wiki",
    layer: "wiki",
    status: "opt-in",
    summary: "LLM-written architecture wiki from the graph (not from raw files). Separate from the indexer — the indexer never calls an LLM.",
    details: ["`gitnexus wiki` flags: --model, --base-url, --force, --timeout, --retries, --lang, --allow-insecure-connection."],
  },
  {
    id: "skills",
    name: "Agent skills",
    layer: "skills",
    status: "core",
    summary: "Shipped skills (explore, debug, impact, refactor, guide, CLI, PDG, taint, plan, work, review, LFG) plus Leiden-generated repo-specific skills.",
    details: [
      "`--skills` generates cluster skills. `--skip-skills` / `--skip-agents-md` suppress writes.",
      "plan → work → review is the LFG pipeline with a user gate.",
      "Shipped skill text is guarded by shipped-skills-sync tests.",
    ],
  },
  {
    id: "staleness",
    name: "Index freshness",
    layer: "platform",
    status: "core",
    summary: "Compare indexed lastCommit to HEAD. Surface hints on tools and the context resource.",
    details: ["doctor command diagnoses grammar, DB, and registry issues."],
  },
  {
    id: "incremental",
    name: "Incremental + embedding cache",
    layer: "platform",
    status: "core",
    summary: "Parse cache keyed with PDG flag. Embeddings restored by content hash before generating the delta.",
    details: ["WAL checkpoint threshold configurable. Dirty-recovery sidecars are safe to delete."],
  },
];

export const LAYERS: { id: FeatureLayer; label: string }[] = [
  { id: "ingestion", label: "Ingestion" },
  { id: "graph", label: "Graph" },
  { id: "search", label: "Search" },
  { id: "mcp", label: "MCP" },
  { id: "cli", label: "CLI" },
  { id: "web", label: "Web" },
  { id: "groups", label: "Groups" },
  { id: "pdg", label: "PDG" },
  { id: "wiki", label: "Wiki" },
  { id: "skills", label: "Skills" },
  { id: "platform", label: "Platform" },
];
