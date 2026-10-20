import { x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as PageHead, r as Panel } from "./router-2D7qrjqM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/architecture-CqlJnZzd.js
var import_jsx_runtime = require_jsx_runtime();
var PACKAGES = [
	{
		id: "gitnexus",
		path: "gitnexus/",
		npm: "gitnexus",
		role: "CLI, MCP stdio server, HTTP API, ingestion pipeline, LadybugDB, embeddings, wiki, groups."
	},
	{
		id: "web",
		path: "gitnexus-web/",
		npm: "private",
		role: "Vite + React thin client. Graph explorer + AI chat. All queries via `gitnexus serve` HTTP API. Optional in-browser WASM indexer."
	},
	{
		id: "shared",
		path: "gitnexus-shared/",
		npm: "file:../gitnexus-shared",
		role: "Shared TypeScript types, language ids, ParsedFile, capture tags. Built first."
	},
	{
		id: "claude",
		path: "gitnexus-claude-plugin/",
		npm: "marketplace",
		role: "Static Claude Code plugin manifest + shipped skills."
	},
	{
		id: "cursor",
		path: "gitnexus-cursor-integration/",
		npm: "static",
		role: "Cursor integration metadata."
	},
	{
		id: "eval",
		path: "eval/",
		npm: "harness",
		role: "Python evaluation harness (Docker + LLM API) for tool-use benchmarks."
	}
];
var LAYERS = [
	{
		name: "Ingestion",
		path: "gitnexus/src/core/ingestion/",
		body: "19-phase DAG (21 with --pdg). scan → structure → parse → resolve → cluster → processes. Worker pool is the sole parse path."
	},
	{
		name: "Semantic model",
		path: "gitnexus/src/core/ingestion/model/",
		body: "Authoritative symbol store (by nodeId, simpleName, qualifiedName, filePath). Mutable during parse + scope-resolution + finalize; frozen afterward."
	},
	{
		name: "Scope resolution",
		path: "gitnexus/src/core/ingestion/scope-resolution/",
		body: "Language-agnostic CALLS / ACCESSES / USES / INHERITS emission. Each language implements ScopeResolver and registers in SCOPE_RESOLVERS."
	},
	{
		name: "Persistence",
		path: "gitnexus/src/core/lbug/",
		body: "LadybugDB adapter. Separate node tables, single CodeRelation table. CSV streaming load. FTS indexes. Optional Embedding table."
	},
	{
		name: "Search",
		path: "gitnexus/src/core/search/",
		body: "Hybrid BM25 + 384D vectors, merged with Reciprocal Rank Fusion (K=60)."
	},
	{
		name: "Query backends",
		path: "gitnexus/src/mcp/ + src/cli/ + src/server/",
		body: "LocalBackend implements tools and resources. MCP stdio, Express HTTP, and CLI commands are three faces of the same code."
	},
	{
		name: "Groups",
		path: "gitnexus/src/core/group/",
		body: "Contract registry + bridge graph. Cross-repo impact and trace hop a single ContractLink (MAX_SUPPORTED_CROSS_DEPTH = 1)."
	}
];
var FLOWS = [
	{
		title: "Index → graph → tools",
		steps: [
			"CLI `analyze.ts` → `runFullAnalysis` (`run-analyze.ts`) → `runPipelineFromRepo` (`pipeline.ts`).",
			"19 phases build an in-memory KnowledgeGraph.",
			"Graph streams into LadybugDB under `<repo>/.gitnexus/`.",
			"Repo registered in `~/.gitnexus/registry.json`.",
			"MCP / HTTP / CLI open the DB lazily via LocalBackend."
		]
	},
	{
		title: "Full analysis percentages",
		steps: [
			"0% — skip if lastCommit == HEAD unless --force; cache prior embeddings.",
			"0–60% — pipeline DAG.",
			"60% — drop legacy KuzuDB files.",
			"60–85% — initLbug + CSV load.",
			"85–90% — FTS indexes (File, Function, Class, Method…).",
			"88–98% — restore then generate embeddings if --embeddings.",
			"98–100% — metadata, registry, .gitignore, AGENTS.md / CLAUDE.md / skills."
		]
	},
	{
		title: "Query path",
		steps: [
			"MCP stdio: `mcp.ts` → LocalBackend → tools.ts + resources.ts.",
			"HTTP: `serve.ts` → Express `api.ts` / `mcp-http.ts`.",
			"CLI: `gitnexus query|context|impact|cypher` in `tool.ts`.",
			"Staleness: `staleness.ts` compares indexed lastCommit to HEAD."
		]
	}
];
var WHERE_TO_CHANGE = [
	{
		concern: "CLI commands / flags",
		start: "gitnexus/src/cli/ (index.ts + per-command modules)"
	},
	{
		concern: "Parsing / graph construction",
		start: "src/core/ingestion/pipeline-phases/ + pipeline.ts"
	},
	{
		concern: "Graph schema / DB",
		start: "src/core/lbug/ (schema.ts, lbug-adapter.ts)"
	},
	{
		concern: "MCP tools / resources",
		start: "src/mcp/server.ts, tools.ts, resources.ts"
	},
	{
		concern: "Cross-repo groups",
		start: "src/core/group/ (service, cross-impact, sync, bridge-db)"
	},
	{
		concern: "Search ranking",
		start: "src/core/search/"
	},
	{
		concern: "Embeddings",
		start: "src/core/embeddings/ + run-analyze.ts"
	},
	{
		concern: "Wiki generation",
		start: "src/core/wiki/"
	},
	{
		concern: "Language support",
		start: "ingestion/languages/ + tree-sitter-queries.ts + gitnexus-shared/src/languages.ts"
	},
	{
		concern: "Import resolution",
		start: "import-processor.ts + import-resolvers/configs/ + model/resolution-context.ts"
	},
	{
		concern: "Call / inheritance / MRO",
		start: "ingestion/scope-resolution/"
	},
	{
		concern: "Type extraction",
		start: "ingestion/type-extractors/"
	},
	{
		concern: "Worker pool",
		start: "ingestion/workers/"
	},
	{
		concern: "Web UI",
		start: "gitnexus-web/src/"
	},
	{
		concern: "CI",
		start: ".github/workflows + .github/actions/"
	}
];
var STORAGE = {
	repo: [
		{
			path: ".gitnexus/lbug",
			note: "LadybugDB database"
		},
		{
			path: ".gitnexus/lbug.wal",
			note: "Write-ahead log"
		},
		{
			path: ".gitnexus/lbug.shadow",
			note: "Checkpoint staging"
		},
		{
			path: ".gitnexus/lbug.lock",
			note: "Single-writer lock"
		},
		{
			path: ".gitnexus/gitnexus.json",
			note: "lastCommit, indexedAt, stats"
		},
		{
			path: ".gitnexus/meta.json",
			note: "Legacy mirror, kept in sync"
		}
	],
	global: [{
		path: "~/.gitnexus/registry.json",
		note: "Global repo registry for MCP discovery"
	}]
};
var ABSTRACTION_STACK = [
	"Unified graph schema — 31 node tables, 28 relation types (+ PDG opt-in)",
	"Scope-resolution pipeline — registry lookup, 3-tier import resolution, MRO",
	"Language providers — import semantics, type config, export checker, MRO strategy",
	"Tree-sitter queries — per-language S-expressions, unified capture tags"
];
function ArchPage() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHead, {
			kicker: "02 / ARCHITECTURE",
			title: "Three faces, one graph.",
			lede: "CLI/MCP native core, a thin React explorer, and shared contracts. Ingestion builds a KnowledgeGraph; LadybugDB stores it; LocalBackend answers every query path."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "PACKAGES"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 grid gap-3 md:grid-cols-2",
			children: PACKAGES.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "font-mono text-[11px] text-signal",
					children: p.path
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "mt-1 text-lg font-semibold text-paper",
					children: p.id
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm leading-relaxed text-muted",
					children: p.role
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 font-mono text-[11px] text-muted",
					children: p.npm
				})
			] }, p.id))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "LAYERS"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 space-y-3",
			children: LAYERS.map((l, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				className: "flex flex-col gap-2 md:flex-row md:gap-8",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "font-mono text-[11px] text-signal",
					children: ["L", i]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "font-semibold text-paper",
						children: l.name
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-mono text-[11px] text-muted",
						children: l.path
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm leading-relaxed text-muted",
						children: l.body
					})
				] })]
			}, l.name))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "CONTROL FLOW"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 grid gap-4",
			children: FLOWS.map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "font-semibold text-paper",
				children: f.title
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
				className: "mt-3 space-y-2",
				children: f.steps.map((s, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "flex gap-3 text-sm leading-relaxed text-muted",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "font-mono text-[11px] text-signal",
						children: String(i + 1).padStart(2, "0")
					}), s]
				}, s))
			})] }, f.title))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "ABSTRACTION STACK"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
			className: "mt-4 space-y-0 border border-line",
			children: ABSTRACTION_STACK.map((s, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
				className: "flex gap-4 border-b border-line px-4 py-3 last:border-0",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "font-mono text-[11px] text-signal",
					children: i + 1
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "text-sm text-paper",
					children: s
				})]
			}, s))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "ON-DISK LAYOUT"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mt-4 grid gap-4 md:grid-cols-2",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "font-semibold text-paper",
				children: "Per repo"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-3 space-y-2 font-mono text-xs text-muted",
				children: STORAGE.repo.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "text-signal",
					children: r.path
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "block text-[11px]",
					children: r.note
				})] }, r.path))
			})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "font-semibold text-paper",
				children: "Global"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-3 space-y-2 font-mono text-xs text-muted",
				children: STORAGE.global.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "text-signal",
					children: r.path
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "block text-[11px]",
					children: r.note
				})] }, r.path))
			})] })]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "WHERE TO CHANGE WHAT"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 overflow-x-auto border border-line",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
				className: "w-full min-w-[720px] text-left text-sm",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
					className: "bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "px-4 py-3",
						children: "Concern"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "px-4 py-3",
						children: "Start here"
					})] })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: WHERE_TO_CHANGE.map((w) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
					className: "border-t border-line",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "px-4 py-3 text-paper",
						children: w.concern
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "px-4 py-3 font-mono text-xs text-signal",
						children: w.start
					})]
				}, w.concern)) })]
			})
		})
	] });
}
//#endregion
export { ArchPage as component };
