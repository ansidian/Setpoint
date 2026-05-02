import { useRef, useState } from "react";
import { Repeat } from "lucide-react";
import { CURRENT_MONTH_BOUNDARY_COLOR } from "./calendarGridUtils.js";

function inlineOverflowItemStyle({ item, selected, active }) {
  const accent = item.accent || "var(--ea-accent)";
  const quiet = item.complete || item.quiet;
  return {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 0,
    height: 36,
    minWidth: 0,
    boxSizing: "border-box",
    padding: "4px 10px",
    overflow: "hidden",
    borderRadius: 10,
    border: selected
      ? `1px solid color-mix(in srgb, ${accent} 48%, rgba(255,255,255,0.08))`
      : active
        ? "1px solid rgba(255,255,255,0.12)"
        : quiet
          ? "1px solid rgba(255,255,255,0.035)"
          : "1px solid rgba(255,255,255,0.045)",
    background: selected
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 18%, transparent), color-mix(in srgb, ${accent} 8%, transparent))`
      : active
        ? "rgba(255,255,255,0.065)"
        : quiet
          ? "rgba(255,255,255,0.018)"
          : "rgba(255,255,255,0.03)",
    color: selected ? "#f6f7fb" : quiet ? "rgba(205,214,244,0.52)" : "rgba(205,214,244,0.78)",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    transition: "background 140ms, border-color 140ms, color 140ms",
  };
}

function compactInlineOverflowLabel(value) {
  const label = String(value || "").trim();
  const timeMatch = label.match(/^(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?$/i);
  if (!timeMatch) return label;
  const hour = timeMatch[1];
  const minute = timeMatch[2];
  const suffix = timeMatch[3].toLowerCase();
  return minute && minute !== "00" ? `${hour}:${minute}${suffix}` : `${hour}${suffix}`;
}

function InlineOverflowPrefix({ item, selected }) {
  if (!item.leadingLabel && !item.recurring) return null;
  const color = selected
    ? item.leadingColor || item.accent || "var(--ea-accent)"
    : item.leadingColor || "rgba(205,214,244,0.62)";
  const compactLabel = compactInlineOverflowLabel(item.leadingLabel);
  return (
    <span
      data-calendar-chip-meta="true"
      style={{
        minWidth: 0,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        maxWidth: "100%",
        overflow: "hidden",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.15,
        lineHeight: 1,
        color,
        fontVariantNumeric: "tabular-nums",
        marginRight: 4,
        verticalAlign: "baseline",
      }}
    >
      {item.leadingLabel ? (
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {compactLabel}
        </span>
      ) : null}
      {item.recurring ? (
        <Repeat
          aria-hidden="true"
          size={10}
          strokeWidth={2.4}
          style={{ flexShrink: 0, color, opacity: selected ? 0.86 : 0.7 }}
        />
      ) : null}
    </span>
  );
}

function InlineOverflowChipContent({ item, selected }) {
  const length = [compactInlineOverflowLabel(item.leadingLabel), item.title].filter(Boolean).join(" ").length;
  const fontSize = length <= 22 ? 11 : length <= 58 ? 10.5 : 10;
  const lineClamp = length <= 22 ? 1 : 2;
  const lineHeight = 1.08;
  const maxHeight = Number((fontSize * lineHeight * lineClamp).toFixed(2));
  const clampStyle = lineClamp > 1
    ? {
        display: "-webkit-box",
        WebkitLineClamp: lineClamp,
        WebkitBoxOrient: "vertical",
        overflowWrap: "break-word",
        whiteSpace: "normal",
      }
    : {
        display: "block",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      };

  return (
    <span
      data-calendar-chip-content="true"
      data-calendar-chip-title="true"
      data-calendar-chip-title-fit={`${fontSize}/${lineClamp}`}
      style={{
        minWidth: 0,
        maxHeight,
        overflow: "hidden",
        ...clampStyle,
        fontSize,
        fontWeight: selected ? 600 : 500,
        lineHeight,
      }}
    >
      <InlineOverflowPrefix item={item} selected={selected} />
      <span
        data-calendar-chip-title-text="true"
        style={{
          textDecoration: item.complete ? "line-through" : "none",
          textDecorationColor: "rgba(205,214,244,0.28)",
        }}
      >
        {item.title}
      </span>
    </span>
  );
}

export default function CalendarInlineOverflowLayer({
  overflow,
  selectedItemId,
  onSelectItem,
  onInteraction,
  quickActions,
  onBeforeItemAction,
}) {
  const [activeItemId, setActiveItemId] = useState(null);
  const layerRef = useRef(null);

  if (!overflow?.inlineAnchor || !overflow.items?.length) return null;
  const boundaryColor = overflow.boundaryColor || CURRENT_MONTH_BOUNDARY_COLOR;
  const drawBottomBoundary = overflow.boundarySides?.includes?.("bottom");

  return (
    <div
      ref={layerRef}
      data-testid="calendar-cell-inline-overflow"
      data-calendar-inline-overflow-layer="true"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        onInteraction?.();
        event.stopPropagation();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        top: overflow.inlineAnchor.top,
        left: overflow.inlineAnchor.left,
        width: overflow.inlineAnchor.width,
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
        padding: "4px",
        borderRadius: "0 0 10px 10px",
        border: "1px solid rgba(255,255,255,0.08)",
        borderTop: 0,
        background: "#16161e",
        boxShadow: "0 18px 42px rgba(0,0,0,0.45)",
        pointerEvents: "auto",
        isolation: "isolate",
        animation: "calendarInlineOverflowIn 150ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {overflow.items.map((item) => {
        const itemId = String(item.id);
        const selected = itemId === String(selectedItemId);
        const active = itemId === String(activeItemId);
        const dragAllowed = !!quickActions?.dragEnabled && !!item.writable && !!item.sourceEvent;
        return (
          <button
            key={item.id}
            type="button"
            data-testid="calendar-cell-item-chip"
            data-inline-overflow-item="true"
            data-item-id={itemId}
            data-hovered={active ? "true" : "false"}
            draggable={dragAllowed}
            data-calendar-focus-ring="true"
            onClick={(event) => {
              event.stopPropagation();
              onSelectItem?.(item.id, {
                triggerElement: event.currentTarget,
                sourceCellElement: overflow.sourceCellElement || null,
                exclusionElement: layerRef.current,
                dateKey: overflow.dateKey || null,
                anchorKind: "overflow-row",
                itemsSnapshot: item.sourceItem || item.sourceEvent ? [item.sourceItem || item.sourceEvent] : null,
              });
            }}
            onContextMenu={(event) => {
              if (quickActions?.openContextMenu?.({
                item,
                task: item.sourceItem,
                x: event.clientX,
                y: event.clientY,
                anchorElement: event.currentTarget,
                sourceCellElement: overflow.sourceCellElement || null,
                exclusionElement: layerRef.current,
                dateKey: overflow.dateKey || null,
                anchorKind: "overflow-row",
              })) {
                event.preventDefault();
                event.stopPropagation();
                onBeforeItemAction?.();
                return;
              }
              if (!item.sourceEvent?.writable) return;
              event.preventDefault();
              event.stopPropagation();
              onBeforeItemAction?.();
              quickActions?.openDeleteMenu?.({
                event: item.sourceEvent,
                x: event.clientX,
                y: event.clientY,
              });
            }}
            onDragStart={(event) => {
              if (!dragAllowed || !quickActions?.beginDrag?.(item.sourceEvent)) {
                event.preventDefault();
                return;
              }
              onBeforeItemAction?.();
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-ea-calendar-event", JSON.stringify(item.sourceEvent));
              event.dataTransfer.setData("text/plain", String(item.title || ""));
            }}
            onDragEnd={() => quickActions?.endDrag?.()}
            onPointerEnter={() => setActiveItemId(itemId)}
            onPointerLeave={() => setActiveItemId((current) => (current === itemId ? null : current))}
            onFocus={() => setActiveItemId(itemId)}
            onBlur={() => setActiveItemId((current) => (current === itemId ? null : current))}
            style={inlineOverflowItemStyle({ item, selected, active })}
          >
            <InlineOverflowChipContent item={item} selected={selected} />
          </button>
        );
      })}
      {drawBottomBoundary ? (
        <span
          aria-hidden="true"
          data-calendar-inline-overflow-boundary="bottom"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 2,
            background: boundaryColor,
            borderBottomLeftRadius: 8,
            borderBottomRightRadius: 8,
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
}
