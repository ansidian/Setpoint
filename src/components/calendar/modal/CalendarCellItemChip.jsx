import { Repeat } from "lucide-react";

function chipStyle({
  item,
  selected,
  pastTone,
  active,
  metrics,
}) {
  const accent = item.accent || "var(--ea-accent)";
  const ghost = !!item.isGhost;
  const isPast = pastTone === "items";
  const quiet = item.complete || item.quiet;
  const hasMetadata = !!(item.leadingLabel || item.recurring);
  const itemHeight = metrics?.itemHeight ?? 24;
  const isLarge = itemHeight >= 28;
  const isMedium = itemHeight >= 26;
  const horizontalPadding = itemHeight >= 36 ? 10 : isLarge ? 9 : isMedium ? 8 : 7;
  const verticalPadding = itemHeight >= 36 ? 4 : itemHeight >= 32 ? 3 : hasMetadata ? 2 : 0;
  const radius = isLarge ? 10 : isMedium ? 9 : 8;

  return {
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
    border: ghost
      ? `1px dotted color-mix(in srgb, ${accent} 54%, transparent)`
      : selected
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
    boxShadow: selected
      ? `inset 0 1px 0 color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.02))`
      : active
        ? "inset 0 1px 0 rgba(255,255,255,0.04)"
        : "none",
    color: selected ? "#f6f7fb" : quiet ? "rgba(205,214,244,0.52)" : "rgba(205,214,244,0.78)",
    cursor: ghost ? "default" : "pointer",
    pointerEvents: ghost ? "none" : "auto",
    opacity: isPast ? (selected ? 0.92 : 0.82) : quiet ? 0.88 : 1,
    transition: "background 140ms, border-color 140ms, opacity 140ms, box-shadow 140ms, color 140ms",
    fontFamily: "inherit",
    textAlign: "left",
  };
}

function metadataFontSize(metrics) {
  const itemHeight = metrics?.itemHeight ?? 24;
  if (itemHeight >= 36) return 9;
  if (itemHeight >= 32) return 8.75;
  if (itemHeight >= 28) return 9.25;
  return 9;
}

function compactLeadingLabel(value) {
  const label = String(value || "").trim();
  const timeMatch = label.match(/^(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?$/i);
  if (!timeMatch) return label;
  const hour = timeMatch[1];
  const minute = timeMatch[2];
  const suffix = timeMatch[3].toLowerCase();
  return minute && minute !== "00" ? `${hour}:${minute}${suffix}` : `${hour}${suffix}`;
}

function chipContentFit(item, metrics) {
  const itemHeight = metrics?.itemHeight ?? 24;
  const compactLabel = compactLeadingLabel(item.leadingLabel);
  const length = [compactLabel, item.title].filter(Boolean).join(" ").trim().length;

  if (itemHeight >= 36) {
    if (length <= 22) return { fontSize: 11, lineHeight: 1.08, lineClamp: 1 };
    if (length <= 58) return { fontSize: 10.5, lineHeight: 1.08, lineClamp: 2 };
    return { fontSize: 10, lineHeight: 1.08, lineClamp: 2 };
  }
  if (itemHeight >= 32) return { fontSize: length <= 22 ? 10.5 : 10, lineHeight: 1.06, lineClamp: length <= 22 ? 1 : 2 };
  if (itemHeight >= 28) return { fontSize: 10.5, lineHeight: 1.05, lineClamp: 1 };
  if (itemHeight >= 26) return { fontSize: 10.25, lineHeight: 1.05, lineClamp: 1 };
  return { fontSize: 10, lineHeight: 1.05, lineClamp: 1 };
}

function metadataColor(item, selected) {
  if (selected) return item.leadingColor || item.accent || "var(--ea-accent)";
  return item.leadingColor || "rgba(205,214,244,0.62)";
}

function ChipPrefix({ item, selected, metrics }) {
  if (!item.leadingLabel && !item.recurring) return null;
  const color = metadataColor(item, selected);
  const itemHeight = metrics?.itemHeight ?? 24;
  const compactLabel = compactLeadingLabel(item.leadingLabel);

  return (
    <span
      data-calendar-chip-meta="true"
      style={{
        minWidth: 0,
        display: "inline-flex",
        alignItems: "center",
        gap: itemHeight >= 36 ? 5 : 4,
        maxWidth: "100%",
        overflow: "hidden",
        fontSize: metadataFontSize(metrics),
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
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {compactLabel}
        </span>
      ) : null}
      {item.recurring ? (
        <Repeat
          data-calendar-chip-recurring="true"
          aria-hidden="true"
          size={itemHeight >= 36 ? 10 : 9}
          strokeWidth={2.4}
          style={{
            flexShrink: 0,
            color,
            opacity: selected ? 0.86 : 0.7,
          }}
        />
      ) : null}
    </span>
  );
}

function ChipContent({ item, selected, metrics }) {
  const fit = chipContentFit(item, metrics);
  const TitleTag = item.complete ? "s" : "span";
  const lineHeightPx = Number((fit.fontSize * fit.lineHeight).toFixed(2));
  const maxHeight = Number((lineHeightPx * fit.lineClamp).toFixed(2));
  const clampStyle = fit.lineClamp > 1
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
        flex: "0 1 auto",
        maxHeight,
        overflow: "hidden",
        ...clampStyle,
        fontSize: fit.fontSize,
        fontWeight: 500,
        lineHeight: fit.lineHeight,
      }}
    >
      <ChipPrefix item={item} selected={selected} metrics={metrics} />
      <TitleTag
        data-calendar-chip-title-text="true"
        style={{
          textDecorationColor: "rgba(205,214,244,0.28)",
        }}
      >
        {item.title}
      </TitleTag>
    </span>
  );
}

export function MoreButton({
  hiddenCount,
  onClick,
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
          : pastTone === "items" ? "rgba(205,214,244,0.42)" : "rgba(205,214,244,0.56)",
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
}) {
  const ghost = !!item.isGhost;
  const dragAllowed = !ghost && !!quickActions?.dragEnabled && !!item.writable && !!item.sourceEvent;

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
          pastTone,
          active: false,
          metrics,
        })}
      >
        <ChipContent item={item} selected={false} metrics={metrics} />
      </div>
    );
  }

  return (
    <button
      key={item.id}
      type="button"
      data-testid="calendar-cell-item-chip"
      data-inline-overflow-item={inlineOverflowItem ? "true" : undefined}
      data-item-id={String(item.id)}
      data-date-key={dateKey || undefined}
      data-hovered={active ? "true" : "false"}
      draggable={dragAllowed}
      data-calendar-focus-ring="true"
      onClick={(event) => {
        event.stopPropagation();
        onSelectItem?.(item.id, {
          triggerElement: event.currentTarget,
          sourceCellElement: stackRef?.current?.closest?.("[role='gridcell']") || null,
          dateKey,
          anchorKind: inlineOverflowItem ? "overflow-row" : "chip",
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
      onPointerEnter={() => onSetActive(String(item.id))}
      onPointerLeave={() => onClearActive(String(item.id))}
      onFocus={() => onSetActive(String(item.id))}
      onBlur={() => onClearActive(String(item.id))}
      style={chipStyle({
        item,
        selected,
        pastTone,
        active,
        metrics,
      })}
    >
      <ChipContent item={item} selected={selected} metrics={metrics} />
    </button>
  );
}
