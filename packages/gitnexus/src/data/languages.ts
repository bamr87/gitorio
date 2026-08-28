export type LangCap = {
  language: string;
  extensions: string[];
  imports: boolean;
  named: boolean;
  exports: boolean;
  heritage: boolean;
  types: boolean;
  ctor: boolean;
  config: boolean;
  frameworks: boolean;
  entry: boolean;
  pdg: boolean;
  importStrategy: string;
  mro: string;
  notes: string;
};

export const LANGUAGES: LangCap[] = [
  { language: "TypeScript", extensions: [".ts", ".tsx", ".mts", ".cts"], imports: true, named: true, exports: true, heritage: true, types: true, ctor: true, config: true, frameworks: true, entry: true, pdg: true, importStrategy: "named", mro: "first-wins", notes: "Overload signatures collapse to the implementation body. NestJS/Next.js routes. CFG visitor for --pdg." },
  { language: "JavaScript", extensions: [".js", ".jsx", ".mjs", ".cjs"], imports: true, named: true, exports: true, heritage: true, types: false, ctor: true, config: true, frameworks: true, entry: true, pdg: true, importStrategy: "named", mro: "first-wins", notes: "Same pipeline as TS without type-hash disambiguation. Dispatch-guard routes." },
  { language: "Python", extensions: [".py"], imports: true, named: true, exports: true, heritage: true, types: true, ctor: true, config: true, frameworks: true, entry: true, pdg: false, importStrategy: "namespace", mro: "c3", notes: "PEP-328 imports. Django urlpatterns. Registry-primary call resolution. reconcileOwnership for class-body methods." },
  { language: "Java", extensions: [".java"], imports: true, named: true, exports: true, heritage: true, types: true, ctor: true, config: false, frameworks: true, entry: true, pdg: false, importStrategy: "named", mro: "first-wins", notes: "Spring routes, AOP, auto-configuration phases." },
  { language: "Kotlin", extensions: [".kt", ".kts"], imports: true, named: true, exports: true, heritage: true, types: true, ctor: true, config: false, frameworks: true, entry: true, pdg: false, importStrategy: "named", mro: "first-wins", notes: "Optional grammar. Vendored if C++ toolchain missing." },
  { language: "C#", extensions: [".cs"], imports: true, named: true, exports: true, heritage: true, types: true, ctor: true, config: true, frameworks: true, entry: true, pdg: false, importStrategy: "named", mro: "first-wins", notes: "populateNamespaceSiblings for compiler-implicit namespace sharing. Records, delegates." },
  { language: "Go", extensions: [".go"], imports: true, named: false, exports: true, heritage: true, types: true, ctor: true, config: true, frameworks: true, entry: true, pdg: false, importStrategy: "wildcard-leaf", mro: "first-wins", notes: "Package-level visibility. No named bindings." },
  { language: "Rust", extensions: [".rs"], imports: true, named: true, exports: true, heritage: true, types: true, ctor: true, config: false, frameworks: true, entry: true, pdg: false, importStrategy: "named", mro: "first-wins", notes: "Trait/Impl nodes. impl T<A> for S uses @reference.type-arguments." },
  { language: "PHP", extensions: [".php"], imports: true, named: true, exports: true, heritage: false, types: true, ctor: true, config: true, frameworks: true, entry: true, pdg: false, importStrategy: "named", mro: "none", notes: "Laravel routes/*.php single-file extractor. Filesystem PHP routes." },
  { language: "Ruby", extensions: [".rb"], imports: true, named: false, exports: true, heritage: true, types: false, ctor: true, config: false, frameworks: true, entry: true, pdg: false, importStrategy: "wildcard-leaf", mro: "ruby-mixin", notes: "Mixin-aware MRO." },
  { language: "Swift", extensions: [".swift"], imports: false, named: false, exports: true, heritage: true, types: true, ctor: true, config: true, frameworks: true, entry: true, pdg: false, importStrategy: "wildcard-leaf", mro: "first-wins", notes: "constructorCallTargetsClass. Optional grammar. Documented ingestion gaps in swift-ingestion-gaps.md." },
  { language: "C", extensions: [".c", ".h"], imports: false, named: false, exports: true, heritage: false, types: true, ctor: true, config: false, frameworks: true, entry: true, pdg: false, importStrategy: "wildcard-transitive", mro: "none", notes: "#include closure. hasFileLocalCallableLinkage for static." },
  { language: "C++", extensions: [".cc", ".cpp", ".cxx", ".hpp", ".hh"], imports: false, named: false, exports: true, heritage: true, types: true, ctor: true, config: false, frameworks: true, entry: true, pdg: false, importStrategy: "wildcard-transitive", mro: "first-wins", notes: "$const method ids. Member-function pointers preserve cv shape. Virtual targets expand through MRO." },
  { language: "Dart", extensions: [".dart"], imports: true, named: false, exports: true, heritage: true, types: true, ctor: true, config: false, frameworks: true, entry: true, pdg: false, importStrategy: "wildcard-leaf", mro: "first-wins", notes: "Optional grammar. implements/with ride heritage MARKER payload. constructorCallTargetsClass." },
  { language: "Vue", extensions: [".vue"], imports: true, named: true, exports: true, heritage: true, types: true, ctor: true, config: true, frameworks: true, entry: true, pdg: false, importStrategy: "named", mro: "first-wins", notes: "SFC script blocks routed through the TS/JS provider." },
  { language: "COBOL", extensions: [".cbl", ".cob"], imports: false, named: false, exports: true, heritage: false, types: false, ctor: false, config: false, frameworks: false, entry: true, pdg: false, importStrategy: "none", mro: "none", notes: "Regex processor. ScopeResolver scopeResolutionEdgeMode = callable-flow-only." },
];

export const ADD_LANGUAGE = [
  "Implement LanguageProvider in gitnexus/src/core/ingestion/languages/<lang>/ (id, extensions, treeSitterQueries, importSemantics, importResolver, exportChecker, typeConfig, mroStrategy).",
  "Write tree-sitter queries using the unified capture tags in tree-sitter-queries.ts.",
  "Declare ImportResolutionConfig in import-resolvers/configs/.",
  "Implement ScopeResolver (scope-resolution/contract/scope-resolver.ts) and register in SCOPE_RESOLVERS.",
  "Add the id to gitnexus-shared/src/languages.ts. The languages/index.ts Record<SupportedLanguages, LanguageProvider> fails compile if a language is missing.",
  "CI auto-discovers SCOPE_RESOLVERS via tsx — no workflow edit.",
  "Optional: cfgVisitor for --pdg, descriptionExtractor for doc-comment embeddings, definitionPropertiesExtractor for structured metadata.",
];
