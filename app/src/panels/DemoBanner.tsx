// Demo-mode chrome (spec FR-5, FR-6, FR-7, AC-5).
//
// Three pieces, all small:
//   • DemoBanner — the persistent "this is demo data" strip, with the tour and the exit.
//   • DemoTour   — a keyboard-navigable step card that drives the tab bar.
//   • DemoInvite — the "explore the demo" affordance dropped into each empty state.
//
// The banner is a landmark region and states plainly that nothing is written to GitHub;
// per spec section 11 the demo's one real risk is a visitor believing otherwise.

import { useCallback, useEffect, useState } from 'react';
import { demoClient, enterDemoMode, exitDemoMode } from '../demo/seed';
import { TOUR } from '../demo/tour';
import { useUiStore } from '../state/ui';

export function DemoBanner() {
  const setView = useUiStore((s) => s.setView);
  const [step, setStep] = useState<number | null>(null);
  const [writes, setWrites] = useState(0);

  // The banner's write counter is the honest answer to "did that reach GitHub?" — it
  // counts what the session overlay holds, which is the whole of where those writes went.
  useEffect(() => {
    const tick = () => setWrites(demoClient()?.activity().length ?? 0);
    tick();
    const id = window.setInterval(tick, 1500);
    return () => window.clearInterval(id);
  }, []);

  const go = useCallback(
    (next: number | null) => {
      setStep(next);
      if (next !== null && TOUR[next]) setView(TOUR[next].view);
    },
    [setView],
  );

  return (
    <>
      <div className="banner banner--demo" role="region" aria-label="Demo mode">
        <span aria-hidden>🎛</span>
        <strong>Demo fleet</strong>
        <span>
          Fictional repos, real engines. Nothing here is written to GitHub — edits live in
          this tab only
          {writes > 0 ? ` (${writes} so far)` : ''}.
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => go(step === null ? 0 : null)}
          aria-pressed={step !== null}
        >
          {step === null ? 'Take the tour' : 'Hide the tour'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            exitDemoMode();
            setStep(null);
          }}
          title="Return the app to its disconnected state"
        >
          Leave demo
        </button>
      </div>
      {step !== null && <DemoTour step={step} onGo={go} />}
    </>
  );
}

function DemoTour({ step, onGo }: { step: number; onGo: (n: number | null) => void }) {
  const s = TOUR[step];

  // Arrow keys and Escape work anywhere outside a text field — the tour is a reading
  // experience, so it should not require aiming at a button (FR-7: keyboard-navigable).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === 'Escape') onGo(null);
      else if (e.key === 'ArrowRight') onGo(step + 1 < TOUR.length ? step + 1 : null);
      else if (e.key === 'ArrowLeft' && step > 0) onGo(step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onGo]);

  if (!s) return null;
  return (
    <aside className="tour" role="dialog" aria-label={`Tour step ${step + 1} of ${TOUR.length}`}>
      <div className="tour__head">
        <span className="tour__count">
          {step + 1} / {TOUR.length}
        </span>
        <span className="tour__title">{s.title}</span>
        <button type="button" className="modal__x" onClick={() => onGo(null)} aria-label="End tour">
          ×
        </button>
      </div>
      <p className="tour__body">{s.body}</p>
      {s.action && <p className="tour__action">→ {s.action}</p>}
      <div className="tour__foot">
        <button type="button" className="btn" disabled={step === 0} onClick={() => onGo(step - 1)}>
          ← Back
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => onGo(step + 1 < TOUR.length ? step + 1 : null)}
        >
          {step + 1 < TOUR.length ? 'Next →' : 'Finish'}
        </button>
      </div>
    </aside>
  );
}

/**
 * The on-ramp from an empty state (FR-5). Every panel that says "connect a repo" also
 * offers this, because a visitor with no PAT is exactly who the demo is for.
 */
export function DemoInvite() {
  return (
    <p className="tabpane__empty">
      <button type="button" className="btn btn--primary" onClick={() => void enterDemoMode()}>
        Explore the demo
      </button>{' '}
      — a fictional three-repo fleet, no token needed.
    </p>
  );
}
