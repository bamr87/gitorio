import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, Search, X } from "lucide-react";
import { APP, NAV } from "@/data/nav";
import { cn } from "@/lib/cn";
import { CommandPalette } from "./command-palette";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-signal focus:px-3 focus:py-2 focus:text-void"
      >
        Skip to spec
      </a>
      <header className="sticky top-0 z-40 flex h-12 items-center justify-between border-b border-line bg-void/95 px-3 backdrop-blur md:px-5">
        <div className="flex items-center gap-3">
          <button
            className="inline-flex size-10 items-center justify-center text-paper md:hidden"
            aria-label={open ? "Close navigation" : "Open navigation"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <Link to="/" className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] tracking-[0.28em] text-signal">NXS</span>
            <span className="text-sm font-semibold tracking-tight text-paper">{APP.name}</span>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-[10px] text-muted sm:inline">
            {APP.product} {APP.version}
          </span>
          <button
            onClick={() => setPalette(true)}
            className="inline-flex h-9 items-center gap-2 border border-line bg-plate px-3 font-mono text-[11px] text-muted hover:border-signal hover:text-signal"
          >
            <Search className="size-3.5" />
            <span className="hidden sm:inline">Search spec</span>
            <kbd className="hidden border border-line px-1 text-[10px] md:inline">⌘K</kbd>
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px]">
        <aside
          className={cn(
            "fixed inset-y-12 left-0 z-30 w-64 overflow-y-auto border-r border-line bg-void md:sticky md:top-12 md:block md:h-[calc(100vh-3rem)]",
            open ? "block" : "hidden",
          )}
        >
          <nav className="flex flex-col py-4" aria-label="Specification">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.id}
                  to={item.href}
                  className={cn(
                    "flex items-baseline gap-3 px-5 py-2 font-mono text-[12px] tracking-wide",
                    active
                      ? "bg-signal/10 text-signal"
                      : "text-muted hover:bg-plate hover:text-paper",
                  )}
                >
                  <span className="w-6 text-[10px] text-signal/70">{item.kicker}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <p className="px-5 pb-8 pt-4 font-mono text-[10px] leading-relaxed text-muted">
            Reverse-engineered from the public GitNexus repo.
            <br />
            Snapshot {APP.snapshot}
          </p>
        </aside>
        {open ? (
          <button
            className="fixed inset-0 z-20 bg-void/50 md:hidden"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          />
        ) : null}
        <main id="content" className="min-w-0 flex-1 px-4 py-8 md:px-10 md:py-10">
          {children}
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

export function PageHead({
  kicker,
  title,
  lede,
}: {
  kicker: string;
  title: string;
  lede: string;
}) {
  return (
    <header className="mb-10 max-w-3xl border-b border-line pb-8">
      <p className="font-mono text-[11px] tracking-[0.28em] text-signal">{kicker}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-paper md:text-4xl">{title}</h1>
      <p className="mt-4 text-base leading-relaxed text-muted">{lede}</p>
    </header>
  );
}

export function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border border-line bg-plate/80 p-5 md:p-6", className)}>{children}</section>
  );
}
