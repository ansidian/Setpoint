import AnimatedCollapse from "@/components/shared/AnimatedCollapse";
import { useEffect, useState } from "react";
import { SiTodoist } from "@icons-pack/react-simple-icons";
import { disconnectTodoistConnection, saveTodoistPersonalToken } from "@/api";
import {
  beginTodoistOAuth,
  discardTodoistOAuthPending,
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
import type { SettingsCardStateProps, SettingsConnectionRefreshProps } from "../settingsTypes";
import type { TodoistConnectionStatus } from "../../../../shared/types/tasks";
import { cn } from "@/lib/utils";
import {
  SensitiveActionStepUp,
} from "../SensitiveActionStepUp";
import {
  isPasswordStepUpRequired,
  useSensitiveActionStepUp,
} from "../sensitiveActionStepUpModel";
import { formatCredentialTimestamp } from "./coreCredentialModel";

const BUTTON_MOTION_CLASS =
  "min-h-11 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0 sm:min-h-8";

export default function TodoistCard({
  settings,
  onRefreshConnections = async () => {},
  openAdvancedSetup = false,
}: Pick<SettingsCardStateProps, "settings"> & SettingsConnectionRefreshProps & {
  openAdvancedSetup?: boolean;
}) {
  const needsReauth = !!settings?.todoist_needs_reauth;
  const [todoistToken, setTodoistToken] = useState("");
  const [todoistConfigured, setTodoistConfigured] = useState(false);
  const [todoistDirty, setTodoistDirty] = useState(false);
  const [todoistSavingSecret, setTodoistSavingSecret] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [todoistMessage, setTodoistMessage] = useState<string | null>(null);
  const [oauthStatus, setOauthStatus] = useState<TodoistConnectionStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthDiscarding, setOauthDiscarding] = useState(false);
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(openAdvancedSetup);
  const stepUp = useSensitiveActionStepUp();
  const credentialActionLocked = Boolean(stepUp.pendingLabel);

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

  useEffect(() => {
    if (openAdvancedSetup) setAdvancedOpen(true);
  }, [openAdvancedSetup]);

  async function handleSaveTodoistSecret() {
    const candidate = todoistToken;
    await stepUp.run(async () => {
      setTodoistSavingSecret(true);
      setTodoistMessage(null);
      try {
        await saveTodoistPersonalToken(candidate);
        sessionStorage.setItem("ea_settings_changed", "1");
        window.dispatchEvent(new CustomEvent("ea-settings-changed"));
        setTodoistConfigured(true);
        setTodoistDirty(false);
        setTodoistToken("");
        await onRefreshConnections().catch(() => {});
        try {
          setOauthStatus(await getTodoistConnectionStatus());
        } catch {
          // The personal-token mutation succeeded; advanced status can recover on the next load.
        }
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) throw caught;
        setTodoistMessage("Todoist personal token could not be verified. The working connection was not changed.");
      } finally {
        setTodoistSavingSecret(false);
      }
    }, "saving the Todoist personal token");
  }

  async function handleDisconnectTodoist() {
    await stepUp.run(async () => {
      setDisconnecting(true);
      setTodoistMessage(null);
      try {
        await disconnectTodoistConnection();
        sessionStorage.setItem("ea_settings_changed", "1");
        window.dispatchEvent(new CustomEvent("ea-settings-changed"));
        setTodoistConfigured(false);
        setTodoistDirty(false);
        setTodoistToken("");
        setConfirmingDisconnect(false);
        setOauthStatus((current) => current ? {
          ...current,
          mode: "disconnected",
          configured: false,
          oauthRefreshable: false,
          needsReauth: false,
          deliveryMode: "periodic",
        } : current);
        await onRefreshConnections().catch(() => {});
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) throw caught;
        setTodoistMessage("Todoist could not be disconnected.");
      } finally {
        setDisconnecting(false);
      }
    }, "disconnecting Todoist");
  }

  async function handleSaveOAuthApplication() {
    const candidate = { clientId, clientSecret };
    await stepUp.run(async () => {
      setOauthBusy(true);
      setOauthMessage(null);
      try {
        await stageTodoistOAuthApplication(candidate);
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
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) throw caught;
        setOauthMessage("Application credentials could not be saved.");
      } finally {
        setOauthBusy(false);
      }
    }, "saving the Todoist OAuth application");
  }

  async function handleImportEnvironment() {
    await stepUp.run(async () => {
      setOauthBusy(true);
      setOauthMessage(null);
      try {
        await importTodoistOAuthEnvironment();
        setOauthStatus(await getTodoistConnectionStatus());
        setOauthMessage("Copied into encrypted Setpoint storage. The Render variables still remain. Back up EA_ENCRYPTION_KEY, remove both Todoist OAuth variables in Render, redeploy, then verify Todoist before considering the migration complete.");
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) throw caught;
        setOauthMessage("Host-managed Todoist credentials could not be copied.");
      } finally {
        setOauthBusy(false);
      }
    }, "copying the Todoist OAuth credentials into Setpoint");
  }

  async function handleDiscardOAuthApplication() {
    const candidateVersions = oauthStatus?.application.candidateVersions;
    if (!candidateVersions) return;
    await stepUp.run(async () => {
      setOauthBusy(true);
      setOauthDiscarding(true);
      setOauthMessage(null);
      try {
        await discardTodoistOAuthPending(candidateVersions);
        setOauthStatus(await getTodoistConnectionStatus());
        setOauthMessage("Pending application discarded. The active Todoist connection is unchanged.");
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) throw caught;
        setOauthMessage("The pending Todoist application could not be discarded. The active connection is unchanged.");
        try {
          setOauthStatus(await getTodoistConnectionStatus());
        } catch {
          // Preserve the last redacted status when the refresh is also unavailable.
        }
      } finally {
        setOauthDiscarding(false);
        setOauthBusy(false);
      }
    }, "discarding the pending Todoist application");
  }

  async function handleBeginOAuth() {
    await stepUp.run(async () => {
      setOauthBusy(true);
      setOauthMessage(null);
      try {
        const { url } = await beginTodoistOAuth();
        window.location.assign(url);
      } catch (caught) {
        setOauthBusy(false);
        if (isPasswordStepUpRequired(caught)) throw caught;
        setOauthMessage("Todoist authorization could not be started.");
      }
    }, "starting Todoist authorization");
  }

  return (
    <SettingsCard
      id="todoist-setup"
      ready={oauthStatus !== null || oauthMessage !== null}
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
            disabled={credentialActionLocked}
            onChange={(event) => {
              setTodoistToken(event.target.value);
              setTodoistDirty(true);
              setTodoistMessage(null);
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
              disabled={!todoistDirty || todoistSavingSecret || credentialActionLocked}
              size="sm"
            >
              {todoistSavingSecret ? "Saving & verifying…" : "Save & verify"}
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
                disabled={credentialActionLocked}
                onClick={() => setConfirmingDisconnect(true)}
                className="min-h-11 rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground/75 transition-[color,background-color,transform] duration-200 hover:-translate-y-px hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60 active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none sm:min-h-0"
              >
                Disconnect Todoist
              </button>
            </>
          ) : null}
          {todoistMessage ? <StatusPill tone="danger">{todoistMessage}</StatusPill> : null}
        </div>

        <AnimatedCollapse open={confirmingDisconnect}>
          <div className="rounded-md border border-danger/20 bg-danger/[0.06] p-3">
            <FieldHint>
              Task and deadline sync will stop. Mirrored tasks and automation settings stay available for review.
            </FieldHint>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={disconnecting || credentialActionLocked}
                onClick={handleDisconnectTodoist}
                className={BUTTON_MOTION_CLASS}
              >
                {disconnecting ? "Disconnecting…" : "Confirm disconnect Todoist"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disconnecting || credentialActionLocked}
                onClick={() => setConfirmingDisconnect(false)}
                className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION_CLASS)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </AnimatedCollapse>

        <SensitiveActionStepUp state={stepUp} />

        <details
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          className="border-t border-white/[0.06] pt-4"
        >
          <summary id="todoist-advanced-setup" className="-mx-1 min-h-11 cursor-pointer rounded-md px-1 py-3 text-[11px] font-semibold text-muted-foreground transition-[color,background-color] duration-200 hover:bg-white/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:bg-white/[0.06] motion-reduce:transition-none sm:min-h-8 sm:py-2">
            Advanced OAuth and webhooks
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            <p className="max-w-[70ch] text-[11px] leading-relaxed text-muted-foreground">
              Register this deployment as its own Todoist app for OAuth, refresh tokens, and real-time webhooks.
              Your personal token stays active until authorization succeeds. Saving a personal token later returns
              delivery to periodic sync.
            </p>
            {oauthStatus ? (
              <div className="space-y-1">
                <FieldHint>
                  Mode: {oauthStatus.mode.replace("_", " ")} · App credentials: {oauthStatus.application.source}
                  {oauthStatus.application.pendingConfigured ? " (pending validation)" : ""} · Delivery: {oauthStatus.deliveryMode.replace("_", " ")}
                </FieldHint>
                {oauthStatus.application.pendingConfigured && oauthStatus.application.pendingExpiresAt !== null ? (
                  <FieldHint>Pending candidate expires {formatCredentialTimestamp(oauthStatus.application.pendingExpiresAt)}</FieldHint>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <SectionLabel htmlFor="todoist-client-id">Client ID</SectionLabel>
                <Input
                  id="todoist-client-id"
                  value={clientId}
                  disabled={credentialActionLocked}
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
                  disabled={credentialActionLocked}
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
                disabled={!clientId || !clientSecret || oauthBusy || credentialActionLocked}
                onClick={handleSaveOAuthApplication}
              >
                Save app credentials
              </Button>
              <Button
                size="sm"
                className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION_CLASS)}
                disabled={oauthBusy || credentialActionLocked || !oauthStatus?.application.configured && !oauthStatus?.application.pendingConfigured}
                onClick={handleBeginOAuth}
              >
                Connect with OAuth
              </Button>
              {oauthStatus?.application.pendingConfigured ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION_CLASS)}
                  disabled={oauthBusy || credentialActionLocked || !oauthStatus.application.candidateVersions}
                  onClick={handleDiscardOAuthApplication}
                >
                  {oauthDiscarding ? "Discarding…" : "Discard pending"}
                </Button>
              ) : null}
              {oauthStatus?.application.source === "environment" ? (
                <Button
                  size="sm"
                  className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION_CLASS)}
                  disabled={oauthBusy || credentialActionLocked}
                  onClick={handleImportEnvironment}
                >
                  {oauthBusy ? "Copying…" : "Copy into Setpoint"}
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
