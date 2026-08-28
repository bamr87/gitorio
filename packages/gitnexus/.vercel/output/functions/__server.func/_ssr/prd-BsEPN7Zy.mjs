import { x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { A as PRD, n as PageHead, r as Panel } from "./router-2D7qrjqM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/prd-BsEPN7Zy.js
var import_jsx_runtime = require_jsx_runtime();
function PrdPage() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHead, {
			kicker: "01 / PRODUCT REQUIREMENTS",
			title: "PRD — GitNexus",
			lede: "What to build, who it is for, what success looks like, and what must never ship."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "font-mono text-[11px] text-signal",
				children: PRD.name
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-1 text-xl font-semibold text-paper",
				children: PRD.tagline
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-3 max-w-3xl leading-relaxed text-muted",
				children: PRD.oneLiner
			})
		] }),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "PROBLEM"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 grid gap-4 md:grid-cols-2",
			children: PRD.problem.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "text-lg font-semibold text-paper",
				children: p.title
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm leading-relaxed text-muted",
				children: p.body
			})] }, p.title))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "USERS"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 grid gap-4",
			children: PRD.users.map((u) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "text-lg font-semibold text-paper",
					children: u.persona
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-paper",
					children: u.need
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-1 text-sm text-muted",
					children: u.job
				})
			] }, u.persona))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mt-12 grid gap-4 md:grid-cols-2",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-mono text-[11px] tracking-[0.2em] text-signal",
				children: "GOALS"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-4 space-y-2 text-sm leading-relaxed text-paper",
				children: PRD.goals.map((g) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					className: "border-l border-signal pl-3",
					children: g
				}, g))
			})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-mono text-[11px] tracking-[0.2em] text-signal",
				children: "NON-GOALS"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-4 space-y-2 text-sm leading-relaxed text-muted",
				children: PRD.nonGoals.map((g) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					className: "border-l border-line pl-3",
					children: g
				}, g))
			})] })]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "PRINCIPLES"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 grid gap-4 md:grid-cols-2",
			children: PRD.principles.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "font-semibold text-paper",
				children: p.name
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm leading-relaxed text-muted",
				children: p.body
			})] }, p.name))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "SUCCESS METRICS"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 overflow-x-auto border border-line",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
				className: "w-full min-w-[640px] text-left text-sm",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
					className: "bg-inset font-mono text-[10px] uppercase tracking-[0.16em] text-muted",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "px-4 py-3",
						children: "Metric"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "px-4 py-3",
						children: "Target"
					})] })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: PRD.success.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
					className: "border-t border-line",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "px-4 py-3 font-medium text-paper",
						children: s.metric
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "px-4 py-3 text-muted",
						children: s.target
					})]
				}, s.metric)) })]
			})
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "CONSTRAINTS"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
			className: "mt-4 space-y-2 text-sm text-muted",
			children: PRD.constraints.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
				className: "border border-line bg-plate px-4 py-3",
				children: c
			}, c))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "mt-12 font-mono text-[11px] tracking-[0.2em] text-signal",
			children: "JOURNEYS"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4 grid gap-4",
			children: PRD.journeys.map((j) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "text-lg font-semibold text-paper",
				children: j.name
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
				className: "mt-3 list-decimal space-y-1 pl-5 text-sm text-muted",
				children: j.steps.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: s }, s))
			})] }, j.name))
		})
	] });
}
//#endregion
export { PrdPage as component };
