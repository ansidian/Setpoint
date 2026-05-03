import { useState, useEffect } from "react";
import {
  getLatestBriefing,
  triggerGeneration,
  quickRefresh,
  pollStatus,
  checkInProgress,
  getSettings,
} from "../api";
import { transformBriefing } from "../transform";

// Module-level cache: survives route changes within a session, resets on full
// page reload. Lets Dashboard paint instantly on remount while it revalidates
// in the background.
let cache = null;

export default function useBriefingData({ liveData, isMock }) {
  const hasCache = !isMock && cache !== null && cache.briefing != null;
  const [briefing, setBriefing] = useState(hasCache ? cache.briefing : null);
  const [loading, setLoading] = useState(!hasCache);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(hasCache);
  const [modelLabel, setModelLabel] = useState(hasCache ? cache.modelLabel : "AI");
  const [genProgress, setGenProgress] = useState(null);
  const [viewingPast, setViewingPast] = useState(null);
  const [latestBriefing, setLatestBriefing] = useState(hasCache ? cache.briefing : null);
  const [latestId, setLatestId] = useState(hasCache ? cache.latestId : null);
  const [schedules, setSchedules] = useState(hasCache ? cache.schedules : []);
  const [renderConfigured, setRenderConfigured] = useState(hasCache ? cache.renderConfigured : false);
  const [lastQuickRefreshAt, setLastQuickRefreshAt] = useState(null);

  // --- Polling ---

  function startPolling(id) {
    setGenerating(true);
    const poll = setInterval(async () => {
      try {
        const { status, error_message, progress } = await pollStatus(id);
        if (progress) setGenProgress(progress);
        if (status === "ready") {
          clearInterval(poll);
          setGenProgress(null);
          const res = await getLatestBriefing();
          const transformed = transformBriefing(res.briefing);
          setBriefing(transformed);
          setLatestBriefing(transformed);
          setLatestId(res.id);
          setViewingPast(null);
          setGenerating(false);
          cache = { ...(cache || {}), briefing: transformed, latestId: res.id };
        } else if (status === "error") {
          clearInterval(poll);
          setGenProgress(null);
          setError(error_message);
          setGenerating(false);
        }
      } catch {
        clearInterval(poll);
        setGenProgress(null);
        setError("Lost connection while generating briefing.");
        setGenerating(false);
      }
    }, 2000);
  }

  // --- Data fetching ---

  useEffect(() => {
    getSettings()
      .then((s) => {
        const id = s?.email_ai_model || s?.claude_model || "claude-sonnet-4-6";
        const nextLabel = formatEmailAiModelLabel(id);
        setModelLabel(nextLabel);
        const nextSchedules = s?.schedules || [];
        if (s?.schedules) setSchedules(nextSchedules);
        const nextRenderConfigured = !!s?.render_configured;
        if (s?.render_configured) setRenderConfigured(true);
        cache = {
          ...(cache || {}),
          modelLabel: nextLabel,
          schedules: nextSchedules,
          renderConfigured: nextRenderConfigured,
        };
      })
      .catch(() => {});

    checkInProgress()
      .then(({ generating: inProgress, id, progress }) => {
        if (inProgress && id) {
          if (progress) setGenProgress(progress);
          startPolling(id);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    getLatestBriefing()
      .then((res) => {
        const transformed = transformBriefing(res.briefing);
        setBriefing(transformed);
        setLatestBriefing(transformed);
        setLatestId(res.id);
        cache = { ...(cache || {}), briefing: transformed, latestId: res.id };

        if (isMock) return;
        sessionStorage.removeItem("ea_settings_changed");
        setRefreshing(true);
        quickRefresh()
          .then((result) => {
            const updated = transformBriefing(result.briefingJson);
            setBriefing(updated);
            setLatestBriefing(updated);
            setLatestId(result.id);
            setLastQuickRefreshAt(Date.now());
            cache = { ...(cache || {}), briefing: updated, latestId: result.id };
          })
          .catch(() => {})
          .finally(() => setRefreshing(false));
      })
      .catch((err) => setError(err.message))
      .finally(() => {
        setLoading(false);
        setTimeout(() => setLoaded(true), 100);
      });
  }, [isMock]);

  // --- Dev scenario live apply ---

  useEffect(() => {
    const handler = async (e) => {
      const scenarios = e.detail?.scenarios;
      try {
        setLoading(true);
        const res = await getLatestBriefing(scenarios);
        const transformed = transformBriefing(res.briefing);
        setBriefing(transformed);
        setLatestBriefing(transformed);
        setLatestId(res.id);
        setViewingPast(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    window.addEventListener("devpanel:apply", handler);
    return () => window.removeEventListener("devpanel:apply", handler);
  }, []);

  // --- Actions ---

  async function handleQuickRefresh() {
    if (refreshing || generating) return;
    setRefreshing(true);
    try {
      const [result] = await Promise.all([
        quickRefresh(),
        liveData.refreshNow(),
      ]);
      const transformed = transformBriefing(result.briefingJson);
      setBriefing(transformed);
      setLatestBriefing(transformed);
      setLatestId(result.id);
      setViewingPast(null);
      setLastQuickRefreshAt(Date.now());
      cache = { ...(cache || {}), briefing: transformed, latestId: result.id };
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleFullGeneration() {
    setGenerating(true);
    try {
      const genResult = await triggerGeneration();
      startPolling(genResult.id);
    } catch (err) {
      setError(err.message);
      setGenerating(false);
    }
  }

  // --- History navigation ---

  function selectHistory(briefingData, meta) {
    setBriefing(briefingData);
    setViewingPast(meta.id === latestId ? null : meta);
  }

  function backToLatest() {
    setBriefing(latestBriefing);
    setViewingPast(null);
  }

  function navigateToEmail({ briefing: navBriefing, briefingId, generated_at, emailId, accountName }) {
    if (!latestBriefing) setLatestBriefing(briefing);
    setBriefing(navBriefing);
    if (briefingId !== latestId) {
      setViewingPast({ id: briefingId, generated_at });
    }
    return { navBriefing, emailId, accountName };
  }

  return {
    briefing,
    setBriefing,
    loading,
    refreshing,
    generating,
    error,
    loaded,
    modelLabel,
    genProgress,
    viewingPast,
    latestId,
    schedules,
    setSchedules,
    renderConfigured,
    lastQuickRefreshAt,
    handleQuickRefresh,
    handleFullGeneration,
    selectHistory,
    backToLatest,
    navigateToEmail,
  };
}

function formatEmailAiModelLabel(model) {
  if (!model) return "AI";
  const gptMatch = model.match(/^gpt-(\d+(?:\.\d+)?)(?:-(mini|nano))?/i);
  if (gptMatch) {
    const variant = gptMatch[2] ? ` ${gptMatch[2]}` : "";
    return `GPT-${gptMatch[1]}${variant}`;
  }
  const claudeMatch = model.match(/^claude-(opus|sonnet|haiku)-(\d+)-?(\d+)?/i);
  if (claudeMatch) {
    const family = claudeMatch[1].charAt(0).toUpperCase() + claudeMatch[1].slice(1);
    const version = claudeMatch[3] ? `${claudeMatch[2]}.${claudeMatch[3]}` : claudeMatch[2];
    return `${family} ${version}`;
  }
  return model;
}
