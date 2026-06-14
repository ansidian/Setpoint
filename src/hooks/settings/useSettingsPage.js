import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getAccounts, getSettings, updateSettings } from "@/api";
import {
  normalizeSettingsTab,
  readTabFromSearchParams,
} from "@/components/settings/settings-core";

export function mergeFailedPayload(pending, failed) {
  // A failed flush must not silently drop the user's edits. Re-queue the failed
  // fields, but let any edits made DURING the in-flight request (already in
  // `pending`) win, so we never clobber newer values with stale ones.
  return { ...failed, ...pending };
}

function useSettingsAutoSave() {
  const [status, setStatus] = useState("idle");
  const pendingRef = useRef({});
  const timerRef = useRef(null);
  const statusTimerRef = useRef(null);

  const flushPending = useCallback(async ({ updateUi = true } = {}) => {
    const payload = pendingRef.current;
    pendingRef.current = {};
    if (!Object.keys(payload).length) return;
    if (updateUi) setStatus("saving");
    try {
      await updateSettings(payload);
      sessionStorage.setItem("ea_settings_changed", "1");
      window.dispatchEvent(new CustomEvent("ea-settings-changed"));
      if (updateUi) {
        setStatus("saved");
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = setTimeout(
          () => setStatus((current) => (current === "saved" ? "idle" : current)),
          1500
        );
      }
    } catch {
      // MERGE-NOTE (P1-3 ↔ P2-10): re-queue the failed payload instead of
      // discarding it. Previously pendingRef was cleared at the top (line ~17)
      // before the await, so any 400 silently dropped EVERY co-batched setting.
      // P2-10 in the parallel audit is the same root defect (debounced auto-save
      // discards unrelated pending edits on one rejected field) — this fix
      // covers it. If the P2-10 worktree also touches flushPending, keep this
      // re-queue; reconcile rather than reverting to the discard-on-failure form.
      pendingRef.current = mergeFailedPayload(pendingRef.current, payload);
      if (updateUi) setStatus("error");
    }
  }, []);

  const flush = useCallback(() => flushPending(), [flushPending]);

  const patch = useCallback((updates) => {
    Object.assign(pendingRef.current, updates);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 500);
  }, [flush]);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    clearTimeout(statusTimerRef.current);
    flushPending({ updateUi: false });
  }, [flushPending]);

  return { patch, status };
}

export default function useSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [accounts, setAccounts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const { patch, status: saveStatus } = useSettingsAutoSave();
  const tab = readTabFromSearchParams(searchParams);

  const setTab = useCallback((nextTab) => {
    const resolvedTab = normalizeSettingsTab(nextTab);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (resolvedTab === "accounts") next.delete("tab");
      else next.set("tab", resolvedTab);
      return next;
    });
  }, [setSearchParams]);

  useEffect(() => {
    Promise.all([getAccounts(), getSettings()])
      .then(([accountsResult, settingsResult]) => {
        setAccounts(accountsResult.accounts || accountsResult);
        setSettings(settingsResult);
      })
      .catch(() => {
        setAccounts([]);
        setSettings({});
      })
      .finally(() => setLoading(false));
  }, []);

  return {
    accounts,
    setAccounts,
    settings,
    setSettings,
    loading,
    tab,
    setTab,
    saveStatus,
    patch,
  };
}
