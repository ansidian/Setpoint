import "./MobileShell.css";
import { useState } from "react";
import { Activity, AlertTriangle, BarChart3, ChevronDown, History, MoreHorizontal, RefreshCw, Settings } from "lucide-react";
import { Link } from "react-router";
import BottomSheet from "../ui/BottomSheet";
import { SystemStatusDetails, type SystemStatusView } from "./SystemStatusButton";
import { isDemoMode } from "../../demo/config";
import { isAttentionState, STATE_COPY, statusSummary, systemState, UNKNOWN_STATUS } from "./systemStatusPresentation";
import type { SystemStatusRetryProps } from "./systemStatusPresentation";
import AnimatedHeight from "../shared/AnimatedHeight";

export default function MobileShellActions({ refreshing, onQuickRefresh, systemStatus, onOpenHistory, onOpenAnalytics, onRetrySource, sourceRetry }: {
  refreshing?: boolean;
  onQuickRefresh?: () => unknown;
  systemStatus?: SystemStatusView | null;
  onOpenHistory: () => void;
  onOpenAnalytics: () => void;
} & SystemStatusRetryProps) {
  const [open, setOpen] = useState(false);
  const status = systemStatus || UNKNOWN_STATUS;
  const state = systemState(status);
  const attention = isAttentionState(state);
  return (
    <>
      <button type="button" className="mobile-shell-actions-trigger" data-attention={attention || undefined} aria-label={attention ? `Open app actions: ${statusSummary(status)}` : "Open app actions"} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        {attention ? <AlertTriangle size={20} /> : <MoreHorizontal size={20} />}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="App actions">
        <AnimatedHeight>
        <div className="mobile-app-actions">
          {isDemoMode() && <p className="mobile-app-demo">Demo data · Mocked services</p>}
          <button type="button" className="mobile-app-action" aria-label={refreshing ? "Syncing" : "Sync now"} disabled={refreshing || sourceRetry?.state === "pending"} onClick={() => { void onQuickRefresh?.(); }}>
            <RefreshCw size={17} className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined} />
            <span role="status">{refreshing ? "Syncing…" : "Sync now"}</span>
          </button>
          <details className="mobile-app-status">
            <summary className="mobile-app-action">
              {attention ? <AlertTriangle size={17} /> : <Activity size={17} />}
              <span>System status</span>
              <small>{STATE_COPY[state]}</small>
              <ChevronDown size={14} />
            </summary>
            <SystemStatusDetails status={status} onNavigate={() => setOpen(false)} refreshing={refreshing} onRetrySource={onRetrySource} sourceRetry={sourceRetry} />
          </details>
          <div className="mobile-app-destinations">
            <button type="button" className="mobile-app-action" onClick={() => { setOpen(false); onOpenHistory(); }}><History size={17} />Snapshots</button>
            <button type="button" className="mobile-app-action" onClick={() => { setOpen(false); onOpenAnalytics(); }}><BarChart3 size={17} />Analytics</button>
            <Link className="mobile-app-action" to="/settings" onClick={() => setOpen(false)}><Settings size={17} />Settings</Link>
          </div>
        </div>
        </AnimatedHeight>
      </BottomSheet>
    </>
  );
}
