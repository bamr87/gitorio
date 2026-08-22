// Last-resort catch for render crashes: instead of a blank page, show a factory-toned
// fault report with the error message and a reload hint. Class component — React error
// boundaries have no hook equivalent.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Telemetry for the operator's console — the factory floor already stopped.
    console.error('GitFactory line jam:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" style={{ maxWidth: 560, margin: '10vh auto', padding: '0 24px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>⚠ Line jam</h1>
          <p style={{ marginBottom: 12 }}>
            A machine threw an unhandled fault and the assembly line stopped.
          </p>
          <pre
            style={{ textAlign: 'left', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 12, border: '1px solid currentColor', borderRadius: 4, opacity: 0.85, marginBottom: 12 }}
          >
            {this.state.error.message || String(this.state.error)}
          </pre>
          <p style={{ marginBottom: 16 }}>
            Reload to restart the line — your last deployed blueprint is safe in the repo.
          </p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            ↻ Restart the line
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
