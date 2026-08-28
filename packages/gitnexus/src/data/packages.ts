export const TREE = [
  {
    path: "gitnexus/",
    children: [
      "src/cli/ — commander commands (analyze, setup, mcp, serve, wiki, group, doctor, …)",
      "src/core/ingestion/ — pipeline, languages, workers, scope-resolution, route-extractors, cfg/",
      "src/core/graph/ — in-memory KnowledgeGraph",
      "src/core/lbug/ — schema + adapter",
      "src/core/search/ — BM25 + fusion",
      "src/core/embeddings/",
      "src/core/group/ — contracts, cross-impact, cross-trace, bridge-db",
      "src/core/wiki/",
      "src/core/run-analyze.ts — orchestrator around the pipeline",
      "src/mcp/ — server, tools, resources, local-backend",
      "src/server/ — Express HTTP",
      "src/storage/ — registry paths",
      "skills/ — shipped agent skills copied on analyze",
      "test/unit + test/integration",
      "vendor/ — optional grammars",
    ],
  },
  {
    path: "gitnexus-web/",
    children: [
      "src/App.tsx — explorer shell",
      "src/components/ — graph canvas, chat, inspect",
      "src/core/ — WASM indexer glue (browser)",
      "src/services/ — HTTP client to gitnexus serve",
      "src/i18n + locales/",
    ],
  },
  {
    path: "gitnexus-shared/",
    children: ["src/languages.ts", "src/scope-resolution/parsed-file.ts", "graph and capture contracts"],
  },
  {
    path: "repo root",
    children: [
      "ARCHITECTURE.md, AGENTS.md, GUARDRAILS.md, DoD.md, TESTING.md, MIGRATION.md, RUNBOOK.md",
      "eval/ — Python tool-use harness",
      "pr-swarm-review/ — CI review personas",
      ".claude/skills + gitnexus-claude-plugin/",
      "Dockerfile.cli, Dockerfile.web, docker-compose.yaml, render.yaml",
    ],
  },
];

export const HTTP_API = [
  { method: "GET", path: "/api/repos", purpose: "Registry listing (what the web UI opens on)." },
  { method: "GET", path: "/api/repos/:name/graph", purpose: "Subgraph for Sigma (nodes/edges, cluster colors)." },
  { method: "POST", path: "/api/tools/:tool", purpose: "Invoke LocalBackend tools with JSON args." },
  { method: "GET", path: "/api/resources/*", purpose: "MCP resources over HTTP." },
  { method: "POST", path: "/mcp", purpose: "Streamable HTTP MCP (mcp-http.ts) for non-stdio clients." },
];
