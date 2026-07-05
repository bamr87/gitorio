// A small accessible dropdown menu — a trigger button + a popover of actions. Used to collapse
// related toolbar actions (e.g. the blueprint import/export group) into one control so the
// chrome stays uncrowded. Closes on outside-click, Escape, or item select.

import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onClick: () => void;
  icon?: string;
  disabled?: boolean;
}

export function Menu({
  label,
  items,
  className = 'btn',
  title,
}: {
  label: string;
  items: MenuItem[];
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {label} <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="menu__pop" role="menu">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className="menu__item"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.icon && <span aria-hidden>{it.icon}</span>} {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
