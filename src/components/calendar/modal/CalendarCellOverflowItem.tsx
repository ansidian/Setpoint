import type { CSSProperties, RefObject } from "react";
import GoogleSpecialDateBadge from "../GoogleSpecialDateBadge.tsx";
import { isEventSelectionModifier } from "../events/calendarEventSelectionModel";
import { deadlineDragAllowed } from "../views/deadlines/calendarDeadlineRescheduleModel.ts";
import {
  CalendarChipRecurringIcon,
  CalendarChipReminderMarker,
  CalendarChipStatusIcon,
} from "./CalendarCellItemChip";
import { compactLeadingLabel } from "./CalendarCellItemChipModel";
import type { CalendarChipItem } from "./CalendarCellItemChip";
import type { CalendarCellQuickActions } from "./CalendarCell";
import type { CalendarGridFloatingAnchorMeta } from "./CalendarGrid";

interface CalendarOverflowItemInteraction {
  dateKey?: string | null;
  sourceCellElement?: Element | null;
  popoverRef: RefObject<HTMLDivElement | null>;
  quickActions?: CalendarCellQuickActions | null;
  onSelectItem?: (itemId: unknown, anchorMeta: CalendarGridFloatingAnchorMeta) => void;
  onBeforeItemAction?: () => boolean | void;
  onClose?: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
}

function itemButtonStyle({
  accent,
  selected,
  active,
  ghost,
  batchSelected = false,
  specialDate = false,
}: {
  accent: string;
  selected: boolean;
  active: boolean;
  ghost: boolean;
  batchSelected?: boolean;
  specialDate?: boolean;
}): CSSProperties {
  return {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 5,
    padding: "11px 12px",
    borderRadius: 10,
    border: specialDate && !ghost
      ? selected
        ? `1px solid color-mix(in srgb, ${accent} 42%, rgba(255,255,255,0.08))`
        : active
          ? `1px solid color-mix(in srgb, ${accent} 28%, rgba(255,255,255,0.08))`
          : `1px solid color-mix(in srgb, ${accent} 16%, rgba(255,255,255,0.045))`
      : ghost
      ? `1px dotted color-mix(in srgb, ${accent} 54%, transparent)`
      : batchSelected
      ? `1px solid color-mix(in srgb, ${accent} 68%, rgba(255,255,255,0.16))`
      : selected
      ? `1px solid color-mix(in srgb, ${accent} 42%, rgba(255,255,255,0.08))`
      : active
        ? "1px solid rgba(255,255,255,0.12)"
        : "1px solid rgba(255,255,255,0.05)",
    background: specialDate && !ghost
      ? selected
        ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 14%, rgba(255,255,255,0.02)), color-mix(in srgb, ${accent} 7%, rgba(22,22,30,0.18)))`
        : active
          ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 10%, rgba(255,255,255,0.02)), color-mix(in srgb, ${accent} 5%, rgba(22,22,30,0.12)))`
          : `linear-gradient(180deg, color-mix(in srgb, ${accent} 7%, rgba(255,255,255,0.018)), rgba(255,255,255,0.018))`
      : batchSelected
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 22%, transparent), color-mix(in srgb, ${accent} 9%, rgba(22,22,30,0.2)))`
      : selected
      ? `linear-gradient(180deg, color-mix(in srgb, ${accent} 14%, transparent), color-mix(in srgb, ${accent} 6%, transparent))`
      : active
        ? "rgba(255,255,255,0.062)"
        : "rgba(255,255,255,0.024)",
    boxShadow: specialDate && !ghost
      ? selected || active
        ? `inset 0 1px 0 color-mix(in srgb, ${accent} 16%, rgba(255,255,255,0.02))`
        : "none"
      : batchSelected
      ? `inset 0 0 0 1px color-mix(in srgb, ${accent} 28%, transparent), 0 0 0 1px rgba(255,255,255,0.035)`
      : active && !selected
      ? "inset 0 1px 0 rgba(255,255,255,0.04)"
      : "none",
    color: "#eef2ff",
    cursor: ghost ? "default" : "pointer",
    pointerEvents: ghost ? "none" : "auto",
    fontFamily: "inherit",
    textAlign: "left",
    transition: "border-color 140ms, background 140ms, box-shadow 140ms",
  };
}

function OverflowMetadata({ item, accent, leadingColumnWidth }: {
  item: CalendarChipItem;
  accent: string;
  leadingColumnWidth: number;
}) {
  if (!leadingColumnWidth || item.specialDate) return null;
  const color = item.leadingColor || accent;
  const preserveLeadingLabel = item.preserveLeadingLabel === true;

  return (
    <span
      style={{
        width: leadingColumnWidth,
        minWidth: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "center",
        maxWidth: leadingColumnWidth,
        overflow: "hidden",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.2,
        lineHeight: 1.05,
        color,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {item.leadingLabel ? (
        <span
          style={{
            minWidth: preserveLeadingLabel ? "max-content" : 0,
            overflow: preserveLeadingLabel ? "visible" : "hidden",
            textOverflow: preserveLeadingLabel ? "clip" : "ellipsis",
          }}
        >
          {compactLeadingLabel(item.leadingLabel)}
        </span>
      ) : null}
    </span>
  );
}

export default function CalendarCellOverflowItem({
  item,
  selected,
  active,
  leadingColumnWidth,
  interaction,
}: {
  item: CalendarChipItem;
  selected: boolean;
  active: boolean;
  leadingColumnWidth: number;
  interaction: CalendarOverflowItemInteraction;
}) {
  const itemId = String(item.id);
  const ghost = !!item.isGhost;
  const specialDate = item.specialDate === true;
  const accent = specialDate ? item.specialDateAccent || item.accent || "var(--ea-accent)" : item.accent || "var(--ea-accent)";
  const dragAllowed = !ghost && !!interaction.quickActions?.dragEnabled && !!item.writable && !!item.sourceEvent && !specialDate;
  const deadlineDragOk = !ghost && deadlineDragAllowed(item, !!interaction.quickActions?.deadlineDragEnabled);
  const batchSelected = !specialDate && !!interaction.quickActions?.isEventSelectionSelected?.(item.sourceEvent || item.sourceItem);
  const Shell = (ghost ? "div" : "button") as "button";

  return (
    <Shell
      type={ghost ? undefined : "button"}
      data-testid={ghost ? "calendar-ghost-chip" : "calendar-cell-overflow-item"}
      data-item-id={itemId}
      data-date-key={interaction.dateKey || undefined}
      data-hovered={active ? "true" : "false"}
      data-calendar-event-selection={batchSelected ? "true" : undefined}
      data-calendar-event-activation="true"
      draggable={dragAllowed || deadlineDragOk}
      onClick={(event) => {
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        if (isEventSelectionModifier(event)) {
          event.preventDefault();
          interaction.quickActions?.toggleEventSelection?.({
            event: item.sourceEvent || item.sourceItem,
            dateKey: interaction.dateKey || null,
            anchorElement: event.currentTarget,
            sourceCellElement: interaction.sourceCellElement || null,
            exclusionElement: interaction.popoverRef.current,
            anchorKind: "overflow-row",
          });
          return;
        }
        interaction.onSelectItem?.(item.id, {
          triggerElement: event.currentTarget,
          sourceCellElement: interaction.sourceCellElement || null,
          exclusionElement: interaction.popoverRef.current,
          dateKey: interaction.dateKey || null,
          anchorKind: "overflow-row",
          detailKind: item.detailKind || null,
          itemsSnapshot: item.sourceItem || item.sourceEvent ? [item.sourceItem || item.sourceEvent] : null,
        });
      }}
      onContextMenu={(event) => {
        if (specialDate) return;
        if (interaction.quickActions?.openContextMenu?.({
          item,
          task: item.sourceItem,
          x: event.clientX,
          y: event.clientY,
          anchorElement: event.currentTarget,
          sourceCellElement: interaction.sourceCellElement || null,
          exclusionElement: interaction.popoverRef.current,
          dateKey: interaction.dateKey || null,
          anchorKind: "overflow-row",
        })) {
          event.preventDefault();
          event.stopPropagation();
          interaction.onBeforeItemAction?.();
          return;
        }
        if (!item.sourceEvent?.writable) return;
        event.preventDefault();
        event.stopPropagation();
        interaction.onBeforeItemAction?.();
        interaction.quickActions?.openDeleteMenu?.({
          event: item.sourceEvent,
          x: event.clientX,
          y: event.clientY,
        });
      }}
      onDragStart={(event) => {
        if (deadlineDragOk) {
          if (!interaction.quickActions?.beginDeadlineDrag?.(item.sourceItem)) {
            event.preventDefault();
            return;
          }
          interaction.onBeforeItemAction?.();
          interaction.onClose?.();
          event.stopPropagation();
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-ea-calendar-deadline", JSON.stringify(item.sourceItem));
          event.dataTransfer.setData("text/plain", String(item.title || ""));
          return;
        }
        if (!dragAllowed || !interaction.quickActions?.beginDrag?.(item.sourceEvent)) {
          event.preventDefault();
          return;
        }
        interaction.onBeforeItemAction?.();
        interaction.onClose?.();
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-ea-calendar-event", JSON.stringify(item.sourceEvent));
        event.dataTransfer.setData("text/plain", String(item.title || ""));
      }}
      onDragEnd={() => {
        interaction.quickActions?.endDrag?.();
        interaction.quickActions?.endDeadlineDrag?.();
      }}
      onPointerEnter={interaction.onActivate}
      onPointerLeave={interaction.onDeactivate}
      onFocus={interaction.onActivate}
      onBlur={interaction.onDeactivate}
      style={{
        ...itemButtonStyle({ accent, selected, active, ghost, batchSelected, specialDate }),
        display: "grid",
        gridTemplateColumns: specialDate
          ? "28px minmax(0, 1fr)"
          : leadingColumnWidth ? `${leadingColumnWidth}px minmax(0, 1fr)` : "minmax(0, 1fr)",
        alignItems: "center",
        columnGap: specialDate ? 8 : leadingColumnWidth ? 8 : 0,
      }}
    >
      <CalendarChipReminderMarker item={item} />
      {specialDate ? (
        <GoogleSpecialDateBadge
          item={item}
          color={item.specialDateAccent || accent}
          selected={selected}
          active={active}
          variant="agenda"
        />
      ) : (
        <OverflowMetadata item={item} accent={accent} leadingColumnWidth={leadingColumnWidth} />
      )}
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12.5,
            fontWeight: 500,
            lineHeight: 1.25,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <CalendarChipStatusIcon item={item} selected={selected} metrics={{ itemHeight: 36 }} />
          <CalendarChipRecurringIcon item={item} selected={selected} metrics={{ itemHeight: 36 }} />
          <span
            style={{
              minWidth: 0,
              flex: "1 1 auto",
              overflow: "hidden",
              textOverflow: specialDate ? "clip" : "ellipsis",
              whiteSpace: specialDate ? "normal" : "nowrap",
              display: specialDate ? "-webkit-box" : "block",
              WebkitLineClamp: specialDate ? 2 : undefined,
              WebkitBoxOrient: specialDate ? "vertical" : undefined,
              textDecoration: item.complete ? "line-through" : "none",
              textDecorationColor: "rgba(205,214,244,0.28)",
            }}
          >
            {item.title}
          </span>
        </span>
        {item.detail ? (
          <span
            style={{
              fontSize: 10.5,
              lineHeight: 1.4,
              color: "rgba(205,214,244,0.56)",
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
          >
            {item.detail}
          </span>
        ) : null}
      </span>
    </Shell>
  );
}
