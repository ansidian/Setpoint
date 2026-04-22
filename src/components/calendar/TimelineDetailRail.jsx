import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

function SectionLabel({
  children,
  collapsible = false,
  expanded = false,
  onToggle,
  itemCount = 0,
  sectionId,
}) {
  if (collapsible) {
    return (
      <button
        type="button"
        data-testid={`timeline-detail-section-toggle-${sectionId}`}
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: 0,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 2.1,
            textTransform: "uppercase",
            color: "rgba(205,214,244,0.5)",
          }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {children}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 1.1,
            color: "rgba(205,214,244,0.34)",
          }}
        >
          {itemCount}
        </span>
      </button>
    );
  }

  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 2.1,
        textTransform: "uppercase",
        color: "rgba(205,214,244,0.5)",
      }}
    >
      {children}
    </div>
  );
}

function TimelineRow({ item }) {
  const [hovered, setHovered] = useState(false);
  const interactive = typeof item.onClick === "function";
  const sharedHandlers = interactive
    ? {
        role: "button",
        tabIndex: 0,
        onClick: (event) => item.onClick?.(event),
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            item.onClick?.(event);
          }
        },
      }
    : {};

  return (
    <div
      data-testid="timeline-detail-row"
      data-complete={item.complete ? "true" : "false"}
      {...sharedHandlers}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "68px 16px minmax(0, 1fr)",
        gap: 10,
        alignItems: "start",
        padding: "5px 0",
        borderRadius: 9,
        cursor: interactive ? "pointer" : "default",
        opacity: item.complete ? 0.54 : 1,
        transition: "opacity 130ms",
      }}
      onMouseEnter={() => {
        if (interactive) setHovered(true);
      }}
      onMouseLeave={() => {
        if (interactive) setHovered(false);
      }}
    >
      <div
        style={{
          paddingTop: 10,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.1,
          fontVariantNumeric: "tabular-nums",
          color: item.timeColor || "rgba(205,214,244,0.62)",
          whiteSpace: "nowrap",
        }}
      >
        {item.timeLabel}
      </div>

      <div style={{ position: "relative", minHeight: 58 }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 8,
            top: 0,
            bottom: 0,
            width: 1,
            background: item.selected
              ? "rgba(203,166,218,0.18)"
              : "rgba(255,255,255,0.055)",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 2,
            top: 5,
            width: 12,
            height: 12,
            borderRadius: 9999,
            background: "#0d0d15",
            display: "grid",
            placeItems: "center",
            border: `1px solid ${item.dotColor ? `${item.dotColor}55` : "rgba(255,255,255,0.15)"}`,
            boxShadow: item.dotColor
              ? `0 0 0 1px ${item.dotColor}16, 0 0 10px ${item.dotColor}12`
              : "none",
          }}
        >
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: 9999,
              background: item.dotColor || "rgba(205,214,244,0.5)",
            }}
          />
        </div>
      </div>

      <div
          style={{
            minWidth: 0,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: 7,
            alignItems: "start",
            padding: "10px 12px 9px",
            borderRadius: 11,
            border: item.selected
              ? "1px solid rgba(203,166,218,0.26)"
              : hovered
              ? "1px solid rgba(255,255,255,0.05)"
              : "1px solid rgba(255,255,255,0.03)",
          background: item.selected
            ? "linear-gradient(180deg, rgba(203,166,218,0.11), rgba(203,166,218,0.05))"
            : hovered
              ? "rgba(255,255,255,0.028)"
              : "rgba(255,255,255,0.012)",
          boxShadow: item.selected
            ? "0 0 0 1px rgba(203,166,218,0.05), inset 0 1px 0 rgba(255,255,255,0.03)"
            : "inset 0 1px 0 rgba(255,255,255,0.02)",
          transition: "background 130ms, border-color 130ms, box-shadow 130ms",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            className={item.titleClassName}
            style={{
              fontSize: 12.5,
              color: "#eef2ff",
              fontWeight: item.selected ? 600 : 500,
              lineHeight: 1.3,
              letterSpacing: -0.08,
              textDecoration: item.complete ? "line-through" : "none",
              textDecorationColor: "rgba(205,214,244,0.3)",
            }}
          >
            {item.title}
          </div>
          {item.subtitle && (
            <div
              style={{
                marginTop: 3,
                fontSize: 10,
                color: "rgba(205,214,244,0.52)",
                lineHeight: 1.4,
              }}
            >
              {item.subtitle}
            </div>
          )}
          {item.meta && (
            <div
              style={{
                marginTop: 4,
                fontSize: 9.5,
                color: "rgba(205,214,244,0.38)",
                lineHeight: 1.4,
              }}
            >
              {item.meta}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", alignSelf: "center", gap: 6 }}>
          {item.trailing}
        </div>
      </div>
    </div>
  );
}

export default function TimelineDetailRail({
  eyebrow = "Day detail",
  title,
  summary,
  accent = "var(--ea-accent)",
  headerContent = null,
  sections = [],
}) {
  const visibleSections = sections.filter((section) => {
    if (section.collapsible) return (section.itemCount || section.items?.length || 0) > 0;
    return section.items?.length;
  });

  return (
    <div
      data-testid="timeline-detail-rail"
      style={{
        padding: "16px 18px 18px",
        overflow: "hidden",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          data-testid="timeline-detail-masthead"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "14px 14px 12px",
            borderRadius: 14,
            border: `1px solid color-mix(in srgb, ${accent} 16%, rgba(255,255,255,0.05))`,
            background: `radial-gradient(circle at top left, color-mix(in srgb, ${accent} 14%, transparent), transparent 42%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))`,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 2.2,
                  textTransform: "uppercase",
                  color: "rgba(205,214,244,0.48)",
                }}
              >
                {eyebrow}
              </div>
              <div
                className="ea-display"
                style={{
                  marginTop: 6,
                  fontSize: 22,
                  lineHeight: 1.05,
                  letterSpacing: -0.38,
                  color: "#f6f7fb",
                }}
              >
                {title}
              </div>
            </div>
          </div>
          {summary ? (
            <div
              style={{
                alignSelf: "flex-start",
                padding: "6px 9px",
                borderRadius: 999,
                border: `1px solid color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.06))`,
                background: `color-mix(in srgb, ${accent} 8%, rgba(255,255,255,0.03))`,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.15,
                color: "rgba(238,242,255,0.74)",
                whiteSpace: "nowrap",
              }}
            >
              {summary}
            </div>
          ) : null}
        </div>

        {headerContent ? (
          <div style={{ flex: 1, minHeight: 0 }}>
            {headerContent}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {visibleSections.map((section) => (
          <div key={section.id} data-testid={`timeline-detail-section-${section.id}`}>
            <SectionLabel
              collapsible={section.collapsible}
              expanded={section.expanded}
              onToggle={section.onToggle}
              itemCount={section.itemCount}
              sectionId={section.id}
            >
              {section.label}
            </SectionLabel>
            {(!section.collapsible || section.expanded) && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                {section.items.map((item) => (
                  <TimelineRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
