import { useEffect, useRef, useState } from "react";
import { SiActualbudget } from "@icons-pack/react-simple-icons";
import { getActualCacheStatus, hydrateActualBudgetCache, removeActualBudgetConnection, saveActualBudgetConnection, testActualBudget } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SectionLabel,
  SettingsCard,
  StatusPill,
  FieldHint,
} from "@/components/settings/settings-ui";
import {
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SETTINGS_SECONDARY_BUTTON_CLASS,
} from "@/components/settings/settings-core";
import type { SettingsCardStateProps, SettingsConnectionRefreshProps } from "../settingsTypes";
import type { ActualCacheHydrationResponse, ActualCacheStatusResponse } from "../../../../shared/types/bills";

type TestStatus = "testing" | "ok" | "fail" | null;
type HydrateStatus = "checking" | "hydrating" | "ok" | "missing" | "fail" | null;
type CacheSummaryResult = (ActualCacheStatusResponse | ActualCacheHydrationResponse) & {
  budgetId?: string;
  dbSizeBytes?: number;
  backupCount?: number;
};
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

function formatCacheSize(bytes: unknown) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function cacheSummary(result: CacheSummaryResult | null) {
  const parts: string[] = [];
  if (result?.budgetId) parts.push(result.budgetId);
  const dbSize = formatCacheSize(result?.dbSizeBytes);
  if (dbSize) parts.push(`DB ${dbSize}`);
  if (result && Number.isFinite(result.backupCount)) {
    parts.push(`${result.backupCount} backup${result.backupCount === 1 ? "" : "s"}`);
  }
  return parts.join("; ");
}

function hydrateStatusTone(status: HydrateStatus) {
  if (status === "ok") return "success";
  if (status === "missing") return "warning";
  if (status === "fail") return "danger";
  return "neutral";
}

function hydrateStatusLabel(status: HydrateStatus, message: string | null) {
  if (status === "checking") return "Checking cache";
  if (status === "ok") return "Cache ready";
  if (status === "missing") return "Cache missing";
  if (status === "fail") return `Cache failed${message ? `: ${message}` : ""}`;
  return null;
}

export default function ActualBudgetConnectionCard({
  settings,
  onRefreshConnections = async () => {},
}: Pick<SettingsCardStateProps, "settings"> & SettingsConnectionRefreshProps) {
  const [actualForm, setActualForm] = useState({ serverUrl: "", password: "", syncId: "" });
  const [actualConfigured, setActualConfigured] = useState(false);
  const [actualDirty, setActualDirty] = useState(false);
  const [actualSavingSecret, setActualSavingSecret] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [hydrateStatus, setHydrateStatus] = useState<HydrateStatus>(null);
  const [hydrateMsg, setHydrateMsg] = useState<string | null>(null);
  const [hydrateResult, setHydrateResult] = useState<CacheSummaryResult | null>(null);
  const cacheStatusRequestRef = useRef(0);

  function markActualDirty() {
    cacheStatusRequestRef.current += 1;
    setActualDirty(true);
    setHydrateStatus(null);
    setHydrateMsg(null);
    setHydrateResult(null);
  }

  useEffect(() => {
    if (!(settings?.actual_budget_url || settings?.actual_budget_sync_id || settings?.actual_budget_configured)) {
      return;
    }
    setActualForm({
      serverUrl: settings.actual_budget_url || "",
      password: "",
      syncId: settings.actual_budget_sync_id || "",
    });
    setActualConfigured(!!(settings.actual_budget_url || settings.actual_budget_configured));
  }, [settings?.actual_budget_url, settings?.actual_budget_sync_id, settings?.actual_budget_configured]);

  useEffect(() => {
    if (!actualConfigured || actualDirty) return undefined;

    const requestId = cacheStatusRequestRef.current + 1;
    cacheStatusRequestRef.current = requestId;
    setHydrateStatus("checking");
    setHydrateMsg(null);
    setHydrateResult(null);

    getActualCacheStatus()
      .then((result) => {
        if (cacheStatusRequestRef.current !== requestId) return;
        setHydrateResult(result as CacheSummaryResult);
        if (result?.hydrated) {
          setHydrateStatus("ok");
          setHydrateMsg(null);
        } else {
          setHydrateStatus("missing");
          setHydrateMsg(result?.message || "Actual local budget cache not found");
        }
      })
      .catch((error) => {
        if (cacheStatusRequestRef.current !== requestId) return;
        setHydrateStatus("fail");
        setHydrateMsg(errorMessage(error, "Cache check failed"));
        setHydrateResult(null);
      });

    return () => {
      if (cacheStatusRequestRef.current === requestId) {
        cacheStatusRequestRef.current += 1;
      }
    };
  }, [actualConfigured, actualDirty, settings?.actual_budget_url, settings?.actual_budget_sync_id]);

  async function handleSaveActualSecret() {
    setActualSavingSecret(true);
    setTestStatus("testing");
    setTestMsg(null);
    try {
      const candidate = {
        serverURL: actualForm.serverUrl,
        syncId: actualForm.syncId,
        ...(actualForm.password ? { password: actualForm.password } : {}),
      };
      await saveActualBudgetConnection(candidate);
      sessionStorage.setItem("ea_settings_changed", "1");
      window.dispatchEvent(new CustomEvent("ea-settings-changed"));
      setActualConfigured(true);
      setActualDirty(false);
      setActualForm((current) => ({ ...current, password: "" }));
      setTestStatus("ok");
      setHydrateStatus(null);
      setHydrateResult(null);
      await onRefreshConnections().catch(() => {});
    } catch (error) {
      setTestStatus("fail");
      setTestMsg(errorMessage(error, "Connection could not be saved"));
    } finally {
      setActualSavingSecret(false);
    }
  }

  async function handleRemoveActualConnection() {
    setRemoving(true);
    setTestMsg(null);
    try {
      await removeActualBudgetConnection();
      sessionStorage.setItem("ea_settings_changed", "1");
      window.dispatchEvent(new CustomEvent("ea-settings-changed"));
      setActualConfigured(false);
      setActualDirty(false);
      setActualForm({ serverUrl: "", password: "", syncId: "" });
      setConfirmingRemoval(false);
      setTestStatus(null);
      setHydrateStatus(null);
      setHydrateMsg(null);
      setHydrateResult(null);
      await onRefreshConnections().catch(() => {});
    } catch (error) {
      setTestStatus("fail");
      setTestMsg(errorMessage(error, "Actual credentials could not be removed"));
    } finally {
      setRemoving(false);
    }
  }

  async function handleTestActual() {
    setTestStatus("testing");
    setTestMsg(null);
    try {
      const overrides = actualDirty
        ? {
            serverURL: actualForm.serverUrl,
            password: actualForm.password || undefined,
            syncId: actualForm.syncId,
          }
        : null;
      const result = await testActualBudget(overrides);
      setTestStatus(result.success ? "ok" : "fail");
      if (!result.success && result.message) setTestMsg(result.message);
    } catch (error) {
      setTestStatus("fail");
      setTestMsg(errorMessage(error, "Connection failed"));
    }
  }

  async function handleHydrateActualCache() {
    // Mirror the auto-effect's request-id guard so a late hydrate resolution can't
    // clobber a newer cache-status check (or hydrate) and flash an incorrect pill.
    const requestId = cacheStatusRequestRef.current + 1;
    cacheStatusRequestRef.current = requestId;
    setHydrateStatus("hydrating");
    setHydrateMsg(null);
    setHydrateResult(null);
    try {
      const result = await hydrateActualBudgetCache();
      if (cacheStatusRequestRef.current !== requestId) return;
      setHydrateStatus("ok");
      setHydrateResult(result as CacheSummaryResult);
    } catch (error) {
      if (cacheStatusRequestRef.current !== requestId) return;
      setHydrateStatus("fail");
      setHydrateMsg(errorMessage(error, "Cache hydration failed"));
    }
  }

  return (
    <SettingsCard
      id="actual-budget-connection"
      ready={hydrateStatus !== "checking"}
      title="Actual Budget"
      icon={<SiActualbudget size={14} title="" aria-hidden="true" />}
      description="Connect the Actual server used for finance sync and transaction actions."
    >
      <div className="flex flex-col gap-4">
        <div>
          <SectionLabel>Server URL</SectionLabel>
          <Input
            type="url"
            placeholder="https://actual.yourdomain.com"
            value={actualForm.serverUrl}
            onChange={(event) => {
              setActualForm((current) => ({ ...current, serverUrl: event.target.value }));
              markActualDirty();
            }}
          />
        </div>
        <div>
          <SectionLabel>Password</SectionLabel>
          <Input
            type="password"
            placeholder={
              actualConfigured && !actualDirty
                ? "••••••••  (saved)"
                : "Actual Budget password"
            }
            value={actualForm.password}
            onChange={(event) => {
              setActualForm((current) => ({ ...current, password: event.target.value }));
              markActualDirty();
            }}
          />
        </div>
        <div>
          <SectionLabel>Sync ID</SectionLabel>
          <Input
            type="text"
            placeholder="Budget sync ID"
            value={actualForm.syncId}
            onChange={(event) => {
              setActualForm((current) => ({ ...current, syncId: event.target.value }));
              markActualDirty();
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleSaveActualSecret}
            className={SETTINGS_PRIMARY_BUTTON_CLASS}
            disabled={!actualDirty || actualSavingSecret}
            size="sm"
          >
            {actualSavingSecret ? "Saving & verifying…" : "Save & verify"}
          </Button>
          <Button
            variant="secondary"
            className={SETTINGS_SECONDARY_BUTTON_CLASS}
            size="sm"
            onClick={handleTestActual}
            disabled={testStatus === "testing"}
          >
            {testStatus === "testing" ? "Checking…" : "Check connection"}
          </Button>
          <Button
            variant="secondary"
            className={SETTINGS_SECONDARY_BUTTON_CLASS}
            size="sm"
            onClick={handleHydrateActualCache}
            disabled={!actualConfigured || actualDirty || hydrateStatus === "hydrating"}
          >
            {hydrateStatus === "hydrating" ? "Hydrating..." : "Hydrate Cache"}
          </Button>
          {testStatus && testStatus !== "testing" ? (
            <StatusPill tone={testStatus === "ok" ? "success" : "danger"}>
              {testStatus === "ok" ? "Connected" : `Failed${testMsg ? `: ${testMsg}` : ""}`}
            </StatusPill>
          ) : actualConfigured && !actualDirty ? (
            <StatusPill tone="success">Configured</StatusPill>
          ) : null}
          {hydrateStatus && hydrateStatus !== "hydrating" ? (
            <StatusPill tone={hydrateStatusTone(hydrateStatus)}>
              {hydrateStatusLabel(hydrateStatus, hydrateMsg)}
            </StatusPill>
          ) : null}
        </div>
        {hydrateStatus === "ok" && cacheSummary(hydrateResult) ? (
          <p className="text-[11px] leading-4 text-muted-foreground/75">
            {cacheSummary(hydrateResult)}
          </p>
        ) : hydrateStatus === "missing" && hydrateMsg ? (
          <p className="text-[11px] leading-4 text-muted-foreground/75">
            {hydrateMsg}
          </p>
        ) : null}
        {actualConfigured && !actualDirty ? (
          <div className="border-t border-white/[0.06] pt-4">
            {confirmingRemoval ? (
              <div className="flex flex-col gap-3">
                <FieldHint>
                  Finance sync and transaction actions will stop. Bill-pay mappings and utility links stay saved.
                </FieldHint>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={removing}
                    onClick={handleRemoveActualConnection}
                    className="transition-[transform,background-color] duration-200 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-danger/60 active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none"
                  >
                    {removing ? "Removing…" : "Confirm remove Actual credentials"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={removing}
                    onClick={() => setConfirmingRemoval(false)}
                    className={SETTINGS_SECONDARY_BUTTON_CLASS}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRemoval(true)}
                className="rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground/75 transition-[color,background-color,transform] duration-200 hover:-translate-y-px hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60 active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none"
              >
                Remove Actual credentials
              </button>
            )}
          </div>
        ) : null}
      </div>
    </SettingsCard>
  );
}
