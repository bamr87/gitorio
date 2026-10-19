import { v as Link, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { A as PRD, M as APP, N as NAV, O as FEATURES, _ as RELATIONS, c as LANGUAGES, g as NODE_TABLES, o as PLAYBOOK, r as Panel, u as MCP_TOOLS, w as PHASES } from "./router-2D7qrjqM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-BRR-YHIA.js
var import_jsx_runtime = require_jsx_runtime();
var STATS = [
	{
		k: "Languages",
		v: String(LANGUAGES.length)
	},
	{
		k: "Pipeline phases",
		v: String(PHASES.length)
	},
	{
		k: "Node tables",
		v: String(NODE_TABLES.length)
	},
	{
		k: "Relation types",
		v: String(RELATIONS.length)
	},
	{
		k: "MCP tools",
		v: String(MCP_TOOLS.length)
	},
	{
		k: "Features",
		v: String(FEATURES.length)
	},
	{
		k: "Rebuild milestones",
		v: String(PLAYBOOK.length)
	},
	{
		k: "Source stars",
		v: APP.stars
	}
];
function Overview() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "font-mono text-[11px] tracking-[0.28em] text-signal",
			children: "00 / OVERVIEW"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
			className: "mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-paper md:text-5xl",
			children: "Rebuild GitNexus from the graph up."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-5 max-w-2xl text-lg leading-relaxed text-muted",
			children: PRD.oneLiner
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "mt-4 max-w-2xl text-sm text-muted",
			children: [
				"This workbench is the product requirements document, architecture, feature catalog, data models, frameworks, and a 14-milestone playbook extracted from",
				" ",
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
					className: "text-signal underline-offset-4 hover:underline",
					href: APP.source,
					target: "_blank",
					rel: "noreferrer",
					children: "abhigyanpatwari/GitNexus"
				}),
				" ",
				"(",
				APP.snapshot,
				"). Use it as the instruction set to implement the engine from scratch."
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dl", {
			className: "mt-10 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4",
			children: STATS.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "bg-plate px-4 py-4",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
					className: "font-mono text-[10px] uppercase tracking-[0.16em] text-muted",
					children: s.k
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
					className: "mt-1 font-mono text-2xl tabular-nums text-signal",
					children: s.v
				})]
			}, s.k))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-10 grid gap-4 md:grid-cols-2",
			children: NAV.filter((n) => n.id !== "overview").map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
				to: n.href,
				className: "group border border-line bg-plate/70 p-5 hover:border-signal",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "font-mono text-[10px] text-signal",
					children: n.kicker
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "mt-2 text-lg font-semibold text-paper group-hover:text-signal",
					children: n.label
				})]
			}, n.id))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
			className: "mt-10",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-mono text-[11px] tracking-[0.2em] text-signal",
					children: "THESIS"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 max-w-3xl text-base leading-relaxed text-paper",
					children: PRD.vision
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("blockquote", {
					className: "mt-6 max-w-3xl border-l-2 border-signal pl-4 text-muted",
					children: "Agents don't fail because they are not smart enough. They fail because they lack structural awareness. GitNexus precomputes the map so the model can reason instead of grep."
				})
			]
		})
	] });
}
//#endregion
export { Overview as component };
