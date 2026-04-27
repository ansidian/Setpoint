import DOMPurify from "dompurify";
// eslint-disable-next-line no-unused-vars
import { motion } from "motion/react";
import { todayPacific, toPacificDate, formatFullDate } from "../../lib/dashboard-helpers";
import Tooltip from "../shared/Tooltip";
import { MotionExpand, MotionChevron } from "../ui/motion-wrappers";
import "./CTMCard.css";

const CTM_STATUSES = ["incomplete", "in_progress", "complete"];
const TODOIST_STATUSES = ["incomplete", "complete"];
const SPINE_COLORS = { incomplete: "#5A8FBF", in_progress: "#8C6BC0", complete: "#4B9968" };
const dotSpring = { type: "spring", stiffness: 500, damping: 15 };

function getDaysUntil(dateStr) {
  const todayStr = todayPacific();
  const dueStr = toPacificDate(dateStr);
  const diff = Math.round((new Date(dueStr + "T12:00:00") - new Date(todayStr + "T12:00:00")) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  return `${diff} days`;
}

function getDueUrgency(dateStr) {
  const todayStr = todayPacific();
  const dueStr = toPacificDate(dateStr);
  const diff = Math.round((new Date(dueStr + "T12:00:00") - new Date(todayStr + "T12:00:00")) / 86400000);
  if (diff <= 0) return "high";
  if (diff <= 2) return "medium";
  return "low";
}

function StatusSpine({ status, statuses, expanded, onStatusChange }) {
  const idx = Math.max(0, statuses.indexOf(status));
  const count = statuses.length;

  const dotSize = expanded ? 10 : 6;
  const lineHeight = expanded ? 10 : 5;
  const lineWidth = expanded ? 2.5 : 1.5;

  function lineGradient(lineIdx) {
    const fromColor = SPINE_COLORS[statuses[lineIdx]];
    const toColor = SPINE_COLORS[statuses[lineIdx + 1]];
    if (lineIdx + 1 <= idx) return `linear-gradient(to bottom, ${fromColor}, ${toColor})`;
    if (lineIdx === idx) return `linear-gradient(to bottom, ${SPINE_COLORS[statuses[idx]]}, rgba(166,173,200,0.15))`;
    return "rgba(166,173,200,0.12)";
  }

  return (
    <div className="ctm-spine-v" onClick={expanded ? e => e.stopPropagation() : undefined}>
      {statuses.map((s, i) => {
        const color = SPINE_COLORS[s];
        const isActive = i <= idx;
        return (
          <div key={s} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            {i > 0 && (
              <motion.div
                animate={{ height: lineHeight, width: lineWidth }}
                transition={{ ...dotSpring, delay: expanded ? i * 0.06 : (count - 1 - i) * 0.04 }}
                style={{ background: lineGradient(i - 1), borderRadius: 2 }}
              />
            )}
            <div
              className={`ctm-spine-v-dot-wrap${expanded ? " active" : ""}`}
              data-target={s}
              onClick={expanded ? () => onStatusChange(s) : undefined}
            >
              <motion.div
                className={`ctm-spine-v-dot ${isActive ? "filled" : "hollow"}`}
                initial={false}
                animate={{
                  width: dotSize,
                  height: dotSize,
                  borderWidth: expanded ? 2 : 1.5,
                }}
                transition={{ ...dotSpring, delay: expanded ? i * 0.06 : (count - 1 - i) * 0.04 }}
                style={isActive ? {
                  background: color,
                  borderColor: color,
                  borderStyle: "solid",
                  borderRadius: "50%",
                } : {
                  background: "transparent",
                  borderColor: "rgba(166,173,200,0.25)",
                  borderStyle: "solid",
                  borderRadius: "50%",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ExternalLinkIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
  </svg>
);

export default function CTMCard({ task, expanded, onToggle, onComplete, onStatusChange, onContextMenu }) {
  const daysLabel = getDaysUntil(task.due_date);
  const urg = getDueUrgency(task.due_date);
  const isTodoist = task.source === "todoist";
  const isCanvas = task.source === "canvas";
  const isCTMSource = isCanvas || task.source === "manual";
  const isCompleting = !!task._completing;
  const isComplete = task.status === "complete";
  const showCompletedVisual = isCompleting || isComplete;
  const urgColor = { high: "#f38ba8", medium: "#f9e2af", low: "#a6adc8" }[urg];
  const statuses = isTodoist ? TODOIST_STATUSES : CTM_STATUSES;
  function handleSpineChange(newStatus) {
    if (task._tombstone) return;
    if (newStatus === task.status) return;
    if (newStatus === "complete") {
      if (isTodoist) {
        onComplete(task.id);
      } else {
        onStatusChange(task.id, "complete");
      }
      return;
    }
    onStatusChange(task.id, newStatus);
  }

  return (
    <div
      onClick={onToggle}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      className={`group relative p-3 px-2 pl-5 cursor-pointer border-t border-white/[0.04] first:border-t-0 transition-colors duration-150${isCompleting ? " ctm-card-completing" : ""}${isComplete && !isCompleting ? " ctm-card-complete" : ""}`}
      style={{
        background: showCompletedVisual ? "rgba(75,153,104,0.06)" : "transparent",
      }}
    >
      {/* Hover bg */}
      <div className="absolute inset-0 bg-white/0 group-hover:bg-white/[0.025] transition-colors duration-150" />

      {/* Color accent bar */}
      <div
        className="absolute left-0 top-3 bottom-3 w-px rounded-full"
        style={{
          background: task.class_color,
          opacity: 0.7,
          boxShadow: `0 0 6px ${task.class_color}30`,
        }}
      />

      <div className="relative flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-medium" style={{ color: task.class_color }}>{task.class_name}</span>
            <span
              className="text-[9px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded"
              style={{
                color: isTodoist ? "#cba6dacc" : isCanvas ? "#fab387cc" : "#a6adc8cc",
                background: isTodoist ? "rgba(203,166,218,0.08)" : isCanvas ? "rgba(250,179,135,0.08)" : "rgba(166,173,200,0.08)",
              }}
            >
              {isTodoist ? "Todoist" : isCanvas ? "Canvas" : "CTM"}
            </span>
          </div>
          <div className="ctm-title text-[13px] font-medium text-foreground/90 mt-0.5">{task.title}</div>
          <MotionExpand isOpen={expanded}>
            <div className="mt-2 pt-2 border-t border-white/[0.04]">
              {task.description && <div className="ctm-desc" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(task.description) }} />}
            </div>
          </MotionExpand>
        </div>

        {/* Inline action buttons */}
        <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
          {isCanvas && task.url && (
            <Tooltip text="Open in Canvas">
              <a
                href={task.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ctm-icon-btn"
                style={{
                  color: `${task.class_color}aa`,
                  background: `${task.class_color}08`,
                  border: `1px solid ${task.class_color}15`,
                }}
              >
                <ExternalLinkIcon />
              </a>
            </Tooltip>
          )}
          {isCTMSource && (
            <Tooltip text="Open in CTM">
              <a
                href={`https://ctm.andysu.tech/#/event/${task.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ctm-icon-btn"
                style={{
                  color: "#b4befeaa",
                  background: "rgba(180,190,254,0.05)",
                  border: "1px solid rgba(180,190,254,0.1)",
                }}
              >
                <ExternalLinkIcon />
              </a>
            </Tooltip>
          )}
          {isTodoist && task.url && (
            <Tooltip text="Open in Todoist">
              <a
                href={task.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ctm-icon-btn"
                style={{
                  color: "#cba6daaa",
                  background: "rgba(203,166,218,0.05)",
                  border: "1px solid rgba(203,166,218,0.1)",
                }}
              >
                <ExternalLinkIcon />
              </a>
            </Tooltip>
          )}
        </div>

        <div className="flex items-start gap-2 shrink-0">
          <div className="text-right">
            <Tooltip text={formatFullDate(task.due_date)}>
              <div
                className="text-[11px] font-semibold tabular-nums"
                style={{ color: urgColor }}
              >{daysLabel}</div>
            </Tooltip>
            <div className="text-[10px] text-muted-foreground/40 mt-0.5">{task.due_time}</div>
            {task.points_possible && (
              <div
                className="text-[9px] font-semibold mt-1.5 px-1.5 py-0.5 rounded tabular-nums"
                style={{
                  color: `${task.class_color}aa`,
                  background: `${task.class_color}0d`,
                }}
              >
                {task.points_possible} pts
              </div>
            )}
          </div>
          <StatusSpine
            status={task.status}
            statuses={statuses}
            expanded={expanded}
            onStatusChange={handleSpineChange}
          />
          <MotionChevron isOpen={expanded} className="text-muted-foreground/40 mt-0.5" />
        </div>
      </div>
    </div>
  );
}
