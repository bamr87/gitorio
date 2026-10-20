import { i as __toESM } from "../_runtime.mjs";
import { B as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { _ as RELATIONS, g as NODE_TABLES, h as ID_RULES, j as cn, m as CAPTURE_TAGS, n as PageHead, r as Panel } from "./router-2D7qrjqM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/schema-BHoHFRp3.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function SchemaPage() {
	const [node, setNode] = (0, import_react.useState)(null);
	const related = (0, import_react.useMemo)(() => {
		if (!node) return RELATIONS;
		return RELATIONS.filter((r) => r.from.includes(node) || r.to.includes(node) || r.type.includes(node));
	}, [node]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHead, {
			kicker: "05 / GRAPH SCHEMA",
			title: "One CodeRelation table. Many node tables.",
			lede: "LadybugDB schema in gitnexus/src/core/lbug/schema.ts. PDG types stay out of VALID_RELATION_TYPES and the web graph unless --pdg."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "NODE TABLES"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-2 text-sm text-muted",
			children: "Select a node to filter incident relations."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mt-4 flex flex-wrap gap-2",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				onClick: () => setNode(null),
				className: cn("h-9 border px-3 font-mono text-[11px]", !node ? "border-signal bg-signal text-void" : "border-line text-muted"),
				children: "All"
			}), NODE_TABLES.map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				id: `node-${n.name}`,
				onClick: () => setNode(n.name),
				className: cn("h-9 border px-3 font-mono text-[11px] scroll-mt-20", node === n.name ? "border-signal bg-signal text-void" : "border-line text-paper hover:border-signal"),
				children: n.name
			}, n.name))]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-6 overflow-x-auto border border-line",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
				className: "w-full min-w-[640px] text-left text-sm",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
					className: "bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "px-4 py-3",
							children: "Table"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "px-4 py-3",
							children: "Kind"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "px-4 py-3",
							children: "Note"
						})
					] })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: NODE_TABLES.filter((n) => !node || n.name === node).map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
					className: "border-t border-line",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "px-4 py-3 font-mono text-signal",
							children: n.name
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "px-4 py-3 font-mono text-xs text-muted",
							children: n.kind
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "px-4 py-3 text-paper",
							children: n.note
						})
					]
				}, n.name)) })]
			})
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "RELATIONS"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 overflow-x-auto border border-line",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
				className: "w-full min-w-[800px] text-left text-sm",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
					className: "bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "px-4 py-3",
							children: "Type"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "px-4 py-3",
							children: "From"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "px-4 py-3",
							children: "To"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "px-4 py-3",
							children: "Note"
						})
					] })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: related.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
					id: `rel-${r.type}`,
					className: "scroll-mt-20 border-t border-line",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
							className: "px-4 py-3 font-mono text-signal",
							children: [r.type, r.pdg ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "ml-2 text-[10px] text-muted",
								children: "PDG"
							}) : null]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "px-4 py-3 font-mono text-xs text-muted",
							children: r.from
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "px-4 py-3 font-mono text-xs text-muted",
							children: r.to
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "px-4 py-3 text-paper",
							children: r.note
						})
					]
				}, r.type + r.from)) })]
			})
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "ID RULES"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
			className: "mt-4 space-y-2",
			children: ID_RULES.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
				className: "border border-line bg-plate px-4 py-3 text-sm text-muted",
				children: r
			}, r))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "UNIFIED CAPTURE TAGS"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 flex flex-wrap gap-2",
			children: CAPTURE_TAGS.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "border border-line bg-inset px-3 py-1.5 font-mono text-xs text-signal",
				children: t
			}, t))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, {
			className: "mt-4",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Per-language tree-sitter queries use different AST node names but must emit these tags. Downstream extraction never branches on language. Defined in tree-sitter-queries.ts."
			})
		})
	] });
}
//#endregion
export { SchemaPage as component };
