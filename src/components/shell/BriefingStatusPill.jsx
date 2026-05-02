function StatusText({ children, color = "rgba(245,247,255,0.9)", maxWidth = 132, weight = 600 }) {
  if (!children) return null;

  return (
    <span
      style={{
        minWidth: 0,
        maxWidth,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: 12,
        fontWeight: weight,
        color,
        lineHeight: 1.2,
        letterSpacing: 0,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </span>
  );
}

export function BriefingStatusPill({ accent, briefingStatus }) {
  if (!briefingStatus) return null;

  const toneColor = briefingStatus.toneColor || accent;
  const activityToneColor = briefingStatus.activityToneColor || "#cdd6f4";
  const activityDisplayLabel = briefingStatus.activityShortLabel || briefingStatus.activityLabel;
  const primaryLabel = [
    briefingStatus.sourceLabel || briefingStatus.label,
    briefingStatus.ageLabel,
  ].filter(Boolean).join(" · ");
  const title = [
    briefingStatus.label,
    briefingStatus.headline,
    briefingStatus.activityLabel,
    briefingStatus.detail,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      data-testid="shell-header-briefing-status"
      title={title}
      aria-label={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        minWidth: 0,
        maxWidth: 372,
        minHeight: 30,
        padding: "5px 10px",
        borderRadius: 10,
        background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.025))",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          background: toneColor,
          boxShadow: `0 0 8px ${toneColor}`,
          flexShrink: 0,
        }}
      />
      <StatusText maxWidth={142}>{primaryLabel}</StatusText>
      {activityDisplayLabel ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            maxWidth: 92,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            padding: "3px 7px",
            borderRadius: 9999,
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: 0,
            color: activityToneColor,
            background: `${activityToneColor}14`,
            border: `1px solid ${activityToneColor}30`,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {activityDisplayLabel}
        </span>
      ) : null}
      {briefingStatus.nextLabel ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            minWidth: 0,
            paddingLeft: activityDisplayLabel ? 0 : 2,
            color: "rgba(205,214,244,0.52)",
            flex: "0 1 auto",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 1,
              height: 14,
              background: "rgba(255,255,255,0.08)",
              flexShrink: 0,
            }}
          />
          <StatusText color="rgba(205,214,244,0.58)" maxWidth={84} weight={500}>
            {briefingStatus.nextLabel}
          </StatusText>
        </span>
      ) : null}
    </div>
  );
}
