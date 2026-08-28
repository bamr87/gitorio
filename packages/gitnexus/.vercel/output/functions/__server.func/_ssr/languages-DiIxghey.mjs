import { x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as LANGUAGES, n as PageHead, r as Panel, s as ADD_LANGUAGE } from "./router-2D7qrjqM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/languages-DiIxghey.js
var import_jsx_runtime = require_jsx_runtime();
var COLS = [
	"Imp",
	"Named",
	"Exp",
	"Her",
	"Types",
	"Ctor",
	"Cfg",
	"Fw",
	"Entry",
	"PDG"
];
function LangPage() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHead, {
			kicker: "09 / LANGUAGES",
			title: "Sixteen languages, one schema.",
			lede: "A language is a LanguageProvider plus a ScopeResolver. Shared ingestion never names a language. Missing a provider is a compile error."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "overflow-x-auto border border-line",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
				className: "w-full min-w-[1100px] text-left text-sm",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
					className: "bg-inset font-mono text-[10px] uppercase tracking-[0.12em] text-muted",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "px-3 py-3",
							children: "Language"
						}),
						COLS.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "px-2 py-3 text-center",
							children: c
						}, c)),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "px-3 py-3",
							children: "Import"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "px-3 py-3",
							children: "MRO"
						})
					] })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: LANGUAGES.map((l) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
					id: l.language,
					className: "scroll-mt-20 border-t border-line",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "px-3 py-3 font-medium text-paper",
							children: l.language
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cell, { on: l.imports }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cell, { on: l.named }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cell, { on: l.exports }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cell, { on: l.heritage }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cell, { on: l.types }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cell, { on: l.ctor }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cell, { on: l.config }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cell, { on: l.frameworks }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cell, { on: l.entry }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cell, { on: l.pdg }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "px-3 py-3 font-mono text-[11px] text-muted",
							children: l.importStrategy
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "px-3 py-3 font-mono text-[11px] text-muted",
							children: l.mro
						})
					]
				}, l.language)) })]
			})
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-3 font-mono text-[11px] text-muted",
			children: "Imp=imports Named=named bindings Exp=exports Her=heritage Ctor=constructor inference Cfg=config parsing Fw=frameworks"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "NOTES"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 grid gap-3",
			children: LANGUAGES.map((l) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap items-baseline gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "font-semibold text-paper",
					children: l.language
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "font-mono text-[11px] text-signal",
					children: l.extensions.join(" ")
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm text-muted",
				children: l.notes
			})] }, l.language))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "ADD A LANGUAGE"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
			className: "mt-4 space-y-3",
			children: ADD_LANGUAGE.map((s, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
				className: "flex gap-3 border border-line bg-plate px-4 py-3 text-sm text-muted",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "font-mono text-[11px] text-signal",
					children: String(i + 1).padStart(2, "0")
				}), s]
			}, s))
		})
	] });
}
function Cell({ on }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
		className: "px-2 py-3 text-center font-mono text-xs",
		children: on ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "text-signal",
			children: "●"
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "text-line",
			children: "○"
		})
	});
}
//#endregion
export { LangPage as component };
