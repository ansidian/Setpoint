import { useLayoutEffect, useRef } from "react";
import { Check, LoaderCircle, MapPin } from "lucide-react";

export default function CalendarLocationSuggestionsPanel({
  suggestions,
  loading = false,
  error = null,
  activeIndex = 0,
  onSelect,
}) {
  const itemRefs = useRef([]);

  useLayoutEffect(() => {
    const activeItem = itemRefs.current[activeIndex];
    activeItem?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeIndex, suggestions]);

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
            color: "var(--ea-accent)",
            background: "color-mix(in srgb, var(--ea-accent) 14%, transparent)",
            border: "1px solid color-mix(in srgb, var(--ea-accent) 24%, transparent)",
          }}
        >
          {loading ? <LoaderCircle size={12} className="animate-spin" /> : <MapPin size={12} />}
        </span>
        Suggested places
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "0 8px 8px",
        }}
      >
        {error ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid color-mix(in srgb, var(--sp-rose) 18%, transparent)",
              background: "color-mix(in srgb, var(--sp-rose) 8%, transparent)",
              color: "#f5c2e7",
              fontSize: 11.5,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        ) : null}

        {!error && !loading && !suggestions.length ? (
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
            No nearby matches yet.
          </div>
        ) : null}

        {suggestions.map((item, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={item.placeId}
              ref={(element) => {
                itemRefs.current[index] = element;
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
                border: active
                  ? "1px solid color-mix(in srgb, var(--sp-accent) 34%, transparent)"
                  : "1px solid rgba(255,255,255,0.06)",
                background: active
                  ? "color-mix(in srgb, var(--sp-accent) 12%, transparent)"
                  : "rgba(255,255,255,0.03)",
                color: "var(--sp-text)",
                fontFamily: "inherit",
                cursor: "pointer",
                textAlign: "left",
                transition: "transform 140ms, background 140ms, border-color 140ms",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.transform = "translateY(-1px)";
                if (!active) {
                  event.currentTarget.style.background = "rgba(255,255,255,0.05)";
                  event.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                }
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.transform = "translateY(0)";
                event.currentTarget.style.background = active
                  ? "color-mix(in srgb, var(--sp-accent) 12%, transparent)"
                  : "rgba(255,255,255,0.03)";
                event.currentTarget.style.borderColor = active
                  ? "color-mix(in srgb, var(--sp-accent) 34%, transparent)"
                  : "rgba(255,255,255,0.06)";
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  display: "inline-grid",
                  placeItems: "center",
                  color: active ? "var(--sp-accent)" : "rgba(205,214,244,0.55)",
                  background: active ? "color-mix(in srgb, var(--sp-accent) 10%, transparent)" : "rgba(255,255,255,0.03)",
                  flexShrink: 0,
                }}
              >
                <MapPin size={12} />
              </span>
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
                  {item.primaryText}
                </span>
                {item.secondaryText ? (
                  <span
                    style={{
                      display: "block",
                      marginTop: 2,
                      fontSize: 10.5,
                      color: "var(--color-text-faint)",
                      lineHeight: 1.45,
                      whiteSpace: "normal",
                      wordBreak: "break-word",
                    }}
                  >
                    {item.secondaryText}
                  </span>
                ) : null}
              </span>
              <span
                style={{
                  width: 18,
                  height: 18,
                  display: "inline-grid",
                  placeItems: "center",
                  color: active ? "var(--sp-accent)" : "transparent",
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
}
