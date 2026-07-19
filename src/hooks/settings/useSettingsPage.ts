import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getAccounts, getCapabilities, getInstanceCredentials, getSettings, updateSettings } from "@/api";
import {
  normalizeSettingsTab,
  readTabFromSearchParams,
} from "@/components/settings/settings-core";
import { CONNECTION_GROUPS, projectConnectionRows } from "@/components/settings/connectionModel";
import type { AccountSummary } from "../../../shared/types/accounts";
import type { SettingsPatchRequest, SettingsResponse } from "../../../shared/types/settings";
import type { SettingsTab } from "@/components/settings/settings-core";
import type { CapabilityStatus } from "../../../shared/types/capabilities";
import type { InstanceCredentialMetadata } from "../../../shared/types/instance-credentials";

export type SettingsSaveStatus = "idle" | "saving" | "saved" | "error";
type PendingSettingsPatch = Partial<SettingsPatchRequest>;

export function mergeFailedPayload(pending: PendingSettingsPatch, failed: PendingSettingsPatch): PendingSettingsPatch {
  // A failed flush must not silently drop the user's edits. Re-queue the failed
  // fields, but let any edits made DURING the in-flight request (already in
  // `pending`) win, so we never clobber newer values with stale ones.
  return { ...failed, ...pending };
}

function useSettingsAutoSave() {
  const [status, setStatus] = useState<SettingsSaveStatus>("idle");
  const pendingRef = useRef<PendingSettingsPatch>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPending = useCallback(async ({ updateUi = true }: { updateUi?: boolean } = {}) => {
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
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
        statusTimerRef.current = setTimeout(
          () => setStatus((current) => (current === "saved" ? "idle" : current)),
          1500
        );
      }
    } catch {
      // A rejected debounced PUT used to clear pendingRef at the top before the
      // await, silently dropping every co-batched setting when one field was bad
      // (e.g. a blank schedule label). Re-queue the failed payload; edits made
      // DURING the in-flight request (already in pendingRef) win over the stale
      // re-queued values.
      pendingRef.current = mergeFailedPayload(pendingRef.current, payload);
      if (updateUi) setStatus("error");
    }
  }, []);

  const flush = useCallback(() => flushPending(), [flushPending]);

  const patch = useCallback((updates: PendingSettingsPatch) => {
    Object.assign(pendingRef.current, updates);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 500);
  }, [flush]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    flushPending({ updateUi: false });
  }, [flushPending]);

  return { patch, status };
}

export default function useSettingsPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [settings, setSettings] = useState<Partial<SettingsResponse> | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityStatus[]>([]);
  const [credentialMetadata, setCredentialMetadata] = useState<InstanceCredentialMetadata[] | null>(null);
  const [loading, setLoading] = useState(true);
  const { patch, status: saveStatus } = useSettingsAutoSave();
  const tab = readTabFromSearchParams(searchParams);

  const setTab = useCallback((nextTab: SettingsTab) => {
    const resolvedTab = normalizeSettingsTab(nextTab);
    const next = new URLSearchParams(searchParams);
    if (resolvedTab === "connections") next.delete("tab");
    else next.set("tab", resolvedTab);
    navigate({
      pathname: location.pathname,
      search: next.toString() ? `?${next}` : "",
      hash: "",
    });
  }, [location.pathname, navigate, searchParams]);

  useEffect(() => {
    Promise.all([
      getAccounts(),
      getSettings(),
      getCapabilities().catch(() => ({ generatedAt: "", capabilities: [] })),
      getInstanceCredentials().catch(() => null),
    ])
      .then(([accountsResult, settingsResult, capabilityResult, credentialResult]) => {
        setAccounts(Array.isArray(accountsResult) ? accountsResult : accountsResult.accounts);
        setSettings(settingsResult);
        setCapabilities(capabilityResult.capabilities);
        setCredentialMetadata(credentialResult?.credentials ?? null);
      })
      .catch(() => {
        setAccounts([]);
        setSettings({});
      })
      .finally(() => setLoading(false));
  }, []);

  const refreshCapabilities = useCallback(() => {
    void getCapabilities(true)
      .then((result) => setCapabilities(result.capabilities))
      .catch(() => {});
  }, []);

  const refreshInstanceCredentials = useCallback(async () => {
    try {
      const result = await getInstanceCredentials();
      setCredentialMetadata(result.credentials);
    } catch (error) {
      setCredentialMetadata(null);
      throw error;
    }
  }, []);

  const updateInstanceCredentialMetadata = useCallback((updates: InstanceCredentialMetadata | InstanceCredentialMetadata[]) => {
    const nextUpdates = Array.isArray(updates) ? updates : [updates];
    setCredentialMetadata((current) => {
      if (current === null) return nextUpdates;
      const nextByKey = new Map(nextUpdates.map((metadata) => [metadata.key, metadata]));
      const merged = current.map((metadata) => nextByKey.get(metadata.key) ?? metadata);
      const currentKeys = new Set(current.map(({ key }) => key));
      return [...merged, ...nextUpdates.filter(({ key }) => !currentKeys.has(key))];
    });
  }, []);

  const connections = useMemo(() => projectConnectionRows({
    accounts,
    settings,
    capabilities,
    credentialMetadata,
  }), [accounts, settings, capabilities, credentialMetadata]);

  return {
    accounts,
    setAccounts,
    settings,
    capabilities,
    connectionGroups: CONNECTION_GROUPS,
    connections,
    credentialMetadata,
    refreshCapabilities,
    refreshInstanceCredentials,
    updateInstanceCredentialMetadata,
    setSettings,
    loading,
    tab,
    setTab,
    saveStatus,
    patch,
  };
}
