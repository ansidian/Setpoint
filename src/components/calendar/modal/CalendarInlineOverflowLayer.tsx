import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { CURRENT_MONTH_BOUNDARY_COLOR } from "./calendarGridUtils";
import GoogleSpecialDateBadge from "../GoogleSpecialDateBadge.tsx";
import {
  CalendarChipRecurringIcon,
  CalendarChipStatusIcon,
} from "./CalendarCellItemChip";
import { compactLeadingLabel, getChipLeadingColumnWidth } from "./CalendarCellItemChipModel";
import { deadlineDragAllowed } from "../views/deadlines/calendarDeadlineRescheduleModel.ts";
import { isEventSelectionModifier } from "../events/calendarEventSelectionModel";
import type { CalendarChipItem, CalendarItemQuickActions } from "./CalendarCellItemChip";
import type { CalendarGridOverflowState } from "./useCalendarGridOverflow";

type CalendarInlineOverflowState = Partial<CalendarGridOverflowState> & Pick<
  CalendarGridOverflowState,
  "inlineAnchor" | "dateKey" | "items"
>;

function inlineOverflowItemStyle({ item, selected, active, batchSelected = false }: {
  item: CalendarChipItem;
  selected: boolean;
  active: boolean;
  batchSelected?: boolean;
}): CSSProperties {
  const specialDate = item.specialDate === true;
  const accent = specialDate ? item.specialDateAccent || item.accent || "var(--ea-accent)" : item.accent || "var(--ea-accent)";
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
    border: specialDate
      ? selected
        ? `1px solid color-mix(in srgb, ${accent} 42%, rgba(255,255,255,0.08))`
        : active
          ? `1px solid color-mix(in srgb, ${accent} 28%, rgba(255,255,255,0.08))`
          : `1px solid color-mix(in srgb, ${accent} 16%, rgba(255,255,255,0.045))`
      : batchSelected
      ? `1px solid color-mix(in srgb, ${accent} 68%, rgba(255,255,255,0.16))`
      : selected
      ? `1px solid color-mix(in srgb, ${accent} 48%, rgba(255,255,255,0.08))`
      : active
        ? "1px solid rgba(255,255,255,0.12)"
        : quiet
          ? "1px solid rgba(255,255,255,0.035)"
          : "1px solid rgba(255,255,255,0.045)",
    background: specialDate
      ? selected
        ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 14%, rgba(255,255,255,0.02)), color-mix(in srgb, ${accent} 7%, rgba(22,22,30,0.18)))`
        : active
          ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 10%, rgba(255,255,255,0.02)), color-mix(in srgb, ${accent} 5%, rgba(22,22,30,0.12)))`
          : `linear-gradient(180deg, color-mix(in srgb, ${accent} 7%, rgba(255,255,255,0.018)), rgba(255,255,255,0.018))`
      : batchSelected
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 24%, transparent), color-mix(in srgb, ${accent} 10%, rgba(22,22,30,0.2)))`
      : selected
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 18%, transparent), color-mix(in srgb, ${accent} 8%, transparent))`
      : active
        ? "rgba(255,255,255,0.065)"
        : quiet
          ? "rgba(255,255,255,0.018)"
          : "rgba(255,255,255,0.03)",
    color: selected || batchSelected ? "#f6f7fb" : quiet ? "var(--color-text-faint)" : "rgba(205,214,244,0.78)",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    transition: "background 140ms, border-color 140ms, color 140ms",
  };
}

function InlineOverflowPrefix({ item, selected, leadingColumnWidth }: {
  item: CalendarChipItem;
  selected: boolean;
  leadingColumnWidth: number;
}) {
  if (!leadingColumnWidth || item.specialDate) return null;
  const color = selected
    ? item.leadingColor || item.accent || "var(--ea-accent)"
    : item.leadingColor || "rgba(205,214,244,0.62)";
  const compactLabel = compactLeadingLabel(item.leadingLabel);
  const preserveLeadingLabel = item.preserveLeadingLabel === true;
  return (
    <span
      data-calendar-chip-meta="true"
      style={{
        flex: "0 0 auto",
        width: leadingColumnWidth,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "stretch",
        maxWidth: leadingColumnWidth,
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
        <span
          style={{
            minWidth: preserveLeadingLabel ? "max-content" : 0,
            maxWidth: preserveLeadingLabel ? "none" : "inherit",
            overflow: preserveLeadingLabel ? "visible" : "hidden",
            textOverflow: preserveLeadingLabel ? "clip" : "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {compactLabel}
        </span>
      ) : null}
    </span>
  );
}

function InlineOverflowChipContent({ item, selected, leadingColumnWidth }: {
  item: CalendarChipItem;
  selected: boolean;
  leadingColumnWidth: number;
}) {
  const specialDate = item.specialDate === true;
  const length = [specialDate ? "" : compactLeadingLabel(item.leadingLabel), item.title].filter(Boolean).join(" ").length;
  const fontSize = length <= 22 ? 11 : length <= 58 ? 10.5 : 10;
  const lineClamp = specialDate ? 2 : length <= 22 ? 1 : 2;
  const lineHeight = 1.08;
  const maxHeight = Number((fontSize * lineHeight * lineClamp).toFixed(2));
  const TitleTag = item.complete ? "s" : "span";
  const titleClampStyle: CSSProperties = lineClamp > 1
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
        display: "grid",
        gridTemplateColumns: specialDate
          ? "24px minmax(0, 1fr)"
          : leadingColumnWidth ? `${leadingColumnWidth}px minmax(0, 1fr)` : "minmax(0, 1fr)",
        alignItems: "center",
        columnGap: specialDate ? 6 : leadingColumnWidth ? 5 : 0,
        maxHeight,
        overflow: "hidden",
        fontSize,
        fontWeight: 500,
        lineHeight,
      }}
    >
      <InlineOverflowPrefix
        item={item}
        selected={selected}
        leadingColumnWidth={leadingColumnWidth}
      />
      {specialDate ? (
        <GoogleSpecialDateBadge
          item={item}
          color={item.specialDateAccent || item.accent}
          selected={selected}
          variant="chip"
        />
      ) : null}
      <span
        style={{
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 4,
          maxHeight,
          overflow: "hidden",
        }}
      >
        <CalendarChipStatusIcon item={item} selected={selected} metrics={{ itemHeight: 36 }} />
        <CalendarChipRecurringIcon item={item} selected={selected} metrics={{ itemHeight: 36 }} />
        <TitleTag
          data-calendar-chip-title-text="true"
          style={{
            minWidth: 0,
            flex: "1 1 auto",
            maxHeight,
            overflow: "hidden",
            ...titleClampStyle,
            textDecorationColor: "rgba(205,214,244,0.28)",
          }}
        >
          {item.title}
        </TitleTag>
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
}: {
  overflow: CalendarInlineOverflowState | null;
  selectedItemId?: unknown;
  onSelectItem?: (itemId: unknown, meta: Record<string, unknown>) => void;
  onInteraction?: () => void;
  quickActions?: CalendarItemQuickActions | null;
  onBeforeItemAction?: () => void;
}) {
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);

  if (!overflow?.inlineAnchor || !overflow.items?.length) return null;
  const boundaryColor = overflow.boundaryColor || CURRENT_MONTH_BOUNDARY_COLOR;
  const drawBottomBoundary =
    overflow.carryBoundaryToBottom === true
    || overflow.boundarySides?.includes?.("bottom");
  const leadingColumnWidth = overflow.leadingColumnWidth ?? getChipLeadingColumnWidth(overflow.items);

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
      onKeyDown={(event) => {
        const isSpaceKey = event.key === " " || event.code === "Space";
        if (
          isSpaceKey
          && event.target instanceof HTMLElement
          && event.target.closest("[data-calendar-event-activation='true']")
        ) {
          return;
        }
        event.stopPropagation();
      }}
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
        background: "var(--sp-panel)",
        boxShadow: "0 18px 42px rgba(0,0,0,0.45)",
        pointerEvents: "auto",
        isolation: "isolate",
        animation: "calendarInlineOverflowIn 150ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {overflow.items.map((item) => {
        const itemId = String(item.id);
        const selected = itemId === String(selectedItemId);
        const specialDate = item.specialDate === true;
        const batchSelected = !specialDate && !!quickActions?.isEventSelectionSelected?.(item.sourceEvent || item.sourceItem);
        const active = itemId === String(activeItemId);
        const dragAllowed = !!quickActions?.dragEnabled && !!item.writable && !!item.sourceEvent && !specialDate;
        const deadlineDragOk = !item.isGhost && deadlineDragAllowed(item, !!quickActions?.deadlineDragEnabled);
        return (
          <button
            key={item.id}
            type="button"
            data-testid="calendar-cell-item-chip"
            data-inline-overflow-item="true"
            data-item-id={itemId}
            data-date-key={overflow.dateKey || undefined}
            data-hovered={active ? "true" : "false"}
            data-calendar-event-selection={batchSelected ? "true" : undefined}
            data-calendar-event-activation="true"
            draggable={dragAllowed || deadlineDragOk}
            data-calendar-focus-ring="true"
            onClick={(event) => {
              event.stopPropagation();
              const target = event.currentTarget;
              target.focus({ preventScroll: true });
              if (isEventSelectionModifier(event)) {
                event.preventDefault();
                quickActions?.toggleEventSelection?.({
                  event: item.sourceEvent || item.sourceItem,
                  dateKey: overflow.dateKey || null,
                  anchorElement: event.currentTarget,
                  sourceCellElement: overflow.sourceCellElement || null,
                  exclusionElement: layerRef.current,
                  anchorKind: "overflow-row",
                });
                return;
              }
              onSelectItem?.(item.id, {
                triggerElement: target,
                sourceCellElement: overflow.sourceCellElement || null,
                exclusionElement: layerRef.current,
                dateKey: overflow.dateKey || null,
                anchorKind: "overflow-row",
                detailKind: item.detailKind || null,
                itemsSnapshot: item.sourceItem || item.sourceEvent ? [item.sourceItem || item.sourceEvent] : null,
              });
            }}
            onContextMenu={(event) => {
              if (specialDate) return;
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
              if (deadlineDragOk) {
                if (!quickActions?.beginDeadlineDrag?.(item.sourceItem)) {
                  event.preventDefault();
                  return;
                }
                onBeforeItemAction?.();
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-ea-calendar-deadline", JSON.stringify(item.sourceItem));
                event.dataTransfer.setData("text/plain", String(item.title || ""));
                return;
              }
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
            onDragEnd={() => {
              quickActions?.endDrag?.();
              quickActions?.endDeadlineDrag?.();
            }}
            onPointerEnter={() => setActiveItemId(itemId)}
            onPointerLeave={() => setActiveItemId((current) => (current === itemId ? null : current))}
            onFocus={() => setActiveItemId(itemId)}
            onBlur={() => setActiveItemId((current) => (current === itemId ? null : current))}
            style={inlineOverflowItemStyle({ item, selected, active, batchSelected })}
          >
            <InlineOverflowChipContent
              item={item}
              selected={selected}
              leadingColumnWidth={leadingColumnWidth}
            />
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
