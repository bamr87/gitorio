import { i as __toESM } from "../_runtime.mjs";
import { B as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { O as FEATURES, j as cn, k as LAYERS, n as PageHead, r as Panel } from "./router-2D7qrjqM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/features-DxMBkkbG.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function FeaturesPage() {
	const [layer, setLayer] = (0, import_react.useState)("all");
	const items = (0, import_react.useMemo)(() => layer === "all" ? FEATURES : FEATURES.filter((f) => f.layer === layer), [layer]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHead, {
			kicker: "03 / FEATURE CATALOG",
			title: "What the engine actually does.",
			lede: "Filter by layer. Core ships in the default analyze. Opt-in needs a flag (--pdg, --embeddings, wiki). Web-only and CLI-only stay in their package."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mb-8 flex flex-wrap gap-2",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FilterChip, {
				active: layer === "all",
				onClick: () => setLayer("all"),
				label: "All"
			}), LAYERS.map((l) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FilterChip, {
				active: layer === l.id,
				onClick: () => setLayer(l.id),
				label: l.label
			}, l.id))]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "mb-4 font-mono text-[11px] text-muted",
			children: [items.length, " features"]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "grid gap-4",
			children: items.map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				className: "scroll-mt-20",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { id: f.id }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-baseline gap-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "text-lg font-semibold text-paper",
								children: f.name
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-mono text-[10px] uppercase tracking-[0.16em] text-signal",
								children: f.layer
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-mono text-[10px] uppercase tracking-[0.16em] text-muted",
								children: f.status
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm leading-relaxed text-muted",
						children: f.summary
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-3 space-y-1 text-sm text-paper",
						children: f.details.map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
							className: "border-l border-line pl-3 text-muted",
							children: d
						}, d))
					})
				]
			}, f.id))
		})
	] });
}
function FilterChip({ active, onClick, label }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		onClick,
		className: cn("h-9 border px-3 font-mono text-[11px] tracking-wide", active ? "border-signal bg-signal text-void" : "border-line text-muted hover:text-paper"),
		children: label
	});
}
//#endregion
export { FeaturesPage as component };
