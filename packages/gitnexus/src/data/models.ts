export const MODELS = [
  {
    name: "KnowledgeGraph",
    path: "gitnexus/src/core/graph/",
    purpose: "In-memory accumulator every pipeline phase mutates. Nodes, relationships, indexes. CSV-exportable for LadybugDB load.",
    fields: [
      "nodes: Map<id, GraphNode>",
      "relationships: Map<id, GraphEdge> + iterRelationshipsByType(type)",
      "addNode / addRelationship (idempotent on id)",
      "stats: { files, symbols, edges, languages }",
    ],
  },
  {
    name: "SemanticModel",
    path: "ingestion/model/semantic-model.ts",
    purpose: "Authoritative symbol-indexed lookup. Mutable during parse + scope-resolution + finalize; read-only handle afterward.",
    fields: [
      "symbols / methods / fields by nodeId, simpleName, qualifiedName, filePath",
      "findOwnedMember, pickOverload, findExportedDefByName",
      "reconcileOwnership() after populateOwners",
      "attachScopeIndexes(bundle) — one-shot freeze",
    ],
  },
  {
    name: "ParsedFile",
    path: "gitnexus-shared/src/scope-resolution/parsed-file.ts",
    purpose: "Single per-file artifact the scope-resolution pipeline consumes. Workers serialize this; do not re-parse on the main thread.",
    fields: [
      "filePath, language, localDefs[], referenceSites[], parsedImports[]",
      "typeBindings, export table, callable flow sites",
      "receiverChain (v2 codec), cfgSideChannel when --pdg",
      "capture side-channel for emitScopeCaptures",
    ],
  },
  {
    name: "LanguageProvider",
    path: "ingestion/language-provider.ts",
    purpose: "Per-language plug. Shared ingestion never names a language.",
    fields: [
      "id, extensions, treeSitterQueries",
      "importSemantics: named | wildcard-leaf | wildcard-transitive | namespace",
      "importResolver, exportChecker, typeConfig, mroStrategy",
      "descriptionExtractor?, definitionPropertiesExtractor?, cfgVisitor?",
    ],
  },
  {
    name: "ScopeResolver",
    path: "scope-resolution/contract/scope-resolver.ts",
    purpose: "Resolution hooks. Register in SCOPE_RESOLVERS. Contract invariants documented as I1–I9.",
    fields: [
      "languageProvider, populateOwners, buildMro",
      "resolveImportTarget, isNamespaceImport, mergeBindings",
      "arityCompatibility, importEdgeReason",
      "elementTypeOf, stripTypePreservingDecoration, hasFileLocalCallableLinkage",
      "constructorCallTargetsClass, constructionSyntax, scopeResolutionEdgeMode",
    ],
  },
  {
    name: "PipelinePhase<T>",
    path: "pipeline-phases/types.ts",
    purpose: "name + deps + execute(ctx, deps) → T. Runner filters deps to declared names only.",
    fields: ["name: string", "deps: string[]", "execute(ctx, deps): Promise<T>", "durationMs on PhaseResult"],
  },
  {
    name: "PipelineContext",
    path: "pipeline-phases/types.ts",
    purpose: "Shared mutable context for the DAG run.",
    fields: ["graph: KnowledgeGraph", "repoPath", "options: PipelineOptions", "progress: (PipelineProgress) => void"],
  },
  {
    name: "LocalBackend",
    path: "mcp/local/local-backend.ts",
    purpose: "Single implementation of every MCP tool. Connection pooling, lazy DB open, group routing.",
    fields: [
      "_queryImpl, _contextImpl, _impactImpl, _traceImpl",
      "_pdgQueryImpl, _explainImpl, resolveBlockAnchor",
      "EpistemicCauses for unresolved receivers",
    ],
  },
  {
    name: "RepoRegistry",
    path: "repo-manager.ts + ~/.gitnexus/registry.json",
    purpose: "Maps repo name → index path, lastCommit, branch. MCP discovery.",
    fields: ["name", "path", "indexedAt", "lastCommit", "stats", "pdg?: boolean"],
  },
  {
    name: "Contract + ContractLink",
    path: "core/group/",
    purpose: "Cross-repo HTTP (and similar) provider/consumer rows. Bridge graph joins on symbolUid.",
    fields: [
      "Contract: { kind, method, url, symbolUid, repo, direction: provider|consumer }",
      "ContractLink: consumer → provider over one boundary",
      "MAX_SUPPORTED_CROSS_DEPTH = 1",
    ],
  },
  {
    name: "ResolutionOutcome",
    path: "scope-resolution/resolution-outcome.ts",
    purpose: "Receivers the resolver could not type. Feeds epistemic bounds.",
    fields: [
      "shape: chain-call | chain-field | chain-mixed | chain-unwrap | no-chain",
      "origin: in-program | external | unknown",
      "unresolvedReceiverMembers summary persisted on the index",
    ],
  },
  {
    name: "Embedding row",
    path: "core/embeddings/ + Embedding table",
    purpose: "384D Snowflake arctic-embed-xs. Incremental via SHA1 of embeddable text.",
    fields: ["nodeId", "vector: Float32[384]", "contentHash", "model"],
  },
];

export const MODEL_SNIPPETS: { name: string; code: string }[] = [
  {
    name: "PipelinePhase",
    code: `export interface PipelinePhase<T> {
  name: string;
  deps: readonly string[];
  execute(
    ctx: PipelineContext,
    deps: ReadonlyMap<string, PhaseResult>,
  ): Promise<T>;
}`,
  },
  {
    name: "Graph edge",
    code: `type CodeRelation = {
  from: string;
  to: string;
  type: RelationType;
  confidence: number;      // 0.5 … 1.0
  reason?: string;         // import tier, CFG kind, variable…
  source?: string;         // decorator | dispatch-guard | …
};`,
  },
  {
    name: "Method id",
    code: `// kind:file:Owner.name#arity[~types][$const]
"Method:src/db.ts:Repo.save#1~User"
"Method:container.h:Container.begin#0$const"`,
  },
];
