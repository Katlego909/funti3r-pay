import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State { failed: boolean }

/**
 * Catches a crash while rendering (a bug, or a page chunk that no longer exists after a deploy) and shows a way out
 * instead of a blank screen. A reload fetches the current build and starts the page fresh.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={{ maxWidth: 420, margin: '20vh auto', padding: '0 1rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
        <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
          This page hit an unexpected error. Reloading usually fixes it.
        </p>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
