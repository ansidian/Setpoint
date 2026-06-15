import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Info,
  LoaderCircle,
} from "lucide-react";

const FALLBACK_STATUS = {
  state: "current",
  sources: [],
};

const STATE_COPY = {
  current: "Current",
  refreshing: "Refreshing",
  syncing: "Syncing",
  needs_sync: "Needs sync",
  degraded: "Degraded",
  unavailable: "Unavailable",
  unconfigured: "Unconfigured",
};

const STATE_COLOR = {
  current: "#a6e3a1",
  refreshing: "#89b4fa",
  syncing: "#89b4fa",
  needs_sync: "#f9e2af",
  degraded: "#f9e2af",
  unavailable: "#f38ba8",
  unconfigured: "#a6adc8",
};

function normalizeState(state) {
  if (state === "stale") return "needs_sync";
  return STATE_COPY[state] ? state : "unavailable";
}

function isAttentionState(state) {
  return state === "needs_sync" || state === "degraded" || state === "unavailable";
}

function isBusyState(state) {
  return state === "refreshing" || state === "syncing";
}

function StatusIcon({ state, ...props }) {
  if (state === "current") return <CheckCircle2 {...props} />;
  if (state === "refreshing" || state === "syncing") return <LoaderCircle {...props} />;
  if (state === "needs_sync" || state === "degraded" || state === "unavailable") return <AlertTriangle {...props} />;
  if (state === "unconfigured") return <CircleDashed {...props} />;
  return <Info {...props} />;
}

function StatusSignalDot({ active, attention, busy, color, isMobile }) {
  const rgb = hexToRgb(color);
  const glow = active ? 0.84 : attention ? 0.76 : 0.66;
  const aura = active ? 0.3 : attention ? 0.26 : 0.22;
  const size = isMobile ? 7 : 7.5;

  return (
    <span
      aria-hidden="true"
      data-testid="system-status-signal"
      className={
        busy
          ? "system-status-signal system-status-signal--busy"
          : "system-status-signal"
      }
      style={{
        "--system-status-signal-color": color,
        "--system-status-signal-rgb": rgb,
        width: isMobile ? 18 : 20,
        height: isMobile ? 18 : 20,
        borderRadius: "9999px",
        background: `radial-gradient(circle, rgba(${rgb}, ${aura}) 0 18%, rgba(${rgb}, ${aura * 0.55}) 34%, rgba(${rgb}, 0) 68%)`,
        display: "inline-grid",
        placeItems: "center",
      }}
    >
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "9999px",
          background: color,
          boxShadow: `0 0 10px rgba(${rgb}, ${glow}), 0 0 13px rgba(${rgb}, ${glow * 0.72}), 0 0 24px rgba(${rgb}, ${glow * 0.42})`,
          display: "block",
        }}
      />
    </span>
  );
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);

  if (Number.isNaN(value) || normalized.length !== 6) {
    return "166, 227, 161";
  }

  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `${red}, ${green}, ${blue}`;
}

function formatTimestamp(value) {
  if (!value) return "No recent success";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No recent success";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function usePanelPosition(open, triggerRef) {
  const [position, setPosition] = useState({ top: 52, right: 12 });

  useLayoutEffect(() => {
    if (!open) return undefined;

    function update() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 300;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      setPosition({
        top: rect.bottom + 8,
        left,
      });
    }

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

function StatusPanel({ status, onClose, panelRef, position }) {
  const [closeHover, setCloseHover] = useState(false);
  const [closeFocus, setCloseFocus] = useState(false);
  const [closePressed, setClosePressed] = useState(false);
  const sources = status.sources?.length
    ? status.sources
    : [{ key: "system", label: "System", state: status.state, message: "System status is current." }];
  const closeActive = (closeHover || closeFocus) && !closePressed;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="System status"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        width: 300,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "min(420px, calc(100vh - 72px))",
        overflowY: "auto",
        overscrollBehavior: "contain",
        isolation: "isolate",
        padding: 10,
        borderRadius: 12,
        background: "#16161e",
        border: "1px solid rgba(255,255,255,0.09)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        color: "#cdd6f4",
        zIndex: 80,
      }}
      onWheel={(event) => {
        const target = event.currentTarget;
        const atTop = target.scrollTop <= 0;
        const atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 1;
        if ((atTop && event.deltaY < 0) || (atBottom && event.deltaY > 0)) {
          event.preventDefault();
        }
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "2px 2px 8px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase" }}>
          System status
        </div>
        <button
          type="button"
          onClick={onClose}
          onMouseEnter={() => setCloseHover(true)}
          onMouseLeave={() => {
            setCloseHover(false);
            setClosePressed(false);
          }}
          onFocus={() => setCloseFocus(true)}
          onBlur={() => {
            setCloseFocus(false);
            setClosePressed(false);
          }}
          onPointerDown={() => setClosePressed(true)}
          onPointerUp={() => setClosePressed(false)}
          aria-label="Close system status"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: closeActive ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)",
            color: closeActive ? "#cdd6f4" : "rgba(205,214,244,0.74)",
            borderRadius: 7,
            cursor: "pointer",
            fontSize: 11,
            padding: "3px 7px",
            transform: closeActive ? "translateY(-1px)" : "translateY(0)",
            boxShadow: closeFocus ? "0 0 0 2px rgba(203,166,218,0.24)" : "none",
            transition: "transform 150ms, background 150ms, border-color 150ms, color 150ms, box-shadow 150ms",
          }}
        >
          Close
        </button>
      </div>
      <div style={{ display: "grid", gap: 6, paddingTop: 8 }}>
        {sources.map((source) => {
          const state = normalizeState(source.state);
          const color = STATE_COLOR[state];
          return (
            <div
              key={source.key || source.label}
              style={{
                display: "grid",
                gridTemplateColumns: "16px minmax(0, 1fr)",
                gap: 9,
                padding: "8px 6px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.06)",
                background: isAttentionState(state) ? `${color}10` : "rgba(255,255,255,0.025)",
              }}
            >
              <StatusIcon
                state={state}
                size={14}
                color={color}
                style={{ marginTop: 1, animation: isBusyState(state) ? "spin 0.8s linear infinite" : "none" }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 650, color: "#cdd6f4" }}>
                    {source.label || source.key}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 0.6 }}>
                    {STATE_COPY[state]}
                  </div>
                </div>
                <div style={{ marginTop: 3, fontSize: 11, lineHeight: 1.35, color: "rgba(205,214,244,0.72)" }}>
                  {source.message || "Status details are unavailable."}
                </div>
                <div style={{ marginTop: 5, fontSize: 10.5, color: "rgba(166,173,200,0.68)" }}>
                  Last success: {formatTimestamp(source.lastSuccessAt)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

export function SystemStatusButton({ systemStatus = FALLBACK_STATUS, isMobile = false }) {
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const status = systemStatus || FALLBACK_STATUS;
  const state = normalizeState(status.state);
  const color = STATE_COLOR[state];
  const position = usePanelPosition(open, triggerRef);
  const active = hover || open || focused;
  const attention = isAttentionState(state);
  const busy = isBusyState(state);

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (triggerRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      setOpen(false);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`System status: ${state}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => {
          setPressed(false);
          setHover(false);
        }}
        onMouseEnter={() => setHover(true)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          minWidth: isMobile ? 40 : 34,
          height: isMobile ? 40 : 28,
          padding: isMobile ? 8 : "5px 8px",
          touchAction: "manipulation",
          borderRadius: 8,
          border: "none",
          background: attention
            ? `${color}0f`
            : active
              ? "rgba(255,255,255,0.045)"
              : "transparent",
          boxShadow: focused ? "0 0 0 2px rgba(203,166,218,0.24)" : "none",
          cursor: "pointer",
          display: "inline-grid",
          placeItems: "center",
          transform: hover && !pressed ? "translateY(-1px)" : "translateY(0)",
          transition:
            "transform 150ms, background 150ms, box-shadow 150ms, color 150ms",
        }}
      >
        <StatusSignalDot
          active={active}
          attention={attention}
          busy={busy}
          color={color}
          isMobile={isMobile}
        />
      </button>
      {open && (
        <StatusPanel
          status={status}
          onClose={() => setOpen(false)}
          panelRef={panelRef}
          position={position}
        />
      )}
    </>
  );
}
