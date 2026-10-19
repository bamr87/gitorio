import { x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as PageHead, r as Panel } from "./router-2D7qrjqM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/packages-BfNd01Ml.js
var import_jsx_runtime = require_jsx_runtime();
var TREE = [
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
			"vendor/ — optional grammars"
		]
	},
	{
		path: "gitnexus-web/",
		children: [
			"src/App.tsx — explorer shell",
			"src/components/ — graph canvas, chat, inspect",
			"src/core/ — WASM indexer glue (browser)",
			"src/services/ — HTTP client to gitnexus serve",
			"src/i18n + locales/"
		]
	},
	{
		path: "gitnexus-shared/",
		children: [
			"src/languages.ts",
			"src/scope-resolution/parsed-file.ts",
			"graph and capture contracts"
		]
	},
	{
		path: "repo root",
		children: [
			"ARCHITECTURE.md, AGENTS.md, GUARDRAILS.md, DoD.md, TESTING.md, MIGRATION.md, RUNBOOK.md",
			"eval/ — Python tool-use harness",
			"pr-swarm-review/ — CI review personas",
			".claude/skills + gitnexus-claude-plugin/",
			"Dockerfile.cli, Dockerfile.web, docker-compose.yaml, render.yaml"
		]
	}
];
var HTTP_API = [
	{
		method: "GET",
		path: "/api/repos",
		purpose: "Registry listing (what the web UI opens on)."
	},
	{
		method: "GET",
		path: "/api/repos/:name/graph",
		purpose: "Subgraph for Sigma (nodes/edges, cluster colors)."
	},
	{
		method: "POST",
		path: "/api/tools/:tool",
		purpose: "Invoke LocalBackend tools with JSON args."
	},
	{
		method: "GET",
		path: "/api/resources/*",
		purpose: "MCP resources over HTTP."
	},
	{
		method: "POST",
		path: "/mcp",
		purpose: "Streamable HTTP MCP (mcp-http.ts) for non-stdio clients."
	}
];
function PackagesPage() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHead, {
			kicker: "11 / PACKAGE MAP",
			title: "Where every concern lives.",
			lede: "Rebuild the tree in this shape. gitnexus-shared must build before gitnexus and gitnexus-web."
		}),
		TREE.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "mb-8",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-mono text-sm text-signal",
				children: t.path
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-3 border border-line",
				children: t.children.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					className: "border-b border-line px-4 py-2.5 font-mono text-xs text-paper last:border-0",
					children: c
				}, c))
			})]
		}, t.path)),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "HTTP BRIDGE"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-2 text-sm text-muted",
			children: "gitnexus serve — Express 5 wrapping LocalBackend."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 overflow-x-auto border border-line",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
				className: "w-full min-w-[640px] text-left text-sm",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
					className: "bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "px-4 py-3",
							children: "Method"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "px-4 py-3",
							children: "Path"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "px-4 py-3",
							children: "Purpose"
						})
					] })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: HTTP_API.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
					className: "border-t border-line",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "px-4 py-3 font-mono text-xs text-signal",
							children: r.method
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "px-4 py-3 font-mono text-xs text-paper",
							children: r.path
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "px-4 py-3 text-muted",
							children: r.purpose
						})
					]
				}, r.path)) })]
			})
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, {
			className: "mt-6",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Web UI never talks to LadybugDB directly. All queries go through this HTTP API (or, in the hosted WASM explorer, through in-browser ports of the same pipeline)."
			})
		})
	] });
}
//#endregion
export { PackagesPage as component };
