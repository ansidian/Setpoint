import { Component, useEffect } from "react";
import type { ErrorInfo, ReactNode } from "react";
import {
  CHUNK_RELOAD_COOLDOWN_MS,
  isDynamicImportLoadError,
  readLastChunkReloadAt,
  writeLastChunkReloadAt,
} from "./chunkLoadRecovery";
import type { ChunkReloadStorage } from "./chunkLoadRecovery";

interface ChunkLoadFallbackProps {
  onAutoReload: () => unknown;
  onReload: () => void;
}

interface ChunkLoadBoundaryProps {
  children?: ReactNode;
  reloadPage?: () => void;
  storage?: ChunkReloadStorage;
  now?: () => number;
  windowObject?: Window;
}

interface ChunkLoadBoundaryState {
  error: unknown;
  reloadScheduled: boolean;
}

interface RequestReloadOptions {
  respectCooldown?: boolean;
}

function ChunkLoadFallback({ onAutoReload, onReload }: ChunkLoadFallbackProps) {
  useEffect(() => {
    onAutoReload();
  }, [onAutoReload]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="min-h-screen bg-background text-foreground font-sans flex items-center justify-center px-6"
    >
      <div className="w-full max-w-[420px] rounded-lg border border-border bg-card/80 px-6 py-7 text-center">
        <p className="mb-2 text-[11px] font-semibold text-warning">Build changed</p>
        <h1 className="mb-3 text-[20px] font-semibold text-foreground">Reload Setpoint</h1>
        <p className="mb-5 text-[13px] leading-relaxed text-muted-foreground">
          This tab is holding an old app bundle. Reload to fetch the current dashboard.
        </p>
        <button
          type="button"
          onClick={onReload}
          className="inline-flex min-h-9 items-center justify-center rounded-md border border-primary/35 bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-[background-color,border-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          Reload app
        </button>
      </div>
    </div>
  );
}

export default class ChunkLoadBoundary extends Component<ChunkLoadBoundaryProps, ChunkLoadBoundaryState> {
  private reloadRequested: boolean;

  constructor(props: ChunkLoadBoundaryProps) {
    super(props);
    this.reloadRequested = false;
    this.state = {
      error: null,
      reloadScheduled: false,
    };
  }

  static getDerivedStateFromError(error: unknown): Partial<ChunkLoadBoundaryState> {
    return { error };
  }

  override componentDidMount(): void {
    this.getWindow()?.addEventListener?.("vite:preloadError", this.handlePreloadError);
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    if (isDynamicImportLoadError(error)) {
      this.requestReload();
    }
  }

  override componentDidUpdate(_prevProps: ChunkLoadBoundaryProps, prevState: ChunkLoadBoundaryState): void {
    if (!prevState.error && isDynamicImportLoadError(this.state.error)) {
      this.requestReload();
    }
  }

  override componentWillUnmount(): void {
    this.getWindow()?.removeEventListener?.("vite:preloadError", this.handlePreloadError);
  }

  getWindow(): Window | undefined {
    if (this.props.windowObject) return this.props.windowObject;
    if (typeof window === "undefined") return undefined;
    return window;
  }

  getStorage(): ChunkReloadStorage | undefined {
    if (this.props.storage) return this.props.storage;
    return this.getWindow()?.sessionStorage;
  }

  getNow(): number {
    return this.props.now?.() ?? Date.now();
  }

  getReloadPage(): () => void {
    return this.props.reloadPage ?? (() => this.getWindow()?.location.reload());
  }

  handlePreloadError = (event: Event): void => {
    const error = "payload" in event ? event.payload : event;
    if (!isDynamicImportLoadError(error)) return;

    event.preventDefault?.();
    this.setState({ error });
    this.requestReload();
  };

  requestReload = ({ respectCooldown = true }: RequestReloadOptions = {}): boolean => {
    if (this.reloadRequested) return false;

    const storage = this.getStorage();
    const now = this.getNow();
    const lastReloadAt = readLastChunkReloadAt(storage);
    const reloadedRecently = lastReloadAt !== null && now - lastReloadAt < CHUNK_RELOAD_COOLDOWN_MS;

    if (respectCooldown && reloadedRecently) {
      return false;
    }

    writeLastChunkReloadAt(storage, now);
    this.reloadRequested = true;
    this.setState({ reloadScheduled: true });
    this.getReloadPage()();
    return true;
  };

  handleManualReload = (): void => {
    this.requestReload({ respectCooldown: false });
  };

  override render(): ReactNode {
    const { error } = this.state;

    if (error) {
      if (!isDynamicImportLoadError(error)) {
        throw error;
      }

      return <ChunkLoadFallback onAutoReload={this.requestReload} onReload={this.handleManualReload} />;
    }

    return this.props.children;
  }
}
