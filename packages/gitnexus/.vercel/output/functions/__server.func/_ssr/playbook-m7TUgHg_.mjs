import { x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { j as cn, n as PageHead, o as PLAYBOOK, r as Panel } from "./router-2D7qrjqM.mjs";
import { n as persist, r as create, t as createJSONStorage } from "../_libs/zustand.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/playbook-m7TUgHg_.js
var import_jsx_runtime = require_jsx_runtime();
var noopStorage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {}
};
var usePlaybook = create()(persist((set) => ({
	checked: {},
	toggle: (id) => set((s) => ({ checked: {
		...s.checked,
		[id]: !s.checked[id]
	} })),
	reset: () => set({ checked: {} })
}), {
	name: "nexus-forge-playbook",
	storage: createJSONStorage(() => typeof window === "undefined" ? noopStorage : localStorage)
}));
function PlaybookPage() {
	const checked = usePlaybook((s) => s.checked);
	const toggle = usePlaybook((s) => s.toggle);
	const reset = usePlaybook((s) => s.reset);
	const total = PLAYBOOK.reduce((n, m) => n + m.tasks.length, 0);
	const done = PLAYBOOK.reduce((n, m) => n + m.tasks.filter((t) => checked[t.id]).length, 0);
	const pct = total ? Math.round(done / total * 100) : 0;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHead, {
			kicker: "12 / REBUILD PLAYBOOK",
			title: "Implement in this order.",
			lede: "Fourteen milestones from an empty monorepo to MCP + web + groups + PDG. Check tasks off locally — progress stays in this browser."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
			className: "mb-8",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap items-end justify-between gap-4",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "font-mono text-[11px] text-signal",
					children: "PROGRESS"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mt-1 font-mono text-3xl tabular-nums text-paper",
					children: [done, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "text-lg text-muted",
						children: [" / ", total]
					})]
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: reset,
					className: "h-10 border border-line px-4 font-mono text-[11px] text-muted hover:border-signal hover:text-signal",
					children: "Reset checklist"
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-4 h-1 bg-line",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "h-full bg-signal",
					style: { width: `${pct}%` }
				})
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "grid gap-6",
			children: PLAYBOOK.map((m) => {
				const mDone = m.tasks.filter((t) => checked[t.id]).length;
				return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
					className: "scroll-mt-20",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { id: m.id }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-wrap items-baseline justify-between gap-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "font-mono text-[11px] text-signal",
								children: m.phase
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "font-mono text-[11px] tabular-nums text-muted",
								children: [
									mDone,
									"/",
									m.tasks.length
								]
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "mt-1 text-xl font-semibold text-paper",
							children: m.title
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-2 text-sm leading-relaxed text-muted",
							children: m.goal
						}),
						m.depends.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "mt-2 font-mono text-[11px] text-muted",
							children: ["depends: ", m.depends.join(", ")]
						}) : null,
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "mt-4 flex flex-wrap gap-1.5",
							children: m.files.map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "border border-line bg-inset px-2 py-1 font-mono text-[10px] text-muted",
								children: f
							}, f))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
							className: "mt-5 space-y-3",
							children: m.tasks.map((t) => {
								const on = Boolean(checked[t.id]);
								return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "flex cursor-pointer gap-3",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: on,
										onChange: () => toggle(t.id),
										className: "mt-1 size-4 shrink-0 accent-signal"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: cn("block text-sm", on ? "text-muted line-through" : "text-paper"),
										children: t.title
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "mt-1 block text-xs text-muted",
										children: t.doneHint
									})] })]
								}) }, t.id);
							})
						})
					]
				}, m.id);
			})
		})
	] });
}
//#endregion
export { PlaybookPage as component };
