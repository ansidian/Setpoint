import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Download, RefreshCw, Settings, Shapes, ShieldAlert } from "lucide-react";
import {
  Tldraw,
  createTLStore,
  defaultAssetUtils,
  defaultBindingUtils,
  defaultShapeUtils,
  loadSnapshot,
  type TLStore,
} from "tldraw";
import { getAssetUrlsByImport } from "@tldraw/assets/imports.vite";
import "tldraw/tldraw.css";
import type { TldrawBootstrapResponse } from "../../../shared/types/tldraw";
import { ChecklistShapeUtil } from "./ChecklistShapeUtil";
import {
  ChecklistShapeTool,
  checklistUiComponents,
  checklistUiOverrides,
} from "./checklistTldrawConfig";
import { createSetpointTldrawAssetStore } from "./tldrawAssetStore";
import { getStoredTldrawSession, useTldrawAutosave } from "./useTldrawAutosave";
import {
  type TldrawRecoveryDraft,
} from "./tldrawRecoveryModel";
import { tldrawRecoveryStore } from "./tldrawRecoveryStore";
import { loadTldrawWorkspace, type LoadedTldrawWorkspace } from "./loadTldrawWorkspace";

const assetUrls = getAssetUrlsByImport();
const shapeUtils = [...defaultShapeUtils, ChecklistShapeUtil];
const tools = [ChecklistShapeTool];

type BootstrapState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; value: LoadedTldrawWorkspace };

function CanvasState({ icon, title, message, action }: {
  icon: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="notes-canvas-state">
      <div className="notes-canvas-state-icon" aria-hidden="true">{icon}</div>
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </div>
  );
}

function downloadDocument(document: TldrawRecoveryDraft["document"]): void {
  const blob = new Blob([JSON.stringify({ document }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `setpoint-notes-recovery-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function RecoveryChoice({
  draft,
  onKeepServer,
  onRestoreLocal,
}: {
  draft: TldrawRecoveryDraft;
  onKeepServer: () => void;
  onRestoreLocal: () => void;
}) {
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keepServer = async () => {
    setDiscarding(true);
    setError(null);
    try {
      const cleared = await tldrawRecoveryStore.clearIfCurrent(draft.id);
      if (!cleared) {
        setError("The local draft changed in another tab. Reload Notes before choosing a version.");
        setDiscarding(false);
        return;
      }
      onKeepServer();
    } catch {
      setError("The local draft could not be cleared. Try again before opening the server version.");
      setDiscarding(false);
    }
  };

  return (
    <CanvasState
      icon={<ShieldAlert size={22} />}
      title="Choose which canvas to keep"
      message="A recovery draft from this device and a newer server canvas were both found. Setpoint will not combine or overwrite them automatically."
      action={(
        <div className="notes-recovery-choice">
          <div className="notes-recovery-actions">
            <button type="button" className="notes-canvas-button" disabled={discarding} onClick={() => void keepServer()}>
              {discarding ? "Opening server…" : "Keep server version"}
            </button>
            <button type="button" className="notes-canvas-button notes-canvas-button--warning" disabled={discarding} onClick={onRestoreLocal}>
              Replace server with local draft
            </button>
            <button type="button" className="notes-canvas-button notes-canvas-button--quiet" disabled={discarding} onClick={() => downloadDocument(draft.document)}>
              <Download size={14} /> Download local draft
            </button>
          </div>
          {error ? <p className="notes-recovery-choice-error" role="alert">{error}</p> : null}
        </div>
      )}
    />
  );
}

function NotesCanvas({
  bootstrap,
  recoveryDraft,
}: {
  bootstrap: TldrawBootstrapResponse;
  recoveryDraft: TldrawRecoveryDraft | null;
}) {
  const canvasDocument = recoveryDraft?.document ?? bootstrap.document.document;
  const store = useMemo<TLStore>(() => {
    const next = createTLStore({
      assets: createSetpointTldrawAssetStore(),
      shapeUtils,
      bindingUtils: defaultBindingUtils,
      assetUtils: defaultAssetUtils,
    });
    if (canvasDocument) {
      const session = getStoredTldrawSession();
      loadSnapshot(next, {
        document: canvasDocument as never,
        ...(session ? { session: session as never } : {}),
      });
    }
    return next;
  }, [canvasDocument]);
  const autosave = useTldrawAutosave({
    store,
    initialRevision: bootstrap.document.revision,
    initialDocument: bootstrap.document.document,
    initialRecoveryDraft: recoveryDraft,
  });

  return (
    <div className="notes-canvas-root" data-testid="tldraw-notes-canvas">
      <Tldraw
        store={store}
        licenseKey={bootstrap.licenseKey ?? undefined}
        assetUrls={assetUrls}
        colorScheme="dark"
        shapeUtils={shapeUtils}
        tools={tools}
        overrides={checklistUiOverrides}
        components={checklistUiComponents}
        onMount={autosave.onMount}
      />
      {autosave.state !== "idle" ? (
        <div className={`notes-save-indicator notes-save-indicator--${autosave.state}`} role="status" aria-live="polite">
          {autosave.state === "saving" ? "Saving…" : autosave.state === "error" ? "Save failed" : autosave.state === "conflict" ? "Conflict" : "Saved"}
        </div>
      ) : null}
      {autosave.state === "conflict" ? (
        <div className="notes-conflict-panel" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div>
            <strong>Newer canvas found</strong>
            <p>{autosave.message}</p>
          </div>
          <button type="button" className="notes-canvas-button" onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> Reload latest
          </button>
          <button type="button" className="notes-canvas-button notes-canvas-button--quiet" onClick={autosave.downloadRecovery}>
            <Download size={14} /> Download local copy
          </button>
        </div>
      ) : autosave.recoveryState === "error" ? (
        <div className="notes-protection-error" role="alert">
          <ShieldAlert size={15} aria-hidden="true" />
          <span>{autosave.recoveryMessage}</span>
          <button type="button" className="notes-canvas-button notes-canvas-button--quiet" onClick={autosave.retryRecovery}>
            Retry protection
          </button>
        </div>
      ) : autosave.state === "error" ? (
        <div className="notes-save-error" role="alert">{autosave.message}</div>
      ) : null}
    </div>
  );
}

export default function NotesTab() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    loadTldrawWorkspace()
      .then((value) => { if (active) setBootstrap({ kind: "ready", value }); })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Notes could not be loaded.";
        setBootstrap({ kind: "error", message });
      });
    return () => { active = false; };
  }, []);

  if (bootstrap.kind === "loading") {
    return <div className="notes-canvas-loading" aria-label="Loading notes canvas" />;
  }
  if (bootstrap.kind === "error") {
    return (
      <CanvasState
        icon={<AlertTriangle size={22} />}
        title="Notes couldn’t open"
        message={bootstrap.message}
        action={<button type="button" className="notes-canvas-button" onClick={() => window.location.reload()}><RefreshCw size={14} /> Try again</button>}
      />
    );
  }
  if (bootstrap.value.response.licenseRequired && !bootstrap.value.response.licenseKey) {
    return (
      <CanvasState
        icon={<Shapes size={22} />}
        title="Add your tldraw license"
        message="Notes is ready for a fresh canvas. Save and validate the hobby license for this deployment first."
        action={<a className="notes-canvas-button" href="/settings?tab=connections#tldraw"><Settings size={14} /> Open Settings</a>}
      />
    );
  }
  if (bootstrap.value.recovery.kind === "conflict") {
    return (
      <RecoveryChoice
        draft={bootstrap.value.recovery.draft}
        onKeepServer={() => setBootstrap((current) => current.kind === "ready"
          ? { ...current, value: { ...current.value, recovery: { kind: "server", staleDraftId: null } } }
          : current)}
        onRestoreLocal={() => setBootstrap((current) => current.kind === "ready" && current.value.recovery.kind === "conflict"
          ? { ...current, value: { ...current.value, recovery: { kind: "recover", draft: current.value.recovery.draft } } }
          : current)}
      />
    );
  }
  return (
    <NotesCanvas
      bootstrap={bootstrap.value.response}
      recoveryDraft={bootstrap.value.recovery.kind === "recover" ? bootstrap.value.recovery.draft : null}
    />
  );
}
