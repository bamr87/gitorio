import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { searchSpec } from "@/data/search";
import { cn } from "@/lib/cn";

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const hits = useMemo(() => searchSpec(q), [q]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-void/80 px-3 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl border border-line bg-plate shadow-[0_0_0_1px_#d6ff4a22]"
        onClick={(e) => e.stopPropagation()}
      >
        <label className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="font-mono text-[10px] tracking-[0.2em] text-signal">SEARCH</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tools, phases, nodes, languages…"
            className="w-full bg-transparent font-mono text-sm text-paper outline-none placeholder:text-muted"
          />
        </label>
        <ul className="max-h-[50vh] overflow-y-auto py-2">
          {q.trim().length < 2 ? (
            <li className="px-4 py-6 font-mono text-xs text-muted">Type two characters.</li>
          ) : hits.length === 0 ? (
            <li className="px-4 py-6 font-mono text-xs text-muted">No matches in the spec.</li>
          ) : (
            hits.map((h) => (
              <li key={h.id}>
                <button
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left hover:bg-signal/10",
                  )}
                  onClick={() => {
                    const [path, hash] = h.href.split("#");
                    void nav({ to: path as "/" });
                    if (hash) {
                      requestAnimationFrame(() => {
                        document.getElementById(hash)?.scrollIntoView({ block: "start" });
                      });
                    }
                    onClose();
                  }}
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-signal">
                    {h.section}
                  </span>
                  <span className="text-sm text-paper">{h.title}</span>
                  <span className="line-clamp-1 text-xs text-muted">{h.blurb}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
