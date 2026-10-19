import { x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as PageHead, r as Panel } from "./router-2D7qrjqM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/quality-bHhC4sl2.js
var import_jsx_runtime = require_jsx_runtime();
var DOD = {
	statement: "A change is Done when it is correct, safely integrated, appropriately tested, operationally sound, and a net improvement — not merely 'it compiles and a test passes.'",
	axes: [
		{
			name: "Correctness",
			items: [
				"End-to-end in the real runtime path — no test-only shims.",
				"Edge cases handled or documented as out of scope.",
				"Validate at system boundaries; trust internal code."
			]
		},
		{
			name: "Placement",
			items: [
				"CLI/MCP/ingestion → gitnexus/. UI → gitnexus-web/. Contracts → gitnexus-shared/.",
				"Shared ingestion never names a language. LanguageProvider / ScopeResolver only.",
				"No hidden cross-phase coupling. Direct shared imports, no drift-hiding barrels."
			]
		},
		{
			name: "Contracts",
			items: ["CLI flags, MCP tools, HTTP routes, graph shapes, node IDs stay stable unless the task is a break.", "Persisted schema changes ship a reindex/migration path (MIGRATION.md)."]
		},
		{
			name: "Security",
			items: ["No command/path/Cypher/prompt injection on untrusted input.", "Filesystem access honors repo-scope. No secrets in logs."]
		},
		{
			name: "Performance",
			items: ["Tree-sitter buffers 512KB–32MB adaptive — never a hard-coded giant.", "DB handles close. Workers are the parse path. Long graphs stream or bound."]
		},
		{
			name: "Tests",
			items: ["Integration tests use a real LadybugDB — no mocks that hide schema drift.", "Fixtures match the risk. Deterministic. Exact assertions (toBe/toEqual)."]
		}
	],
	notDone: [
		"Runtime path not exercised by tests.",
		"Contract drift between packages.",
		"Language-specific logic leaked into shared ingestion.",
		"Unrelated reformat/refactor churn.",
		"Placeholder TODOs added.",
		"CHANGELOG.md edited in a PR (release-owned).",
		"Treating UNKNOWN impact risk as safe."
	],
	agentRules: [
		"Run impact on a symbol before editing it. HIGH/CRITICAL blocks the edit.",
		"Run detect_changes before commit.",
		"Never find-and-replace for renames — use the rename tool.",
		"The CLI indexer does not call an LLM."
	],
	tests: [
		{
			cmd: "cd gitnexus && npm test",
			note: "Full CLI suite (unit + integration)."
		},
		{
			cmd: "npm run test:unit",
			note: "Unit only."
		},
		{
			cmd: "npm run test:integration",
			note: "Real DB. pretest builds."
		},
		{
			cmd: "npx tsc --noEmit",
			note: "CLI typecheck."
		},
		{
			cmd: "cd gitnexus-web && npm test && npm run test:e2e",
			note: "Vitest + Playwright."
		},
		{
			cmd: "cd gitnexus-shared && npm run build",
			note: "Must precede dependents."
		}
	]
};
var LIMITS = [
	"Overloaded method IDs are collision-only — adding an overload changes the existing id.",
	"Languages without types (Python, Ruby, JS) cannot same-arity disambiguate.",
	"CFG/PDG visitors today: TypeScript and JavaScript only.",
	"Browser WASM indexer ~5k files unless you use gitnexus serve.",
	"Cross-repo data flow does not cross a ContractLink. Trace depth is 1 hop.",
	"NestJS setGlobalPrefix / URI versioning in bootstrap files are not applied to controller-relative paths.",
	"A missing route is a coverage limit. Never invent one."
];
function QualityPage() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHead, {
			kicker: "13 / QUALITY BAR",
			title: "Done means the graph is honest.",
			lede: DOD.statement
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "grid gap-4 md:grid-cols-2",
			children: DOD.axes.map((a) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-semibold text-paper",
				children: a.name
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-3 space-y-2 text-sm text-muted",
				children: a.items.map((i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					className: "border-l border-line pl-3",
					children: i
				}, i))
			})] }, a.name))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "NOT DONE — EVEN IF CI IS GREEN"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
			className: "mt-4 space-y-2",
			children: DOD.notDone.map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
				className: "border border-line bg-plate px-4 py-3 text-sm text-muted",
				children: n
			}, n))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "AGENT RULES"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
			className: "mt-4 space-y-2",
			children: DOD.agentRules.map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
				className: "border-l-2 border-signal bg-plate px-4 py-3 text-sm text-paper",
				children: n
			}, n))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "VALIDATION"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 overflow-x-auto border border-line",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
				className: "w-full min-w-[640px] text-left text-sm",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
					className: "bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "px-4 py-3",
						children: "Command"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "px-4 py-3",
						children: "Note"
					})] })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: DOD.tests.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
					className: "border-t border-line",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "px-4 py-3 font-mono text-xs text-signal",
						children: t.cmd
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "px-4 py-3 text-paper",
						children: t.note
					})]
				}, t.cmd)) })]
			})
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "KNOWN LIMITS TO PRESERVE"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
			className: "mt-4 space-y-2",
			children: LIMITS.map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
				className: "border border-line px-4 py-3 text-sm text-muted",
				children: n
			}, n))
		})
	] });
}
//#endregion
export { QualityPage as component };
