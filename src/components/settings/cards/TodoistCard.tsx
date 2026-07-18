import { useEffect, useState } from "react";
import { SiTodoist } from "@icons-pack/react-simple-icons";
import { updateSettings } from "@/api";
import {
  beginTodoistOAuth,
  getTodoistConnectionStatus,
  importTodoistOAuthEnvironment,
  stageTodoistOAuthApplication,
} from "@/lib/todoistSetupApi";
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
} from "@/components/settings/settings-core";
import type { SettingsCardStateProps } from "../settingsTypes";
import type { TodoistConnectionStatus } from "../../../../shared/types/tasks";
import { cn } from "@/lib/utils";

const BUTTON_MOTION_CLASS =
  "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0";

export default function TodoistCard({ settings }: Pick<SettingsCardStateProps, "settings">) {
  const needsReauth = !!settings?.todoist_needs_reauth;
  const [todoistToken, setTodoistToken] = useState("");
  const [todoistConfigured, setTodoistConfigured] = useState(false);
  const [todoistDirty, setTodoistDirty] = useState(false);
  const [todoistSavingSecret, setTodoistSavingSecret] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<TodoistConnectionStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);

  useEffect(() => {
    if (settings?.todoist_configured) {
      setTodoistConfigured(true);
    }
  }, [settings?.todoist_configured]);

  useEffect(() => {
    let active = true;
    getTodoistConnectionStatus()
      .then((status) => {
        if (active) setOauthStatus(status);
      })
      .catch(() => {
        if (active) setOauthMessage("Advanced Todoist status is unavailable.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSaveTodoistSecret() {
    setTodoistSavingSecret(true);
    try {
      await updateSettings({ todoist_api_token: todoistToken });
      sessionStorage.setItem("ea_settings_changed", "1");
      setTodoistConfigured(Boolean(todoistToken));
      setTodoistDirty(false);
      setTodoistToken("");
      try {
        setOauthStatus(await getTodoistConnectionStatus());
      } catch {
        // The personal-token mutation succeeded; advanced status can recover on the next load.
      }
    } finally {
      setTodoistSavingSecret(false);
    }
  }

  async function handleSaveOAuthApplication() {
    setOauthBusy(true);
    setOauthMessage(null);
    try {
      await stageTodoistOAuthApplication({ clientId, clientSecret });
      setClientId("");
      setClientSecret("");
      try {
        setOauthStatus(await getTodoistConnectionStatus());
      } catch {
        setOauthStatus((current) => current ? {
          ...current,
          application: { ...current.application, pendingConfigured: true },
        } : current);
      }
      setOauthMessage("Application credentials saved as a pending candidate. Connect to validate them.");
    } catch {
      setOauthMessage("Application credentials could not be saved.");
    } finally {
      setOauthBusy(false);
    }
  }

  async function handleImportEnvironment() {
    setOauthBusy(true);
    setOauthMessage(null);
    try {
      await importTodoistOAuthEnvironment();
      setOauthStatus(await getTodoistConnectionStatus());
      setOauthMessage("Host-managed Todoist credentials were migrated into Setpoint.");
    } catch {
      setOauthMessage("Host-managed Todoist credentials could not be migrated.");
    } finally {
      setOauthBusy(false);
    }
  }

  async function handleBeginOAuth() {
    setOauthBusy(true);
    setOauthMessage(null);
    try {
      const { url } = await beginTodoistOAuth();
      window.location.assign(url);
    } catch {
      setOauthMessage("Todoist authorization could not be started.");
      setOauthBusy(false);
    }
  }

  return (
    <SettingsCard
      title="Todoist"
      icon={<SiTodoist size={14} title="" aria-hidden="true" />}
      description="Optional task sync used when email automation creates Todoist follow-ups."
    >
      <div className="flex flex-col gap-4">
        <div>
          <SectionLabel htmlFor="todoist-personal-token">Personal API token</SectionLabel>
          <Input
            id="todoist-personal-token"
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
            The simplest setup. It supports full task sync with periodic refreshes.
          </FieldHint>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {needsReauth && !todoistDirty ? (
            <Button
              onClick={() => {
                setTodoistToken("");
                setTodoistDirty(true);
              }}
              className={cn(
                "border border-[var(--sp-cream)]/20 bg-[var(--sp-cream)]/10 text-[var(--sp-cream)] hover:bg-[var(--sp-cream)]/16 hover:border-[var(--sp-cream)]/28 hover:-translate-y-px active:translate-y-0",
                BUTTON_MOTION_CLASS,
              )}
              size="sm"
            >
              Reconnect
            </Button>
          ) : (
            <Button
              onClick={handleSaveTodoistSecret}
              className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION_CLASS)}
              disabled={!todoistDirty || todoistSavingSecret}
              size="sm"
            >
              {todoistSavingSecret ? "Saving…" : "Save"}
            </Button>
          )}
          {todoistConfigured && !todoistDirty ? (
            <>
              {needsReauth ? (
                <StatusPill tone="warning">Reconnect needed</StatusPill>
              ) : (
                <StatusPill tone="success">Connected</StatusPill>
              )}
              <button
                type="button"
                onClick={() => {
                  setTodoistToken("");
                  setTodoistDirty(true);
                  setTodoistConfigured(false);
                }}
                className="rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground/75 transition-[color,background-color,transform] duration-200 hover:-translate-y-px hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none"
              >
                Disconnect
              </button>
            </>
          ) : null}
        </div>

        <details className="border-t border-white/[0.06] pt-4">
          <summary className="-mx-1 cursor-pointer rounded-md px-1 py-1 text-[11px] font-semibold text-muted-foreground transition-[color,background-color] duration-200 hover:bg-white/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
            Advanced OAuth and webhooks
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            <p className="max-w-[70ch] text-[11px] leading-relaxed text-muted-foreground">
              Register this deployment as its own Todoist app for OAuth, refresh tokens, and real-time webhooks.
              Your personal token stays active until authorization succeeds. Saving a personal token later returns
              delivery to periodic sync.
            </p>
            {oauthStatus ? (
              <FieldHint>
                Mode: {oauthStatus.mode.replace("_", " ")} · App credentials: {oauthStatus.application.source}
                {oauthStatus.application.pendingConfigured ? " (pending validation)" : ""} · Delivery: {oauthStatus.deliveryMode.replace("_", " ")}
              </FieldHint>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <SectionLabel htmlFor="todoist-client-id">Client ID</SectionLabel>
                <Input
                  id="todoist-client-id"
                  value={clientId}
                  autoComplete="off"
                  onChange={(event) => setClientId(event.target.value)}
                  placeholder="Todoist app client ID"
                />
              </div>
              <div>
                <SectionLabel htmlFor="todoist-client-secret">Client secret</SectionLabel>
                <Input
                  id="todoist-client-secret"
                  type="password"
                  value={clientSecret}
                  autoComplete="new-password"
                  onChange={(event) => setClientSecret(event.target.value)}
                  placeholder="Todoist app client secret"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION_CLASS)}
                disabled={!clientId || !clientSecret || oauthBusy}
                onClick={handleSaveOAuthApplication}
              >
                Save app credentials
              </Button>
              <Button
                size="sm"
                className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION_CLASS)}
                disabled={oauthBusy || !oauthStatus?.application.configured && !oauthStatus?.application.pendingConfigured}
                onClick={handleBeginOAuth}
              >
                Connect with OAuth
              </Button>
              {oauthStatus?.application.source === "environment" ? (
                <Button
                  size="sm"
                  className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION_CLASS)}
                  disabled={oauthBusy}
                  onClick={handleImportEnvironment}
                >
                  Migrate host credentials
                </Button>
              ) : null}
              {oauthStatus?.mode === "oauth" ? (
                <StatusPill tone={oauthStatus.needsReauth ? "warning" : "success"}>
                  {oauthStatus.needsReauth ? "OAuth reconnect needed" : "OAuth connected"}
                </StatusPill>
              ) : null}
            </div>

            {oauthStatus?.callbackUrl ? (
              <div className="space-y-2 text-[11px] text-muted-foreground">
                <div>
                  <span className="font-medium text-foreground">OAuth callback</span>
                  <code className="mt-1 block break-all rounded-md bg-white/[0.04] px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                    {oauthStatus.callbackUrl}
                  </code>
                </div>
                <div>
                  <span className="font-medium text-foreground">Webhook URL</span>
                  <code className="mt-1 block break-all rounded-md bg-white/[0.04] px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                    {oauthStatus.webhookUrl}
                  </code>
                </div>
              </div>
            ) : null}
            {oauthMessage ? <FieldHint>{oauthMessage}</FieldHint> : null}
          </div>
        </details>
      </div>
    </SettingsCard>
  );
}
