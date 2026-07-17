export type DashboardBootState<TBriefing> =
  | { view: "loading"; canRenderActiveSnapshot: boolean; effectiveBriefing: TBriefing | null }
  | { view: "error"; canRenderActiveSnapshot: boolean; effectiveBriefing: null; error: string }
  | { view: "empty"; canRenderActiveSnapshot: boolean; effectiveBriefing: null }
  | { view: "dashboard"; canRenderActiveSnapshot: boolean; effectiveBriefing: TBriefing | null };

export function resolveDashboardBriefingState<TBriefing>({
  loading,
  error,
  briefing,
  activeSnapshot,
}: {
  loading: boolean;
  error: string | null;
  briefing: TBriefing | null;
  activeSnapshot: { snapshot?: unknown } | null;
}): DashboardBootState<TBriefing> {
  const canRenderActiveSnapshot = !!activeSnapshot?.snapshot;
  const effectiveBriefing = briefing || null;

  if (loading && !canRenderActiveSnapshot) {
    return { view: "loading", canRenderActiveSnapshot, effectiveBriefing };
  }
  if (error && !effectiveBriefing) {
    return { view: "error", canRenderActiveSnapshot, effectiveBriefing: null, error };
  }
  if (!effectiveBriefing && !canRenderActiveSnapshot) {
    return { view: "empty", canRenderActiveSnapshot, effectiveBriefing: null };
  }
  return { view: "dashboard", canRenderActiveSnapshot, effectiveBriefing };
}
