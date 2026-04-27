export default function CalendarWorkspaceSupportBand({
  layout,
  mode,
  activeView,
  supportProps,
}) {
  const compact = mode === "editor";
  const quiet = mode === "detail" || mode === "empty";
  const minHeight = layout.stacked
    ? 0
    : compact
      ? layout.supportBandCollapsedHeight
      : quiet
        ? layout.supportBandQuietHeight || layout.supportBandMinHeight
      : layout.supportBandMinHeight;
  const innerPadding = layout.tier === "xl" ? 10 : layout.tier === "lg" ? 8 : 6;
  const content = activeView.renderWorkspaceSupport?.({
    ...supportProps,
    mode,
    layout,
  }) || null;

  return (
    <section
      data-testid="calendar-modal-support-band"
      data-support-mode={mode}
      style={{
        position: "relative",
        height: !compact && !layout.stacked && layout.tier !== "md" ? minHeight : "auto",
        minHeight: compact || layout.stacked || layout.tier === "md" ? minHeight : undefined,
        overflow: compact ? "visible" : "hidden",
        borderRadius: 16,
        border: compact
          ? "1px solid rgba(255,255,255,0.05)"
          : quiet
            ? "1px solid rgba(255,255,255,0.045)"
          : "1px solid rgba(255,255,255,0.06)",
        background: compact
          ? "linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.018))"
          : quiet
            ? "linear-gradient(180deg, rgba(255,255,255,0.026), rgba(255,255,255,0.014))"
          : [
              "radial-gradient(circle at top left, rgba(203,166,218,0.12), transparent 34%)",
              "linear-gradient(180deg, rgba(255,255,255,0.038), rgba(255,255,255,0.018))",
            ].join(", "),
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          position: "relative",
          zIndex: 1,
          boxSizing: "border-box",
          width: "100%",
          height: "auto",
          minHeight: 0,
          overflow: "visible",
          padding: innerPadding,
        }}
      >
        {content}
      </div>
    </section>
  );
}
