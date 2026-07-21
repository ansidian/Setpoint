import { useEffect, useState } from "react";
import { Bell, Send } from "lucide-react";
import { testDiscordReminderWebhook, updateSettings } from "@/api";
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
import { isDemoMode } from "@/demo/config";
import { cn } from "@/lib/utils";
import type { SettingsCardStateProps, SettingsConnectionRefreshProps } from "../settingsTypes";
import type { SettingsPatchRequest } from "../../../../shared/types/settings";
import {
  SensitiveActionStepUp,
} from "../SensitiveActionStepUp";
import {
  isPasswordStepUpRequired,
  useSensitiveActionStepUp,
} from "../sensitiveActionStepUpModel";

type DiscordTestStatus = "save-failed" | "sent" | "failed" | null;
interface DiscordFormState {
  webhookUrl: string;
  userId: string;
  configured: boolean;
  dirty: boolean;
  saving: boolean;
  testing: boolean;
  testStatus: DiscordTestStatus;
}

const BUTTON_MOTION = "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0";

export default function DiscordRemindersCard({
  settings,
  onRefreshConnections = async () => {},
}: Pick<SettingsCardStateProps, "settings"> & SettingsConnectionRefreshProps) {
  const demoMode = isDemoMode();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [discordForm, setDiscordForm] = useState<DiscordFormState>({
    webhookUrl: "",
    userId: "",
    configured: false,
    dirty: false,
    saving: false,
    testing: false,
    testStatus: null,
  });
  const stepUp = useSensitiveActionStepUp();
  const credentialActionLocked = Boolean(stepUp.pendingLabel);

  useEffect(() => {
    setDiscordForm((current) => ({
      ...current,
      userId: settings?.discord_user_id || "",
      configured: !!settings?.discord_webhook_configured,
      dirty: false,
      testStatus: null,
    }));
  }, [settings?.discord_user_id, settings?.discord_webhook_configured]);

  async function handleSaveDiscordSettings() {
    const trimmedWebhook = discordForm.webhookUrl.trim();
    const trimmedUserId = discordForm.userId.trim();
    const payload: SettingsPatchRequest = { discord_user_id: trimmedUserId };
    if (trimmedWebhook) payload.discord_webhook_url = trimmedWebhook;
    await stepUp.run(async () => {
      setDiscordForm((current) => ({ ...current, saving: true, testStatus: null }));
      try {
        await updateSettings(payload);
        sessionStorage.setItem("ea_settings_changed", "1");
        window.dispatchEvent(new CustomEvent("ea-settings-changed"));
        setDiscordForm((current) => ({
          ...current,
          webhookUrl: "",
          userId: trimmedUserId,
          configured: current.configured || !!trimmedWebhook,
          dirty: false,
          saving: false,
        }));
        await onRefreshConnections().catch(() => {});
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) throw caught;
        setDiscordForm((current) => ({ ...current, saving: false, testStatus: "save-failed" }));
      } finally {
        setDiscordForm((current) => ({ ...current, saving: false }));
      }
    }, trimmedWebhook ? "saving the Discord webhook" : "saving the Discord user ID");
  }

  async function handleClearDiscordSettings() {
    await stepUp.run(async () => {
      setDiscordForm((current) => ({ ...current, saving: true, testStatus: null }));
      try {
        await updateSettings({ discord_webhook_url: "", discord_user_id: "" });
        sessionStorage.setItem("ea_settings_changed", "1");
        window.dispatchEvent(new CustomEvent("ea-settings-changed"));
        setDiscordForm({
          webhookUrl: "",
          userId: "",
          configured: false,
          dirty: false,
          saving: false,
          testing: false,
          testStatus: null,
        });
        setConfirmingRemoval(false);
        await onRefreshConnections().catch(() => {});
      } catch (caught) {
        if (isPasswordStepUpRequired(caught)) throw caught;
        setDiscordForm((current) => ({ ...current, saving: false, testStatus: "save-failed" }));
      } finally {
        setDiscordForm((current) => ({ ...current, saving: false }));
      }
    }, "removing the Discord webhook");
  }

  async function handleTestDiscordWebhook() {
    setDiscordForm((current) => ({ ...current, testing: true, testStatus: null }));
    try {
      await testDiscordReminderWebhook();
      setDiscordForm((current) => ({ ...current, testing: false, testStatus: "sent" }));
    } catch {
      setDiscordForm((current) => ({ ...current, testing: false, testStatus: "failed" }));
    }
  }

  return (
    <SettingsCard
      id="discord-reminders"
      title="Discord Reminders"
      icon={<Bell size={14} />}
      description="Private Discord delivery for custom Event and Todoist reminders."
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
          <div>
            <SectionLabel>Discord webhook URL</SectionLabel>
            <Input
              type="password"
              aria-label="Discord webhook URL"
              placeholder={
                discordForm.configured && !discordForm.dirty
                  ? "••••••••  (saved)"
                  : "https://discord.com/api/webhooks/..."
              }
              value={discordForm.webhookUrl}
              disabled={credentialActionLocked}
              onChange={(event) => {
                const nextValue = event.target.value;
                setDiscordForm((current) => ({
                  ...current,
                  webhookUrl: nextValue,
                  dirty: true,
                  testStatus: null,
                }));
              }}
            />
            <FieldHint className="mt-1">
              The raw URL is encrypted at rest and never returned to the browser after saving.
            </FieldHint>
          </div>
          <div>
            <SectionLabel>Discord user ID</SectionLabel>
            <Input
              type="text"
              inputMode="numeric"
              aria-label="Discord user ID"
              placeholder="Optional mention"
              value={discordForm.userId}
              disabled={credentialActionLocked}
              onChange={(event) => {
                const nextValue = event.target.value;
                setDiscordForm((current) => ({
                  ...current,
                  userId: nextValue,
                  dirty: true,
                  testStatus: null,
                }));
              }}
            />
            <FieldHint className="mt-1">
              Optional. Used to mention you in reminder messages.
            </FieldHint>
          </div>
        </div>
        <FieldHint>
          Saving does not send a message or prove delivery. Use Send test reminder when you are ready for a real Discord message.
        </FieldHint>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleSaveDiscordSettings}
            className={cn(SETTINGS_PRIMARY_BUTTON_CLASS, BUTTON_MOTION)}
            disabled={!discordForm.dirty || discordForm.saving || credentialActionLocked}
            size="sm"
          >
            {discordForm.saving ? "Saving…" : "Save Discord"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleTestDiscordWebhook}
            className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)}
            disabled={demoMode || !discordForm.configured || discordForm.dirty || discordForm.testing || credentialActionLocked}
            size="sm"
          >
            <Send size={13} />
            {discordForm.testing ? "Sending reminder…" : "Send test reminder"}
          </Button>
          {discordForm.configured && !discordForm.dirty ? (
            <>
              <StatusPill tone="success">Saved</StatusPill>
              <button
                type="button"
                disabled={credentialActionLocked}
                onClick={() => setConfirmingRemoval(true)}
                className="rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground/75 transition-[color,background-color,transform] duration-200 hover:-translate-y-px hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60 active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none"
              >
                Remove Discord webhook
              </button>
            </>
          ) : null}
          {discordForm.dirty ? <StatusPill tone="warning">Unsaved</StatusPill> : null}
          {discordForm.testStatus === "sent" ? <StatusPill tone="success">Test sent</StatusPill> : null}
          {discordForm.testStatus === "failed" ? <StatusPill tone="danger">Test failed</StatusPill> : null}
          {discordForm.testStatus === "save-failed" ? <StatusPill tone="danger">Save failed</StatusPill> : null}
          {demoMode ? <StatusPill tone="neutral">Test not available in demo</StatusPill> : null}
        </div>
        {confirmingRemoval ? (
          <div className="rounded-md border border-danger/20 bg-danger/[0.06] p-3">
            <FieldHint>
              Discord reminder delivery will stop. Reminder schedules remain saved.
            </FieldHint>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={discordForm.saving || credentialActionLocked}
                onClick={handleClearDiscordSettings}
                className="transition-transform duration-200 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-danger/60 active:translate-y-0 motion-reduce:transition-none motion-reduce:transform-none"
              >
                {discordForm.saving ? "Removing…" : "Confirm remove Discord webhook"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={discordForm.saving || credentialActionLocked}
                onClick={() => setConfirmingRemoval(false)}
                className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, BUTTON_MOTION)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        <SensitiveActionStepUp state={stepUp} />
      </div>
    </SettingsCard>
  );
}
