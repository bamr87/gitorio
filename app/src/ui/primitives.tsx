// The Evidence Console's chrome grammar as React primitives (specs/013-archify-console, FR-8;
// BL-20260828-13). Each maps to a component of archify's DESIGN.md / viewer template:
//   PageHeader  ← .header-row (pulse dot + headline + subtitle)
//   Panel       ← diagram-panel (tonal ground, one-pixel border, --r-panel)
//   Cards/Card  ← .cards / .card (card-dot tone + title + body)
//   Chip        ← quiet bordered capsule; active uses the owning semantic colour + weight
//   Kbd         ← the viewer's shortcut hints
//   Eyebrow     ← the label type role (0.625rem, 700, 0.12em, uppercase)
//   SearchField ← search-field recipe
//   Beacon      ← evidence-beacon (a text capsule, never colour alone)
// Presentation only: no store access, no colour literals (theme tokens via ui.css).

import type { KeyboardEvent, ReactNode } from 'react';
import './ui.css';

export type Tone =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'cloud'
  | 'security'
  | 'messagebus'
  | 'external'
  | 'ok'
  | 'warn'
  | 'bad'
  | 'idle'
  | 'accent';

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  live = false,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  /** Pulse the dot — a surface that is polling or otherwise live. */
  live?: boolean;
  /** Right-hand controls. */
  children?: ReactNode;
}) {
  return (
    <header className="pagehead">
      <div className="pagehead__row">
        <span className={`pulse${live ? ' is-live' : ''}`} aria-hidden />
        <div className="pagehead__copy">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h2 className="pagehead__title">{title}</h2>
        </div>
        {children && <div className="pagehead__ctl">{children}</div>}
      </div>
      {subtitle && <p className="pagehead__sub">{subtitle}</p>}
    </header>
  );
}

export function Panel({
  title,
  eyebrow,
  actions,
  tone,
  flush = false,
  className = '',
  children,
  ariaLabel,
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  tone?: Tone;
  /** No inner padding — for panels whose body is a canvas, a table, or a map. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  const hasHead = !!(title || eyebrow || actions);
  return (
    <section
      className={`panel${tone ? ` panel--${tone}` : ''}${flush ? ' panel--flush' : ''}${className ? ` ${className}` : ''}`}
      aria-label={ariaLabel}
    >
      {hasHead && (
        <div className="panel__head">
          <div className="panel__copy">
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            {title && <h3 className="panel__title">{title}</h3>}
          </div>
          {actions && <div className="panel__actions">{actions}</div>}
        </div>
      )}
      <div className="panel__body">{children}</div>
    </section>
  );
}

export function Cards({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`cards${className ? ` ${className}` : ''}`}>{children}</div>;
}

export function Card({
  title,
  tone = 'accent',
  children,
  className = '',
}: {
  title: ReactNode;
  tone?: Tone;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card${className ? ` ${className}` : ''}`}>
      <div className="card__head">
        <span className={`tone-dot tone-dot--${tone}`} aria-hidden />
        <h3 className="card__title">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export function Chip({
  children,
  tone,
  active = false,
  onClick,
  title,
  disabled,
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  active?: boolean;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  className?: string;
}) {
  const cls = `chip${tone ? ` chip--${tone}` : ''}${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`;
  if (!onClick) {
    return (
      <span className={cls} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`eyebrow${className ? ` ${className}` : ''}`}>{children}</span>;
}

export function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  onKeyDown,
  className = '',
  autoFocus = false,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
  autoFocus?: boolean;
  /** A keyboard hint rendered at the right edge, e.g. "/". */
  hint?: string;
}) {
  return (
    <label className={`search${className ? ` ${className}` : ''}`}>
      <span className="search__icon" aria-hidden>
        ⌕
      </span>
      <input
        type="search"
        className="search__input"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {hint && <Kbd>{hint}</Kbd>}
    </label>
  );
}

export function Beacon({
  label,
  tone,
  title,
}: {
  label: ReactNode;
  tone: 'ok' | 'warn' | 'bad' | 'idle';
  title?: string;
}) {
  return (
    <span className={`beacon beacon--${tone}`} title={title}>
      {label}
    </span>
  );
}
