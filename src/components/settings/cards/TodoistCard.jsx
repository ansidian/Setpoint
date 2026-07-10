import { useEffect, useState } from "react";
import { SiTodoist } from "@icons-pack/react-simple-icons";
import { updateSettings } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FieldHint,
  SectionLabel,
  SettingsCard,
  StatusPill,
} from "@/components/settings/settings-ui";
import { SETTINGS_PRIMARY_BUTTON_CLASS } from "@/components/settings/settings-core";

export default function TodoistCard({ settings }) {
  const needsReauth = !!settings?.todoist_needs_reauth;
  const [todoistToken, setTodoistToken] = useState("");
  const [todoistConfigured, setTodoistConfigured] = useState(false);
  const [todoistDirty, setTodoistDirty] = useState(false);
  const [todoistSavingSecret, setTodoistSavingSecret] = useState(false);

  useEffect(() => {
    if (settings?.todoist_configured) {
      setTodoistConfigured(true);
    }
  }, [settings?.todoist_configured]);

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

  return (
    <SettingsCard
      title="Todoist"
      icon={<SiTodoist size={14} title="" aria-hidden="true" />}
      description="Optional task sync used when email automation creates Todoist follow-ups."
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
          {needsReauth && !todoistDirty ? (
            <Button
              onClick={() => {
                setTodoistToken("");
                setTodoistDirty(true);
              }}
              className="border border-[var(--sp-cream)]/20 bg-[var(--sp-cream)]/10 text-[var(--sp-cream)] hover:bg-[var(--sp-cream)]/16 hover:border-[var(--sp-cream)]/28 hover:-translate-y-px active:translate-y-0"
              size="sm"
            >
              Reconnect
            </Button>
          ) : (
            <Button
              onClick={handleSaveTodoistSecret}
              className={SETTINGS_PRIMARY_BUTTON_CLASS}
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
                className="text-[11px] font-medium text-muted-foreground/75 transition-colors hover:text-danger"
              >
                Disconnect
              </button>
            </>
          ) : null}
        </div>
      </div>
    </SettingsCard>
  );
}
