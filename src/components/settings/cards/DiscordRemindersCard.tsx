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
import type { SettingsCardStateProps } from "../settingsTypes";
import type { SettingsPatchRequest } from "../../../../shared/types/settings";

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

export default function DiscordRemindersCard({ settings }: Pick<SettingsCardStateProps, "settings">) {
  const demoMode = isDemoMode();
  const [discordForm, setDiscordForm] = useState<DiscordFormState>({
    webhookUrl: "",
    userId: "",
    configured: false,
    dirty: false,
    saving: false,
    testing: false,
    testStatus: null,
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync the Discord form from saved settings on load/change
    setDiscordForm((current) => ({
      ...current,
      userId: settings?.discord_user_id || "",
      configured: !!settings?.discord_webhook_configured,
      dirty: false,
      testStatus: null,
    }));
  }, [settings?.discord_user_id, settings?.discord_webhook_configured]);

  async function handleSaveDiscordSettings() {
    setDiscordForm((current) => ({ ...current, saving: true, testStatus: null }));
    const trimmedWebhook = discordForm.webhookUrl.trim();
    const trimmedUserId = discordForm.userId.trim();
    try {
      const payload: SettingsPatchRequest = { discord_user_id: trimmedUserId };
      if (trimmedWebhook) payload.discord_webhook_url = trimmedWebhook;
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
    } catch {
      setDiscordForm((current) => ({ ...current, saving: false, testStatus: "save-failed" }));
    }
  }

  async function handleClearDiscordSettings() {
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
    } catch {
      setDiscordForm((current) => ({ ...current, saving: false, testStatus: "save-failed" }));
    }
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

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleSaveDiscordSettings}
            className={SETTINGS_PRIMARY_BUTTON_CLASS}
            disabled={!discordForm.dirty || discordForm.saving}
            size="sm"
          >
            {discordForm.saving ? "Saving…" : "Save Discord"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleTestDiscordWebhook}
            className={SETTINGS_SECONDARY_BUTTON_CLASS}
            disabled={demoMode || !discordForm.configured || discordForm.dirty || discordForm.testing}
            size="sm"
          >
            <Send size={13} />
            {discordForm.testing ? "Sending…" : "Send test"}
          </Button>
          {discordForm.configured && !discordForm.dirty ? (
            <>
              <StatusPill tone="success">Saved</StatusPill>
              <button
                type="button"
                onClick={handleClearDiscordSettings}
                className="text-[11px] font-medium text-muted-foreground/75 transition-colors hover:text-danger"
              >
                Clear
              </button>
            </>
          ) : null}
          {discordForm.dirty ? <StatusPill tone="warning">Unsaved</StatusPill> : null}
          {discordForm.testStatus === "sent" ? <StatusPill tone="success">Test sent</StatusPill> : null}
          {discordForm.testStatus === "failed" ? <StatusPill tone="danger">Test failed</StatusPill> : null}
          {discordForm.testStatus === "save-failed" ? <StatusPill tone="danger">Save failed</StatusPill> : null}
          {demoMode ? <StatusPill tone="neutral">Test not available in demo</StatusPill> : null}
        </div>
      </div>
    </SettingsCard>
  );
}
