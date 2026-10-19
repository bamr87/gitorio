import { x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { l as CLI, n as PageHead, r as Panel } from "./router-2D7qrjqM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/cli-Bo-9Ba--.js
var import_jsx_runtime = require_jsx_runtime();
function CliPage() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHead, {
			kicker: "08 / CLI",
			title: "The binary is gitnexus.",
			lede: "Published as npm package gitnexus. Global install is recommended so MCP startup stays fast. Bin: dist/cli/index.js. commander + i18n help."
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "grid gap-3",
			children: CLI.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-mono text-sm text-signal md:text-base",
					children: c.cmd
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-paper",
					children: c.purpose
				}),
				c.flags ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-3 flex flex-wrap gap-1.5",
					children: c.flags.map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "border border-line bg-inset px-2 py-1 font-mono text-[11px] text-muted",
						children: f
					}, f))
				}) : null
			] }, c.cmd))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
			className: "mt-8",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-mono text-[11px] tracking-[0.2em] text-signal",
				children: "INSTALL"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
				className: "mt-4 overflow-x-auto font-mono text-xs leading-relaxed text-paper",
				children: `npm install -g gitnexus
gitnexus analyze --embeddings --skills
gitnexus setup

# no C++ toolchain
GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1 npm install -g gitnexus

# pnpm (npm 11 crashes on optional native builds)
pnpm --allow-build=@ladybugdb/core --allow-build=gitnexus --allow-build=tree-sitter \\
  dlx gitnexus@latest analyze`
			})]
		})
	] });
}
//#endregion
export { CliPage as component };
