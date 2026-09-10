import AnimatedCollapse from "@/components/shared/AnimatedCollapse";
import { useState } from "react";
import { SiTodoist } from "@icons-pack/react-simple-icons";
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
import { cn } from "@/lib/utils";
import {
  SensitiveActionStepUp,
} from "../SensitiveActionStepUp";
import { useTodoistSetup } from "./useTodoistSetup";
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
  const {
    needsReauth, todoistToken, todoistConfigured, todoistDirty, todoistSavingSecret,
    confirmingDisconnect, disconnecting, todoistMessage, oauthStatus,
    clientId, setClientId, clientSecret, setClientSecret, oauthBusy, oauthDiscarding,
    oauthMessage, stepUp, credentialActionLocked, editToken, reconnect,
    requestDisconnect, cancelDisconnect, handleSaveTodoistSecret,
    handleDisconnectTodoist, handleSaveOAuthApplication, handleImportEnvironment,
    handleDiscardOAuthApplication, handleBeginOAuth,
  } = useTodoistSetup({ settings, onRefreshConnections });
  const [advancedOpen, setAdvancedOpen] = useState(openAdvancedSetup);
  const [previousAdvancedSetup, setPreviousAdvancedSetup] = useState(openAdvancedSetup);

  if (openAdvancedSetup !== previousAdvancedSetup) {
    setPreviousAdvancedSetup(openAdvancedSetup);
    if (openAdvancedSetup) setAdvancedOpen(true);
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
            onChange={(event) => editToken(event.target.value)}
          />
          <FieldHint className="mt-1">
            The simplest setup. It supports full task sync with periodic refreshes.
          </FieldHint>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {needsReauth && !todoistDirty ? (
            <Button
              onClick={reconnect}
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
                onClick={requestDisconnect}
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
                onClick={cancelDisconnect}
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
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[11px] leading-relaxed sm:grid-cols-3">
                  <div className="min-w-0"><dt className="text-muted-foreground">Mode</dt><dd className="break-words text-foreground">{oauthStatus.mode.replace("_", " ")}</dd></div>
                  <div className="min-w-0"><dt className="text-muted-foreground">App credentials</dt><dd className="break-words text-foreground">{oauthStatus.application.source}{oauthStatus.application.pendingConfigured ? <span className="ml-1 text-muted-foreground">(pending validation)</span> : null}</dd></div>
                  <div className="min-w-0"><dt className="text-muted-foreground">Delivery</dt><dd className="break-words text-foreground">{oauthStatus.deliveryMode.replace("_", " ")}</dd></div>
                </dl>
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
