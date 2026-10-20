export const PRD = {
  name: "GitNexus",
  tagline: "The nervous system for agent context.",
  oneLiner:
    "A local-first code intelligence engine that indexes any repository into a knowledge graph — every dependency, call chain, cluster, and execution flow — then exposes that graph to AI agents through MCP, CLI, and a browser explorer.",
  problem: [
    {
      title: "Agents edit blind",
      body: "A single function change can silently break dozens of downstream callers. LLMs see files and snippets, not the structural map of the system. They grep, miss a call chain, and ship a regression.",
    },
    {
      title: "Docs are descriptions, not relations",
      body: "Wiki-style tools summarize what a module is. They do not track that Route X is handled by Method Y which CALLS Service Z which QUERIES Table T. Agents need edges, not prose.",
    },
    {
      title: "Token waste and model lock-in",
      body: "Without a graph, agents spend context on multi-hop grep. Larger models compensate by reading more files. A precomputed graph lets smaller models answer blast-radius questions in one tool call.",
    },
    {
      title: "Privacy and server cost",
      body: "Uploading a private codebase to a hosted indexer is a non-starter for many teams. Indexing must run on the developer machine (CLI) or entirely in the browser (WASM).",
    },
  ],
  vision:
    "Every coding agent — Cursor, Claude Code, Codex, Windsurf, Gemini — opens a repo with a structural map already computed. Impact, trace, rename, taint, and route mapping are first-class tools. The graph is the source of truth; the LLM is the reasoner on top of it.",
  users: [
    {
      persona: "Staff engineer on a large monorepo",
      need: "Know blast radius before touching a shared service. Refactor without tribal knowledge.",
      job: "Runs `gitnexus analyze --embeddings --skills`, then asks the agent to impact-check every edit.",
    },
    {
      persona: "AI coding agent (Claude Code, Cursor, Codex)",
      need: "Reliable structural context: callers, callees, processes, clusters, contracts across repos.",
      job: "Calls MCP tools `context`, `impact`, `query`, `trace` instead of grep. Follows installed skills.",
    },
    {
      persona: "New teammate / explorer",
      need: "See how a codebase is actually wired without reading every file.",
      job: "Opens the Web UI graph, clicks a cluster, follows a process from route to sink.",
    },
    {
      persona: "Platform / multi-service owner",
      need: "Cross-repo impact: if this HTTP contract changes, which consumer breaks?",
      job: "Creates a group, syncs the contract registry, queries with `repo: @platform`.",
    },
  ],
  goals: [
    "Index a multi-language repo into a queryable knowledge graph without an LLM in the indexer.",
    "Expose the graph through MCP (stdio), HTTP, and CLI with identical semantics.",
    "Answer blast-radius, call-chain, and search questions in one tool call.",
    "Keep source on-device: native LadybugDB on CLI, WASM in the browser.",
    "Plug a new language in via LanguageProvider + ScopeResolver — no shared-code language names.",
    "Support multi-repo groups via a contract bridge, not a merged mega-graph.",
  ],
  nonGoals: [
    "GitNexus is not an IDE, not a linter, not a hosted SaaS requirement for the OSS product.",
    "The CLI indexer does not call an LLM. Wiki generation is a separate, opt-in command.",
    "It is not a substitute for a typechecker. Confidence tiers exist; UNKNOWN is not safe.",
    "Full cross-program (SDG-like) data flow across repo boundaries is deferred.",
    "Do not invent routes. A missing route is a coverage limit; an invented one is a lie.",
  ],
  principles: [
    {
      name: "Graph first, language second",
      body: "16 languages feed one schema (node tables + CodeRelation). Shared ingestion never branches on a language name.",
    },
    {
      name: "Precision over recall for facts",
      body: "route_map, HANDLES_ROUTE, and CALLS edges are presented as fact. Heuristics that cannot be proven are dropped.",
    },
    {
      name: "Three faces, one backend",
      body: "MCP, HTTP (`gitnexus serve`), and CLI tools (`query|context|impact|cypher`) share LocalBackend.",
    },
    {
      name: "Local by default",
      body: "Index lives in `<repo>/.gitnexus/`. Registry in `~/.gitnexus/registry.json`. No upload required.",
    },
    {
      name: "Workers are the only parse path",
      body: "`--workers 0` is rejected. Tree-sitter buffers are not GC-reclaimable on the main thread.",
    },
    {
      name: "Impact before edit",
      body: "Agent skills require `impact` before changing a symbol and `detect_changes` before commit.",
    },
  ],
  success: [
    {
      metric: "Index completeness",
      target: "Symbols, imports, calls, heritage, routes, processes present for supported languages on a golden fixture repo.",
    },
    {
      metric: "Tool reliability",
      target: "MCP `impact` and `context` return callers/callees that match the graph; UNKNOWN risk is never treated as safe.",
    },
    {
      metric: "Agent setup time",
      target: "`gitnexus setup` configures Claude Code, Cursor, and peers in one command.",
    },
    {
      metric: "Privacy",
      target: "CLI never ships source off-box. Web WASM path never uploads the zip.",
    },
    {
      metric: "Language extensibility",
      target: "Adding a language = ScopeResolver + LanguageProvider + tree-sitter queries. CI auto-discovers SCOPE_RESOLVERS.",
    },
  ],
  constraints: [
    "Node ^22.18.0 || >=24.11.0 for the published CLI.",
    "LadybugDB (`@ladybugdb/core`) for persistence — native in CLI, WASM in web.",
    "Tree-sitter 0.21.x with per-language grammars; optional grammars skippable without a C++ toolchain.",
    "Embeddings: Snowflake arctic-embed-xs (384D) via transformers.js / onnxruntime. Opt-in, skipped above ~50k nodes.",
    "MCP via `@modelcontextprotocol/sdk` over stdio. HTTP bridge is Express 5.",
    "Web UI is a thin client: React 19, Vite, Sigma.js + Graphology, LangChain for chat.",
  ],
  journeys: [
    {
      name: "First index → agent that can see",
      steps: [
        "Install globally: `npm install -g gitnexus`.",
        "From a repo root: `gitnexus analyze --embeddings --skills`.",
        "One-time: `gitnexus setup` (auto-detects editors).",
        "Open Cursor / Claude Code. Agent calls `list_repos`, then `query` / `impact`.",
        "Index lives in `.gitnexus/`; repo is registered in `~/.gitnexus/registry.json`.",
      ],
    },
    {
      name: "Explore in the browser",
      steps: [
        "Either drop a zip / Git URL into gitnexus.vercel.app (WASM, ~5k file cap), or",
        "`gitnexus serve` after a CLI index — the UI talks HTTP to the local backend, no re-upload.",
        "Inspect clusters (Leiden communities), processes (entry→sink flows), and chat over the graph.",
      ],
    },
    {
      name: "Cross-repo blast radius",
      steps: [
        "`gitnexus group create platform` then `group add` each service.",
        "`gitnexus group sync platform` rebuilds contracts.json + bridge graph.",
        "MCP `impact` with `repo: \"@platform\"` walks locally then fans out across ContractLink hops.",
      ],
    },
  ],
};
