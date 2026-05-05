export function resolveDashboardBriefingState({ loading, error, briefing, activeSnapshot }) {
  const canRenderActiveSnapshot = !!activeSnapshot?.snapshot;
  const effectiveBriefing = briefing || null;

  if (loading && !canRenderActiveSnapshot) {
    return { view: "loading", canRenderActiveSnapshot, effectiveBriefing };
  }
  if (error && !effectiveBriefing) {
    return { view: "error", canRenderActiveSnapshot, effectiveBriefing, error };
  }
  if (!effectiveBriefing && !canRenderActiveSnapshot) {
    return { view: "empty", canRenderActiveSnapshot, effectiveBriefing };
  }
  return { view: "dashboard", canRenderActiveSnapshot, effectiveBriefing };
}
