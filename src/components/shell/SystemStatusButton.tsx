import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { Activity, AlertTriangle, ArrowUpRight, CheckCircle2, CircleDashed, LoaderCircle, RefreshCw } from "lucide-react";
import type { LucideProps } from "lucide-react";
import AnimatedHeight from "../shared/AnimatedHeight";
import {
  isAttentionState, isBusyState, normalizeState, relativeTimestamp,
  STATE_COLOR, STATE_COPY, sourceRefreshActive, statusSummary, systemState, UNKNOWN_STATUS,
} from "./systemStatusPresentation";
import type { StatusState, SystemStatusView, SystemStatusRetryProps, SystemStatusSourceView } from "./systemStatusPresentation";
import "./SystemStatus.css";

export type { SystemStatusView, SystemStatusSourceView } from "./systemStatusPresentation";

function StatusIcon({ state, ...props }: LucideProps & { state: StatusState }) {
  if (state === "current") return <CheckCircle2 {...props} />;
  if (state === "checking" || state === "unconfigured") return <CircleDashed {...props} />;
  if (isBusyState(state)) return <LoaderCircle {...props} className="system-status-spinner" />;
  return <AlertTriangle {...props} />;
}

interface PanelPosition { top: number; left: number; maxHeight: number }

function usePanelPosition(open: boolean, triggerRef: RefObject<HTMLButtonElement | null>): PanelPosition {
  const [position, setPosition] = useState<PanelPosition>({ top: 52, left: 8, maxHeight: 420 });
  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(340, window.innerWidth - 16);
      const top = rect.bottom + 8;
      setPosition({ top, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), maxHeight: Math.max(100, window.innerHeight - top - 8) });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, triggerRef]);
  return position;
}

function StatusPanel({ status, onClose, panelRef, position, refreshing, onQuickRefresh, onRetrySource, sourceRetry }: {
  status: SystemStatusView;
  onClose: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
  position: PanelPosition;
  refreshing: boolean;
  onQuickRefresh?: () => unknown;
} & SystemStatusRetryProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return createPortal(
    <div ref={panelRef} role="dialog" aria-label="System status" className="system-status-panel"
      style={position}
      onWheel={(event) => {
        const target = event.currentTarget;
        const atTop = target.scrollTop <= 0;
        const atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 1;
        if ((atTop && event.deltaY < 0) || (atBottom && event.deltaY > 0)) event.preventDefault();
      }}
    >
      <div className="system-status-heading">
        <strong>System status</strong>
        <button ref={closeRef} type="button" className="system-status-close" aria-label="Close system status" onClick={onClose}>Close</button>
      </div>
      <AnimatedHeight><SystemStatusDetails status={status} onNavigate={onClose} onRetrySource={onRetrySource} sourceRetry={sourceRetry} refreshing={refreshing} /></AnimatedHeight>
      {onQuickRefresh && <button type="button" className="system-status-sync" disabled={refreshing || sourceRetry?.state === "pending"} aria-busy={refreshing} onClick={() => { void onQuickRefresh(); }}>
        <RefreshCw size={13} aria-hidden="true" className={refreshing ? "system-status-spinner" : undefined} />
        <span>{refreshing ? "Syncing…" : "Sync now"}</span><kbd aria-hidden="true">R</kbd>
      </button>}
    </div>, document.body,
  );
}

export function SystemStatusDetails({ status, onNavigate, onRetrySource, sourceRetry, refreshing = false }: { status: SystemStatusView; onNavigate?: () => void; refreshing?: boolean } & SystemStatusRetryProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const retryFocusRef = useRef<{ button: HTMLButtonElement; sourceKey?: string } | null>(null);
  useLayoutEffect(() => {
    const previous = retryFocusRef.current;
    if (!previous || previous.button.isConnected) return;
    if (document.activeElement === document.body) {
      const row = Array.from(listRef.current?.children || []).find((element) => (element as HTMLElement).dataset.sourceKey === previous.sourceKey) as HTMLElement | undefined;
      row?.focus();
    }
    retryFocusRef.current = null;
  });
  const sources: SystemStatusSourceView[] = status.sources?.length ? status.sources : [{ key: "system", label: "System", state: status.state, message: "Status details are unavailable. Try syncing again." }];
  const ordered = [...sources].sort((left, right) => Number(isAttentionState(normalizeState(right.state)) || (sourceRetry && right.retrySource === sourceRetry.source)) - Number(isAttentionState(normalizeState(left.state)) || (sourceRetry && left.retrySource === sourceRetry.source)));
  return <div className="system-status-details">
    <p className="system-status-summary" role="status">{statusSummary(status)}</p>
    <ul ref={listRef} className="system-status-sources">
      {ordered.map((source) => {
        const state = normalizeState(source.state);
        const attention = isAttentionState(state);
        const retry = source.retrySource === sourceRetry?.source && (sourceRetry?.state !== "success" || state === "current") ? sourceRetry : null;
        const updating = retry?.state === "pending" || sourceRefreshActive(source);
        const compact = (state === "current" || state === "unconfigured") && !retry && !updating;
        const showRetry = source.retrySource && onRetrySource && (attention || updating || retry) && state !== "needs_reauth" && state !== "unconfigured";
        const timestamp = source.lastSuccessAt && Number.isFinite(Date.parse(source.lastSuccessAt)) ? source.lastSuccessAt : null;
        return <li key={source.key || source.label} className="system-status-source sp-focus-ring" tabIndex={-1} data-source-key={source.key} data-attention={attention || undefined} data-compact={compact || undefined}
          style={{ "--status-color": STATE_COLOR[state] } as CSSProperties}>
          <StatusIcon state={updating ? "refreshing" : state} size={14} aria-hidden="true" />
          <div className="system-status-source-content">
            <div className="system-status-source-title"><strong>{source.label || source.key}</strong><span>{STATE_COPY[state]}</span></div>
            {!compact && !retry && <p>{source.message || "Status details are unavailable. Try syncing again."}</p>}
            {retry && retry.state !== "success" && <p>{source.message}</p>}
            {(retry || updating) && <p className="system-status-result" role="status">{updating ? `Updating ${source.label?.toLowerCase() || "this source"}…` : retry?.message || (retry?.state === "success" ? `${source.label} is up to date.` : "The update did not complete. Try again.")}</p>}
            {state !== "unconfigured" && <div className="system-status-time">
              {timestamp ? <>{source.key === "dashboard_connection" ? "Last checked " : "Updated "}<time dateTime={timestamp} title={new Date(timestamp).toLocaleString()}>{relativeTimestamp(timestamp)}</time></> : state === "checking" ? "Waiting for a status check" : "Last update unknown"}
            </div>}
            <div className="system-status-source-actions">
            {showRetry && <button type="button" className="system-status-retry" aria-disabled={refreshing || sourceRetry?.state === "pending" || updating} aria-busy={updating}
              onFocus={(event) => { retryFocusRef.current = { button: event.currentTarget, sourceKey: source.key }; }}
              onBlur={(event) => { if (event.relatedTarget) retryFocusRef.current = null; }}
              onClick={() => { if (source.retrySource && !refreshing && sourceRetry?.state !== "pending" && !updating) void onRetrySource?.(source.retrySource); }}>
              <RefreshCw size={12} aria-hidden="true" className={updating ? "system-status-spinner" : undefined} />
              {updating ? `Updating ${source.label}…` : `Retry ${source.label}`}
            </button>}
            {source.action && state !== "current" && <Link className="system-status-repair" to={source.action.href} onClick={onNavigate}>
              {source.action.label}<ArrowUpRight size={12} aria-hidden="true" />
            </Link>}
            </div>
          </div>
        </li>;
      })}
    </ul>
    {status.generatedAt && Number.isFinite(Date.parse(status.generatedAt)) && <p className="system-status-checked">Status checked <time dateTime={status.generatedAt} title={new Date(status.generatedAt).toLocaleString()}>{relativeTimestamp(status.generatedAt)}</time></p>}
  </div>;
}

export function SystemStatusButton({ systemStatus, isMobile = false, refreshing = false, onQuickRefresh, onRetrySource, sourceRetry }: {
  refreshing?: boolean;
  onQuickRefresh?: () => unknown;
  systemStatus?: SystemStatusView | null;
  isMobile?: boolean;
} & SystemStatusRetryProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const status = systemStatus || UNKNOWN_STATUS;
  const sourceState = systemState(status);
  const state = refreshing && sourceState === "current" ? "syncing" : sourceState;
  const attention = isAttentionState(state);
  const busy = refreshing || sourceRetry?.state === "pending" || isBusyState(state);
  const position = usePanelPosition(open, triggerRef);
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target))) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  const Glyph = attention ? AlertTriangle : state === "checking" ? CircleDashed : Activity;
  return <>
    <button ref={triggerRef} type="button" className="system-status-trigger" data-mobile={isMobile || undefined} data-attention={attention || undefined}
      style={{ "--status-color": STATE_COLOR[state] } as CSSProperties}
      title={`System status: ${STATE_COPY[state]}${!isMobile ? " · Sync now: R" : ""}`}
      aria-label={`System status: ${STATE_COPY[state]}`} aria-busy={busy} aria-expanded={open} aria-haspopup="dialog"
      onClick={() => setOpen((value) => !value)}>
      <span aria-hidden="true" data-testid="system-status-signal" className={busy ? "system-status-signal--busy" : undefined} style={{ "--system-status-signal-color": STATE_COLOR[state] } as CSSProperties}>
        <Glyph size={isMobile ? 15 : 13} strokeWidth={2} />
      </span>
    </button>
    <span className="sr-only" role="status" aria-live="polite">{refreshing ? "Syncing…" : `System status: ${STATE_COPY[state]}`}</span>
    {open && <StatusPanel status={status} onClose={close} panelRef={panelRef} position={position} refreshing={refreshing} onQuickRefresh={onQuickRefresh} onRetrySource={onRetrySource} sourceRetry={sourceRetry} />}
  </>;
}
