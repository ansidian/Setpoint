import { lazy, Suspense, useEffect, useState } from "react";
import { Mail, MapPin } from "lucide-react";
import { SiActualbudget, SiTodoist } from "@icons-pack/react-simple-icons";
import {
  addICloudAccount,
  geocodeLocation,
  getAccounts,
  getGmailAuthUrl,
  removeAccount,
  testActualBudget,
  updateSettings,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FieldHint,
  SectionLabel,
  SettingsCard,
  StatusPill,
} from "@/components/settings/settings-ui";
import {
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SETTINGS_SECONDARY_BUTTON_CLASS,
  SURFACE_ROW_CLASS,
} from "@/components/settings/settings-core";
import { cn } from "@/lib/utils";

const AccountsList = lazy(() => import("@/components/settings/AccountsList"));

export default function AccountsSettingsSection({ accounts, setAccounts, settings, patch }) {
  const [icloudForm, setIcloudForm] = useState({ email: "", password: "", show: false });
  const [icloudError, setIcloudError] = useState(null);
  const [actualForm, setActualForm] = useState({ serverUrl: "", password: "", syncId: "" });
  const [actualConfigured, setActualConfigured] = useState(false);
  const [actualDirty, setActualDirty] = useState(false);
  const [actualSavingSecret, setActualSavingSecret] = useState(false);
  const [todoistToken, setTodoistToken] = useState("");
  const [todoistConfigured, setTodoistConfigured] = useState(false);
  const [todoistDirty, setTodoistDirty] = useState(false);
  const [todoistSavingSecret, setTodoistSavingSecret] = useState(false);
  const [weatherForm, setWeatherForm] = useState({
    location: "",
    lat: "",
    lng: "",
    geocoding: false,
    results: null,
  });
  const [testStatus, setTestStatus] = useState(null);
  const [testMsg, setTestMsg] = useState(null);

  useEffect(() => {
    if (!settings?.weather_location) return;
    setWeatherForm({
      location: settings.weather_location || "",
      lat: settings.weather_lat?.toString() || "",
      lng: settings.weather_lng?.toString() || "",
      geocoding: false,
      results: null,
    });
  }, [settings?.weather_location, settings?.weather_lat, settings?.weather_lng]);

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
    if (settings?.todoist_configured) {
      setTodoistConfigured(true);
    }
  }, [settings?.todoist_configured]);

  async function handleAddGmail() {
    const { url } = await getGmailAuthUrl();
    window.location.href = url;
  }

  async function handleAddICloud() {
    try {
      setIcloudError(null);
      await addICloudAccount(icloudForm.email, icloudForm.password);
      const refreshedAccounts = await getAccounts();
      setAccounts(refreshedAccounts.accounts || refreshedAccounts);
      setIcloudForm({ email: "", password: "", show: false });
    } catch (error) {
      setIcloudError(error.message || "Failed to add iCloud account");
    }
  }

  async function handleRemoveAccount(id) {
    try {
      await removeAccount(id);
      setAccounts((current) => current.filter((account) => account.id !== id));
    } catch (error) {
      console.error("Remove account failed:", error);
    }
  }

  async function handleGeocode() {
    if (!weatherForm.location) return;
    setWeatherForm((current) => ({ ...current, geocoding: true, results: null }));
    try {
      const results = await geocodeLocation(weatherForm.location);
      if (results.length === 1) {
        selectLocation(results[0]);
      } else {
        setWeatherForm((current) => ({ ...current, geocoding: false, results }));
      }
    } catch {
      setWeatherForm((current) => ({ ...current, geocoding: false }));
    }
  }

  function selectLocation(location) {
    setWeatherForm({
      location: location.name,
      lat: location.lat.toString(),
      lng: location.lng.toString(),
      geocoding: false,
      results: null,
    });
    patch({ weather_location: location.name, weather_lat: location.lat, weather_lng: location.lng });
  }

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
      setActualConfigured(true);
      setActualDirty(false);
      setActualForm((current) => ({ ...current, password: "" }));
    } finally {
      setActualSavingSecret(false);
    }
  }

  async function handleSaveTodoistSecret() {
    setTodoistSavingSecret(true);
    try {
      await updateSettings({ todoist_api_token: todoistToken });
      sessionStorage.setItem("ea_settings_changed", "1");
      setTodoistConfigured(true);
      setTodoistDirty(false);
      setTodoistToken("");
    } finally {
      setTodoistSavingSecret(false);
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
    <>
      <SettingsCard
        title="Connected Accounts"
        icon={<Mail size={14} />}
        description="Inbox and calendar connections that feed the dashboard and briefing pipeline."
      >
        <div className="flex flex-col gap-4">
          {accounts.length > 0 ? (
            <Suspense fallback={<FieldHint>Loading connected accounts…</FieldHint>}>
              <AccountsList
                accounts={accounts}
                setAccounts={setAccounts}
                onRemove={handleRemoveAccount}
              />
            </Suspense>
          ) : (
            <div className="rounded-lg border border-dashed border-white/[0.1] px-3 py-3 text-[12px] text-muted-foreground/60">
              No accounts connected yet.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleAddGmail} className={SETTINGS_PRIMARY_BUTTON_CLASS}>
              Add Gmail
            </Button>
            <Button
              variant="outline"
              className={cn(
                SETTINGS_SECONDARY_BUTTON_CLASS,
                icloudForm.show && "border-primary/18 bg-primary/[0.08] text-primary"
              )}
              onClick={() => {
                setIcloudForm((current) => ({ ...current, show: !current.show }));
                setIcloudError(null);
              }}
            >
              {icloudForm.show ? "Cancel" : "Add iCloud"}
            </Button>
          </div>

          {icloudForm.show ? (
            <div className="border-t border-white/[0.05] pt-4">
              <div className="mb-3 flex items-center gap-2">
                <StatusPill tone="neutral">iCloud IMAP</StatusPill>
                <span className="text-[11px] text-muted-foreground/60">
                  Use an app-specific password from Apple ID settings.
                </span>
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <SectionLabel>iCloud email</SectionLabel>
                  <Input
                    type="email"
                    placeholder="name@icloud.com"
                    value={icloudForm.email}
                    onChange={(event) => {
                      setIcloudError(null);
                      setIcloudForm((current) => ({ ...current, email: event.target.value }));
                    }}
                  />
                </div>
                <div>
                  <SectionLabel>App-specific password</SectionLabel>
                  <Input
                    type="password"
                    placeholder="App-specific password"
                    value={icloudForm.password}
                    onChange={(event) => {
                      setIcloudError(null);
                      setIcloudForm((current) => ({ ...current, password: event.target.value }));
                    }}
                  />
                </div>
                {icloudError ? (
                  <FieldHint className="text-danger">{icloudError}</FieldHint>
                ) : null}
                <Button
                  onClick={handleAddICloud}
                  className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, "self-start")}
                >
                  Connect iCloud
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </SettingsCard>

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

      <SettingsCard
        title="Todoist"
        icon={<SiTodoist size={14} title="" aria-hidden="true" />}
        description="Optional task sync used when briefings create Todoist follow-ups."
      >
        <div className="flex flex-col gap-4">
          <div>
            <SectionLabel>API Token</SectionLabel>
            <Input
              type="password"
              placeholder={
                todoistConfigured && !todoistDirty
                  ? "••••••••  (saved)"
                  : "Todoist API token"
              }
              value={todoistToken}
              onChange={(event) => {
                setTodoistToken(event.target.value);
                setTodoistDirty(true);
              }}
            />
            <FieldHint className="mt-1">
              Find your token at Settings &gt; Integrations &gt; Developer in Todoist.
            </FieldHint>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleSaveTodoistSecret}
              className={SETTINGS_PRIMARY_BUTTON_CLASS}
              disabled={!todoistDirty || todoistSavingSecret}
              size="sm"
            >
              {todoistSavingSecret ? "Saving…" : "Save"}
            </Button>
            {todoistConfigured && !todoistDirty ? (
              <>
                <StatusPill tone="success">Connected</StatusPill>
                <button
                  type="button"
                  onClick={() => {
                    setTodoistToken("");
                    setTodoistDirty(true);
                    setTodoistConfigured(false);
                  }}
                  className="text-[11px] font-medium text-muted-foreground/55 transition-colors hover:text-danger"
                >
                  Disconnect
                </button>
              </>
            ) : null}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Weather Location"
        icon={<MapPin size={14} />}
        description="Set the location used for dashboard weather snapshots and daily briefing context."
      >
        <div className="flex flex-col gap-4">
          <div>
            <SectionLabel>City name</SectionLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="text"
                placeholder="El Monte, CA"
                value={weatherForm.location}
                onChange={(event) => setWeatherForm((current) => ({ ...current, location: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleGeocode();
                }}
                className="flex-1"
              />
              <Button
                variant="secondary"
                className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, "whitespace-nowrap")}
                onClick={handleGeocode}
                disabled={weatherForm.geocoding || !weatherForm.location}
              >
                {weatherForm.geocoding ? "Looking up…" : "Look up"}
              </Button>
            </div>
          </div>
          {weatherForm.results ? (
            <div className="flex flex-col gap-2">
              {weatherForm.results.map((result, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => selectLocation(result)}
                  className={cn(SURFACE_ROW_CLASS, "cursor-pointer px-3 py-3 text-left")}
                >
                  <div className="text-[13px] font-medium text-foreground/90">{result.name}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground/60">
                    {result.lat.toFixed(4)}, {result.lng.toFixed(4)}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
          {weatherForm.lat && weatherForm.lng ? (
            <StatusPill tone="accent" className="self-start">
              {weatherForm.lat}, {weatherForm.lng}
            </StatusPill>
          ) : null}
        </div>
      </SettingsCard>
    </>
  );
}
