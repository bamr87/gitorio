export type NodeTable = {
  name: string;
  kind: "structure" | "symbol" | "type" | "runtime" | "derived" | "pdg";
  note: string;
};

export const NODE_TABLES: NodeTable[] = [
  { name: "File", kind: "structure", note: "Source file. FTS indexed. Embeddable." },
  { name: "Folder", kind: "structure", note: "Directory. CONTAINS files/folders." },
  { name: "Module", kind: "structure", note: "Language module / package unit." },
  { name: "Namespace", kind: "structure", note: "C# / C++ / PHP namespace." },
  { name: "Function", kind: "symbol", note: "Free function. FTS + embeddings." },
  { name: "Method", kind: "symbol", note: "Class-owned callable. Id may carry #<arity> and ~typehash." },
  { name: "Constructor", kind: "symbol", note: "Constructor / init." },
  { name: "Class", kind: "symbol", note: "Class. FTS + embeddings." },
  { name: "Interface", kind: "symbol", note: "Interface / protocol. Embeddable." },
  { name: "Struct", kind: "type", note: "C / Rust / Go struct." },
  { name: "Enum", kind: "type", note: "Enumerated type." },
  { name: "Union", kind: "type", note: "C/C++ union." },
  { name: "Typedef", kind: "type", note: "C typedef." },
  { name: "TypeAlias", kind: "type", note: "TS / Python / Rust alias." },
  { name: "Trait", kind: "type", note: "Rust trait." },
  { name: "Impl", kind: "type", note: "Rust impl block." },
  { name: "Record", kind: "type", note: "C# record." },
  { name: "Delegate", kind: "type", note: "C# delegate." },
  { name: "Annotation", kind: "type", note: "Java / Kotlin annotation type." },
  { name: "Template", kind: "type", note: "C++ template." },
  { name: "Macro", kind: "symbol", note: "C/C++ macro." },
  { name: "Const", kind: "symbol", note: "Constant. Block-local variants pruned post-resolution." },
  { name: "Static", kind: "symbol", note: "Static field / function." },
  { name: "Property", kind: "symbol", note: "Property / field." },
  { name: "CodeElement", kind: "symbol", note: "Catch-all declaration (DI providers, config keys)." },
  { name: "Community", kind: "derived", note: "Leiden cluster. MEMBER_OF from symbols." },
  { name: "Process", kind: "derived", note: "Execution flow from an entry point. STEP_IN_PROCESS." },
  { name: "Route", kind: "runtime", note: "HTTP / filesystem route. HANDLES_ROUTE from handler." },
  { name: "Tool", kind: "runtime", note: "MCP / RPC tool definition. HANDLES_TOOL." },
  { name: "Section", kind: "derived", note: "Markdown / MDX heading region." },
  { name: "Embedding", kind: "derived", note: "384D vector row, keyed by content SHA1." },
  { name: "BasicBlock", kind: "pdg", note: "Opt-in --pdg. Joined to symbols by id prefix + line span. No Function→BasicBlock edge." },
];

export type Relation = {
  type: string;
  from: string;
  to: string;
  note: string;
  pdg?: boolean;
};

export const RELATIONS: Relation[] = [
  { type: "CONTAINS", from: "Folder", to: "File | Folder", note: "Filesystem tree." },
  { type: "DEFINES", from: "File", to: "Symbol", note: "File owns a definition." },
  { type: "CALLS", from: "Function | Method", to: "Function | Method", note: "Resolved call. Confidence on the edge." },
  { type: "IMPORTS", from: "File | Module", to: "File | Symbol", note: "Import / include. Reason field carries confidence tier." },
  { type: "INHERITS", from: "Class | Interface", to: "Class | Interface", note: "Generic heritage (pre-split)." },
  { type: "EXTENDS", from: "Class", to: "Class", note: "Class heritage." },
  { type: "IMPLEMENTS", from: "Class", to: "Interface", note: "Interface / trait implementation." },
  { type: "USES", from: "Symbol", to: "Symbol", note: "Type / value use without a call." },
  { type: "DECORATES", from: "Annotation", to: "Symbol", note: "Decorator / attribute." },
  { type: "HAS_METHOD", from: "Class | Interface", to: "Method", note: "Ownership." },
  { type: "HAS_PROPERTY", from: "Class", to: "Property", note: "Field ownership." },
  { type: "ACCESSES", from: "Function | Method", to: "Property", note: "Field read/write." },
  { type: "METHOD_OVERRIDES", from: "Method", to: "Method", note: "Override via MRO." },
  { type: "METHOD_IMPLEMENTS", from: "Method", to: "Method", note: "Interface method fulfillment. Confidence 1.0 / 0.7." },
  { type: "MEMBER_OF", from: "Symbol", to: "Community", note: "Leiden cluster membership." },
  { type: "STEP_IN_PROCESS", from: "Symbol", to: "Process", note: "A step in an execution flow." },
  { type: "HANDLES_ROUTE", from: "Function | Method", to: "Route", note: "Provenance in source (decorator vs dispatch-guard)." },
  { type: "FETCHES", from: "Symbol", to: "Route", note: "Client call to a route." },
  { type: "HANDLES_TOOL", from: "Function | Method", to: "Tool", note: "MCP/RPC handler." },
  { type: "ENTRY_POINT_OF", from: "Symbol", to: "Process", note: "Process root." },
  { type: "WRAPS", from: "Symbol", to: "Symbol", note: "Wrapper / proxy." },
  { type: "QUERIES", from: "Symbol", to: "CodeElement", note: "ORM query (Prisma, Supabase)." },
  { type: "INJECTS", from: "Class | Method", to: "Class | CodeElement", note: "DI edge from consumer to provider." },
  { type: "CONDITIONAL_ON", from: "CodeElement", to: "CodeElement", note: "Spring auto-config condition." },
  { type: "DECLARES", from: "Class", to: "CodeElement", note: "Spring configuration candidate." },
  { type: "ADVISED_BY", from: "Symbol", to: "Method", note: "AOP advice." },
  { type: "BINDS_EVENT_HANDLER", from: "Symbol", to: "Method", note: "Event subscription." },
  { type: "EMITS_EVENT", from: "Symbol", to: "CodeElement", note: "Event emission." },
  { type: "CFG", from: "BasicBlock", to: "BasicBlock", note: "Control-flow. Kind in reason.", pdg: true },
  { type: "REACHING_DEF", from: "BasicBlock", to: "BasicBlock", note: "Def→use. Variable in reason.", pdg: true },
  { type: "CDG", from: "BasicBlock", to: "BasicBlock", note: "Control dependence. T/F in reason.", pdg: true },
  { type: "TAINTED", from: "BasicBlock", to: "BasicBlock", note: "Taint hop.", pdg: true },
  { type: "SANITIZES", from: "BasicBlock", to: "BasicBlock", note: "Sanitizer.", pdg: true },
  { type: "TAINT_PATH", from: "BasicBlock", to: "BasicBlock", note: "Persisted source→sink path.", pdg: true },
];

export const ID_RULES = [
  "Node IDs encode kind + file + qualified name. Methods append #<paramCount>.",
  "Same-arity overloads add ~type1,type2 when type annotations exist (TS/Java/C#/…). Python/Ruby/JS stay arity-only.",
  "C++ const-qualified methods add $const after the type-hash when a non-const twin exists.",
  "Generic types hash rawType: ~vector<int> vs ~vector<std::string>.",
  "Collision-only tags mean IDs are not stable when a new overload is added (`save#1` becomes `save#1~int`).",
  "Variadic vs fixed arity: CALLS confidence 0.7.",
];

export const CAPTURE_TAGS = [
  "@definition.class",
  "@definition.function",
  "@definition.method",
  "@definition.interface",
  "@call.name",
  "@import.source",
  "@reference.inherits",
  "@reference.type-arguments",
  "@declaration.type-parameters",
];
