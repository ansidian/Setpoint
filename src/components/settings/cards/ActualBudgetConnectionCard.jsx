import { useEffect, useState } from "react";
import { SiActualbudget } from "@icons-pack/react-simple-icons";
import { testActualBudget, updateSettings } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SectionLabel,
  SettingsCard,
  StatusPill,
} from "@/components/settings/settings-ui";
import {
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SETTINGS_SECONDARY_BUTTON_CLASS,
} from "@/components/settings/settings-core";

export default function ActualBudgetConnectionCard({ settings }) {
  const [actualForm, setActualForm] = useState({ serverUrl: "", password: "", syncId: "" });
  const [actualConfigured, setActualConfigured] = useState(false);
  const [actualDirty, setActualDirty] = useState(false);
  const [actualSavingSecret, setActualSavingSecret] = useState(false);
  const [testStatus, setTestStatus] = useState(null);
  const [testMsg, setTestMsg] = useState(null);

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

  async function handleSaveActualSecret() {
    setActualSavingSecret(true);
    try {
      const payload = {
        actual_budget_url: actualForm.serverUrl,
        actual_budget_sync_id: actualForm.syncId,
      };
      if (actualForm.password) payload.actual_budget_password = actualForm.password;
      await updateSettings(payload);
      sessionStorage.setItem("ea_settings_changed", "1");
      window.dispatchEvent(new CustomEvent("ea-settings-changed"));
      setActualConfigured(true);
      setActualDirty(false);
      setActualForm((current) => ({ ...current, password: "" }));
    } finally {
      setActualSavingSecret(false);
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
        : undefined;
      const result = await testActualBudget(overrides);
      setTestStatus(result.success ? "ok" : "fail");
      if (!result.success && result.message) setTestMsg(result.message);
    } catch (error) {
      setTestStatus("fail");
      setTestMsg(error.message || "Connection failed");
    }
  }

  return (
    <SettingsCard
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
              setActualDirty(true);
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
              setActualDirty(true);
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
              setActualDirty(true);
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
            {actualSavingSecret ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="secondary"
            className={SETTINGS_SECONDARY_BUTTON_CLASS}
            size="sm"
            onClick={handleTestActual}
            disabled={testStatus === "testing"}
          >
            {testStatus === "testing" ? "Testing…" : "Test Connection"}
          </Button>
          {testStatus && testStatus !== "testing" ? (
            <StatusPill tone={testStatus === "ok" ? "success" : "danger"}>
              {testStatus === "ok" ? "Connected" : `Failed${testMsg ? `: ${testMsg}` : ""}`}
            </StatusPill>
          ) : actualConfigured && !actualDirty ? (
            <StatusPill tone="success">Configured</StatusPill>
          ) : null}
        </div>
      </div>
    </SettingsCard>
  );
}
