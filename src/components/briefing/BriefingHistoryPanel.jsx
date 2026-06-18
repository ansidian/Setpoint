import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Clock, ClipboardList } from "lucide-react";
import { getSnapshotById, getSnapshotHistory } from "../../api";
import useIsMobile from "../../hooks/useIsMobile";
import BottomSheet from "../ui/BottomSheet";
import { groupByDate, formatWindow, countLabel } from "./briefingHistoryModel.js";

const ACCENT = "#cba6da";

function SnapshotRow({ item, active, loading, isMobile, onSelect }) {
  const [hover, setHover] = useState(false);
  const statusLabel = item.readOnly ? "Read-only" : "Active";
  const boundary = item.schedule_label || (item.readOnly ? "Snapshot" : "Current");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        margin: "0 8px",
        padding: "10px 14px",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        cursor: active ? "default" : loading ? "wait" : "pointer",
        background: active ? `${ACCENT}12` : hover ? "rgba(255,255,255,0.035)" : "transparent",
        border: `1px solid ${active ? `${ACCENT}30` : "transparent"}`,
        transition: "background 150ms, border-color 150ms, transform 150ms",
        transform: hover && !active ? "translateY(-1px)" : "translateY(0)",
      }}
    >
      {active && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 8,
            bottom: 8,
            width: 3,
            background: ACCENT,
            borderRadius: 2,
            boxShadow: `0 0 8px ${ACCENT}60`,
          }}
        />
      )}

      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: active ? "#e2d0eb" : "rgba(205,214,244,0.92)",
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {boundary}
          </span>
          <span
            style={{
              flexShrink: 0,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              color: item.readOnly ? "rgba(205,214,244,0.58)" : ACCENT,
              background: item.readOnly ? "rgba(255,255,255,0.05)" : `${ACCENT}14`,
              border: `1px solid ${item.readOnly ? "rgba(255,255,255,0.07)" : `${ACCENT}26`}`,
              padding: "2px 6px",
              borderRadius: 6,
            }}
          >
            {statusLabel}
          </span>
        </div>
        <div
          style={{
            fontSize: 10,
            marginTop: 4,
            color: "var(--color-text-faint)",
            lineHeight: 1.35,
          }}
        >
          {formatWindow(item)} · {countLabel(item)}
        </div>
      </div>

      {loading ? (
        <div
          style={{
            width: 13,
            height: 13,
            borderRadius: 99,
            border: `1.5px solid ${ACCENT}30`,
            borderTopColor: ACCENT,
            animation: "spin 600ms linear infinite",
            flexShrink: 0,
          }}
        />
      ) : (
        <span
          style={{
            flexShrink: 0,
            fontSize: 10,
            fontWeight: 600,
            color: active ? `${ACCENT}cc` : "rgba(180,190,254,0.55)",
            opacity: isMobile || hover || active ? 1 : 0.75,
          }}
        >
          {item.readOnly ? "Open" : "Current"}
        </span>
      )}
    </div>
  );
}

export default function BriefingHistoryPanel({
  activeId,
  triggerRef,
  onSelectSnapshot,
  onClose,
}) {
  const isMobile = useIsMobile();
  const [history, setHistory] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [error, setError] = useState(null);
  const [pos, setPos] = useState(null);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);

  const updatePos = useCallback(() => {
    if (!triggerRef?.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
  }, [triggerRef]);

  useEffect(() => {
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [updatePos]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    function onWheel(e) {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll <= 0) { e.preventDefault(); return; }
      const atTop = scrollTop <= 0 && e.deltaY < 0;
      const atBottom = scrollTop >= maxScroll && e.deltaY > 0;
      if (atTop || atBottom) e.preventDefault();
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pos, isMobile, history]);

  useEffect(() => {
    getSnapshotHistory()
      .then((data) => setHistory(data?.snapshots || []))
      .catch((err) => setError(err.message || "Failed to load snapshots"));
  }, []);

  useEffect(() => {
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target) &&
          !(triggerRef?.current && triggerRef.current.contains(e.target))) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [onClose, triggerRef]);

  async function handleSelect(item) {
    if (loadingId || item.id === activeId) return;
    setLoadingId(item.id);
    setError(null);
    try {
      const view = item.readOnly ? await getSnapshotById(item.id) : null;
      onSelectSnapshot?.(view, {
        id: item.id,
        readOnly: item.readOnly,
        status: item.status,
        start_at: item.start_at,
        end_at: item.end_at,
        schedule_label: item.schedule_label,
      });
    } catch (err) {
      setError(`Failed to load snapshot: ${err.message}`);
    } finally {
      setLoadingId(null);
    }
  }

  const groups = history ? groupByDate(history) : [];
  const totalSnapshots = history?.length || 0;

  const content = (
    <div ref={scrollRef} style={{ overflowY: "auto", overscrollBehavior: "contain", flex: 1 }}>
      {!history && !error && (
        <div style={{ padding: "40px 20px", textAlign: "center" }}>
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: 99,
              margin: "0 auto 12px",
              border: `2px solid ${ACCENT}26`,
              borderTopColor: ACCENT,
              animation: "spin 600ms linear infinite",
            }}
          />
          <div style={{ fontSize: 11, color: "var(--color-text-faint)" }}>Loading snapshots...</div>
        </div>
      )}

      {error && (
        <div
          style={{
            margin: "14px 16px",
            padding: "10px 12px",
            borderRadius: 8,
            fontSize: 11,
            color: "#f38ba8",
            background: "rgba(243,139,168,0.08)",
            border: "1px solid rgba(243,139,168,0.22)",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      )}

      {history && groups.length === 0 && (
        <div style={{ padding: "40px 20px", textAlign: "center" }}>
          <ClipboardList size={22} color="rgba(205,214,244,0.25)" style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 11, color: "var(--color-text-faint)" }}>No snapshots yet</div>
        </div>
      )}

      <div style={{ padding: "6px 0" }}>
        {groups.map((group, gi) => (
          <div key={group.label}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "14px 20px 6px",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: "var(--color-text-faint)",
                  whiteSpace: "nowrap",
                }}
              >
                {group.label}
              </span>
              {gi > 0 && (
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)" }} />
              )}
            </div>
            {group.items.map((item) => (
              <SnapshotRow
                key={item.id}
                item={item}
                active={item.id === activeId}
                loading={loadingId === item.id}
                isMobile={isMobile}
                onSelect={() => handleSelect(item)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <BottomSheet open onClose={onClose} title="Snapshots">
        {content}
      </BottomSheet>
    );
  }

  if (!pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="isolate animate-in fade-in slide-in-from-top-2 duration-250"
      style={{
        position: "fixed",
        top: pos.top,
        right: pos.right,
        width: 340,
        maxHeight: `min(460px, calc(100vh - ${pos.top + 16}px))`,
        zIndex: "var(--z-popover)",
        display: "flex",
        flexDirection: "column",
        background: "#16161e",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        overflow: "hidden",
        isolation: "isolate",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: "14px 18px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: `linear-gradient(135deg, ${ACCENT}0e, transparent 60%)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              background: `${ACCENT}18`,
              display: "grid",
              placeItems: "center",
            }}
          >
            <Clock size={11} color={ACCENT} />
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: ACCENT,
            }}
          >
            Snapshots
          </span>
        </div>
        {history && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-text-faint)",
            }}
          >
            {totalSnapshots} snapshot{totalSnapshots === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {content}
    </div>,
    document.body,
  );
}
