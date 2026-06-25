import { useState, useRef } from "react";
import {
  Check, ExternalLink, Pencil, AlertCircle, Flag,
} from "lucide-react";
import BottomSheet from "../ui/BottomSheet";
import { useDashboard } from "../../context/DashboardContext";
import { daysUntil } from "../../lib/bill-utils";
import { daysLabel, urgencyForDays } from "../../lib/shell-helpers";
import AddTaskPanel from "../todoist/AddTaskPanel";
import { TODOIST_DEADLINE_COLOR } from "../../../shared/deadline-source-colors.js";

function ActionButton({ icon: Icon, label, onClick, accent, variant = "default", disabled, loading = false }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const active = hover || focus;
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";
  const isAccent = variant === "accent";
  const successColor = "var(--sp-green)";
  const color = isPrimary
    ? successColor
    : isAccent
    ? accent
    : isDanger
    ? "var(--sp-rose)"
    : "rgba(205,214,244,0.8)";
  const bg = isPrimary
    ? (active ? "color-mix(in srgb, var(--sp-green) 14%, transparent)" : "rgba(255,255,255,0.02)")
    : isAccent
    ? (active ? `${accent}18` : `${accent}0c`)
    : active
    ? "rgba(255,255,255,0.05)"
    : "rgba(255,255,255,0.02)";
  const border = isPrimary
    ? `1px solid ${active ? "color-mix(in srgb, var(--sp-green) 40%, transparent)" : "color-mix(in srgb, var(--sp-green) 22%, transparent)"}`
    : isAccent
    ? `1px solid ${accent}38`
    : isDanger
    ? "1px solid color-mix(in srgb, var(--sp-rose) 22%, transparent)"
    : "1px solid rgba(255,255,255,0.08)";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "7px 11px", borderRadius: 8,
        fontSize: 11, fontWeight: 600, fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        background: bg, border, color,
        outline: focus ? `2px solid ${accent}66` : "none",
        outlineOffset: 2,
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
      <span style={{ color: "var(--color-text-faint)", letterSpacing: 0.3, textTransform: "uppercase", fontSize: 9.5, fontWeight: 600, width: 60 }}>
        {label}
      </span>
      <span style={{ color: color || "rgba(205,214,244,0.85)", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6 }}>
        {value}
      </span>
    </div>
  );
}

// Provider priorities use 1 = urgent, 2 = high, 3 = medium, 4 = low. We only
// render a badge for 1-3 since 4 is the default "no flag" baseline.
// literal hexes: meta.color is consumed via `${meta.color}1e` / `${meta.color}38`
// hex-alpha concat in PriorityBadge below, where a var(--sp-*) would be invalid CSS
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

export default function DeadlineDetailPopover({ task, accent = "#cba6da", onClose }) {
  const [editing, setEditing] = useState(false);
  const [completingState, setCompletingState] = useState({ taskId: null, pending: false });
  const editAnchorRef = useRef(null);
  const { handleCompleteTask, handleUpdateTask } = useDashboard();

  if (!task) return null;

  const completing = completingState.pending && completingState.taskId === task.id;
  const isComplete = task.status === "complete" || completing;
  const isInProgress = task.status === "in_progress";

  const days = daysUntil(task.due_date);
  const urgency = urgencyForDays(days, accent);

  const deadlineLabel = "Deadline";
  const deadlineColor = task.color || task.sourceColor || TODOIST_DEADLINE_COLOR || accent;
  const dueColor = urgency.key === "high" ? "var(--sp-rose)" : urgency.key === "medium" ? "var(--sp-cream)" : deadlineColor;

  return (
    <>
      <BottomSheet open onClose={onClose} title="Deadline">
        <div>
          {/* Header strip with source tint */}
          <div
            style={{
              padding: "12px 14px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              background: `linear-gradient(135deg, ${deadlineColor}0e, transparent 65%)`,
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <div
              style={{
                width: 22, height: 22, borderRadius: 6,
                background: `${deadlineColor}18`,
                display: "grid", placeItems: "center",
              }}
            >
              <AlertCircle size={11} color={deadlineColor} />
            </div>
            <div
              style={{
                fontSize: 9.5, fontWeight: 700, letterSpacing: 2,
                textTransform: "uppercase", color: deadlineColor,
              }}
            >
              {deadlineLabel}
            </div>
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
                  color: "var(--color-text-faint)",
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
            {PRIORITY_META[task.priority] && (
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
                  Promise.resolve(handleCompleteTask(task.id, task)).catch(() => {
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
          </div>
        </div>
      </BottomSheet>

      {editing && (
        <AddTaskPanel
          anchorRef={editAnchorRef}
          editingTask={task}
          onClose={() => setEditing(false)}
          onTaskUpdated={(updated) => { handleUpdateTask(updated); setEditing(false); onClose(); }}
        />
      )}
    </>
  );
}
