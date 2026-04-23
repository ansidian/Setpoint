import { useState } from "react";
import { cn } from "@/lib/utils";
import useIsMobile from "../../hooks/useIsMobile";

const tierStyles = {
  1: {
    wrapper: "rounded-xl",
    wrapperStyle: {
      background: "rgba(36,36,58,0.3)",
      border: "1px solid rgba(203,166,218,0.10)",
    },
    padding: { desktop: "16px 20px", mobile: "12px 16px" },
    titleClass: "text-[11px] max-sm:text-xs tracking-[2.5px] uppercase text-text-muted font-semibold",
  },
  2: {
    wrapper: "rounded-xl",
    wrapperStyle: {
      background: "rgba(36,36,58,0.3)",
      border: "1px solid rgba(255,255,255,0.04)",
    },
    padding: { desktop: "12px 16px", mobile: "8px 12px" },
    titleClass: "text-[11px] max-sm:text-xs tracking-[2.5px] uppercase font-semibold",
    titleStyle: { color: "rgba(255,255,255,0.20)" },
  },
};

export default function Section({
  title,
  children,
  delay,
  loaded,
  style,
  className,
  tier = 1,
  summaryBadge,
  defaultExpanded = true,
  headerAction,
}) {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const t = tierStyles[tier] || tierStyles[1];
  const collapsible = isMobile && summaryBadge !== undefined;
  const isExpanded = !collapsible || expanded;

  return (
    <div
      className={cn(
        "min-w-0 transition-[opacity,transform] duration-[600ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]",
        loaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3",
        t.wrapper,
        className,
      )}
      style={{
        transitionDelay: `${delay}ms`,
        ...t.wrapperStyle,
        padding: isMobile ? t.padding.mobile : t.padding.desktop,
        ...style,
      }}
    >
      {collapsible ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setExpanded((v) => !v)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((v) => !v); } }}
          className="flex items-center justify-between w-full min-h-[44px] cursor-pointer p-0 text-left"
        >
          <div className="flex items-center gap-2">
            <div className={t.titleClass} style={{ ...t.titleStyle, margin: 0 }}>
              {title}
            </div>
            {summaryBadge && (
              <span className="text-[10px] max-sm:text-xs font-medium px-2 py-0.5 rounded">
                {summaryBadge}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {headerAction && <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{headerAction}</span>}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted-foreground/50 transition-transform duration-200"
              style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              <path d="M4.5 3L7.5 6L4.5 9" />
            </svg>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between mb-3">
          <div className={t.titleClass} style={t.titleStyle}>
            {title}
          </div>
          {headerAction}
        </div>
      )}

      <div
        className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div
            className="transition-[opacity,transform] duration-200 ease-out"
            style={{
              opacity: isExpanded ? 1 : 0,
              transform: isExpanded ? "translateY(0)" : "translateY(-4px)",
            }}
          >
            {collapsible && <div className="h-3" />}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
