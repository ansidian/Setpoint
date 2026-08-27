import { useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AnimatePresence, motion as Motion } from "motion/react";
import { useDetailRailMotion } from "./detailRailMotion.ts";

export interface TimelineItem {
  id: string | number | null;
  timeLabel?: ReactNode;
  timeColor?: string;
  title?: ReactNode;
  titleClassName?: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  dotColor?: string;
  complete?: boolean;
  selected?: boolean;
  trailing?: ReactNode;
  onClick?: (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => void;
}
export interface TimelineSection { id: string; label: ReactNode; items: TimelineItem[]; collapsible?: boolean; expanded?: boolean; onToggle?: () => void; itemCount?: number }
export interface TimelineDetailRailProps { eyebrow?: ReactNode; title: ReactNode; summary?: ReactNode; accent?: string; actionContent?: ReactNode; headerContent?: ReactNode; sections?: TimelineSection[] }

function SectionLabel({
  children,
  collapsible = false,
  expanded = false,
  onToggle,
  itemCount = 0,
  sectionId,
}: { children?: ReactNode; collapsible?: boolean; expanded?: boolean; onToggle?: () => void; itemCount?: number; sectionId: string }) {
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
            color: "var(--color-text-faint)",
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
            color: "var(--color-text-faint)",
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
        color: "var(--color-text-faint)",
      }}
    >
      {children}
    </div>
  );
}

function TimelineRow({ item, compact = false }: { item: TimelineItem; compact?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const interactive = typeof item.onClick === "function";
  const TitleTag = item.complete ? "s" : "span";
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
        onClick: (event: MouseEvent<HTMLDivElement>) => item.onClick?.(event),
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            item.onClick?.(event);
          }
        },
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
      }
    : {};

  return (
    <div
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
    >
      <div
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
      </div>

      <div style={{ position: "relative", minHeight: rowMetrics.railMinHeight }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: rowMetrics.railLineLeft,
            top: 0,
            bottom: 0,
            width: 1,
            background: item.selected
              ? "color-mix(in srgb, var(--sp-accent) 18%, transparent)"
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
            background: "var(--sp-deep)",
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
      </div>

      <div
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
            ? "1px solid color-mix(in srgb, var(--sp-accent) 28%, transparent)"
            : hovered
              ? "1px solid rgba(255,255,255,0.06)"
              : "1px solid rgba(255,255,255,0.04)",
          background: item.selected
            ? "linear-gradient(180deg, color-mix(in srgb, var(--sp-accent) 11%, transparent), color-mix(in srgb, var(--sp-accent) 5%, transparent))"
            : hovered
              ? "rgba(255,255,255,0.028)"
              : "rgba(255,255,255,0.015)",
          boxShadow: item.selected
            ? "0 0 0 1px color-mix(in srgb, var(--sp-accent) 5%, transparent), inset 0 1px 0 rgba(255,255,255,0.03)"
            : "inset 0 1px 0 rgba(255,255,255,0.02)",
          transition: "background 130ms, border-color 130ms, box-shadow 130ms",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            className={item.titleClassName}
            style={{
              fontSize: rowMetrics.titleFontSize,
              color: "#eef2ff",
              fontWeight: item.selected ? 600 : 500,
              lineHeight: rowMetrics.titleLineHeight,
              letterSpacing: rowMetrics.titleLetterSpacing,
              textDecorationColor: "rgba(205,214,244,0.3)",
              display: "-webkit-box",
              WebkitLineClamp: compact ? 2 : 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            <TitleTag>{item.title}</TitleTag>
          </div>
          {item.subtitle && (
            <div
              style={{
                marginTop: rowMetrics.subtitleMarginTop,
                fontSize: rowMetrics.subtitleFontSize,
                color: "var(--color-text-faint)",
                lineHeight: 1.4,
                display: "-webkit-box",
                WebkitLineClamp: compact ? 2 : 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {item.subtitle}
            </div>
          )}
          {item.meta && (
            <div
              style={{
                marginTop: rowMetrics.metaMarginTop,
                fontSize: rowMetrics.metaFontSize,
                color: "var(--color-text-faint)",
                lineHeight: 1.4,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {item.meta}
            </div>
          )}
        </div>
        <div
          style={{ display: "flex", alignItems: compact ? "flex-start" : "center", alignSelf: compact ? "start" : "center", gap: rowMetrics.trailingGap }}
        >
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
  actionContent = null,
  headerContent = null,
  sections = [],
}: TimelineDetailRailProps) {
  const motion = useDetailRailMotion();
  const visibleSections = sections.filter((section) => {
    if (section.collapsible) return (section.itemCount || section.items?.length || 0) > 0;
    return section.items?.length;
  });
  const compactMasthead = !!headerContent;
  const totalItemCount = visibleSections.reduce(
    (count, section) => count + (section.itemCount || section.items?.length || 0),
    0,
  );
  const compactRows = totalItemCount >= 3;

  return (
    <div
      data-testid="timeline-detail-rail"
      data-density={compactRows ? "compact" : "default"}
      style={{
        padding: "12px",
        overflow: "hidden",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          data-testid="timeline-detail-masthead"
          style={{
            display: "flex",
            flexDirection: compactMasthead ? "row" : "column",
            alignItems: compactMasthead ? "center" : "stretch",
            justifyContent: compactMasthead ? "space-between" : "flex-start",
            gap: compactMasthead ? 6 : 8,
            padding: compactMasthead ? "8px 9px" : "10px",
            borderRadius: 16,
            border: `1px solid color-mix(in srgb, ${accent} 16%, rgba(255,255,255,0.05))`,
            background: `radial-gradient(circle at top left, color-mix(in srgb, ${accent} 14%, transparent), transparent 42%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))`,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: compactMasthead ? 4 : 6, minWidth: 0 }}>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: compactMasthead ? 10 : 11,
                  fontWeight: 700,
                  letterSpacing: 1.8,
                  textTransform: "uppercase",
                  color: "var(--color-text-faint)",
                }}
              >
                {eyebrow}
              </div>
              <div
                style={{
                  marginTop: compactMasthead ? 2 : 6,
                  fontSize: compactMasthead ? 17 : 22,
                  fontWeight: 600,
                  lineHeight: 1.04,
                  letterSpacing: -0.42,
                  color: "#f6f7fb",
                  whiteSpace: compactMasthead ? "nowrap" : "normal",
                  overflow: compactMasthead ? "hidden" : "visible",
                  textOverflow: compactMasthead ? "ellipsis" : "clip",
                }}
              >
                {title}
              </div>
            </div>
          </div>
          {summary ? (
            <div
              style={{
                alignSelf: compactMasthead ? "center" : "flex-start",
                flexShrink: 0,
                padding: compactMasthead ? "5px 8px" : "6px 9px",
                borderRadius: 999,
                border: `1px solid color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.06))`,
                background: `color-mix(in srgb, ${accent} 8%, rgba(255,255,255,0.03))`,
                fontSize: compactMasthead ? 10 : 11,
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
          <div style={{ flexShrink: 0 }}>
            {headerContent}
          </div>
        ) : null}

        {actionContent ? (
          <div style={{ flexShrink: 0 }}>
            {actionContent}
          </div>
        ) : null}
      </div>

      <div
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
            <AnimatePresence initial={false}>
              {(!section.collapsible || section.expanded) ? (
                <Motion.div
                  key={`${section.id}-content`}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{
                    height: motion.fade as never,
                    opacity: motion.fade as never,
                  }}
                  style={{
                    overflow: "hidden",
                  }}
                >
                  <div style={{ marginTop: compactRows ? 4 : 6, display: "flex", flexDirection: "column", gap: compactRows ? 2 : 3 }}>
                    {section.items.map((item) => (
                      <TimelineRow key={item.id} item={item} compact={compactRows} />
                    ))}
                  </div>
                </Motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ))}
        {!visibleSections.length ? (
          <div
            style={{
              padding: "12px 0",
              fontSize: 12,
              color: "var(--color-text-faint)",
            }}
          >
            No items for this day.
          </div>
        ) : null}
      </div>
    </div>
  );
}
