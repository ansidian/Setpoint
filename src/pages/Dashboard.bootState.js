export const EMPTY_CURRENT_BRIEFING = {
  generatedAt: "",
  dataUpdatedAt: null,
  aiGeneratedAt: null,
  skippedAI: false,
  nonAiGenerationCount: 0,
  weather: null,
  aiInsights: [],
  calendar: [],
  ctm: { upcoming: [], stats: null },
  todoist: { upcoming: [], stats: null },
  model: null,
  emails: { summary: "", accounts: [] },
};

export function resolveDashboardBriefingState({ loading, error, briefing, activeSnapshot }) {
  const canRenderActiveSnapshot = !!activeSnapshot?.snapshot;
  const effectiveBriefing = briefing || (canRenderActiveSnapshot ? EMPTY_CURRENT_BRIEFING : null);

  if (loading && !canRenderActiveSnapshot) {
    return { view: "loading", canRenderActiveSnapshot, effectiveBriefing };
  }
  if (error && !effectiveBriefing) {
    return { view: "error", canRenderActiveSnapshot, effectiveBriefing, error };
  }
  if (!effectiveBriefing) {
    return { view: "empty", canRenderActiveSnapshot, effectiveBriefing };
  }
  return { view: "dashboard", canRenderActiveSnapshot, effectiveBriefing };
}
