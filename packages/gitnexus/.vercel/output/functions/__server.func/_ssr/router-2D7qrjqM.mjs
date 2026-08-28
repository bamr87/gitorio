import { i as __toESM } from "../_runtime.mjs";
import { B as require_react, _ as createRootRoute, b as useRouter, d as useRouterState, g as createFileRoute, h as lazyRouteComponent, l as Scripts, m as Outlet, p as createRouter, u as HeadContent, v as Link, x as require_jsx_runtime, y as useNavigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { i as Menu, n as TriangleAlert, r as Search, t as X } from "../_libs/lucide-react.mjs";
import { a as union, i as string, n as number, r as object, t as literal } from "../_libs/zod.mjs";
import { t as clsx } from "../_libs/clsx.mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/router-2D7qrjqM.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
function AppErrorComponent({ error }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "text-red-500",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TriangleAlert, {
					className: "size-10",
					strokeWidth: 2
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-lg font-semibold",
				children: "Something went wrong"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400",
				children: error.message || "An unexpected error occurred. Try reloading the page."
			})
		]
	});
}
/**
* App-wide client provider mounted once near the root (in `src/routes/__root.tsx`):
*
*   <AuthProvider><Outlet /></AuthProvider>
*
* Better Auth's React client (`@/lib/auth/client`) needs NO context provider —
* its `useSession()` works standalone — so this is a passthrough today. It's
* kept as the single, stable mount point for any future client-side providers
* (e.g. a toast or theme provider) without churning the root shell.
*/
function AuthProvider({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children });
}
function isGrokEmbedderOrigin(origin) {
	try {
		const url = new URL(origin);
		if (url.protocol !== "https:" && url.protocol !== "http:") return false;
		const host = url.hostname.toLowerCase();
		if (host === "grok.com" || host.endsWith(".grok.com")) return true;
		if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
		return false;
	} catch {
		return false;
	}
}
function isSandboxPreviewGuestHost(hostname) {
	const host = hostname.toLowerCase();
	return host === "grok-sandbox.com" || host.endsWith(".grok-sandbox.com");
}
function isRemintPreviewPair(guestHost, parentHost) {
	const guest = guestHost.toLowerCase();
	const parent = parentHost.toLowerCase();
	const i = guest.indexOf(".preview.");
	if (i <= 0) return false;
	const label = guest.slice(0, i);
	const rest = guest.slice(i + 9);
	if (label.includes(".") || !rest.includes(".")) return false;
	return parent === rest || parent === `grok.${rest}`;
}
function resolveParentEmbedderOrigin(parentIsSelf, referrer, ancestorOrigin, guestHostname = "") {
	if (parentIsSelf) return null;
	for (const candidate of [referrer, ancestorOrigin ?? ""].filter(Boolean)) try {
		const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
		if (url.protocol !== "https:" && url.protocol !== "http:") continue;
		if (isGrokEmbedderOrigin(url.origin)) return url.origin;
		if (isSandboxPreviewGuestHost(guestHostname) || isRemintPreviewPair(guestHostname, url.hostname)) return url.origin;
	} catch {}
	return null;
}
/**
* Guest side of the grok-web ↔ sandbox preview postMessage bridge.
*
* Activates only when this page is framed by an allowlisted Grok embedder.
* Top-level runs (download/export, local `npm run dev`, deployed sites) noop.
*/
var PREVIEW_BRIDGE_CHANNEL = "grok-preview-bridge";
var EnvelopeSchema = object({
	channel: literal(PREVIEW_BRIDGE_CHANNEL),
	version: number().int().positive(),
	type: string().min(1)
});
var HelloSchema = EnvelopeSchema.extend({ type: literal("hello") });
var NavigateSchema = EnvelopeSchema.extend({
	type: literal("navigate"),
	path: string().min(1)
});
var HistorySchema = EnvelopeSchema.extend({
	type: literal("history"),
	delta: union([literal(-1), literal(1)])
});
function isSafeBridgePath(path) {
	if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
	try {
		return new URL(path, "https://preview.invalid").origin === "https://preview.invalid";
	} catch {
		return false;
	}
}
/**
* Install host↔guest messaging. Returns a dispose function.
* Noops (returns a no-op dispose) when not embedded under a Grok parent.
*/
function installPreviewHostBridge(options = {}) {
	if (typeof window === "undefined") return () => {};
	const ancestorOrigin = typeof location.ancestorOrigins !== "undefined" && location.ancestorOrigins.length > 0 ? location.ancestorOrigins[0] : null;
	const parentOrigin = resolveParentEmbedderOrigin(window.parent === window, document.referrer, ancestorOrigin, window.location.hostname);
	if (parentOrigin === null) return () => {};
	const ROOT_STATE_KEY = "__grokPreviewBridgeRoot";
	const originalPushState = window.history.pushState.bind(window.history);
	const originalReplaceState = window.history.replaceState.bind(window.history);
	const isAtHistoryRoot = () => {
		const state = window.history.state;
		return Boolean(state && typeof state === "object" && state[ROOT_STATE_KEY] === true);
	};
	try {
		const current = window.history.state;
		if (!(current !== null && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, ROOT_STATE_KEY))) {
			const isRoot = window.history.length <= 1;
			originalReplaceState(current && typeof current === "object" ? {
				...current,
				[ROOT_STATE_KEY]: isRoot
			} : { [ROOT_STATE_KEY]: isRoot }, "", window.location.href);
		}
	} catch {}
	const post = (message) => {
		window.parent.postMessage(message, parentOrigin);
	};
	const reportLocation = () => {
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "location",
			path: window.location.pathname || "/",
			search: window.location.search,
			hash: window.location.hash
		});
	};
	const reportRoutes = () => {
		const paths = options.getRoutePaths?.() ?? [];
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "routes",
			paths
		});
	};
	const defaultNavigate = (path) => {
		if (!isSafeBridgePath(path)) return;
		try {
			const url = new URL(path, window.location.origin);
			if (url.origin !== window.location.origin) return;
			const next = `${url.pathname}${url.search}${url.hash}`;
			window.history.pushState(window.history.state, "", next);
			window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
		} catch {}
	};
	const navigate = (path) => {
		if (!isSafeBridgePath(path)) return;
		if (options.navigate) {
			options.navigate(path);
			return;
		}
		defaultNavigate(path);
	};
	const announce = () => {
		reportLocation();
		reportRoutes();
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "ready"
		});
	};
	const onMessage = (event) => {
		if (event.source !== window.parent) return;
		if (event.origin !== parentOrigin) return;
		const envelope = EnvelopeSchema.safeParse(event.data);
		if (!envelope.success || envelope.data.version !== 1) return;
		if (envelope.data.type === "hello") {
			if (!HelloSchema.safeParse(event.data).success) return;
			announce();
			return;
		}
		if (envelope.data.type === "navigate") {
			const parsed = NavigateSchema.safeParse(event.data);
			if (!parsed.success) return;
			navigate(parsed.data.path);
			queueMicrotask(reportLocation);
			return;
		}
		if (envelope.data.type === "history") {
			const parsed = HistorySchema.safeParse(event.data);
			if (!parsed.success) return;
			if (parsed.data.delta === -1 && isAtHistoryRoot()) return;
			window.history.go(parsed.data.delta);
		}
	};
	const onPopState = () => {
		reportLocation();
	};
	const onHashChange = () => {
		reportLocation();
	};
	window.history.pushState = (data, unused, url) => {
		const next = data && typeof data === "object" ? {
			...data,
			[ROOT_STATE_KEY]: false
		} : data;
		originalPushState(next, unused, url);
		reportLocation();
	};
	window.history.replaceState = (data, unused, url) => {
		const next = isAtHistoryRoot() ? {
			...data && typeof data === "object" ? data : {},
			[ROOT_STATE_KEY]: true
		} : data;
		originalReplaceState(next, unused, url);
		reportLocation();
	};
	window.addEventListener("message", onMessage);
	window.addEventListener("popstate", onPopState);
	window.addEventListener("hashchange", onHashChange);
	announce();
	return () => {
		window.removeEventListener("message", onMessage);
		window.removeEventListener("popstate", onPopState);
		window.removeEventListener("hashchange", onHashChange);
		window.history.pushState = originalPushState;
		window.history.replaceState = originalReplaceState;
	};
}
/** Collect static path patterns from a TanStack route tree (best-effort). */
function collectRoutePathsFromTree(routeTree) {
	const paths = /* @__PURE__ */ new Set();
	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		const record = node;
		const full = typeof record.fullPath === "string" ? record.fullPath : typeof record.path === "string" ? record.path : null;
		if (full !== null && full !== "") paths.add(full.startsWith("/") ? full : `/${full}`);
		else if (full === "") paths.add("/");
		const children = record.children;
		if (Array.isArray(children)) for (const child of children) walk(child);
		else if (children && typeof children === "object") for (const child of Object.values(children)) walk(child);
	};
	walk(routeTree);
	return [...paths];
}
/**
* Mount once in `__root.tsx` so the Grok preview chrome can drive navigation
* (and later receive registered routes). Noops when the app is not embedded.
*/
function PreviewHostBridge() {
	const router = useRouter();
	(0, import_react.useEffect)(() => {
		return installPreviewHostBridge({
			navigate: (path) => {
				router.history.push(path);
			},
			getRoutePaths: () => collectRoutePathsFromTree(router.routeTree)
		});
	}, [router]);
	return null;
}
var APP = {
	name: "Nexus Forge",
	product: "GitNexus",
	version: "1.6.10",
	source: "https://github.com/abhigyanpatwari/GitNexus",
	live: "https://gitnexus.vercel.app",
	stars: "46,140",
	forks: "5,099",
	engines: "Node ^22.18.0 || >=24.11.0",
	license: "Custom (see LICENSE in source repo)",
	snapshot: "2026-08-28 · main @ b059ab3"
};
var NAV = [
	{
		id: "overview",
		href: "/",
		label: "Overview",
		kicker: "00"
	},
	{
		id: "prd",
		href: "/prd",
		label: "PRD",
		kicker: "01"
	},
	{
		id: "architecture",
		href: "/architecture",
		label: "Architecture",
		kicker: "02"
	},
	{
		id: "features",
		href: "/features",
		label: "Features",
		kicker: "03"
	},
	{
		id: "pipeline",
		href: "/pipeline",
		label: "Pipeline DAG",
		kicker: "04"
	},
	{
		id: "schema",
		href: "/schema",
		label: "Graph Schema",
		kicker: "05"
	},
	{
		id: "models",
		href: "/models",
		label: "Models",
		kicker: "06"
	},
	{
		id: "mcp",
		href: "/mcp",
		label: "MCP Surface",
		kicker: "07"
	},
	{
		id: "cli",
		href: "/cli",
		label: "CLI",
		kicker: "08"
	},
	{
		id: "languages",
		href: "/languages",
		label: "Languages",
		kicker: "09"
	},
	{
		id: "stack",
		href: "/stack",
		label: "Stack",
		kicker: "10"
	},
	{
		id: "packages",
		href: "/packages",
		label: "Packages",
		kicker: "11"
	},
	{
		id: "playbook",
		href: "/playbook",
		label: "Rebuild Playbook",
		kicker: "12"
	},
	{
		id: "quality",
		href: "/quality",
		label: "Quality Bar",
		kicker: "13"
	}
];
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
var PRD = {
	name: "GitNexus",
	tagline: "The nervous system for agent context.",
	oneLiner: "A local-first code intelligence engine that indexes any repository into a knowledge graph — every dependency, call chain, cluster, and execution flow — then exposes that graph to AI agents through MCP, CLI, and a browser explorer.",
	problem: [
		{
			title: "Agents edit blind",
			body: "A single function change can silently break dozens of downstream callers. LLMs see files and snippets, not the structural map of the system. They grep, miss a call chain, and ship a regression."
		},
		{
			title: "Docs are descriptions, not relations",
			body: "Wiki-style tools summarize what a module is. They do not track that Route X is handled by Method Y which CALLS Service Z which QUERIES Table T. Agents need edges, not prose."
		},
		{
			title: "Token waste and model lock-in",
			body: "Without a graph, agents spend context on multi-hop grep. Larger models compensate by reading more files. A precomputed graph lets smaller models answer blast-radius questions in one tool call."
		},
		{
			title: "Privacy and server cost",
			body: "Uploading a private codebase to a hosted indexer is a non-starter for many teams. Indexing must run on the developer machine (CLI) or entirely in the browser (WASM)."
		}
	],
	vision: "Every coding agent — Cursor, Claude Code, Codex, Windsurf, Gemini — opens a repo with a structural map already computed. Impact, trace, rename, taint, and route mapping are first-class tools. The graph is the source of truth; the LLM is the reasoner on top of it.",
	users: [
		{
			persona: "Staff engineer on a large monorepo",
			need: "Know blast radius before touching a shared service. Refactor without tribal knowledge.",
			job: "Runs `gitnexus analyze --embeddings --skills`, then asks the agent to impact-check every edit."
		},
		{
			persona: "AI coding agent (Claude Code, Cursor, Codex)",
			need: "Reliable structural context: callers, callees, processes, clusters, contracts across repos.",
			job: "Calls MCP tools `context`, `impact`, `query`, `trace` instead of grep. Follows installed skills."
		},
		{
			persona: "New teammate / explorer",
			need: "See how a codebase is actually wired without reading every file.",
			job: "Opens the Web UI graph, clicks a cluster, follows a process from route to sink."
		},
		{
			persona: "Platform / multi-service owner",
			need: "Cross-repo impact: if this HTTP contract changes, which consumer breaks?",
			job: "Creates a group, syncs the contract registry, queries with `repo: @platform`."
		}
	],
	goals: [
		"Index a multi-language repo into a queryable knowledge graph without an LLM in the indexer.",
		"Expose the graph through MCP (stdio), HTTP, and CLI with identical semantics.",
		"Answer blast-radius, call-chain, and search questions in one tool call.",
		"Keep source on-device: native LadybugDB on CLI, WASM in the browser.",
		"Plug a new language in via LanguageProvider + ScopeResolver — no shared-code language names.",
		"Support multi-repo groups via a contract bridge, not a merged mega-graph."
	],
	nonGoals: [
		"GitNexus is not an IDE, not a linter, not a hosted SaaS requirement for the OSS product.",
		"The CLI indexer does not call an LLM. Wiki generation is a separate, opt-in command.",
		"It is not a substitute for a typechecker. Confidence tiers exist; UNKNOWN is not safe.",
		"Full cross-program (SDG-like) data flow across repo boundaries is deferred.",
		"Do not invent routes. A missing route is a coverage limit; an invented one is a lie."
	],
	principles: [
		{
			name: "Graph first, language second",
			body: "16 languages feed one schema (node tables + CodeRelation). Shared ingestion never branches on a language name."
		},
		{
			name: "Precision over recall for facts",
			body: "route_map, HANDLES_ROUTE, and CALLS edges are presented as fact. Heuristics that cannot be proven are dropped."
		},
		{
			name: "Three faces, one backend",
			body: "MCP, HTTP (`gitnexus serve`), and CLI tools (`query|context|impact|cypher`) share LocalBackend."
		},
		{
			name: "Local by default",
			body: "Index lives in `<repo>/.gitnexus/`. Registry in `~/.gitnexus/registry.json`. No upload required."
		},
		{
			name: "Workers are the only parse path",
			body: "`--workers 0` is rejected. Tree-sitter buffers are not GC-reclaimable on the main thread."
		},
		{
			name: "Impact before edit",
			body: "Agent skills require `impact` before changing a symbol and `detect_changes` before commit."
		}
	],
	success: [
		{
			metric: "Index completeness",
			target: "Symbols, imports, calls, heritage, routes, processes present for supported languages on a golden fixture repo."
		},
		{
			metric: "Tool reliability",
			target: "MCP `impact` and `context` return callers/callees that match the graph; UNKNOWN risk is never treated as safe."
		},
		{
			metric: "Agent setup time",
			target: "`gitnexus setup` configures Claude Code, Cursor, and peers in one command."
		},
		{
			metric: "Privacy",
			target: "CLI never ships source off-box. Web WASM path never uploads the zip."
		},
		{
			metric: "Language extensibility",
			target: "Adding a language = ScopeResolver + LanguageProvider + tree-sitter queries. CI auto-discovers SCOPE_RESOLVERS."
		}
	],
	constraints: [
		"Node ^22.18.0 || >=24.11.0 for the published CLI.",
		"LadybugDB (`@ladybugdb/core`) for persistence — native in CLI, WASM in web.",
		"Tree-sitter 0.21.x with per-language grammars; optional grammars skippable without a C++ toolchain.",
		"Embeddings: Snowflake arctic-embed-xs (384D) via transformers.js / onnxruntime. Opt-in, skipped above ~50k nodes.",
		"MCP via `@modelcontextprotocol/sdk` over stdio. HTTP bridge is Express 5.",
		"Web UI is a thin client: React 19, Vite, Sigma.js + Graphology, LangChain for chat."
	],
	journeys: [
		{
			name: "First index → agent that can see",
			steps: [
				"Install globally: `npm install -g gitnexus`.",
				"From a repo root: `gitnexus analyze --embeddings --skills`.",
				"One-time: `gitnexus setup` (auto-detects editors).",
				"Open Cursor / Claude Code. Agent calls `list_repos`, then `query` / `impact`.",
				"Index lives in `.gitnexus/`; repo is registered in `~/.gitnexus/registry.json`."
			]
		},
		{
			name: "Explore in the browser",
			steps: [
				"Either drop a zip / Git URL into gitnexus.vercel.app (WASM, ~5k file cap), or",
				"`gitnexus serve` after a CLI index — the UI talks HTTP to the local backend, no re-upload.",
				"Inspect clusters (Leiden communities), processes (entry→sink flows), and chat over the graph."
			]
		},
		{
			name: "Cross-repo blast radius",
			steps: [
				"`gitnexus group create platform` then `group add` each service.",
				"`gitnexus group sync platform` rebuilds contracts.json + bridge graph.",
				"MCP `impact` with `repo: \"@platform\"` walks locally then fans out across ContractLink hops."
			]
		}
	]
};
var FEATURES = [
	{
		id: "index",
		name: "Repository indexing",
		layer: "ingestion",
		status: "core",
		summary: "Walk a git repo or folder, honor ignore rules, emit File/Folder nodes, parse every supported source file through the worker pool.",
		details: [
			"`gitnexus analyze [path]` is the entry. `--force` rebuilds even if HEAD matches lastCommit.",
			"Workers are mandatory. Chunked ~20 MB to bound RAM. Disk-backed ParsedFile store for large repos (Linux kernel class).",
			"`--skip-git` indexes without reading git metadata. `--default-branch` pins the branch name stored in the registry."
		]
	},
	{
		id: "ast",
		name: "Tree-sitter AST extraction",
		layer: "ingestion",
		status: "core",
		summary: "Per-language S-expression queries produce unified capture tags. Downstream extractors never switch on language names.",
		details: [
			"Native tree-sitter in CLI, WASM in the browser.",
			"Optional grammars (Dart, Proto, Swift, Kotlin) skippable via GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1.",
			"COBOL is regex-only — no tree-sitter, ScopeResolver in callable-flow-only mode."
		]
	},
	{
		id: "resolve",
		name: "Import, call, and heritage resolution",
		layer: "ingestion",
		status: "core",
		summary: "3-tier import resolution, receiver-bound then free-call emission, MRO, interface-dispatch with generic-instantiation awareness.",
		details: [
			"ScopeResolver hooks: populateOwners, buildMro, resolveImportTarget, arityCompatibility, elementTypeOf, stripTypePreservingDecoration.",
			"Callable-value flow is language-neutral inclusion analysis. Cap 32 targets. No partial CALLS on exhaustion.",
			"Unresolved in-program receivers are counted and published as epistemic: exact | lower-bound on impact/context."
		]
	},
	{
		id: "routes",
		name: "Route extraction",
		layer: "ingestion",
		status: "core",
		summary: "Four independent sources converge on a (method, url) registry: filesystem convention, single-file framework, cross-file framework, AST/dispatch-guard.",
		details: [
			"Next.js app/, Expo, PHP, Laravel, Django, Spring, FastAPI, NestJS, raw node:http dispatch tables.",
			"Precision-weighted: startsWith namespace tests, verb-less pathname === '/', and untranslatable regex are dropped.",
			"Same-file constant folding (one alias hop, string literals only) to keep template paths."
		]
	},
	{
		id: "clusters",
		name: "Leiden communities",
		layer: "graph",
		status: "core",
		summary: "Functional clusters via Leiden on the resolved graph. Community nodes + MEMBER_OF. Feeds generated skills and the clusters resource.",
		details: ["graphology + leiden. Cohesion scores exposed on gitnexus://repo/{name}/clusters."]
	},
	{
		id: "processes",
		name: "Execution processes",
		layer: "graph",
		status: "core",
		summary: "Walk from entry points (routes, tools, mains) to produce Process nodes and STEP_IN_PROCESS edges.",
		details: ["Surfaced as gitnexus://repo/{name}/processes and in the `context` tool."]
	},
	{
		id: "search",
		name: "Hybrid search",
		layer: "search",
		status: "core",
		summary: "BM25 full-text over FTS tables plus 384D arctic-embed-xs vectors, fused with RRF K=60.",
		details: [
			"Embeddings opt-in (`--embeddings`), skipped above ~50k nodes, incremental by SHA1.",
			"Embeddable kinds: File, Function, Class, Method, Interface.",
			"Group-mode query merges per-repo lists with RRF."
		]
	},
	{
		id: "mcp-tools",
		name: "MCP tool surface",
		layer: "mcp",
		status: "core",
		summary: "17 tools over stdio. Same LocalBackend as HTTP and CLI. Per-repo tools accept repo, branch, maxTokens.",
		details: ["See MCP Surface. Resources and two prompts (detect_impact, generate_map) ship alongside tools."]
	},
	{
		id: "impact",
		name: "Blast-radius impact",
		layer: "mcp",
		status: "core",
		summary: "Upstream/downstream walk with risk summary, confidence, epistemic bounds.",
		details: [
			"direction, minConfidence, maxDepth, relationTypes, includeTests, summaryOnly.",
			"Group mode: local walk then Contract Bridge fan-out (MAX_SUPPORTED_CROSS_DEPTH = 1).",
			"HIGH/CRITICAL blocks agent edits. UNKNOWN requires human confirmation."
		]
	},
	{
		id: "rename",
		name: "Graph-assisted rename",
		layer: "mcp",
		status: "core",
		summary: "Multi-file rename using graph occurrences, with dry_run preview. Agents must not find-and-replace.",
		details: ["Parameters: symbol_name, new_name, dry_run, repo, branch."]
	},
	{
		id: "detect",
		name: "detect_changes",
		layer: "mcp",
		status: "core",
		summary: "Map a git diff to affected symbols and processes. Required before commit in agent skills.",
		details: ["scope, git_ref / base_ref. scope: compare for regression review."]
	},
	{
		id: "api",
		name: "API intelligence",
		layer: "mcp",
		status: "core",
		summary: "route_map, tool_map, shape_check, api_impact — handler↔consumer mapping and response-shape mismatch.",
		details: ["shape_check compares an API response against consumer property access."]
	},
	{
		id: "cypher",
		name: "Ad-hoc Cypher",
		layer: "mcp",
		status: "core",
		summary: "Raw Cypher against LadybugDB using the documented schema. Schema resource is gitnexus://repo/{name}/schema.",
		details: ["Also `gitnexus cypher` on the CLI."]
	},
	{
		id: "cli",
		name: "CLI product",
		layer: "cli",
		status: "cli-only",
		summary: "analyze, setup, mcp, serve, wiki, group, doctor, list, status, clean, uninstall, plus direct tool commands.",
		details: ["Bin: dist/cli/index.js. commander. i18n help. Global install recommended so MCP startup is fast."]
	},
	{
		id: "setup",
		name: "Editor auto-setup",
		layer: "cli",
		status: "cli-only",
		summary: "gitnexus setup writes MCP config for Claude Code, Cursor, and peers. uninstall previews then removes.",
		details: ["-c to select agents. Skills copied into .claude/skills and .agents/skills when those dirs exist."]
	},
	{
		id: "web-graph",
		name: "Web graph explorer",
		layer: "web",
		status: "web-only",
		summary: "Sigma.js + Graphology WebGL explorer. Clusters, processes, symbol inspect, mermaid in chat.",
		details: [
			"Thin client. Local backend via gitnexus serve, or WASM indexer in-browser (memory-capped ~5k files).",
			"LangChain ReAct chat with Anthropic / OpenAI / Gemini / Ollama.",
			"i18n. DOMPurify on markdown. No source upload in WASM mode."
		]
	},
	{
		id: "groups",
		name: "Multi-repo groups",
		layer: "groups",
		status: "core",
		summary: "Named groups, contract registry, bridge graph. query/context/impact/trace accept repo: @group.",
		details: [
			"No group_* query tools — group state is resources: gitnexus://group/{name}/contracts|status.",
			"Cross-repo trace stitches one CONTRACT_LINK hop on Contract.symbolUid.",
			"PDG enrichment at a boundary is intra-procedural only."
		]
	},
	{
		id: "pdg",
		name: "CFG / PDG / taint",
		layer: "pdg",
		status: "opt-in",
		summary: "`analyze --pdg` emits CFG, REACHING_DEF, CDG, taint layers. Tools: explain, pdg_query.",
		details: [
			"Currently CFG visitors for TypeScript and JavaScript.",
			"Off by default so the default graph is byte-identical. Folded into the parse-cache key.",
			"PDG types stay out of VALID_RELATION_TYPES / the web schema."
		]
	},
	{
		id: "wiki",
		name: "Graph-backed wiki",
		layer: "wiki",
		status: "opt-in",
		summary: "LLM-written architecture wiki from the graph (not from raw files). Separate from the indexer — the indexer never calls an LLM.",
		details: ["`gitnexus wiki` flags: --model, --base-url, --force, --timeout, --retries, --lang, --allow-insecure-connection."]
	},
	{
		id: "skills",
		name: "Agent skills",
		layer: "skills",
		status: "core",
		summary: "Shipped skills (explore, debug, impact, refactor, guide, CLI, PDG, taint, plan, work, review, LFG) plus Leiden-generated repo-specific skills.",
		details: [
			"`--skills` generates cluster skills. `--skip-skills` / `--skip-agents-md` suppress writes.",
			"plan → work → review is the LFG pipeline with a user gate.",
			"Shipped skill text is guarded by shipped-skills-sync tests."
		]
	},
	{
		id: "staleness",
		name: "Index freshness",
		layer: "platform",
		status: "core",
		summary: "Compare indexed lastCommit to HEAD. Surface hints on tools and the context resource.",
		details: ["doctor command diagnoses grammar, DB, and registry issues."]
	},
	{
		id: "incremental",
		name: "Incremental + embedding cache",
		layer: "platform",
		status: "core",
		summary: "Parse cache keyed with PDG flag. Embeddings restored by content hash before generating the delta.",
		details: ["WAL checkpoint threshold configurable. Dirty-recovery sidecars are safe to delete."]
	}
];
var LAYERS = [
	{
		id: "ingestion",
		label: "Ingestion"
	},
	{
		id: "graph",
		label: "Graph"
	},
	{
		id: "search",
		label: "Search"
	},
	{
		id: "mcp",
		label: "MCP"
	},
	{
		id: "cli",
		label: "CLI"
	},
	{
		id: "web",
		label: "Web"
	},
	{
		id: "groups",
		label: "Groups"
	},
	{
		id: "pdg",
		label: "PDG"
	},
	{
		id: "wiki",
		label: "Wiki"
	},
	{
		id: "skills",
		label: "Skills"
	},
	{
		id: "platform",
		label: "Platform"
	}
];
var PHASES = [
	{
		id: "scan",
		file: "scan.ts",
		deps: [],
		output: "File paths + sizes",
		band: 0,
		col: 1
	},
	{
		id: "structure",
		file: "structure.ts",
		deps: ["scan"],
		output: "File/Folder nodes, CONTAINS, allPathSet",
		band: 1,
		col: 1
	},
	{
		id: "springConfig",
		file: "spring-config.ts",
		deps: ["structure"],
		output: "Spring configuration-property nodes",
		band: 2,
		col: 0
	},
	{
		id: "markdown",
		file: "markdown.ts",
		deps: ["structure"],
		output: "Section nodes + cross-links from .md/.mdx",
		band: 2,
		col: 1
	},
	{
		id: "cobol",
		file: "cobol.ts",
		deps: ["structure"],
		output: "COBOL program/paragraph/section (regex, no tree-sitter)",
		band: 2,
		col: 2
	},
	{
		id: "parse",
		file: "parse.ts + parse-impl.ts",
		deps: [
			"structure",
			"markdown",
			"cobol"
		],
		output: "Symbol nodes, IMPORTS/CALLS/EXTENDS, extracted routes/tools/ORM",
		band: 3,
		col: 1
	},
	{
		id: "routes",
		file: "routes.ts",
		deps: ["parse"],
		output: "Route nodes + HANDLES_ROUTE",
		band: 4,
		col: 0
	},
	{
		id: "tools",
		file: "tools.ts",
		deps: ["parse"],
		output: "Tool nodes + HANDLES_TOOL",
		band: 4,
		col: 1
	},
	{
		id: "orm",
		file: "orm.ts",
		deps: ["parse"],
		output: "QUERIES edges (Prisma, Supabase)",
		band: 4,
		col: 2
	},
	{
		id: "crossFile",
		file: "cross-file.ts",
		deps: [
			"parse",
			"routes",
			"tools",
			"orm"
		],
		output: "Cross-file type propagation in import order",
		band: 5,
		col: 1
	},
	{
		id: "scopeResolution",
		file: "scope-resolution/pipeline/phase.ts",
		deps: [
			"parse",
			"crossFile",
			"structure"
		],
		output: "Binding/reference + inheritance edges",
		band: 6,
		col: 1
	},
	{
		id: "springAutoConfiguration",
		file: "spring-auto-configuration.ts",
		deps: ["structure", "scopeResolution"],
		output: "DECLARES + CONDITIONAL_ON",
		band: 7,
		col: 0
	},
	{
		id: "springAop",
		file: "spring-aop.ts",
		deps: ["scopeResolution"],
		output: "ADVISED_BY + pointcut evidence",
		band: 7,
		col: 2
	},
	{
		id: "pruneLocalSymbols",
		file: "prune-local-symbols.ts",
		deps: ["scopeResolution"],
		output: "Drop inert block-local Const/Variable/Static",
		band: 8,
		col: 1
	},
	{
		id: "mro",
		file: "mro.ts",
		deps: [
			"crossFile",
			"scopeResolution",
			"pruneLocalSymbols",
			"structure"
		],
		output: "METHOD_OVERRIDES + METHOD_IMPLEMENTS",
		band: 9,
		col: 1
	},
	{
		id: "springAopInheritance",
		file: "spring-aop.ts",
		deps: ["springAop", "mro"],
		output: "Propagate advice through heritage",
		band: 10,
		col: 2
	},
	{
		id: "di",
		file: "di.ts",
		deps: ["mro"],
		output: "INJECTS edges (framework-neutral)",
		band: 11,
		col: 0
	},
	{
		id: "communities",
		file: "communities.ts",
		deps: [
			"mro",
			"pruneLocalSymbols",
			"structure"
		],
		output: "Community nodes + MEMBER_OF (Leiden)",
		band: 12,
		col: 1
	},
	{
		id: "processes",
		file: "processes.ts",
		deps: [
			"communities",
			"routes",
			"tools",
			"pruneLocalSymbols",
			"structure"
		],
		output: "Process nodes + STEP_IN_PROCESS",
		band: 13,
		col: 1
	}
];
var PDG_PHASES = [{
	id: "taintSummaries",
	note: "Added with --pdg. Source→sink findings for `explain`."
}, {
	id: "callSummaries",
	note: "Added with --pdg. Intra-procedural dependence for `pdg_query`."
}];
var RUNNER_RULES = [
	"Static phase graph. No plugins. Compile-time typed PipelinePhase<T>.",
	"Validation via Kahn topological sort. Rejects duplicate names, missing deps, cycles (DFS prints the cycle).",
	"Sequential execution in topo order. Each phase gets ctx (mutable KnowledgeGraph) and only its declared deps.",
	"getPhaseOutput<T>(deps, 'name') for type-safe upstream results.",
	"BindingAccumulator created in parse, disposed by crossFile in finally.",
	"skipGraphPhases omits MRO/di/communities/processes for faster tests. pruneLocalSymbols still runs.",
	"skipWorkers / --workers 0 / GITNEXUS_WORKER_POOL_SIZE=0 is rejected. Workers are the only parse path."
];
var PARSE_CHUNK = [
	"parse processes files in ~20 MB byte-budget chunks to bound memory.",
	"Worker pool dispatches files. Each worker: detect language → load grammar → run queries → ParseWorkerResult.",
	"Wildcard synthesis, then import resolution, then BindingAccumulator collection.",
	"Inheritance edges are NOT emitted during parse — scope-resolution owns them.",
	"Workers serialize ParsedFile + capture side-channel to a disk-backed store so the main thread never re-parses (tree-sitter buffers leak native memory).",
	"Warm cache-hit runs replay cached worker output without spawning workers."
];
var SCOPE_STAGES = [
	"ParsedFile[] via extractParsedFile per file",
	"finalizeScopeModel (+ provider hooks) → ScopeResolutionIndexes",
	"resolveReferenceSites via MethodRegistry.lookup → ReferenceIndex",
	"emitReceiverBoundCalls FIRST",
	"emitFreeCallFallback THEN",
	"emitReferencesViaLookup (handledSites + deferred skip set)",
	"emitPropertyDispatchCalls (registration USES + conservative CALLS)",
	"emitCallableValueFlow (assigned/passed callable invocation CALLS)",
	"emitImportedValueReferences",
	"emitUniqueNamePropertyAccesses LAST-RESORT",
	"emitImportEdges → KnowledgeGraph (IMPORTS / CALLS / ACCESSES / INHERITS / USES)"
];
var IMPORT_TIERS = [
	{
		tier: "1 — same-file",
		confidence: "0.95",
		mechanism: "Symbol table for the caller's file"
	},
	{
		tier: "2 — import-scoped",
		confidence: "0.90",
		mechanism: "NamedImportMap chains, or all files in importMap for wildcards"
	},
	{
		tier: "3 — global",
		confidence: "0.50",
		mechanism: "O(1) class/impl/callable index. Fallback only."
	}
];
var IMPORT_STRATEGIES = [
	{
		strategy: "named",
		langs: "TS, JS, Java, C#, Rust, PHP, Kotlin",
		behavior: "Only explicitly imported names visible"
	},
	{
		strategy: "wildcard-leaf",
		langs: "Go, Ruby, Swift, Dart",
		behavior: "Whole-package import, no transitive re-exports"
	},
	{
		strategy: "wildcard-transitive",
		langs: "C, C++",
		behavior: "#include closure chains through re-exports"
	},
	{
		strategy: "namespace",
		langs: "Python",
		behavior: "Module aliases resolved at the call site"
	}
];
var MRO = [
	{
		strategy: "first-wins",
		langs: "Java, C#, C++, TS, Ruby, Go"
	},
	{
		strategy: "c3",
		langs: "Python (C3 linearization)"
	},
	{
		strategy: "ruby-mixin",
		langs: "Ruby mixin-aware linearization"
	},
	{
		strategy: "none",
		langs: "Single-inheritance languages"
	}
];
var ROUTE_SOURCES = [
	{
		source: "Filesystem convention",
		shape: "path → URL, no parsing",
		examples: "Next.js app/, Expo, PHP"
	},
	{
		source: "Single-file framework route",
		shape: "isRouteFile + worker extraction",
		examples: "Laravel routes/*.php"
	},
	{
		source: "Cross-file framework route",
		shape: "discoverRootRouteFiles + extractRoutes",
		examples: "Django urlpatterns"
	},
	{
		source: "AST-level in a normal file",
		shape: "extractDecoratorRoutes + dispatch-guard",
		examples: "Spring, FastAPI, NestJS, node:http if/pathname tables"
	}
];
var PDG_LAYERS = [
	{
		id: "M1 CFG",
		note: "BasicBlock nodes + CFG edges. Kind (seq/cond-true/loop-back) rides reason."
	},
	{
		id: "M2 REACHING_DEF",
		note: "GEN/KILL def→use. Variable name rides reason."
	},
	{
		id: "M3/M4 Taint",
		note: "TAINTED / SANITIZES / TAINT_PATH. Feeds `explain`."
	},
	{
		id: "M5 CDG",
		note: "Ferrante control dependence over CHK post-dominator tree. Skipped if EXIT unreachable."
	},
	{
		id: "M6 Read surface",
		note: "pdg_query mode=controls (CDG) or flows (REACHING_DEF). Always anchored + LIMIT-bounded."
	}
];
var NODE_TABLES = [
	{
		name: "File",
		kind: "structure",
		note: "Source file. FTS indexed. Embeddable."
	},
	{
		name: "Folder",
		kind: "structure",
		note: "Directory. CONTAINS files/folders."
	},
	{
		name: "Module",
		kind: "structure",
		note: "Language module / package unit."
	},
	{
		name: "Namespace",
		kind: "structure",
		note: "C# / C++ / PHP namespace."
	},
	{
		name: "Function",
		kind: "symbol",
		note: "Free function. FTS + embeddings."
	},
	{
		name: "Method",
		kind: "symbol",
		note: "Class-owned callable. Id may carry #<arity> and ~typehash."
	},
	{
		name: "Constructor",
		kind: "symbol",
		note: "Constructor / init."
	},
	{
		name: "Class",
		kind: "symbol",
		note: "Class. FTS + embeddings."
	},
	{
		name: "Interface",
		kind: "symbol",
		note: "Interface / protocol. Embeddable."
	},
	{
		name: "Struct",
		kind: "type",
		note: "C / Rust / Go struct."
	},
	{
		name: "Enum",
		kind: "type",
		note: "Enumerated type."
	},
	{
		name: "Union",
		kind: "type",
		note: "C/C++ union."
	},
	{
		name: "Typedef",
		kind: "type",
		note: "C typedef."
	},
	{
		name: "TypeAlias",
		kind: "type",
		note: "TS / Python / Rust alias."
	},
	{
		name: "Trait",
		kind: "type",
		note: "Rust trait."
	},
	{
		name: "Impl",
		kind: "type",
		note: "Rust impl block."
	},
	{
		name: "Record",
		kind: "type",
		note: "C# record."
	},
	{
		name: "Delegate",
		kind: "type",
		note: "C# delegate."
	},
	{
		name: "Annotation",
		kind: "type",
		note: "Java / Kotlin annotation type."
	},
	{
		name: "Template",
		kind: "type",
		note: "C++ template."
	},
	{
		name: "Macro",
		kind: "symbol",
		note: "C/C++ macro."
	},
	{
		name: "Const",
		kind: "symbol",
		note: "Constant. Block-local variants pruned post-resolution."
	},
	{
		name: "Static",
		kind: "symbol",
		note: "Static field / function."
	},
	{
		name: "Property",
		kind: "symbol",
		note: "Property / field."
	},
	{
		name: "CodeElement",
		kind: "symbol",
		note: "Catch-all declaration (DI providers, config keys)."
	},
	{
		name: "Community",
		kind: "derived",
		note: "Leiden cluster. MEMBER_OF from symbols."
	},
	{
		name: "Process",
		kind: "derived",
		note: "Execution flow from an entry point. STEP_IN_PROCESS."
	},
	{
		name: "Route",
		kind: "runtime",
		note: "HTTP / filesystem route. HANDLES_ROUTE from handler."
	},
	{
		name: "Tool",
		kind: "runtime",
		note: "MCP / RPC tool definition. HANDLES_TOOL."
	},
	{
		name: "Section",
		kind: "derived",
		note: "Markdown / MDX heading region."
	},
	{
		name: "Embedding",
		kind: "derived",
		note: "384D vector row, keyed by content SHA1."
	},
	{
		name: "BasicBlock",
		kind: "pdg",
		note: "Opt-in --pdg. Joined to symbols by id prefix + line span. No Function→BasicBlock edge."
	}
];
var RELATIONS = [
	{
		type: "CONTAINS",
		from: "Folder",
		to: "File | Folder",
		note: "Filesystem tree."
	},
	{
		type: "DEFINES",
		from: "File",
		to: "Symbol",
		note: "File owns a definition."
	},
	{
		type: "CALLS",
		from: "Function | Method",
		to: "Function | Method",
		note: "Resolved call. Confidence on the edge."
	},
	{
		type: "IMPORTS",
		from: "File | Module",
		to: "File | Symbol",
		note: "Import / include. Reason field carries confidence tier."
	},
	{
		type: "INHERITS",
		from: "Class | Interface",
		to: "Class | Interface",
		note: "Generic heritage (pre-split)."
	},
	{
		type: "EXTENDS",
		from: "Class",
		to: "Class",
		note: "Class heritage."
	},
	{
		type: "IMPLEMENTS",
		from: "Class",
		to: "Interface",
		note: "Interface / trait implementation."
	},
	{
		type: "USES",
		from: "Symbol",
		to: "Symbol",
		note: "Type / value use without a call."
	},
	{
		type: "DECORATES",
		from: "Annotation",
		to: "Symbol",
		note: "Decorator / attribute."
	},
	{
		type: "HAS_METHOD",
		from: "Class | Interface",
		to: "Method",
		note: "Ownership."
	},
	{
		type: "HAS_PROPERTY",
		from: "Class",
		to: "Property",
		note: "Field ownership."
	},
	{
		type: "ACCESSES",
		from: "Function | Method",
		to: "Property",
		note: "Field read/write."
	},
	{
		type: "METHOD_OVERRIDES",
		from: "Method",
		to: "Method",
		note: "Override via MRO."
	},
	{
		type: "METHOD_IMPLEMENTS",
		from: "Method",
		to: "Method",
		note: "Interface method fulfillment. Confidence 1.0 / 0.7."
	},
	{
		type: "MEMBER_OF",
		from: "Symbol",
		to: "Community",
		note: "Leiden cluster membership."
	},
	{
		type: "STEP_IN_PROCESS",
		from: "Symbol",
		to: "Process",
		note: "A step in an execution flow."
	},
	{
		type: "HANDLES_ROUTE",
		from: "Function | Method",
		to: "Route",
		note: "Provenance in source (decorator vs dispatch-guard)."
	},
	{
		type: "FETCHES",
		from: "Symbol",
		to: "Route",
		note: "Client call to a route."
	},
	{
		type: "HANDLES_TOOL",
		from: "Function | Method",
		to: "Tool",
		note: "MCP/RPC handler."
	},
	{
		type: "ENTRY_POINT_OF",
		from: "Symbol",
		to: "Process",
		note: "Process root."
	},
	{
		type: "WRAPS",
		from: "Symbol",
		to: "Symbol",
		note: "Wrapper / proxy."
	},
	{
		type: "QUERIES",
		from: "Symbol",
		to: "CodeElement",
		note: "ORM query (Prisma, Supabase)."
	},
	{
		type: "INJECTS",
		from: "Class | Method",
		to: "Class | CodeElement",
		note: "DI edge from consumer to provider."
	},
	{
		type: "CONDITIONAL_ON",
		from: "CodeElement",
		to: "CodeElement",
		note: "Spring auto-config condition."
	},
	{
		type: "DECLARES",
		from: "Class",
		to: "CodeElement",
		note: "Spring configuration candidate."
	},
	{
		type: "ADVISED_BY",
		from: "Symbol",
		to: "Method",
		note: "AOP advice."
	},
	{
		type: "BINDS_EVENT_HANDLER",
		from: "Symbol",
		to: "Method",
		note: "Event subscription."
	},
	{
		type: "EMITS_EVENT",
		from: "Symbol",
		to: "CodeElement",
		note: "Event emission."
	},
	{
		type: "CFG",
		from: "BasicBlock",
		to: "BasicBlock",
		note: "Control-flow. Kind in reason.",
		pdg: true
	},
	{
		type: "REACHING_DEF",
		from: "BasicBlock",
		to: "BasicBlock",
		note: "Def→use. Variable in reason.",
		pdg: true
	},
	{
		type: "CDG",
		from: "BasicBlock",
		to: "BasicBlock",
		note: "Control dependence. T/F in reason.",
		pdg: true
	},
	{
		type: "TAINTED",
		from: "BasicBlock",
		to: "BasicBlock",
		note: "Taint hop.",
		pdg: true
	},
	{
		type: "SANITIZES",
		from: "BasicBlock",
		to: "BasicBlock",
		note: "Sanitizer.",
		pdg: true
	},
	{
		type: "TAINT_PATH",
		from: "BasicBlock",
		to: "BasicBlock",
		note: "Persisted source→sink path.",
		pdg: true
	}
];
var ID_RULES = [
	"Node IDs encode kind + file + qualified name. Methods append #<paramCount>.",
	"Same-arity overloads add ~type1,type2 when type annotations exist (TS/Java/C#/…). Python/Ruby/JS stay arity-only.",
	"C++ const-qualified methods add $const after the type-hash when a non-const twin exists.",
	"Generic types hash rawType: ~vector<int> vs ~vector<std::string>.",
	"Collision-only tags mean IDs are not stable when a new overload is added (`save#1` becomes `save#1~int`).",
	"Variadic vs fixed arity: CALLS confidence 0.7."
];
var CAPTURE_TAGS = [
	"@definition.class",
	"@definition.function",
	"@definition.method",
	"@definition.interface",
	"@call.name",
	"@import.source",
	"@reference.inherits",
	"@reference.type-arguments",
	"@declaration.type-parameters"
];
var MCP_TOOLS = [
	{
		name: "list_repos",
		purpose: "Discover indexed repos in the global registry.",
		params: ["limit", "offset"]
	},
	{
		name: "query",
		purpose: "Hybrid BM25 + vector search over the graph.",
		params: [
			"search_query",
			"repo?",
			"branch?",
			"maxTokens?"
		],
		notes: "Group-aware: repo=@group merges via RRF."
	},
	{
		name: "cypher",
		purpose: "Ad-hoc Cypher against the LadybugDB schema.",
		params: [
			"query",
			"repo?",
			"branch?"
		]
	},
	{
		name: "context",
		purpose: "Callers, callees, processes for one symbol.",
		params: [
			"name",
			"file_path?",
			"kind?",
			"uid?",
			"repo?",
			"branch?"
		],
		notes: "Publishes epistemic exact | lower-bound."
	},
	{
		name: "impact",
		purpose: "Blast radius (upstream/downstream) with risk summary.",
		params: [
			"target",
			"direction",
			"minConfidence?",
			"maxDepth?",
			"relationTypes?",
			"includeTests?",
			"limit?",
			"offset?",
			"summaryOnly?",
			"uid?",
			"file_path?",
			"kind?",
			"repo?",
			"branch?"
		],
		notes: "Group mode fans out across Contract Bridge."
	},
	{
		name: "detect_changes",
		purpose: "Map git diffs to affected symbols and processes.",
		params: [
			"scope",
			"git_ref?",
			"base_ref?",
			"partial?",
			"truncated?"
		]
	},
	{
		name: "rename",
		purpose: "Graph-assisted multi-file rename with dry_run preview.",
		params: [
			"symbol_name",
			"new_name",
			"dry_run?",
			"repo?",
			"branch?"
		]
	},
	{
		name: "api_impact",
		purpose: "Pre-change impact report for an API route handler.",
		params: [
			"route_handler",
			"repo?",
			"branch?"
		]
	},
	{
		name: "trace",
		purpose: "Shortest directed path between two symbols (call + class-member).",
		params: [
			"from",
			"to",
			"from_uid?",
			"to_uid?",
			"repo?",
			"pdg?"
		],
		notes: "Group-aware. One CONTRACT_LINK hop max. pdg:true is experimental."
	},
	{
		name: "route_map",
		purpose: "API route → handler → consumer mappings.",
		params: [
			"api_path?",
			"repo?",
			"branch?"
		]
	},
	{
		name: "tool_map",
		purpose: "MCP/RPC tool definitions and handlers.",
		params: ["repo?", "branch?"]
	},
	{
		name: "shape_check",
		purpose: "Response shape vs consumer property-access mismatches.",
		params: [
			"api_response",
			"consumer_code",
			"repo?"
		]
	},
	{
		name: "check",
		purpose: "Run a named structural rule against the graph.",
		params: ["rule", "repo?"]
	},
	{
		name: "explain",
		purpose: "Persisted taint findings (source→sink data flows).",
		params: [
			"target",
			"repo?",
			"branch?"
		],
		pdg: true
	},
	{
		name: "pdg_query",
		purpose: "Control/data dependence. mode=controls (CDG) or flows (REACHING_DEF).",
		params: [
			"mode",
			"target",
			"variable?",
			"repo?",
			"branch?"
		],
		pdg: true
	},
	{
		name: "group_list",
		purpose: "List repo groups or details for one group.",
		params: ["name?"],
		group: true
	},
	{
		name: "group_sync",
		purpose: "Rebuild group Contract Registry (contracts.json) and bridge graph.",
		params: ["name"],
		group: true
	}
];
var RESOURCES = [
	{
		uri: "gitnexus://repos",
		purpose: "All indexed repositories."
	},
	{
		uri: "gitnexus://setup",
		purpose: "Setup and usage guidance for agents."
	},
	{
		uri: "gitnexus://repo/{name}/context",
		purpose: "Stats, staleness, available tools."
	},
	{
		uri: "gitnexus://repo/{name}/clusters",
		purpose: "Functional clusters with cohesion scores."
	},
	{
		uri: "gitnexus://repo/{name}/cluster/{name}",
		purpose: "Cluster members."
	},
	{
		uri: "gitnexus://repo/{name}/processes",
		purpose: "All execution flows."
	},
	{
		uri: "gitnexus://repo/{name}/process/{name}",
		purpose: "Full process trace with steps."
	},
	{
		uri: "gitnexus://repo/{name}/schema",
		purpose: "Graph schema for Cypher."
	},
	{
		uri: "gitnexus://group/{name}/contracts",
		purpose: "Provider/consumer rows + cross-links."
	},
	{
		uri: "gitnexus://group/{name}/status",
		purpose: "Per-member index + registry staleness."
	}
];
var PROMPTS = [{
	name: "detect_impact",
	purpose: "Pre-commit analysis prompt wired to detect_changes + impact."
}, {
	name: "generate_map",
	purpose: "Architecture docs with Mermaid, driven from clusters/processes."
}];
var SKILLS = [
	{
		name: "Exploring",
		id: "gitnexus-explore",
		body: "Navigate an unfamiliar codebase via query, clusters, processes."
	},
	{
		name: "Debugging",
		id: "gitnexus-debug",
		body: "Trace bugs through call chains and processes."
	},
	{
		name: "Impact Analysis",
		id: "gitnexus-impact",
		body: "Blast radius before edits. Blocks HIGH/CRITICAL."
	},
	{
		name: "Refactoring",
		id: "gitnexus-refactor",
		body: "Plan safe refactors; use rename, not find-replace."
	},
	{
		name: "Guide",
		id: "gitnexus-guide",
		body: "Tool, resource, and schema reference."
	},
	{
		name: "CLI",
		id: "gitnexus-cli",
		body: "analyze / status / clean / wiki command recipes."
	},
	{
		name: "PDG Query",
		id: "gitnexus-pdg",
		body: "Statement-level control and data dependence."
	},
	{
		name: "Taint Analysis",
		id: "gitnexus-taint",
		body: "Source→sink data-flow via explain."
	},
	{
		name: "Plan",
		id: "/gitnexus-plan",
		body: "Implementation-ready plans with graph/PDG. Writes docs/plans/. No code edits."
	},
	{
		name: "Work",
		id: "/gitnexus-work",
		body: "Execute a plan as verified atomic commits. impact before edit, detect_changes before commit."
	},
	{
		name: "Review",
		id: "/gitnexus-review",
		body: "Read-only PR/diff review. PDG taint on trust-boundary diffs. Swarm personas in CI."
	},
	{
		name: "LFG",
		id: "/gitnexus-lfg",
		body: "Orchestrator: plan → user gate → work → review."
	}
];
var CLI = [
	{
		cmd: "gitnexus setup",
		purpose: "Write MCP config for detected editors. One-time.",
		flags: ["-c <agents>"]
	},
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
			"--wal-checkpoint-threshold <bytes>"
		]
	},
	{
		cmd: "gitnexus mcp",
		purpose: "Start MCP server over stdio (what editors launch)."
	},
	{
		cmd: "gitnexus serve",
		purpose: "HTTP server for the Web UI. Talks to local indexes."
	},
	{
		cmd: "gitnexus eval-server",
		purpose: "Evaluation tools. Loopback by default; GITNEXUS_AUTH_TOKEN required off-loopback."
	},
	{
		cmd: "gitnexus list",
		purpose: "List indexed repos from the registry."
	},
	{
		cmd: "gitnexus status",
		purpose: "Index status + staleness for the current repo."
	},
	{
		cmd: "gitnexus clean",
		purpose: "Delete the local index."
	},
	{
		cmd: "gitnexus doctor",
		purpose: "Diagnose grammars, DB, registry, editor config."
	},
	{
		cmd: "gitnexus wiki [path]",
		purpose: "Generate an LLM wiki from the graph.",
		flags: [
			"--model",
			"--base-url",
			"--force",
			"--timeout",
			"--retries",
			"--lang",
			"--allow-insecure-connection"
		]
	},
	{
		cmd: "gitnexus uninstall",
		purpose: "Preview/remove MCP setup.",
		flags: ["--force"]
	},
	{
		cmd: "gitnexus query|context|impact|trace|cypher|detect-changes|check|rename",
		purpose: "Direct CLI equivalents of MCP tools."
	},
	{
		cmd: "gitnexus group create <name>",
		purpose: "Create a multi-repo group."
	},
	{
		cmd: "gitnexus group add <group> <groupPath> <registryName>",
		purpose: "Add a member."
	},
	{
		cmd: "gitnexus group remove <group> <groupPath>",
		purpose: "Remove a member."
	},
	{
		cmd: "gitnexus group list [name]",
		purpose: "List groups or one group's members."
	},
	{
		cmd: "gitnexus group sync <name>",
		purpose: "Rebuild contracts.json + bridge graph."
	},
	{
		cmd: "gitnexus group contracts <name>",
		purpose: "Print the contract registry."
	},
	{
		cmd: "gitnexus group query <name> <q>",
		purpose: "Search across members."
	},
	{
		cmd: "gitnexus group status <name>",
		purpose: "Per-member staleness."
	},
	{
		cmd: "gitnexus group impact <name> --target <symbol> --repo <path>",
		purpose: "Cross-repo blast radius."
	}
];
var LANGUAGES = [
	{
		language: "TypeScript",
		extensions: [
			".ts",
			".tsx",
			".mts",
			".cts"
		],
		imports: true,
		named: true,
		exports: true,
		heritage: true,
		types: true,
		ctor: true,
		config: true,
		frameworks: true,
		entry: true,
		pdg: true,
		importStrategy: "named",
		mro: "first-wins",
		notes: "Overload signatures collapse to the implementation body. NestJS/Next.js routes. CFG visitor for --pdg."
	},
	{
		language: "JavaScript",
		extensions: [
			".js",
			".jsx",
			".mjs",
			".cjs"
		],
		imports: true,
		named: true,
		exports: true,
		heritage: true,
		types: false,
		ctor: true,
		config: true,
		frameworks: true,
		entry: true,
		pdg: true,
		importStrategy: "named",
		mro: "first-wins",
		notes: "Same pipeline as TS without type-hash disambiguation. Dispatch-guard routes."
	},
	{
		language: "Python",
		extensions: [".py"],
		imports: true,
		named: true,
		exports: true,
		heritage: true,
		types: true,
		ctor: true,
		config: true,
		frameworks: true,
		entry: true,
		pdg: false,
		importStrategy: "namespace",
		mro: "c3",
		notes: "PEP-328 imports. Django urlpatterns. Registry-primary call resolution. reconcileOwnership for class-body methods."
	},
	{
		language: "Java",
		extensions: [".java"],
		imports: true,
		named: true,
		exports: true,
		heritage: true,
		types: true,
		ctor: true,
		config: false,
		frameworks: true,
		entry: true,
		pdg: false,
		importStrategy: "named",
		mro: "first-wins",
		notes: "Spring routes, AOP, auto-configuration phases."
	},
	{
		language: "Kotlin",
		extensions: [".kt", ".kts"],
		imports: true,
		named: true,
		exports: true,
		heritage: true,
		types: true,
		ctor: true,
		config: false,
		frameworks: true,
		entry: true,
		pdg: false,
		importStrategy: "named",
		mro: "first-wins",
		notes: "Optional grammar. Vendored if C++ toolchain missing."
	},
	{
		language: "C#",
		extensions: [".cs"],
		imports: true,
		named: true,
		exports: true,
		heritage: true,
		types: true,
		ctor: true,
		config: true,
		frameworks: true,
		entry: true,
		pdg: false,
		importStrategy: "named",
		mro: "first-wins",
		notes: "populateNamespaceSiblings for compiler-implicit namespace sharing. Records, delegates."
	},
	{
		language: "Go",
		extensions: [".go"],
		imports: true,
		named: false,
		exports: true,
		heritage: true,
		types: true,
		ctor: true,
		config: true,
		frameworks: true,
		entry: true,
		pdg: false,
		importStrategy: "wildcard-leaf",
		mro: "first-wins",
		notes: "Package-level visibility. No named bindings."
	},
	{
		language: "Rust",
		extensions: [".rs"],
		imports: true,
		named: true,
		exports: true,
		heritage: true,
		types: true,
		ctor: true,
		config: false,
		frameworks: true,
		entry: true,
		pdg: false,
		importStrategy: "named",
		mro: "first-wins",
		notes: "Trait/Impl nodes. impl T<A> for S uses @reference.type-arguments."
	},
	{
		language: "PHP",
		extensions: [".php"],
		imports: true,
		named: true,
		exports: true,
		heritage: false,
		types: true,
		ctor: true,
		config: true,
		frameworks: true,
		entry: true,
		pdg: false,
		importStrategy: "named",
		mro: "none",
		notes: "Laravel routes/*.php single-file extractor. Filesystem PHP routes."
	},
	{
		language: "Ruby",
		extensions: [".rb"],
		imports: true,
		named: false,
		exports: true,
		heritage: true,
		types: false,
		ctor: true,
		config: false,
		frameworks: true,
		entry: true,
		pdg: false,
		importStrategy: "wildcard-leaf",
		mro: "ruby-mixin",
		notes: "Mixin-aware MRO."
	},
	{
		language: "Swift",
		extensions: [".swift"],
		imports: false,
		named: false,
		exports: true,
		heritage: true,
		types: true,
		ctor: true,
		config: true,
		frameworks: true,
		entry: true,
		pdg: false,
		importStrategy: "wildcard-leaf",
		mro: "first-wins",
		notes: "constructorCallTargetsClass. Optional grammar. Documented ingestion gaps in swift-ingestion-gaps.md."
	},
	{
		language: "C",
		extensions: [".c", ".h"],
		imports: false,
		named: false,
		exports: true,
		heritage: false,
		types: true,
		ctor: true,
		config: false,
		frameworks: true,
		entry: true,
		pdg: false,
		importStrategy: "wildcard-transitive",
		mro: "none",
		notes: "#include closure. hasFileLocalCallableLinkage for static."
	},
	{
		language: "C++",
		extensions: [
			".cc",
			".cpp",
			".cxx",
			".hpp",
			".hh"
		],
		imports: false,
		named: false,
		exports: true,
		heritage: true,
		types: true,
		ctor: true,
		config: false,
		frameworks: true,
		entry: true,
		pdg: false,
		importStrategy: "wildcard-transitive",
		mro: "first-wins",
		notes: "$const method ids. Member-function pointers preserve cv shape. Virtual targets expand through MRO."
	},
	{
		language: "Dart",
		extensions: [".dart"],
		imports: true,
		named: false,
		exports: true,
		heritage: true,
		types: true,
		ctor: true,
		config: false,
		frameworks: true,
		entry: true,
		pdg: false,
		importStrategy: "wildcard-leaf",
		mro: "first-wins",
		notes: "Optional grammar. implements/with ride heritage MARKER payload. constructorCallTargetsClass."
	},
	{
		language: "Vue",
		extensions: [".vue"],
		imports: true,
		named: true,
		exports: true,
		heritage: true,
		types: true,
		ctor: true,
		config: true,
		frameworks: true,
		entry: true,
		pdg: false,
		importStrategy: "named",
		mro: "first-wins",
		notes: "SFC script blocks routed through the TS/JS provider."
	},
	{
		language: "COBOL",
		extensions: [".cbl", ".cob"],
		imports: false,
		named: false,
		exports: true,
		heritage: false,
		types: false,
		ctor: false,
		config: false,
		frameworks: false,
		entry: true,
		pdg: false,
		importStrategy: "none",
		mro: "none",
		notes: "Regex processor. ScopeResolver scopeResolutionEdgeMode = callable-flow-only."
	}
];
var ADD_LANGUAGE = [
	"Implement LanguageProvider in gitnexus/src/core/ingestion/languages/<lang>/ (id, extensions, treeSitterQueries, importSemantics, importResolver, exportChecker, typeConfig, mroStrategy).",
	"Write tree-sitter queries using the unified capture tags in tree-sitter-queries.ts.",
	"Declare ImportResolutionConfig in import-resolvers/configs/.",
	"Implement ScopeResolver (scope-resolution/contract/scope-resolver.ts) and register in SCOPE_RESOLVERS.",
	"Add the id to gitnexus-shared/src/languages.ts. The languages/index.ts Record<SupportedLanguages, LanguageProvider> fails compile if a language is missing.",
	"CI auto-discovers SCOPE_RESOLVERS via tsx — no workflow edit.",
	"Optional: cfgVisitor for --pdg, descriptionExtractor for doc-comment embeddings, definitionPropertiesExtractor for structured metadata."
];
var PLAYBOOK = [
	{
		id: "m0",
		phase: "M0",
		title: "Monorepo skeleton",
		goal: "Three packages compile. Shared is built first. Node engine pinned. Lint/format/husky live.",
		depends: [],
		files: [
			"package.json (workspaces)",
			"gitnexus/package.json",
			"gitnexus-web/package.json",
			"gitnexus-shared/package.json + tsconfig",
			"eslint.config.mjs",
			".husky/pre-commit"
		],
		tasks: [
			{
				id: "m0-ws",
				title: "Create gitnexus, gitnexus-web, gitnexus-shared with TypeScript project references.",
				doneHint: "tsc -b at root typechecks all three."
			},
			{
				id: "m0-eng",
				title: "Pin engines.node to ^22.18.0 || >=24.11.0 on the CLI package.",
				doneHint: "package.json engines set."
			},
			{
				id: "m0-lint",
				title: "Prettier + ESLint + husky lint-staged on ts/tsx.",
				doneHint: "Pre-commit formats staged files."
			}
		]
	},
	{
		id: "m1",
		phase: "M1",
		title: "Shared contracts",
		goal: "SupportedLanguages, capture tags, ParsedFile, node/edge unions live in gitnexus-shared. CLI and web import them directly — no barrel re-exports that hide drift.",
		depends: ["m0"],
		files: [
			"gitnexus-shared/src/languages.ts",
			"gitnexus-shared/src/scope-resolution/parsed-file.ts",
			"gitnexus-shared/src/graph-types.ts"
		],
		tasks: [
			{
				id: "m1-lang",
				title: "Define SupportedLanguages and extension maps.",
				doneHint: "Adding a language without a provider is a compile error later in M3."
			},
			{
				id: "m1-pf",
				title: "Specify ParsedFile (defs, refs, imports, callable sites, receiverChain v2).",
				doneHint: "JSON-serializable — workers must be able to postMessage it."
			},
			{
				id: "m1-rel",
				title: "Union of node table names and relation types including PDG opt-in set.",
				doneHint: "VALID_RELATION_TYPES excludes PDG by default."
			}
		]
	},
	{
		id: "m2",
		phase: "M2",
		title: "In-memory KnowledgeGraph",
		goal: "A graph accumulator with typed addNode/addEdge, by-type iteration, and CSV dump. No DB yet.",
		depends: ["m1"],
		files: ["gitnexus/src/core/graph/"],
		tasks: [{
			id: "m2-kg",
			title: "Implement KnowledgeGraph with Map storage and iterRelationshipsByType.",
			doneHint: "Unit tests: idempotent ids, type filters."
		}, {
			id: "m2-csv",
			title: "CSV serializers matching LadybugDB COPY format (one file per node table + relations).",
			doneHint: "Round-trip fixture in tests."
		}]
	},
	{
		id: "m3",
		phase: "M3",
		title: "LanguageProvider + TS/JS parse workers",
		goal: "Worker pool is the only parse path. TypeScript and JavaScript extract unified captures into ParsedFile.",
		depends: ["m1"],
		files: [
			"ingestion/language-provider.ts",
			"ingestion/languages/typescript/",
			"ingestion/workers/worker-pool.ts",
			"ingestion/workers/parse-worker.ts",
			"tree-sitter-queries.ts"
		],
		tasks: [
			{
				id: "m3-lp",
				title: "LanguageProvider interface + TS/JS implementations.",
				doneHint: "Query captures @definition.* @call.name @import.source @reference.inherits."
			},
			{
				id: "m3-pool",
				title: "Worker pool with byte-budget chunks (~20 MB). Reject workers=0.",
				doneHint: "Actionable error if GITNEXUS_WORKER_POOL_SIZE=0."
			},
			{
				id: "m3-store",
				title: "Disk-backed ParsedFile store so the main thread never re-parses.",
				doneHint: "Large-fixture test does not grow native RSS unboundedly."
			}
		]
	},
	{
		id: "m4",
		phase: "M4",
		title: "Pipeline DAG runner + scan/structure/parse",
		goal: "Typed phase runner with Kahn validation. Three root phases produce File/Folder/symbol nodes.",
		depends: ["m2", "m3"],
		files: [
			"ingestion/pipeline.ts",
			"ingestion/pipeline-phases/runner.ts",
			"ingestion/pipeline-phases/scan.ts",
			"ingestion/pipeline-phases/structure.ts",
			"ingestion/pipeline-phases/parse.ts"
		],
		tasks: [
			{
				id: "m4-run",
				title: "runner.ts: topo sort, cycle error with path, typed getPhaseOutput.",
				doneHint: "Cycle A→B→C→A fails with that path."
			},
			{
				id: "m4-scan",
				title: "scan + structure honor .gitignore / ignore library. CONTAINS edges.",
				doneHint: "node_modules absent from graph."
			},
			{
				id: "m4-parse",
				title: "parse phase consumes worker results, synthesizes wildcard bindings.",
				doneHint: "A TS file yields Function/Class/Method nodes with DEFINES."
			}
		]
	},
	{
		id: "m5",
		phase: "M5",
		title: "Scope resolution (TS/JS)",
		goal: "CALLS, IMPORTS, EXTENDS/IMPLEMENTS, ACCESSES, USES emitted through the language-agnostic pipeline.",
		depends: ["m4"],
		files: [
			"scope-resolution/contract/scope-resolver.ts",
			"scope-resolution/pipeline/run.ts",
			"scope-resolution/pipeline/registry.ts",
			"scope-resolution/passes/*.ts",
			"languages/typescript/scope-resolver.ts"
		],
		tasks: [
			{
				id: "m5-sr",
				title: "Implement ScopeResolver for TypeScript/JavaScript and register it.",
				doneHint: "Cross-file named import call resolves with confidence 0.9."
			},
			{
				id: "m5-ord",
				title: "Emit receiver-bound calls before free-call fallback before unique-name last resort.",
				doneHint: "Tests lock emit order."
			},
			{
				id: "m5-ep",
				title: "Record unresolved in-program receivers. impact/context later read epistemic bounds.",
				doneHint: "svc.getUser().x on an in-graph type increments the census."
			}
		]
	},
	{
		id: "m6",
		phase: "M6",
		title: "Routes, communities, processes",
		goal: "A Next.js/Express fixture produces Route + HANDLES_ROUTE, Leiden communities, and Process flows from those entries.",
		depends: ["m5"],
		files: [
			"pipeline-phases/routes.ts",
			"route-extractors/",
			"pipeline-phases/communities.ts",
			"pipeline-phases/processes.ts",
			"pipeline-phases/prune-local-symbols.ts",
			"pipeline-phases/mro.ts"
		],
		tasks: [
			{
				id: "m6-rt",
				title: "Filesystem + decorator + dispatch-guard extractors. Drop unproven paths.",
				doneHint: "if (method==='GET' && pathname==='/api/x') becomes a Route. startsWith does not."
			},
			{
				id: "m6-ld",
				title: "Leiden communities → Community + MEMBER_OF.",
				doneHint: "Non-trivial fixture yields >1 community."
			},
			{
				id: "m6-pr",
				title: "Processes from routes/tools/mains with STEP_IN_PROCESS.",
				doneHint: "context on a handler lists the process."
			}
		]
	},
	{
		id: "m7",
		phase: "M7",
		title: "LadybugDB persistence + registry",
		goal: "Pipeline output lands in <repo>/.gitnexus/lbug. Repo appears in ~/.gitnexus/registry.json. FTS indexes exist.",
		depends: ["m2", "m6"],
		files: [
			"core/lbug/schema.ts",
			"core/lbug/lbug-adapter.ts",
			"core/repo-manager.ts",
			"core/run-analyze.ts"
		],
		tasks: [
			{
				id: "m7-sch",
				title: "schema.ts: one table per node type, single CodeRelation, optional BasicBlock.",
				doneHint: "Cypher MATCH (f:Function) RETURN count(f) works."
			},
			{
				id: "m7-load",
				title: "CSV streaming load + FTS on File/Function/Class/Method.",
				doneHint: "analyze on a fixture, then reopen the DB in a new process."
			},
			{
				id: "m7-reg",
				title: "registry.json write, lastCommit skip unless --force, .gitignore update.",
				doneHint: "Second analyze no-ops when HEAD matches."
			}
		]
	},
	{
		id: "m8",
		phase: "M8",
		title: "Search + embeddings",
		goal: "query returns fused BM25 + vector hits. Embeddings opt-in and incremental.",
		depends: ["m7"],
		files: [
			"core/search/",
			"core/embeddings/",
			"cli/embeddings.ts"
		],
		tasks: [
			{
				id: "m8-bm",
				title: "BM25 over FTS with kind filters.",
				doneHint: "query 'save user' hits Repo.save."
			},
			{
				id: "m8-em",
				title: "arctic-embed-xs 384D, SHA1 cache, skip >50k nodes.",
				doneHint: "--embeddings on a tiny repo writes Embedding rows; second run restores them."
			},
			{
				id: "m8-rrf",
				title: "RRF K=60 fusion.",
				doneHint: "Hybrid ranking beats BM25-only on a labeled fixture."
			}
		]
	},
	{
		id: "m9",
		phase: "M9",
		title: "LocalBackend + MCP + CLI tools",
		goal: "stdio MCP server exposes list_repos, query, context, impact, trace, cypher. CLI mirrors them.",
		depends: ["m7", "m8"],
		files: [
			"mcp/server.ts",
			"mcp/tools.ts",
			"mcp/resources.ts",
			"mcp/local/local-backend.ts",
			"cli/mcp.ts",
			"cli/tool.ts",
			"cli/index.ts"
		],
		tasks: [
			{
				id: "m9-be",
				title: "LocalBackend with lazy DB open + connection pool.",
				doneHint: "Two concurrent context calls share the pool."
			},
			{
				id: "m9-tools",
				title: "Implement the core 8 tools with zod input schemas.",
				doneHint: "MCP inspector lists them; impact returns callers."
			},
			{
				id: "m9-res",
				title: "Resources: repos, setup, context, schema at minimum.",
				doneHint: "Read gitnexus://repos returns the fixture."
			}
		]
	},
	{
		id: "m10",
		phase: "M10",
		title: "CLI product surface",
		goal: "analyze, setup, mcp, serve, list, status, clean, doctor work end-to-end.",
		depends: ["m9"],
		files: [
			"cli/analyze.ts",
			"cli/setup.ts",
			"cli/serve.ts",
			"cli/status.ts",
			"cli/doctor.ts",
			"editor-targets.ts"
		],
		tasks: [
			{
				id: "m10-an",
				title: "analyze flags: --force --embeddings --skills --skip-git --workers --verbose.",
				doneHint: "commander help matches the spec."
			},
			{
				id: "m10-su",
				title: "setup writes MCP config for Claude Code and Cursor.",
				doneHint: "A dry-run prints the files it would write."
			},
			{
				id: "m10-sv",
				title: "serve starts Express with the same LocalBackend.",
				doneHint: "GET /api/repos returns the registry."
			}
		]
	},
	{
		id: "m11",
		phase: "M11",
		title: "Web explorer",
		goal: "Thin React client: graph canvas, symbol pane, chat against the HTTP API. WASM indexer is a later stretch.",
		depends: ["m10"],
		files: [
			"gitnexus-web/src/App.tsx",
			"components/graph/",
			"services/api.ts"
		],
		tasks: [
			{
				id: "m11-api",
				title: "HTTP client for repos, subgraph, query, context.",
				doneHint: "Opening the UI against gitnexus serve shows the fixture graph."
			},
			{
				id: "m11-sig",
				title: "Sigma.js + Graphology render with kind colors and cluster layout.",
				doneHint: "Click a node opens context."
			},
			{
				id: "m11-chat",
				title: "LangChain ReAct loop calling the same tools over HTTP.",
				doneHint: "A prompt 'who calls save?' returns impact/context output."
			}
		]
	},
	{
		id: "m12",
		phase: "M12",
		title: "Languages beyond TS/JS",
		goal: "Python, then Java/Go/Rust. Each is a provider + resolver. Shared code stays language-neutral.",
		depends: ["m5"],
		files: [
			"ingestion/languages/python/",
			"csharp/",
			"go/",
			"rust/",
			"java/"
		],
		tasks: [{
			id: "m12-py",
			title: "Python ScopeResolver with namespace imports and C3 MRO.",
			doneHint: "Django-style fixture resolves a view → service CALLS."
		}, {
			id: "m12-more",
			title: "Add Go (wildcard-leaf) and Java (named + Spring hooks later).",
			doneHint: "languages/index.ts satisfies Record<SupportedLanguages, LanguageProvider>."
		}]
	},
	{
		id: "m13",
		phase: "M13",
		title: "Groups, PDG, wiki, skills",
		goal: "Cross-repo contracts, optional PDG, wiki command, shipped agent skills.",
		depends: ["m9", "m10"],
		files: [
			"core/group/",
			"ingestion/cfg/",
			"core/wiki/",
			"gitnexus/skills/",
			"cli/skill-gen.ts"
		],
		tasks: [
			{
				id: "m13-gr",
				title: "group create/add/sync + @group routing on query/impact/trace.",
				doneHint: "Two-repo fixture traces across one CONTRACT_LINK."
			},
			{
				id: "m13-pdg",
				title: "TS/JS cfgVisitor, --pdg layers, explain + pdg_query.",
				doneHint: "Default graph without --pdg is byte-identical to pre-flag."
			},
			{
				id: "m13-sk",
				title: "Ship explore/debug/impact/plan/work/review/lfg skills. Generate cluster skills with --skills.",
				doneHint: "shipped-skills-sync test passes."
			}
		]
	}
];
var MODELS = [
	{
		name: "KnowledgeGraph",
		path: "gitnexus/src/core/graph/",
		purpose: "In-memory accumulator every pipeline phase mutates. Nodes, relationships, indexes. CSV-exportable for LadybugDB load.",
		fields: [
			"nodes: Map<id, GraphNode>",
			"relationships: Map<id, GraphEdge> + iterRelationshipsByType(type)",
			"addNode / addRelationship (idempotent on id)",
			"stats: { files, symbols, edges, languages }"
		]
	},
	{
		name: "SemanticModel",
		path: "ingestion/model/semantic-model.ts",
		purpose: "Authoritative symbol-indexed lookup. Mutable during parse + scope-resolution + finalize; read-only handle afterward.",
		fields: [
			"symbols / methods / fields by nodeId, simpleName, qualifiedName, filePath",
			"findOwnedMember, pickOverload, findExportedDefByName",
			"reconcileOwnership() after populateOwners",
			"attachScopeIndexes(bundle) — one-shot freeze"
		]
	},
	{
		name: "ParsedFile",
		path: "gitnexus-shared/src/scope-resolution/parsed-file.ts",
		purpose: "Single per-file artifact the scope-resolution pipeline consumes. Workers serialize this; do not re-parse on the main thread.",
		fields: [
			"filePath, language, localDefs[], referenceSites[], parsedImports[]",
			"typeBindings, export table, callable flow sites",
			"receiverChain (v2 codec), cfgSideChannel when --pdg",
			"capture side-channel for emitScopeCaptures"
		]
	},
	{
		name: "LanguageProvider",
		path: "ingestion/language-provider.ts",
		purpose: "Per-language plug. Shared ingestion never names a language.",
		fields: [
			"id, extensions, treeSitterQueries",
			"importSemantics: named | wildcard-leaf | wildcard-transitive | namespace",
			"importResolver, exportChecker, typeConfig, mroStrategy",
			"descriptionExtractor?, definitionPropertiesExtractor?, cfgVisitor?"
		]
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
			"constructorCallTargetsClass, constructionSyntax, scopeResolutionEdgeMode"
		]
	},
	{
		name: "PipelinePhase<T>",
		path: "pipeline-phases/types.ts",
		purpose: "name + deps + execute(ctx, deps) → T. Runner filters deps to declared names only.",
		fields: [
			"name: string",
			"deps: string[]",
			"execute(ctx, deps): Promise<T>",
			"durationMs on PhaseResult"
		]
	},
	{
		name: "PipelineContext",
		path: "pipeline-phases/types.ts",
		purpose: "Shared mutable context for the DAG run.",
		fields: [
			"graph: KnowledgeGraph",
			"repoPath",
			"options: PipelineOptions",
			"progress: (PipelineProgress) => void"
		]
	},
	{
		name: "LocalBackend",
		path: "mcp/local/local-backend.ts",
		purpose: "Single implementation of every MCP tool. Connection pooling, lazy DB open, group routing.",
		fields: [
			"_queryImpl, _contextImpl, _impactImpl, _traceImpl",
			"_pdgQueryImpl, _explainImpl, resolveBlockAnchor",
			"EpistemicCauses for unresolved receivers"
		]
	},
	{
		name: "RepoRegistry",
		path: "repo-manager.ts + ~/.gitnexus/registry.json",
		purpose: "Maps repo name → index path, lastCommit, branch. MCP discovery.",
		fields: [
			"name",
			"path",
			"indexedAt",
			"lastCommit",
			"stats",
			"pdg?: boolean"
		]
	},
	{
		name: "Contract + ContractLink",
		path: "core/group/",
		purpose: "Cross-repo HTTP (and similar) provider/consumer rows. Bridge graph joins on symbolUid.",
		fields: [
			"Contract: { kind, method, url, symbolUid, repo, direction: provider|consumer }",
			"ContractLink: consumer → provider over one boundary",
			"MAX_SUPPORTED_CROSS_DEPTH = 1"
		]
	},
	{
		name: "ResolutionOutcome",
		path: "scope-resolution/resolution-outcome.ts",
		purpose: "Receivers the resolver could not type. Feeds epistemic bounds.",
		fields: [
			"shape: chain-call | chain-field | chain-mixed | chain-unwrap | no-chain",
			"origin: in-program | external | unknown",
			"unresolvedReceiverMembers summary persisted on the index"
		]
	},
	{
		name: "Embedding row",
		path: "core/embeddings/ + Embedding table",
		purpose: "384D Snowflake arctic-embed-xs. Incremental via SHA1 of embeddable text.",
		fields: [
			"nodeId",
			"vector: Float32[384]",
			"contentHash",
			"model"
		]
	}
];
var MODEL_SNIPPETS = [
	{
		name: "PipelinePhase",
		code: `export interface PipelinePhase<T> {
  name: string;
  deps: readonly string[];
  execute(
    ctx: PipelineContext,
    deps: ReadonlyMap<string, PhaseResult>,
  ): Promise<T>;
}`
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
};`
	},
	{
		name: "Method id",
		code: `// kind:file:Owner.name#arity[~types][$const]
"Method:src/db.ts:Repo.save#1~User"
"Method:container.h:Container.begin#0$const"`
	}
];
var SEARCH_INDEX = [
	...NAV.map((n) => ({
		id: `nav-${n.id}`,
		title: n.label,
		blurb: `Spec section ${n.kicker} — ${n.label}`,
		href: n.href,
		section: n.id,
		tags: ["section"]
	})),
	...PRD.goals.map((g, i) => ({
		id: `goal-${i}`,
		title: g,
		blurb: "Product goal",
		href: "/prd",
		section: "prd",
		tags: ["prd", "goal"]
	})),
	...FEATURES.map((f) => ({
		id: `feat-${f.id}`,
		title: f.name,
		blurb: f.summary,
		href: `/features#${f.id}`,
		section: "features",
		tags: [f.layer, f.status]
	})),
	...PHASES.map((p) => ({
		id: `phase-${p.id}`,
		title: `Phase ${p.id}`,
		blurb: p.output,
		href: `/pipeline#${p.id}`,
		section: "pipeline",
		tags: ["phase", ...p.deps]
	})),
	...NODE_TABLES.map((n) => ({
		id: `node-${n.name}`,
		title: `Node ${n.name}`,
		blurb: n.note,
		href: `/schema#node-${n.name}`,
		section: "schema",
		tags: ["node", n.kind]
	})),
	...RELATIONS.map((r) => ({
		id: `rel-${r.type}`,
		title: `Edge ${r.type}`,
		blurb: `${r.from} → ${r.to}. ${r.note}`,
		href: `/schema#rel-${r.type}`,
		section: "schema",
		tags: ["edge", r.pdg ? "pdg" : "core"]
	})),
	...MCP_TOOLS.map((t) => ({
		id: `tool-${t.name}`,
		title: t.name,
		blurb: t.purpose,
		href: `/mcp#${t.name}`,
		section: "mcp",
		tags: [
			"mcp",
			...t.pdg ? ["pdg"] : [],
			...t.group ? ["group"] : []
		]
	})),
	...RESOURCES.map((r) => ({
		id: `res-${r.uri}`,
		title: r.uri,
		blurb: r.purpose,
		href: "/mcp#resources",
		section: "mcp",
		tags: ["resource"]
	})),
	...SKILLS.map((s) => ({
		id: `skill-${s.id}`,
		title: s.name,
		blurb: s.body,
		href: "/mcp#skills",
		section: "mcp",
		tags: ["skill"]
	})),
	...CLI.map((c) => ({
		id: `cli-${c.cmd}`,
		title: c.cmd,
		blurb: c.purpose,
		href: "/cli",
		section: "cli",
		tags: ["cli"]
	})),
	...LANGUAGES.map((l) => ({
		id: `lang-${l.language}`,
		title: l.language,
		blurb: l.notes,
		href: `/languages#${l.language}`,
		section: "languages",
		tags: [
			"language",
			l.importStrategy,
			l.mro
		]
	})),
	...MODELS.map((m) => ({
		id: `model-${m.name}`,
		title: m.name,
		blurb: m.purpose,
		href: `/models#${m.name}`,
		section: "models",
		tags: ["model"]
	})),
	...PLAYBOOK.map((p) => ({
		id: `ms-${p.id}`,
		title: `${p.phase} ${p.title}`,
		blurb: p.goal,
		href: `/playbook#${p.id}`,
		section: "playbook",
		tags: ["milestone"]
	}))
];
function searchSpec(q) {
	const needle = q.trim().toLowerCase();
	if (needle.length < 2) return [];
	return SEARCH_INDEX.filter((h) => {
		return `${h.title} ${h.blurb} ${h.tags.join(" ")}`.toLowerCase().includes(needle);
	}).slice(0, 24);
}
function CommandPalette({ open, onClose }) {
	const [q, setQ] = (0, import_react.useState)("");
	const nav = useNavigate();
	const hits = (0, import_react.useMemo)(() => searchSpec(q), [q]);
	(0, import_react.useEffect)(() => {
		if (!open) setQ("");
	}, [open]);
	(0, import_react.useEffect)(() => {
		if (!open) return;
		const onKey = (e) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);
	if (!open) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "fixed inset-0 z-50 flex items-start justify-center bg-void/80 px-3 pt-[12vh]",
		onClick: onClose,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "w-full max-w-xl border border-line bg-plate shadow-[0_0_0_1px_#d6ff4a22]",
			onClick: (e) => e.stopPropagation(),
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "flex items-center gap-3 border-b border-line px-4 py-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "font-mono text-[10px] tracking-[0.2em] text-signal",
					children: "SEARCH"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					autoFocus: true,
					value: q,
					onChange: (e) => setQ(e.target.value),
					placeholder: "Tools, phases, nodes, languages…",
					className: "w-full bg-transparent font-mono text-sm text-paper outline-none placeholder:text-muted"
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "max-h-[50vh] overflow-y-auto py-2",
				children: q.trim().length < 2 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					className: "px-4 py-6 font-mono text-xs text-muted",
					children: "Type two characters."
				}) : hits.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					className: "px-4 py-6 font-mono text-xs text-muted",
					children: "No matches in the spec."
				}) : hits.map((h) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					className: cn("flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left hover:bg-signal/10"),
					onClick: () => {
						const [path, hash] = h.href.split("#");
						nav({ to: path });
						if (hash) requestAnimationFrame(() => {
							document.getElementById(hash)?.scrollIntoView({ block: "start" });
						});
						onClose();
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-mono text-[10px] uppercase tracking-[0.16em] text-signal",
							children: h.section
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-sm text-paper",
							children: h.title
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "line-clamp-1 text-xs text-muted",
							children: h.blurb
						})
					]
				}) }, h.id))
			})]
		})
	});
}
function Shell({ children }) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const [open, setOpen] = (0, import_react.useState)(false);
	const [palette, setPalette] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		const onKey = (e) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setPalette((v) => !v);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	(0, import_react.useEffect)(() => {
		setOpen(false);
	}, [pathname]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "min-h-screen",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
				href: "#content",
				className: "sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-signal focus:px-3 focus:py-2 focus:text-void",
				children: "Skip to spec"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "sticky top-0 z-40 flex h-12 items-center justify-between border-b border-line bg-void/95 px-3 backdrop-blur md:px-5",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "inline-flex size-10 items-center justify-center text-paper md:hidden",
						"aria-label": open ? "Close navigation" : "Open navigation",
						onClick: () => setOpen((v) => !v),
						children: open ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "size-5" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Menu, { className: "size-5" })
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
						to: "/",
						className: "flex items-baseline gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-mono text-[11px] tracking-[0.28em] text-signal",
							children: "NXS"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-sm font-semibold tracking-tight text-paper",
							children: APP.name
						})]
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "hidden font-mono text-[10px] text-muted sm:inline",
						children: [
							APP.product,
							" ",
							APP.version
						]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						onClick: () => setPalette(true),
						className: "inline-flex h-9 items-center gap-2 border border-line bg-plate px-3 font-mono text-[11px] text-muted hover:border-signal hover:text-signal",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Search, { className: "size-3.5" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "hidden sm:inline",
								children: "Search spec"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("kbd", {
								className: "hidden border border-line px-1 text-[10px] md:inline",
								children: "⌘K"
							})
						]
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mx-auto flex max-w-[1400px]",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
						className: cn("fixed inset-y-12 left-0 z-30 w-64 overflow-y-auto border-r border-line bg-void md:sticky md:top-12 md:block md:h-[calc(100vh-3rem)]", open ? "block" : "hidden"),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
							className: "flex flex-col py-4",
							"aria-label": "Specification",
							children: NAV.map((item) => {
								const active = pathname === item.href;
								return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
									to: item.href,
									className: cn("flex items-baseline gap-3 px-5 py-2 font-mono text-[12px] tracking-wide", active ? "bg-signal/10 text-signal" : "text-muted hover:bg-plate hover:text-paper"),
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "w-6 text-[10px] text-signal/70",
										children: item.kicker
									}), item.label]
								}, item.id);
							})
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "px-5 pb-8 pt-4 font-mono text-[10px] leading-relaxed text-muted",
							children: [
								"Reverse-engineered from the public GitNexus repo.",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
								"Snapshot ",
								APP.snapshot
							]
						})]
					}),
					open ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "fixed inset-0 z-20 bg-void/50 md:hidden",
						"aria-label": "Close navigation",
						onClick: () => setOpen(false)
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
						id: "content",
						className: "min-w-0 flex-1 px-4 py-8 md:px-10 md:py-10",
						children
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CommandPalette, {
				open: palette,
				onClose: () => setPalette(false)
			})
		]
	});
}
function PageHead({ kicker, title, lede }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
		className: "mb-10 max-w-3xl border-b border-line pb-8",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "font-mono text-[11px] tracking-[0.28em] text-signal",
				children: kicker
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "mt-3 text-3xl font-semibold tracking-tight text-paper md:text-4xl",
				children: title
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-4 text-base leading-relaxed text-muted",
				children: lede
			})
		]
	});
}
function Panel({ children, className }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
		className: cn("border border-line bg-plate/80 p-5 md:p-6", className),
		children
	});
}
var styles_default = "/assets/styles-BXsEe_3b.css";
var APP_NAME = "Nexus Forge";
var Route$14 = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{ title: APP_NAME },
			{
				name: "description",
				content: "Rebuild specification for GitNexus: PRD, architecture, feature list, graph schema, pipeline DAG, MCP tools, and a phased playbook."
			},
			{
				name: "theme-color",
				content: "#090b09"
			}
		],
		links: [
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg"
			},
			{
				rel: "stylesheet",
				href: styles_default
			},
			{
				rel: "manifest",
				href: "/__grok/manifest.webmanifest"
			},
			{
				rel: "apple-touch-icon",
				href: "/__grok/icon-180.png"
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap"
			}
		]
	}),
	component: () => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("html", {
		lang: "en",
		className: "antialiased",
		suppressHydrationWarning: true,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("head", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeadContent, {}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("body", {
			className: "bg-void text-paper",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PreviewHostBridge, {}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AuthProvider, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Shell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {}) }) }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scripts, {})
			]
		})]
	})
});
var $$splitComponentImporter$13 = () => import("./routes-BRR-YHIA.mjs");
var Route$13 = createFileRoute("/")({ component: lazyRouteComponent($$splitComponentImporter$13, "component") });
var $$splitComponentImporter$12 = () => import("./architecture-CqlJnZzd.mjs");
var Route$12 = createFileRoute("/architecture")({ component: lazyRouteComponent($$splitComponentImporter$12, "component") });
var $$splitComponentImporter$11 = () => import("./cli-Bo-9Ba--.mjs");
var Route$11 = createFileRoute("/cli")({ component: lazyRouteComponent($$splitComponentImporter$11, "component") });
var $$splitComponentImporter$10 = () => import("./features-DxMBkkbG.mjs");
var Route$10 = createFileRoute("/features")({ component: lazyRouteComponent($$splitComponentImporter$10, "component") });
var $$splitComponentImporter$9 = () => import("./languages-DiIxghey.mjs");
var Route$9 = createFileRoute("/languages")({ component: lazyRouteComponent($$splitComponentImporter$9, "component") });
var $$splitComponentImporter$8 = () => import("./mcp-084lg_j2.mjs");
var Route$8 = createFileRoute("/mcp")({ component: lazyRouteComponent($$splitComponentImporter$8, "component") });
var $$splitComponentImporter$7 = () => import("./models-YJCgii8x.mjs");
var Route$7 = createFileRoute("/models")({ component: lazyRouteComponent($$splitComponentImporter$7, "component") });
var $$splitComponentImporter$6 = () => import("./packages-BfNd01Ml.mjs");
var Route$6 = createFileRoute("/packages")({ component: lazyRouteComponent($$splitComponentImporter$6, "component") });
var $$splitComponentImporter$5 = () => import("./pipeline-BfkxchRS.mjs");
var Route$5 = createFileRoute("/pipeline")({ component: lazyRouteComponent($$splitComponentImporter$5, "component") });
var $$splitComponentImporter$4 = () => import("./playbook-m7TUgHg_.mjs");
var Route$4 = createFileRoute("/playbook")({ component: lazyRouteComponent($$splitComponentImporter$4, "component") });
var $$splitComponentImporter$3 = () => import("./prd-BsEPN7Zy.mjs");
var Route$3 = createFileRoute("/prd")({ component: lazyRouteComponent($$splitComponentImporter$3, "component") });
var $$splitComponentImporter$2 = () => import("./quality-bHhC4sl2.mjs");
var Route$2 = createFileRoute("/quality")({ component: lazyRouteComponent($$splitComponentImporter$2, "component") });
var $$splitComponentImporter$1 = () => import("./schema-BHoHFRp3.mjs");
var Route$1 = createFileRoute("/schema")({ component: lazyRouteComponent($$splitComponentImporter$1, "component") });
var $$splitComponentImporter = () => import("./stack-B3G_ctDO.mjs");
var Route = createFileRoute("/stack")({ component: lazyRouteComponent($$splitComponentImporter, "component") });
var rootRouteChildren = {
	IndexRoute: Route$13.update({
		id: "/",
		path: "/",
		getParentRoute: () => Route$14
	}),
	ArchitectureRoute: Route$12.update({
		id: "/architecture",
		path: "/architecture",
		getParentRoute: () => Route$14
	}),
	CliRoute: Route$11.update({
		id: "/cli",
		path: "/cli",
		getParentRoute: () => Route$14
	}),
	FeaturesRoute: Route$10.update({
		id: "/features",
		path: "/features",
		getParentRoute: () => Route$14
	}),
	LanguagesRoute: Route$9.update({
		id: "/languages",
		path: "/languages",
		getParentRoute: () => Route$14
	}),
	McpRoute: Route$8.update({
		id: "/mcp",
		path: "/mcp",
		getParentRoute: () => Route$14
	}),
	ModelsRoute: Route$7.update({
		id: "/models",
		path: "/models",
		getParentRoute: () => Route$14
	}),
	PackagesRoute: Route$6.update({
		id: "/packages",
		path: "/packages",
		getParentRoute: () => Route$14
	}),
	PipelineRoute: Route$5.update({
		id: "/pipeline",
		path: "/pipeline",
		getParentRoute: () => Route$14
	}),
	PlaybookRoute: Route$4.update({
		id: "/playbook",
		path: "/playbook",
		getParentRoute: () => Route$14
	}),
	PrdRoute: Route$3.update({
		id: "/prd",
		path: "/prd",
		getParentRoute: () => Route$14
	}),
	QualityRoute: Route$2.update({
		id: "/quality",
		path: "/quality",
		getParentRoute: () => Route$14
	}),
	SchemaRoute: Route$1.update({
		id: "/schema",
		path: "/schema",
		getParentRoute: () => Route$14
	}),
	StackRoute: Route.update({
		id: "/stack",
		path: "/stack",
		getParentRoute: () => Route$14
	})
};
var routeTree = Route$14._addFileChildren(rootRouteChildren)._addFileTypes();
var router_exports = /* @__PURE__ */ __exportAll({ getRouter: () => getRouter });
function getRouter() {
	return createRouter({
		routeTree,
		defaultErrorComponent: AppErrorComponent
	});
}
//#endregion
export { PRD as A, PDG_PHASES as C, SCOPE_STAGES as D, RUNNER_RULES as E, APP as M, NAV as N, FEATURES as O, PDG_LAYERS as S, ROUTE_SOURCES as T, RELATIONS as _, MODEL_SNIPPETS as a, MRO as b, LANGUAGES as c, PROMPTS as d, RESOURCES as f, NODE_TABLES as g, ID_RULES as h, MODELS as i, cn as j, LAYERS as k, CLI as l, CAPTURE_TAGS as m, PageHead as n, PLAYBOOK as o, SKILLS as p, Panel as r, ADD_LANGUAGE as s, router_exports as t, MCP_TOOLS as u, IMPORT_STRATEGIES as v, PHASES as w, PARSE_CHUNK as x, IMPORT_TIERS as y };
