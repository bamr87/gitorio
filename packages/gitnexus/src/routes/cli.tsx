import { createFileRoute } from "@tanstack/react-router";
import { PageHead, Panel } from "@/components/shell";
import { CLI } from "@/data/surfaces";

export const Route = createFileRoute("/cli")({ component: CliPage });

function CliPage() {
  return (
    <div>
      <PageHead
        kicker="08 / CLI"
        title="The binary is gitnexus."
        lede="Published as npm package gitnexus. Global install is recommended so MCP startup stays fast. Bin: dist/cli/index.js. commander + i18n help."
      />
      <div className="grid gap-3">
        {CLI.map((c) => (
          <Panel key={c.cmd}>
            <h2 className="font-mono text-sm text-signal md:text-base">{c.cmd}</h2>
            <p className="mt-2 text-sm text-paper">{c.purpose}</p>
            {c.flags ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.flags.map((f) => (
                  <span key={f} className="border border-line bg-inset px-2 py-1 font-mono text-[11px] text-muted">
                    {f}
                  </span>
                ))}
              </div>
            ) : null}
          </Panel>
        ))}
      </div>
      <Panel className="mt-8">
        <h2 className="font-mono text-[11px] tracking-[0.2em] text-signal">INSTALL</h2>
        <pre className="mt-4 overflow-x-auto font-mono text-xs leading-relaxed text-paper">{`npm install -g gitnexus
gitnexus analyze --embeddings --skills
gitnexus setup

# no C++ toolchain
GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1 npm install -g gitnexus

# pnpm (npm 11 crashes on optional native builds)
pnpm --allow-build=@ladybugdb/core --allow-build=gitnexus --allow-build=tree-sitter \\
  dlx gitnexus@latest analyze`}</pre>
      </Panel>
    </div>
  );
}
