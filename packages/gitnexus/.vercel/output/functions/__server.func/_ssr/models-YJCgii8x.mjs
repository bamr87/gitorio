import { x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as MODEL_SNIPPETS, i as MODELS, n as PageHead, r as Panel } from "./router-2D7qrjqM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/models-YJCgii8x.js
var import_jsx_runtime = require_jsx_runtime();
function ModelsPage() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHead, {
			kicker: "06 / MODELS",
			title: "The types the rest of the system is built on.",
			lede: "Implement these contracts first. Shared types live in gitnexus-shared; runtime classes live in gitnexus/src/core."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "grid gap-4",
			children: MODELS.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				className: "scroll-mt-20",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { id: m.name }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-mono text-[11px] text-signal",
						children: m.path
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "mt-1 text-xl font-semibold text-paper",
						children: m.name
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm leading-relaxed text-muted",
						children: m.purpose
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-4 space-y-1",
						children: m.fields.map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
							className: "font-mono text-xs text-paper",
							children: f
						}, f))
					})
				]
			}, m.name))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "SNIPPETS"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 grid gap-4",
			children: MODEL_SNIPPETS.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "font-mono text-sm text-signal",
				children: s.name
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
				className: "mt-3 overflow-x-auto font-mono text-xs leading-relaxed text-paper",
				children: s.code
			})] }, s.name))
		})
	] });
}
//#endregion
export { ModelsPage as component };
