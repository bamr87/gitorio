import { x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { d as PROMPTS, f as RESOURCES, n as PageHead, p as SKILLS, r as Panel, u as MCP_TOOLS } from "./router-2D7qrjqM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/mcp-084lg_j2.js
var import_jsx_runtime = require_jsx_runtime();
function McpPage() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHead, {
			kicker: "07 / MCP SURFACE",
			title: "The agent API is the product.",
			lede: "stdio MCP via gitnexus mcp. Same LocalBackend as HTTP and CLI. Group tools are list/sync only — group state lives on resources."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", {
			className: "font-mono text-[11px] tracking-[0.2em] text-signal",
			children: [
				"TOOLS (",
				MCP_TOOLS.length,
				")"
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 grid gap-3",
			children: MCP_TOOLS.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				className: "scroll-mt-20",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { id: t.name }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-baseline gap-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
								className: "font-mono text-lg text-signal",
								children: t.name
							}),
							t.pdg ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-mono text-[10px] text-muted",
								children: "REQUIRES --pdg"
							}) : null,
							t.group ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-mono text-[10px] text-muted",
								children: "GROUP"
							}) : null
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm text-paper",
						children: t.purpose
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-2 font-mono text-[11px] text-muted",
						children: ["params: ", t.params.join(" · ")]
					}),
					t.notes ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm text-muted",
						children: t.notes
					}) : null
				]
			}, t.name))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			id: "resources",
			className: "mt-12 scroll-mt-20 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "RESOURCES"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 overflow-x-auto border border-line",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
				className: "w-full min-w-[640px] text-left text-sm",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
					className: "bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "px-4 py-3",
						children: "URI"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "px-4 py-3",
						children: "Purpose"
					})] })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: RESOURCES.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
					className: "border-t border-line",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "px-4 py-3 font-mono text-xs text-signal",
						children: r.uri
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "px-4 py-3 text-paper",
						children: r.purpose
					})]
				}, r.uri)) })]
			})
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "PROMPTS"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 grid gap-3 md:grid-cols-2",
			children: PROMPTS.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "font-mono text-signal",
				children: p.name
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm text-muted",
				children: p.purpose
			})] }, p.name))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			id: "skills",
			className: "mt-12 scroll-mt-20 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "AGENT SKILLS"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 grid gap-3 md:grid-cols-2",
			children: SKILLS.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "font-mono text-[11px] text-signal",
					children: s.id
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "mt-1 font-semibold text-paper",
					children: s.name
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-muted",
					children: s.body
				})
			] }, s.id))
		})
	] });
}
//#endregion
export { McpPage as component };
