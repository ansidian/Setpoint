import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check, CircleDashed, Circle, ExternalLink, Pencil, X, AlertCircle,
  CalendarClock, Flag,
} from "lucide-react";
import { useDashboard } from "../../context/DashboardContext";
import { daysUntil } from "../../lib/bill-utils";
import { daysLabel, urgencyForDays } from "../../lib/redesign-helpers";
import AddTaskPanel from "../todoist/AddTaskPanel";

function ActionButton({ icon: Icon, label, onClick, accent, variant = "default", disabled, loading = false }) {
  const [hover, setHover] = useState(false);
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";
  const isAccent = variant === "accent";
  const successColor = "#a6e3a1";
  const color = isPrimary
    ? successColor
    : isAccent
    ? accent
    : isDanger
    ? "#f38ba8"
    : "rgba(205,214,244,0.8)";
  const bg = isPrimary
    ? (hover ? "rgba(166,227,161,0.14)" : "rgba(255,255,255,0.02)")
    : isAccent
    ? (hover ? `${accent}18` : `${accent}0c`)
    : hover
    ? "rgba(255,255,255,0.05)"
    : "rgba(255,255,255,0.02)";
  const border = isPrimary
    ? `1px solid ${hover ? "rgba(166,227,161,0.4)" : "rgba(166,227,161,0.22)"}`
    : isAccent
    ? `1px solid ${accent}38`
    : isDanger
    ? "1px solid rgba(243,139,168,0.22)"
    : "1px solid rgba(255,255,255,0.08)";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "7px 11px", borderRadius: 8,
        fontSize: 11, fontWeight: 600, fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        background: bg, border, color,
        transition: "all 120ms", whiteSpace: "nowrap",
      }}
    >
      {loading ? (
        <span
          aria-hidden
          style={{
            width: 11,
            height: 11,
            borderRadius: "50%",
            border: "1.5px solid currentColor",
            borderTopColor: "transparent",
            animation: "spin 700ms linear infinite",
          }}
        />
      ) : (
        Icon ? <Icon size={11} /> : null
      )}
      <span>{label}</span>
    </button>
  );
}

function InfoRow({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11 }}>
      <span style={{ color: "rgba(205,214,244,0.45)", letterSpacing: 0.3, textTransform: "uppercase", fontSize: 9.5, fontWeight: 600, width: 60 }}>
        {label}
      </span>
      <span style={{ color: color || "rgba(205,214,244,0.85)", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6 }}>
        {value}
      </span>
    </div>
  );
}

// Todoist priority: 1 = urgent, 2 = high, 3 = medium, 4 = low. We only render
// a badge for 1–3 since 4 is the default "no flag" baseline in Todoist's UX.
const PRIORITY_META = {
  1: { color: "#f38ba8", label: "P1 · Urgent" },
  2: { color: "#f9e2af", label: "P2 · High" },
  3: { color: "#89b4fa", label: "P3 · Medium" },
};

function PriorityBadge({ level }) {
  const meta = PRIORITY_META[level];
  if (!meta) return null;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "2px 8px", borderRadius: 99,
        fontSize: 10, fontWeight: 600, letterSpacing: 0.2,
        color: meta.color,
        background: `${meta.color}1e`,
        border: `1px solid ${meta.color}38`,
      }}
    >
      <Flag size={10} strokeWidth={2.2} />
      {meta.label}
    </span>
  );
}

function openInNewTab(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function computePos(anchor) {
  if (!anchor) return null;
  const r = anchor.getBoundingClientRect();
  const panelW = 340;
  const panelH = 300;
  const margin = 8;
  // Prefer right-of anchor, else below, else above
  let top = r.top;
  let left = r.right + margin;
  if (left + panelW > window.innerWidth - 12) {
    left = Math.max(12, r.left);
    top = r.bottom + margin;
    if (top + panelH > window.innerHeight - 12) {
      top = Math.max(12, r.top - panelH - margin);
    }
  }
  if (top + panelH > window.innerHeight - 12) {
    top = Math.max(12, window.innerHeight - 12 - panelH);
  }
  return { top, left };
}

export default function DeadlineDetailPopover({ task, anchor, accent = "#cba6da", onClose }) {
  const panelRef = useRef(null);
  const [pos, setPos] = useState(() => computePos(anchor));
  const [editing, setEditing] = useState(false);
  const [completingState, setCompletingState] = useState({ taskId: null, pending: false });
  const editAnchorRef = useRef(null);
  const { handleCompleteTask, handleUpdateTaskStatus, handleUpdateTask } = useDashboard();

  // Reposition on scroll/resize (init already happened in lazy useState)
  useEffect(() => {
    if (!anchor) return undefined;
    function update() { setPos(computePos(anchor)); }
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchor]);

  useEffect(() => {
    function handleClick(e) {
      if (editing) return;
      if (panelRef.current?.contains(e.target)) return;
      if (anchor?.contains(e.target)) return;
      if (e.target.closest?.('[role="menu"], [role="dialog"]')) return;
      onClose();
    }
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [anchor, onClose, editing]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (!task || !pos) return null;

  const isTodoist = task.source === "todoist";
  const isCanvas = task.source === "canvas";
  const completing = completingState.pending && completingState.taskId === task.id;
  const isComplete = task.status === "complete" || completing;
  const isInProgress = task.status === "in_progress";
  const ctmUrl = `https://ctm.andysu.tech/#/event/${task.id}`;

  const days = daysUntil(task.due_date);
  const urgency = urgencyForDays(days, accent);
  const dueColor = urgency.key === "high" ? "#f38ba8" : urgency.key === "medium" ? "#f9e2af" : accent;

  const sourceLabel = isTodoist ? "Todoist" : isCanvas ? "Canvas" : "CTM";
  const sourceColor = isTodoist ? "#cba6da" : isCanvas ? "#fab387" : "#b4befe";

  return createPortal(
    <>
      <div
        ref={panelRef}
        role="dialog"
        className="isolate animate-in fade-in zoom-in-95 duration-150"
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: 340,
          zIndex: 60,
          background: "radial-gradient(ellipse at top left, #1a1a2a, #0d0d15 70%)",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.04)",
          overflow: "hidden",
          isolation: "isolate",
        }}
      >
        {/* Header strip with source tint */}
        <div
          style={{
            padding: "12px 14px 10px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            background: `linear-gradient(135deg, ${sourceColor}0e, transparent 65%)`,
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <div
            style={{
              width: 22, height: 22, borderRadius: 6,
              background: `${sourceColor}18`,
              display: "grid", placeItems: "center",
            }}
          >
            <AlertCircle size={11} color={sourceColor} />
          </div>
          <div
            style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: 2,
              textTransform: "uppercase", color: sourceColor,
            }}
          >
            {sourceLabel}
          </div>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: "rgba(205,214,244,0.5)", padding: 4, borderRadius: 4,
              display: "inline-flex", fontFamily: "inherit",
            }}
            aria-label="Close"
          >
            <X size={12} />
          </button>
        </div>

        {/* Title */}
        <div style={{ padding: "14px 16px 8px" }}>
          <div
            className="ea-display"
            style={{
              fontSize: 15, fontWeight: 500, color: "#fff",
              lineHeight: 1.3, letterSpacing: -0.2,
              textDecoration: isComplete ? "line-through" : "none",
              textDecorationColor: "rgba(205,214,244,0.35)",
            }}
          >
            {task.title || "Untitled task"}
          </div>
          {(task.class_name || task.project_name) && (
            <div
              style={{
                marginTop: 4, fontSize: 11,
                color: "rgba(205,214,244,0.5)",
              }}
            >
              {task.class_name || task.project_name}
            </div>
          )}
        </div>

        {/* Meta */}
        <div style={{ padding: "4px 16px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          <InfoRow
            label="Due"
            value={`${daysLabel(days)}${task.due_time ? ` · ${task.due_time}` : ""}`}
            color={dueColor}
          />
          <InfoRow
            label="Status"
            value={isComplete ? "Complete" : isInProgress ? "In progress" : "Incomplete"}
          />
          {isTodoist && PRIORITY_META[task.priority] && (
            <InfoRow
              label="Priority"
              value={<PriorityBadge level={task.priority} />}
            />
          )}
          {task.points_possible != null && (
            <InfoRow label="Points" value={`${task.points_possible}`} />
          )}
        </div>

        {/* Actions */}
        <div
          style={{
            padding: "10px 14px 14px",
            borderTop: "1px solid rgba(255,255,255,0.04)",
            display: "flex", flexWrap: "wrap", gap: 6,
          }}
        >
          {isTodoist ? (
            <>
              {!isComplete && (
                <ActionButton
                  icon={Check}
                  label={completing ? "Completing..." : "Mark complete"}
                  variant="primary"
                  accent={accent}
                  disabled={completing}
                  loading={completing}
                  onClick={() => {
                    setCompletingState({ taskId: task.id, pending: true });
                    Promise.resolve(handleCompleteTask(task.id)).catch(() => {
                      setCompletingState({ taskId: task.id, pending: false });
                    });
                    window.setTimeout(() => onClose(), 720);
                  }}
                />
              )}
              <div ref={editAnchorRef} style={{ display: "inline-flex" }}>
                <ActionButton
                  icon={Pencil}
                  label="Edit"
                  accent={accent}
                  disabled={completing}
                  onClick={() => setEditing(true)}
                />
              </div>
              {task.url && (
                <ActionButton
                  icon={ExternalLink}
                  label="Open in Todoist"
                  variant="accent"
                  accent={accent}
                  disabled={completing}
                  onClick={() => { openInNewTab(task.url); onClose(); }}
                />
              )}
            </>
          ) : (
            <>
              {task.status !== "complete" && (
                <ActionButton
                  icon={Check}
                  label="Mark complete"
                  variant="primary"
                  accent={accent}
                  onClick={() => { handleUpdateTaskStatus(task.id, "complete"); onClose(); }}
                />
              )}
              {task.status !== "in_progress" && (
                <ActionButton
                  icon={CircleDashed}
                  label="In progress"
                  accent={accent}
                  onClick={() => { handleUpdateTaskStatus(task.id, "in_progress"); onClose(); }}
                />
              )}
              {task.status !== "incomplete" && (
                <ActionButton
                  icon={Circle}
                  label="Reopen"
                  accent={accent}
                  onClick={() => { handleUpdateTaskStatus(task.id, "incomplete"); onClose(); }}
                />
              )}
              {task.url && /instructure\.com|canvas/i.test(task.url) && (
                <ActionButton
                  icon={ExternalLink}
                  label="Open in Canvas"
                  variant="accent"
                  accent={accent}
                  onClick={() => { openInNewTab(task.url); onClose(); }}
                />
              )}
              <ActionButton
                icon={CalendarClock}
                label="Open in CTM"
                variant="accent"
                accent={accent}
                onClick={() => { openInNewTab(ctmUrl); onClose(); }}
              />
            </>
          )}
        </div>
      </div>

      {editing && isTodoist && (
        <AddTaskPanel
          anchorRef={editAnchorRef}
          editingTask={task}
          onClose={() => setEditing(false)}
          onTaskUpdated={(updated) => { handleUpdateTask(updated); setEditing(false); onClose(); }}
        />
      )}
    </>,
    document.body,
  );
}
