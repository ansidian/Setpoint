import { useState } from "react";
import { AlertCircle, CreditCard, Mail } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

function FocusRefreshStatus({ accent }) {
  return (
    <div
      data-testid="focus-window-refresh-status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        marginBottom: 8,
        padding: "3px 8px",
        borderRadius: 9999,
        border: `1px solid ${accent}38`,
        background: `${accent}14`,
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: 0.25,
        color: "#cdd6f4",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 5,
          height: 5,
          borderRadius: 99,
          background: accent,
          boxShadow: `0 0 6px ${accent}70`,
          animation: "dashPulse 1.8s ease-in-out infinite",
        }}
      />
      Updating Google Calendar
    </div>
  );
}

const OPEN_DAY_ICONS = {
  deadline: AlertCircle,
  bill: CreditCard,
  email: Mail,
};

const OPEN_DAY_URGENCY_COLOR = {
  high: "#f38ba8",
  medium: "#f9e2af",
  low: null,
};

function OpenDayBlock({ summary, accent, isMobile = false }) {
  const isLight = summary.tone === "light";
  const primary = summary.primary;
  const Icon = primary ? OPEN_DAY_ICONS[primary.kind] : null;
  const urgencyColor = primary ? (OPEN_DAY_URGENCY_COLOR[primary.urgency] || accent) : accent;
  const hasPrimaryMeta = Boolean(primary?.sub || primary?.timingLabel);

  return (
    <div
      data-testid="focus-window-open-day"
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        background: `${accent}0d`,
        border: `1px solid ${accent}22`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 10, color: "rgba(205,214,244,0.45)", textTransform: "uppercase", letterSpacing: 0.7 }}>
          Open day
        </div>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: accent,
            background: `${accent}18`,
            border: `1px solid ${accent}30`,
            borderRadius: 9999,
            padding: "2px 7px",
          }}
        >
          No more events
        </span>
      </div>

      {isLight ? (
        <div
          data-testid="focus-window-open-day-light"
          style={{ marginTop: 8, fontSize: isMobile ? 11.5 : 12, color: "rgba(205,214,244,0.7)", lineHeight: 1.45 }}
        >
          {summary.hint}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            {Icon ? (
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <Icon size={11} color={urgencyColor} />
              </div>
            ) : null}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  color: urgencyColor,
                }}
              >
                {primary.contextLabel}
              </div>
              <div
                style={{
                  fontSize: isMobile ? 13 : 13.5,
                  fontWeight: 500,
                  color: "#cdd6f4",
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {primary.title}
              </div>
            </div>
          </div>
          {hasPrimaryMeta ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                marginTop: 10,
                paddingTop: 8,
                borderTop: "1px solid rgba(255,255,255,0.05)",
                fontSize: 10.5,
                color: "rgba(205,214,244,0.55)",
              }}
            >
              {primary.sub ? (
                <div
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  {primary.sub}
                </div>
              ) : null}
              {primary.timingLabel ? (
                <div style={{ color: "rgba(205,214,244,0.4)", whiteSpace: "nowrap" }}>
                  {primary.timingLabel}
                </div>
              ) : null}
            </div>
          ) : null}
          {summary.secondaries.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 4 }}>
              {summary.secondaries.map((item) => (
                <div
                  key={item.kind}
                  style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10.5, color: "rgba(205,214,244,0.55)" }}
                >
                  <span>{item.title}</span>
                  <span style={{ color: "rgba(205,214,244,0.4)" }}>{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function HeroFocusCard({
  accent,
  eventLoadingState = "ready",
  focusWindows,
  isMobile = false,
  onOpenPressure,
  openDaySummary,
}) {
  const [pressureHover, setPressureHover] = useState(false);
  const [pressureFocus, setPressureFocus] = useState(false);
  const pressureLabel = focusWindows.pressure.level === "high"
    ? `${focusWindows.pressure.overdue + focusWindows.pressure.today} urgent deadline${focusWindows.pressure.overdue + focusWindows.pressure.today === 1 ? "" : "s"}`
    : focusWindows.pressure.level === "medium"
      ? `${focusWindows.pressure.soon} deadline${focusWindows.pressure.soon === 1 ? "" : "s"} soon`
      : "Low pressure";
  const primary = focusWindows.primaryWindow;
  const backup = focusWindows.backupWindow;
  const fallback = focusWindows.fallback;
  const isOpenDay = primary?.quality === "Rest of day open";
  const pressureActive = pressureHover || pressureFocus;
  const showSkeletons = eventLoadingState === "empty_loading";
  const showRefreshStatus = eventLoadingState === "refreshing";

  return (
    <div
      data-testid="focus-window-card"
      style={{
        flex: "unset",
        padding: isMobile ? "12px 14px" : "14px 0 0",
        borderRadius: 0,
        background: "transparent",
        borderTop: isMobile ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontSize: isMobile ? 9 : 9.5,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            color: "rgba(205,214,244,0.4)",
          }}
        >
          Focus blocks
        </div>
        {focusWindows.pressure.level === "low" ? (
          <div
            style={{
              fontSize: 10,
              color: "rgba(205,214,244,0.42)",
            }}
          >
            {pressureLabel}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onOpenPressure?.()}
            onMouseEnter={() => setPressureHover(true)}
            onMouseLeave={() => setPressureHover(false)}
            onFocus={() => setPressureFocus(true)}
            onBlur={() => setPressureFocus(false)}
            style={{
              fontSize: 10,
              color: "#f9e2af",
              fontWeight: 600,
              fontFamily: "inherit",
              background: pressureActive ? "rgba(249,226,175,0.12)" : "rgba(249,226,175,0.08)",
              border: `1px solid ${pressureActive ? "rgba(249,226,175,0.3)" : "rgba(249,226,175,0.18)"}`,
              borderRadius: 9999,
              padding: "3px 8px",
              cursor: "pointer",
              transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
            }}
          >
            {pressureLabel}
          </button>
        )}
      </div>

      {showRefreshStatus && <FocusRefreshStatus accent={accent} />}

      {showSkeletons ? (
        <div data-testid="focus-window-skeleton" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton className="h-[18px] w-[62%] bg-white/10" />
          <Skeleton className="h-[12px] w-[90%] bg-white/8" />
          <Skeleton className="h-[12px] w-[72%] bg-white/8" />
        </div>
      ) : primary && isOpenDay ? (
        <OpenDayBlock summary={openDaySummary} accent={accent} isMobile={isMobile} />
      ) : primary ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: `${accent}0d`,
              border: `1px solid ${accent}22`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 10, color: "rgba(205,214,244,0.45)", textTransform: "uppercase", letterSpacing: 0.7 }}>
                Best block
              </div>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  color: accent,
                  background: `${accent}18`,
                  border: `1px solid ${accent}30`,
                  borderRadius: 9999,
                  padding: "2px 7px",
                }}
              >
                {primary.quality}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <div style={{ fontSize: isMobile ? 14 : 15, fontWeight: 600, color: "#cdd6f4", letterSpacing: -0.2 }}>
                {primary.timeRangeLabel}
              </div>
              <div style={{ fontSize: 10.5, color: "rgba(205,214,244,0.52)" }}>
                {primary.durationLabel}
              </div>
            </div>
            <div style={{ marginTop: 6, fontSize: isMobile ? 10.5 : 11, color: "rgba(205,214,244,0.68)", lineHeight: 1.45 }}>
              {primary.explanation}
            </div>
          </div>

          {backup && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                paddingTop: 8,
                borderTop: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div>
                <div style={{ fontSize: 10, color: "rgba(205,214,244,0.42)", textTransform: "uppercase", letterSpacing: 0.7 }}>
                  Backup
                </div>
                <div style={{ marginTop: 4, fontSize: 11.5, color: "#cdd6f4" }}>
                  {backup.timeRangeLabel}
                </div>
              </div>
              <div style={{ fontSize: 10.5, color: "rgba(205,214,244,0.5)", whiteSpace: "nowrap" }}>
                {backup.durationLabel}
              </div>
            </div>
          )}
        </div>
      ) : fallback?.kind === "short-window" ? (
        <div style={{ fontSize: isMobile ? 11 : 11.5, color: "#cdd6f4", lineHeight: 1.45 }}>
          <div style={{ fontWeight: 500 }}>No protected block left today.</div>
          <div style={{ marginTop: 4, color: "rgba(205,214,244,0.62)" }}>
            Next short opening: {fallback.timeRangeLabel} · {fallback.durationLabel}.
          </div>
        </div>
      ) : (
        <div style={{ fontSize: isMobile ? 11 : 11.5, color: "#cdd6f4", lineHeight: 1.45 }}>
          {focusWindows.fallback?.kind === "open-day"
            ? "Rest of day looks open. Pick the block that matters most."
            : "No protected block left today."}
        </div>
      )}
    </div>
  );
}
