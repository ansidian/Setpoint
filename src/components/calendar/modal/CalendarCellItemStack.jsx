import { useState } from "react";
import { getVisibleCellItemCount } from "./calendarCellItemMetrics.js";

function chipStyle({
  item,
  selected,
  pastTone,
  active,
  metrics,
}) {
  const accent = item.accent || "var(--ea-accent)";
  const isPast = pastTone === "items";
  const quiet = item.complete || item.quiet;
  const itemHeight = metrics?.itemHeight ?? 24;
  const isLarge = itemHeight >= 28;
  const isMedium = itemHeight >= 26;
  const horizontalPadding = isLarge ? 11 : isMedium ? 10 : 9;
  const leadingPadding = isLarge ? 10 : isMedium ? 9 : 8;
  const radius = isLarge ? 10 : isMedium ? 9 : 8;

  return {
    display: "grid",
    gridTemplateColumns: item.leadingLabel ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
    alignItems: "center",
    gap: 7,
    minWidth: 0,
    padding: item.leadingLabel ? `0 ${horizontalPadding}px 0 ${leadingPadding}px` : `0 ${horizontalPadding}px`,
    height: itemHeight,
    borderRadius: radius,
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
    boxShadow: selected
      ? `inset 0 1px 0 color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.02))`
      : active
        ? "inset 0 1px 0 rgba(255,255,255,0.04)"
        : "none",
    color: selected ? "#f6f7fb" : quiet ? "rgba(205,214,244,0.52)" : "rgba(205,214,244,0.78)",
    cursor: "pointer",
    opacity: isPast ? (selected ? 0.92 : 0.82) : quiet ? 0.88 : 1,
    transition: "background 140ms, border-color 140ms, opacity 140ms, box-shadow 140ms, color 140ms",
    textDecoration: item.complete ? "line-through" : "none",
    textDecorationColor: "rgba(205,214,244,0.24)",
    fontFamily: "inherit",
    textAlign: "left",
    willChange: "background, border-color",
  };
}

function MoreButton({
  hiddenCount,
  onClick,
  pastTone,
  day,
  active,
  metrics,
  onMouseEnter,
  onMouseLeave,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  open,
}) {
  const buttonHeight = metrics?.moreHeight ?? 22;
  const compact = buttonHeight >= 24;
  const large = buttonHeight >= 26;
  return (
    <button
      type="button"
      data-testid={`calendar-cell-overflow-trigger-${day}`}
      data-calendar-overflow-trigger="true"
      data-active={active ? "true" : "false"}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
        willChange: "color, background, border-color",
      }}
    >
      +{hiddenCount} more
    </button>
  );
}

export default function CalendarCellItemStack({
  day,
  items,
  selectedItemId,
  onSelectItem,
  onOpenOverflow,
  pastTone,
  metrics,
  overflowOpen = false,
}) {
  const [activeChipId, setActiveChipId] = useState(null);
  const [moreActive, setMoreActive] = useState(false);

  if (!items?.length) return null;
  const visibleCount = getVisibleCellItemCount(items.length, metrics);
  const hiddenCount = Math.max(0, items.length - visibleCount);
  const visibleItems = items.slice(0, visibleCount);
  const hiddenItems = items.slice(visibleCount);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: metrics?.gap ?? 4,
        minWidth: 0,
      }}
    >
      {visibleItems.map((item) => {
        const selected = String(item.id) === String(selectedItemId);
        const active = String(item.id) === String(activeChipId);
        return (
          <button
            key={item.id}
            type="button"
            data-testid="calendar-cell-item-chip"
            data-item-id={String(item.id)}
            data-hovered={active ? "true" : "false"}
            onClick={(event) => {
              event.stopPropagation();
              onSelectItem?.(item.id);
            }}
            onMouseEnter={() => setActiveChipId(String(item.id))}
            onMouseLeave={() => setActiveChipId((current) => (
              current === String(item.id) ? null : current
            ))}
            onPointerEnter={() => setActiveChipId(String(item.id))}
            onPointerLeave={() => setActiveChipId((current) => (
              current === String(item.id) ? null : current
            ))}
            onFocus={() => setActiveChipId(String(item.id))}
            onBlur={() => setActiveChipId((current) => (
              current === String(item.id) ? null : current
            ))}
            style={chipStyle({
              item,
              selected,
              pastTone,
              active,
              metrics,
            })}
          >
            {item.leadingLabel ? (
              <span
                style={{
                  flexShrink: 0,
                  fontSize: (metrics?.itemHeight ?? 24) >= 28 ? 10.5 : (metrics?.itemHeight ?? 24) >= 26 ? 10 : 9.5,
                  fontWeight: 700,
                  letterSpacing: 0.2,
                  color: selected
                    ? item.leadingColor || item.accent || "var(--ea-accent)"
                    : item.leadingColor || "rgba(205,214,244,0.62)",
                  whiteSpace: "nowrap",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {item.leadingLabel}
              </span>
            ) : null}
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: (metrics?.itemHeight ?? 24) >= 28 ? 11.5 : (metrics?.itemHeight ?? 24) >= 26 ? 11 : 10.5,
                fontWeight: selected ? 600 : 500,
                lineHeight: 1.2,
              }}
            >
              {item.title}
            </span>
          </button>
        );
      })}

      {hiddenCount > 0 ? (
        <MoreButton
          day={day}
          hiddenCount={hiddenCount}
          pastTone={pastTone}
          active={moreActive}
          metrics={metrics}
          open={overflowOpen}
          onMouseEnter={() => setMoreActive(true)}
          onMouseLeave={() => setMoreActive(false)}
          onPointerEnter={() => setMoreActive(true)}
          onPointerLeave={() => setMoreActive(false)}
          onFocus={() => setMoreActive(true)}
          onBlur={() => setMoreActive(false)}
          onClick={(event) => {
            onOpenOverflow?.({
              triggerElement: event.currentTarget,
              hiddenItems,
              totalCount: items.length,
              visibleCount,
            });
          }}
        />
      ) : null}
    </div>
  );
}
