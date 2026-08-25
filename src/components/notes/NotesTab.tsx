import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Download, RefreshCw, Settings, Shapes } from "lucide-react";
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
import { getTldrawBootstrap } from "../../api";
import type { TldrawBootstrapResponse } from "../../../shared/types/tldraw";
import { ChecklistShapeUtil } from "./ChecklistShapeUtil";
import {
  ChecklistShapeTool,
  checklistUiComponents,
  checklistUiOverrides,
} from "./checklistTldrawConfig";
import { createSetpointTldrawAssetStore } from "./tldrawAssetStore";
import { getStoredTldrawSession, useTldrawAutosave } from "./useTldrawAutosave";

const assetUrls = getAssetUrlsByImport();
const shapeUtils = [...defaultShapeUtils, ChecklistShapeUtil];
const tools = [ChecklistShapeTool];
let bootstrapPromise: Promise<TldrawBootstrapResponse> | null = null;

function loadBootstrap(): Promise<TldrawBootstrapResponse> {
  bootstrapPromise ??= getTldrawBootstrap().catch((error) => {
    bootstrapPromise = null;
    throw error;
  });
  return bootstrapPromise;
}

type BootstrapState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; value: TldrawBootstrapResponse };

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

function NotesCanvas({ bootstrap }: { bootstrap: TldrawBootstrapResponse }) {
  const store = useMemo<TLStore>(() => {
    const next = createTLStore({
      assets: createSetpointTldrawAssetStore(),
      shapeUtils,
      bindingUtils: defaultBindingUtils,
      assetUtils: defaultAssetUtils,
    });
    if (bootstrap.document.document) {
      const session = getStoredTldrawSession();
      loadSnapshot(next, {
        document: bootstrap.document.document as never,
        ...(session ? { session: session as never } : {}),
      });
    }
    return next;
  }, [bootstrap]);
  const autosave = useTldrawAutosave({
    store,
    initialRevision: bootstrap.document.revision,
    initialDocument: bootstrap.document.document,
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
    loadBootstrap()
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
  if (bootstrap.value.licenseRequired && !bootstrap.value.licenseKey) {
    return (
      <CanvasState
        icon={<Shapes size={22} />}
        title="Add your tldraw license"
        message="Notes is ready for a fresh canvas. Save and validate the hobby license for this deployment first."
        action={<a className="notes-canvas-button" href="/settings?tab=connections#tldraw"><Settings size={14} /> Open Settings</a>}
      />
    );
  }
  return <NotesCanvas bootstrap={bootstrap.value} />;
}
