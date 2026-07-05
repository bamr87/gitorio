// The Docs view — renders the repo's `_docs/*.md` collection (bundled at build time) into the
// app, so GitHub Pages serves the same docs the Docs Gardener factory tends. When the gardener's
// PR merges, the next Pages deploy re-bundles and this view updates. A dependency-free Markdown
// renderer (../docs/markdown) turns each doc into React elements — no dangerouslySetInnerHTML.

import './docs.css';
import { useMemo, useState } from 'react';
import { loadDocs } from '../docs/load';
import { parseMarkdown, type Block, type Span } from '../docs/markdown';

function Inline({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        switch (s.t) {
          case 'code':
            return <code key={i} className="md-code">{s.v}</code>;
          case 'strong':
            return <strong key={i}>{s.v}</strong>;
          case 'em':
            return <em key={i}>{s.v}</em>;
          case 'link':
            return (
              <a key={i} href={s.href} target="_blank" rel="noreferrer">{s.v}</a>
            );
          default:
            return <span key={i}>{s.v}</span>;
        }
      })}
    </>
  );
}

function Markdown({ md }: { md: string }) {
  const blocks = useMemo(() => parseMarkdown(md), [md]);
  return (
    <div className="md">
      {blocks.map((b: Block, i) => {
        switch (b.t) {
          case 'heading': {
            const H = (`h${Math.min(b.level, 6)}`) as 'h1';
            return <H key={i}><Inline spans={b.spans} /></H>;
          }
          case 'para':
            return <p key={i}><Inline spans={b.spans} /></p>;
          case 'list':
            return b.ordered ? (
              <ol key={i}>{b.items.map((it, j) => <li key={j}><Inline spans={it} /></li>)}</ol>
            ) : (
              <ul key={i}>{b.items.map((it, j) => <li key={j}><Inline spans={it} /></li>)}</ul>
            );
          case 'code':
            return <pre key={i} className="md-pre"><code>{b.text}</code></pre>;
          case 'quote':
            return <blockquote key={i}><Inline spans={b.spans} /></blockquote>;
          case 'hr':
            return <hr key={i} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

export function DocsView() {
  const docs = useMemo(() => loadDocs(), []);
  const [slug, setSlug] = useState<string | null>(docs[0]?.slug ?? null);
  const active = docs.find((d) => d.slug === slug) ?? docs[0] ?? null;

  if (docs.length === 0) {
    return (
      <div className="tabpane docspane">
        <p className="tabpane__empty">
          No docs yet. Add Markdown files to <code>_docs/</code> at the repo root — they render here
          and deploy to GitHub Pages. The <b>Docs Gardener</b> template keeps them tended.
        </p>
      </div>
    );
  }

  return (
    <div className="tabpane docspane">
      <div className="docs">
        <nav className="docs__nav" aria-label="Docs">
          <div className="panel__eyebrow">Docs collection</div>
          <ul>
            {docs.map((d) => (
              <li key={d.slug}>
                <button
                  type="button"
                  className={`docs__navitem${d.slug === active?.slug ? ' is-active' : ''}`}
                  onClick={() => setSlug(d.slug)}
                >
                  {d.title}
                </button>
              </li>
            ))}
          </ul>
          <p className="docs__note">
            Rendered from <code>_docs/</code> and served on GitHub Pages — the Docs Gardener factory
            improves these daily.
          </p>
        </nav>
        <article className="docs__body">
          {active && (
            <>
              <header className="docs__head">
                <h1 className="docs__title">{active.title}</h1>
                {active.description && <p className="docs__desc">{active.description}</p>}
                <p className="docs__src">{active.path}</p>
              </header>
              <Markdown md={active.body} />
            </>
          )}
        </article>
      </div>
    </div>
  );
}
