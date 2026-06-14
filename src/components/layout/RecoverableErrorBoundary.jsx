import { Component } from "react";
import { isDynamicImportLoadError } from "./chunkLoadRecovery.js";

const BUTTON_BASE = "inline-flex min-h-9 items-center justify-center rounded-md px-4 py-2 text-[13px] font-semibold transition-[background-color,border-color,transform] duration-150 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

function RecoverableErrorFallback({ onRetry, onReload }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="min-h-screen bg-background text-foreground font-sans flex items-center justify-center px-6"
    >
      <div className="w-full max-w-[420px] rounded-lg border border-border bg-card/80 px-6 py-7 text-center">
        <p className="mb-2 text-[11px] font-semibold text-danger">Something went wrong</p>
        <h1 className="mb-3 text-[20px] font-semibold text-foreground">This view hit an error</h1>
        <p className="mb-5 text-[13px] leading-relaxed text-muted-foreground">
          Setpoint caught an unexpected error while rendering. Try again, or reload the app if it keeps happening.
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            className={`${BUTTON_BASE} border border-primary/35 bg-primary text-primary-foreground hover:bg-primary/90`}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={onReload}
            className={`${BUTTON_BASE} border border-border bg-card/60 text-foreground hover:bg-card`}
          >
            Reload app
          </button>
        </div>
      </div>
    </div>
  );
}

// Generic recoverable boundary for a render-time crash in a major subtree. Unlike
// ChunkLoadBoundary (which only handles build-changed dynamic-import errors), this
// renders a retryable fallback instead of letting the error unmount the React tree
// to a blank screen. Dynamic-import load errors are re-thrown so the outer
// ChunkLoadBoundary can still drive its reload recovery.
export default class RecoverableErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (isDynamicImportLoadError(error)) return;
    console.error("[Setpoint] Recoverable render error:", error, info?.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  handleReload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (error) {
      if (isDynamicImportLoadError(error)) {
        throw error; // let the outer ChunkLoadBoundary handle build-changed reloads
      }
      return <RecoverableErrorFallback onRetry={this.handleRetry} onReload={this.handleReload} />;
    }
    return this.props.children;
  }
}
