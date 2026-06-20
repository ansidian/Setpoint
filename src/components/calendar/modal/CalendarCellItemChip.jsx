import { CheckCircle2, CircleDashed, Repeat } from "lucide-react";
import { useReducedMotion } from "motion/react";
import GoogleSpecialDateBadge from "../GoogleSpecialDateBadge.jsx";
import { compactLeadingLabel } from "./CalendarCellItemChipModel.js";
import { hasUpcomingReminder } from "../reminderDisplay.js";

function chipStyle({
  item,
  selected,
  batchSelected = false,
  pastTone,
  active,
  metrics,
}) {
  const ghost = !!item.isGhost;
  const specialDate = item.specialDate === true;
  const accent = specialDate ? item.specialDateAccent || item.accent || "var(--ea-accent)" : item.accent || "var(--ea-accent)";
  const isPast = pastTone === "items";
  const quiet = item.complete || item.quiet;
  const hasMetadata = !!(item.leadingLabel || item.recurring || specialDate);
  const itemHeight = metrics?.itemHeight ?? 24;
  const isLarge = itemHeight >= 28;
  const isMedium = itemHeight >= 26;
  const horizontalPadding = itemHeight >= 36 ? 10 : isLarge ? 9 : isMedium ? 8 : 7;
  const verticalPadding = itemHeight >= 36 ? 4 : itemHeight >= 32 ? 3 : hasMetadata ? 2 : 0;
  const radius = isLarge ? 10 : isMedium ? 9 : 8;

  return {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "center",
    gap: 0,
    minWidth: 0,
    boxSizing: "border-box",
    overflow: "hidden",
    padding: hasMetadata
      ? `${verticalPadding}px ${horizontalPadding}px`
      : `0 ${horizontalPadding}px`,
    height: itemHeight,
    borderRadius: radius,
    border: specialDate && !ghost
      ? batchSelected
        ? `1px solid color-mix(in srgb, ${accent} 58%, rgba(255,255,255,0.13))`
        : selected
          ? `1px solid color-mix(in srgb, ${accent} 42%, rgba(255,255,255,0.08))`
          : active
            ? `1px solid color-mix(in srgb, ${accent} 28%, rgba(255,255,255,0.08))`
            : `1px solid color-mix(in srgb, ${accent} 16%, rgba(255,255,255,0.045))`
      : ghost
      ? `1px dotted color-mix(in srgb, ${accent} 54%, transparent)`
      : batchSelected
      ? `1px solid color-mix(in srgb, ${accent} 68%, rgba(255,255,255,0.16))`
      : selected
      ? `1px solid color-mix(in srgb, ${accent} 48%, rgba(255,255,255,0.08))`
      : active
        ? "1px solid rgba(255,255,255,0.12)"
      : quiet
        ? "1px solid rgba(255,255,255,0.035)"
        : "1px solid rgba(255,255,255,0.045)",
    background: specialDate && !ghost
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
    boxShadow: specialDate && !ghost
      ? selected || active
        ? `inset 0 1px 0 color-mix(in srgb, ${accent} 16%, rgba(255,255,255,0.02))`
        : "none"
      : batchSelected
      ? `inset 0 0 0 1px color-mix(in srgb, ${accent} 30%, transparent), 0 0 0 1px rgba(255,255,255,0.035)`
      : selected
      ? `inset 0 1px 0 color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.02))`
      : active
        ? "inset 0 1px 0 rgba(255,255,255,0.04)"
        : "none",
    color: selected || batchSelected ? "#f6f7fb" : quiet ? "var(--color-text-faint)" : "rgba(205,214,244,0.78)",
    cursor: ghost ? "default" : "pointer",
    pointerEvents: ghost ? "none" : "auto",
    opacity: isPast ? (selected ? 0.92 : 0.82) : quiet ? 0.88 : 1,
    transition: "background 140ms, border-color 140ms, opacity 140ms, box-shadow 140ms, color 140ms",
    fontFamily: "inherit",
    textAlign: "left",
  };
}

export function CalendarChipReminderMarker({ item }) {
  if (!hasUpcomingReminder(item)) return null;
  return (
    <span
      data-calendar-chip-reminder-marker="true"
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 4,
        right: 5,
        width: 5,
        height: 5,
        borderRadius: 999,
        background: "var(--sp-cream)",
        boxShadow: "0 0 0 2px color-mix(in srgb, var(--sp-cream) 12%, transparent)",
        pointerEvents: "none",
      }}
    />
  );
}

function metadataFontSize(metrics) {
  const itemHeight = metrics?.itemHeight ?? 24;
  if (itemHeight >= 36) return 9;
  if (itemHeight >= 32) return 8.75;
  if (itemHeight >= 28) return 9.25;
  return 9;
}

function chipContentFit(item, metrics) {
  const itemHeight = metrics?.itemHeight ?? 24;
  const compactLabel = compactLeadingLabel(item.leadingLabel);
  const length = [compactLabel, item.title].filter(Boolean).join(" ").trim().length;
  const specialDate = item.specialDate === true;

  if (itemHeight >= 36) {
    if (specialDate) return { fontSize: length <= 58 ? 10.5 : 10, lineHeight: 1.08, lineClamp: 2 };
    if (length <= 22) return { fontSize: 11, lineHeight: 1.08, lineClamp: 1 };
    if (length <= 58) return { fontSize: 10.5, lineHeight: 1.08, lineClamp: 2 };
    return { fontSize: 10, lineHeight: 1.08, lineClamp: 2 };
  }
  if (specialDate && itemHeight >= 32) return { fontSize: 10, lineHeight: 1.06, lineClamp: 2 };
  if (itemHeight >= 32) return { fontSize: length <= 22 ? 10.5 : 10, lineHeight: 1.06, lineClamp: length <= 22 ? 1 : 2 };
  if (itemHeight >= 28) return { fontSize: 10.5, lineHeight: 1.05, lineClamp: 1 };
  if (itemHeight >= 26) return { fontSize: 10.25, lineHeight: 1.05, lineClamp: 1 };
  return { fontSize: 10, lineHeight: 1.05, lineClamp: 1 };
}

function metadataColor(item, selected) {
  if (selected) return item.leadingColor || item.accent || "var(--ea-accent)";
  return item.leadingColor || "rgba(205,214,244,0.62)";
}

function isEventSelectionModifier(event) {
  return !!(event?.metaKey || event?.ctrlKey);
}

export function CalendarChipStatusIcon({ item, selected, metrics }) {
  if (!item.statusIcon) return null;
  const itemHeight = metrics?.itemHeight ?? 24;
  const size = itemHeight >= 36 ? 11 : 10;
  const statusColor = item.statusIcon === "complete"
    ? "var(--sp-green)"
    : item.statusIcon === "in_progress"
      ? "var(--sp-cyan)"
      : metadataColor(item, selected);
  const Icon = item.statusIcon === "complete" ? CheckCircle2 : CircleDashed;

  return (
    <Icon
      data-calendar-chip-status-icon={item.statusIcon}
      aria-hidden="true"
      focusable="false"
      size={size}
      strokeWidth={2.4}
      style={{
        flex: "0 0 auto",
        color: statusColor,
        verticalAlign: "-0.12em",
      }}
    />
  );
}

export function CalendarChipRecurringIcon({ item, selected, metrics }) {
  if (!item.recurring || item.specialDate) return null;
  const itemHeight = metrics?.itemHeight ?? 24;
  const color = metadataColor(item, selected);

  return (
    <Repeat
      data-calendar-chip-recurring="true"
      aria-hidden="true"
      size={itemHeight >= 36 ? 10 : 9}
      strokeWidth={2.4}
      style={{
        flex: "0 0 auto",
        color,
        opacity: selected ? 0.86 : 0.7,
      }}
    />
  );
}

function ChipPrefix({ item, selected, metrics, leadingColumnWidth }) {
  if (!leadingColumnWidth || item.specialDate) return null;
  const color = metadataColor(item, selected);
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
        fontSize: metadataFontSize(metrics),
        fontWeight: 700,
        letterSpacing: 0.15,
        lineHeight: 1,
        color,
        fontVariantNumeric: "tabular-nums",
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

function ChipContent({ item, selected, metrics, leadingColumnWidth = 0 }) {
  const fit = chipContentFit(item, metrics);
  const TitleTag = item.complete ? "s" : "span";
  const specialDate = item.specialDate === true;
  const specialDateColumnWidth = (metrics?.itemHeight ?? 24) >= 36 ? 24 : 22;
  const lineHeightPx = Number((fit.fontSize * fit.lineHeight).toFixed(2));
  const maxHeight = Number((lineHeightPx * fit.lineClamp).toFixed(2));
  const titleClampStyle = fit.lineClamp > 1
    ? {
        display: "-webkit-box",
        WebkitLineClamp: fit.lineClamp,
        WebkitBoxOrient: "vertical",
        overflowWrap: "break-word",
        wordBreak: "normal",
        whiteSpace: "normal",
      }
    : {
        display: "block",
        overflowWrap: "normal",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        wordBreak: "normal",
      };

  return (
    <span
      data-calendar-chip-content="true"
      data-calendar-chip-title="true"
      data-calendar-chip-title-fit={`${fit.fontSize}/${fit.lineClamp}`}
      style={{
        minWidth: 0,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: specialDate
          ? `${specialDateColumnWidth}px minmax(0, 1fr)`
          : leadingColumnWidth ? `${leadingColumnWidth}px minmax(0, 1fr)` : "minmax(0, 1fr)",
        alignItems: "center",
        flex: "0 1 auto",
        columnGap: specialDate ? 6 : leadingColumnWidth ? 5 : 0,
        maxHeight,
        overflow: "hidden",
        fontSize: fit.fontSize,
        fontWeight: 500,
        lineHeight: fit.lineHeight,
      }}
    >
      <ChipPrefix
        item={item}
        selected={selected}
        metrics={metrics}
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
        <CalendarChipStatusIcon item={item} selected={selected} metrics={metrics} />
        <CalendarChipRecurringIcon item={item} selected={selected} metrics={metrics} />
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

export function MoreButton({
  hiddenCount,
  onClick,
  buttonRef,
  pastTone,
  day,
  active,
  metrics,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  open,
  anchorKey,
}) {
  const buttonHeight = metrics?.moreHeight ?? 22;
  const compact = buttonHeight >= 24;
  const large = buttonHeight >= 26;
  return (
    <button
      type="button"
      ref={buttonRef}
      data-testid={`calendar-cell-overflow-trigger-${day}`}
      data-calendar-overflow-trigger="true"
      data-calendar-overflow-anchor-key={anchorKey || undefined}
      data-active={active ? "true" : "false"}
      data-calendar-focus-ring="true"
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      style={{
        minHeight: buttonHeight,
        width: "100%",
        justifyContent: "flex-start",
        padding: large ? "0 12px" : compact ? "0 11px" : "0 10px",
        borderRadius: large ? 10 : compact ? 9 : 8,
        border: active || open
          ? "1px solid rgba(255,255,255,0.1)"
          : "1px solid rgba(255,255,255,0.045)",
        background: active || open ? "rgba(255,255,255,0.052)" : "rgba(255,255,255,0.018)",
        color: active || open
          ? "#eef2ff"
          : pastTone === "items" ? "var(--color-text-faint)" : "rgba(205,214,244,0.56)",
        cursor: "pointer",
        fontSize: large ? 12 : compact ? 11.5 : 11,
        fontWeight: 600,
        letterSpacing: 0.2,
        textAlign: "left",
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "stretch",
        transition: "color 140ms, background 140ms, border-color 140ms",
      }}
    >
      +{hiddenCount} more
    </button>
  );
}

export function ItemChip({
  item,
  selected,
  active,
  pastTone,
  metrics,
  quickActions,
  onSelectItem,
  onSetActive,
  onClearActive,
  onBeforeDragStart,
  onBeforeDeleteMenu,
  inlineOverflowItem = false,
  stackRef,
  dateKey,
  leadingColumnWidth = 0,
}) {
  const ghost = !!item.isGhost;
  const reducedMotion = useReducedMotion();
  const layoutId = !reducedMotion && item.layoutId ? String(item.layoutId) : undefined;
  const selectionId = item.selectionId != null ? String(item.selectionId) : String(item.id);
  const specialDate = item.specialDate === true;
  const dragAllowed = !ghost && !!quickActions?.dragEnabled && !!item.writable && !!item.sourceEvent && !specialDate;
  const batchSelected = !specialDate && !!quickActions?.isEventSelectionSelected?.(item.sourceEvent || item.sourceItem);

  if (ghost) {
    return (
      <div
        key={item.id}
        data-testid="calendar-ghost-chip"
        data-ghost-kind={item.ghostKind || item.kind || "item"}
        data-ghost-start={item.ghostStart || item.startDate || undefined}
        data-ghost-end={item.ghostEnd || item.endDate || undefined}
        aria-hidden="true"
        style={chipStyle({
          item,
          selected: false,
          batchSelected: false,
          pastTone,
          active: false,
          metrics,
        })}
      >
      <ChipContent
        item={item}
        selected={false}
        metrics={metrics}
        leadingColumnWidth={leadingColumnWidth}
      />
      <CalendarChipReminderMarker item={item} />
    </div>
    );
  }

  return (
    <button
      key={item.id}
      type="button"
      data-testid="calendar-cell-item-chip"
      data-inline-overflow-item={inlineOverflowItem ? "true" : undefined}
      data-item-id={selectionId}
      data-source-item-id={String(item.id)}
      data-calendar-layout-id={layoutId}
      data-date-key={dateKey || undefined}
      data-selected={selected ? "true" : "false"}
      data-special-date={specialDate ? "true" : "false"}
      data-complete={item.complete ? "true" : "false"}
      data-hovered={active ? "true" : "false"}
      data-calendar-event-selection={batchSelected ? "true" : undefined}
      data-calendar-event-activation="true"
      draggable={dragAllowed}
      data-calendar-focus-ring="true"
      onClick={(event) => {
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        if (isEventSelectionModifier(event)) {
          event.preventDefault();
          quickActions?.toggleEventSelection?.({
            event: item.sourceEvent || item.sourceItem,
            dateKey,
            anchorElement: event.currentTarget,
            sourceCellElement: stackRef?.current?.closest?.("[role='gridcell']") || null,
            anchorKind: inlineOverflowItem ? "overflow-row" : "chip",
          });
          return;
        }
        onSelectItem?.(selectionId, {
          triggerElement: event.currentTarget,
          sourceCellElement: stackRef?.current?.closest?.("[role='gridcell']") || null,
          dateKey,
          anchorKind: inlineOverflowItem ? "overflow-row" : "chip",
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
          sourceCellElement: stackRef?.current?.closest?.("[role='gridcell']") || null,
          dateKey,
          anchorKind: inlineOverflowItem ? "overflow-row" : "chip",
        })) {
          event.preventDefault();
          event.stopPropagation();
          onBeforeDeleteMenu?.();
          return;
        }
        if (!item.sourceEvent?.writable) return;
        event.preventDefault();
        event.stopPropagation();
        onBeforeDeleteMenu?.();
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
        onBeforeDragStart?.();
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-ea-calendar-event", JSON.stringify(item.sourceEvent));
        event.dataTransfer.setData("text/plain", String(item.title || ""));
      }}
      onDragEnd={() => quickActions?.endDrag?.()}
      onPointerEnter={() => onSetActive?.(String(item.id))}
      onPointerLeave={() => onClearActive?.(String(item.id))}
      onFocus={() => onSetActive?.(String(item.id))}
      onBlur={() => onClearActive?.(String(item.id))}
      style={chipStyle({
        item,
        selected,
        batchSelected,
        pastTone,
        active,
        metrics,
      })}
    >
      <ChipContent
        item={item}
        selected={selected}
        metrics={metrics}
        leadingColumnWidth={leadingColumnWidth}
      />
      <CalendarChipReminderMarker item={item} />
    </button>
  );
}
