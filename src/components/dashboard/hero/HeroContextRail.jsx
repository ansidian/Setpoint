import HeroFocusCard from "./HeroFocusCard";

export default function HeroContextRail({
  accent,
  eventLoadingState = "ready",
  focusWindows,
  isMobile = false,
  onOpenPressure,
  openDaySummary,
  stacked = false,
  weather,
  weatherIcon,
}) {
  const IconComponent = weatherIcon;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: stacked && !isMobile ? "row" : "column",
        gap: isMobile ? 8 : 10,
        minWidth: 0,
        paddingLeft: isMobile ? 0 : 18,
        borderLeft: isMobile ? "none" : "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div
        style={{
          flex: stacked && !isMobile ? 1 : "unset",
          padding: isMobile ? "10px 12px" : "0 0 8px",
          borderRadius: 0,
          background: "transparent",
          border: "none",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: isMobile ? 36 : 38,
            height: isMobile ? 36 : 38,
            borderRadius: 10,
            background: isMobile ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.025)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <IconComponent size={20} color="#cdd6f4" />
        </div>
        <div>
          <div
            style={{
              fontSize: isMobile ? 15 : 18,
              fontWeight: 500,
              color: "#cdd6f4",
              lineHeight: 1,
            }}
          >
            {weather?.temp != null ? `${Math.round(weather.temp)}°` : "—"}
          </div>
          <div
            style={{
              fontSize: isMobile ? 10 : 10.5,
              color: "rgba(205,214,244,0.5)",
              marginTop: 3,
              letterSpacing: 0.2,
            }}
          >
            {weather?.condition || ""}
            {weather?.city ? ` · ${weather.city}` : ""}
          </div>
        </div>
      </div>

      <HeroFocusCard
        focusWindows={focusWindows}
        openDaySummary={openDaySummary}
        accent={accent}
        isMobile={isMobile}
        onOpenPressure={onOpenPressure}
        eventLoadingState={eventLoadingState}
      />
    </div>
  );
}
