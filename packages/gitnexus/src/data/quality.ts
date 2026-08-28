export const DOD = {
  statement:
    "A change is Done when it is correct, safely integrated, appropriately tested, operationally sound, and a net improvement — not merely 'it compiles and a test passes.'",
  axes: [
    {
      name: "Correctness",
      items: [
        "End-to-end in the real runtime path — no test-only shims.",
        "Edge cases handled or documented as out of scope.",
        "Validate at system boundaries; trust internal code.",
      ],
    },
    {
      name: "Placement",
      items: [
        "CLI/MCP/ingestion → gitnexus/. UI → gitnexus-web/. Contracts → gitnexus-shared/.",
        "Shared ingestion never names a language. LanguageProvider / ScopeResolver only.",
        "No hidden cross-phase coupling. Direct shared imports, no drift-hiding barrels.",
      ],
    },
    {
      name: "Contracts",
      items: [
        "CLI flags, MCP tools, HTTP routes, graph shapes, node IDs stay stable unless the task is a break.",
        "Persisted schema changes ship a reindex/migration path (MIGRATION.md).",
      ],
    },
    {
      name: "Security",
      items: [
        "No command/path/Cypher/prompt injection on untrusted input.",
        "Filesystem access honors repo-scope. No secrets in logs.",
      ],
    },
    {
      name: "Performance",
      items: [
        "Tree-sitter buffers 512KB–32MB adaptive — never a hard-coded giant.",
        "DB handles close. Workers are the parse path. Long graphs stream or bound.",
      ],
    },
    {
      name: "Tests",
      items: [
        "Integration tests use a real LadybugDB — no mocks that hide schema drift.",
        "Fixtures match the risk. Deterministic. Exact assertions (toBe/toEqual).",
      ],
    },
  ],
  notDone: [
    "Runtime path not exercised by tests.",
    "Contract drift between packages.",
    "Language-specific logic leaked into shared ingestion.",
    "Unrelated reformat/refactor churn.",
    "Placeholder TODOs added.",
    "CHANGELOG.md edited in a PR (release-owned).",
    "Treating UNKNOWN impact risk as safe.",
  ],
  agentRules: [
    "Run impact on a symbol before editing it. HIGH/CRITICAL blocks the edit.",
    "Run detect_changes before commit.",
    "Never find-and-replace for renames — use the rename tool.",
    "The CLI indexer does not call an LLM.",
  ],
  tests: [
    { cmd: "cd gitnexus && npm test", note: "Full CLI suite (unit + integration)." },
    { cmd: "npm run test:unit", note: "Unit only." },
    { cmd: "npm run test:integration", note: "Real DB. pretest builds." },
    { cmd: "npx tsc --noEmit", note: "CLI typecheck." },
    { cmd: "cd gitnexus-web && npm test && npm run test:e2e", note: "Vitest + Playwright." },
    { cmd: "cd gitnexus-shared && npm run build", note: "Must precede dependents." },
  ],
};

export const LIMITS = [
  "Overloaded method IDs are collision-only — adding an overload changes the existing id.",
  "Languages without types (Python, Ruby, JS) cannot same-arity disambiguate.",
  "CFG/PDG visitors today: TypeScript and JavaScript only.",
  "Browser WASM indexer ~5k files unless you use gitnexus serve.",
  "Cross-repo data flow does not cross a ContractLink. Trace depth is 1 hop.",
  "NestJS setGlobalPrefix / URI versioning in bootstrap files are not applied to controller-relative paths.",
  "A missing route is a coverage limit. Never invent one.",
];
