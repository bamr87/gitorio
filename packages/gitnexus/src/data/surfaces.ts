export type Tool = {
  name: string;
  purpose: string;
  params: string[];
  notes?: string;
  pdg?: boolean;
  group?: boolean;
};

export const MCP_TOOLS: Tool[] = [
  { name: "list_repos", purpose: "Discover indexed repos in the global registry.", params: ["limit", "offset"] },
  { name: "query", purpose: "Hybrid BM25 + vector search over the graph.", params: ["search_query", "repo?", "branch?", "maxTokens?"], notes: "Group-aware: repo=@group merges via RRF." },
  { name: "cypher", purpose: "Ad-hoc Cypher against the LadybugDB schema.", params: ["query", "repo?", "branch?"] },
  { name: "context", purpose: "Callers, callees, processes for one symbol.", params: ["name", "file_path?", "kind?", "uid?", "repo?", "branch?"], notes: "Publishes epistemic exact | lower-bound." },
  { name: "impact", purpose: "Blast radius (upstream/downstream) with risk summary.", params: ["target", "direction", "minConfidence?", "maxDepth?", "relationTypes?", "includeTests?", "limit?", "offset?", "summaryOnly?", "uid?", "file_path?", "kind?", "repo?", "branch?"], notes: "Group mode fans out across Contract Bridge." },
  { name: "detect_changes", purpose: "Map git diffs to affected symbols and processes.", params: ["scope", "git_ref?", "base_ref?", "partial?", "truncated?"] },
  { name: "rename", purpose: "Graph-assisted multi-file rename with dry_run preview.", params: ["symbol_name", "new_name", "dry_run?", "repo?", "branch?"] },
  { name: "api_impact", purpose: "Pre-change impact report for an API route handler.", params: ["route_handler", "repo?", "branch?"] },
  { name: "trace", purpose: "Shortest directed path between two symbols (call + class-member).", params: ["from", "to", "from_uid?", "to_uid?", "repo?", "pdg?"], notes: "Group-aware. One CONTRACT_LINK hop max. pdg:true is experimental." },
  { name: "route_map", purpose: "API route → handler → consumer mappings.", params: ["api_path?", "repo?", "branch?"] },
  { name: "tool_map", purpose: "MCP/RPC tool definitions and handlers.", params: ["repo?", "branch?"] },
  { name: "shape_check", purpose: "Response shape vs consumer property-access mismatches.", params: ["api_response", "consumer_code", "repo?"] },
  { name: "check", purpose: "Run a named structural rule against the graph.", params: ["rule", "repo?"] },
  { name: "explain", purpose: "Persisted taint findings (source→sink data flows).", params: ["target", "repo?", "branch?"], pdg: true },
  { name: "pdg_query", purpose: "Control/data dependence. mode=controls (CDG) or flows (REACHING_DEF).", params: ["mode", "target", "variable?", "repo?", "branch?"], pdg: true },
  { name: "group_list", purpose: "List repo groups or details for one group.", params: ["name?"], group: true },
  { name: "group_sync", purpose: "Rebuild group Contract Registry (contracts.json) and bridge graph.", params: ["name"], group: true },
];

export const RESOURCES = [
  { uri: "gitnexus://repos", purpose: "All indexed repositories." },
  { uri: "gitnexus://setup", purpose: "Setup and usage guidance for agents." },
  { uri: "gitnexus://repo/{name}/context", purpose: "Stats, staleness, available tools." },
  { uri: "gitnexus://repo/{name}/clusters", purpose: "Functional clusters with cohesion scores." },
  { uri: "gitnexus://repo/{name}/cluster/{name}", purpose: "Cluster members." },
  { uri: "gitnexus://repo/{name}/processes", purpose: "All execution flows." },
  { uri: "gitnexus://repo/{name}/process/{name}", purpose: "Full process trace with steps." },
  { uri: "gitnexus://repo/{name}/schema", purpose: "Graph schema for Cypher." },
  { uri: "gitnexus://group/{name}/contracts", purpose: "Provider/consumer rows + cross-links." },
  { uri: "gitnexus://group/{name}/status", purpose: "Per-member index + registry staleness." },
];

export const PROMPTS = [
  { name: "detect_impact", purpose: "Pre-commit analysis prompt wired to detect_changes + impact." },
  { name: "generate_map", purpose: "Architecture docs with Mermaid, driven from clusters/processes." },
];

export const SKILLS = [
  { name: "Exploring", id: "gitnexus-explore", body: "Navigate an unfamiliar codebase via query, clusters, processes." },
  { name: "Debugging", id: "gitnexus-debug", body: "Trace bugs through call chains and processes." },
  { name: "Impact Analysis", id: "gitnexus-impact", body: "Blast radius before edits. Blocks HIGH/CRITICAL." },
  { name: "Refactoring", id: "gitnexus-refactor", body: "Plan safe refactors; use rename, not find-replace." },
  { name: "Guide", id: "gitnexus-guide", body: "Tool, resource, and schema reference." },
  { name: "CLI", id: "gitnexus-cli", body: "analyze / status / clean / wiki command recipes." },
  { name: "PDG Query", id: "gitnexus-pdg", body: "Statement-level control and data dependence." },
  { name: "Taint Analysis", id: "gitnexus-taint", body: "Source→sink data-flow via explain." },
  { name: "Plan", id: "/gitnexus-plan", body: "Implementation-ready plans with graph/PDG. Writes docs/plans/. No code edits." },
  { name: "Work", id: "/gitnexus-work", body: "Execute a plan as verified atomic commits. impact before edit, detect_changes before commit." },
  { name: "Review", id: "/gitnexus-review", body: "Read-only PR/diff review. PDG taint on trust-boundary diffs. Swarm personas in CI." },
  { name: "LFG", id: "/gitnexus-lfg", body: "Orchestrator: plan → user gate → work → review." },
];

export type CliCommand = {
  cmd: string;
  purpose: string;
  flags?: string[];
};

export const CLI: CliCommand[] = [
  { cmd: "gitnexus setup", purpose: "Write MCP config for detected editors. One-time.", flags: ["-c <agents>"] },
  {
    cmd: "gitnexus analyze [path]",
    purpose: "Index a repo into .gitnexus/ and register it.",
    flags: [
      "--force",
      "--repair-fts",
      "--skills",
      "--skip-embeddings",
      "--embeddings [limit]",
      "--pdg",
      "--skip-agents-md",
      "--skip-skills",
      "--skip-git",
      "--default-branch <name>",
      "--verbose",
      "--worker-timeout <s>",
      "--workers <n>",
      "--wal-checkpoint-threshold <bytes>",
    ],
  },
  { cmd: "gitnexus mcp", purpose: "Start MCP server over stdio (what editors launch)." },
  { cmd: "gitnexus serve", purpose: "HTTP server for the Web UI. Talks to local indexes." },
  { cmd: "gitnexus eval-server", purpose: "Evaluation tools. Loopback by default; GITNEXUS_AUTH_TOKEN required off-loopback." },
  { cmd: "gitnexus list", purpose: "List indexed repos from the registry." },
  { cmd: "gitnexus status", purpose: "Index status + staleness for the current repo." },
  { cmd: "gitnexus clean", purpose: "Delete the local index." },
  { cmd: "gitnexus doctor", purpose: "Diagnose grammars, DB, registry, editor config." },
  {
    cmd: "gitnexus wiki [path]",
    purpose: "Generate an LLM wiki from the graph.",
    flags: ["--model", "--base-url", "--force", "--timeout", "--retries", "--lang", "--allow-insecure-connection"],
  },
  { cmd: "gitnexus uninstall", purpose: "Preview/remove MCP setup.", flags: ["--force"] },
  { cmd: "gitnexus query|context|impact|trace|cypher|detect-changes|check|rename", purpose: "Direct CLI equivalents of MCP tools." },
  { cmd: "gitnexus group create <name>", purpose: "Create a multi-repo group." },
  { cmd: "gitnexus group add <group> <groupPath> <registryName>", purpose: "Add a member." },
  { cmd: "gitnexus group remove <group> <groupPath>", purpose: "Remove a member." },
  { cmd: "gitnexus group list [name]", purpose: "List groups or one group's members." },
  { cmd: "gitnexus group sync <name>", purpose: "Rebuild contracts.json + bridge graph." },
  { cmd: "gitnexus group contracts <name>", purpose: "Print the contract registry." },
  { cmd: "gitnexus group query <name> <q>", purpose: "Search across members." },
  { cmd: "gitnexus group status <name>", purpose: "Per-member staleness." },
  { cmd: "gitnexus group impact <name> --target <symbol> --repo <path>", purpose: "Cross-repo blast radius." },
];
