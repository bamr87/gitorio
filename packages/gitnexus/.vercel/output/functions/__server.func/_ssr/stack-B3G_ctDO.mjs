import { x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as PageHead, r as Panel } from "./router-2D7qrjqM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/stack-B3G_ctDO.js
var import_jsx_runtime = require_jsx_runtime();
var STACK = [
	{
		layer: "Runtime",
		items: [{
			name: "Node.js",
			ver: "^22.18 || >=24.11",
			why: "CLI, workers, native addons (tree-sitter, LadybugDB, onnxruntime)."
		}, {
			name: "Browser",
			ver: "Chromium-class + WebGPU optional",
			why: "WASM tree-sitter + LadybugDB + transformers.js for the hosted UI."
		}]
	},
	{
		layer: "Language",
		items: [{
			name: "TypeScript",
			ver: "5.x (CLI) / 5.4 (web)",
			why: "Whole monorepo. gitnexus-shared is the contract package."
		}]
	},
	{
		layer: "Parsing",
		items: [
			{
				name: "tree-sitter",
				ver: "0.21.1",
				why: "Native bindings in CLI. Per-language grammars (TS, JS, Py, Java, Go, Rust, PHP, Ruby, C#, C, C++)."
			},
			{
				name: "tree-sitter-wasms",
				ver: "0.1.x",
				why: "Browser parse path."
			},
			{
				name: "Vendored grammars",
				ver: "postinstall",
				why: "Dart, Proto, Swift, Kotlin — skippable without a C++ toolchain."
			}
		]
	},
	{
		layer: "Graph DB",
		items: [{
			name: "@ladybugdb/core",
			ver: "^0.19",
			why: "Embedded graph + Cypher + FTS. Native CLI, WASM web. Replaced KuzuDB (see MIGRATION.md)."
		}]
	},
	{
		layer: "In-memory graph",
		items: [{
			name: "graphology",
			ver: "^0.26",
			why: "Clustering (Leiden), web layout (FA2, noverlap), indices."
		}]
	},
	{
		layer: "Search / embeddings",
		items: [{
			name: "Snowflake arctic-embed-xs",
			ver: "384D",
			why: "Local embeddings. CLI: onnxruntime-node. Web: transformers.js + WebGPU/WASM."
		}, {
			name: "BM25 + RRF",
			ver: "K=60",
			why: "Hybrid fusion in src/core/search/."
		}]
	},
	{
		layer: "MCP / HTTP",
		items: [
			{
				name: "@modelcontextprotocol/sdk",
				ver: "^1.0",
				why: "stdio MCP server."
			},
			{
				name: "express",
				ver: "^5.2",
				why: "gitnexus serve HTTP + mcp-http bridge. cors, rate-limit, busboy uploads."
			},
			{
				name: "commander",
				ver: "^15",
				why: "CLI parser."
			},
			{
				name: "pino",
				ver: "^10",
				why: "Structured logs."
			}
		]
	},
	{
		layer: "Web UI",
		items: [
			{
				name: "React",
				ver: "19.2",
				why: "gitnexus-web."
			},
			{
				name: "Vite",
				ver: "8.x",
				why: "Dev/build. Tailwind v4 via @tailwindcss/vite."
			},
			{
				name: "sigma + @sigma/edge-curve",
				ver: "3.x",
				why: "WebGL graph rendering."
			},
			{
				name: "LangChain + LangGraph",
				ver: "1.x",
				why: "ReAct agent chat (Anthropic, OpenAI, Gemini, Ollama)."
			},
			{
				name: "mermaid / react-markdown",
				ver: "11 / 10",
				why: "Chat diagrams and GFM. DOMPurify on HTML."
			},
			{
				name: "i18next",
				ver: "26",
				why: "UI localization."
			}
		]
	},
	{
		layer: "Quality",
		items: [
			{
				name: "vitest",
				ver: "CLI + web",
				why: "Unit + integration. Integration hits a real LadybugDB."
			},
			{
				name: "playwright",
				ver: "web e2e",
				why: "gitnexus-web/test:e2e."
			},
			{
				name: "eslint + prettier + husky",
				ver: "monorepo root",
				why: "Pre-commit format + typecheck on staged files. Tests run in CI, not pre-commit."
			}
		]
	},
	{
		layer: "Ship",
		items: [
			{
				name: "npm package gitnexus",
				ver: "1.6.10",
				why: "bin gitnexus → dist/cli/index.js. prepare/prepack build + grammar coverage assert."
			},
			{
				name: "Docker",
				ver: "Dockerfile.cli / .web + compose",
				why: "ghcr images, render.yaml for hosted web."
			},
			{
				name: "Vercel",
				ver: "gitnexus-web",
				why: "Hosted WASM explorer at gitnexus.vercel.app."
			}
		]
	}
];
var ENV = [
	{
		key: "GITNEXUS_SKIP_OPTIONAL_GRAMMARS",
		meaning: "Install without compiling Dart/Swift/Kotlin grammars."
	},
	{
		key: "GITNEXUS_WORKER_POOL_SIZE",
		meaning: "Worker count. 0 is rejected."
	},
	{
		key: "GITNEXUS_KEEP_LOCAL_VALUE_SYMBOLS",
		meaning: "Disable pruneLocalSymbols globally."
	},
	{
		key: "GITNEXUS_MAX_INTERFACE_DISPATCH_FANOUT",
		meaning: "Default 32."
	},
	{
		key: "GITNEXUS_AUTH_TOKEN",
		meaning: "Required for eval-server off-loopback."
	},
	{
		key: "PROF_SCOPE_RESOLUTION",
		meaning: "Emit hit/miss counters for the tree cache."
	},
	{
		key: "VALIDATE_SEMANTIC_MODEL",
		meaning: "Set 0 to skip ownership-parity checks in dev."
	},
	{
		key: "PARSE_CACHE_VERSION",
		meaning: "Bump when ParsedFile wire format changes (receiver-chain v2, callable facts)."
	}
];
function StackPage() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHead, {
			kicker: "10 / FRAMEWORKS & STACK",
			title: "Pin these. Don't improvise the database.",
			lede: "The published CLI is Node + tree-sitter + LadybugDB + MCP. The web app is a thin Vite/React client. Embeddings are local arctic-embed-xs, never a hosted vector DB."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "grid gap-8",
			children: STACK.map((g) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-mono text-[11px] tracking-[0.2em] text-signal",
				children: g.layer
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-3 grid gap-3",
				children: g.items.map((it) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-wrap items-baseline justify-between gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "font-semibold text-paper",
						children: it.name
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "font-mono text-[11px] text-signal",
						children: it.ver
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-muted",
					children: it.why
				})] }, it.name))
			})] }, g.layer))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "ENVIRONMENT"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 overflow-x-auto border border-line",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
				className: "w-full min-w-[640px] text-left text-sm",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
					className: "bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "px-4 py-3",
						children: "Variable"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "px-4 py-3",
						children: "Meaning"
					})] })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: ENV.map((e) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
					className: "border-t border-line",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "px-4 py-3 font-mono text-xs text-signal",
						children: e.key
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "px-4 py-3 text-paper",
						children: e.meaning
					})]
				}, e.key)) })]
			})
		})
	] });
}
//#endregion
export { StackPage as component };
