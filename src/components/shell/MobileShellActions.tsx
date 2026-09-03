import "./MobileShell.css";
import { useState } from "react";
import { Activity, BarChart3, ChevronDown, History, MoreHorizontal, RefreshCw, Settings } from "lucide-react";
import { Link } from "react-router";
import BottomSheet from "../ui/BottomSheet";
import { SystemStatusDetails, type SystemStatusView } from "./SystemStatusButton";
import { isDemoMode } from "../../demo/config";

export default function MobileShellActions({ refreshing, onQuickRefresh, systemStatus, onOpenHistory, onOpenAnalytics }: {
  refreshing?: boolean;
  onQuickRefresh?: () => unknown;
  systemStatus?: SystemStatusView | null;
  onOpenHistory: () => void;
  onOpenAnalytics: () => void;
}) {
  const [open, setOpen] = useState(false);
  const status = systemStatus || { state: "current", sources: [] };
  return (
    <>
      <button type="button" className="mobile-shell-actions-trigger" aria-label="Open app actions" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <MoreHorizontal size={20} />
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="App actions">
        <div className="mobile-app-actions">
          {isDemoMode() && <p className="mobile-app-demo">Demo data · Mocked services</p>}
          <button type="button" className="mobile-app-action" aria-label={refreshing ? "Syncing" : "Sync now"} disabled={refreshing} onClick={() => { void onQuickRefresh?.(); }}>
            <RefreshCw size={17} className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined} />
            <span role="status">{refreshing ? "Syncing…" : "Sync now"}</span>
          </button>
          <details className="mobile-app-status">
            <summary className="mobile-app-action">
              <Activity size={17} />
              <span>System status</span>
              <small>{status.state?.replace(/_/g, " ")}</small>
              <ChevronDown size={14} />
            </summary>
            <SystemStatusDetails status={status} />
          </details>
          <div className="mobile-app-destinations">
            <button type="button" className="mobile-app-action" onClick={() => { setOpen(false); onOpenHistory(); }}><History size={17} />Snapshots</button>
            <button type="button" className="mobile-app-action" onClick={() => { setOpen(false); onOpenAnalytics(); }}><BarChart3 size={17} />Analytics</button>
            <Link className="mobile-app-action" to="/settings" onClick={() => setOpen(false)}><Settings size={17} />Settings</Link>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
