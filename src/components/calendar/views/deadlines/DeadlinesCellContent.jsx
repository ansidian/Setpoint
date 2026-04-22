/* eslint-disable react-refresh/only-export-components */
import { Check } from "lucide-react";
import { MAX_PILLS, getDayState, SOURCE_COLORS, sourceOf } from "./deadlinesModel.js";

function CompletedCount({ count }) {
  if (!count) return null;
  return (
    <div
      style={{
        marginTop: 4,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        color: "rgba(166,227,161,0.55)",
        letterSpacing: 0.2,
      }}
    >
      <Check size={10} />
      <span>{count}</span>
    </div>
  );
}

function CompletedPreview({ task, count }) {
  const source = sourceOf(task);
  const dot = SOURCE_COLORS[source] || "rgba(255,255,255,0.3)";

  return (
    <div
      style={{
        marginTop: 4,
        display: "flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dot,
          opacity: 0.6,
          boxShadow: `0 0 4px ${dot}30`,
        }}
      />
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "rgba(205,214,244,0.42)",
          fontSize: 11,
          textDecoration: "line-through",
          textDecorationColor: "rgba(205,214,244,0.2)",
        }}
      >
        {task.title || task.name || "Untitled"}
      </span>
      {count > 1 && <CompletedCount count={count} />}
    </div>
  );
}

export function renderDeadlinesCellContents({ items }) {
  const state = getDayState(items);
  const completedPreview = state.activeCount === 0 ? state.completedItems[0] : null;

  return (
    <>
      {state.activeItems.slice(0, MAX_PILLS).map((task) => {
        const source = sourceOf(task);
        const dot = SOURCE_COLORS[source] || "rgba(255,255,255,0.3)";
        return (
          <div
            key={`${source}-${task.id}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              marginTop: 3,
              minWidth: 0,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: dot,
                opacity: 0.9,
                boxShadow: `0 0 4px ${dot}60`,
              }}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
                color: "rgba(205,214,244,0.55)",
              }}
            >
              {task.title || task.name || "Untitled"}
            </span>
          </div>
        );
      })}
      {state.activeCount > MAX_PILLS && (
        <div style={{ fontSize: 10, color: "rgba(203,166,218,0.6)", marginTop: 2 }}>
          +{state.activeCount - MAX_PILLS} more
        </div>
      )}
      {completedPreview ? (
        <CompletedPreview task={completedPreview} count={state.completedCount} />
      ) : (
        <CompletedCount count={state.completedCount} />
      )}
    </>
  );
}
