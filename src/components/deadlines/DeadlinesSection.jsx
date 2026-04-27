import { useState, useRef } from "react";
import Section from "../layout/Section";
import { parseDueDate } from "../../lib/dashboard-helpers";
import CTMCard from "../ctm/CTMCard";
import { MotionList, MotionItem } from "../ui/motion-wrappers";
import { useDashboard } from "../../context/DashboardContext";
import AddTaskPanel from "../todoist/AddTaskPanel";
import ContextMenu from "../ui/ContextMenu";

function openInNewTab(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function buildTaskMenu(task, { onEdit, onComplete, onStatusChange, onDismissGhost }) {
  const isTombstone = task._tombstone === true;
  const isTodoist = task.source === "todoist";
  const isCanvas = task.source === "canvas";
  const isComplete = task.status === "complete";

  if (isTombstone) {
    return [
      task.url && { label: "Open in Todoist", onSelect: () => openInNewTab(task.url) },
      { type: "separator" },
      { label: "Dismiss", onSelect: onDismissGhost },
    ].filter(Boolean);
  }

  if (isTodoist) {
    return [
      { label: "Edit task", onSelect: onEdit },
      !isComplete && { label: "Mark complete", onSelect: onComplete },
      { type: "separator" },
      task.url && { label: "Open in Todoist", onSelect: () => openInNewTab(task.url) },
    ].filter(Boolean);
  }

  // Canvas / manual CTM — spine statuses: incomplete, in_progress, complete
  const statusItems = [];
  if (task.status !== "incomplete") {
    statusItems.push({ label: "Mark incomplete", onSelect: () => onStatusChange("incomplete") });
  }
  if (task.status !== "in_progress") {
    statusItems.push({ label: "Mark in-progress", onSelect: () => onStatusChange("in_progress") });
  }
  if (task.status !== "complete") {
    statusItems.push({ label: "Mark complete", onSelect: () => onStatusChange("complete") });
  }

  const ctmUrl = `https://ctm.andysu.tech/#/event/${task.id}`;
  const openItems = [];
  if (isCanvas && task.url) {
    openItems.push({ label: "Open in Canvas", onSelect: () => openInNewTab(task.url) });
  }
  openItems.push({ label: "Open in CTM", onSelect: () => openInNewTab(ctmUrl) });

  return [
    ...statusItems,
    { type: "separator" },
    ...openItems,
  ];
}

export default function DeadlinesSection({ ctm, todoist, loaded, delay, style, className }) {
  const { expandedTask, setExpandedTask, handleCompleteTask, handleUpdateTaskStatus, handleAddTask, handleUpdateTask, handleDeleteTask, handleDismissGhost } = useDashboard();
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [addBtnHover, setAddBtnHover] = useState(false);
  const addBtnRef = useRef(null);
  const [menuState, setMenuState] = useState(null); // { task, x, y, rowEl }
  const [editingTask, setEditingTask] = useState(null); // { task, anchorRef }
  const ctmItems = (ctm?.upcoming || []).map(t => ({ ...t, _type: "ctm" }));
  const todoistItems = (todoist?.upcoming || []).map(t => ({ ...t, _type: "ctm" }));
  const allItems = [...ctmItems, ...todoistItems].sort((a, b) => {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return parseDueDate(a.due_date) - parseDueDate(b.due_date);
  });

  if (!allItems.length) return null;

  // Combined stats from both sources
  const ctmDueToday = ctm?.stats?.dueToday || 0;
  const todoistDueToday = todoist?.stats?.dueToday || 0;
  const totalDueToday = ctmDueToday + todoistDueToday;
  const totalIncomplete = (ctm?.stats?.incomplete || 0) + (todoist?.stats?.incomplete || 0);
  const ctmDueThisWeek = (ctm?.stats?.dueThisWeek || 0) + (todoist?.stats?.dueThisWeek || 0);

  return (
    <Section
      title="Deadlines"
      delay={delay}
      loaded={loaded}
      variant="band"
      style={style}
      className={className}
      summaryBadge={totalDueToday > 0 ? `${totalDueToday} due today` : `${totalIncomplete} total`}
      defaultExpanded={false}
      headerAction={
        <button
          ref={addBtnRef}
          onClick={() => setAddPanelOpen(v => !v)}
          onMouseEnter={() => setAddBtnHover(true)}
          onMouseLeave={() => setAddBtnHover(false)}
          style={{
            background: addPanelOpen ? "rgba(203,166,218,0.15)" : addBtnHover ? "rgba(203,166,218,0.12)" : "rgba(203,166,218,0.06)",
            border: addPanelOpen || addBtnHover ? "1px solid rgba(203,166,218,0.25)" : "1px solid rgba(203,166,218,0.12)",
            borderRadius: 6,
            padding: "4px 10px",
            cursor: "pointer",
            color: addPanelOpen || addBtnHover ? "#cba6da" : "rgba(203,166,218,0.6)",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.5px",
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            gap: 4,
            transition: "background 160ms, border-color 160ms, color 160ms, box-shadow 160ms",
            whiteSpace: "nowrap",
            boxShadow: addBtnHover && !addPanelOpen ? "0 2px 8px rgba(203,166,218,0.2)" : "none",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>+</span> Todoist
        </button>
      }
    >
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <div
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5"
          style={{ background: "rgba(205,214,244,0.04)", border: "1px solid rgba(205,214,244,0.08)" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(205,214,244,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span className="text-[11px] max-sm:text-xs font-semibold tabular-nums text-foreground/80">{totalIncomplete}</span>
          <span className="text-[11px] max-sm:text-xs text-muted-foreground/50">incomplete</span>
        </div>
        {totalDueToday > 0 && (
          <div
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5"
            style={{ background: "rgba(243,139,168,0.06)", border: "1px solid rgba(243,139,168,0.12)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f38ba8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="text-[11px] max-sm:text-xs font-semibold tabular-nums" style={{ color: "#f38ba8cc" }}>{totalDueToday}</span>
            <span className="text-[11px] max-sm:text-xs text-muted-foreground/50">due today</span>
          </div>
        )}
        {ctmDueThisWeek > 0 && (
          <div
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5"
            style={{ background: "rgba(249,226,175,0.05)", border: "1px solid rgba(249,226,175,0.1)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f9e2af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="text-[11px] max-sm:text-xs font-semibold tabular-nums" style={{ color: "#f9e2afcc" }}>{ctmDueThisWeek}</span>
            <span className="text-[11px] max-sm:text-xs text-muted-foreground/50">this week</span>
          </div>
        )}
      </div>
      <MotionList className="flex flex-col gap-1.5" loaded={loaded} delay={delay + 100} stagger={0.04}>
        {allItems.map((item) => {
          if (item._type === "ctm") {
            return (
              <MotionItem key={item._tombstone ? `ctm-${item.id}-ghost` : `ctm-${item.id}-${item.status}`}>
                <CTMCard
                  task={item}
                  expanded={!item._tombstone && expandedTask === item.id}
                  onToggle={
                    item._tombstone
                      ? () => {}
                      : () =>
                          setExpandedTask(
                            expandedTask === item.id ? null : item.id,
                          )
                  }
                  onComplete={handleCompleteTask}
                  onStatusChange={handleUpdateTaskStatus}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuState({
                      task: item,
                      x: e.clientX,
                      y: e.clientY,
                      rowEl: e.currentTarget,
                    });
                  }}
                />
              </MotionItem>
            );
          }
          return null;
        })}
      </MotionList>
      {addPanelOpen && !editingTask && (
        <AddTaskPanel
          anchorRef={addBtnRef}
          onClose={() => setAddPanelOpen(false)}
          onTaskAdded={(task) => handleAddTask(task)}
        />
      )}
      {editingTask && (
        <AddTaskPanel
          anchorRef={editingTask.anchorRef}
          editingTask={editingTask.task}
          onClose={() => setEditingTask(null)}
          onTaskUpdated={(task) => handleUpdateTask(task)}
          onTaskDeleted={(taskId) => {
            handleDeleteTask(taskId);
            setEditingTask(null);
          }}
        />
      )}
      {menuState && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          onClose={() => setMenuState(null)}
          items={buildTaskMenu(menuState.task, {
            onEdit: () => {
              const rowEl = menuState.rowEl;
              setEditingTask({
                task: menuState.task,
                anchorRef: { current: rowEl },
              });
            },
            onComplete: () => handleCompleteTask(menuState.task.id),
            onStatusChange: (status) =>
              handleUpdateTaskStatus(menuState.task.id, status),
            onDismissGhost: () => handleDismissGhost(menuState.task.id),
          })}
        />
      )}
    </Section>
  );
}
