import { useLayoutEffect, useMemo, useRef } from "react";
import { Calendar as CalendarIcon, Check } from "lucide-react";
import { ACCENT, sourceDotStyle } from "./calendarEditorUtils";

export default function SourcePickerPanel({
  sourceGroups,
  writableCalendars,
  selectedValue,
  activeValue = null,
  filterQuery = "",
  onSelect,
}) {
  const selectedSet = new Set([selectedValue]);
  const itemRefs = useRef([]);
  const normalizedQuery = String(filterQuery || "").trim().toLowerCase();
  const filteredCalendars = useMemo(() => {
    if (!normalizedQuery) return writableCalendars;
    return writableCalendars.filter((entry) => {
      const haystack = [
        entry.summary,
        entry.label,
        entry.accountLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, writableCalendars]);
  const showGroupLabels = sourceGroups.length > 1;

  useLayoutEffect(() => {
    if (!activeValue) return;
    const activeIndex = filteredCalendars.findIndex((item) => item.value === activeValue);
    if (activeIndex < 0) return;
    itemRefs.current[activeIndex]?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeValue, filteredCalendars]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 8px 10px",
          color: "rgba(205,214,244,0.72)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: "uppercase",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: 8,
            display: "inline-grid",
            placeItems: "center",
            color: ACCENT,
            background: `color-mix(in srgb, ${ACCENT} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${ACCENT} 24%, transparent)`,
          }}
        >
          <CalendarIcon size={12} />
        </span>
        Calendar source
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 8px 8px", overflowY: "auto" }}>
        {!filteredCalendars.length ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.05)",
              background: "rgba(255,255,255,0.03)",
              color: "rgba(205,214,244,0.56)",
              fontSize: 11.5,
              lineHeight: 1.5,
            }}
          >
            No matching calendar sources yet.
          </div>
        ) : null}
        {sourceGroups.map((group) => {
          const items = filteredCalendars.filter((entry) => entry.accountId === group.accountId);
          if (!items.length) return null;

          return (
            <div key={group.accountId} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {showGroupLabels ? (
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: 1.6,
                    textTransform: "uppercase",
                    color: "rgba(205,214,244,0.4)",
                    padding: "0 6px",
                  }}
                >
                  {group.accountLabel || "Calendar account"}
                </div>
              ) : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {items.map((item) => {
                  const selected = selectedSet.has(item.value);
                  const active = activeValue === item.value;
                  const borderColor = selected
                    ? "rgba(203,166,218,0.34)"
                    : active
                      ? "rgba(137,220,235,0.28)"
                      : "rgba(255,255,255,0.06)";
                  const background = selected
                    ? "rgba(203,166,218,0.12)"
                    : active
                      ? "rgba(137,220,235,0.08)"
                      : "rgba(255,255,255,0.03)";

                  return (
                    <button
                      key={item.value}
                      ref={(element) => {
                        const index = filteredCalendars.findIndex((entry) => entry.value === item.value);
                        if (index >= 0) itemRefs.current[index] = element;
                      }}
                      type="button"
                      onClick={() => onSelect(item)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto minmax(0, 1fr) auto",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: `1px solid ${borderColor}`,
                        background,
                        color: "#cdd6f4",
                        fontFamily: "inherit",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "transform 140ms, background 140ms, border-color 140ms",
                      }}
                      onMouseEnter={(event) => {
                        event.currentTarget.style.transform = "translateY(-1px)";
                        if (!active && !selected) {
                          event.currentTarget.style.background = "rgba(255,255,255,0.05)";
                          event.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                        }
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.transform = "translateY(0)";
                        event.currentTarget.style.background = background;
                        event.currentTarget.style.borderColor = borderColor;
                      }}
                    >
                      <span style={sourceDotStyle(item.color)} />
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            display: "block",
                            fontSize: 12.5,
                            color: "#e2e8f0",
                            fontWeight: 500,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.summary}
                        </span>
                      </span>
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          display: "inline-grid",
                          placeItems: "center",
                          color: selected ? "#cba6da" : "transparent",
                        }}
                      >
                        <Check size={14} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
