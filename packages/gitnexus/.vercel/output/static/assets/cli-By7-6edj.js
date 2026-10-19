import{P as e,c as t,n,t as r}from"./index-CsnyGkpc.js";var i=e();function a(){return(0,i.jsxs)(`div`,{children:[(0,i.jsx)(r,{kicker:`08 / CLI`,title:`The binary is gitnexus.`,lede:`Published as npm package gitnexus. Global install is recommended so MCP startup stays fast. Bin: dist/cli/index.js. commander + i18n help.`}),(0,i.jsx)(`div`,{className:`grid gap-3`,children:t.map(e=>(0,i.jsxs)(n,{children:[(0,i.jsx)(`h2`,{className:`font-mono text-sm text-signal md:text-base`,children:e.cmd}),(0,i.jsx)(`p`,{className:`mt-2 text-sm text-paper`,children:e.purpose}),e.flags?(0,i.jsx)(`div`,{className:`mt-3 flex flex-wrap gap-1.5`,children:e.flags.map(e=>(0,i.jsx)(`span`,{className:`border border-line bg-inset px-2 py-1 font-mono text-[11px] text-muted`,children:e},e))}):null]},e.cmd))}),(0,i.jsxs)(n,{className:`mt-8`,children:[(0,i.jsx)(`h2`,{className:`font-mono text-[11px] tracking-[0.2em] text-signal`,children:`INSTALL`}),(0,i.jsx)(`pre`,{className:`mt-4 overflow-x-auto font-mono text-xs leading-relaxed text-paper`,children:`npm install -g gitnexus
gitnexus analyze --embeddings --skills
gitnexus setup

# no C++ toolchain
GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1 npm install -g gitnexus

# pnpm (npm 11 crashes on optional native builds)
pnpm --allow-build=@ladybugdb/core --allow-build=gitnexus --allow-build=tree-sitter \\
  dlx gitnexus@latest analyze`})]})]})}export{a as component};