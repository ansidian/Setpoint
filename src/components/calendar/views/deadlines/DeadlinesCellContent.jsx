/* eslint-disable react-refresh/only-export-components */
import { MAX_PILLS, getDayState, SOURCE_COLORS, sourceOf } from "./deadlinesModel.js";

export function renderDeadlinesCellContents({ items }) {
  const state = getDayState(items);

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
    </>
  );
}
