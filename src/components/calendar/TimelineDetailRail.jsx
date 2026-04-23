import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AnimatePresence, motion as Motion } from "motion/react";
import { useDetailRailMotion } from "./detailRailMotion.js";

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
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            color: "rgba(205,214,244,0.5)",
          }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {children}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.8,
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
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1.8,
        textTransform: "uppercase",
        color: "rgba(205,214,244,0.5)",
      }}
    >
      {children}
    </div>
  );
}

function TimelineRow({ item, compact = false }) {
  const [hovered, setHovered] = useState(false);
  const motion = useDetailRailMotion();
  const interactive = typeof item.onClick === "function";
  const rowMetrics = compact
    ? {
        timeColumn: "60px",
        gutter: "12px",
        outerGap: 6,
        rowPadding: "3px 0",
        rowRadius: 8,
        timePadTop: 7,
        timeFontSize: 10,
        railMinHeight: 56,
        railLineLeft: 7,
        dotLeft: 0,
        dotTop: 6,
        dotBox: 14,
        dotSize: 5,
        cardGap: 6,
        cardMinHeight: 56,
        cardPadding: "7px 10px",
        cardRadius: 12,
        titleFontSize: 12.5,
        titleLineHeight: 1.22,
        titleLetterSpacing: -0.12,
        subtitleMarginTop: 3,
        subtitleFontSize: 11,
        metaMarginTop: 3,
        metaFontSize: 10,
        trailingGap: 6,
      }
    : {
        timeColumn: "72px",
        gutter: "16px",
        outerGap: 10,
        rowPadding: "5px 0",
        rowRadius: 10,
        timePadTop: 10,
        timeFontSize: 11,
        railMinHeight: 68,
        railLineLeft: 9,
        dotLeft: 1,
        dotTop: 8,
        dotBox: 16,
        dotSize: 6,
        cardGap: 8,
        cardMinHeight: 68,
        cardPadding: "12px 14px 11px",
        cardRadius: 14,
        titleFontSize: 13.5,
        titleLineHeight: 1.24,
        titleLetterSpacing: -0.14,
        subtitleMarginTop: 4,
        subtitleFontSize: 11.5,
        metaMarginTop: 4,
        metaFontSize: 10.5,
        trailingGap: 8,
      };
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
    <Motion.div
      layout
      transition={motion.layout}
      data-testid="timeline-detail-row"
      data-complete={item.complete ? "true" : "false"}
      data-selected={item.selected ? "true" : "false"}
      data-density={compact ? "compact" : "default"}
      {...sharedHandlers}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: `${rowMetrics.timeColumn} ${rowMetrics.gutter} minmax(0, 1fr)`,
        gap: rowMetrics.outerGap,
        alignItems: "start",
        padding: rowMetrics.rowPadding,
        borderRadius: rowMetrics.rowRadius,
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
      <Motion.div
        layout="position"
        transition={motion.layout}
        style={{
          paddingTop: rowMetrics.timePadTop,
          fontSize: rowMetrics.timeFontSize,
          fontWeight: 600,
          letterSpacing: 0.1,
          fontVariantNumeric: "tabular-nums",
          color: item.timeColor || "rgba(205,214,244,0.62)",
          whiteSpace: "nowrap",
        }}
      >
        {item.timeLabel}
      </Motion.div>

      <Motion.div
        layout="position"
        transition={motion.layout}
        style={{ position: "relative", minHeight: rowMetrics.railMinHeight }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: rowMetrics.railLineLeft,
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
            left: rowMetrics.dotLeft,
            top: rowMetrics.dotTop,
            width: rowMetrics.dotBox,
            height: rowMetrics.dotBox,
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
              width: rowMetrics.dotSize,
              height: rowMetrics.dotSize,
              borderRadius: 9999,
              background: item.dotColor || "rgba(205,214,244,0.5)",
            }}
          />
        </div>
      </Motion.div>

      <Motion.div
        layout
        transition={motion.layout}
        style={{
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: rowMetrics.cardGap,
          alignItems: "start",
          minHeight: rowMetrics.cardMinHeight,
          padding: rowMetrics.cardPadding,
          borderRadius: rowMetrics.cardRadius,
          border: item.selected
            ? "1px solid rgba(203,166,218,0.28)"
            : hovered
              ? "1px solid rgba(255,255,255,0.06)"
              : "1px solid rgba(255,255,255,0.04)",
          background: item.selected
            ? "linear-gradient(180deg, rgba(203,166,218,0.11), rgba(203,166,218,0.05))"
            : hovered
              ? "rgba(255,255,255,0.028)"
              : "rgba(255,255,255,0.015)",
          boxShadow: item.selected
            ? "0 0 0 1px rgba(203,166,218,0.05), inset 0 1px 0 rgba(255,255,255,0.03)"
            : "inset 0 1px 0 rgba(255,255,255,0.02)",
          transition: "background 130ms, border-color 130ms, box-shadow 130ms",
        }}
      >
        <Motion.div layout transition={motion.layout} style={{ minWidth: 0 }}>
          <Motion.div
            layout="position"
            transition={motion.layout}
            className={item.titleClassName}
            style={{
              fontSize: rowMetrics.titleFontSize,
              color: "#eef2ff",
              fontWeight: item.selected ? 600 : 500,
              lineHeight: rowMetrics.titleLineHeight,
              letterSpacing: rowMetrics.titleLetterSpacing,
              textDecoration: item.complete ? "line-through" : "none",
              textDecorationColor: "rgba(205,214,244,0.3)",
              display: "-webkit-box",
              WebkitLineClamp: compact ? 2 : 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {item.title}
          </Motion.div>
          {item.subtitle && (
            <Motion.div
              layout="position"
              transition={motion.layout}
              style={{
                marginTop: rowMetrics.subtitleMarginTop,
                fontSize: rowMetrics.subtitleFontSize,
                color: "rgba(205,214,244,0.52)",
                lineHeight: 1.4,
                display: "-webkit-box",
                WebkitLineClamp: compact ? 2 : 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {item.subtitle}
            </Motion.div>
          )}
          {item.meta && (
            <Motion.div
              layout="position"
              transition={motion.layout}
              style={{
                marginTop: rowMetrics.metaMarginTop,
                fontSize: rowMetrics.metaFontSize,
                color: "rgba(205,214,244,0.38)",
                lineHeight: 1.4,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {item.meta}
            </Motion.div>
          )}
        </Motion.div>
        <Motion.div
          layout="position"
          transition={motion.layout}
          style={{ display: "flex", alignItems: compact ? "flex-start" : "center", alignSelf: compact ? "start" : "center", gap: rowMetrics.trailingGap }}
        >
          {item.trailing}
        </Motion.div>
      </Motion.div>
    </Motion.div>
  );
}

export default function TimelineDetailRail({
  eyebrow = "Day detail",
  title,
  summary,
  accent = "var(--ea-accent)",
  headerContent = null,
  sections = [],
  supportBandActive = false,
}) {
  const motion = useDetailRailMotion();
  const visibleSections = sections.filter((section) => {
    if (section.collapsible) return (section.itemCount || section.items?.length || 0) > 0;
    return section.items?.length;
  });
  const compactMasthead = supportBandActive || !!headerContent;
  const totalItemCount = visibleSections.reduce(
    (count, section) => count + (section.itemCount || section.items?.length || 0),
    0,
  );
  const compactRows = totalItemCount >= 3;

  return (
    <Motion.div
      layout
      transition={motion.layout}
      data-testid="timeline-detail-rail"
      data-density={compactRows ? "compact" : "default"}
      data-support-band-active={supportBandActive ? "true" : "false"}
      style={{
        padding: "12px",
        overflow: "hidden",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <Motion.div
        layout
        transition={motion.layout}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <Motion.div
          layout
          transition={motion.layout}
          data-testid="timeline-detail-masthead"
          style={{
            display: "flex",
            flexDirection: compactMasthead ? "row" : "column",
            alignItems: compactMasthead ? "center" : "stretch",
            justifyContent: compactMasthead ? "space-between" : "flex-start",
            gap: compactMasthead ? 6 : 8,
            padding: supportBandActive ? "6px 8px" : compactMasthead ? "8px 9px" : "10px",
            borderRadius: 16,
            border: `1px solid color-mix(in srgb, ${accent} 16%, rgba(255,255,255,0.05))`,
            background: `radial-gradient(circle at top left, color-mix(in srgb, ${accent} 14%, transparent), transparent 42%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))`,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <Motion.div layout transition={motion.layout} style={{ display: "flex", flexDirection: "column", gap: compactMasthead ? 4 : 6, minWidth: 0 }}>
            <Motion.div layout transition={motion.layout} style={{ minWidth: 0 }}>
              <Motion.div
                layout="position"
                transition={motion.layout}
                style={{
                  fontSize: supportBandActive ? 9.5 : compactMasthead ? 10 : 11,
                  fontWeight: 700,
                  letterSpacing: 1.8,
                  textTransform: "uppercase",
                  color: "rgba(205,214,244,0.48)",
                }}
              >
                {eyebrow}
              </Motion.div>
              <Motion.div
                layout="position"
                transition={motion.layout}
                className="ea-display"
                style={{
                  marginTop: compactMasthead ? 2 : 6,
                  fontSize: supportBandActive ? 15.5 : compactMasthead ? 17 : 22,
                  lineHeight: 1.04,
                  letterSpacing: supportBandActive ? -0.32 : -0.42,
                  color: "#f6f7fb",
                  whiteSpace: compactMasthead ? "nowrap" : "normal",
                  overflow: compactMasthead ? "hidden" : "visible",
                  textOverflow: compactMasthead ? "ellipsis" : "clip",
                }}
              >
                {title}
              </Motion.div>
            </Motion.div>
          </Motion.div>
          {summary ? (
            <Motion.div
              layout="position"
              transition={motion.layout}
              style={{
                alignSelf: compactMasthead ? "center" : "flex-start",
                flexShrink: 0,
                padding: compactMasthead ? "5px 8px" : "6px 9px",
                borderRadius: 999,
                border: `1px solid color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.06))`,
                background: `color-mix(in srgb, ${accent} 8%, rgba(255,255,255,0.03))`,
                fontSize: supportBandActive ? 9.5 : compactMasthead ? 10 : 11,
                fontWeight: 600,
                letterSpacing: 0.15,
                color: "rgba(238,242,255,0.74)",
                whiteSpace: "nowrap",
              }}
            >
              {summary}
            </Motion.div>
          ) : null}
        </Motion.div>

        {headerContent ? (
          <Motion.div layout transition={motion.layout} style={{ flexShrink: 0 }}>
            {headerContent}
          </Motion.div>
        ) : null}
      </Motion.div>

      <Motion.div
        layout
        transition={motion.layout}
        data-testid="timeline-detail-sections"
        data-calendar-local-scroll="true"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          paddingRight: 2,
          display: "flex",
          flexDirection: "column",
          gap: compactRows ? 8 : 10,
        }}
      >
        {visibleSections.map((section) => (
          <Motion.div
            key={section.id}
            layout
            transition={motion.layout}
            data-testid={`timeline-detail-section-${section.id}`}
          >
            <SectionLabel
              collapsible={section.collapsible}
              expanded={section.expanded}
              onToggle={section.onToggle}
              itemCount={section.itemCount}
              sectionId={section.id}
            >
              {section.label}
            </SectionLabel>
            <AnimatePresence initial={false}>
              {(!section.collapsible || section.expanded) ? (
                <Motion.div
                  key={`${section.id}-content`}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{
                    height: motion.fade,
                    opacity: motion.fade,
                    layout: motion.layout,
                  }}
                  style={{
                    overflow: "hidden",
                  }}
                >
                  <Motion.div
                    layout
                    transition={motion.layout}
                    style={{ marginTop: compactRows ? 4 : 6, display: "flex", flexDirection: "column", gap: compactRows ? 2 : 3 }}
                  >
                    {section.items.map((item) => (
                      <TimelineRow key={item.id} item={item} compact={compactRows} />
                    ))}
                  </Motion.div>
                </Motion.div>
              ) : null}
            </AnimatePresence>
          </Motion.div>
        ))}
        {!visibleSections.length ? (
          <Motion.div
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motion.fade}
            style={{
              padding: "12px 0",
              fontSize: 12,
              color: "rgba(205,214,244,0.5)",
            }}
          >
            No items for this day.
          </Motion.div>
        ) : null}
      </Motion.div>
    </Motion.div>
  );
}
